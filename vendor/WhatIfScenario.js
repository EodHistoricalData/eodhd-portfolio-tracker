// What-If Portfolio Scenario — tab content for PortfolioAnalytics
window.WhatIfScenarioTab = ({ apiKey, holdings, holdingsData, baseCurrency, theme, onRetryPrices }) => {
  const useFeatureCost = (() => null);
  const verdictCost = useFeatureCost('whatif_scenario');
  // Light theme: darker success/error/warning inks and accents, so text clears
  // 4.5:1 on white (Calc.themeInk).
  const C3 = window.PortfolioCalculations ? window.PortfolioCalculations.themeInk(window.C3, theme === 'dark') : window.C3;
  const acc = (hex) => (window.PortfolioCalculations ? window.PortfolioCalculations.accent(hex, theme === 'dark') : hex);
  const isDark = theme === 'dark';
  const Calc = window.PortfolioCalculations;

  const [scenarios, setScenarios] = React.useState([]);
  const [actionType, setActionType] = React.useState('buy');
  const [symbol, setSymbol] = React.useState('');
  const [dollarAmount, setDollarAmount] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [aiVerdict, setAiVerdict] = React.useState(null);
  const [aiLoading, setAiLoading] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState([]);
  const [showSearch, setShowSearch] = React.useState(false);
  const wifSearchRef = React.useRef(null);
  const searchTimeout = React.useRef(null);

  const Icon = ({ name, size = 24, color }) => {
    return React.createElement('svg', {
      'aria-hidden': true, style: { width: size, height: size, flexShrink: 0 },
      viewBox: "0 0 24 24", fill: "none",
      stroke: color || 'currentColor', strokeWidth: "2",
      strokeLinecap: "round", strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  // Symbol search
  // The field's text as last typed: a search answer for older text (or for
  // a field emptied by "+ Add to Scenario") is not shown.
  const queryRef = React.useRef('');
  // Why the typed text was not added ("..", "a b"): said under the field.
  const [symbolNote, setSymbolNote] = React.useState(null);
  // The text (as the field shows it) the list is the search's answer to,
  // an empty answer included: Enter on "ZZZQQ" waited for rows that never
  // came and said nothing.
  const [answeredFor, setAnsweredFor] = React.useState(null);
  // The text whose search failed: its empty list is no answer.
  const searchFailedForRef = React.useRef(null);
  const handleSymbolChange = (val) => {
    queryRef.current = val;
    setSymbolNote(null);
    setSymbol(val.toUpperCase());
    setAnsweredFor(null);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.length >= 2) {
      searchTimeout.current = setTimeout(async () => {
        let data = null;
        let failed = null;
        let limited = false;
        let thrown;
        const SC = window.SymbolCode;
        try {
          // The code alone for Yahoo's suffix: search/VOD.L answers nothing,
          // search/VOD answers VOD.LSE (window.SymbolCode.searchText).
          data = await window.EODHD_API.searchStocks(apiKey, SC.searchText(val), { throwErrors: true });
        } catch (e) {
          // Said, and its empty list is no answer: Enter and "+ Add" ask the
          // search again.
          const left = SC.apiFor(window.EODHD_API, apiKey).limited();
          failed = SC.searchFailNote ? SC.searchFailNote(e, left) : 'The ticker search did not load. Try again.';
          limited = Boolean(SC.searchLimited && SC.searchLimited(e, left));
          thrown = e;
        }
        if (queryRef.current !== val) return;
        searchFailedForRef.current = failed ? val.toUpperCase() : null;
        setSearchResults(Array.isArray(data) ? data.slice(0, 5) : []);
        setShowSearch(true);
        setAnsweredFor(val.toUpperCase());
        // The limit under the field as in every picker: the wait counted
        // down, and the search asked again by itself once it is over.
        if (failed && limited && symbolKbRef.current && symbolKbRef.current.say) symbolKbRef.current.say(failed, { error: thrown });
        else if (failed) setSymbolNote(failed);
      }, 300);
    } else {
      setSearchResults([]);
      setShowSearch(false);
    }
  };

  // Quote currency of each symbol picked from search, so a new position is
  // converted into the portfolio currency (SAP.XETRA's €200 is not $200).
  // Moves the focus once the next control is on the page; a wait still
  // pending when this component unmounts is dropped (PortalDropdown.js).
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();
  const symbolCurrency = React.useRef({});
  const symbolType = React.useRef({});
  // Bumped by every pick and on unmount: an Add or an Enter still checking
  // the typed text does not land over a row picked meanwhile.
  const pickGenRef = React.useRef(0);
  React.useEffect(() => () => { pickGenRef.current++; }, []);
  const selectSearchResult = (item) => {
    pickGenRef.current++;
    if (symbolKbRef.current && symbolKbRef.current.cancel) symbolKbRef.current.cancel();
    // The row's symbol as every screen makes it: IBM on NYSE is IBM.US.
    // A row naming nothing readable leaves its code in the field, where
    // "+ Add to Scenario" says what is wrong with it.
    const sym = window.SymbolCode.fromRow(item) || String(item.Code || '');
    if (item.Currency) symbolCurrency.current[sym.toUpperCase()] = item.Currency;
    if (item.Type) symbolType.current[sym.toUpperCase()] = Calc.typeFromSearchRow(item);
    setSymbol(sym);
    setShowSearch(false);
    setSearchResults([]);
    // On to the amount, the next field (focus stayed in a closed list).
    focusNext(() => document.getElementById('wif-amount'));
  };
  // Held symbols, for "sell" and as the source of a swap. Swap used to sell
  // whichever holding happened to come first.
  // Shares still held only: a position sold to zero was offered as the
  // source of a swap, which then said "Pick a held position to swap from".
  // Why held positions have no value, in the shared words
  // (Calc.unpricedWhy), or ''.
  const unpricedWhy = React.useMemo(() => {
    const PC = window.PortfolioCalculations;
    const rows = (holdings || []).map(h => holdingsData?.[h.id]).filter(Boolean);
    return PC && PC.unpricedWhy ? PC.unpricedWhy(rows, baseCurrency || 'USD') : '';
  }, [holdings, holdingsData, baseCurrency]);
  const heldSymbols = React.useMemo(() => [...new Set(
    holdings.filter(h => h.symbol && holdingsData?.[h.id] && !holdingsData[h.id].priceUnavailable && Number(holdingsData[h.id].quantity) > 0).map(h => h.symbol)
  )], [holdings, holdingsData]);

  // The typed text read as every picker reads it (window.SymbolCode.resolve):
  // the held listing with that code, the search's row, or a listing the
  // search for its full code lists (SymbolCode.listed) ("VOD.L" is VOD.LSE). Never one nobody has: "ZZZQQ",
  // "VOD.L" and "7203.T" were added as ZZZQQ.US, VOD-L.US and 7203-T.US.
  // An index is no holding: one sentence for it,
  // from Enter and from "+ Add to Scenario" alike -- Enter said "No listing
  // found for ^GSPC" and Add "GSPC.INDX is an index" next to it.
  // Resolves to { symbol, row } or { note }.
  const symbolNowRef = React.useRef(symbol);
  symbolNowRef.current = symbol;
  const readTyped = async (typed, rows) => {
    const SC = window.SymbolCode;
    const res = await SC.resolve(typed, Object.assign(SC.apiFor(window.EODHD_API, apiKey), { rows, held: heldSymbols }));
    // `limited`: the limit stopped the check (said with the wait counting
    // down, as the search's own failure is).
    if (!res.symbol) return res.reason === 'limited' ? { note: res.note, limited: true } : { note: res.note };
    // A holding is named by its stored key: an old "BRK.B" is sold as BRK.B.
    const sym = res.held ? res.symbol : Calc.whatIfSymbol(res.symbol, heldSymbols);
    const notBuyable = actionType !== 'sell' ? Calc.indexNotBuyable(sym) : null;
    if (notBuyable) return { note: notBuyable };
    // Bought, it is priced in its own currency: one nobody knows is said
    // now, not guessed (1155.KLSE had none on 02.11).
    if (actionType !== 'sell' && !res.held) {
      const ccy = (res.row && res.row.Currency) || symbolCurrency.current[sym] || Calc.currencyFromSymbol(sym);
      if (!ccy) return { note: sym + ': the currency it is quoted in is not known, so it cannot be priced in ' + base + '. Pick another listing.' };
    }
    return { symbol: sym, row: res.row };
  };

  // Arrows and Enter in the symbol field, like the alerts form: the list was
  // buttons with no roles, out of reach of the keyboard.
  // Enter with no row that is the text: the reader above, its sentence
  // under the field (where "+ Add to Scenario" says it too).
  const useComboboxKeys = window.useComboboxKeys || (() => ({ active: -1, inputProps: {}, optionProps: () => ({}) }));
  const symbolKbRef = React.useRef(null);
  const symbolKb = useComboboxKeys({
    items: searchResults, open: showSearch && searchResults.length > 0 && !symbolNote, onPick: selectSearchResult, listId: 'wif-symbol-list', query: symbol, codeOf: (it) => it.Code, isDark,
    answered: answeredFor,
    resolve: async (q, rows) => {
      const got = await readTyped(q, searchFailedForRef.current === q ? undefined : rows);
      if (symbolNowRef.current !== q) return null;
      if (got.note && got.limited) return { note: got.note, limited: true };
      if (got.note) { setSymbolNote(got.note); return null; }
      return { item: got.row };
    },
    search: (q) => handleSymbolChange(q),
  });
  symbolKbRef.current = symbolKb;
  const [swapFrom, setSwapFrom] = React.useState('');

  // The amount field is text read by window.NumberInput: a Chrome-EN number
  // field turned "1000,5" into 10005 before the page saw it.
  const amountCheck = window.NumberInput ? window.NumberInput.check(dollarAmount) : { value: parseFloat(dollarAmount), error: null };

  // "+ Add to Scenario" is checking the typed text (a search or a quote).
  const [adding, setAdding] = React.useState(false);
  const addScenarioRef = React.useRef(null);
  const addScenario = async () => {
    if (!symbol || !dollarAmount || amountCheck.error || adding) return;
    const amount = amountCheck.value;
    if (!(amount > 0)) return;
    const from = actionType === 'swap' ? (swapFrom || heldSymbols[0] || '') : undefined;
    if (actionType === 'swap' && !from) return;
    // "AAPL" is the held AAPL.US, "VOO" is VOO.US; typed
    // without picking, the search's own row for that code names the
    // exchange, and BTC-USD / EURUSD are CC / FOREX.
    // Through the one reader (readTyped, window.SymbolCode): "^GSPC" is
    // GSPC.INDX, SOL-NZD is on CC, BRK.B is BRK-B.US,
    // VOD.L is VOD.LSE. Text that names no listing is said, not added.
    // An index is not something to buy (^NDX, GSPC.INDX): said, with a fund
    // that tracks it.
    const typed = symbol;
    const gen = pickGenRef.current;
    setAdding(true);
    let got;
    try {
      got = await readTyped(typed, answeredFor === typed && searchFailedForRef.current !== typed ? searchResults : undefined);
    } catch (_) {
      got = { note: 'Could not check ' + typed + ' right now. Try again.' };
    }
    // Unmounted meanwhile: nothing to say.
    if (gen !== pickGenRef.current && !wifSearchRef.current) return;
    setAdding(false);
    // Typed over, or a row picked, while it was checked: the user's choice
    // stands.
    if (symbolNowRef.current !== typed || gen !== pickGenRef.current) return;
    if (!got.symbol) {
      // Add, which the limit stopped, is done again once the wait is over.
      if (got.limited && symbolKbRef.current && symbolKbRef.current.say) symbolKbRef.current.say(got.note, { limited: true, redo: () => addScenarioRef.current() });
      else setSymbolNote(got.note);
      focusNext(() => wifSearchRef.current);
      return;
    }
    const sym = got.symbol;
    if (got.row && got.row.Currency) symbolCurrency.current[sym] = got.row.Currency;
    if (got.row && got.row.Type) symbolType.current[sym] = Calc.typeFromSearchRow(got.row);
    setSymbolNote(null);
    setScenarios(prev => [...prev, { type: actionType, symbol: sym, amount, ...(from ? { from } : {}) }]);
    setSymbol('');
    setDollarAmount('');
    // The last search's list is not opened again on the emptied field.
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    queryRef.current = '';
    setSearchResults([]);
    setShowSearch(false);
    setResult(null);
    setAiVerdict(null);
    window.Haptics?.light();
    // The fields are emptied, so the button is disabled and the focus fell
    // to <body>: on to the symbol field, for the next.
    focusNext(() => wifSearchRef.current);
  };
  addScenarioRef.current = addScenario;

  // The row's ✕ goes with the row: the focus moves to the next row's ✕, the
  // one before when it was the last, or the symbol field when none is left
  // (it fell to <body>).
  const scenarioListRef = React.useRef(null);
  const removeScenario = (idx) => {
    const left = scenarios.length - 1;
    setScenarios(prev => prev.filter((_, i) => i !== idx));
    setResult(null);
    setAiVerdict(null);
    focusNext(() => (left > 0
      ? (scenarioListRef.current ? scenarioListRef.current.querySelectorAll('[data-wif-remove]')[Math.min(idx, left - 1)] : null)
      : wifSearchRef.current));
  };

  const base = baseCurrency || 'USD';
  const fmtBase = (v, d = 2) => Calc.formatCurrency(v, base, d);

  // Simulate scenarios. The arithmetic is Calc.whatIfSimulate (tested); this only prices what isn't held yet,
  // converted into the portfolio currency.
  const simulateRef = React.useRef(null);
  // Each run is numbered; a verdict belongs to the run it was asked for.
  const runRef = React.useRef(0);
  const resultRef = React.useRef(null);
  resultRef.current = result;
  // `auto`: the run made again by itself after the limit's wait (below).
  const simulate = async (opts) => {
    if (scenarios.length === 0) return;
    const auto = Boolean(opts && opts.auto);
    const run = ++runRef.current;
    setLoading(true);
    setAiVerdict(null);

    try {
      const held = new Set(heldSymbols);
      const quotes = {};
      // A price or a rate the limit held back: the run is made again by
      // itself once the wait is over (useReloadAfterWait below).
      let atLimit = false;
      const seen = (f) => { if (f && f.limited) atLimit = true; return f; };
      for (const sc of scenarios) {
        if (sc.type === 'sell' || held.has(sc.symbol) || quotes[sc.symbol]) continue;
        // Typed by hand rather than picked from search: one lookup for its
        // type, else VOO.US entered directly read "Allocation: Stocks 100%".
        // Known ETFs and crypto/forex need no request.
        if (!symbolType.current[sc.symbol] && !Calc.knownAssetType(sc.symbol)) {
          try {
            const [code, ex = 'US'] = sc.symbol.split('.');
            const rows = await window.EODHD_API.searchStocks(apiKey, code);
            const hit = Array.isArray(rows) && rows.find(r => String(r.Code).toUpperCase() === code && String(r.Exchange).toUpperCase() === ex);
            if (hit) {
              symbolType.current[sc.symbol] = Calc.typeFromSearchRow(hit);
              if (hit.Currency && !symbolCurrency.current[sc.symbol]) symbolCurrency.current[sc.symbol] = hit.Currency;
            }
          } catch (_) { /* the type stays unknown, which reads as Stocks */ }
        }
        // A quote or a rate that did not load (the limit, EODHD's error, a
        // dropped connection, an unreadable answer) is said with its reason;
        // "Could not fetch price" stays for an answer with no price in it.
        const RLW = window.RateLimitWait;
        const failedLine = (f) => (f.limited
          ? 'No price: ' + RLW.REACHED + ' Simulate again when the wait is over.'
          : 'The price did not load: ' + RLW.failReason(f) + ' Simulate again.');
        try {
          let quote;
          try {
            quote = await window.EODHD_API.getRealTimeData(apiKey, sc.symbol, { throwErrors: true });
          } catch (e) {
            // At the limit the last price seen stays usable, as before.
            const last = e && e.rateLimited && window.EODHD_API.lastQuote ? window.EODHD_API.lastQuote(sc.symbol) : null;
            if (!last) {
              const f = seen(RLW.outage(e || {}));
              quotes[sc.symbol] = { error: f ? failedLine(f) : 'Could not fetch price' };
              continue;
            }
            quote = last;
          }
          const px = Calc.toRate(quote?.close) ?? Calc.toRate(quote?.previousClose);
          const ccy = symbolCurrency.current[sc.symbol] || Calc.currencyFromSymbol(sc.symbol);
          // No quote at the limit is said so, not "Could not fetch price".
          if (px == null) { quotes[sc.symbol] = { error: quote == null && seen(RLW.failure(null)).limited ? failedLine(RLW.failure(null)) : 'Could not fetch price' }; continue; }
          if (!ccy) { quotes[sc.symbol] = { error: 'Unknown quote currency — pick the symbol from search' }; continue; }
          const fxFails = [];
          const fx = await Calc.fxRate(apiKey, ccy, base, fxFails);
          const fxFailed = fx ? null : seen(Calc.fxFailure(fxFails));
          quotes[sc.symbol] = fx ? { price: px * fx, currency: ccy }
            : { error: fxFailed ? `The ${ccy}/${base} rate did not load: ${RLW.failReason(fxFailed)} Simulate again.` : `No ${ccy}/${base} rate` };
        } catch (e) {
          const f = seen(RLW.outage(e || {}));
          quotes[sc.symbol] = { error: f ? failedLine(f) : 'Could not fetch price' };
        }
      }

      const r = Calc.whatIfSimulate({ holdings, holdingsData, scenarios, quotes, types: symbolType.current });
      // More than is held: all of it, and the asked amount beside it.
      const capNote = (c) => (c.capped ? ` — all of it (${fmtBase(c.value)} held, ${fmtBase(c.amount)} asked)` : '');
      r.changes = r.changes.map(c => c.error ? c : {
        ...c,
        // Quantities at the asset's precision (crypto to 8 decimals).
        action: c.type === 'buy' ? `Buy ${Calc.quantityText(c.shares, c.symbol)} ${c.symbol} at ${fmtBase(c.price)}`
          : c.type === 'sell' ? `Sell ${Calc.quantityText(c.shares, c.symbol)} ${c.symbol} at ${fmtBase(c.price)}${capNote(c)}`
          : `Swap ${Calc.quantityText(c.soldShares, c.from)} ${c.from} → ${Calc.quantityText(c.shares, c.symbol)} ${c.symbol} (${fmtBase(c.value)})${capNote(c)}`,
      });
      // A new failure for each such run: its reload is paced from it. One
      // run again by itself per press: a run made again that meets the limit
      // once more waits for Simulate.
      r.run = run;
      r.limited = atLimit ? window.RateLimitWait.failure({ rateLimited: true }) : null;
      r.again = atLimit && !auto;
      setResult(r);
    } catch (e) {
      console.error('Simulation error:', e);
    }
    setLoading(false);
  };
  // Simulate costs nothing -- no token and no quota: the prices and rates
  // come through the data proxy, and only Get AI Verdict is charged. A run
  // the limit left a price or a rate out of is made again by itself once the
  // wait is over, as every screen loads again: Before and After stayed equal
  // after the wait. Not once an AI verdict was asked for that run: running
  // again would drop the verdict that was paid for.
  const rerunDue = Boolean(result && result.limited && result.again);
  window.RateLimitWait.useReloadAfterWait(rerunDue && !aiVerdict && !aiLoading && !loading ? result.limited : null, () => {
    // Disabled while it runs, as after a press: the focus comes back to it.
    if (document.activeElement === simulateRef.current) focusNext(() => simulateRef.current);
    simulate({ auto: true });
  }, 'whatif-simulate');
  // No verdict while a run is out or about to be made again: it was sent
  // for the run on screen while the run again was coming, and the paid
  // answer stood beside the new run it had not seen.
  const verdictHeld = loading || rerunDue;

  // AI Verdict
  const getAIVerdict = async () => {
    if (!result || !window.AIService || verdictHeld || aiLoading) return;
    const run = result.run;
    // Shown only beside the run it describes.
    const forThisRun = () => Boolean(resultRef.current && resultRef.current.run === run);
    setAiLoading(true);
    try {
      // Rounded, in the portfolio's currency: the allocation went in as raw
      // JSON floats.
      const allocText = (s) => Object.entries(s.alloc || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${fmtBase(v)} (${(s.totalValue > 0 ? v / s.totalValue * 100 : 0).toFixed(1)}%)`).join(', ');
      // The largest positions before, so the model has something to compare
      // the "after" concentration with; an error names its symbol; money from
      // sales is stated, not left to vanish between the two totals.
      const beforeTotal = result.before.totalValue || 0;
      const topBefore = holdings
        .map(h => ({ symbol: (h.symbol || h.name || '').split('.')[0], value: (holdingsData?.[h.id] || {}).currentValue || 0 }))
        .filter(p => p.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
        .map(p => `${p.symbol} ${(beforeTotal > 0 ? p.value / beforeTotal * 100 : 0).toFixed(1)}%`).join(', ');
      const cashFromSales = result.changes.filter(c => !c.error && c.type === 'sell').reduce((s, c) => s + (c.value || 0), 0);
      const context = `
Current portfolio: ${result.before.posCount} position${result.before.posCount === 1 ? '' : 's'}, ${fmtBase(result.before.totalValue)} total.
Allocation: ${allocText(result.before)}
Top positions now: ${topBefore || 'none priced'}

Proposed changes: ${result.changes.map(c => c.action || `${c.symbol}: not done — ${c.error}`).join('; ')}
${cashFromSales > 0 ? `Cash from sales, not reinvested and not in the totals below: ${fmtBase(cashFromSales)}\n` : ''}
After changes: ${result.after.posCount} position${result.after.posCount === 1 ? '' : 's'}, ${fmtBase(result.after.totalValue)} total.
Allocation: ${allocText(result.after)}
Top concentration: ${result.concentration.map(c => `${c.symbol} ${c.pct.toFixed(1)}%`).join(', ')}
Diversification score: ${Math.round(result.diversificationScore)}/100 (effective number of positions ${(result.effectivePositions || 0).toFixed(1)}; 20 equal positions = 100)
`;
      const messages = [
        { role: 'system', content: 'You are a portfolio advisor. Analyze the proposed portfolio changes and give a brief verdict (2-3 sentences). Highlight risks, benefits, and whether this improves diversification. Be concise and actionable.' },
        { role: 'user', content: context },
      ];
      const verdict = await window.AIService.chatWithTokens('whatif_scenario', messages);
      if (forThisRun()) setAiVerdict(verdict);
    } catch (e) {
      if (e.message !== 'AI_TOKENS_REQUIRED' && forThisRun()) setAiVerdict('Failed to get AI verdict.');
    }
    setAiLoading(false);
  };

  const cardStyle = { ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 14, padding: 16, marginBottom: 16 };

  const AllocationBar = ({ data, total, label }) => {
    const COLORS = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6'];
    return (
      <div>
        {/* Muted colour, not opacity: 0.6 read 4.36:1 in the light theme. */}
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{label}</div>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 20, marginBottom: 8 }}>
          {Object.entries(data).map(([type, val], i) => {
            const pct = total > 0 ? (val / total * 100) : 0;
            if (pct < 1) return null;
            return <div key={type} style={{ width: pct + '%', background: COLORS[i % COLORS.length], minWidth: 2 }} />;
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(data).map(([type, val], i) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length], display: 'inline-block' }} />
              <span style={{ fontSize: 11 }}>{type} {total > 0 ? (val / total * 100).toFixed(1) : 0}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h3 style={{ fontWeight: 600, marginBottom: 16, marginTop: 0 }}>What-If Scenarios</h3>

      {/* Action input */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['buy', 'sell', 'swap'].map(t => (
            <button key={t} type="button" aria-pressed={actionType === t} onClick={() => { setActionType(t); window.Haptics?.light(); }} style={{
              flex: 1, padding: '8px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              color: isDark ? C3.textDark : C3.textLightTheme,
              ...window.ToggleStyle.value(actionType === t, isDark),
              fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {actionType === 'swap' && (
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              Swap From (held)
            </label>
            {heldSymbols.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.6 }}>No priced positions to swap from.</div>
            ) : (
              <select
                value={swapFrom || heldSymbols[0]}
                onChange={(e) => setSwapFrom(e.target.value)}
                aria-label="Swap from"
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                  border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                  color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 14, outline: 'none',
                  colorScheme: isDark ? 'dark' : 'light',
                }}
              >
                {heldSymbols.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            {actionType === 'sell' ? 'Sell Symbol' : actionType === 'swap' ? 'Swap Into Symbol' : 'Buy Symbol'}
          </label>
          <input
            {...symbolKb.inputProps}
            aria-label={actionType === 'sell' ? 'Sell symbol' : actionType === 'swap' ? 'Swap into symbol' : 'Buy symbol'}
            aria-invalid={symbolNote ? 'true' : undefined}
            aria-describedby={symbolNote ? 'wif-symbol-note' : undefined}
            ref={wifSearchRef}
            value={symbol}
            onChange={(e) => handleSymbolChange(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowSearch(true)}
            placeholder="e.g. AAPL.US"
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
              color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 14, outline: 'none',
            }}
          />
          {symbolKb.noteEl}
          {React.createElement(window.PortalSearchPopup, {
            anchorRef: wifSearchRef,
            // Closed while the sentence under the field shows: the list
            // opened over it.
            open: showSearch && searchResults.length > 0 && !symbolNote,
            onClose: () => setShowSearch(false),
            isDark,
            maxHeight: 280,
            id: 'wif-symbol-list',
            role: 'listbox',
          },
            searchResults.map((item, i) =>
              React.createElement('button', {
                key: i,
                ...symbolKb.optionProps(i),
                onClick: () => selectSearchResult(item),
                style: {
                  width: '100%', padding: '10px 14px', border: 'none', textAlign: 'left', cursor: 'pointer',
                  background: symbolKb.active === i ? (isDark ? 'rgba(249,115,22,0.18)' : 'rgba(249,115,22,0.12)') : 'transparent',
                  color: isDark ? C3.textDark : C3.textLightTheme,
                  borderBottom: i < searchResults.length - 1 ? '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)') : 'none',
                },
              },
                React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, item.Code + '.' + item.Exchange),
                React.createElement('div', { style: { fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight } }, item.Name),
              )
            )
          )}
          {symbolNote && (
            <div id="wif-symbol-note" role="alert" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{symbolNote}</div>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Amount ({base})</label>
          <input
            {...(window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' })}
            id="wif-amount"
            aria-label={`Amount (${base})`}
            aria-invalid={amountCheck.error ? 'true' : undefined}
            value={dollarAmount}
            onChange={(e) => setDollarAmount(e.target.value)}
            placeholder="1000"
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 10, boxSizing: 'border-box',
              background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
              border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
              color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 14, outline: 'none',
            }}
          />
          {amountCheck.error && (
            <div role="alert" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{amountCheck.error}</div>
          )}
        </div>

        <button onClick={addScenario} disabled={!symbol || !dollarAmount || !!amountCheck.error} aria-busy={adding ? 'true' : undefined} style={{
          width: '100%', padding: '10px', borderRadius: 10, border: 'none',
          background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          color: isDark ? C3.textDark : C3.textLightTheme,
          fontSize: 13, fontWeight: 600,
          // A disabled button does not promise a click.
          cursor: (!symbol || !dollarAmount || amountCheck.error) ? 'not-allowed' : 'pointer',
          opacity: (!symbol || !dollarAmount || amountCheck.error) ? 0.4 : 1,
        }}>+ Add to Scenario</button>
      </div>

      {/* Scenario list */}
      {scenarios.length > 0 && (
        <div ref={scenarioListRef} style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Scenario Actions</div>
          {scenarios.map((sc, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0',
              borderBottom: i < scenarios.length - 1 ? '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)') : 'none',
            }}>
              <div>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, marginRight: 8,
                  background: sc.type === 'buy' ? 'rgba(34,197,94,0.15)' : sc.type === 'sell' ? 'rgba(239,68,68,0.15)' : (isDark ? C3.fillDark : C3.fillLight),
                  color: sc.type === 'buy' ? '#22c55e' : sc.type === 'sell' ? '#ef4444' : (isDark ? C3.textMutedDark : C3.textMutedLight),
                  textTransform: 'uppercase',
                }}>{sc.type}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{sc.type === 'swap' && sc.from ? `${sc.from} → ${sc.symbol}` : sc.symbol}</span>
                <span style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginLeft: 8 }}>{fmtBase(sc.amount, 0)}</span>
              </div>
              <button aria-label="Remove scenario" data-wif-remove="" onClick={() => removeScenario(i)} style={{
                width: 24, height: 24, borderRadius: 6, border: 'none',
                background: 'rgba(239,68,68,0.15)', color: acc('#ef4444'), cursor: 'pointer', fontSize: 12,
              }}>{'\u2715'}</button>
            </div>
          ))}

          <button ref={simulateRef} onClick={(e) => {
            window.Haptics?.medium();
            // Disabled while it runs, which dropped the focus to <body>
            // it comes back to the button once it is enabled.
            if (document.activeElement === e.currentTarget) focusNext(() => simulateRef.current);
            simulate();
            // Not while a verdict is written: it would describe the run replaced.
          }} disabled={loading || aiLoading} style={{
            width: '100%', padding: '12px', borderRadius: 12, border: 'none', marginTop: 12,
            // Flat accent with white text (4.6:1).
            background: C3.logoGradient, color: 'white',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            opacity: loading || aiLoading ? 0.6 : 1,
          }}>
            {loading ? 'Simulating...' : 'Simulate Scenario'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Changes summary */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Changes Applied</div>
            {result.changes.map((c, i) => (
              <div key={i} style={{ fontSize: 12, padding: '4px 0', opacity: c.error ? 0.5 : 0.8 }}>
                {c.error ? `\u26A0 ${c.symbol}: ${c.error}` : `\u2713 ${c.action}`}
              </div>
            ))}
          </div>

          {/* Positions held and left without a value (a currency rate or a
              quote that did not load): not in either total, and said why,
              with Try again -- "Before" read $480 for a $94,000 portfolio
              when its GBP/USD rate failed. */}
          {unpricedWhy && (
            <div data-unpriced-why="true" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              <span role="status">{unpricedWhy} The totals leave out the positions without a value.</span>
              {onRetryPrices && (
                <window.RateLimitWait.RetryButton busyKey="prices" isDark={isDark} onClick={onRetryPrices} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />
              )}
            </div>
          )}
          {/* Before vs After */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>Before</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtBase(result.before.totalValue, 0)}</div>
              <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{result.before.posCount} position{result.before.posCount === 1 ? '' : 's'}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 4 }}>After</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtBase(result.after.totalValue, 0)}</div>
              <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{result.after.posCount} position{result.after.posCount === 1 ? '' : 's'}</div>
              {/* The sale's money: the portfolio keeps no cash, so it is not
                  in this total -- said, not lost between the two. */}
              {result.cashFromSales > 0 && (
                <div style={{ fontSize: 11, marginTop: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Plus {fmtBase(result.cashFromSales, 0)} cash from sales, not in this total</div>
              )}
            </div>
          </div>

          {/* Allocation comparison */}
          <div style={cardStyle}>
            <AllocationBar data={result.before.alloc} total={result.before.totalValue} label="Before" />
            <div style={{ height: 12 }} />
            <AllocationBar data={result.after.alloc} total={result.after.totalValue} label="After" />
          </div>

          {/* Concentration */}
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Concentration Risk</div>
            {result.concentration.map(c => (
              <div key={c.symbol} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0',
              }}>
                <span style={{ fontSize: 13 }}>{c.symbol}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 60, height: 6, borderRadius: 3,
                    background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                  }}>
                    <div style={{
                      height: 6, borderRadius: 3, width: Math.min(c.pct, 100) + '%',
                      background: c.pct > 30 ? '#ef4444' : c.pct > 15 ? '#f59e0b' : '#22c55e',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, width: 42, textAlign: 'right' }}>{c.pct.toFixed(1)}%</span>
                </div>
              </div>
            ))}
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 8, textAlign: 'center',
              background: result.diversificationScore > 70 ? 'rgba(34,197,94,0.1)' : result.diversificationScore > 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: acc(result.diversificationScore > 70 ? '#22c55e' : result.diversificationScore > 40 ? '#f59e0b' : '#ef4444') }}>
                Diversification Score: {result.diversificationScore.toFixed(0)}/100
              </span>
              <div style={{ fontSize: 11, marginTop: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                Like {(result.effectivePositions || 0).toFixed(1)} equal positions; 20 equal positions score 100.
              </div>
            </div>
          </div>

          {/* AI Verdict -- only where AI is switched on. Without a model it
              was shown anyway and answered "Failed to get AI verdict.";
              the other AI buttons hide. */}
          {window.AIService && window.AIService.getSettings && window.AIService.getSettings()?.enabled && (
          <div style={cardStyle}>
            {aiVerdict ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>AI Verdict</div>
                <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.85, whiteSpace: 'pre-wrap' }}>{aiVerdict}</div>
              </div>
            ) : window.AIFeatureButton ? (
              <window.AIFeatureButton
                feature="whatif_scenario"
                label="Get AI Verdict"
                icon="zap"
                onClick={getAIVerdict}
                loading={aiLoading}
                disabled={verdictHeld}
              />
            ) : (
              <button onClick={getAIVerdict} disabled={aiLoading || verdictHeld} style={{
                width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                background: C3.logoGradient, color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                opacity: aiLoading || verdictHeld ? 0.6 : 1,
              }}>
                {aiLoading ? 'Analyzing...' : (verdictCost ? `Get AI Verdict (${verdictCost})` : 'Get AI Verdict')}
              </button>
            )}
            {!aiVerdict && rerunDue && !loading && (
              <div data-wif-verdict-wait="" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                The verdict is available once the scenario is simulated again after the wait.
              </div>
            )}
          </div>
          )}
        </>
      )}

      {/* Empty state */}
      {scenarios.length === 0 && !result && (
        <div style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
          {/* A line icon, not the crystal-ball emoji. */}
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Icon name="shuffle" size={32} color={isDark ? C3.textMutedDark : C3.textMutedLight} /></div>
          <p style={{ fontSize: 14, marginBottom: 8 }}>Test portfolio changes before committing</p>
          {/* Muted colour, not opacity: 0.6 read 2.75:1 light / 3.19 dark. */}
          <p style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Add buy, sell, or swap actions above, then simulate to see the impact on your portfolio allocation and risk.</p>
        </div>
      )}
    </div>
  );
};
