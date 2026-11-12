// Portfolio Tracker - Portfolio Health & Alerts Component (Concept 3 Glassmorphism Design)
// Unique features: Insider activity, Index changes, Earnings alerts
// The largest position's share of the money, when it is half or more:
// { label, weight } or null. Positions are the tracker's rows with prices
// (currentValue); sold-out and unpriced rows carry no weight. Pure, tested.
window.PortfolioHealthScore = {
  concentration(positions) {
    const rows = (Array.isArray(positions) ? positions : [])
      .map(p => ({ p, v: Number(p && p.currentValue) }))
      .filter(x => Number.isFinite(x.v) && x.v > 0 && !(Number(x.p.quantity) <= 0));
    const total = rows.reduce((a, x) => a + x.v, 0);
    if (!(total > 0)) return null;
    const top = rows.reduce((a, x) => (x.v > a.v ? x : a), rows[0]);
    const weight = top.v / total * 100;
    if (weight < 50) return null;
    const label = String(top.p.symbol || '').split('.')[0] || top.p.name || 'One position';
    return { label, weight };
  },
  // Is there anything to score? 'ok' when at least one position has shares
  // and a value; otherwise why not: 'loading' (quotes on their way),
  // 'unpriced' (shares held, no price came back), 'empty' (no shares at all).
  // A template portfolio right after creation -- five positions, no shares,
  // nothing priced -- read "60 Good". A caller that passes
  // no positions (the phone layout) is scored as before.
  state(positions, loading) {
    if (!Array.isArray(positions)) return 'ok';
    const held = positions.filter(p => p && Number(p.quantity) > 0);
    if (held.some(p => Number(p.currentValue) > 0)) return 'ok';
    if (loading) return 'loading';
    return held.length ? 'unpriced' : 'empty';
  },
};

