// Portfolio Tracker - Macro Dashboard Component (Concept 3 Glassmorphism Design)
// `pricesWhy`: why no position has a value, when the prices failed (the
// shared words, Calc.unpricedWhy), else empty. `pricesLeftOut`: the held
// positions without a value, by ticker and why (Calc.unpricedLine).
window.MacroDashboardView = ({ portfolioId, apiKey, baseCurrency, totalValue, totalReturn, annualReturn, onClose, theme, onRetryPrices, pricesWhy, pricesLeftOut }) => {
  const [macroData, setMacroData] = React.useState(null);
  const [treasuryRates, setTreasuryRates] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const Calc = window.PortfolioCalculations;
  const isDark = theme === 'dark';
  // Light theme: darker inks. The amber "2.9%" was 1.61:1 on white.
  const C3 = Calc.themeInk(window.C3, isDark);
  const acc = (hex) => Calc.accent(hex, isDark);

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

  const isWeb = window.APP_PLATFORM === 'WEB';
  const styles = {
    container: {
      height: isWeb ? 'auto' : '100vh',
      paddingBottom: isWeb ? 20 : 80,
      background: isWeb ? 'transparent' : (isDark ? C3.bgGradientDark : C3.bgGradientLight),
      color: isDark ? C3.textDark : C3.textLightTheme,
      position: isWeb ? 'static' : 'relative',
      overflowY: isWeb ? 'visible' : 'auto',
      boxSizing: 'border-box'
    },
    header: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      position: 'sticky',
      top: 0,
      zIndex: 40,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    },
    card: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      color: isDark ? C3.textDark : C3.textLightTheme
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
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    statBox: {
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      borderRadius: 12,
      padding: 12,
      textAlign: 'center',
      color: isDark ? C3.textDark : C3.textLightTheme
    }
  };

  // A load that did not come back is said, with the reason: at 429 every
  // figure read N/A, nothing named the limit, there was no button, and the
  // figures came only after the tab was left and opened again. `loadFail`: the failure (RateLimitWait.failure) and how
  // many figures it took, null when all came back; `missed`: the figures
  // that did not come back and have nothing older to show -- "did not
  // load", not N/A. A refresh that fails keeps the figures already shown.
  const RLW = window.RateLimitWait;
  const [loadFail, setLoadFail] = React.useState(null);
  const [missed, setMissed] = React.useState({});
  const loadSeqRef = React.useRef(0);
  const shownRef = React.useRef({ macro: null, rates: null });
  shownRef.current = { macro: macroData, rates: treasuryRates };

  React.useEffect(() => { loadMacroData(); }, []);

  // A Try again that worked takes its button away, and the focus fell to
  // <body> (the class of News). A retry -- the press, or
  // the reload after a 429 wait -- made while the focus was in this panel
  // puts it back when the load is over: on the Try again if the failure is
  // back, else on the first heading. Focus elsewhere on the page is left.
  const panelRef = React.useRef(null);
  const retryFocusRef = React.useRef(false);
  const [loadsDone, setLoadsDone] = React.useState(0);
  const retryMacro = () => {
    const a = document.activeElement;
    if (a && a !== document.body && panelRef.current && panelRef.current.contains(a)) retryFocusRef.current = true;
    return loadMacroData();
  };
  React.useEffect(() => {
    if (!retryFocusRef.current || loading) return;
    retryFocusRef.current = false;
    const a = document.activeElement;
    if (a && a !== document.body && document.contains(a)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const again = panel.querySelector('[data-rl-fail] button');
    const target = again || panel.querySelector('h1, h2, h3');
    if (!target) return;
    if (target !== again && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  }, [loadsDone, loading]);

  const MACRO_KEYS = ['inflation', 'gdpGrowth', 'unemployment', 'fedRate'];
  const RATE_KEYS = ['us2y', 'us5y', 'us10y', 'us30y'];
  const loadMacroData = async () => {
    const seq = ++loadSeqRef.current;
    // The spinner only before anything is on screen: a refresh keeps it.
    if (!shownRef.current.macro) setLoading(true);
    setError(null);
    try {
      const [inflationData, gdpData, unemploymentData, fedRateData] = await Promise.all([
        fetchMacroIndicator('inflation_consumer_prices_annual', 'USA'),
        fetchMacroIndicator('gdp_growth_annual', 'USA'),
        // Both of these were wrong and answered 404 "Indicator or Country are
        // Not Found". EODHD's names for them are below; checked one at a time
        // against the live endpoint.
        fetchMacroIndicator('unemployment_total_percent', 'USA'),
        fetchMacroIndicator('real_interest_rate', 'USA')
      ]);
      const [us2y, us5y, us10y, us30y] = await Promise.all([
        fetchTreasury('US2Y.GBOND'),
        fetchTreasury('US5Y.GBOND'),
        fetchTreasury('US10Y.GBOND'),
        fetchTreasury('US30Y.GBOND')
      ]);
      if (seq !== loadSeqRef.current) return;
      const got = { inflation: inflationData, gdpGrowth: gdpData, unemployment: unemploymentData, fedRate: fedRateData };
      const rates = { us2y, us5y, us10y, us30y };
      const before = shownRef.current;
      const next = { asOf: {} };
      const nowMissed = {};
      const fails = [];
      MACRO_KEYS.forEach((k) => {
        if (got[k].failed) {
          fails.push(got[k].failed);
          // What was on screen stays; with nothing there it "did not load".
          next[k] = before.macro ? before.macro[k] : null;
          next.asOf[k] = before.macro && before.macro.asOf ? before.macro.asOf[k] : null;
          if (next[k] == null) nowMissed[k] = true;
          return;
        }
        const latest = getLatest(got[k].data);
        next[k] = latest.value;
        // These are annual World Bank series and usually a year or two
        // behind; the dates go on screen so a 2024 figure is not read as
        // today's.
        next.asOf[k] = latest.date;
      });
      const nextRates = {};
      RATE_KEYS.forEach((k) => {
        if (rates[k].failed) {
          fails.push(rates[k].failed);
          nextRates[k] = before.rates ? before.rates[k] : null;
          if (nextRates[k] == null) nowMissed[k] = true;
          return;
        }
        nextRates[k] = rates[k].value;
      });
      // Null, not invented numbers. This used to fall back to inflation 3.2,
      // GDP 2.1, unemployment 3.7, a Fed rate of 5.25 and four treasury
      // yields, rendered in the same type and colour as measured values with
      // commentary generated from them -- a plausible fabrication with
      // nothing on screen to say it was not real.
      setMacroData(next);
      setTreasuryRates(nextRates);
      setMissed(nowMissed);
      // The limit, when it was why any of them failed.
      const why = fails.find(f => f.limited) || fails[0] || null;
      setLoadFail(why ? { ...why, count: fails.length, of: MACRO_KEYS.length + RATE_KEYS.length } : null);
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      setError('Failed to load economic data');
      setLoadFail({ ...RLW.failure(e), count: MACRO_KEYS.length + RATE_KEYS.length, of: MACRO_KEYS.length + RATE_KEYS.length });
      if (!shownRef.current.macro) {
        setMacroData({ inflation: null, gdpGrowth: null, unemployment: null, fedRate: null, asOf: {} });
        setTreasuryRates({ us2y: null, us5y: null, us10y: null, us30y: null });
        setMissed({ inflation: true, gdpGrowth: true, unemployment: true, fedRate: true, us2y: true, us5y: true, us10y: true, us30y: true });
      }
    }
    setLoading(false);
    if (seq === loadSeqRef.current) setLoadsDone((n) => n + 1);
  };

  // { data } or { failed }: a request that did not come back (refused, the
  // limit, EODHD's error, no connection) is not an indicator with no
  // observations ([]). Asked with throwErrors, so the failure carries its
  // status: failure(null) read a 500 as "EODHD did not answer, or the
  // connection dropped" while Risk and Correlation said "answered with an
  // error (500)".
  const fetchMacroIndicator = async (indicator, country) => {
    try {
      const data = await window.EODHD_API.getMacroIndicator(apiKey, country, indicator, { throwErrors: true });
      return data == null ? { failed: RLW.failure(null) } : { data };
    } catch (e) { return { failed: RLW.failure(e) }; }
  };

  // { value } (null when the quote has no yield in it) or { failed }.
  const fetchTreasury = async (symbol) => {
    try {
      // The fundamentals endpoint answers 422 "Invalid parameters" for a
      // .GBOND symbol -- all four of them, on every load. The yield is on the
      // real-time quote: close, or previousClose when the market is shut and
      // close comes back as the string "NA".
      // throwErrors: a failure with its status, as above.
      const quote = await window.EODHD_API.getRealTimeData(apiKey, symbol, { throwErrors: true });
      if (quote == null) return { failed: RLW.failure(null) };
      const last = parseFloat(quote.close);
      if (Number.isFinite(last)) return { value: last };
      const prev = parseFloat(quote.previousClose);
      return { value: Number.isFinite(prev) ? prev : null };
    } catch (e) { return { failed: RLW.failure(e) }; }
  };
  // A figure with no value reads N/A either way, as Current Value reads elsewhere: the reason -- the
  // limit with its countdown, EODHD's error, no answer -- is the line at
  // the top, and "did not load" under the figure (accepted
  // a refused yield reads N/A).
  const noValue = () => 'N/A';
  const missedCaption = (key) => missed[key] && (
    <div data-macro-missed={key} style={{ fontSize: 10, marginTop: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>did not load</div>
  );

  // The newest observation with a number in it, and its date. A 0.0 reading
  // is a value (it used to be dropped by `|| null`); a blank one is skipped.
  const getLatest = (data) => {
    if (!data || !Array.isArray(data) || data.length === 0) return { value: null, date: null };
    const sorted = [...data].sort((a, b) => new Date(b.Date || b.date) - new Date(a.Date || a.date));
    for (const row of sorted) {
      const v = parseFloat(row?.Value ?? row?.value);
      if (Number.isFinite(v)) return { value: v, date: String(row.Date || row.date || '') || null };
    }
    return { value: null, date: null };
  };
  // World Bank annual series: the newest year EODHD has is usually one or
  // two behind (US CPI: 2024, checked 19.10.2026). "(2024)" alone read as a
  // stale screen; it says the year is the latest out.
  const asOfLabel = (key) => {
    const d = macroData?.asOf?.[key];
    return d ? `${d.slice(0, 4)}, latest annual figure` : null;
  };

  /**
   * An annual rate, because everything it is compared with is annual.
   *
   * `totalReturn` is the return since the first purchase. It was fed straight
   * into the Fisher equation against annual inflation, and subtracted from
   * the ten-year Treasury yield as a "risk premium", under the words
   * "% per year" -- so +100% over five years was announced as
   * "growing purchasing power at 100.00% per year".
   *
   * Under three months there is no meaningful annual rate to state: raising a
   * two-week move to the twenty-sixth power is arithmetic, not information.
   * The card then says so and the two comparisons are withheld.
   */
  const holdingDays = React.useMemo(() => {
    try {
      const txs = window.PortfolioStorage.getTransactionsByPortfolio(portfolioId) || [];
      const first = txs.map(t => t.date).filter(Boolean).sort()[0];
      if (!first) return null;
      const days = Math.floor((Date.now() - new Date(first + 'T00:00:00Z').getTime()) / 86400000);
      return days > 0 ? days : null;
    } catch (e) { return null; }
  }, [portfolioId]);

  // The header's Total Return (realized + unrealized over everything paid
  // in). Null when no position can be valued: then there is nothing to
  // annualise, rather than a 0% that reads as measured.
  //
  // The annual rate is the money-weighted one (IRR) when the tracker passes
  // it. Raising the total return over every dollar paid in to the power of
  // 1/years treats money added last month as if it had been there since the
  // first trade: one SPY share in 2021 and ten in September 2026 read
  // "+0.89% a year, losing purchasing power" for a 12% IRR. The compounding of the total remains the fallback for a
  // caller that has no IRR.
  const cumulativeReturn = Number.isFinite(totalReturn) ? totalReturn : 0;
  const annualisable = Number.isFinite(totalReturn) && holdingDays != null && holdingDays >= 90;
  const moneyWeighted = Number.isFinite(annualReturn);
  const nominalReturn = !annualisable
    ? null
    : moneyWeighted
      ? annualReturn
      : (Math.pow(1 + cumulativeReturn / 100, 365 / holdingDays) - 1) * 100;
  const inflation = macroData?.inflation || 0;
  // No inflation figure is no real return (not one deflated by 0%).
  const realReturn = nominalReturn == null || macroData?.inflation == null ? null : Calc.getRealReturn(nominalReturn, inflation);
  // No yield is no premium: with the quote refused this read "10Y Treasury
  // 0.00%" and a premium over a rate of nothing.
  const riskFreeKnown = Number.isFinite(treasuryRates?.us10y);
  // Gain and loss on the peach card, light theme: where a narrow screen puts
  // a figure on the card's deepest tint, green read 4.09:1. Taken to AA on
  // that tint (its 20% orange over the page's darkest ground), no further.
  // The card is an orange wash: in dark it is ~#482c14 under the text, and
  // the plain red read 4.14:1 there; both themes are lifted to
  // text contrast against the wash itself.
  const peachInk = (c) => (isDark ? Calc.ink(c, true, '#482c14') : Calc.ink(c, false, '#e7ccb5'));
  const riskFreeRate = riskFreeKnown ? treasuryRates.us10y : 0;
  const riskPremium = nominalReturn == null || !riskFreeKnown ? null : nominalReturn - riskFreeRate;
  const periodLabel = holdingDays == null
    ? 'no transactions yet'
    // Prices that failed are named, with why: "no priced positions" read as
    // a book with nothing to price under a quote feed at 500. Said so only when none is known.
    : !Number.isFinite(totalReturn)
      ? (pricesWhy ? String(pricesWhy).charAt(0).toLowerCase() + String(pricesWhy).slice(1).replace(/\.$/, '') : 'no priced positions to measure')
    : holdingDays < 90
      ? `held ${holdingDays} days — too short to state an annual rate`
      : moneyWeighted
        ? `money-weighted (IRR) over ${(holdingDays / 365).toFixed(1)} years`
        : `annualised over ${(holdingDays / 365).toFixed(1)} years`;

  return (
    <div ref={panelRef} style={styles.container}>
      {/* Glow Effects — TG only */}

      {/* Header — TG only (web renders inline) */}
      {!isWeb && (
      <div style={styles.header}>
        <button aria-label="Back" onClick={onClose} style={styles.iconButton}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Macro Dashboard</h1>
          <p style={{ fontSize: 12, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Economic Context for Your Portfolio</p>
        </div>
      </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 256 }}>
          <div style={{ width: 40, height: 40, border: '3px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <div style={{ padding: 16 }}>
          {loadFail && (
            <RLW.FailNote panel="macro" ownFail="macro" ownFocus
              what={loadFail.count >= loadFail.of ? 'The economic data' : `${loadFail.count} of ${loadFail.of} figures`}
              failure={loadFail} onRetry={retryMacro} isDark={isDark}
              style={{ marginBottom: 16, padding: '10px 12px', borderRadius: 12, border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, background: isDark ? C3.fillDark : C3.fillLight }}
              buttonStyle={{ fontFamily: "'Sora', sans-serif" }} />
          )}
          {/* Real Return Card */}
          <div style={{ background: isDark ? C3.fillDark : C3.fillLight, border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, color: acc('#fdba74'), marginBottom: 12, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="trendUp" size={16} color="#fdba74" />
              Real Return (Inflation-Adjusted)
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(84px, calc(50% - 6px)), 1fr))', gap: 12, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Nominal (annual)</div>
                <div style={{ fontSize: 'clamp(15px, 4.6vw, 20px)', overflowWrap: 'anywhere', fontWeight: 700, color: nominalReturn == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : peachInk(nominalReturn >= 0 ? C3.success : C3.error) }}>{nominalReturn == null ? 'N/A' : Calc.formatPercent(nominalReturn)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Inflation{asOfLabel('inflation') ? ` (${macroData.asOf.inflation.slice(0, 4)}, latest annual)` : ''}</div>
                {/* The rate itself. "-2.9%" read as deflation; it is subtracted in the Real column, not here. */}
                <div style={{ fontSize: 'clamp(15px, 4.6vw, 20px)', overflowWrap: 'anywhere', fontWeight: 700, color: C3.warning }}>{macroData?.inflation == null ? noValue('inflation') : `${inflation.toFixed(1)}%`}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Real</div>
                <div style={{ fontSize: 'clamp(15px, 4.6vw, 20px)', overflowWrap: 'anywhere', fontWeight: 700, color: realReturn == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : peachInk(realReturn >= 0 ? C3.success : C3.error) }}>{realReturn == null ? 'N/A' : Calc.formatPercent(realReturn)}</div>
              </div>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(249,115,22,0.2)', fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              {realReturn == null
                ? (nominalReturn != null && macroData?.inflation == null
                  ? 'Real return needs an inflation figure, and none could be loaded.'
                  : <>{'Real return needs an annual rate — ' + periodLabel + '.'}{onRetryPrices && !Number.isFinite(totalReturn) && holdingDays != null && (
                    <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />
                  )}</>)
                : `Your portfolio ${realReturn >= 0 ? 'is growing' : 'is losing'} purchasing power at ${Math.abs(realReturn).toFixed(2)}% per year (${periodLabel}; ${cumulativeReturn >= 0 ? '+' : ''}${cumulativeReturn.toFixed(2)}% in total)`}
            </div>
            {/* Some positions valued, some not for a failed request: the
                return is of the valued ones, and says why the rest are not
                in it, with Try again. */}
            {Number.isFinite(totalReturn) && (pricesLeftOut || pricesWhy) && (
              <div data-unpriced-why="true" data-own-fail="quotes" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                <span role="status">{pricesLeftOut || pricesWhy} The return leaves out the positions without a value.</span>
                {onRetryPrices && (
                  <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />
                )}
              </div>
            )}
          </div>

          {/* vs Risk-Free Rate */}
          <div style={styles.card}>
            <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, color: isDark ? C3.textDark : C3.textLightTheme }}>
              <Icon name="dollar" size={16} color="#3b82f6" />
              vs Risk-Free Rate
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, max(112px, calc((100% - 16px) / 2))), 1fr))', gap: 16, marginBottom: 16 }}>
              <div style={styles.statBox}>
                <div style={{ fontSize: 12, marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Your Return (annual)</div>
                <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', whiteSpace: 'nowrap', fontWeight: 700, color: nominalReturn == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : nominalReturn >= 0 ? C3.success : C3.error }}>{nominalReturn == null ? 'N/A' : Calc.formatPercent(nominalReturn)}</div>
              </div>
              <div style={styles.statBox}>
                <div style={{ fontSize: 12, marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>10Y Treasury</div>
                <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', whiteSpace: 'nowrap', fontWeight: 700, color: riskFreeKnown ? acc('#3b82f6') : (isDark ? C3.textMutedDark : C3.textMutedLight) }}>{riskFreeKnown ? `${riskFreeRate.toFixed(2)}%` : noValue('us10y')}</div>
              </div>
            </div>
            <div style={{ ...styles.statBox, background: riskPremium == null ? 'rgba(255,255,255,0.04)' : riskPremium >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Risk Premium</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: riskPremium == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : riskPremium >= 0 ? C3.success : C3.error }}>{riskPremium == null ? 'N/A' : (riskPremium >= 0 ? '+' : '') + riskPremium.toFixed(2) + '%'}</div>
              <div style={{ fontSize: 12, marginTop: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                {riskPremium == null ? (nominalReturn != null && !riskFreeKnown ? 'Risk premium needs the 10-year Treasury yield, and none could be loaded.' : periodLabel) : riskPremium >= 0 ? 'You are earning more than risk-free bonds' : 'Risk-free bonds would have performed better'}
              </div>
            </div>
          </div>

          {/* Treasury Yield Curve */}
          <div style={styles.card}>
            <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, color: isDark ? C3.textDark : C3.textLightTheme }}>US Treasury Yield Curve</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(84px, calc(50% - 4px)), 1fr))', gap: 8 }}>
              {[
                { key: 'us2y', label: '2Y', value: treasuryRates?.us2y },
                { key: 'us5y', label: '5Y', value: treasuryRates?.us5y },
                { key: 'us10y', label: '10Y', value: treasuryRates?.us10y },
                { key: 'us30y', label: '30Y', value: treasuryRates?.us30y }
              ].map(t => (
                <div key={t.label} style={styles.statBox}>
                  <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{t.label}</div>
                  <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', overflowWrap: 'anywhere', fontWeight: 700, color: acc('#3b82f6') }}>{Number.isFinite(t.value) ? `${t.value.toFixed(2)}%` : noValue(t.key)}</div>
                  {missedCaption(t.key)}
                </div>
              ))}
            </div>
            {treasuryRates?.us2y > treasuryRates?.us10y && (
              <div style={{ marginTop: 12, padding: 8, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 8, fontSize: 12, color: C3.warning }}>
                Inverted yield curve - historically a recession indicator
              </div>
            )}
          </div>

          {/* Economic Indicators */}
          <div style={styles.card}>
            <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0, color: isDark ? C3.textDark : C3.textLightTheme }}>Economic Indicators (USA)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, max(112px, calc((100% - 12px) / 2))), 1fr))', gap: 12 }}>
              <div style={styles.statBox}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Inflation (CPI)</span>
                  <Icon name="trendUp" size={12} color={C3.warning} />
                </div>
                <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', whiteSpace: 'nowrap', fontWeight: 700, color: C3.warning }}>{macroData?.inflation != null ? `${macroData.inflation.toFixed(1)}%` : noValue('inflation')}</div>
                {asOfLabel('inflation') && <div style={{ fontSize: 10, marginTop: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{asOfLabel('inflation')}</div>}
                {missedCaption('inflation')}
              </div>
              <div style={styles.statBox}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>GDP Growth</span>
                  <Icon name="activity" size={12} color={C3.success} />
                </div>
                <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', whiteSpace: 'nowrap', fontWeight: 700, color: (macroData?.gdpGrowth || 0) >= 0 ? C3.success : C3.error }}>{macroData?.gdpGrowth != null ? `${macroData.gdpGrowth.toFixed(1)}%` : noValue('gdpGrowth')}</div>
                {asOfLabel('gdpGrowth') && <div style={{ fontSize: 10, marginTop: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{asOfLabel('gdpGrowth')}</div>}
                {missedCaption('gdpGrowth')}
              </div>
              <div style={styles.statBox}>
                {/* One long word: at 320 px it ran out of the tile and pushed
                    its icon onto the next one. The soft
                    hyphens (\u00AD) show only where the word has to break. */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, minWidth: 0, overflowWrap: 'anywhere', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{'Un\u00ADem\u00ADploy\u00ADment'}</span>
                  <Icon name="briefcase" size={12} color="#3b82f6" />
                </div>
                <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', whiteSpace: 'nowrap', fontWeight: 700, color: acc('#3b82f6') }}>{macroData?.unemployment != null ? `${macroData.unemployment.toFixed(1)}%` : noValue('unemployment')}</div>
                {asOfLabel('unemployment') && <div style={{ fontSize: 10, marginTop: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{asOfLabel('unemployment')}</div>}
                {missedCaption('unemployment')}
              </div>
              <div style={styles.statBox}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Real Interest Rate</span>
                  <Icon name="dollar" size={12} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                </div>
                <div style={{ fontSize: 'clamp(14px, 4.4vw, 18px)', whiteSpace: 'nowrap', fontWeight: 700, color: isDark ? C3.textDark : C3.textLightTheme }}>{macroData?.fedRate != null ? `${macroData.fedRate.toFixed(2)}%` : noValue('fedRate')}</div>
                {asOfLabel('fedRate') && <div style={{ fontSize: 10, marginTop: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{asOfLabel('fedRate')}</div>}
                {missedCaption('fedRate')}
              </div>
            </div>
          </div>

          {/* Investment Context */}
          <div style={{ background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 12, padding: 16 }}>
            <h4 style={{ fontWeight: 600, marginBottom: 8, marginTop: 0, fontSize: 14, color: isDark ? C3.textDark : C3.textLightTheme }}>Market Context</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              {macroData?.fedRate > 4 && <p style={{ margin: 0 }}>• <span style={{ color: C3.warning }}>High interest rates</span> - bonds more attractive, growth stocks pressured</p>}
              {macroData?.inflation > 3 && <p style={{ margin: 0 }}>• <span style={{ color: C3.error }}>Elevated inflation</span> - consider inflation-protected assets</p>}
              {macroData?.gdpGrowth != null && macroData.gdpGrowth < 1 && <p style={{ margin: 0 }}>• <span style={{ color: C3.warning }}>Slow economic growth</span> - defensive sectors may outperform</p>}
              {realReturn != null && realReturn < 0 && <p style={{ margin: 0 }}>• <span style={{ color: C3.error }}>Negative real return</span> - your portfolio is losing purchasing power</p>}
              {riskPremium != null && riskPremium < 0 && <p style={{ margin: 0 }}>• <span style={{ color: acc('#3b82f6') }}>Risk premium is negative</span> - consider rebalancing</p>}
              {macroData?.inflation == null && macroData?.gdpGrowth == null && macroData?.fedRate == null && !riskFreeKnown && <p style={{ margin: 0 }}>Market context needs the economic indicators and Treasury yields, and none could be loaded.</p>}
              {realReturn > 5 && riskPremium > 3 && <p style={{ margin: 0 }}>• <span style={{ color: C3.success }}>Strong performance</span> - beating both inflation and risk-free rate</p>}
            </div>
          </div>

          {/* Data Note */}
          <div style={{ fontSize: 12, textAlign: 'center', marginTop: 16, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            Economic indicators: latest annual figure published (year shown). Treasury yields: latest quote. Data from EODHD Macro & Bond APIs.
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
