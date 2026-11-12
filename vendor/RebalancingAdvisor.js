// Rebalancing Advisor — AI-powered portfolio rebalancing suggestions
// Full-screen view with risk profile + goals → AI analysis

window.RebalancingAdvisor = ({ holdings, holdingsData, theme, onClose, onRetryPrices }) => {
  const C3 = window.C3;
  const isDark = theme === 'dark';
  // Charged as rebalance_advisor (aiService.js getRebalancingSuggestion);
  // the button said nothing of it.
  const useFeatureCost = (() => null);
  const adviceCost = useFeatureCost('rebalance_advisor');

  const [riskProfile, setRiskProfile] = React.useState('moderate');
  const [goalMode, setGoalMode] = React.useState('chips'); // 'chips' | 'text'
  const [selectedGoals, setSelectedGoals] = React.useState([]);
  const [customGoals, setCustomGoals] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const adviceGate = (window.FreeLimitWalls ? window.FreeLimitWalls.useAnalyticsGate : () => 'open')('rebalance', true);

  const Icon = ({ name, size = 24, color }) => {
    return React.createElement('svg', {
      style: { width: size, height: size, flexShrink: 0 },
      viewBox: "0 0 24 24", fill: "none",
      stroke: color || 'currentColor', strokeWidth: "2",
      strokeLinecap: "round", strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  const riskProfiles = [
    { id: 'conservative', label: 'Conservative', icon: 'shield', desc: 'Low risk, steady returns' },
    { id: 'moderate', label: 'Moderate', icon: 'scale', desc: 'Balanced risk/reward' },
    { id: 'aggressive', label: 'Aggressive', icon: 'rocket', desc: 'High risk, high reward' },
  ];

  const goalOptions = [
    { id: 'growth', label: 'Growth', icon: 'trendUp' },
    { id: 'income', label: 'Income', icon: 'dollarSign' },
    { id: 'preservation', label: 'Preservation', icon: 'lock' },
    { id: 'balanced', label: 'Balanced', icon: 'target' },
  ];

  const toggleGoal = (goalId) => {
    setSelectedGoals(prev =>
      prev.includes(goalId) ? prev.filter(g => g !== goalId) : [...prev, goalId]
    );
    window.Haptics?.light();
  };

  const getGoalsString = () => {
    if (goalMode === 'text' && customGoals.trim()) {
      return customGoals.trim();
    }
    if (selectedGoals.length > 0) {
      return selectedGoals.join(', ');
    }
    return 'balanced';
  };

  const handleAnalyze = async () => {
    if (adviceGate !== 'open') return;
    setLoading(true);
    setError(null);
    setResult(null);
    window.Haptics?.medium();

    try {
      const goals = getGoalsString();
      const response = await window.AIService.getRebalancingSuggestion(
        holdings, holdingsData, riskProfile, goals
      );
      setResult(response);
    } catch (err) {
      if (err.message === 'AI_TOKENS_REQUIRED') {
        setError('AI analysis is off. Add OPENAI_API_KEY to .env and restart to enable it.');
      } else {
        setError(err.message || 'Failed to generate rebalancing advice');
      }
    } finally {
      setLoading(false);
    }
  };

  // Portfolio summary for display
  const portfolioSummary = React.useMemo(() => {
    let totalValue = 0;
    let count = 0;
    const types = {};
    (holdings || []).forEach(h => {
      const data = holdingsData?.[h.id];
      const value = data?.currentValue || 0;
      totalValue += value;
      count++;
      const t = h.type || 'stock';
      types[t] = (types[t] || 0) + value;
    });
    const currency = (Object.values(holdingsData || {}).find(d => d && d.baseCurrency) || {}).baseCurrency || 'USD';
    // Shares held and no price for any of them: the value is unknown. It
    // read "$0" with every asset type at 0%.
    const rows = (holdings || []).map(h => holdingsData?.[h.id]).filter(Boolean);
    const needsPrices = rows.some(d => d.priceUnavailable && Number(d.quantity) > 0) && !(totalValue > 0);
    // Why none came, when that is known: a currency rate that did not load,
    // the quotes' failure.
    const PC = window.PortfolioCalculations;
    // Some held, not all: the total leaves them out, and says why too.
    const why = PC && PC.unpricedWhy ? PC.unpricedWhy(rows, currency) : '';
    return { totalValue, count, types, currency, needsPrices, why };
  }, [holdings, holdingsData]);

  // Target weights a template or an AI build left in each position's note
  // ("target weight: 33.3%"). The adopt hint said they were kept for
  // Rebalance, and the advisor showed none: they are
  // listed here, beside the current weight once there are shares.
  const targets = React.useMemo(() => {
    const total = portfolioSummary.totalValue;
    return (holdings || []).map(h => {
      const m = String(h && h.notes || '').match(/target weight:\s*([\d.]+)%/i);
      const t = m ? parseFloat(m[1]) : NaN;
      if (!Number.isFinite(t)) return null;
      const v = Number(holdingsData?.[h.id]?.currentValue) || 0;
      return { id: h.id, code: String(h.symbol || h.name || '').split('.')[0], name: h.name, target: t, current: total > 0 ? v / total * 100 : null };
    }).filter(Boolean);
  }, [holdings, holdingsData, portfolioSummary.totalValue]);

  // Picked in the accent. Its 1 px border plus a pixel
  // more padding take the room of the 2 px border it had, so a picked chip
  // keeps its size.
  const chipStyle = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: active ? '9px 15px' : '8px 14px',
    borderRadius: 20,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    color: isDark ? C3.textDark : C3.textLightTheme,
    ...window.ToggleStyle.value(active, isDark, { bordered: true }),
    fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer',
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: isDark ? C3.bgGradientDark : C3.bgGradientLight,
      display: 'flex', flexDirection: 'column',
      color: isDark ? C3.textDark : C3.textLightTheme,
    }}>
      {window.ModalLayer && <window.ModalLayer.Hold />}
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
      }}>
        <button aria-label="Back"
          onClick={() => { window.Haptics?.light(); onClose?.(); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: isDark ? C3.textDark : C3.textLightTheme,
          }}
        >
          <Icon name="chevronLeft" size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>Rebalancing Advisor</div>
          <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Suggest portfolio rebalancing</div>
        </div>
        <div style={{
          fontSize: 9, fontWeight: 700,
          padding: '3px 8px', borderRadius: 6,
          background: C3.logoGradient, color: 'white',
        }}>AI</div>
      </div>

      {/* Scrollable Content */}
      <div style={{
        flex: 1, overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: 16,
      }}>
        {/* Portfolio Summary Mini Card */}
        <div style={{
          ...(isDark ? C3.glassDark : C3.glassLight),
          borderRadius: 14, padding: 14, marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Current Portfolio
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {/* In the portfolio's currency, not a hard-coded "$". */}
                {portfolioSummary.needsPrices ? 'N/A' : window.PortfolioCalculations
                  ? window.PortfolioCalculations.formatCurrency(portfolioSummary.totalValue, portfolioSummary.currency, 0)
                  : '$' + portfolioSummary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                {portfolioSummary.count} holding{portfolioSummary.count !== 1 ? 's' : ''}
              </div>
              {portfolioSummary.needsPrices && (
                <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                  Needs current prices — none came back for these positions.{portfolioSummary.why ? ' ' + portfolioSummary.why : ''}
                  {onRetryPrices && (
                    <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer' }} />
                  )}
                </div>
              )}
              {!portfolioSummary.needsPrices && portfolioSummary.why && (
                <div data-unpriced-why="true" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                  <span role="status">{portfolioSummary.why} The total leaves out the positions without a value.</span>
                  {onRetryPrices && (
                    <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer' }} />
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 160 }}>
              {!portfolioSummary.needsPrices && Object.entries(portfolioSummary.types).map(([type, value]) => (
                <span key={type} style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 8,
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                  whiteSpace: 'nowrap',
                }}>
                  {/* "ETFs 100%", not the stored code "etf 100%";
                      the Performance tab's names. */}
                  {({ stock: 'Stocks', etf: 'ETFs', fund: 'Funds', crypto: 'Crypto', forex: 'Forex', bond: 'Bonds', manual: 'Manual' })[type] || type} {portfolioSummary.totalValue > 0
                    ? Math.round((value / portfolioSummary.totalValue) * 100)
                    : 0}%
                </span>
              ))}
            </div>
          </div>
        </div>

        {targets.length > 0 && (
          <div data-target-weights="true" style={{
            ...(isDark ? C3.glassDark : C3.glassLight),
            borderRadius: 14, padding: 14, marginBottom: 16,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Target weights</div>
            <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 10, lineHeight: 1.5 }}>
              {portfolioSummary.totalValue > 0
                ? 'From the template this portfolio was made from. The advice below measures the drift from them.'
                : 'From the template this portfolio was made from. Enter your purchases to see how far each position is from its target.'}
            </div>
            {targets.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`, fontSize: 13 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong>{t.code}</strong>{t.name && t.name.toUpperCase() !== t.code.toUpperCase() ? <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}> {t.name}</span> : null}
                </span>
                <span style={{ whiteSpace: 'nowrap', fontFamily: "'Roboto Mono', monospace" }}>
                  {t.target.toFixed(1)}%{t.current != null ? <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}> · now {t.current.toFixed(1)}%</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Risk Profile */}
        <div style={{
          ...(isDark ? C3.glassDark : C3.glassLight),
          borderRadius: 14, padding: 16, marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Risk Profile</div>
          <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 12 }}>
            How much risk are you comfortable with?
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {riskProfiles.map(rp => (
              <button
                key={rp.id}
                onClick={() => { setRiskProfile(rp.id); window.Haptics?.light(); }}
                style={{
                  ...chipStyle(riskProfile === rp.id),
                  flexDirection: 'column', alignItems: 'center',
                  padding: riskProfile === rp.id ? '11px 17px' : '10px 16px', flex: '1 1 0',
                  minWidth: 0,
                }}
              >
                <Icon name={rp.icon} size={18} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{rp.label}</span>
                {/* The muted colour, not opacity: at 0.5 the line read 4.11:1
                    on the dark chip. */}
                <span style={{
                  fontSize: 10, textAlign: 'center',
                  color: riskProfile === rp.id ? 'inherit' : (isDark ? C3.textMutedDark : C3.textMutedLight),
                }}>{rp.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Goals */}
        <div style={{
          ...(isDark ? C3.glassDark : C3.glassLight),
          borderRadius: 14, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Investment Goals</div>
            <button
              onClick={() => setGoalMode(goalMode === 'chips' ? 'text' : 'chips')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
                color: isDark ? C3.textMutedDark : C3.textMutedLight,
              }}
            >
              {goalMode === 'chips' ? 'Custom text' : 'Quick select'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 12 }}>
            {goalMode === 'chips' ? 'Select one or more goals' : 'Describe your goals in your own words'}
          </div>

          {goalMode === 'chips' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {goalOptions.map(go => (
                <button
                  key={go.id}
                  onClick={() => toggleGoal(go.id)}
                  style={chipStyle(selectedGoals.includes(go.id))}
                >
                  <Icon name={go.icon} size={16} />
                  <span>{go.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <textarea
              value={customGoals}
              onChange={e => setCustomGoals(e.target.value)}
              placeholder="e.g. retire in 15 years, dividend income, less tech"
              style={{
                width: '100%', minHeight: 80,
                padding: 12, borderRadius: 10,
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
                background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                color: isDark ? C3.textDark : C3.textLightTheme,
                fontSize: 13, lineHeight: 1.5,
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>

        {/* Analyze Button */}
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
          <window.AIFeatureButton
            label={adviceCost ? `Get Rebalancing Advice · ${adviceCost}` : 'Get Rebalancing Advice'}
            icon="scale"
            onClick={handleAnalyze}
            loading={loading}
            disabled={adviceGate !== 'open' || undefined}
            isDark={isDark}
            style={{ width: '100%', justifyContent: 'center', padding: '14px 20px', fontSize: 15 }}
          />
        </div>
        {adviceGate === 'wall' && window.FreeLimitWalls && window.PlanNotice && window.PlanNotice.RefusalCard
          && React.createElement(window.PlanNotice.RefusalCard, { refusal: window.FreeLimitWalls.analyticsRefusal('rebalance'), isDark })}

        {/* Error */}
        {error && (
          <div style={{
            padding: 12, borderRadius: 12, marginBottom: 16,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: C3.error,
            fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Icon name="alertTriangle" size={16} color={C3.error} />
            <span>{error}</span>
          </div>
        )}

        {/* Result */}
        {result && (
          <window.AIResultCard
            content={result}
            title="Rebalancing Suggestion"
            isDark={isDark}
            onDismiss={() => setResult(null)}
          />
        )}

        {/* Bottom spacing for safe area */}
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
};
