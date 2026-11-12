// Portfolio Tracker - Analytics Component (Concept 3 Glassmorphism Design)

// Fundamentals for the portfolio's positions, kept for the session and
// shared by Dividends, Risk, the sector look-up and Health. Each visit to
// Dividends or Risk asked again for every position, one after another: 50
// positions were 50 requests and 17-20 s per visit, and Dividends -> Risk ->
// Dividends 150 requests. An answer is kept for
// PortfolioFundamentals.TTL (30 min) per key and symbol; a request already
// out is joined unless it has been out longer than JOIN_MS (a hung one is
// not waited on again); no answer is not kept. Every request, from any
// caller, takes one of CAP (6) slots: two portfolios' batches, or a batch
// and the sector look-up, never have more out together. A
// request that has not answered by WAIT_MS (20 s) reads as no answer, so one
// hung symbol does not hold the rest of a batch.
window.PortfolioFundamentals = (() => {
  const TTL = 30 * 60 * 1000;
  const JOIN_MS = 15000;
  const CAP = 6;
  const store = new Map();
  const keyOf = (apiKey, symbol) => String(apiKey || '') + '|' + String(symbol || '').trim().toUpperCase();
  const answered = (f) => !!f && typeof f === 'object' && !Array.isArray(f)
    && !!(f.General || f.Highlights || f.SplitsDividends || f.Technicals);
  const now = () => Date.now();
  // Why a symbol's fundamentals did not come back, by key, for many()
  // (RateLimitWait.failure reads it).
  const fails = new Map();
  let busy = 0;
  const waiting = [];
  // `onTimeout`: told when the wait ends with no answer. It answered null
  // and kept nothing, so Health's earnings read "No earnings data available"
  // and projected income blamed the plan for a request that hung.
  const slot = (task, onTimeout) => new Promise((resolve, reject) => {
    const run = () => {
      busy++;
      let done = false;
      const finish = () => { if (done) return; done = true; busy--; const next = waiting.shift(); if (next) next(); };
      const t = setTimeout(() => { finish(); if (onTimeout) onTimeout(); resolve(null); }, window.PT_FUNDAMENTALS_WAIT_MS || 20000);
      Promise.resolve().then(task).then((v) => { clearTimeout(t); finish(); resolve(v); }, (e) => { clearTimeout(t); finish(); reject(e); });
    };
    if (busy < CAP) run(); else waiting.push(run);
  });
  function get(apiKey, symbol) {
    const k = keyOf(apiKey, symbol);
    const e = store.get(k);
    if (e && e.promise && now() - e.startedAt < JOIN_MS) return e.promise;
    if (e && !e.promise && now() - e.at < TTL) return Promise.resolve(e.value);
    // Asked with throwErrors so the reason is known; a failure still
    // answers null, as before, and is remembered for many().
    const p = slot(() => Promise.resolve(window.EODHD_API.getFundamentals(apiKey, symbol, { throwErrors: true }))
      .then((v) => {
        // {"message"} with 200 (the open apps' client hands it over as it
        // came) could not be read.
        const RLW = window.RateLimitWait;
        if (RLW && RLW.notData && RLW.notData(v)) { fails.set(k, { unreadable: true, status: 200 }); return null; }
        fails.delete(k);
        return v;
      }, (err) => { fails.set(k, err || {}); return null; }), () => fails.set(k, { status: 0, timedOut: true }))
      .then((v) => {
        if (store.get(k) && store.get(k).promise === p) {
          if (answered(v)) store.set(k, { at: now(), value: v }); else store.delete(k);
        }
        return v;
      }, (err) => {
        if (store.get(k) && store.get(k).promise === p) store.delete(k);
        throw err;
      });
    store.set(k, { promise: p, startedAt: now() });
    return p;
  }
  function dropFreeLimited(lifted) {
    const API = window.EODHD_API;
    if (!Array.isArray(lifted) || !lifted.length || !API || typeof API.freeLimitedOf !== 'function') return 0;
    let dropped = 0;
    Array.from(store.keys()).forEach((k) => {
      const e = store.get(k);
      const ids = e && !e.promise ? API.freeLimitedOf(e.value) : null;
      if (ids && ids.some((id) => lifted.indexOf(id) !== -1)) { store.delete(k); dropped++; }
    });
    return dropped;
  }
  try {
    window.addEventListener('limits:changed', (ev) => {
      try { dropFreeLimited(ev && ev.detail && ev.detail.lifted); } catch (_) { /* never */ }
    });
  } catch (_) { /* no window events: nothing to listen to */ }
  // { [symbol]: fundamentals | null } for every symbol; `_failed` (not
  // enumerable): what the first request that failed was, or undefined.
  async function many(apiKey, symbols) {
    const list = [...new Set((symbols || []).filter(Boolean))];
    const out = {};
    let failed;
    await Promise.all(list.map(async (sym) => {
      try { out[sym] = await get(apiKey, sym); } catch (e) { out[sym] = null; failed = failed || e || {}; }
      if (out[sym] == null && !failed && fails.has(keyOf(apiKey, sym))) failed = fails.get(keyOf(apiKey, sym));
    }));
    if (failed) Object.defineProperty(out, '_failed', { value: failed, enumerable: false });
    return out;
  }
  // What the last request for a symbol threw when it did not come back.
  const failureOf = (apiKey, symbol) => fails.get(keyOf(apiKey, symbol)) || null;
  return { get, many, failureOf, dropFreeLimited, TTL, JOIN_MS, CAP, clear: () => store.clear() };
})();
// The quote currency of a backtest's instrument: the held position's, else
// the search's row for that listing, else the one its exchange usually
// quotes in. One lookup per symbol: callers asking while it is out join the
// same promise, and it leaves `asked` when it settles. The run used to join a
// promise that resolved to itself and never finished.
//   o.held   - the held position's currency, if any
//   o.search - (code) => rows (may reject)
//   o.cache  - symbol -> currency found before
//   o.asked  - symbol -> lookup still out
window.BacktestCurrency = {
  lookup(symbol, o) {
    const Calc = window.PortfolioCalculations;
    if (o.held) return Promise.resolve(o.held);
    const dot = symbol.lastIndexOf('.');
    const ex = symbol.slice(dot + 1);
    if (['US', 'CC', 'FOREX', 'INDX'].includes(ex)) return Promise.resolve(Calc.currencyFromSymbol(symbol));
    if (o.cache[symbol]) return Promise.resolve(o.cache[symbol]);
    if (o.asked[symbol]) return o.asked[symbol];
    const code = symbol.slice(0, dot);
    const p = Promise.resolve()
      .then(() => o.search(code))
      .catch(() => null)
      .then((rows) => {
        const row = Array.isArray(rows) ? rows.find(r => window.SymbolCode.fromRow(r) === symbol) : null;
        let ccy = row && typeof row.Currency === 'string' ? row.Currency.trim() : '';
        if (ccy === 'GBp' || ccy === 'GBx') ccy = 'GBX';
        ccy = ccy.toUpperCase();
        // Kept either way, so the amount's label and the run use one currency:
        // the label said GBX and the run then took the entered 10,000 as USD.
        const out = /^[A-Z]{3}$/.test(ccy) ? ccy : Calc.currencyFromSymbol(symbol);
        if (out) o.cache[symbol] = out;
        return out;
      })
      .finally(() => { if (o.asked[symbol] === p) delete o.asked[symbol]; });
    o.asked[symbol] = p;
    return p;
  },
};
window.PortfolioAnalyticsView = ({ portfolioId, apiKey, baseCurrency, holdings, holdingsData, onClose, theme, embedded, initialTab, allowedTabs, compact, pricesLoading, onRetryPrices }) => {
  const [activeTab, setActiveTab] = React.useState(initialTab || 'allocation');
  // The Monthly Projection's width, measured: under 300 px the twelve months
  // go in two rows of six instead of one row that scrolled sideways with
  // nothing on screen to say it did.
  const [projNarrow, setProjNarrow] = React.useState(false);
  const projObserverRef = React.useRef(null);
  const projRef = React.useCallback((el) => {
    if (projObserverRef.current) { projObserverRef.current.disconnect(); projObserverRef.current = null; }
    if (!el) return;
    const measure = (w) => setProjNarrow(w > 0 && w < 300);
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'function') {
      projObserverRef.current = new ResizeObserver((entries) => measure(entries[0].contentRect.width));
      projObserverRef.current.observe(el);
    }
  }, []);
  const [performanceData, setPerformanceData] = React.useState([]);
  const [benchmarkData, setBenchmarkData] = React.useState(null);
  const [riskMetrics, setRiskMetrics] = React.useState(null);
  const [dividendProjectionState, setDividendProjection] = React.useState(null);
  // While fundamentals are still coming (9 s+ on a slow key), the cards say
  // so instead of "No dividend data" / "No sector data".
  const [dividendLoading, setDividendLoading] = React.useState(false);
  const [sectorsLoading, setSectorsLoading] = React.useState(false);
  const [correlationMatrix, setCorrelationMatrix] = React.useState(null);
  const [monteCarloData, setMonteCarloData] = React.useState(null);
  const monteCarloGate = (window.FreeLimitWalls ? window.FreeLimitWalls.useAnalyticsGate : () => 'open')('montecarlo', activeTab === 'montecarlo');
  const [backtestResult, setBacktestResult] = React.useState(null);
  const [backtestSymbol, setBacktestSymbol] = React.useState('');
  const [backtestAmount, setBacktestAmount] = React.useState('10000');
  const [backtestDate, setBacktestDate] = React.useState('2023-01-01');
  const [loading, setLoading] = React.useState(false);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  const isDark = theme === 'dark';
  // Light theme: darker success/error/warning inks and accents.
  const C3 = Calc.themeInk(window.C3, isDark);
  const acc = (hex) => Calc.accent(hex, isDark);
  // Same helper as PortfolioTracker: a white-on-dark alpha, mirrored to
  // black-on-light. Written as a flat rgba(255,255,255,a) it renders at about
  // 1.05:1 in the light theme -- invisible, and reachable since the theme
  // switch landed.
  const ink = (a) => (isDark ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + Math.min(1, a + 0.15) + ')');

  const Icon = ({ name, size = 24, color }) => {
    return React.createElement('svg', {
      'aria-hidden': true, style: { width: size, height: size, flexShrink: 0 },
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
      minHeight: '100vh',
      paddingBottom: 80,
      background: isDark ? C3.bgGradientDark : C3.bgGradientLight,
      color: isDark ? C3.textDark : C3.textLightTheme,
      position: 'relative',
      overflowX: 'hidden'
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
      marginBottom: 16
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
    }
  };

  // Sectors learned this session for holdings stored without one (see the
  // effect below), so the allocation shows them without a reload.
  const [learnedSectors, setLearnedSectors] = React.useState({});
  const holdingsWithData = holdings.map(h => {
    const merged = { ...h, ...(holdingsData[h.id] || {}) };
    if (!merged.sector && learnedSectors[h.id]) merged.sector = learnedSectors[h.id];
    return merged;
  });

  // "By Sector: No sector data" for an AAPL position: no add path stores a sector (AddPosition, CSV import, index
  // and template portfolios), and the only backfill ran inside the
  // Risk and Dividends tabs — never on Allocation, the tab that shows it.
  // Look the sector up from fundamentals (General.Sector) for every stock
  // holding still without one, here, and store it on the holding.
  const sectorKey = holdings.map(h => h.id + ':' + (h.sector || '')).join(',');
  const sectorsDeferred = activeTab === 'montecarlo' && monteCarloGate !== 'open';
  React.useEffect(() => {
    if (sectorsDeferred) return;
    if (!apiKey || !window.EODHD_API || !window.EODHD_API.getFundamentals) return;
    const missing = holdings.filter(h => h && h.symbol && !h.sector && !learnedSectors[h.id]
      && (h.type || 'stock') === 'stock'
      && !/\.(FOREX|CC|INDX|GBOND|COMM|MONEY)$/i.test(h.symbol));
    if (!missing.length) return;
    let cancelled = false;
    setSectorsLoading(true);
    (async () => {
      for (const h of missing.slice(0, 25)) {
        if (cancelled) return;
        try {
          const f = await window.PortfolioFundamentals.get(apiKey, h.symbol);
          const sector = f && f.General && f.General.Sector;
          if (cancelled || !sector || typeof sector !== 'string') continue;
          try { Storage.updateHolding(h.id, { sector }); } catch (e) { /* kept for this session anyway */ }
          setLearnedSectors(prev => ({ ...prev, [h.id]: sector }));
          // The Health widget counts sectors and holds the records as they
          // were when the page loaded: tell it one has arrived.
          try { window.dispatchEvent(new CustomEvent('portfolio:sector-learned', { detail: { id: h.id, sector } })); } catch (e) { /* a courtesy */ }
        } catch (e) { /* the next open tries again */ }
      }
      if (!cancelled) setSectorsLoading(false);
    })();
    return () => { cancelled = true; setSectorsLoading(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, sectorKey, sectorsDeferred]);
  // Shares are held and no price came back for them. `holdings` are the
  // stored records and carry no quantity -- it is worked out from the
  // transactions and arrives in holdingsData -- so asking them never said
  // yes, and a refused key read "No holdings yet".
  const needsPrices = holdingsWithData.some(h => h.priceUnavailable && Number(h.quantity) > 0);
  // Why they have none, in the words every screen uses: a currency rate that
  // did not load is named with its reason, as the quotes' failure is
  // (Calc.unpricedWhy); '' when it is not known. Every count of unpriced
  // positions here said only that.
  const unpricedWhyText = Calc.unpricedWhy(holdingsWithData, baseCurrency || 'USD');
  const needsPricesWords = 'Needs current prices — none came back for these positions.' + (unpricedWhyText ? ' ' + unpricedWhyText : '');
  // Beside a "needs current prices" message: asks for the quotes once more.
  // Nothing on the page did; only a reload or another portfolio refetched.
  const retryPrices = onRetryPrices ? (
    <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />
  ) : null;
  // A tab whose price history did not come back says so, with the reason and
  // a Try again that counts the limit's wait down -- and, at the limit, it
  // loads again by itself once the wait is over (RateLimitWait.FailNote).
  const RLW = window.RateLimitWait;
  const historyWhat = (n) => (n > 1 ? `The price history of ${n} positions` : 'The price history');
  const noHistoryWords = (m) => (m && m.historyFailed && m.insufficientHistory ? 'Price history did not load' : 'Not enough price history');
  // Rows of figure tiles on a narrow screen: the
  // tiles go fewer across before they get narrower than a figure, and a
  // figure stays in one piece -- sign, number and % -- at a size that fits.
  // Never more than `across` tiles in a row (a column is at least its share
  // of the row), so from about 500 px up none of this changes anything.
  const tileRow = (min, across, gap) => `repeat(auto-fit, minmax(min(100%, max(${min}px, calc((100% - ${(across - 1) * gap}px) / ${across}))), 1fr))`;
  const figure = (min, vw, max) => ({ fontSize: `clamp(${min}px, ${vw}vw, ${max}px)`, whiteSpace: 'nowrap' });
  // A colour as text on its own 0x30 tint over the card: a badge.
  const badgeInk = (c) => {
    const hex = String(c || '');
    if (isDark || !/^#[0-9a-f]{6}$/i.test(hex)) return c;
    const mix = '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (0x30 / 255) + 255 * (1 - 0x30 / 255)).toString(16).padStart(2, '0')).join('');
    return Calc.ink(hex, false, mix);
  };
  const unpricedHeld = holdingsWithData.filter(h => h.priceUnavailable && Number(h.quantity) > 0).length;
  const anyPricedHeld = holdingsWithData.some(h => !h.priceUnavailable && Number(h.quantity) > 0 && Number(h.currentValue) > 0);
  const allocationByType = Calc.getAllocationByType(holdingsWithData);
  const allocationBySector = Calc.getAllocationBySector(holdingsWithData);
  const allocationByCurrency = Calc.getAllocationByCurrency(holdingsWithData);
  const allocationByCountry = Calc.getAllocationByCountry(holdingsWithData);

  const COLORS = {
    type: { stock: '#f97316', etf: '#3b82f6', fund: '#14b8a6', crypto: '#a855f7', forex: '#22c55e', bond: '#6b7280', manual: '#ec4899' },
    sector: ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#f43f5e', '#6366f1', '#84cc16']
  };

  const TYPE_LABELS = { stock: 'Stocks', etf: 'ETFs', fund: 'Funds', crypto: 'Crypto', forex: 'Forex', bond: 'Bonds', manual: 'Manual' };

  // Listen for direct tab navigation from Pro Tools grid
  React.useEffect(() => {
    const handler = (e) => { if (e.detail) setActiveTab(e.detail); };
    window.addEventListener('analytics-tab', handler);
    return () => window.removeEventListener('analytics-tab', handler);
  }, []);

  // What the open tab was computed from. It was computed once, when the tab
  // was opened: switching portfolio on the Dividends tab left the dollar
  // portfolio's income under a euro sign, and opening it while the new
  // portfolio's prices were still loading froze it at 0.00. Now the tab waits for the prices and is computed again when
  // the portfolio, its positions or their quantities change.
  const dataKey = holdingsWithData.map(h => [h.id, Number(h.quantity) || 0, h.priceUnavailable ? 'u' : (Number(h.currentValue) > 0 ? 'p' : '-')].join(':')).join(',');
  const dividendSeq = React.useRef(0);
  // Drawn only for the portfolio it was worked out for: on the very render
  // that switches portfolio the old figures would otherwise show once more,
  // under the new currency sign.
  const dividendProjection = dividendProjectionState && dividendProjectionState.forPortfolio === portfolioId ? dividendProjectionState : null;
  React.useEffect(() => {
    if (activeTab === 'dividends') { dividendSeq.current++; setDividendProjection(null); }
    // The render that switches portfolio still carries the last one's
    // positions; they are replaced on the next, and that one computes.
    const lastPortfolios = portfolioId !== 'all' && holdings.some(h => h && h.portfolioId && h.portfolioId !== portfolioId);
    if (pricesLoading || lastPortfolios) return;
    if (activeTab === 'performance') loadPerformanceHistory();
    else if (activeTab === 'dividends') loadDividendProjection();
    else if (activeTab === 'benchmark') loadBenchmarkComparison();
    else if (activeTab === 'risk') loadRiskMetrics();
    else if (activeTab === 'correlation') loadCorrelationMatrix();
    else if (activeTab === 'montecarlo' && monteCarloGate === 'open') loadMonteCarlo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, portfolioId, pricesLoading, dataKey, monteCarloGate]);

  const loadPerformanceHistory = async () => {
    setLoading(true);
    const transactions = Storage.getTransactionsByPortfolio(portfolioId);
    const monthlyData = {};
    transactions.forEach(tx => {
      const month = tx.date.substring(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { invested: 0, dividends: 0 };
      // Cash actually moved: a buy costs its commission too, a sale brings in
      // its price less the commission (net cash in left fees out).
      if (tx.type === 'buy' || tx.type === 'transfer_in') monthlyData[month].invested += (tx.quantity * tx.price + (tx.fees || 0)) * (tx.exchangeRate || 1);
      else if (tx.type === 'sell' || tx.type === 'transfer_out') monthlyData[month].invested -= (tx.quantity * tx.price - (tx.fees || 0)) * (tx.exchangeRate || 1);
      else if (tx.type === 'dividend') monthlyData[month].dividends += tx.quantity * tx.price * (tx.exchangeRate || 1) * (1 - (tx.withholdingTaxPercent || 0) / 100);
    });

    const months = Object.keys(monthlyData).sort();
    let cumInvested = 0, cumDividends = 0;
    const performanceHistory = months.map(month => {
      cumInvested += monthlyData[month].invested;
      cumDividends += monthlyData[month].dividends;
      return { month, invested: cumInvested, dividends: cumDividends };
    });

    const currentMonth = new Date().toISOString().substring(0, 7);
    const totalValue = Calc.getTotalValue(holdingsWithData);
    if (performanceHistory.length === 0 || performanceHistory[performanceHistory.length - 1].month !== currentMonth) {
      performanceHistory.push({ month: currentMonth, invested: cumInvested, dividends: cumDividends, value: totalValue });
    } else {
      performanceHistory[performanceHistory.length - 1].value = totalValue;
    }
    setPerformanceData(performanceHistory);
    setLoading(false);
  };

  // Dividends received, by month, for the portfolio that is open. Recorded
  // transactions, read from storage: they need no prices, so this is worked
  // out on the render itself -- for this portfolio, at once. As state filled
  // by the tab's loader it waited for the quotes ("$0.00, 0 payments" for the
  // length of a slow load) and, after a switch, kept the last portfolio's
  // history under the new currency sign until they came.
  const dividendCalendar = React.useMemo(() => {
    if (activeTab !== 'dividends') return [];
    const own = Storage.getHoldingsByPortfolio(portfolioId);
    const byMonth = {};
    Storage.getTransactionsByPortfolio(portfolioId).filter(tx => tx.type === 'dividend').forEach(tx => {
      const month = String(tx.date || '').substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { total: 0, count: 0, items: [] };
      const holding = own.find(h => h.id === tx.holdingId);
      const net = tx.quantity * tx.price * (tx.exchangeRate || 1) * (1 - (tx.withholdingTaxPercent || 0) / 100);
      byMonth[month].total += net;
      byMonth[month].count++;
      byMonth[month].items.push({ symbol: holding?.symbol?.split('.')[0] || holding?.name || 'Unknown', amount: net, date: tx.date });
    });
    return Object.entries(byMonth).sort((a, b) => b[0].localeCompare(a[0])).map(([month, data]) => ({ month, ...data }));
    // holdings and holdingsData are replaced after every change to the
    // transactions, which is when this has to be read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, portfolioId, holdings, holdingsData]);

  /**
   * A year of closes for the largest positions, folded into one daily return
   * series at today's weights. Shared by the risk tab and Monte Carlo.
   *
   * Today's weights, not the weights of the day -- this answers "how does the
   * portfolio I hold now behave", which is what a risk figure is for. The
   * weights are normalised over the positions actually fetched, and `covered`
   * says what share of the portfolio's value they are, so the caption can be
   * honest about a portfolio of fifty small names.
   */
  const loadPortfolioDailyReturns = async (limit) => {
    const priced = holdingsWithData
      .filter(h => h.symbol && h.type !== 'manual' && h.currentValue > 0)
      .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))
      .slice(0, limit);
    const totalValue = Calc.getTotalValue(holdingsWithData);
    const coveredValue = priced.reduce((sum, h) => sum + h.currentValue, 0);
    if (totalValue <= 0 || coveredValue <= 0) return { returns: [], dates: [], covered: 0 };

    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const histories = await Promise.all(priced.map(h => historyOf(h.symbol, from, to)
      .then(got => ({ value: h.currentValue, data: got.data, failed: got.failed }))));
    // Histories that did not come back (the limit, an outage) are said by
    // the tabs that read this: "Not enough historical data" was the Monte
    // Carlo's word for a 429.
    const failures = histories.map(x => x.failed).filter(Boolean);

    // The weights are over the positions whose history is here. A position
    // with none (it failed, or EODHD has none) kept its weight and added no
    // move -- counted as cash: AAPL + MSFT with MSFT's history at 500 read a
    // volatility of 4.6% for AAPL's 13.1%, "covering 100% of portfolio
    // value". `covered` is the share of value measured.
    const used = histories.filter(x => Array.isArray(x.data) && x.data.length >= 2);
    const usedValue = used.reduce((sum, x) => sum + x.value, 0);
    if (usedValue <= 0) return { returns: [], dates: [], covered: 0, failed: whyFailed(failures), failedCount: failures.length };

    // adjusted_close, so a dividend or a split is not read as a price move.
    const byDate = {};
    used.forEach(({ value, data }) => {
      const weight = value / usedValue;
      for (let i = 1; i < data.length; i++) {
        const close = data[i].adjusted_close ?? data[i].close;
        const prev = data[i - 1].adjusted_close ?? data[i - 1].close;
        if (close && prev) byDate[data[i].date] = (byDate[data[i].date] || 0) + weight * ((close - prev) / prev);
      }
    });
    const dates = Object.keys(byDate).sort();
    return { returns: dates.map(d => byDate[d]), dates, covered: usedValue / totalValue, failed: whyFailed(failures), failedCount: failures.length };
  };

  // One symbol's daily history: { data } (rows, [] when EODHD has none:
  // a 404, a plan without it) or { data: [], failed } when the request did
  // not come back -- the limit, EODHD's own error, no connection -- which is
  // a reason to ask again, not a symbol without history.
  const historyOf = (symbol, from, to) => {
    const RLW = window.RateLimitWait;
    return Promise.resolve()
      .then(() => window.EODHD_API.getHistoricalData(apiKey, symbol, from, to, undefined, { throwErrors: true }))
      // A body that is no list of bars ({"message"} with 200) could not be
      // read: not "not enough price history".
      .then(data => (data == null ? { data: [], failed: RLW.failure(null) }
        : Array.isArray(data) ? { data } : { data: [], failed: RLW.failure({ unreadable: true, status: 200 }) }))
      .catch((e) => {
        const f = RLW.failure(e);
        return [401, 402, 403, 404].indexOf(f.status) !== -1 ? { data: [] } : { data: [], failed: f };
      });
  };
  // The failure to name for several: the limit when it was why any failed.
  const whyFailed = (fails) => (fails.find(f => f && f.limited) || fails.find(Boolean) || null);

  // The ten-year Treasury yield, read off its real-time quote the way
  // MacroDashboard reads it. Null when it cannot be had; a Sharpe ratio over
  // an invented rate is not a Sharpe ratio.
  const fetchRiskFreeRate = async () => {
    try {
      const quote = await window.EODHD_API.getRealTimeData(apiKey, 'US10Y.GBOND');
      const last = parseFloat(quote && quote.close);
      if (Number.isFinite(last)) return last;
      const prev = parseFloat(quote && quote.previousClose);
      return Number.isFinite(prev) ? prev : null;
    } catch (e) { return null; }
  };

  // Whether a history request older than a year would spend one of the
  // terminal's daily free previews: through its backend, for an account the
  // capability probe did not find on a paid plan. The open-source shell and a
  // Mini App on the user's own key go to EODHD directly, which has no
  // previews.
  const historyCostsPreviews = () => {
    const A = window.EODHD_API;
    if (!A || typeof A.needsProxy !== 'function' || !A.backendUrl) return false;
    try { if (!A.needsProxy(apiKey)) return false; } catch (e) { return false; }
    const caps = window.UserCaps;
    return !(caps && caps.source === 'probe');
  };

  const loadBenchmarkComparison = async () => {
    setLoading(true);
    try {
      // The same window on both sides. This compared the portfolio's return
      // since its first purchase with the S&P 500's return since January the
      // first -- two different periods, one verdict. Now the
      // index is measured from the day the portfolio started, and the
      // portfolio's side counts closed trades too, against everything paid in.
      //
      // Money-weighted on both sides. The
      // portfolio's simple return over everything paid in was set against
      // SPY's price move since the first trade: one share in 2021 and ten in
      // September 2026 read +5.2% vs +123.7%, alpha -118%, for a portfolio of
      // nothing but SPY. Now each payment in and out is also run through SPY
      // on its own date (Calc.benchmarkReplica), and both are stated as an
      // annual IRR -- same money, same days, so a SPY-only portfolio matches
      // SPY. Under 90 days there is no annual rate to state.
      const transactions = Storage.getTransactionsByPortfolio(portfolioId);
      // Nothing bought yet: there is nothing to compare, which is not a
      // failure to load: an empty portfolio read "Unable to load benchmark
      // data".
      if (!transactions.length && !holdingsWithData.some(h => Number(h.quantity) > 0)) {
        setBenchmarkData({ empty: true });
        setLoading(false);
        return;
      }
      const today = Calc.todayISO();
      const ret = Calc.getTotalReturn(holdingsWithData, transactions);
      const mwr = Calc.getMoneyWeightedReturn(holdingsWithData, transactions, today, 90);
      // Shares held and none of them priced: there is no value to measure a
      // return from. It read "under 90 days of history" for a position 380
      // days old.
      if (holdingsWithData.some(h => h.priceUnavailable && Number(h.quantity) > 0)
        && !holdingsWithData.some(h => !h.priceUnavailable && Number(h.quantity) > 0 && Number(h.currentValue) > 0)) {
        setBenchmarkData({ needsPrices: true });
        setLoading(false);
        return;
      }
      if (!mwr) {
        const first = transactions.map(t => t.date).filter(Boolean).sort()[0];
        setBenchmarkData(first && ret.percent != null ? { tooShort: true, since: first } : null);
        setLoading(false);
        return;
      }
      // Older than a year, on an account without a paid plan, a history
      // request spends one of the day's free "full history" previews (the
      // server counts one per symbol). Opening this tab spent one on SPY
      // without anyone asking. There the comparison is over the last year.
      const yearAgo = new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10);
      if (Calc.shiftDate(mwr.start, -10) < yearAgo && historyCostsPreviews()) {
        const cut = { seen: false };
        const onCut = (e) => { if (/SPY\.US/.test(String((e && e.detail && e.detail.url) || ''))) cut.seen = true; };
        window.addEventListener('plan:history', onCut);
        let spyGot;
        let series;
        try {
          [spyGot, series] = await Promise.all([
            historyOf('SPY.US', yearAgo, today),
            loadPortfolioDailyReturns(10),
          ]);
        } finally { window.removeEventListener('plan:history', onCut); }
        // Not served (the limit, an outage) is said, with the reason: it
        // read "Unable to load benchmark data".
        const yearFailed = whyFailed([spyGot.failed, series.failed]);
        if (yearFailed) { setBenchmarkData({ failed: yearFailed }); setLoading(false); return; }
        const spyYear = spyGot.data;
        const bars = (Array.isArray(spyYear) ? spyYear : []).filter(d => d && d.date >= yearAgo);
        const px = (d) => Number(d.adjusted_close ?? d.close);
        const days = series.dates.map((d, i) => [d, series.returns[i]]).filter(([d]) => d >= yearAgo);
        if (bars.length < 2 || days.length < 20 || !(px(bars[0]) > 0)) { setBenchmarkData(null); setLoading(false); return; }
        const held = (days.reduce((v, [, r]) => v * (1 + r), 1) - 1) * 100;
        const spyRet = (px(bars[bars.length - 1]) / px(bars[0]) - 1) * 100;
        const sameCurrency = (baseCurrency || 'USD') === 'USD';
        setBenchmarkData({
          lastYear: true,
          portfolioReturn: held,
          benchmarkReturn: spyRet,
          alpha: sameCurrency ? held - spyRet : null,
          benchmarkName: 'S&P 500 (SPY), last year',
          since: bars[0].date,
          covered: series.covered,
          cut: cut.seen,
          sameCurrency,
          noDividends: true,
          dividendsRecorded: 0,
        });
        setLoading(false);
        return;
      }
      const spyGot = await historyOf('SPY.US', Calc.shiftDate(mwr.start, -10), today);
      if (spyGot.failed) { setBenchmarkData({ failed: spyGot.failed }); setLoading(false); return; }
      const spyHistory = spyGot.data;
      const spy = Calc.benchmarkReplica(mwr.flows, Array.isArray(spyHistory) ? spyHistory : [], today);
      if (!spy) { setBenchmarkData(null); setLoading(false); return; }
      // SPY is in dollars; a euro portfolio's flows are in euros. The two
      // IRRs are shown, but their difference is only called alpha in one
      // currency (as in the What-If backtest).
      const sameCurrency = (baseCurrency || 'USD') === 'USD';
      setBenchmarkData({
        portfolioReturn: mwr.annual,
        benchmarkReturn: spy.annual,
        alpha: sameCurrency ? mwr.annual - spy.annual : null,
        benchmarkName: `S&P 500 (SPY), same contributions`,
        since: mwr.start,
        totalReturnPercent: ret.percent,
        excluded: ret.excluded,
        sameCurrency,
        // SPY's line runs on adjusted close, so it includes SPY's dividends;
        // the portfolio's includes only dividends recorded here. With none
        // recorded a portfolio of nothing but SPY read "Behind the market"
        // by about SPY's yield.
        noDividends: !transactions.some(t => t.type === 'dividend'),
        // The note stays while the comparison is uneven, not only while no
        // dividend at all is recorded: one dividend of ~23 owed took it away
        // and left a bare "Behind the market".
        dividendsRecorded: transactions.filter(t => t.type === 'dividend').length,
      });
    } catch (e) {
      setBenchmarkData(null);
    }
    setLoading(false);
  };

  // The sector a holding never had: fundamentals are already being read
  // here, and General.Sector is in them. Stored on the holding, so the
  // allocation and the concentration check have it from then on.
  const rememberSector = (holding, fundamentals) => {
    const sector = fundamentals && fundamentals.General && fundamentals.General.Sector;
    if (!sector || typeof sector !== 'string' || holding.sector) return;
    try { Storage.updateHolding(holding.id, { sector }); } catch (e) { /* the next read tries again */ }
  };

  const loadRiskMetrics = async () => {
    setLoading(true);
    try {
      const totalValue = Calc.getTotalValue(holdingsWithData);
      const totalCost = Calc.getTotalCost(holdingsWithData);

      // Calculate concentration risk
      const concentrationWarnings = [];
      holdingsWithData.forEach(h => {
        const positionPercent = totalValue > 0 ? ((h.currentValue || 0) / totalValue) * 100 : 0;
        if (positionPercent > 20) {
          concentrationWarnings.push({
            type: 'position',
            symbol: h.symbol?.split('.')[0] || h.name,
            percent: positionPercent,
            message: `${h.symbol?.split('.')[0] || h.name} is ${positionPercent.toFixed(1)}% of portfolio (>20%)`
          });
        }
      });

      // Check sector concentration
      const sectorAlloc = Calc.getAllocationBySector(holdingsWithData);
      sectorAlloc.forEach(s => {
        // Unclassified is not a sector; it cannot be concentrated in.
        if (s.sector !== Calc.UNCLASSIFIED_SECTOR && s.sector !== Calc.FUND_SECTOR && s.percent > 40) {
          concentrationWarnings.push({
            type: 'sector',
            sector: s.sector,
            percent: s.percent,
            message: `${s.sector} sector is ${s.percent.toFixed(1)}% of portfolio (>40%)`
          });
        }
      });

      // Fetch beta for each holding and calculate portfolio beta
      let portfolioBeta = 0;
      let betaWeightSum = 0;
      const stockHoldings = holdingsWithData.filter(h => h.type === 'stock' || h.type === 'etf');

      let betaValueSeen = 0;
      const riskFunds = await window.PortfolioFundamentals.many(apiKey, stockHoldings.map(h => h.symbol));
      for (const holding of stockHoldings) {
        if (holding.symbol) {
          try {
            const fundamentals = riskFunds[holding.symbol];
            rememberSector(holding, fundamentals);
            const beta = parseFloat(fundamentals?.Technicals?.Beta);
            if (Number.isFinite(beta) && holding.currentValue) {
              portfolioBeta += beta * holding.currentValue;
              betaWeightSum += holding.currentValue;
            }
            if (holding.currentValue) betaValueSeen += holding.currentValue;
          } catch (e) { /* no beta for this holding; counted as uncovered below */ }
        }
      }
      // Null, not 1. Fundamentals is a paid feed: on the free tier every one
      // of these calls comes back 403, the empty catch swallowed it and the
      // `: 1` fallback printed "Portfolio Beta 1.00 — Moves with the market"
      // as if it had been measured.
      portfolioBeta = betaWeightSum > 0 ? portfolioBeta / betaWeightSum : null;
      const betaCoverage = betaValueSeen > 0 ? betaWeightSum / betaValueSeen : 0;

      // Volatility, drawdown, Sharpe and VaR from a year of market prices.
      //
      // The series here used to be built from the cash put in: each month's
      // purchases minus its sales, and the "return" the change in that running
      // total. Prices never entered it. A portfolio whose price had not moved
      // a cent showed 40.8% volatility, a Sharpe of -0.11 and a Moderate Risk
      // verdict. Alongside that: the risk-free rate was a
      // constant 4.5 while MacroDashboard reads the live one, and the total
      // return since purchase stood in for an annual return.
      const totalReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
      const series = await loadPortfolioDailyReturns(10);
      const rets = series.returns;
      const enough = rets.length >= 20;

      let volatility = null;
      let maxDrawdown = null;
      let annualReturn = null;
      let sharpeRatio = null;
      let var95 = null;
      let riskFreeRate = null;

      if (enough) {
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (rets.length - 1);
        volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;

        // Drawdown is the worst peak-to-trough fall along the actual path.
        let value = 1;
        let peak = 1;
        let worst = 0;
        rets.forEach(r => {
          value *= 1 + r;
          if (value > peak) peak = value;
          worst = Math.min(worst, (value - peak) / peak);
        });
        maxDrawdown = worst * 100;

        // The window's compound return, annualised over the days it covers;
        // for a full year that is the return itself.
        annualReturn = (Math.pow(value, 252 / rets.length) - 1) * 100;

        riskFreeRate = await fetchRiskFreeRate();
        sharpeRatio = riskFreeRate != null && volatility > 0
          ? Calc.getSharpeRatio(annualReturn, riskFreeRate, volatility)
          : null;

        // Historical one-day VaR: the fifth-worst percent of days, in money.
        const sorted = [...rets].sort((a, b) => a - b);
        const fifth = sorted[Math.floor(sorted.length * 0.05)];
        var95 = Math.max(0, -fifth) * totalValue;
      }

      // Risk level
      let riskLevel = 'Low';
      let riskScore = 0;
      if (portfolioBeta != null) {
        if (portfolioBeta > 1.2) riskScore += 2;
        else if (portfolioBeta > 1) riskScore += 1;
      }
      if (volatility != null) {
        if (volatility > 25) riskScore += 2;
        else if (volatility > 15) riskScore += 1;
      }
      if (concentrationWarnings.length > 0) riskScore += 1;

      if (riskScore >= 4) riskLevel = 'High';
      else if (riskScore >= 2) riskLevel = 'Moderate';
      // Neither beta nor volatility could be measured (no fundamentals, no
      // price history): that is no measurement, not "Low Risk".
      if (portfolioBeta == null && volatility == null) riskLevel = null;

      setRiskMetrics({
        beta: portfolioBeta,
        betaCoverage,
        volatility,
        maxDrawdown,
        sharpeRatio,
        var95,
        riskLevel,
        riskScore,
        concentrationWarnings,
        totalReturn,
        annualReturn,
        riskFreeRate,
        historyDays: rets.length,
        covered: series.covered,
        insufficientHistory: !enough,
        // Histories that did not come back: "did not load", with the reason,
        // not "Not enough price history".
        historyFailed: series.failed,
        historyFailedCount: series.failedCount,
      });
    } catch (e) {
      console.error('Risk metrics error:', e);
      setRiskMetrics(null);
    }
    setLoading(false);
  };

  const loadDividendProjection = async () => {
    // Only the latest run may draw: an answer for the portfolio that was
    // open a moment ago must not land on this one.
    const seq = ++dividendSeq.current;
    const current = () => seq === dividendSeq.current;
    const forPortfolio = portfolioId;
    setDividendLoading(true);
    try {
      let annualDividend = 0;
      let portfolioYield = 0;
      const totalValue = Calc.getTotalValue(holdingsWithData);
      const upcomingDividends = [];
      // How many holdings were asked about, and how many got an answer. On a
      // plan without Fundamentals every call is refused (403) and the card
      // read "Annual (Est.) $0.00, Yield 0.00%" -- zeros presented as a
      // measurement, the same mistake Beta made.
      let asked = 0;
      let answered = 0;
      // Held, and no price came back for it (a refused or spent key).
      let unpriced = 0;
      const incomeKinds = ['stock', 'etf', 'fund', 'mutual'];
      const divFunds = await window.PortfolioFundamentals.many(apiKey, holdingsWithData
        .filter(h => !h.priceUnavailable && Number(h.quantity) > 0 && h.symbol && incomeKinds.includes(h.type))
        .map(h => h.symbol));
      if (!current()) return;

      for (const holding of holdingsWithData) {
        if (!current()) return;
        // An unpriced holding is out of the value this yield is measured
        // against, so its income stays out too (as in the header's totals).
        if (holding.priceUnavailable) { if (Number(holding.quantity) > 0) unpriced++; continue; }
        // A fully sold position has no income and no coming ex-date (MSFT
        // sold out still showed 19.11).
        if (!(Number(holding.quantity) > 0)) continue;
        if (holding.symbol && (holding.type === 'stock' || holding.type === 'etf' || holding.type === 'fund' || holding.type === 'mutual')) {
          asked++;
          try {
            const fundamentals = divFunds[holding.symbol];
            if (fundamentals && typeof fundamentals === 'object' && (fundamentals.Highlights || fundamentals.General || fundamentals.SplitsDividends)) answered++;
            rememberSector(holding, fundamentals);
            // EODHD's DividendYield is a fraction (AAPL 0.0031, VOD 0.0367),
            // not a percent: dividing it by 100 put the portfolio's income a
            // hundred times too low ($1.37 a year). The per-share fallback is `DividendShare` --
            // `DividendPerShareAnnual` is not a field EODHD sends -- in the
            // listing's currency, so it goes through the holding's rate.
            const divYield = Calc.dividendYieldOf(fundamentals) || 0;
            const divPerShare = parseFloat(fundamentals?.Highlights?.DividendShare);
            const fx = Number(holding.exchangeRate) || 1;

            if (divYield > 0 && holding.currentValue) {
              annualDividend += holding.currentValue * divYield;
            } else if (divPerShare > 0 && holding.quantity) {
              annualDividend += divPerShare * holding.quantity * fx;
            }

            // Check for upcoming ex-dividend date
            const exDivDate = fundamentals?.SplitsDividends?.ExDividendDate;
            if (exDivDate) {
              const daysUntil = window.CalendarDate.daysFromToday(exDivDate);
              if (daysUntil != null && daysUntil > 0 && daysUntil <= 60) {
                upcomingDividends.push({
                  symbol: holding.symbol.split('.')[0],
                  exDate: exDivDate,
                  daysUntil,
                  amount: divPerShare > 0 ? (divPerShare / 4) * (holding.quantity || 0) * fx : null
                });
              }
            }
          } catch (e) {}
        }
      }

      portfolioYield = totalValue > 0 ? (annualDividend / totalValue) * 100 : 0;

      // Monthly projection (simplified - equal distribution)
      const monthlyProjection = Array(12).fill(0).map((_, i) => ({
        month: new Date(2024, i, 1).toLocaleString('en', { month: 'short' }),
        amount: annualDividend / 12
      }));

      if (!current()) return;
      // Nothing was priced: the income is unknown, and it read "$0.00,
      // 0.00%" as if it had been measured.
      if (asked === 0 && unpriced > 0) {
        setDividendProjection({ forPortfolio, needsPrices: true, unpriced });
        return;
      }
      if (asked > 0 && answered === 0) {
        // Why, when the requests failed (not a plan without the feed): the
        // limit, EODHD's error, a page that could not be read.
        const f = divFunds._failed ? window.RateLimitWait.failure(divFunds._failed) : null;
        const notServed = f && (f.limited || f.unreadable || f.status >= 500 || f.status === 0) ? f : null;
        setDividendProjection({ forPortfolio, unavailable: true, asked, failed: notServed });
        return;
      }
      setDividendProjection({
        forPortfolio,
        annualDividend,
        portfolioYield,
        unpriced,
        // Some holdings had no fundamentals: the estimate leaves them out, and says so.
        partial: answered < asked ? asked - answered : 0,
        monthlyProjection,
        upcomingDividends: upcomingDividends.sort((a, b) => a.daysUntil - b.daysUntil)
      });
    } catch (e) {
      console.error('Dividend projection error:', e);
    } finally {
      if (current()) setDividendLoading(false);
    }
  };

  // ==================== CORRELATION MATRIX ====================
  const corrArgsRef = React.useRef(undefined);
  const loadCorrelationMatrix = async (customSymbols) => {
    corrArgsRef.current = customSymbols;
    setLoading(true);
    try {
      let symbols;
      if (customSymbols && customSymbols.length >= 2) {
        symbols = customSymbols.slice(0, 10);
      } else {
        symbols = Calc.correlationSymbols(holdingsWithData, 8);
        if (symbols.length < 2) {
          setCorrelationMatrix({ error: 'Need at least 2 holdings with symbols' });
          setLoading(false);
          return;
        }
      }

      const to = new Date().toISOString().split('T')[0];
      const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const histPromises = symbols.map(sym => historyOf(sym, from, to)
        .then(got => ({ symbol: sym, data: got.data, failed: got.failed })));
      const allHist = await Promise.all(histPromises);
      const histFails = allHist.map(x => x.failed).filter(Boolean);

      // Calculate daily returns for each symbol
      const returnsMap = {};
      const dateSet = new Set();
      allHist.forEach(({ symbol, data }) => {
        if (data.length < 10) return;
        const returns = {};
        for (let i = 1; i < data.length; i++) {
          // Adjusted, like the risk tab: an ex-dividend or split day is not
          // a price move.
          const cur = data[i].adjusted_close ?? data[i].close;
          const prev = data[i - 1].adjusted_close ?? data[i - 1].close;
          if (cur && prev) {
            const date = data[i].date;
            returns[date] = (cur - prev) / prev;
            dateSet.add(date);
          }
        }
        returnsMap[symbol] = returns;
      });

      const validSymbols = Object.keys(returnsMap);
      const dates = [...dateSet].sort();
      // No history came back (a refused or spent key, an outage): say so. It
      // drew a table with no rows or columns.
      if (validSymbols.length < 2) {
        // Requests that did not come back are said with their reason (the
        // limit, an outage), and asked again; "none came back" is kept for
        // symbols EODHD has no history for.
        const why = whyFailed(histFails);
        setCorrelationMatrix(why
          ? { error: RLW.failText(historyWhat(histFails.length), why), failed: why }
          : { error: 'Needs price history — ' + (validSymbols.length ? 'it came back for one symbol only.' : 'none came back for these symbols.') });
        setLoading(false);
        return;
      }
      const corrFailed = whyFailed(histFails);

      // Calculate Pearson correlation for each pair
      const matrix = {};
      for (const s1 of validSymbols) {
        matrix[s1] = {};
        for (const s2 of validSymbols) {
          if (s1 === s2) { matrix[s1][s2] = 1; continue; }
          const pairs = dates.filter(d => returnsMap[s1][d] !== undefined && returnsMap[s2][d] !== undefined);
          if (pairs.length < 10) { matrix[s1][s2] = null; continue; }

          const r1 = pairs.map(d => returnsMap[s1][d]);
          const r2 = pairs.map(d => returnsMap[s2][d]);
          const n = r1.length;
          const mean1 = r1.reduce((a, b) => a + b, 0) / n;
          const mean2 = r2.reduce((a, b) => a + b, 0) / n;

          let cov = 0, var1 = 0, var2 = 0;
          for (let i = 0; i < n; i++) {
            const d1 = r1[i] - mean1;
            const d2 = r2[i] - mean2;
            cov += d1 * d2;
            var1 += d1 * d1;
            var2 += d2 * d2;
          }
          matrix[s1][s2] = (var1 > 0 && var2 > 0) ? cov / Math.sqrt(var1 * var2) : 0;
        }
      }

      // Some did not come back: the matrix is of the others, and says so.
      setCorrelationMatrix({ symbols: validSymbols, matrix, partFailed: corrFailed, partFailedCount: histFails.length });
    } catch (e) {
      console.error('Correlation error:', e);
      setCorrelationMatrix({ error: 'Failed to load correlation data' });
    }
    setLoading(false);
  };

  // ==================== MONTE CARLO SIMULATION ====================
  const loadMonteCarlo = async () => {
    setLoading(true);
    try {
      const totalValue = Calc.getTotalValue(holdingsWithData);
      const totalCost = Calc.getTotalCost(holdingsWithData);
      if (totalValue <= 0) {
        // No prices is not no value.
        setMonteCarloData({ error: holdingsWithData.some(h => h.priceUnavailable && Number(h.quantity) > 0) ? needsPricesWords : 'Portfolio has no value' });
        setLoading(false);
        return;
      }

      // Portfolio daily returns from a year of prices for the largest
      // positions. It was the five largest, with the share of value they are
      // thrown away: on 520 names that was 16.6% of the portfolio, shown as
      // the whole portfolio's forecast. Twenty now,
      // and the caption says how much of the value that covers.
      const MC_POSITIONS = 20;
      const series = await loadPortfolioDailyReturns(MC_POSITIONS);
      const dailyReturns = series.returns;
      const mcPositions = holdingsWithData.filter(h => h.symbol && h.type !== 'manual' && h.currentValue > 0).length;
      // A history that did not come back is not too little history: at 429
      // this said "Not enough historical data for simulation". No simulation is run on what is left -- the missing
      // positions would move with nothing -- and one already shown stays,
      // with the failure above it.
      if (series.failed) {
        const failedRun = { error: RLW.failText(historyWhat(series.failedCount), series.failed), failed: series.failed, failedCount: series.failedCount };
        setMonteCarloData(prev => (prev && !prev.error && prev.forPortfolio === portfolioId ? { ...prev, refreshFailed: failedRun } : failedRun));
        setLoading(false);
        return;
      }
      if (dailyReturns.length < 20) {
        setMonteCarloData({ error: 'Not enough historical data for simulation' });
        setLoading(false);
        return;
      }

      const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length;
      const stdDev = Math.sqrt(variance);

      // Run 500 simulations for 252 trading days (1 year)
      const NUM_SIMS = 500;
      const DAYS = 252;
      const checkpoints = [21, 63, 126, 252]; // 1mo, 3mo, 6mo, 12mo
      const simResults = [];

      for (let sim = 0; sim < NUM_SIMS; sim++) {
        let value = totalValue;
        const path = [value];
        for (let d = 0; d < DAYS; d++) {
          // Box-Muller transform for normal distribution
          const u1 = Math.random();
          const u2 = Math.random();
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          const dailyReturn = meanReturn + stdDev * z;
          value *= (1 + dailyReturn);
          path.push(value);
        }
        simResults.push(path);
      }

      // Calculate percentiles at each checkpoint
      const percentiles = checkpoints.map(day => {
        const values = simResults.map(path => path[day]).sort((a, b) => a - b);
        return {
          day,
          label: day === 21 ? '1 Month' : day === 63 ? '3 Months' : day === 126 ? '6 Months' : '1 Year',
          p10: values[Math.floor(NUM_SIMS * 0.1)],
          p25: values[Math.floor(NUM_SIMS * 0.25)],
          median: values[Math.floor(NUM_SIMS * 0.5)],
          p75: values[Math.floor(NUM_SIMS * 0.75)],
          p90: values[Math.floor(NUM_SIMS * 0.9)],
        };
      });

      // Fan chart data (sampled every 5 days)
      const fanChart = [];
      for (let d = 0; d <= DAYS; d += 5) {
        const values = simResults.map(path => path[d]).sort((a, b) => a - b);
        fanChart.push({
          day: d,
          p10: values[Math.floor(NUM_SIMS * 0.1)],
          p25: values[Math.floor(NUM_SIMS * 0.25)],
          median: values[Math.floor(NUM_SIMS * 0.5)],
          p75: values[Math.floor(NUM_SIMS * 0.75)],
          p90: values[Math.floor(NUM_SIMS * 0.9)],
        });
      }

      // Probability of profit
      const finalValues = simResults.map(path => path[DAYS]);
      const probProfit = (finalValues.filter(v => v > totalValue).length / NUM_SIMS * 100).toFixed(0);

      // Check goal
      const portfolio = Storage.getPortfolioById(portfolioId);
      let probGoal = null;
      if (portfolio?.goal?.targetAmount) {
        probGoal = (finalValues.filter(v => v >= portfolio.goal.targetAmount).length / NUM_SIMS * 100).toFixed(0);
      }

      setMonteCarloData({
        forPortfolio: portfolioId,
        startValue: totalValue,
        percentiles,
        fanChart,
        probProfit,
        probGoal,
        goalAmount: portfolio?.goal?.targetAmount,
        annualizedReturn: (meanReturn * 252 * 100).toFixed(1),
        annualizedVol: (stdDev * Math.sqrt(252) * 100).toFixed(1),
        covered: series.covered,
        positionsUsed: Math.min(MC_POSITIONS, mcPositions),
        positionsTotal: mcPositions,
      });
    } catch (e) {
      console.error('Monte Carlo error:', e);
      setMonteCarloData({ error: 'Simulation failed' });
    }
    setLoading(false);
  };

  // ==================== BACKTESTING ====================
  // The amount is text read by window.NumberInput ("10000,5" was 100005 in a
  // Chrome-EN number field); checked before a token is spent.
  const backtestAmountCheck = window.NumberInput ? window.NumberInput.check(backtestAmount) : { value: parseFloat(backtestAmount), error: null };
  const backtestAmountProblem = backtestAmountCheck.error
    || (!backtestAmountCheck.empty && !(backtestAmountCheck.value > 0) ? 'Amount must be more than 0' : null);
  // A result belongs to the inputs that produced it. After a changed amount
  // failed its check, "GBX 10,000 in VOD" from the run before stayed under
  // the form with "Amount must be more than 0" for AAPL.
  // The Monte Carlo chart's width, for its scales: at 320 the 56 px value
  // gutter left a 116 x 58 px chart and "Today" ran into "3 Mo". Measured on the box that holds the scale and the chart.
  const [mcWidth, setMcWidth] = React.useState(0);
  const mcObserver = React.useRef(null);
  const mcBoxRef = React.useCallback((node) => {
    if (mcObserver.current) { mcObserver.current.disconnect(); mcObserver.current = null; }
    if (!node) return;
    const measure = () => setMcWidth(Math.round(node.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'function') {
      mcObserver.current = new ResizeObserver(measure);
      mcObserver.current.observe(node);
    }
  }, []);
  const backtestInputsSeen = React.useRef(null);
  React.useEffect(() => {
    const now = [backtestSymbol, backtestAmount, backtestDate].join('|');
    if (backtestInputsSeen.current !== null && backtestInputsSeen.current !== now) { setBacktestResult(null); backtestRunRef.current = null; backtestGenRef.current += 1; }
    backtestInputsSeen.current = now;
  }, [backtestSymbol, backtestAmount, backtestDate]);
  // A code typed without its exchange, read as What-If reads it, through the
  // one reader (window.SymbolCode): the held listing, a crypto pair on CC, a
  // currency pair on FOREX, "^GSPC" the index, "BRK.B" the share class, else
  // the US listing. "BTC-USD" -- the field's own example without ".CC" --
  // was asked as BTC-USD.US, and "^GSPC", "SOL-NZD",
  // "BRK.B" still went to the wrong place. '' when the
  // text names nothing.
  // The EODHD symbol, not the position's storage key: What-If maps a code to
  // the held key to simulate that position, but a history request needs the
  // canonical code -- a legacy "BRK.B" holding sent BRK.B for a typed
  // BRK-B.US.
  const backtestFullSymbol = (typed) => (window.SymbolCode.of(typed, { held: holdings.map(h => h && h.symbol).filter(Boolean) }) || '');
  // The two histories get a cap of their own (PT_BACKTEST_WAIT_MS, 20 s):
  // the terminal's requests have none, and a hung answer kept "Running..."
  // up for good. { value } when it came, { hung: true } when it did not.
  const backtestWait = (p) => new Promise(resolve => {
    const t = setTimeout(() => resolve({ hung: true }), window.PT_BACKTEST_WAIT_MS || 20000);
    Promise.resolve(p).then(v => { clearTimeout(t); resolve({ value: v }); }, (e) => { clearTimeout(t); resolve({ value: null, error: e || null }); });
  });
  // A history asked for with its refusal kept (status on the error).
  const askHistory = (symbol, from, to) => Promise.resolve().then(() => window.EODHD_API.getHistoricalData(apiKey, symbol, from, to, undefined, { throwErrors: true }));
  // The status a failed history answered with: EODHD's own where the proxy
  // passes it on (upstream_status), a plan refusal as 403. 0: no answer.
  const refusalStatus = (got) => {
    const e = got && got.error;
    if (!e || got.hung) return 0;
    if (e.planRequired) return 403;
    const st = Number(e.status) || 0;
    const up = Number(e.upstreamStatus) || 0;
    return st >= 500 && up ? up : st;
  };
  // Every failure read "did not load -- EODHD did not answer": a symbol
  // EODHD has no data for (404), a plan refusal and the request
  // limit (429) too, for the instrument and for SPY.
  // `err`: what the client threw. An answer that could not be read (a page
  // with 200, {"message"}) and EODHD's own error (5xx) are named as on
  // every screen (RateLimitWait.failReason), not "did not answer".
  const historyProblem = (symbol, status, err) => {
    if (err && err.unreadable && status !== 429) return `The price history of ${symbol} did not load: ${window.RateLimitWait.UNREADABLE} Press Run Backtest to try again.`;
    if (status >= 500) return `The price history of ${symbol} did not load: EODHD answered with an error (${status}). Press Run Backtest to try again.`;
    if (status === 404) return `EODHD has no price history for ${symbol}. Check the code and its exchange.`;
    if (status === 402 || status === 403) return `The price history of ${symbol} is not included in your EODHD plan (EODHD answered ${status}).`;
    // The wait is the shared one, counted down on the button below: "Wait a
    // minute" was wrong for a Retry-After of 20 s.
    if (status === 429) return window.RateLimitWait.REACHED + ' Run the backtest again when the wait is over.';
    if (status === 401) return `EODHD did not accept the API key (401), so the price history of ${symbol} did not load.`;
    return `The price history of ${symbol} did not load — EODHD did not answer. Press Run Backtest to try again.`;
  };
  // The instrument's quote currency, as What-If takes it: the held
  // position's, else the search's row for that listing, else the one its
  // exchange usually quotes in. CSPX.LSE is in dollars and VUSA.LSE in
  // pounds; the suffix alone made both pence.
  const backtestCcyRef = React.useRef({});
  const backtestCurrencyOf = (symbol) => {
    const held = holdings.find(h => h.symbol && String(h.symbol).toUpperCase() === symbol);
    return window.BacktestCurrency.lookup(symbol, {
      held: held && held.currency,
      search: (code) => backtestWait(Promise.resolve().then(() => window.EODHD_API.searchStocks(apiKey, code))).then(got => got.value),
      cache: backtestCcyRef.current,
      asked: backtestCcyAsked.current,
    });
  };
  // Asked as the symbol is typed (after a pause), so the amount's label
  // names the currency the run will use before Run is pressed.
  const backtestCcyAsked = React.useRef({});
  const [backtestCcyRev, setBacktestCcyRev] = React.useState(0);
  const backtestCcyPending = (full) => {
    const ex = full.slice(full.lastIndexOf('.') + 1);
    if (['US', 'CC', 'FOREX', 'INDX'].includes(ex)) return false;
    if (holdings.some(h => h.symbol && String(h.symbol).toUpperCase() === full && h.currency)) return false;
    return !backtestCcyRef.current[full];
  };
  React.useEffect(() => {
    const full = backtestFullSymbol(backtestSymbol || '');
    if (!full || !full.includes('.') || !backtestCcyPending(full)) return undefined;
    let gone = false;
    const t = setTimeout(() => { backtestCurrencyOf(full).then(() => { if (!gone) setBacktestCcyRev(n => n + 1); }, () => {}); }, 400);
    return () => { gone = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backtestSymbol]);
  // The run the result on screen came from, for asking the S&P again.
  const backtestRunRef = React.useRef(null);
  // One number per run, moved on by a new run and by changed inputs: a run
  // still out when the amount or symbol changed must not draw its result
  // over the cleared form.
  const backtestGenRef = React.useRef(0);
  const [benchmarkRetrying, setBenchmarkRetrying] = React.useState(false);
  const runButtonRef = React.useRef(null);
  const vsHeadingRef = React.useRef(null);
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();
  // The comparison from what SPY answered: null or [] (a 500, a 429, a
  // timeout, nothing) is "did not load"; data with no day in common with
  // the instrument is "nothing to compare". The block said neither and
  // just went away.
  const backtestFrom = (run, spyAnswer, spyStatus, spyErr) => {
    // An error body ({ error }) is no history either.
    const spyHist = Array.isArray(spyAnswer) ? spyAnswer : null;
    const r = Calc.investmentBacktest(run.hist, spyHist, run.amount, run.ccy);
    if (!r) return null;
    const spyMissing = r.spyReturn != null ? null
      : !(spyHist && spyHist.length) ? 'failed' : 'no-overlap';
    return { symbol: run.symbol.split('.')[0], fullSymbol: run.symbol, isIndex: /\.INDX$/.test(run.symbol), priceIndex: Calc.isPriceIndex(run.symbol), amount: run.amount, ...r, spyMissing, spyStatus: spyMissing === 'failed' ? (spyStatus || 0) : 0,
      // SPY's answer could not be read (said as that).
      spyUnreadable: spyMissing === 'failed' && Boolean(spyErr && spyErr.unreadable) && spyStatus !== 429 };
  };
  const runBacktest = async (e) => {
    if (!backtestSymbol || backtestAmountProblem) return;
    // The button is disabled while the run is out, and the focus fell to
    // <body>: the next Tab went to the top of the page. It goes back to the
    // button once it is enabled again.
    if (e && e.currentTarget && document.activeElement === e.currentTarget) focusNext(() => runButtonRef.current);
    // Text that names no ticker ("..", "a b") is said, not asked for.
    if (!backtestFullSymbol(backtestSymbol)) { setBacktestResult({ error: window.SymbolCode.problem(window.SymbolCode.read(backtestSymbol), backtestSymbol) }); return; }
    // A start date in the future read "No historical data".
    if (backtestDate && backtestDate > Calc.todayISO()) { setBacktestResult({ error: `${backtestDate} is in the future — pick a start date in the past.` }); return; }
    // Free: two price histories and arithmetic in the browser, no model. It
    // used to spend 3 AI tokens booked as "What-If Scenario" and refuse to run
    // without them.
    setLoading(true);
    backtestRunRef.current = null;
    const gen = ++backtestGenRef.current;
    const stale = () => gen !== backtestGenRef.current;
    try {
      const symbol = backtestFullSymbol(backtestSymbol);
      const amount = backtestAmountCheck.value || 10000;
      const today = new Date().toISOString().split('T')[0];

      const assetAsk = askHistory(symbol, backtestDate, today);
      const spyAsk = askHistory('SPY.US', backtestDate, today);
      const [assetGot, spyGot, assetCcy] = await Promise.all([
        backtestWait(assetAsk),
        backtestWait(spyAsk),
        backtestCurrencyOf(symbol).catch(() => Calc.currencyFromSymbol(symbol)),
      ]);
      const assetHist = assetGot.value;
      // A history that came after the wait is still the answer for these
      // inputs: the error is replaced if nothing with data is on screen, even
      // when the user pressed Run again and that run failed. Changed inputs (another symbol, amount or date) drop it.
      const inputs = [backtestSymbol, backtestAmount, backtestDate].join('|');
      const sameInputs = () => backtestInputsSeen.current === inputs;
      if (assetGot.hung) {
        // The instrument's figures go up as soon as its history comes; the
        // comparison fills in when (if) SPY answers -- a SPY still hanging
        // does not hold them back.
        let spyLate;
        Promise.resolve(spyAsk).then((sh) => { spyLate = sh; }, () => { spyLate = null; });
        Promise.resolve(assetAsk).then((ah) => {
          if (!Array.isArray(ah) || ah.length < 2 || !sameInputs() || backtestRunRef.current) return;
          const lateRun = { symbol, amount, ccy: assetCcy, hist: ah, from: backtestDate, to: today };
          const lr = backtestFrom(lateRun, Array.isArray(spyLate) ? spyLate : null, 0);
          if (!lr) return;
          backtestRunRef.current = lateRun;
          setBacktestResult(lr);
          if (spyLate !== undefined) return;
          Promise.resolve(spyAsk).then((sh) => {
            if (backtestRunRef.current !== lateRun || !Array.isArray(sh) || !sh.length || !sameInputs()) return;
            const withSpy = backtestFrom(lateRun, sh, 0);
            if (!withSpy || withSpy.spyMissing === 'failed') return;
            lateRun.spyDone = true;
            setBacktestResult(withSpy);
          }, () => {});
        }, () => {});
      } else if (spyGot.hung) {
        // The comparison came late: it fills in under the instrument's figures.
        Promise.resolve(spyAsk).then((sh) => {
          const cur = backtestRunRef.current;
          if (!Array.isArray(sh) || !sh.length || !cur || cur.symbol !== symbol || cur.from !== backtestDate || !sameInputs()) return;
          const lr = backtestFrom(cur, sh, 0);
          if (!lr || lr.spyMissing === 'failed') return;
          cur.spyDone = true;
          setBacktestResult(lr);
        }, () => {});
      }
      if (stale()) { setLoading(false); return; }

      // Not answered is not "no data": a 500, a refusal or a hang said "No
      // historical data found", as if the instrument had none. Each refusal
      // says what it is.
      if (assetGot.hung || assetHist == null) {
        // An older run's history landed while this one was out: it stays.
        if (backtestRunRef.current) { setLoading(false); return; }
        const st = refusalStatus(assetGot);
        setBacktestResult({ error: historyProblem(symbol, st, assetGot.error), limited: st === 429 });
        setLoading(false);
        return;
      }
      // A body that is no list of bars ({"message"} with 200) could not be
      // read: not "no historical data".
      if (!Array.isArray(assetHist) && assetHist && typeof assetHist === 'object') {
        if (backtestRunRef.current) { setLoading(false); return; }
        setBacktestResult({ error: historyProblem(symbol, 200, { unreadable: true }) });
        setLoading(false);
        return;
      }
      if (!Array.isArray(assetHist) || assetHist.length < 2) {
        setBacktestResult({ error: 'No historical data found for ' + symbol });
        setLoading(false);
        return;
      }

      // Adjusted closes, SPY over the same dates, alpha only within USD —
      // see Calc.investmentBacktest.
      const run = { symbol, amount, ccy: assetCcy, hist: assetHist, from: backtestDate, to: today };
      const spyOdd = !spyGot.hung && spyGot.value && typeof spyGot.value === 'object' && !Array.isArray(spyGot.value);
      const r = backtestFrom(run, spyGot.hung ? null : spyGot.value, refusalStatus(spyGot), spyOdd ? { unreadable: true } : spyGot.error);
      if (!r) {
        setBacktestResult({ error: 'No historical data found for ' + symbol });
        setLoading(false);
        return;
      }
      backtestRunRef.current = run;
      setBacktestResult(r);
    } catch (e) {
      console.error('Backtest error:', e);
      setBacktestResult({ error: 'Backtest failed: ' + e.message });
    }
    setLoading(false);
  };
  // "Try again" on a comparison that did not load: SPY alone is asked again
  // (an empty answer was cached as if it were the history), the instrument's
  // figures stay. Once it is in, the focus is on the block's heading -- the
  // button is gone.
  const retryBenchmark = async () => {
    const run = backtestRunRef.current;
    if (!run || benchmarkRetrying) return;
    setBenchmarkRetrying(true);
    try {
      const CM = window.CacheManager;
      if (CM && CM.invalidate) CM.invalidate('historical', `SPY.US:${run.from}:${run.to}:d`);
    } catch (_) { /* asked anyway */ }
    const got = await backtestWait(askHistory('SPY.US', run.from, run.to));
    setBenchmarkRetrying(false);
    // The inputs changed (or another run started) while it was out.
    if (backtestRunRef.current !== run) return;
    const odd = !got.hung && got.value && typeof got.value === 'object' && !Array.isArray(got.value);
    const r = backtestFrom(run, got.hung ? null : got.value, refusalStatus(got), odd ? { unreadable: true } : got.error);
    if (!r) return;
    // The first comparison came late and is on screen: a failed retry leaves it.
    if (run.spyDone && r.spyMissing === 'failed') return;
    setBacktestResult(r);
    // The button is gone unless it failed again (a comparison, or "nothing
    // in common"): the focus goes to the block's heading.
    if (r.spyMissing !== 'failed') focusNext(() => vsHeadingRef.current);
  };

  const formatMonth = (monthStr) => {
    if (monthStr === 'upcoming') return 'Upcoming';
    const [year, month] = monthStr.split('-');
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const AllocationBar = ({ data, colorMap, labelMap }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {data.map((item, i) => {
        const key = item.type || item.sector || item.currency;
        const color = typeof colorMap === 'object' && !Array.isArray(colorMap) ? colorMap[key] || '#6b7280' : colorMap[i % colorMap.length];
        const label = labelMap ? labelMap[key] || key : key;
        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 8, fontSize: 14, marginBottom: 4 }}>
              <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>{label}</span>
              <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{item.percent.toFixed(1)}% ({Calc.formatCurrency(item.value, baseCurrency)})</span>
            </div>
            <div style={{ width: '100%', borderRadius: 999, height: 12, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
              <div style={{ height: 12, borderRadius: 999, transition: 'width 200ms ease', width: `${item.percent}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );

  const isEmbedded = embedded || (window.APP_PLATFORM === 'WEB');
  // The web's underlined tabs for the section switcher (design stage 2).
  const analyticsWebTabs = window.APP_PLATFORM === 'WEB';

  return (
    <div style={isEmbedded ? { color: isDark ? C3.textDark : C3.textLightTheme, fontFamily: "'Sora', sans-serif" } : styles.container}>
      {/* Glow Effects — TG only */}

      {/* Header — TG only */}
      {!isEmbedded && (
        <div style={styles.header}>
          <button aria-label="Back" onClick={onClose} style={styles.iconButton}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Portfolio Analytics</h1>
            <p style={{ fontSize: 12, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Analytics & Performance</p>
          </div>
        </div>
      )}

      {/* Tabs — hidden in compact mode (single tab, no picker needed) */}
      {!(compact && allowedTabs && allowedTabs.length <= 1) && (
      <div style={isEmbedded ? { marginBottom: 16 } : { padding: '12px 16px', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
        {/* Tabs to a screen reader too: the open one was marked by colour
            alone. Arrows, Home and End move between them.
            Web: underlined text tabs (the terminal's stylesheet .mi-tabbar, design stage
            2); the Mini App keeps its pills. */}
        <div role="tablist" aria-label="Analytics sections" className={analyticsWebTabs ? 'mi-tabbar' : undefined} onKeyDown={(e) => {
          const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
          if (!keys[e.key] || !e.target || e.target.getAttribute('role') !== 'tab') return;
          const tabs = [...e.currentTarget.querySelectorAll('[role="tab"]')];
          const i = tabs.indexOf(e.target);
          const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + keys[e.key] + tabs.length) % tabs.length];
          if (!next) return;
          e.preventDefault();
          next.focus();
          next.click();
        }} style={analyticsWebTabs ? undefined : { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {[
            { id: 'allocation', label: 'Allocation', icon: 'chart' },
            { id: 'risk', label: 'Risk', icon: 'alert' },
            { id: 'performance', label: 'Performance', icon: 'trendUp' },
            { id: 'dividends', label: 'Dividends', icon: 'dollar' },
            { id: 'benchmark', label: 'Benchmark', icon: 'activity' },
            { id: 'correlation', label: 'Correlation', icon: 'map' },
            { id: 'montecarlo', label: 'Monte Carlo', icon: 'trendUp' },
            { id: 'backtest', label: 'Backtest', icon: 'search' },
            { id: 'whatif', label: 'What-If', icon: 'zap' }
          ].filter(t => !allowedTabs || allowedTabs.includes(t.id)).map(tab => analyticsWebTabs ? (
            <button key={tab.id} type="button" className="mi-tab" role="tab" aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ) : (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: isEmbedded ? '6px 14px' : '8px 16px',
                borderRadius: isEmbedded ? 4 : 12,
                border: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
                fontWeight: isEmbedded ? 600 : 500,
                fontSize: isEmbedded ? 12 : 14,
                fontFamily: "'Sora', sans-serif",
                background: activeTab === tab.id
                  ? (isEmbedded ? 'rgba(249,115,22,0.15)' : C3.logoGradient)
                  : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)'),
                // Light theme: orange on its own light tint was 2.19:1.
                color: activeTab === tab.id
                  ? (isEmbedded ? (isDark ? '#f97316' : '#9a3412') : 'white')
                  : (isDark ? 'rgba(255,255,255,0.5)' : C3.textLightTheme),
              }}
            >
              {!isEmbedded && <Icon name={tab.icon} size={16} color={activeTab === tab.id ? 'white' : isDark ? C3.textDark : C3.textLightTheme} />}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Content */}
      <div style={{ padding: compact ? 8 : 16 }}>
        {/* Allocation Tab */}
        {activeTab === 'allocation' && (
          <>
            <div style={compact ? { ...styles.card, padding: 10, marginBottom: 10 } : styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: compact ? 10 : 16, marginTop: 0, fontSize: compact ? 12 : undefined }}>By Asset Type</h3>
              {allocationByType.length > 0 ? <AllocationBar data={allocationByType} colorMap={COLORS.type} labelMap={TYPE_LABELS} />
                : <p style={{ textAlign: 'center', padding: compact ? 8 : 16, color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: compact ? 12 : undefined }}>{pricesLoading ? 'Loading prices…' : needsPrices ? <>{needsPricesWords}{retryPrices}</> : 'No holdings yet'}</p>}
            </div>
            <div style={compact ? { ...styles.card, padding: 10, marginBottom: 10 } : styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: compact ? 10 : 16, marginTop: 0, fontSize: compact ? 12 : undefined }}>By Sector</h3>
              {allocationBySector.length > 0 ? <AllocationBar data={allocationBySector} colorMap={COLORS.sector} labelMap={sectorsLoading ? { [Calc.UNCLASSIFIED_SECTOR]: 'Sector loading…' } : undefined} />
                : <p style={{ textAlign: 'center', padding: compact ? 8 : 16, color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: compact ? 12 : undefined }}>{pricesLoading ? 'Loading prices…' : sectorsLoading ? 'Loading sectors…' : needsPrices ? needsPricesWords : 'No sector data'}</p>}
            </div>
            <div style={compact ? { ...styles.card, padding: 10, marginBottom: 10 } : styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: compact ? 10 : 16, marginTop: 0, fontSize: compact ? 12 : undefined }}>By Currency</h3>
              {/* Empty is "nothing valued", not one currency: with every
                  price refused it read "Single currency portfolio". */}
              {allocationByCurrency.length > 0 ? <AllocationBar data={allocationByCurrency} colorMap={COLORS.sector} />
                : <p style={{ textAlign: 'center', padding: compact ? 8 : 16, color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: compact ? 12 : undefined }}>{pricesLoading ? 'Loading prices…' : needsPrices ? needsPricesWords : 'No holdings yet'}</p>}
            </div>

            {/* Geography Allocation */}
            <div style={compact ? { ...styles.card, padding: 10, marginBottom: 10 } : styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: compact ? 10 : 16, marginTop: 0, fontSize: compact ? 12 : undefined }}>By Geography</h3>
              {allocationByCountry.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {allocationByCountry.map((item, i) => (
                    <div key={item.country}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 11 : 14, marginBottom: compact ? 2 : 4 }}>
                        <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>
                          {item.flag} {item.country}
                        </span>
                        <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                          {item.percent.toFixed(1)}% ({Calc.formatCurrency(item.value, baseCurrency)})
                        </span>
                      </div>
                      <div style={{ width: '100%', borderRadius: 999, height: compact ? 8 : 12, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                        <div style={{ height: compact ? 8 : 12, borderRadius: 999, transition: 'width 200ms ease', width: `${item.percent}%`, background: COLORS.sector[i % COLORS.sector.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ textAlign: 'center', padding: 16, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{pricesLoading ? 'Loading prices…' : needsPrices ? needsPricesWords : 'No geographic data'}</p>
              )}
            </div>
          </>
        )}

        {/* Risk Tab */}
        {activeTab === 'risk' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <div style={{ width: 32, height: 32, border: '3px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Calculating risk metrics...</p>
              </div>
            ) : riskMetrics ? (
              <>
                {/* Risk Level Summary */}
                <div style={styles.card}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h3 style={{ fontWeight: 600, margin: 0 }}>Risk Dashboard</h3>
                    <span style={{
                      padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: !riskMetrics.riskLevel ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') : riskMetrics.riskLevel === 'High' ? `${C3.error}30` : riskMetrics.riskLevel === 'Moderate' ? `${C3.warning}30` : `${C3.success}30`,
                      // On its own tint: green on green read 4.17:1 in the light
                      // theme. Taken to AA on that tint, no further.
                      color: !riskMetrics.riskLevel ? (isDark ? C3.textMutedDark : C3.textMutedLight) : badgeInk(riskMetrics.riskLevel === 'High' ? C3.error : riskMetrics.riskLevel === 'Moderate' ? C3.warning : C3.success)
                    }}>
                      {riskMetrics.riskLevel ? `${riskMetrics.riskLevel} Risk` : 'Not measured'}
                    </span>
                  </div>

                  {/* Risk Meter */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                      <span>Low</span>
                      <span>Moderate</span>
                      <span>High</span>
                    </div>
                    {/* The knob sits where the badge says. It was moved by a
                        percentage of its own 16 px (translateX), so a score of
                        2 of 5 -- "Moderate Risk" -- left it 6 px from the
                        "Low" end. The badge's thresholds are the rule: under
                        2 Low, 2-3 Moderate, 4-5 High; the knob takes the
                        middle of its band, moved along the bar itself. */}
                    <div style={{ width: '100%', height: 12, borderRadius: 999, background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)' }}>
                      {riskMetrics.riskLevel && (() => {
                        const at = riskMetrics.riskLevel === 'High' ? (riskMetrics.riskScore >= 5 ? 100 : 85) : riskMetrics.riskLevel === 'Moderate' ? (riskMetrics.riskScore >= 3 ? 60 : 45) : (riskMetrics.riskScore >= 1 ? 15 : 0);
                        return <div data-risk-knob={at} style={{
                          width: 16, height: 16, borderRadius: '50%', background: 'white', border: '3px solid #1a1a2e',
                          marginLeft: `calc(${at}% - ${(at / 100 * 16).toFixed(1)}px)`,
                          transform: 'translateY(-2px)',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
                        }} />;
                      })()}
                    </div>
                  </div>

                  {/* Risk Metrics Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: tileRow(128, 2, 12), gap: 12 }}>
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Portfolio Beta</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: riskMetrics.beta == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : riskMetrics.beta > 1.2 ? C3.error : riskMetrics.beta > 1 ? C3.warning : C3.success }}>
                        {riskMetrics.beta == null ? 'N/A' : riskMetrics.beta.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                        {riskMetrics.beta == null
                          ? 'Needs fundamentals data — none came back'
                          : riskMetrics.beta > 1.02 ? 'More volatile than market' : riskMetrics.beta < 0.98 ? 'Less volatile than market' : 'Moves with the market'}
                      </div>
                    </div>

                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Volatility (Ann.)</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: riskMetrics.volatility == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : riskMetrics.volatility > 25 ? C3.error : riskMetrics.volatility > 15 ? C3.warning : C3.success }}>
                        {riskMetrics.volatility == null ? 'N/A' : `${riskMetrics.volatility.toFixed(1)}%`}
                      </div>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                        {riskMetrics.volatility == null ? noHistoryWords(riskMetrics) : 'Standard deviation of daily returns'}
                      </div>
                    </div>

                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Sharpe Ratio</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: riskMetrics.sharpeRatio == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : riskMetrics.sharpeRatio > 1 ? C3.success : riskMetrics.sharpeRatio > 0 ? C3.warning : C3.error }}>
                        {riskMetrics.sharpeRatio == null ? 'N/A' : riskMetrics.sharpeRatio.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                        {riskMetrics.sharpeRatio == null
                          ? (riskMetrics.volatility == null ? noHistoryWords(riskMetrics) : 'Risk-free rate unavailable')
                          : riskMetrics.sharpeRatio > 1 ? 'Good risk-adjusted return' : `vs ${riskMetrics.riskFreeRate.toFixed(2)}% UST 10Y`}
                      </div>
                    </div>

                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12 }}>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>VaR (95%, 1-day)</div>
                      <div style={{ ...figure(15, 5.2, 20), fontWeight: 700, color: riskMetrics.var95 == null ? (isDark ? C3.textMutedDark : C3.textMutedLight) : C3.error }}>
                        {riskMetrics.var95 == null ? 'N/A' : `-${Calc.formatCurrency(riskMetrics.var95, baseCurrency)}`}
                      </div>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                        {riskMetrics.var95 == null ? noHistoryWords(riskMetrics) : 'Worst 5% of days, historical'}
                      </div>
                    </div>
                  </div>

                  {/* What the numbers rest on. A risk figure without its window
                      and coverage is a number with no way to argue with it. */}
                  {riskMetrics.historyFailed && (
                    <RLW.FailNote panel="risk" what={historyWhat(riskMetrics.historyFailedCount)} failure={riskMetrics.historyFailed} onRetry={loadRiskMetrics} isDark={isDark}
                      extra={riskMetrics.insufficientHistory ? '' : 'The figures leave those positions out.'}
                      style={{ fontSize: 12, marginTop: 10 }} buttonStyle={{ fontFamily: "'Sora', sans-serif" }} />
                  )}
                  <div style={{ fontSize: 11, marginTop: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                    {riskMetrics.insufficientHistory
                      ? (riskMetrics.historyFailed ? 'Volatility, Sharpe and VaR are measured on a year of daily prices.' : 'Volatility, Sharpe and VaR need at least 20 trading days of price history for the priced positions.')
                      : `Measured over the last ${riskMetrics.historyDays} trading days at today's weights, covering ${(riskMetrics.covered * 100).toFixed(0)}% of portfolio value` +
                        (riskMetrics.maxDrawdown != null ? `; max drawdown ${riskMetrics.maxDrawdown.toFixed(1)}%` : '') +
                        (riskMetrics.annualReturn != null ? `; annualised return ${riskMetrics.annualReturn >= 0 ? '+' : ''}${riskMetrics.annualReturn.toFixed(1)}%` : '') + '.'}
                  </div>
                </div>

                {/* Concentration Warnings */}
                {riskMetrics.concentrationWarnings.length > 0 && (
                  <div style={{ ...styles.card, border: `1px solid ${C3.warning}40` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Icon name="alert" size={20} color={C3.warning} />
                      <h3 style={{ fontWeight: 600, margin: 0, color: C3.warning }}>Concentration Warnings</h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {riskMetrics.concentrationWarnings.map((warning, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10,
                          background: isDark ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.1)'
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: warning.type === 'position' ? '#f9731620' : '#3b82f620'
                          }}>
                            <Icon name={warning.type === 'position' ? 'chart' : 'briefcase'} size={18} color={warning.type === 'position' ? '#f97316' : '#3b82f6'} />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{warning.message}</div>
                            {/* On the amber wash, not the page: 4.04:1 in the dark theme. */}
                            <div style={{ fontSize: 12, color: isDark ? '#b3ab99' : C3.textMutedLight }}>
                              Consider diversifying to reduce risk
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Risk Explanation */}
                <div style={{ ...(isDark ? { background: 'rgba(255,255,255,0.05)' } : { background: 'rgba(0,0,0,0.05)' }), borderRadius: 12, padding: 12, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  <strong>About these metrics:</strong>
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: 16 }}>
                    <li><b>Beta</b>: Measures volatility vs S&P 500. Beta {'>'} 1 = more volatile.</li>
                    <li><b>Sharpe Ratio</b>: Risk-adjusted return. Higher is better (1+ is good).</li>
                    <li><b>VaR</b>: Maximum expected loss on 95% of trading days.</li>
                  </ul>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <Icon name="alert" size={48} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 12 }}>Unable to calculate risk metrics</p>
              </div>
            )}
          </>
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && (
          <div style={styles.card}>
            <h3 style={{ fontWeight: 600, marginBottom: 16, marginTop: 0 }}>Portfolio Growth</h3>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <div style={{ width: 32, height: 32, border: '3px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
              </div>
            ) : performanceData.length > 0 ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: tileRow(104, 3, 16), gap: 16, marginBottom: 16 }}>
                  <div style={{ textAlign: 'center' }}>
                    {/* Buys minus sales -- cash that went in and has not come
                        back out. Labelled "Invested" it read as a market value,
                        and after a profitable sale it went negative. */}
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }} title="Buys minus sales; negative once sales have returned more cash than was put in">Net cash in</div>
                    <div style={{ fontWeight: 600, color: acc('#f97316') }}>{Calc.formatCurrency(performanceData[performanceData.length - 1]?.invested || 0, baseCurrency)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Current Value</div>
                    {/* Shares held and no price for any of them is not a
                        value of $0.00; with some
                        priced, the figure says how many it leaves out. */}
                    {unpricedHeld > 0 && !anyPricedHeld
                      ? <>
                          <div style={{ fontWeight: 600, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>N/A</div>
                          <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>needs current prices</div>
                        </>
                      : <>
                          <div style={{ fontWeight: 600, color: C3.success }}>{Calc.formatCurrency(performanceData[performanceData.length - 1]?.value || 0, baseCurrency)}</div>
                          {unpricedHeld > 0 && <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>excl. {unpricedHeld} unpriced</div>}
                        </>}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Dividends</div>
                    <div style={{ fontWeight: 600, color: acc('#3b82f6') }}>{Calc.formatCurrency(performanceData[performanceData.length - 1]?.dividends || 0, baseCurrency)}</div>
                  </div>
                </div>
                {/* Why the value leaves positions out, when it is known. */}
                {unpricedHeld > 0 && unpricedWhyText && (
                  <p data-unpriced-why="true" style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5, textAlign: 'center', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{unpricedWhyText}{retryPrices}</p>
                )}
                <div style={{ borderTop:`1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, paddingTop: 16 }}>
                  <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 8 }}>Investment History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {performanceData.slice(-12).map((data) => {
                      const maxInvested = Math.max(...performanceData.map(d => d.invested || 0));
                      const width = maxInvested > 0 ? ((data.invested || 0) / maxInvested) * 100 : 0;
                      return (
                        <div key={data.month} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 64, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{formatMonth(data.month)}</div>
                          <div style={{ flex: 1, borderRadius: 8, height: 16, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                            <div style={{ height: 16, borderRadius: 8, background: '#f97316', width: `${width}%` }} />
                          </div>
                          <div style={{ width: 96, textAlign: 'right', fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{Calc.formatCurrency(data.invested || 0, baseCurrency)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>No transaction history yet</p>
            )}
          </div>
        )}

        {/* Dividends Tab */}
        {activeTab === 'dividends' && (
          <>
            {/* Dividend Projections */}
            <div style={styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0 }}>Projected Income</h3>
              {dividendProjection && dividendProjection.needsPrices ? (
                <p style={{ margin: 0, padding: '8px 0', fontSize: 13, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  Projected income needs current prices — none came back for your {dividendProjection.unpriced} holding{dividendProjection.unpriced === 1 ? '' : 's'}.{unpricedWhyText ? ' ' + unpricedWhyText : ''} Dividends you record still count in Historical Income below.{retryPrices}
                </p>
              ) : dividendProjection && dividendProjection.unavailable && dividendProjection.failed ? (
                <p style={{ margin: 0, padding: '8px 0', fontSize: 13, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  <span role="status">{window.RateLimitWait.failText('Projected income needs the Fundamentals feed, which', dividendProjection.failed)}</span> Dividends you record still count in Historical Income below.
                </p>
              ) : dividendProjection && dividendProjection.unavailable ? (
                <p style={{ margin: 0, padding: '8px 0', fontSize: 13, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  Projected income unavailable — it needs the Fundamentals feed (dividend yield and per-share dividend), which this EODHD plan did not return for any of your {dividendProjection.asked} holding{dividendProjection.asked === 1 ? '' : 's'}. Dividends you record still count in Historical Income below.
                </p>
              ) : dividendProjection ? (
                <>
                  {dividendProjection.unpriced > 0 && (
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                      Estimate leaves out {dividendProjection.unpriced} holding{dividendProjection.unpriced === 1 ? '' : 's'} with no current price.{unpricedWhyText ? ' ' + unpricedWhyText : ''}{unpricedWhyText ? retryPrices : null}
                    </p>
                  )}
                  {dividendProjection.partial > 0 && (
                    <p style={{ margin: '0 0 12px', fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                      Estimate leaves out {dividendProjection.partial} holding{dividendProjection.partial === 1 ? '' : 's'} with no fundamentals data.
                    </p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: tileRow(112, 3, 12), gap: 12, marginBottom: 16 }}>
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Annual (Est.)</div>
                      <div style={{ ...figure(14, 4.8, 18), fontWeight: 700, color: acc('#3b82f6') }}>{Calc.formatCurrency(dividendProjection.annualDividend, baseCurrency)}</div>
                    </div>
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Yield</div>
                      <div style={{ ...figure(14, 4.8, 18), fontWeight: 700, color: C3.success }}>{dividendProjection.portfolioYield.toFixed(2)}%</div>
                    </div>
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Monthly</div>
                      <div style={{ ...figure(14, 4.8, 18), fontWeight: 700 }}>{Calc.formatCurrency(dividendProjection.annualDividend / 12, baseCurrency)}</div>
                    </div>
                  </div>

                  {/* Monthly Bar Chart - Data-Driven */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 8 }}>Monthly Projection</div>
                    {(() => {
                      const maxAmount = Math.max(...dividendProjection.monthlyProjection.map(m => m.amount), 1);
                      const chartHeight = 80;
                      const bar = (m, i) => {
                        const barH = Math.max(4, (m.amount / maxAmount) * chartHeight);
                        const amountStr = m.amount >= 1000 ? `${(m.amount / 1000).toFixed(1)}k` : m.amount >= 1 ? Calc.formatCurrency(m.amount, baseCurrency, 0) : '';
                        return (
                          <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            {amountStr && <span style={{ fontSize: 8, color: acc('#3b82f6'), fontWeight: 600, marginBottom: 2 }}>{amountStr}</span>}
                            <div style={{
                              width: '100%', borderRadius: '4px 4px 0 0', height: barH,
                              background: m.amount > 0
                                ? '#3b82f6'
                                : isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                              transition: 'height 0.5s ease',
                            }} />
                            <span style={{ fontSize: 9, marginTop: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{m.month}</span>
                          </div>
                        );
                      };
                      const months = dividendProjection.monthlyProjection;
                      // One row of twelve, or -- in a card under 300 px -- two
                      // rows of six. Each row has its own height, so nothing
                      // draws over the next card (it did when the one row
                      // simply wrapped), and nothing scrolls out of sight.
                      const rows = projNarrow ? [months.slice(0, 6), months.slice(6)] : [months];
                      return (
                        <div ref={projRef} role="group" aria-label={'Monthly projection: ' + months.map(m => m.month + ' ' + Calc.formatCurrency(m.amount, baseCurrency, 0)).join(', ')} data-proj-rows={rows.length}>
                          {rows.map((row, r) => (
                            <div key={r} aria-hidden="true" style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-end', gap: 3, height: chartHeight + 20, marginTop: r ? 16 : 0 }}>
                              {row.map((m, i) => bar(m, r * 6 + i))}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Upcoming Ex-Dividend Dates */}
                  {dividendProjection.upcomingDividends.length > 0 && (
                    <div style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, paddingTop: 12 }}>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 8 }}>Upcoming Ex-Dividend Dates</div>
                      {dividendProjection.upcomingDividends.slice(0, 5).map((div, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < dividendProjection.upcomingDividends.length - 1 ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}` : 'none' }}>
                          <div>
                            <span style={{ fontWeight: 600 }}>{div.symbol}</span>
                            <span style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginLeft: 8 }}>{div.exDate}</span>
                          </div>
                          <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: C3.success + '20', color: C3.success }}>
                            in {div.daysUntil} days
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ textAlign: 'center', padding: 16, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{pricesLoading ? 'Loading prices…' : (dividendLoading || dividendProjectionState) ? 'Loading dividend data…' : 'No dividend data available'}</p>
              )}
            </div>

            {/* Historical Dividend Income */}
            <div style={styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0 }}>Historical Income</h3>
              {(
                <div style={{ display: 'grid', gridTemplateColumns: tileRow(136, 2, 16), gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Total Received</div>
                    <div style={{ ...figure(15, 5.2, 20), fontWeight: 700, color: acc('#3b82f6') }}>{Calc.formatCurrency(dividendCalendar.reduce((sum, m) => sum + (m.total || 0), 0), baseCurrency)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Payments</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{dividendCalendar.reduce((sum, m) => sum + m.count, 0)}</div>
                  </div>
                </div>
              )}
            </div>
            <div style={styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: 12, marginTop: 0 }}>Dividend Calendar</h3>
              {dividendCalendar.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 384, overflowY: 'auto' }}>
                  {dividendCalendar.map((monthData) => (
                    <div key={monthData.month} style={{ borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, paddingBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontWeight: 500, color: monthData.month === 'upcoming' ? C3.success : isDark ? C3.textDark : C3.textLightTheme }}>{formatMonth(monthData.month)}</span>
                        {monthData.total !== null && <span style={{ color: acc('#3b82f6'), fontWeight: 600 }}>{Calc.formatCurrency(monthData.total, baseCurrency)}</span>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {monthData.items.map((item, j) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                            <span>{item.symbol}</span>
                            <span>{item.upcoming ? <span style={{ color: C3.success }}>Expected: {item.date}</span> : Calc.formatCurrency(item.amount, baseCurrency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>No dividend history</p>
              )}
            </div>
          </>
        )}

        {/* Benchmark Tab */}
        {activeTab === 'benchmark' && (
          <>
            <div style={styles.card}>
              <h3 style={{ fontWeight: 600, marginBottom: 16, marginTop: 0 }}>vs {benchmarkData?.benchmarkName || 'S&P 500'}</h3>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 32 }}>
                  <div style={{ width: 32, height: 32, border: '3px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                </div>
              ) : benchmarkData && benchmarkData.empty ? (
                <p style={{ textAlign: 'center', padding: 24, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  No positions to compare yet. Add a position and its return is set against the S&P 500 here.
                </p>
              ) : benchmarkData && benchmarkData.needsPrices ? (
                <p style={{ textAlign: 'center', padding: 24, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  Needs current prices — none came back for these positions, so there is no return to compare.{unpricedWhyText ? ' ' + unpricedWhyText : ''}{retryPrices}
                </p>
              ) : benchmarkData && benchmarkData.tooShort ? (
                <p style={{ textAlign: 'center', padding: 24, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  The first transaction is {benchmarkData.since}: under 90 days of history, so there is no annual return to compare yet.
                </p>
              ) : benchmarkData && benchmarkData.failed ? (
                <RLW.FailNote panel="benchmark" what="The price history for the comparison" failure={benchmarkData.failed} onRetry={loadBenchmarkComparison} isDark={isDark}
                  style={{ textAlign: 'center', padding: 24 }} buttonStyle={{ fontFamily: "'Sora', sans-serif" }} />
              ) : benchmarkData ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: tileRow(150, 2, 16), gap: 16 }}>
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                      <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>{benchmarkData.lastYear ? 'Your holdings, last year' : 'Your Portfolio (annual, money-weighted)'}</div>
                      <div style={{ ...figure(16, 6, 24), fontWeight: 700, color: benchmarkData.portfolioReturn >= 0 ? C3.success : C3.error }}>{Calc.formatPercent(benchmarkData.portfolioReturn)}</div>
                    </div>
                    <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                      <div style={{ fontSize: 12, overflowWrap: 'anywhere', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>{benchmarkData.benchmarkName}</div>
                      <div style={{ ...figure(16, 6, 24), fontWeight: 700, color: benchmarkData.benchmarkReturn >= 0 ? C3.success : C3.error }}>{Calc.formatPercent(benchmarkData.benchmarkReturn)}</div>
                    </div>
                  </div>
                  <div style={{ background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 16, textAlign: 'center', marginTop: 16 }}>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Alpha (difference per year)</div>
                    {benchmarkData.alpha == null ? (
                      <div style={{ fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Not stated: the portfolio is in {baseCurrency}, SPY in USD.</div>
                    ) : (
                      <>
                        <div style={{ ...figure(18, 8, 32), fontWeight: 700, color: Math.abs(benchmarkData.alpha) < 0.05 ? (isDark ? C3.textMutedDark : C3.textMutedLight) : benchmarkData.alpha > 0 ? C3.success : C3.error }}>{benchmarkData.alpha >= 0 ? '+' : ''}{benchmarkData.alpha.toFixed(2)}%</div>
                        <div style={{ fontSize: 12, marginTop: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{Math.abs(benchmarkData.alpha) < 0.5 ? 'In line with the market' : benchmarkData.alpha > 0 ? 'Ahead of the market' : benchmarkData.lastYear ? 'Behind the market' : (benchmarkData.noDividends ? 'Behind the market — before your dividends, none of which are recorded' : 'Behind the market — counting only the dividends recorded here')}</div>
                        {!benchmarkData.lastYear && benchmarkData.alpha < 0.5 && (
                          <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                            SPY's figure includes all its dividends; yours includes only {benchmarkData.noDividends ? 'dividends recorded in this portfolio (none yet)' : `the ${benchmarkData.dividendsRecorded} dividend${benchmarkData.dividendsRecorded === 1 ? '' : 's'} recorded in this portfolio`}. Add any missing ones in each position's History (+ Add → Dividend) for a like-for-like comparison.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {benchmarkData.lastYear ? (
                  <div style={{ paddingTop: 16, marginTop: 16, borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, lineHeight: 1.5 }}>
                    Compared over the last year (since {benchmarkData.since}): the positions you hold today, at today's weights{benchmarkData.covered != null && benchmarkData.covered < 0.995 ? `, ${Math.round(benchmarkData.covered * 100)}% of the portfolio's value` : ''}, against SPY.{benchmarkData.cut ? ' Older history needs a paid plan.' : ''}
                  </div>
                  ) : (
                  <div style={{ paddingTop: 16, marginTop: 16, borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, lineHeight: 1.5 }}>
                    Since {benchmarkData.since}. Total return over everything paid in: {benchmarkData.totalReturnPercent == null ? 'n/a' : Calc.formatPercent(benchmarkData.totalReturnPercent)}
                    {benchmarkData.excluded ? ` — ${benchmarkData.excluded} unpriced position${benchmarkData.excluded === 1 ? '' : 's'} left out` : ''}.
                    {benchmarkData.excluded && unpricedWhyText ? ' ' + unpricedWhyText : ''}
                  </div>
                  )}
                </div>
              ) : (
                <p style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Unable to load benchmark data</p>
              )}
            </div>
            {benchmarkData && benchmarkData.empty ? null : benchmarkData && benchmarkData.lastYear ? (
            <div style={{ ...(isDark ? { background: 'rgba(255,255,255,0.05)' } : { background: 'rgba(0,0,0,0.05)' }), borderRadius: 12, padding: 12, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              <strong>Note:</strong> Both figures are price returns over the same days, dividends included (adjusted closes). Further back would spend one of today's free full-history previews, so this tab does not ask for it.
            </div>
            ) : (
            <div style={{ ...(isDark ? { background: 'rgba(255,255,255,0.05)' } : { background: 'rgba(0,0,0,0.05)' }), borderRadius: 12, padding: 12, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              <strong>Note:</strong> Both figures are money-weighted annual returns (IRR). The SPY figure is what the same payments would have earned in SPY: every purchase, sale, transfer and dividend of yours is run through SPY's adjusted close on its own date. Money added late therefore counts only from when it was added. Alpha is the difference per year.
            </div>
            )}
          </>
        )}

        {/* Correlation Tab — Portfolio + Sandbox mode */}
        {activeTab === 'correlation' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 600, margin: 0 }}>Correlation Matrix</h3>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: 3 }}>
                {/* Light theme: the idle button was white-at-45% on white,
                    1.05:1; ink() mirrors it. */}
                <button data-hit="" aria-pressed={!window._corrMode || window._corrMode === 'portfolio'} onClick={() => { window._corrMode = 'portfolio'; loadCorrelationMatrix(); }} style={{ padding: '5px 12px', borderRadius: 3, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif", background: 'transparent', color: ink(0.6), ...window.ToggleStyle.value(!window._corrMode || window._corrMode === 'portfolio', isDark) }}>Portfolio</button>
                <button data-hit="" aria-pressed={window._corrMode === 'custom'} onClick={() => { window._corrMode = 'custom'; if (!window._corrCustomSymbols?.length) window._corrCustomSymbols = ['AAPL.US','MSFT.US','GOOGL.US','BTC-USD.CC','GLD.US']; loadCorrelationMatrix(window._corrCustomSymbols); }} style={{ padding: '5px 12px', borderRadius: 3, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif", background: 'transparent', color: ink(0.6), ...window.ToggleStyle.value(window._corrMode === 'custom', isDark) }}>Custom</button>
              </div>
            </div>
            {/* Custom ticker input */}
            {window._corrMode === 'custom' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  {(window._corrCustomSymbols || []).map((s, i) => (
                    <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 3, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12, fontWeight: 600 }}>
                      {s.split('.')[0]}
                      <button data-hit="end" aria-label="Remove symbol" onClick={() => { window._corrCustomSymbols = window._corrCustomSymbols.filter((_, j) => j !== i); loadCorrelationMatrix(window._corrCustomSymbols); }} style={{ background: 'none', border: 'none', color: ink(0.3), cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>x</button>
                    </span>
                  ))}
                </div>
                <div data-field-row="" style={{ display: 'flex', gap: 8 }}>
                  <input {...window.TickerFieldProps}
                    data-field-floor=""
                    id="corr-ticker-input"
                    type="text"
                    placeholder="Ticker, e.g. TSLA.US"
                    style={{ flex: 1, padding: '8px 12px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)'}`, background: isDark ? 'rgba(255,255,255,0.04)' : '#fff', color: isDark ? '#fff' : C3.textLightTheme, fontSize: 12, fontFamily: "'Sora',sans-serif", outline: 'none' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        const val = e.target.value.trim().toUpperCase();
                        if (!window._corrCustomSymbols) window._corrCustomSymbols = [];
                        if (!window._corrCustomSymbols.includes(val)) {
                          window._corrCustomSymbols.push(val);
                          loadCorrelationMatrix(window._corrCustomSymbols);
                        }
                        e.target.value = '';
                      }
                    }}
                  />
                  <button onClick={() => {
                    const inp = document.getElementById('corr-ticker-input');
                    const val = inp?.value?.trim()?.toUpperCase();
                    if (val) {
                      if (!window._corrCustomSymbols) window._corrCustomSymbols = [];
                      if (!window._corrCustomSymbols.includes(val)) {
                        window._corrCustomSymbols.push(val);
                        loadCorrelationMatrix(window._corrCustomSymbols);
                      }
                      inp.value = '';
                    }
                  }} style={{ padding: '8px 16px', borderRadius: 4, background: C3.logoGradient, border: 'none', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>Add</button>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {['AAPL.US', 'TSLA.US', 'NVDA.US', 'BTC-USD.CC', 'ETH-USD.CC', 'GLD.US', 'SPY.US', 'QQQ.US', 'EURUSD.FOREX', 'TLT.US'].filter(s => !(window._corrCustomSymbols || []).includes(s)).slice(0, 6).map(s => (
                    <button key={s} data-hit="" onClick={() => {
                      if (!window._corrCustomSymbols) window._corrCustomSymbols = [];
                      window._corrCustomSymbols.push(s);
                      loadCorrelationMatrix(window._corrCustomSymbols);
                    }} style={{ padding: '3px 8px', borderRadius: 3, border: '1px solid ' + ink(0.08), background: ink(0.03), color: ink(0.5), fontSize: 11, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>+ {s.split('.')[0]}</button>
                  ))}
                </div>
              </div>
            )}
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: C3.glowOrange, borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' }} /></div>
            ) : correlationMatrix?.failed ? (
              <RLW.FailNote panel="correlation" text={correlationMatrix.error} failure={correlationMatrix.failed} onRetry={() => loadCorrelationMatrix(corrArgsRef.current)} isDark={isDark}
                style={{ textAlign: 'center', padding: 32 }} buttonStyle={{ fontFamily: "'Sora', sans-serif" }} />
            ) : correlationMatrix?.error ? (
              <p style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{correlationMatrix.error}</p>
            ) : correlationMatrix ? (() => {
              const { symbols, matrix } = correlationMatrix;
              const getColor = (val) => {
                if (val === null) return isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
                if (val >= 0.7) return 'rgba(34,197,94,0.6)';
                if (val >= 0.3) return 'rgba(34,197,94,0.3)';
                if (val >= -0.3) return isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
                if (val >= -0.7) return 'rgba(239,68,68,0.3)';
                return 'rgba(239,68,68,0.6)';
              };
              return React.createElement(React.Fragment, null,
                correlationMatrix.partFailed && React.createElement(RLW.FailNote, {
                  panel: 'correlation',
                  what: historyWhat(correlationMatrix.partFailedCount), failure: correlationMatrix.partFailed,
                  extra: 'The table leaves those symbols out.', onRetry: () => loadCorrelationMatrix(corrArgsRef.current), isDark,
                  style: { fontSize: 12, marginBottom: 10 }, buttonStyle: { fontFamily: "'Sora', sans-serif" },
                }),
                React.createElement('div', { style: { overflowX: 'auto', paddingBottom: 8 } },
                  React.createElement('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: symbols.length * 60 + 70 } },
                    React.createElement('thead', null,
                      React.createElement('tr', null,
                        React.createElement('th', { style: { padding: '6px 8px', fontSize: 11, textAlign: 'left', color: isDark ? C3.textMutedDark : C3.textMutedLight } }, ''),
                        ...symbols.map(s => React.createElement('th', { key: s, style: { padding: '6px 4px', fontSize: 10, textAlign: 'center', color: isDark ? C3.textDark : C3.textLightTheme, fontWeight: 600 } }, s.split('.')[0]))
                      )
                    ),
                    React.createElement('tbody', null,
                      ...symbols.map(s1 => React.createElement('tr', { key: s1 },
                        React.createElement('td', { style: { padding: '6px 8px', fontSize: 11, fontWeight: 600, color: isDark ? C3.textDark : C3.textLightTheme, whiteSpace: 'nowrap' } }, s1.split('.')[0]),
                        ...symbols.map(s2 => {
                          const val = matrix[s1]?.[s2];
                          return React.createElement('td', { key: s2, style: { padding: '4px', textAlign: 'center' } },
                            React.createElement('div', { style: { background: getColor(val), borderRadius: 6, padding: '8px 4px', fontSize: 11, fontWeight: 600, color: isDark ? '#ffffff' : C3.textLightTheme } }, val !== null ? Calc.fixed(val, 2) : '—')
                          );
                        })
                      ))
                    )
                  )
                ),
                React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: 16, marginTop: 16, fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                  React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, React.createElement('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e' } }), ' Positive (>0.3)'),
                  React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, React.createElement('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#94a3b8' } }), ' Neutral'),
                  React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: 4 } }, React.createElement('span', { style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444' } }), ' Negative (<-0.3)')
                ),
                React.createElement('div', { style: { ...(isDark ? { background: 'rgba(255,255,255,0.05)' } : { background: 'rgba(0,0,0,0.05)' }), borderRadius: 12, padding: 12, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 16 } },
                  React.createElement('strong', null, 'Tip:'), ' Low or negative correlation between holdings means better diversification. A well-diversified portfolio should have a mix of green, neutral, and red cells.'
                )
              );
            })() : null}
          </div>
        )}

        {/* Monte Carlo Tab */}
        {activeTab === 'montecarlo' && (
          <div>
            <h3 style={{ fontWeight: 600, marginBottom: 16, marginTop: 0 }}>Monte Carlo Simulation</h3>
            {monteCarloGate === 'wall' && window.FreeLimitWalls && window.PlanNotice && window.PlanNotice.RefusalCard ? (
              React.createElement(window.PlanNotice.RefusalCard, { refusal: window.FreeLimitWalls.analyticsRefusal('montecarlo'), isDark })
            ) : loading || monteCarloGate !== 'open' ? (
              <div style={{ textAlign: 'center', padding: 32 }}><div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.1)', borderTopColor: C3.glowOrange, borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' }} /></div>
            ) : monteCarloData?.failed ? (
              <RLW.FailNote panel="montecarlo" text={monteCarloData.error} failure={monteCarloData.failed} onRetry={loadMonteCarlo} isDark={isDark}
                style={{ textAlign: 'center', padding: 32 }} buttonStyle={{ fontFamily: "'Sora', sans-serif" }} />
            ) : monteCarloData?.error ? (
              <p style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{monteCarloData.error}{/^Needs current prices/.test(monteCarloData.error) && retryPrices}</p>
            ) : monteCarloData ? (() => {
              const { startValue, percentiles, fanChart, probProfit, probGoal, goalAmount, annualizedReturn, annualizedVol } = monteCarloData;
              const fmtVal = (v) => Calc.formatCurrency(v, baseCurrency, 0);

              // Fan chart SVG
              const chartW = 320;
              const chartH = 160;
              // Narrow (a phone at 320-360): a slimmer gutter with short
              // amounts ($12K), a chart of its own height instead of half its
              // width, and only the time labels that fit side by side.
              const compact = mcWidth > 0 && mcWidth < 300;
              const gutter = compact ? 40 : 56;
              const fmtAxis = (v) => {
                if (!compact) return fmtVal(v);
                try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: baseCurrency || 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v); } catch (_) { return fmtVal(v); }
              };
              const plotW = Math.max(0, (mcWidth || 0) - gutter);
              const TIME_LABELS = [['Today', 0], ['3 Mo', 63], ['6 Mo', 126], ['1 Year', 252]];
              // About 6 px a character at 10 px; a label is dropped when it
              // would touch the one before it or the last.
              const timeLabels = (() => {
                if (!plotW) return TIME_LABELS;
                const span = ([label, day]) => {
                  const w = label.length * 6.2;
                  const x = day / 252 * plotW;
                  return day === 0 ? [x, x + w] : day === 252 ? [x - w, x] : [x - w / 2, x + w / 2];
                };
                const last = span(TIME_LABELS[TIME_LABELS.length - 1]);
                const kept = [TIME_LABELS[0]];
                let right = span(TIME_LABELS[0])[1];
                TIME_LABELS.slice(1, -1).forEach((l) => {
                  const [a, b] = span(l);
                  if (a >= right + 6 && b <= last[0] - 6) { kept.push(l); right = b; }
                });
                return kept.concat([TIME_LABELS[TIME_LABELS.length - 1]]);
              })();
              const allVals = fanChart.flatMap(d => [d.p10, d.p90]);
              const minVal = Math.min(...allVals) * 0.95;
              const maxVal = Math.max(...allVals) * 1.05;
              const scaleX = (d) => (d.day / 252) * chartW;
              const scaleY = (v) => chartH - ((v - minVal) / (maxVal - minVal)) * chartH;

              const pathP10 = fanChart.map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(d).toFixed(1)},${scaleY(d.p10).toFixed(1)}`).join(' ');
              const pathP90 = fanChart.map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(d).toFixed(1)},${scaleY(d.p90).toFixed(1)}`).join(' ');
              const pathMedian = fanChart.map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(d).toFixed(1)},${scaleY(d.median).toFixed(1)}`).join(' ');
              // Fan fill (p10 forward, p90 backward)
              const fanFill = fanChart.map((d, i) => `${i === 0 ? 'M' : 'L'}${scaleX(d).toFixed(1)},${scaleY(d.p90).toFixed(1)}`).join(' ')
                + ' ' + [...fanChart].reverse().map((d, i) => `L${scaleX(d).toFixed(1)},${scaleY(d.p10).toFixed(1)}`).join(' ') + ' Z';

              return React.createElement(React.Fragment, null,
                // A run again that failed: the last simulation stays, and the
                // failure is said above it.
                monteCarloData.refreshFailed && React.createElement(RLW.FailNote, {
                  panel: 'montecarlo',
                  text: monteCarloData.refreshFailed.error + ' The simulation below is the last one run.',
                  failure: monteCarloData.refreshFailed.failed, onRetry: loadMonteCarlo, isDark,
                  style: { fontSize: 12, marginBottom: 12 }, buttonStyle: { fontFamily: "'Sora', sans-serif" },
                }),
                // Stats row
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 20 } },
                  React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 14, textAlign: 'center' } },
                    React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 } }, 'Prob. of Profit (1Y)'),
                    React.createElement('div', { style: { fontSize: 24, fontWeight: 700, color: probProfit >= 50 ? C3.success : C3.error } }, probProfit + '%')
                  ),
                  React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 14, textAlign: 'center' } },
                    React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 } }, 'Ann. Return / Vol'),
                    React.createElement('div', { style: { fontSize: 20, fontWeight: 700, color: isDark ? C3.textDark : C3.textLightTheme } }, annualizedReturn + '% / ' + annualizedVol + '%')
                  )
                ),
                // Fan Chart
                React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 } },
                  React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: isDark ? C3.textDark : C3.textLightTheme } }, '500 Simulations — 1 Year Projection'),
                  // The value scale on the left edge, beside the chart: there was
                  // none, so the fan had no amounts.
                  React.createElement('div', { ref: mcBoxRef, style: { position: 'relative', paddingLeft: gutter } },
                  React.createElement('div', { 'data-mc-yaxis': '', 'aria-hidden': true, style: { position: 'absolute', left: 0, top: 0, bottom: 22, width: gutter - 4, fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                    [[0, maxVal], [50, (maxVal + minVal) / 2], [100, minVal]].map(([pct, v]) => React.createElement('span', { key: pct, style: { position: 'absolute', right: 4, top: pct + '%', transform: pct === 0 ? 'none' : pct === 100 ? 'translateY(-100%)' : 'translateY(-50%)', whiteSpace: 'nowrap' } }, fmtAxis(v)))
                  ),
                  React.createElement('svg', { width: '100%', viewBox: `0 0 ${chartW} ${chartH}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Projected portfolio value over time: the median path inside a 10th-to-90th percentile band. The probability of profit and the annualised return are stated above this chart.', style: { display: 'block', ...(compact ? { height: 120 } : {}) } },
                    React.createElement('path', { d: fanFill, fill: 'rgba(249,115,22,0.15)', stroke: 'none' }),
                    React.createElement('path', { d: pathP90, fill: 'none', stroke: 'rgba(34,197,94,0.5)', strokeWidth: 1 }),
                    React.createElement('path', { d: pathP10, fill: 'none', stroke: 'rgba(239,68,68,0.5)', strokeWidth: 1 }),
                    React.createElement('path', { d: pathMedian, fill: 'none', stroke: C3.glowOrange, strokeWidth: 2 }),
                    // Start line
                    React.createElement('line', { x1: 0, y1: scaleY(startValue), x2: chartW, y2: scaleY(startValue), stroke: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', strokeDasharray: '4,4' })
                  ),
                  // Each label where its day is on the time axis (252 trading
                  // days a year): spread evenly, "3 Mo" sat at a third of the
                  // year and "6 Mo" at two thirds.
                  React.createElement('div', { 'data-mc-xaxis': '', style: { position: 'relative', height: 14, fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 8 } },
                    timeLabels.map(([label, day]) => React.createElement('span', { key: label, 'data-day': day, style: { position: 'absolute', top: 0, left: (day / 252 * 100) + '%', transform: day === 0 ? 'none' : day === 252 ? 'translateX(-100%)' : 'translateX(-50%)', whiteSpace: 'nowrap' } }, label))
                  )
                  )
                ),
                // Percentile table
                React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 } },
                  React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 12, color: isDark ? C3.textDark : C3.textLightTheme } }, 'Projected Portfolio Value'),
                  ...percentiles.map(p =>
                    React.createElement('div', { key: p.day, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)') } },
                      React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: isDark ? C3.textDark : C3.textLightTheme } }, p.label),
                      React.createElement('div', { style: { textAlign: 'right' } },
                        React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: isDark ? C3.textDark : C3.textLightTheme } }, fmtVal(p.median)),
                        React.createElement('div', { style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight } }, fmtVal(p.p10) + ' — ' + fmtVal(p.p90))
                      )
                    )
                  )
                ),
                // Goal probability
                probGoal !== null && React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, textAlign: 'center', marginBottom: 16 } },
                  React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 } }, 'Probability of reaching goal (' + fmtVal(goalAmount) + ')'),
                  React.createElement('div', { style: { fontSize: 28, fontWeight: 700, color: probGoal >= 50 ? C3.success : C3.warning } }, probGoal + '%')
                ),
                React.createElement('div', { style: { ...(isDark ? { background: 'rgba(255,255,255,0.05)' } : { background: 'rgba(0,0,0,0.05)' }), borderRadius: 12, padding: 12, fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                  React.createElement('strong', null, 'How it works:'), ' 500 random simulations based on the last year of daily returns ' +
                    (monteCarloData.positionsTotal > monteCarloData.positionsUsed
                      ? `of your ${monteCarloData.positionsUsed} largest positions (of ${monteCarloData.positionsTotal}), ${Math.round((monteCarloData.covered || 0) * 100)}% of portfolio value, at today's weights; the rest is assumed to move the same way.`
                      : `of your positions at today's weights${monteCarloData.covered != null && monteCarloData.covered < 0.995 ? ` (${Math.round(monteCarloData.covered * 100)}% of portfolio value; manual assets are left out)` : ''}.`) +
                    ' The expected return is last year\'s average, not a forecast. The fan shows the range of outcomes (10th to 90th percentile); the orange line is the median.'
                )
              );
            })() : null}
          </div>
        )}

        {/* Backtest Tab */}
        {activeTab === 'backtest' && (
          <div>
            <h3 style={{ fontWeight: 600, marginBottom: 16, marginTop: 0 }}>What-If Backtester</h3>
            {/* Input form */}
            <div style={{ ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="pt-backtest-symbol" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Symbol (e.g. AAPL, TSLA, BTC-USD.CC)</label>
                <input {...window.TickerFieldProps}
                  id="pt-backtest-symbol"
                  value={backtestSymbol}
                  onChange={(e) => setBacktestSymbol(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10,
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                    color: isDark ? C3.textDark : C3.textLightTheme,
                    fontSize: 14, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              {/* Side by side where there is room, one above the other on a
                  phone: two halves of a 320-390 px card cut the date field's
                  year off. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div>
                  {/* In the instrument's own currency: the run is measured in
                      it, and "$10,000 in VOD" was pence. */}
                  <label htmlFor="pt-backtest-amount" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Amount{(() => { const full = backtestFullSymbol(backtestSymbol || 'X'); const held = holdings.find(h => h.symbol && String(h.symbol).toUpperCase() === full); const c = (held && held.currency) || backtestCcyRef.current[full] || (backtestCcyPending(full) ? null : Calc.currencyFromSymbol(full)); return c ? ` (${c})` : (backtestCcyRev >= 0 && backtestCcyPending(full) && backtestSymbol ? ' (…)' : ''); })()}</label>
                  <input
                    id="pt-backtest-amount"
                    {...(window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' })}
                    aria-invalid={backtestAmountProblem ? 'true' : undefined}
                    value={backtestAmount}
                    onChange={(e) => setBacktestAmount(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10,
                      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                      border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                      color: isDark ? C3.textDark : C3.textLightTheme,
                      fontSize: 14, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  {backtestAmountProblem && (
                    <div role="alert" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.4, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{backtestAmountProblem}</div>
                  )}
                </div>
                <div>
                  <label htmlFor="pt-backtest-date" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Start Date</label>
                  <input
                    id="pt-backtest-date"
                    type="date"
                    value={backtestDate}
                    onChange={(e) => setBacktestDate(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10,
                      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                      border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                      color: isDark ? C3.textDark : C3.textLightTheme,
                      fontSize: 14, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
              <button
                ref={runButtonRef}
                onClick={(e) => { window.Haptics?.medium(); runBacktest(e); }}
                disabled={loading || !backtestSymbol}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12,
                  background: C3.logoGradient, border: 'none', color: 'white',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  opacity: (loading || !backtestSymbol) ? 0.5 : 1,
                }}
              >
                {loading ? 'Running...' : 'Run Backtest'}
              </button>
            </div>

            {/* Results */}
            {backtestResult?.error ? (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <p style={{ margin: 0, color: C3.error }}>{backtestResult.error}</p>
                {backtestResult.limited && (
                  <window.RateLimitWait.RetryButton isDark={isDark} label="Run Backtest" onClick={runBacktest} style={{ marginTop: 12, padding: '6px 14px', borderRadius: 8, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 13, fontWeight: 600, cursor: 'pointer' }} />
                )}
              </div>
            ) : backtestResult ? (() => {
              const r = backtestResult;
              // Growth is measured in the instrument's own currency; the
              // amount is a notional in it.
              const ccy = r.currency || baseCurrency;
              const fmtVal = (v) => Calc.formatCurrency(v, ccy, 0);

              // Chart SVG
              const chartW = 320;
              const chartH = 140;
              const closes = r.chartData.map(d => d.value);
              const minV = Math.min(...closes) * 0.98;
              const maxV = Math.max(...closes) * 1.02;
              const chartPath = r.chartData.map((d, i) => {
                const x = (i / (r.chartData.length - 1)) * chartW;
                const y = chartH - ((d.value - minV) / (maxV - minV)) * chartH;
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');
              const isPositive = r.totalReturn >= 0;
              const cmp = r.commonReturn != null ? r.commonReturn : r.totalReturn;

              return React.createElement(React.Fragment, null,
                // Chart
                React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 } },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 12 } },
                    React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: isDark ? C3.textDark : C3.textLightTheme } }, fmtVal(r.amount) + ' in ' + r.symbol),
                    React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: isPositive ? C3.success : C3.error } }, (isPositive ? '+' : '') + r.totalReturn.toFixed(2) + '%')
                  ),
                  React.createElement('svg', { width: '100%', viewBox: `0 0 ${chartW} ${chartH}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Value of the investment across the period; the closing value and the total return are stated above this chart.', style: { display: 'block' } },
                    React.createElement('line', { x1: 0, y1: chartH - ((r.amount - minV) / (maxV - minV)) * chartH, x2: chartW, y2: chartH - ((r.amount - minV) / (maxV - minV)) * chartH, stroke: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)', strokeDasharray: '4,4' }),
                    React.createElement('path', { d: chartPath, fill: 'none', stroke: isPositive ? C3.success : C3.error, strokeWidth: 2 })
                  ),
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 8 } },
                    React.createElement('span', null, r.startDate),
                    React.createElement('span', null, r.endDate)
                  ),
                  React.createElement('div', { style: { fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 6 } },
                    (r.isIndex ? (r.priceIndex ? 'Index level in points — a price index, dividends not included' : 'Index level in points, as EODHD publishes it') : 'Split- and dividend-adjusted prices (dividends reinvested)') + (r.currency ? `, in ${r.currency}` : '') + '.')
                ),
                // Metrics
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 16 } },
                  ...[
                    { label: 'Final Value', value: fmtVal(r.finalValue), color: isPositive ? C3.success : C3.error },
                    { label: 'Total Return', value: (isPositive ? '+' : '') + r.totalReturn.toFixed(2) + '%', color: isPositive ? C3.success : C3.error },
                    { label: 'Ann. Return', value: (r.annualizedReturn >= 0 ? '+' : '') + r.annualizedReturn.toFixed(2) + '%', color: r.annualizedReturn >= 0 ? C3.success : C3.error },
                    { label: 'Max Drawdown', value: '-' + r.maxDrawdown.toFixed(2) + '%', color: r.maxDrawdown > 20 ? C3.error : C3.warning },
                  ].map(m => React.createElement('div', { key: m.label, style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 14, textAlign: 'center' } },
                    React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 } }, m.label),
                    React.createElement('div', { style: { fontSize: 18, fontWeight: 700, color: m.color } }, m.value)
                  ))
                ),
                // vs S&P 500, or why there is no comparison: it went away
                // without a word when SPY did not answer.
                r.spyReturn == null && r.spyMissing && React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 } },
                  React.createElement('h4', { ref: vsHeadingRef, tabIndex: -1, style: { fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: isDark ? C3.textDark : C3.textLightTheme } }, 'vs S&P 500'),
                  // The words are the live region; the button counts the
                  // wait every second and stays outside it.
                  React.createElement('p', { style: { fontSize: 13, lineHeight: 1.5, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                    React.createElement('span', { role: 'status' }, r.spyMissing !== 'failed'
                      ? `The S&P 500 has no trading days in common with ${r.symbol} in this period, so there is nothing to compare.`
                      : r.spyStatus === 404 ? 'There is no S&P 500 comparison: EODHD has no price history for SPY. The figures above are complete.'
                      : (r.spyStatus === 402 || r.spyStatus === 403) ? `There is no S&P 500 comparison: SPY's price history is not included in your EODHD plan (EODHD answered ${r.spyStatus}). The figures above are complete.`
                      : r.spyStatus === 401 ? 'There is no S&P 500 comparison: EODHD did not accept the API key (401) for SPY. The figures above are complete.'
                      : r.spyStatus === 429 ? 'The S&P 500 comparison did not load: ' + window.RateLimitWait.REACHED + ' The figures above are complete.'
                      : r.spyUnreadable ? 'The S&P 500 comparison did not load: ' + window.RateLimitWait.UNREADABLE + ' The figures above are complete.'
                      : r.spyStatus >= 500 ? `The S&P 500 comparison did not load: EODHD answered with an error (${r.spyStatus}). The figures above are complete.`
                      : 'The S&P 500 comparison did not load — EODHD did not answer for SPY. The figures above are complete.'),
                    r.spyMissing === 'failed' && ![401, 402, 403, 404].includes(r.spyStatus) && React.createElement(window.RateLimitWait.RetryButton, {
                      isDark, onClick: retryBenchmark, 'aria-busy': benchmarkRetrying ? 'true' : undefined,
                      label: benchmarkRetrying ? 'Loading…' : 'Try again',
                      style: { marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
                    }))
                ),
                r.spyReturn != null && React.createElement('div', { style: { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 } },
                  React.createElement('h4', { ref: vsHeadingRef, tabIndex: -1, style: { fontSize: 13, fontWeight: 600, margin: '0 0 12px', color: isDark ? C3.textDark : C3.textLightTheme } },
                    'vs S&P 500' + (r.spyStart ? ` (${r.spyStart} → ${r.spyEnd}, USD)` : '')
                      + (r.currency && r.currency !== 'USD' ? ` — ${r.symbol} is measured in ${r.currency}, so the two are not directly comparable` : '')),
                  // Two returns of one asset on one card (Total Return over its
                  // own dates, this one over the dates both traded): 20 points
                  // apart for BTC with nothing saying why.
                  (r.spyStart !== r.startDate || r.spyEnd !== r.endDate) && React.createElement('p', { style: { fontSize: 11, lineHeight: 1.5, margin: '-6px 0 12px', color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                    `Both over the dates shared with the S&P 500. The Total Return above is over ${r.symbol}'s own ${r.startDate} → ${r.endDate}.`),
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
                    React.createElement('span', { style: { fontSize: 13, color: isDark ? C3.textDark : C3.textLightTheme } }, r.symbol),
                    // Over the dates in the heading, like the S&P below it.
                    React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: cmp >= 0 ? C3.success : C3.error } }, (cmp >= 0 ? '+' : '') + cmp.toFixed(2) + '%')
                  ),
                  React.createElement('div', { style: { height: 12, borderRadius: 999, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', marginBottom: 12 } },
                    React.createElement('div', { style: { height: 12, borderRadius: 999, background: cmp >= 0 ? C3.success : C3.error, width: Math.min(Math.abs(cmp), 200) / 2 + '%' } })
                  ),
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 } },
                    React.createElement('span', { style: { fontSize: 13, color: isDark ? C3.textDark : C3.textLightTheme } }, 'S&P 500'),
                    React.createElement('span', { style: { fontSize: 13, fontWeight: 700, color: r.spyReturn >= 0 ? C3.success : C3.error } }, (r.spyReturn >= 0 ? '+' : '') + r.spyReturn.toFixed(2) + '%')
                  ),
                  React.createElement('div', { style: { height: 12, borderRadius: 999, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', marginBottom: 12 } },
                    React.createElement('div', { style: { height: 12, borderRadius: 999, background: '#3b82f6', width: Math.min(Math.abs(r.spyReturn), 200) / 2 + '%' } })
                  ),
                  r.alpha != null
                    ? React.createElement('div', { style: { textAlign: 'center', fontSize: 20, fontWeight: 700, color: r.alpha >= 0 ? C3.success : C3.error, marginTop: 8 } },
                        'Alpha: ' + (r.alpha >= 0 ? '+' : '') + r.alpha.toFixed(2) + '%')
                    // Different currencies: the two returns are not comparable
                    // without FX, so no alpha is claimed.
                    // A currency not known is said as such.
                    : React.createElement('div', { style: { textAlign: 'center', fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 8 } },
                        r.currency ? `No alpha: ${r.symbol} is quoted in ${r.currency}, the S&P 500 in USD.` : `No alpha: the quote currency of ${r.fullSymbol || r.symbol} is not known, so it is not set against the S&P 500 in USD.`),
                  // An index level leaves dividends out; SPY's adjusted close
                  // has them in.
                  r.priceIndex && r.alpha != null && React.createElement('p', { style: { fontSize: 11, lineHeight: 1.5, margin: '8px 0 0', textAlign: 'center', color: isDark ? C3.textMutedDark : C3.textMutedLight } },
                    `${r.symbol} is a price index: its level leaves dividends out, while the S&P 500 figure (SPY) includes them. Part of the gap, roughly the S&P's dividend yield for each year of the period, is those dividends.`)
                )
              );
            })() : (
              <div style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                <div style={{ marginBottom: 12 }}>{React.createElement(Icon, { name: 'search', size: 32 })}</div>
                <p style={{ fontSize: 14 }}>Enter a symbol and click "Run Backtest" to see how an investment would have performed.</p>
              </div>
            )}
          </div>
        )}

        {/* What-If Tab */}
        {activeTab === 'whatif' && window.WhatIfScenarioTab && (
          React.createElement(window.WhatIfScenarioTab, {
            apiKey, holdings, holdingsData, baseCurrency, theme, onRetryPrices
          })
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