window.PortfolioHealthView = ({ holdings, positions, apiKey, baseCurrency, onClose, theme, embedded, pricesLoading, onRetryPrices }) => {
  const [activeTab, setActiveTab] = React.useState('overview');
  const [insiderData, setInsiderData] = React.useState([]);
  const [earningsData, setEarningsData] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  // A feed that did not load for a holding (the limit, EODHD's error, a
  // dropped connection, an unreadable answer): said with its reason and a
  // Try again, not as "no insider transactions".
  const [insiderFail, setInsiderFail] = React.useState(null);
  // The holdings whose feed did not load, when others' did: named, as
  // "some holdings" did not say which.
  const [insiderFailFor, setInsiderFailFor] = React.useState([]);
  const [insiderRefusal, setInsiderRefusal] = React.useState(null);
  const [earningsFail, setEarningsFail] = React.useState(null);
  const [, sectorsArrived] = React.useState(0);
  React.useEffect(() => {
    const on = () => sectorsArrived(n => n + 1);
    window.addEventListener('portfolio:sector-learned', on);
    return () => window.removeEventListener('portfolio:sector-learned', on);
  }, []);
  const healthGate = (window.FreeLimitWalls ? window.FreeLimitWalls.useAnalyticsGate : () => 'open')('health', true);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  // Light theme: darker success/error/warning inks and accents, so text clears
  // 4.5:1 on white (Calc.themeInk).
  const C3 = window.PortfolioCalculations ? window.PortfolioCalculations.themeInk(window.C3, theme === 'dark') : window.C3;
  const acc = (hex) => (window.PortfolioCalculations ? window.PortfolioCalculations.accent(hex, theme === 'dark') : hex);
  const isDark = theme === 'dark';

  const Icon = ({ name, size = 24, color }) => {
    return React.createElement('svg', { 'aria-hidden': true, focusable: 'false',
      style: { width: size, height: size, flexShrink: 0 },
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color || 'currentColor',
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  const styles = {
    container: {
      height: '100vh',
      paddingBottom: window.APP_PLATFORM === 'WEB' ? 20 : 80,
      background: window.APP_PLATFORM === 'WEB' ? 'transparent' : (isDark ? C3.bgGradientDark : C3.bgGradientLight),
      color: isDark ? C3.textDark : C3.textLightTheme,
      position: 'relative',
      overflowY: 'auto',
      boxSizing: 'border-box'
    },
    header: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      position: 'sticky',
      top: 0,
      zIndex: 40
    },
    headerContent: {
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    iconButton: {
      padding: 8,
      borderRadius: 8,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: isDark ? C3.textDark : C3.textLightTheme,
      transition: 'background 0.2s'
    },
    card: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    tabButton: (isActive) => ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 16px',
      borderRadius: 12,
      border: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      fontWeight: 500,
      fontSize: 14,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      ...window.ToggleStyle.value(isActive, isDark)
    }),
    statCard: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16,
      padding: 16,
      textAlign: 'center',
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    muted: {
      color: isDark ? C3.textMutedDark : C3.textMutedLight,
      fontSize: 12
    },
    badge: (type) => ({
      fontSize: 12,
      padding: '2px 8px',
      borderRadius: 4,
      background: type === 'sell' ? 'rgba(239,68,68,0.2)' :
                  type === 'buy' ? 'rgba(34,197,94,0.2)' :
                  isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      color: type === 'sell' ? C3.error :
             type === 'buy' ? C3.success :
             isDark ? C3.textMutedDark : C3.textMutedLight
    })
  };

  React.useEffect(() => {
    if (activeTab === 'insider') {
      loadInsiderActivity();
    } else if (activeTab === 'earnings') {
      loadEarningsCalendar();
    }
  }, [activeTab]);

  const loadInsiderActivity = async () => {
    const FLW = window.FreeLimitWalls;
    const FL = window.FreeLimits;
    setLoading(true);
    let wall = FLW && FLW.finSectionsWall ? FLW.finSectionsWall('healthInsiders') : null;
    if (wall && FL && typeof FL.confirmWall === 'function') {
      wall = (await FL.confirmWall('fin_sections')) ? FLW.finSectionsWall('healthInsiders') : null;
    }
    setInsiderRefusal(wall);
    if (wall) {
      setInsiderData([]);
      setInsiderFail(null);
      setLoading(false);
      return;
    }
    const allInsider = [];
    const insiderFails = [];
    const failedFor = [];
    let asked = 0;

    for (const holding of holdings) {
      if (holding.symbol && holding.type === 'stock') {
        try {
          const ticker = holding.symbol.split('.')[0];
          // SEC Form 4 filings, flattened by InsiderTx exactly as the asset
          // page does it. The old insider-transactions endpoint returns [] or
          // rows frozen at 2026-04-24, so this tab was always empty. Form 4 covers US issuers only.
          const isUs = /\.US$/i.test(holding.symbol) || !holding.symbol.includes('.');
          if (!isUs || !window.InsiderTx) continue;
          asked++;
          const payload = await window.EODHD_API.getInsiderForm4(apiKey, holding.symbol, { limit: 20, throwErrors: true });
          const rows = window.InsiderTx.flattenForm4(payload).slice(0, 10);
          rows.forEach(tx => {
            allInsider.push({
              ...tx,
              // The fields this view reads: buy/sell comes from the Form 4
              // transaction code, not a free-text type.
              transactionType: tx.bucket === 'buy' || tx.bucket === 'sell' ? tx.bucket : (tx.codeLabel || tx.bucket),
              reporterTitle: tx.ownerTitle || '',
              value: tx.totalValue,
              symbol: ticker,
              holdingName: holding.name || ticker
            });
          });
        } catch (e) {
          if (FLW && FLW.finFeedRefused && FLW.finFeedRefused(e)) {
            setInsiderRefusal(FLW.finSectionsRefusal('healthInsiders', e.planRequired));
            setInsiderData([]);
            setInsiderFail(null);
            setLoading(false);
            return;
          }
          insiderFails.push(e || {});
          if (window.RateLimitWait.outage(e || {}) && failedFor.indexOf(holding.symbol) === -1) failedFor.push(holding.symbol);
        }
      }
    }

    // Sort by date descending
    allInsider.sort((a, b) => new Date(b.date || b.transactionDate) - new Date(a.date || a.transactionDate));
    setInsiderData(allInsider.slice(0, 50));
    setInsiderFail(window.RateLimitWait.outage(insiderFails));
    setInsiderFailFor(failedFor.length < asked ? failedFor : []);
    setLoading(false);
  };

  const loadEarningsCalendar = async () => {
    setLoading(true);
    const earningsList = [];
    const earningsFails = [];

    for (const holding of holdings) {
      if (holding.symbol && holding.type === 'stock') {
        try {
          const fundamentals = await (window.PortfolioFundamentals ? window.PortfolioFundamentals.get(apiKey, holding.symbol) : window.EODHD_API.getFundamentals(apiKey, holding.symbol));
          // Not come back: what the request threw, for the line's reason.
          const PF = window.PortfolioFundamentals;
          if (fundamentals == null && PF && PF.failureOf && PF.failureOf(apiKey, holding.symbol)) earningsFails.push(PF.failureOf(apiKey, holding.symbol));
          const earnings = fundamentals?.Earnings?.History;

          if (earnings) {
            // Get upcoming and recent earnings
            const now = new Date();
            const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            const threeMonthsAhead = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

            // The key of Earnings.History is the fiscal period's end, not the
            // day the company reports: AAPL's "Sep 30" quarter reports on Oct
            // 29, and NVDA's "Oct 31" was shown as an upcoming report that is
            // only a quarter end. The report
            // day is `reportDate`; a row without one has no date to show.
            Object.entries(earnings).forEach(([periodEnd, data]) => {
              const date = (data && data.reportDate) || null;
              if (!date) return;
              const earningsDate = new Date(date + 'T00:00:00');
              if (Number.isNaN(earningsDate.getTime())) return;
              if (earningsDate >= threeMonthsAgo && earningsDate <= threeMonthsAhead) {
                earningsList.push({
                  symbol: holding.symbol.split('.')[0],
                  date,
                  periodEnd: (data && data.date) || periodEnd,
                  epsEstimate: data.epsEstimate,
                  epsActual: data.epsActual,
                  surprise: data.epsDifference,
                  surprisePercent: data.surprisePercent,
                  isUpcoming: date >= window.CalendarDate.today(now) && data.epsActual == null
                });
              }
            });
          }
        } catch (e) {
          earningsFails.push(e || {});
        }
      }
    }

    // Upcoming first, nearest first; then past reports, latest first.
    earningsList.sort((a, b) => {
      if (a.isUpcoming && !b.isUpcoming) return -1;
      if (!a.isUpcoming && b.isUpcoming) return 1;
      return a.isUpcoming ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    });

    setEarningsData(earningsList);
    setEarningsFail(window.RateLimitWait.outage(earningsFails));
    setLoading(false);
  };

  // Calculate portfolio health metrics
  const calculateHealthScore = () => {
    let score = 70; // Base score
    let factors = [];

    // Diversification bonus
    const uniqueTypes = new Set(holdings.map(h => h.type)).size;
    if (uniqueTypes >= 3) {
      score += 10;
      factors.push({ text: 'Good asset diversification', positive: true });
    } else if (uniqueTypes === 1) {
      score -= 10;
      factors.push({ text: 'Consider diversifying asset types', positive: false });
    }

    // Position concentration
    const holdingCount = holdings.length;
    if (holdingCount >= 10) {
      score += 10;
      factors.push({ text: 'Well-diversified holdings', positive: true });
    } else if (holdingCount <= 3) {
      score -= 15;
      factors.push({ text: 'Concentrated portfolio - consider more positions', positive: false });
    }

    // Currency diversification
    const uniqueCurrencies = new Set(holdings.map(h => h.currency)).size;
    if (uniqueCurrencies >= 2) {
      score += 5;
      factors.push({ text: 'Multi-currency exposure', positive: true });
    }

    // Recent insider selling warning
    const recentSelling = insiderData.filter(tx => {
      const txDate = new Date(tx.date || tx.transactionDate);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const type = (tx.transactionType || tx.type || '').toLowerCase();
      return txDate > thirtyDaysAgo && (type.includes('sell') || type.includes('sale'));
    });

    if (recentSelling.length > 5) {
      score -= 10;
      factors.push({ text: `${recentSelling.length} insider sells in last 30 days`, positive: false });
    }

    // One position carrying half the money or more caps the score at Fair:
    // "70 · Good" stood next to "Consider diversifying" with 100% in one
    // stock, because the count of rows (sold-out ones included) looked
    // diversified. Weights are market values from the tracker.
    const cap = window.PortfolioHealthScore.concentration(positions);
    if (cap) {
      score = Math.min(score, 59);
      factors.push({ text: `${cap.label} is ${Math.round(cap.weight)}% of the portfolio`, positive: false });
    }

    return { score: Math.max(0, Math.min(100, score)), factors };
  };

  const health = calculateHealthScore();
  // Sectors as stored now, not as they were when the page loaded: the
  // allocation looks them up and stores them, and this stayed on "?" beside
  // a sector list.
  const sectorCount = new Set(holdings.map(h => { try { const now = Storage.getHoldingById(h.id); return (now && now.sector) || h.sector; } catch (e) { return h.sector; } }).filter(Boolean)).size;
  const scoreState = window.PortfolioHealthScore.state(positions, pricesLoading);

  // Status colours as text on this card: red "Fair" and the warnings read
  // 4.04-4.46:1 in the dark theme. Same hue, pushed to AA.
  // On the theme's worst ground, and without depending on a11yColor.js
  // being loaded: "Fair" read 4.46 and the warning factors 4.04 in the dark
  // theme.
  const tone = (c) => (window.PortfolioCalculations && window.PortfolioCalculations.ink ? window.PortfolioCalculations.ink(c, isDark) : c);
  const getHealthColor = (score) => {
    if (score >= 80) return tone(C3.success);
    if (score >= 60) return tone(C3.warning);
    return tone(C3.error);
  };

  const getHealthLabel = (score) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Attention';
  };

  // Format date
  const formatDate = (dateStr) => window.CalendarDate.format(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });

  // Format currency for insider transactions
  const formatAmount = (value) => {
    if (!value) return 'N/A';
    const num = parseFloat(value);
    if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
    return `$${num.toFixed(0)}`;
  };

  const isWeb = window.APP_PLATFORM === 'WEB';
  // Header: hidden when embedded (the widget on the portfolio's main page),
  // which has its own heading, and where our Back button would do nothing.
  const header = !embedded && (
        <div style={styles.header}>
          <div style={styles.headerContent}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button aria-label="Back" onClick={onClose} style={styles.iconButton}>
                <Icon name="chevronLeft" size={20} />
              </button>
              <div>
                <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Portfolio Health</h1>
                <p style={{ ...styles.muted, margin: 0 }}>Alerts & Analysis</p>
              </div>
            </div>
          </div>
        </div>
      );

  if (healthGate !== 'open') {
    const W = window.FreeLimitWalls;
    const refusal = healthGate === 'wall' && W ? W.analyticsRefusal('health') : null;
    return (
      <div style={styles.container} data-free-limit-wall="health">
        {header}
        <div style={{ padding: 16 }}>
          {refusal && window.PlanNotice && window.PlanNotice.RefusalCard
            ? React.createElement(window.PlanNotice.RefusalCard, { refusal, isDark })
            : <p role="status" style={{ ...styles.muted, margin: 0 }}>Loading…</p>}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Glow Effects — Telegram only; on web they show as a stray orange smudge in the top-right */}

      {header}

      {/* Tabs. Embedded (the Health Score widget) keeps the score in view:
          Insider and Earnings open in their own card under it instead of
          replacing it. */}
      {!embedded && (
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            { id: 'overview', label: 'Overview', icon: 'activity' },
            { id: 'insider', label: 'Insider', icon: 'briefcase' },
            { id: 'earnings', label: 'Earnings', icon: 'calendar' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={styles.tabButton(activeTab === tab.id)}
            >
              <Icon name={tab.icon} size={16} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      <div style={{ padding: 16 }}>
        {/* Overview Tab */}
        {(activeTab === 'overview' || embedded) && (
          <>
            {/* Health Score Gauge */}
            <div style={{ ...styles.card, textAlign: 'center', padding: 24 }}>
              <h3 style={{ ...styles.muted, marginBottom: 16, marginTop: 0 }}>Portfolio Health Score</h3>
              {scoreState !== 'ok' && (
                <p style={{ margin: 0, padding: '8px 0', fontSize: 14, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  {/* The words are the live region; the button counts the
                      wait every second and stays outside it. */}
                  {/* And why none came, when that is known: a rate that did
                      not load, the quotes' failure. */}
                  <span role="status">{scoreState === 'loading' ? 'Loading prices…'
                    : scoreState === 'unpriced' ? 'No score yet — it needs current prices, and none came back for these positions.' + ((() => { const w = window.PortfolioCalculations && window.PortfolioCalculations.unpricedWhy ? window.PortfolioCalculations.unpricedWhy(positions, baseCurrency || 'USD') : ''; return w ? ' ' + w : ''; })())
                    : 'No score yet — these positions have no shares. Add your purchases to get a score.'}</span>
                  {scoreState === 'unpriced' && onRetryPrices && (
                    <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />
                  )}
                </p>
              )}
              {/* Scored on what has a value; a position left without one by
                  a failed request is named, with Try again. */}
              {scoreState === 'ok' && (() => {
                // By ticker, with why: the currency and the reason did not say
                // which positions fell out once there were several.
                const PC = window.PortfolioCalculations;
                const w = PC && PC.unpricedLine ? PC.unpricedLine(positions, baseCurrency || 'USD') : PC && PC.unpricedWhy ? PC.unpricedWhy(positions, baseCurrency || 'USD') : '';
                if (!w) return null;
                return (
                  <p data-unpriced-why="true" style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                    <span role="status">{w} The score leaves out the positions without a value.</span>
                    {onRetryPrices && (
                      <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />
                    )}
                  </p>
                );
              })()}
              {scoreState === 'ok' && (() => {
                const size = 180;
                const strokeWidth = 14;
                const radius = (size - strokeWidth) / 2;
                const center = size / 2;
                const circumference = 2 * Math.PI * radius;
                // Arc from 135° to 405° (270° total sweep)
                const startAngle = 135;
                const sweepAngle = 270;
                const scoreAngle = (health.score / 100) * sweepAngle;
                const toRad = (deg) => (deg * Math.PI) / 180;

                const arcPath = (angleDeg) => {
                  const rad = toRad(angleDeg);
                  return {
                    x: center + radius * Math.cos(rad),
                    y: center + radius * Math.sin(rad)
                  };
                };

                const start = arcPath(startAngle);
                const end = arcPath(startAngle + sweepAngle);
                const scoreEnd = arcPath(startAngle + scoreAngle);
                const bgLargeArc = sweepAngle > 180 ? 1 : 0;
                const scoreLargeArc = scoreAngle > 180 ? 1 : 0;

                const bgArc = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${bgLargeArc} 1 ${end.x} ${end.y}`;
                const scoreArc = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${scoreLargeArc} 1 ${scoreEnd.x} ${scoreEnd.y}`;

                const healthColor = getHealthColor(health.score);

                return (
                  <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
                    <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                      {/* Background arc */}
                      <path d={bgArc} fill="none" stroke={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'} strokeWidth={strokeWidth} strokeLinecap="round" />
                      {/* Score arc */}
                      {health.score > 0 && (
                        <path d={scoreArc} fill="none" stroke={healthColor} strokeWidth={strokeWidth} strokeLinecap="round"
                          style={{ filter: `drop-shadow(0 0 6px ${healthColor}40)` }} />
                      )}
                      {/* Zone markers */}
                      {[40, 60, 80].map(mark => {
                        const a = startAngle + (mark / 100) * sweepAngle;
                        const p = arcPath(a);
                        return <circle key={mark} cx={p.x} cy={p.y} r={2} fill={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'} />;
                      })}
                    </svg>
                    {/* Center text */}
                    <div style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -45%)', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 42, fontWeight: 800, color: healthColor, lineHeight: 1 }}>
                        {health.score}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: healthColor, marginTop: 4 }}>
                        {getHealthLabel(health.score)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Risk alerts if score is low */}
              {scoreState === 'ok' && health.factors.filter(f => !f.positive).length > 0 && (
                <div style={{
                  marginTop: 16, padding: '10px 14px', borderRadius: 12,
                  background: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.05)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}>
                  {health.factors.filter(f => !f.positive).map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: tone(C3.error), padding: '3px 0' }}>
                      {React.createElement(Icon, { name: 'alertTriangle', size: 13 })}
                      <span>{f.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Health Factors */}
            {scoreState === 'ok' && <div style={styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, color: isDark ? C3.textDark : C3.textLightTheme }}>Health Factors</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {health.factors.map((factor, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: factor.positive ? C3.success : C3.warning
                    }} />
                    <span style={{ color: tone(factor.positive ? C3.success : C3.warning) }}>
                      {factor.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>}

            {/* Quick Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
              <div style={styles.statCard}>
                <div style={{ fontSize: 24, fontWeight: 700, color: acc('#f97316') }}>{holdings.length}</div>
                <div style={styles.muted}>Holdings</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ fontSize: 24, fontWeight: 700, color: acc('#3b82f6') }}>
                  {new Set(holdings.map(h => h.type)).size}
                </div>
                <div style={styles.muted}>Asset Types</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ fontSize: 24, fontWeight: 700, color: C3.success }}>
                  {new Set(holdings.map(h => h.currency)).size}
                </div>
                <div style={styles.muted}>Currencies</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ fontSize: 24, fontWeight: 700, color: isDark ? C3.textDark : C3.textLightTheme }}>
                  {sectorCount || '?'}
                </div>
                <div style={styles.muted}>Sectors</div>
              </div>
            </div>

            {/* Recommendations */}
            <div style={{
              ...styles.card,
              marginTop: 16,
              background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'
            }}>
              <h4 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, fontSize: 14, color: isDark ? C3.textDark : C3.textLightTheme }}>Recommendations</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...styles.muted }}>
                {holdings.length < 5 && (
                  <p style={{ margin: 0 }}>• Consider adding more positions for better diversification</p>
                )}
                {new Set(holdings.map(h => h.type)).size === 1 && (
                  <p style={{ margin: 0 }}>• Add different asset types (ETFs, bonds, crypto) to reduce risk</p>
                )}
                {new Set(holdings.map(h => h.currency)).size === 1 && (
                  <p style={{ margin: 0 }}>• Consider international exposure for currency diversification</p>
                )}
                {holdings.length >= 10 && (
                  <p style={{ margin: 0 }}>• Good diversification! Review periodically for rebalancing opportunities</p>
                )}
              </div>
            </div>
          </>
        )}

        {embedded && (
          <div role="group" aria-label="Holdings activity" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, marginBottom: activeTab === 'overview' ? 0 : 12 }}>
            {[
              { id: 'insider', label: 'Insider', icon: 'briefcase' },
              { id: 'earnings', label: 'Earnings', icon: 'calendar' }
            ].map(tab => (
              <button
                key={tab.id}
                aria-pressed={activeTab === tab.id}
                onClick={() => setActiveTab(activeTab === tab.id ? 'overview' : tab.id)}
                style={styles.tabButton(activeTab === tab.id)}
              >
                <Icon name={tab.icon} size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Insider Tab */}
        {activeTab === 'insider' && (
          <div style={styles.card}>
            <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, color: isDark ? C3.textDark : C3.textLightTheme }}>Recent Insider Transactions</h3>
            {!loading && insiderRefusal && window.PlanNotice && window.PlanNotice.RefusalCard
              && React.createElement(window.PlanNotice.RefusalCard, { refusal: insiderRefusal, isDark })}
            {!loading && !insiderRefusal && insiderFail && React.createElement(window.RateLimitWait.FailNote, {
              what: insiderFailFor.length && Calc && Calc.namesList ? `The insider feed for ${Calc.namesList(insiderFailFor)}`
                : insiderData.length ? 'The insider feed for some holdings' : 'The insider feed',
              failure: insiderFail, onRetry: loadInsiderActivity, isDark, panel: 'health-insider',
              style: { marginBottom: 12 },
            })}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{
                  width: 32,
                  height: 32,
                  border: '2px solid transparent',
                  borderTopColor: '#f97316',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto'
                }} />
                <p style={{ ...styles.muted, marginTop: 8 }}>Loading insider data...</p>
              </div>
            ) : insiderData.length > 0 ? (
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {insiderData.map((tx, i) => {
                  const type = (tx.transactionType || tx.type || '').toLowerCase();
                  const isSale = type.includes('sell') || type.includes('sale') || type.includes('disposition');
                  const isBuy = type.includes('buy') || type.includes('purchase') || type.includes('acquisition');

                  return (
                    <div key={i} style={{
                      borderBottom: i < insiderData.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` : 'none',
                      paddingBottom: 12,
                      marginBottom: 12
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div>
                          <span style={{ fontWeight: 600, color: acc('#f97316') }}>{tx.symbol}</span>
                          <span style={{ ...styles.badge(isSale ? 'sell' : isBuy ? 'buy' : 'other'), marginLeft: 8 }}>
                            {isSale ? 'SELL' : isBuy ? 'BUY' : type.substring(0, 10)}
                          </span>
                        </div>
                        <div style={{ ...styles.muted }}>
                          {formatDate(tx.date || tx.transactionDate)}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, color: isDark ? C3.textDark : C3.textLightTheme }}>
                        {tx.reporterName || tx.ownerName || 'Unknown'}
                        {tx.reporterTitle && <span style={styles.muted}> ({tx.reporterTitle})</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted, marginTop: 4 }}>
                        <span>{Calc.formatQuantity(tx.transactionShares || tx.shares)} shares</span>
                        <span>{formatAmount(tx.transactionValue || tx.value)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : insiderFail || insiderRefusal ? null : (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Icon name="briefcase" size={48} color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 12 }}>No recent insider transactions</p>
                <p style={{ ...styles.muted, marginTop: 4 }}>
                  {window.Entitlement && window.Entitlement.explained && window.Entitlement.explained()
                    ? 'The insider feed did not answer for this key — see the panel above.'
                    : 'No insider transactions were reported for these holdings. The feed covers US stocks.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Earnings Tab */}
        {activeTab === 'earnings' && (
          <div style={styles.card}>
            <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, color: isDark ? C3.textDark : C3.textLightTheme }}>Earnings Calendar</h3>
            {!loading && earningsFail && React.createElement(window.RateLimitWait.FailNote, {
              what: earningsData.length ? 'The earnings of some holdings' : 'The earnings',
              failure: earningsFail, onRetry: loadEarningsCalendar, isDark, panel: 'health-earnings',
              style: { marginBottom: 12 },
            })}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <div style={{
                  width: 32,
                  height: 32,
                  border: '2px solid transparent',
                  borderTopColor: '#f97316',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto'
                }} />
                <p style={{ ...styles.muted, marginTop: 8 }}>Loading earnings data...</p>
              </div>
            ) : earningsData.length > 0 ? (
              <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {earningsData.map((earning, i) => (
                  <div key={i} style={{
                    borderBottom: i < earningsData.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` : 'none',
                    paddingBottom: 12,
                    marginBottom: 12,
                    ...(earning.isUpcoming ? {
                      background: 'rgba(249,115,22,0.05)',
                      margin: '-8px -12px 12px -12px',
                      padding: '8px 12px 12px 12px',
                      borderRadius: 8
                    } : {})
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, color: acc('#f97316') }}>{earning.symbol}</span>
                        {earning.isUpcoming && (
                          <span style={{
                            fontSize: 12,
                            background: 'rgba(249,115,22,0.2)',
                            color: acc('#f97316'),
                            padding: '2px 8px',
                            borderRadius: 4
                          }}>
                            UPCOMING
                          </span>
                        )}
                      </div>
                      <div style={styles.muted}>{formatDate(earning.date)}</div>
                    </div>
                    {!earning.isUpcoming && earning.epsActual !== null && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 8, fontSize: 12, marginTop: 8 }}>
                        <div>
                          <span style={styles.muted}>Estimate:</span>
                          <span style={{ marginLeft: 4 }}>${earning.epsEstimate?.toFixed(2) || 'N/A'}</span>
                        </div>
                        <div>
                          <span style={styles.muted}>Actual:</span>
                          <span style={{ marginLeft: 4 }}>${earning.epsActual?.toFixed(2) || 'N/A'}</span>
                        </div>
                        <div>
                          <span style={styles.muted}>Surprise:</span>
                          <span style={{
                            marginLeft: 4,
                            color: (earning.surprisePercent || 0) >= 0 ? C3.success : C3.error
                          }}>
                            {earning.surprisePercent ? `${earning.surprisePercent > 0 ? '+' : ''}${earning.surprisePercent.toFixed(1)}%` : 'N/A'}
                          </span>
                        </div>
                      </div>
                    )}
                    {earning.isUpcoming && earning.epsEstimate && (
                      <div style={{ ...styles.muted, marginTop: 4 }}>
                        Expected EPS: ${earning.epsEstimate.toFixed(2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : earningsFail ? null : (
              <div style={{ textAlign: 'center', padding: '32px 0' }}>
                <Icon name="calendar" size={48} color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 12 }}>No earnings data available</p>
                <p style={{ ...styles.muted, marginTop: 4 }}>
                  {window.Entitlement && window.Entitlement.explained && window.Entitlement.explained()
                    ? 'The earnings feed did not answer for this key — see the panel above.'
                    : 'No upcoming earnings for these holdings. The feed covers stocks and ETFs.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
