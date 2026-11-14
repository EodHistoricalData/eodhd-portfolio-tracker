// Tax View — Full-screen tax optimization view
// FIFO/LIFO/AvgCost comparison, capital gains, harvesting, wash sales, CSV export
window.TaxView = function TaxView({ portfolioId, holdings, holdingsData, baseCurrency, onClose, theme, onRetryPrices }) {
  const [method, setMethod] = React.useState('fifo');
  // Null until chosen: then the latest year with a sale in it (see below).
  const [chosenYear, setTaxYear] = React.useState(null);
  const [showExport, setShowExport] = React.useState(false);

  const Storage = window.PortfolioStorage;
  const Tax = window.TaxOptimizer;
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

  // Gather all transactions from all holdings.
  //
  // Transactions live in storage under the holding's id; the holding object
  // itself never carries them. This read `h.transactions`, which is always
  // undefined, so the tab showed "Add transactions to your portfolio" over a
  // portfolio full of them.
  const allTransactions = React.useMemo(() => {
    const txs = [];
    (holdings || []).forEach(h => {
      // The optimizer groups lots by symbol. A manual asset has none, and two
      // of them tagged null would share one FIFO queue -- so the name stands
      // in, and the id behind that.
      const key = h.symbol || h.name || h.id;
      Storage.getTransactionsByHolding(h.id).forEach(t => {
        txs.push({ ...t, symbol: key });
      });
    });
    return txs;
  }, [holdings]);

  // Years with a sale in them, and this one. The list was a fixed
  // 2024-2026 and only the CSV honoured it; the comparison and the
  // breakdown below now show the selected year too.
  const taxYears = React.useMemo(() => {
    const ys = new Set([new Date().getFullYear()]);
    allTransactions.forEach(t => { if (t.type === 'sell' && /^\d{4}/.test(String(t.date || ''))) ys.add(parseInt(String(t.date).slice(0, 4), 10)); });
    return [...ys].sort((a, b) => b - a);
  }, [allTransactions]);
  // This year when it has a sale, else the most recent year that does: a
  // tab opening on a year with nothing sold reads as "no gains" to someone
  // whose sales were all last year.
  const taxYear = React.useMemo(() => {
    if (chosenYear) return chosenYear;
    const thisYear = new Date().getFullYear();
    const sold = allTransactions.filter(t => t.type === 'sell')
      .map(t => parseInt(String(t.date || '').slice(0, 4), 10)).filter(Number.isFinite);
    return !sold.length || sold.includes(thisYear) ? thisYear : Math.max(...sold);
  }, [chosenYear, allTransactions]);

  // Calculate comparisons
  const comparison = React.useMemo(() => Tax.compareCostBasis(allTransactions, taxYear), [allTransactions, taxYear]);
  const breakdown = React.useMemo(() => Tax.getCapitalGainsBreakdown(allTransactions, method, taxYear), [allTransactions, method, taxYear]);

  // Current prices, per share in base currency: what the holding is worth
  // over how many shares it is. The native close was compared with a cost
  // in base currency -- pence against dollars. An unpriced
  // holding has no candidate.
  const currentPrices = React.useMemo(() => {
    const prices = {};
    (holdings || []).forEach(h => {
      // holdingsData is keyed by holding id, not symbol -- same slip as above.
      const data = holdingsData?.[h.id];
      const value = Number(data?.currentValue);
      const qty = Number(data?.quantity);
      if (data && !data.priceUnavailable && Number.isFinite(value) && qty > 0) prices[h.symbol || h.name || h.id] = value / qty;
    });
    return prices;
  }, [holdings, holdingsData]);

  // The held positions with no value (a currency rate or a quote that did
  // not load), by ticker and why, or '': they cannot be candidates, and
  // the list said nothing -- a GBP position $11M under its cost vanished
  // from it when the GBP/USD rate failed. The currency alone did not say
  // which positions they were.
  const unpricedWhy = React.useMemo(() => {
    const PC = window.PortfolioCalculations;
    const rows = (holdings || []).map(h => holdingsData?.[h.id]).filter(Boolean);
    return PC && PC.unpricedLine ? PC.unpricedLine(rows, baseCurrency || 'USD') : PC && PC.unpricedWhy ? PC.unpricedWhy(rows, baseCurrency || 'USD') : '';
  }, [holdings, holdingsData, baseCurrency]);

  const harvestingCandidates = React.useMemo(
    () => Tax.getHarvestingCandidates(holdings || [], allTransactions, currentPrices),
    [holdings, allTransactions, currentPrices]
  );

  // For the selected method: the lots each method sells differ, and so do
  // the loss rows a replacement is matched to.
  const washSales = React.useMemo(() => Tax.detectWashSales(allTransactions, method), [allTransactions, method]);

  const styles = {
    container: {
      minHeight: window.APP_PLATFORM === 'WEB' ? 'auto' : '100vh', paddingBottom: window.APP_PLATFORM === 'WEB' ? 20 : 80,
      background: window.APP_PLATFORM === 'WEB' ? 'transparent' : (isDark ? C3.bgGradientDark : C3.bgGradientLight),
      color: isDark ? C3.textDark : C3.textLightTheme,
    },
    header: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      position: 'sticky', top: 0, zIndex: 40, padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    },
    card: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16, padding: 16, margin: '0 16px 12px',
    },
    sectionTitle: {
      fontSize: 14, fontWeight: '700', margin: '0 0 12px',
      color: isDark ? C3.textDark : C3.textLightTheme,
    },
  };

  // In the portfolio's base currency, which every figure here now is. A
  // hardcoded '$' labelled a euro gain in dollars.
  const ccy = baseCurrency || 'USD';
  const fmt = (n) => {
    const v = Math.abs(n || 0);
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy, maximumFractionDigits: 2 }).format(v); }
    catch (e) { return ccy + ' ' + v.toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  };
  // A sign only for what rounds to a cent or more: a sale at its cost left a
  // float remainder of -0.0000001 and read "-$0.00".
  const fmtSign = (n) => { const r = Math.round((Number(n) || 0) * 100) / 100; return r > 0 ? '+' + fmt(r) : r < 0 ? '-' + fmt(r) : fmt(0); };

  // Headings, not styled divs: the screen had none.
  // On the web it is the Tax tab under the page's H1 and the tab's H2, so
  // its title is an H3 and its sections H4; full screen in the Mini App the
  // title is an H2.
  const onWeb = window.APP_PLATFORM === 'WEB';
  const titleTag = onWeb ? 'h3' : 'h2';
  const sectionTag = onWeb ? 'h4' : 'h3';
  const titleStyle = { fontSize: 16, fontWeight: '700', flex: 1, margin: 0 };

  const handleExport = () => {
    const csv = Tax.generateTaxCSV(allTransactions, method, taxYear);
    Tax.downloadCSV(csv, `tax-report-${method}-${taxYear}.csv`);
    window.Haptics?.medium();
  };

  if (allTransactions.length === 0) {
    return React.createElement('div', { style: styles.container },
      React.createElement('div', { style: styles.header },
        React.createElement('button', {
          onClick: onClose,
          'aria-label': 'Back to overview',
          style: { background: 'none', border: 'none', cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme }
        }, React.createElement(Icon, { name: 'arrowLeft', size: 20 })),
        React.createElement(titleTag, { style: titleStyle }, 'Tax Optimizer')
      ),
      React.createElement('div', { style: { textAlign: 'center', padding: 40 } },
        React.createElement('div', { style: { marginBottom: 12, display: 'flex', justifyContent: 'center' } }, React.createElement(Icon, { name: 'barChart', size: 40, color: isDark ? C3.textMutedDark : C3.textMutedLight })),
        React.createElement('div', { style: { fontSize: 14, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
          'Add transactions to your portfolio to see tax analysis')
      )
    );
  }

  return React.createElement('div', { style: styles.container },
    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('button', {
        onClick: onClose,
        'aria-label': 'Back to overview',
        style: { background: 'none', border: 'none', cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme }
      }, React.createElement(Icon, { name: 'arrowLeft', size: 20 })),
      React.createElement(titleTag, { style: titleStyle }, 'Tax Optimizer'),
      React.createElement('button', {
        onClick: handleExport,
        style: {
          background: C3.logoGradient, border: 'none', borderRadius: 8,
          color: '#fff', fontWeight: '600', fontSize: 11, padding: '6px 12px', cursor: 'pointer',
        }
      }, 'Export CSV')
    ),

    React.createElement('div', { style: { padding: '12px 0' } },

      // Section 1: Method Comparison
      React.createElement('div', { style: styles.card },
        React.createElement(sectionTag, { style: styles.sectionTitle }, `Cost Basis Method Comparison — ${taxYear}`),
        React.createElement('div', {
          // Three across where they fit, fewer on a phone: at 320 px each
          // tile was about 60 px and "+$50.00" ran over its border.
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8 }
        },
          [
            { key: 'fifo', label: 'FIFO', data: comparison.fifo },
            { key: 'lifo', label: 'LIFO', data: comparison.lifo },
            { key: 'avgcost', label: 'Avg Cost', data: comparison.avgCost },
          ].map(m => {
            const isLowest = m.data.estimatedTax <= Math.min(comparison.fifo.estimatedTax, comparison.lifo.estimatedTax, comparison.avgCost.estimatedTax);
            const isActive = method === m.key;
            return React.createElement('button', {
              key: m.key,
              // Which method the figures below use: said, not only tinted.
              'aria-pressed': isActive,
              onClick: () => { setMethod(m.key); window.Haptics?.light(); },
              style: {
                padding: 10, borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                border: '1px solid transparent',
                ...window.ToggleStyle.value(isActive, isDark, { bordered: true }),
              }
            },
              React.createElement('div', {
                style: { fontSize: 11, fontWeight: '700', color: isDark ? C3.textDark : C3.textLightTheme, marginBottom: 4 }
              }, m.label),
              // A money figure stays on one line and shrinks to its tile: it
              // was let break anywhere and read "+$84,700." / "00" at 320 px.
              React.createElement('div', { style: { containerType: 'inline-size' } },
                React.createElement('div', {
                  style: { whiteSpace: 'nowrap', fontWeight: '700',
                    // On the selected card's orange tint the raw red read 4.45:1:
                    // the shade that clears it with margin (the ground is a tint over the panel).
                    color: (window.A11yColor && isActive)
                      ? window.A11yColor.readable(m.data.totalGain >= 0 ? C3.success : C3.error, isDark ? '#34220f' : '#fef1e8', 5.5)
                      : (m.data.totalGain >= 0 ? C3.success : C3.error),
                    fontSize: `min(14px, calc(100cqw / ${(Math.max(String(fmtSign(m.data.totalGain)).length, 1) * 0.62).toFixed(2)}))` }
                }, fmtSign(m.data.totalGain))),
              React.createElement('div', {
                style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 2 }
              }, `Tax: ~${fmt(m.data.estimatedTax)}`),
              isLowest && React.createElement('div', {
                style: {
                  fontSize: 9, fontWeight: '700', color: C3.success,
                  background: '#22c55e15', borderRadius: 4, padding: '1px 5px', marginTop: 4,
                  display: 'inline-block',
                }
              }, 'Lowest Tax')
            );
          })
        ),
        // The rates behind every "Tax" and "Save" figure, said once: the
        // totals used 20% and the harvesting list 37% with nothing to say so.
        React.createElement('div', { style: { fontSize: 10, marginTop: 8, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
          `Estimated at approximate US federal rates: ${Math.round(Tax.RATES.shortTerm * 100)}% short-term, ${Math.round(Tax.RATES.longTerm * 100)}% long-term; losses offset gains across both. Wash-sale losses are left out.`)
      ),

      // Section 2: Capital Gains Breakdown
      React.createElement('div', { style: styles.card },
        React.createElement(sectionTag, { style: styles.sectionTitle }, `Capital Gains Breakdown — ${method === 'avgcost' ? 'Avg Cost' : method.toUpperCase()}, ${taxYear}`),
        // Bar chart
        React.createElement('div', { style: { display: 'flex', gap: 12, marginBottom: 12 } },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 } }, 'Short-Term (held 1 year or less)'),
            React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 2 } },
              React.createElement('div', {
                style: { fontSize: 13, fontWeight: '700', color: breakdown.shortTerm.net >= 0 ? C3.success : C3.error }
              }, fmtSign(breakdown.shortTerm.net))
            ),
            React.createElement('div', { style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
              `Gains: ${fmt(breakdown.shortTerm.gains)} | Losses: ${fmt(Math.abs(breakdown.shortTerm.losses))}`)
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 } }, 'Long-Term (held over 1 year)'),
            React.createElement('div', {
              style: { fontSize: 13, fontWeight: '700', color: breakdown.longTerm.net >= 0 ? C3.success : C3.error }
            }, fmtSign(breakdown.longTerm.net)),
            React.createElement('div', { style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
              `Gains: ${fmt(breakdown.longTerm.gains)} | Losses: ${fmt(Math.abs(breakdown.longTerm.losses))}`)
          )
        ),
        // Total
        React.createElement('div', {
          style: {
            padding: '8px 12px', borderRadius: 10,
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            display: 'flex', justifyContent: 'space-between',
          }
        },
          React.createElement('span', { style: { fontSize: 12, fontWeight: '600' } }, 'Net Total'),
          React.createElement('span', {
            style: { fontSize: 13, fontWeight: '700', color: breakdown.total.net >= 0 ? C3.success : C3.error }
          }, fmtSign(breakdown.total.net))
        )
      ),

      // Section 3: Tax-Loss Harvesting
      (harvestingCandidates.length > 0 || unpricedWhy) && React.createElement('div', { style: styles.card },
        React.createElement(sectionTag, { style: styles.sectionTitle }, harvestingCandidates.length > 0 ? `Tax-Loss Harvesting (${harvestingCandidates.length} candidate${harvestingCandidates.length === 1 ? '' : 's'})` : 'Tax-Loss Harvesting'),
        unpricedWhy && React.createElement('div', { 'data-unpriced-why': 'true', 'data-own-fail': 'quotes', style: { fontSize: 12, lineHeight: 1.5, marginBottom: harvestingCandidates.length ? 4 : 0, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
          React.createElement('span', { role: 'status' }, unpricedWhy + ' The list leaves out the positions without a value.'),
          onRetryPrices && window.RateLimitWait && window.RateLimitWait.RetryButton && React.createElement(window.RateLimitWait.RetryButton, {
            busyKey: 'prices', isDark, onClick: onRetryPrices,
            style: { marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" },
          })),
        harvestingCandidates.slice(0, 10).map((c, i) =>
          React.createElement('div', {
            key: i,
            style: {
              padding: '10px 0',
              borderBottom: i < harvestingCandidates.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` : 'none',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }
          },
            React.createElement('div', null,
              React.createElement('div', { style: { fontSize: 13, fontWeight: '600' } }, String(c.symbol || c.name || 'Manual asset').split('.')[0]),
              React.createElement('div', { style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                // At the asset's own precision: 0.004 BTC read "0.00 shares".
                (() => { const kind = ((holdings || []).find(h => h.symbol === c.symbol) || {}).type || c.symbol; return `${window.PortfolioCalculations.quantityText(c.quantity, kind)} ${window.PortfolioCalculations.quantityUnit(kind, c.quantity)} @ ${fmt(c.avgCost)} avg`; })())
            ),
            React.createElement('div', { style: { textAlign: 'right' } },
              React.createElement('div', { style: { fontSize: 13, fontWeight: '700', color: C3.error } },
                fmtSign(c.unrealizedLoss)),
              React.createElement('div', { style: { fontSize: 10, color: C3.success } },
                `Save ~${fmt(c.estimatedSavings)} at ${Math.round((c.rate || Tax.RATES.shortTerm) * 100)}%`),
              c.washSaleRisk && React.createElement('div', {
                style: { fontSize: 9, color: C3.warning, fontWeight: '600', marginTop: 2 }
              }, '\u26A0 Wash sale risk')
            )
          )
        )
      ),

      // Section 4: Wash Sale Alerts
      washSales.length > 0 && React.createElement('div', { style: styles.card },
        React.createElement(sectionTag, {
          style: { ...styles.sectionTitle, color: C3.error }
        }, `\u26A0 Wash Sale Alerts (${washSales.length})`),
        washSales.map((w, i) =>
          React.createElement('div', {
            key: i,
            style: {
              padding: 10, borderRadius: 10, marginBottom: 8,
              background: '#ef444410', border: '1px solid #ef444420',
            }
          },
            React.createElement('div', {
              style: { fontSize: 12, fontWeight: '600', color: C3.error }
            }, `${w.symbol.split('.')[0]} — Sold ${w.sellDate}`),
            React.createElement('div', {
              style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 2 }
            }, `Loss: ${fmtSign(w.loss)} — Disallowed: ${fmt(w.disallowedLoss)}` + (w.sharesSold ? ` (${window.PortfolioCalculations.quantityText(w.replacementShares, w.symbol)} of ${window.PortfolioCalculations.quantityText(w.sharesSold, w.symbol)} ${window.PortfolioCalculations.quantityUnit(w.symbol, w.sharesSold)} replaced)` : '')
              + '. Left out of the totals above and added to the cost of the replacement shares.'),
            React.createElement('div', {
              style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 2 }
            }, `Repurchased on: ${w.washBuyDates.join(', ')}`)
          )
        )
      ),

      // Year selector + Export
      // Wraps: at 320 px "Download FIFO CSV" stuck out of the card by 15 px.
      React.createElement('div', { style: { ...styles.card, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 } },
        React.createElement('span', { style: { fontSize: 12, fontWeight: '600' } }, 'Tax Year:'),
        React.createElement(window.PortalDropdown, {
          value: taxYear,
          options: taxYears.map(y => ({ value: y, label: String(y) })),
          onChange: (v) => setTaxYear(parseInt(v)),
          isDark,
          style: { padding: '4px 22px 4px 8px', fontSize: 12, borderRadius: 8 },
          minWidth: 70,
          ariaLabel: 'Tax year',
        }),
        React.createElement('button', {
          onClick: handleExport,
          style: {
            marginLeft: 'auto', padding: '6px 14px', borderRadius: 8,
            background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
            border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: '600',
            color: isDark ? C3.textDark : C3.textLightTheme,
          }
        }, `Download ${method === 'avgcost' ? 'AVG COST' : method.toUpperCase()} CSV`)
      )
    )
  );
};
