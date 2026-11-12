// The dialog behaviour the portfolio modals share (window.PTDialog) lives in
// PortalDropdown.js since 21.10: the screener's dialogs use it
// too, and that file is loaded in every app.
// A visible ring on the portfolio's text fields. Most set outline:none
// inline, and where no page stylesheet puts a ring back (the open-source
// build has none) a focused field showed nothing; where one does, its ring
// sat outside the field and a scrolling dialog cut it off. Inside the field,
// at 3:1 or more on both themes. Used by the roots marked .pt-fields.
window.PTFieldFocus = window.PTFieldFocus || ((isDark) => React.createElement('style', null,
  '.pt-fields :is(input, textarea, select):focus-visible { outline: 2px solid ' + (isDark ? '#f97316' : '#c2410c') + ' !important; outline-offset: -2px !important; }'));

// Where the focus goes when a position is deleted: its row (and the button
// that asked) are gone, and the focus fell to <body>.
// The Edit button of the position that took its place, else the one before,
// else "+ Add Position". `order` is the rows' ids read before the delete.
window.PTEditOrder = () => [...document.querySelectorAll('[data-pt-edit]')].map(b => b.getAttribute('data-pt-edit'));
window.PTAfterDeleteFocus = (deletedId, order) => {
  const live = (id) => [...document.querySelectorAll('[data-pt-edit]')].find(b => b.getAttribute('data-pt-edit') === id && b.getClientRects().length);
  const ids = Array.isArray(order) ? order : [];
  const at = ids.indexOf(String(deletedId));
  const candidates = at === -1 ? ids : ids.slice(at + 1).concat(ids.slice(0, at).reverse());
  for (const id of candidates) { const b = live(id); if (b) return b; }
  const any = [...document.querySelectorAll('[data-pt-edit]')].find(b => b.getClientRects().length);
  if (any) return any;
  return [...document.querySelectorAll('button')].find(b => /^\+\s*Add( Position)?$/.test((b.textContent || '').trim()) && b.getClientRects().length) || null;
};

// Portfolio Tracker - Add Position Modal (Concept 3 Glassmorphism Design)
// How long a symbol handed in by the host waits for its search before the
// form asks what the asset is.
window.PREFILL_LOOKUP_MS = 8000;

window.AddPositionModal = ({ portfolioId: openedFor, apiKey, baseCurrency: openedCurrency, onClose, onSave, theme, prefillSymbol, prefillType, prefillAssetName, portfolios: portfolioList }) => {
  // The portfolio this window was opened for, fixed for its whole life. When
  // that portfolio is deleted in another tab the page switches to another one
  // and re-renders the window with the new id -- and the position used to land
  // there, booked at the deleted portfolio's FX rate. Kept
  // as it was, the save meets Storage's 'portfolio-gone' refusal instead.
  // The person may send it to another of their portfolios (from
  // an asset page NVDA went to "My Portfolio" with no say in it). Only their
  // choice changes it; a re-render with another id does not.
  const portfolios = Array.isArray(portfolioList) ? portfolioList.filter(p => p && p.id && p.id !== 'all') : [];
  // Opened from "All portfolios" (not a portfolio): the first, shown in the field.
  const [portfolioId, setPortfolioId] = React.useState(() => (
    (!portfolios.length || portfolios.some(p => p.id === openedFor)) ? openedFor : portfolios[0].id));
  const openedCurrencyRef = React.useRef(openedCurrency);
  const chosen = portfolios.find(p => p.id === portfolioId);
  const baseCurrency = (chosen && chosen.baseCurrency) || (portfolioId === openedFor ? openedCurrencyRef.current : 'USD');
  const dialogProps = window.PTDialog.use(onClose, 'Add position');
  // The currency a listing is quoted in: its search row's, else its
  // exchange's (Calc.currencyFromSymbol, EODHD's exchange list). Never USD
  // by default for a listing outside the US: 1155.KL (KLSE) had no currency
  // here, and its ringgit price was labelled and saved as dollars. null when nobody knows: the form says so and does not save.
  const listingCurrencyOf = (asset) => {
    if (!asset) return null;
    if (asset.isManual) return asset.Currency || null;
    const own = asset.Currency ? String(asset.Currency).trim().toUpperCase() : '';
    if (/^[A-Z]{3}$/.test(own)) return own;
    const C = window.PortfolioCalculations;
    const SC = window.SymbolCode;
    const sym = (SC && SC.fromRow ? SC.fromRow(asset) : null) || (asset.Code + '.' + (asset.Exchange || 'US'));
    return (C && C.currencyFromSymbol ? C.currencyFromSymbol(sym) : null) || null;
  };
  const unknownCurrencyNote = (asset) => {
    const SC = window.SymbolCode;
    const sym = (asset && SC && SC.fromRow ? SC.fromRow(asset) : null) || String((asset && asset.Code) || '');
    return sym + ': the currency it is quoted in is not known, so its price cannot be converted. Add it as a Manual asset instead.';
  };
  // With a prefillSymbol, selectedAsset has to be set synchronously, together
  // with step 3: otherwise the first render of step 3 reads
  // selectedAsset.isManual on null and the component throws (setting it in an
  // effect comes one render too late).
  const initialAsset = React.useMemo(() => {
    if (!prefillSymbol) return null;
    const parts = prefillSymbol.split('.');
    const code = parts[0];
    const exchange = parts.slice(1).join('.') || 'US';
    // Type: what the asset page knows (EODHD's General.Type). Without it a
    // fund or an ETF added from its page was saved as a stock, and the
    // allocation read "Stocks 100%".
    // Name: the asset page's (EODHD's General.Name), else the code until the
    // lookup below finds one.
    // Currency: its exchange's, never a guess of USD (VOD.LSE is in pence).
    return { Code: code, Exchange: exchange, Name: prefillAssetName || code, Currency: listingCurrencyOf({ Code: code, Exchange: exchange }), Type: prefillType || '' };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, at mount, on purpose

  const [step, setStep] = React.useState(prefillSymbol ? 3 : 1);
  const [assetType, setAssetType] = React.useState('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState([]);
  const [searching, setSearching] = React.useState(false);
  // The list of matches is the top layer while it shows: Back or Esc closes
  // it and keeps the dialog and what was typed. Only
  // while it is on screen -- the search step, the list drawn, not loading:
  // after a pick the results stayed in state and the first Esc or Back on
  // Transaction Details cleared that invisible list.
  const matchesShown = step === 1 && assetType !== 'manual' && !searching && searchResults.length > 0;
  (window.useEscLayer || (() => {}))(matchesShown, () => setSearchResults([]));
  const [selectedAsset, setSelectedAsset] = React.useState(initialAsset);
  // The company name for a symbol handed in from the asset page: it arrives
  // as a bare code, and the card read "MCD / MCD". Kept apart from
  // selectedAsset so the lookup does not re-run the price fetch over a price
  // already typed.
  const [prefillName, setPrefillName] = React.useState(null);
  const [prefillRowType, setPrefillRowType] = React.useState(null);
  // The prefill's search, kept.
  const prefillSearchRef = React.useRef(null);
  // Where that search stands, when the host sent a bare symbol with no type:
  // 'pending' until it answers, 'found', or 'failed' (no row, an error, or no
  // answer in PREFILL_LOOKUP_MS). A save waited 5 s and then stored VFIAX as
  // a stock: now the button waits for the answer, and with none
  // the user says what the asset is (prefillChosenType). Never a guess.
  const [prefillLookup, setPrefillLookup] = React.useState(prefillSymbol && !prefillType ? 'pending' : 'found');
  const [prefillChosenType, setPrefillChosenType] = React.useState('');
  const [manualName, setManualName] = React.useState('');
  const [manualPrice, setManualPrice] = React.useState('');
  const [manualCurrency, setManualCurrency] = React.useState(baseCurrency);
  const [txType, setTxType] = React.useState('buy');
  // Today in the user's own calendar. The UTC date booked an evening trade in
  // New York on tomorrow's date.
  const [txDate, setTxDate] = React.useState(() => window.PortfolioCalculations.todayISO());
  const txDateRef = React.useRef(txDate);
  txDateRef.current = txDate;
  // Whether the price in the field is the user's own; then a date change
  // leaves it. "Close on <date>" says where a filled-in price came from.
  const priceTypedRef = React.useRef(false);
  const closeRequestRef = React.useRef(0);
  const [priceNote, setPriceNote] = React.useState(null);
  const [txQuantity, setTxQuantity] = React.useState('');
  const [txPrice, setTxPrice] = React.useState('');
  const [txFees, setTxFees] = React.useState('0');
  const [exchangeRate, setExchangeRate] = React.useState(1);
  const [loadingFX, setLoadingFX] = React.useState(false);
  const [fxError, setFxError] = React.useState(null);
  // Two guards:
  // - priceRequestRef tracks the most recent quote-fetch symbol; older requests
  //   that resolve out of order are dropped (was: any in-flight response stomped txPrice)
  // - savingRef gates handleSave so a double-tap on the submit button can't
  //   create the same holding+transaction twice (was: createHolding ran twice)
  const priceRequestRef = React.useRef(0);
  const savingRef = React.useRef(false);
  const [saving, setSaving] = React.useState(false);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  // Light theme: darker success/error/warning inks and accents, so text clears
  // 4.5:1 on white (Calc.themeInk).
  const C3 = window.PortfolioCalculations.themeInk(window.C3, theme === 'dark');
  const acc = (hex) => window.PortfolioCalculations.accent(hex, theme === 'dark');
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
      ...(isDark ? C3.glassDark : C3.glassLight),
      // Opaque: at 0.95 the page showed through behind the fields.
      background: isDark ? 'rgb(30, 30, 50)' : '#ffffff',
      backdropFilter: 'none',
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 400,
      maxHeight: '90vh',
      overflowY: 'auto',
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      borderRadius: 12,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 16,
      outline: 'none',
      boxSizing: 'border-box'
    },
    label: {
      display: 'block',
      fontSize: 14,
      marginBottom: 8,
      color: isDark ? C3.textMutedDark : C3.textMutedLight
    },
    iconButton: {
      padding: 4,
      borderRadius: 8,
      background: 'transparent',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    card: {
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      borderRadius: 12,
      padding: 12
    }
  };

  const ASSET_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'stock', label: 'Stocks' },
    { id: 'etf', label: 'ETF' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'forex', label: 'Forex' },
    { id: 'manual', label: 'Manual' },
  ];

  // The text the list is the search's answer to, an empty answer included:
  // Enter on "ZZZQQ" or "VOD.L" with no rows did nothing and said nothing.
  // Only the newest search speaks.
  const [answeredFor, setAnsweredFor] = React.useState(null);
  const searchSeqRef = React.useRef(0);
  // The text whose search failed: its empty list is no answer.
  const searchFailedForRef = React.useRef(null);
  const resultsKbRef = React.useRef(null);
  const handleSearch = async () => {
    if (!searchQuery.trim() || assetType === 'manual') return;
    const seq = ++searchSeqRef.current;
    const asked = searchQuery;
    setSearching(true);
    let shown = [];
    // A search that failed is said as such, never "No results found" -- a
    // 500 or a 429 read as an empty answer.
    let failed = null;
    let thrown;
    const SC = window.SymbolCode;
    try {
      // The code alone for Yahoo's suffix: search/VOD.L answers nothing,
      // search/VOD answers VOD.LSE (window.SymbolCode.searchText).
      const results = (await window.EODHD_API.searchStocks(apiKey, SC && SC.searchText ? SC.searchText(asked) : asked, { throwErrors: true })) || [];

      // Filter by selected type, or show all
      const filtered = assetType === 'all' ? results : results.filter(r => {
        if (assetType === 'crypto') return r.Exchange === 'CC';
        if (assetType === 'forex') return r.Exchange === 'FOREX';
        if (assetType === 'etf') return (r.Type || '').toUpperCase() === 'ETF';
        // Stocks: everything that's not crypto/forex/etf/bond
        return r.Exchange !== 'CC' && r.Exchange !== 'FOREX';
      });
      shown = filtered.slice(0, 15);
    } catch (e) {
      if (!(e && e.rateLimited)) console.error('Search error:', e);
      thrown = e;
      failed = SC && SC.searchFailNote ? SC.searchFailNote(e, SC.apiFor(window.EODHD_API, apiKey).limited()) : 'The ticker search did not load. Try again.';
    }
    if (seq !== searchSeqRef.current) return;
    searchFailedForRef.current = failed ? asked : null;
    setSearchResults(shown);
    setAnsweredFor(asked);
    setSearching(false);
    // At the limit the line counts the wait down and the search is asked
    // again by itself once it is over (useComboboxKeys `search`).
    if (failed && resultsKbRef.current && resultsKbRef.current.say) resultsKbRef.current.say(failed, { error: thrown });
  };

  React.useEffect(() => {
    setAnsweredFor(null);
    if (searchQuery.length >= 2 && assetType !== 'manual') {
      const timer = setTimeout(handleSearch, 300);
      return () => clearTimeout(timer);
    } else {
      searchSeqRef.current++;
      setSearchResults([]);
      setSearching(false);
    }
  }, [searchQuery, assetType]);

  // Prefill from asset detail "+" Portfolio button — skip straight to transaction step.
  // We only need the FX fetch here; the selectedAsset effect below owns the price fetch
  // (running both was a race that could overwrite the form with stale data).
  React.useEffect(() => {
    if (!prefillSymbol) return;
    const parts = prefillSymbol.split('.');
    const code = parts[0];
    const exchange = parts.slice(1).join('.') || 'US';
    // The listing's own currency (it was USD for every page, VOD.LSE too);
    // none known: said, and nothing is saved at a guessed rate.
    if (initialAsset && initialAsset.Currency) fetchExchangeRate(initialAsset.Currency);
    else { setExchangeRate(null); setFxError(unknownCurrencyNote(initialAsset)); }
    // selectedAsset was already initialized via useMemo on mount, and the
    // effect below will run on first render to fetch the price.
    let gone = false;
    const isUS = (ex) => ['US', 'NYSE', 'NASDAQ', 'AMEX', 'BATS', 'NYSE ARCA'].indexOf(String(ex || '').toUpperCase()) !== -1;
    const search = Promise.resolve(window.EODHD_API && window.EODHD_API.searchStocks ? window.EODHD_API.searchStocks(apiKey, code, { throwErrors: true }) : []);
    // No answer in time: the user is asked; an answer that comes later still
    // fills the type and name in.
    const timer = setTimeout(() => { if (!gone) setPrefillLookup((s) => (s === 'pending' ? 'failed' : s)); }, window.PREFILL_LOOKUP_MS);
    prefillSearchRef.current = search
      .then((rows) => {
        if (!Array.isArray(rows)) { if (!gone) setPrefillLookup('failed'); return null; }
        const hit = rows.find(r => r && String(r.Code).toUpperCase() === code.toUpperCase()
          && (String(r.Exchange).toUpperCase() === exchange.toUpperCase() || (isUS(exchange) && isUS(r.Exchange)))) || null;
        if (gone) return hit;
        // The host's name stays: the search's replaced "Apple Inc" with
        // "Apple Inc." and a fund's with its name in capitals.
        if (hit && hit.Name && hit.Name !== code && !prefillAssetName) setPrefillName(hit.Name);
        // The search row's type, when the page did not say: the same answer,
        // no further request.
        if (hit && hit.Type && !prefillType) setPrefillRowType(hit.Type);
        // The row's currency beats the exchange's (0R0X.LSE is in dollars).
        const hitCcy = hit && hit.Currency ? String(hit.Currency).trim().toUpperCase() : '';
        if (/^[A-Z]{3}$/.test(hitCcy) && initialAsset && hitCcy !== initialAsset.Currency) {
          setSelectedAsset((a) => (a && !a.isManual && a.Code === initialAsset.Code && a.Exchange === initialAsset.Exchange ? { ...a, Currency: hitCcy } : a));
          fetchExchangeRate(hitCcy);
        }
        // Once the question is on screen it stays: a late answer swapping it
        // away took the focus with it when the user was in it. The answer's type is offered as the choice instead, unless
        // the user has chosen already.
        setPrefillLookup((s) => (s === 'failed' ? 'failed' : (hit ? 'found' : 'failed')));
        if (hit) {
          const Calc = window.PortfolioCalculations;
          const t = Calc && Calc.typeFromSearchRow ? Calc.typeFromSearchRow({ Type: hit.Type || '', Exchange: hit.Exchange }) : null;
          if (['stock', 'etf', 'fund', 'bond'].indexOf(t) !== -1 && (hit.Type || t !== 'stock')) setPrefillChosenType((c) => c || t);
        }
        return hit;
      })
      .catch(() => { if (!gone) setPrefillLookup('failed'); return null; }); // the code stays the label
    return () => { gone = true; clearTimeout(timer); };
  }, [prefillSymbol]);

  // The price of the asset now selected, for the date in the form: the live
  // quote today, that day's close (or the last session's before it) for a
  // past date. Each lookup outdates the one before it, so an answer for the
  // asset picked a moment ago never lands on this one.
  const fillPrice = (asset, date) => {
    const req = ++closeRequestRef.current;
    if (!asset || asset.isManual || !asset.Code) return;
    if (date && date < Calc.todayISO()) {
      const symbol = `${asset.Code}.${asset.Exchange}`;
      Calc.closeOn(apiKey, symbol, date).then((c) => {
        if (req !== closeRequestRef.current || priceTypedRef.current) return;
        if (c && c.close > 0) { setTxPrice(String(c.close)); setPriceNote(`Close on ${c.date}`); }
        else if (c && c.failed) {
          // The history did not load: said with its reason, not as a day
          // with no price.
          setTxPrice('');
          setPriceNote(`the close for ${date} did not load: ${window.RateLimitWait.failReason(c.failed)} Enter what you paid.`);
        } else {
          // No close on record for that day (a 1975 buy): today's price
          // stayed in the field and the trade was saved at it with no word.
          // The field is emptied and says why.
          setTxPrice('');
          setPriceNote(`no price on record for ${date}, enter what you paid`);
        }
      });
    } else {
      setPriceNote(null);
      fetchCurrentPrice(asset);
    }
  };

  React.useEffect(() => {
    if (selectedAsset?.Code) fillPrice(selectedAsset, txDateRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAsset]);

  const fetchCurrentPrice = async (asset) => {
    // Increment a per-call request id and only apply the result if no newer
    // call has started in the meantime — guards against the user switching
    // assets faster than the network can resolve a quote.
    const requestId = ++priceRequestRef.current;
    const symbol = `${asset.Code}.${asset.Exchange}`;
    try {
      const data = await window.EODHD_API.getRealTimeData(apiKey, symbol);
      // Drop the response if a newer fetch was kicked off OR if the user
      // moved to a different asset while this one was in flight.
      if (priceRequestRef.current !== requestId) return;
      if (selectedAssetSymbol() !== symbol) return;
      // A typed price, or a past date's close already filled in, stays.
      if (priceTypedRef.current || txDateRef.current < Calc.todayISO()) return;
      if (data?.close) setTxPrice(data.close.toString());
    } catch (e) {
      if (priceRequestRef.current !== requestId) return;
      console.error('Price fetch error:', e);
    }
  };

  const selectedAssetSymbol = () => {
    if (!selectedAsset || selectedAsset.isManual) return null;
    return `${selectedAsset.Code}.${selectedAsset.Exchange}`;
  };

  // The rate of the trade's own date (Calc.tradeFxRate): a backdated purchase
  // took today's rate and showed no currency gain. Fetched again when the date changes.
  const fxRequestRef = React.useRef(0);
  const fetchExchangeRate = async (assetCurrency, date = txDate) => {
    setFxError(null);
    if (assetCurrency === baseCurrency) { setExchangeRate(1); return; }
    const req = ++fxRequestRef.current;
    setLoadingFX(true);
    // Calc.fxRate maps minor units (GBX = GBP/100) and returns null, never
    // the string "NA": EODHD answers GBXUSD with close "NA", which was
    // truthy, stored, and then crashed the modal on "NA".toFixed.
    const unavailable = `Could not get the ${assetCurrency}/${baseCurrency} rate. The position can't be saved without it — try again in a moment.`;
    try {
      const found = await Calc.tradeFxRate(apiKey, assetCurrency, baseCurrency, date);
      if (req !== fxRequestRef.current) return;
      const rate = found && found.rate;
      if (rate) {
        setExchangeRate(rate);
        if (found.live) Storage.setCachedForexRate(assetCurrency, baseCurrency, rate);
        if (!found.onDate) setFxError(`No ${assetCurrency}/${baseCurrency} rate for ${date}; today's rate is used.`);
      }
      else {
        const cached = Calc.toRate(Storage.getCachedForexRate(assetCurrency, baseCurrency, true));
        // The rate did not load (the limit, EODHD's error, a dropped
        // connection, an unreadable answer): said with its reason.
        const why = found && found.failed ? window.RateLimitWait.failReason(found.failed) : null;
        if (cached) { setExchangeRate(cached); setFxError(why ? `The ${assetCurrency}/${baseCurrency} rate did not load: ${why} Using the last known ${cached.toFixed(4)}.` : `${assetCurrency}/${baseCurrency} rate unavailable — using the last known ${cached.toFixed(4)}.`); }
        // No rate at all: null, not parity. Saving at 1:1 put a pence-quoted
        // position's cost basis out by 75x; the save button waits instead.
        else { setExchangeRate(null); setFxError(why ? `The ${assetCurrency}/${baseCurrency} rate did not load: ${why} The position can't be saved without it — try again in a moment.` : unavailable); }
      }
    } catch (e) {
      setExchangeRate(null);
      setFxError(unavailable);
    }
    setLoadingFX(false);
  };

  const handleSelectAsset = (picked) => {
    // A pick ends what an Enter left out: its late answer (VOD.LSE) must not
    // replace this row (VOD.US).
    if (resultsKb && resultsKb.cancel) resultsKb.cancel();
    const ccy = listingCurrencyOf(picked);
    if (!ccy) { if (resultsKb && resultsKb.say) resultsKb.say(unknownCurrencyNote(picked)); return; }
    const asset = { ...picked, Currency: ccy };
    // A new asset starts with no price: the last asset's (typed, quoted or a
    // past day's close) must never be saved as this one's.
    priceTypedRef.current = false;
    closeRequestRef.current++;
    priceRequestRef.current++;
    setPriceNote(null);
    setTxPrice('');
    setSelectedAsset(asset);
    setStep(3);
    fetchExchangeRate(ccy);
    // The list leaves with the pick and the focus fell to <body>; Tab then
    // started the page from the top. On to Date, the
    // first field of the form, once it is there.
    focusNext(() => document.getElementById('pt-addpos-date'));
  };
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();
  // Arrows and Enter over the results, like What-If and Alerts: the results
  // were plain buttons reachable only with Tab.
  const useComboboxKeys = window.useComboboxKeys || (() => ({ active: -1, inputProps: {}, optionProps: () => ({}) }));
  // Enter with no row that is the text: the reader every picker uses
  // (window.SymbolCode.forPicker) -- "VOD.L" is VOD.LSE once the search for
  // VOD.LSE lists it (SymbolCode.listed), "ZZZQQ" is "No listing found for ZZZQQ", and an index says
  // what to buy instead. The asset made from a
  // symbol the search did not list takes its exchange's currency.
  const SCode = window.SymbolCode;
  const resolveTyped = SCode && SCode.forPicker ? SCode.forPicker(window.EODHD_API, apiKey, {
    failed: (q) => searchFailedForRef.current === q,
    indexNote: (s) => (Calc && Calc.indexNotBuyable ? Calc.indexNotBuyable(s) : s + ' is an index, which cannot be held.'),
    // A listing whose currency nobody knows is said, not priced as dollars.
    refuse: (res) => (listingCurrencyOf(res.row) ? null : unknownCurrencyNote(res.row)),
    toItem: (res) => (res.row && res.row.checked
      ? { ...res.row, Name: res.row.Code, Currency: listingCurrencyOf(res.row) }
      : res.row),
  }) : undefined;
  const resultsKb = useComboboxKeys({ items: searchResults, open: matchesShown, onPick: handleSelectAsset, listId: 'pt-addpos-results', query: searchQuery, codeOf: (r) => r.Code, isDark, answered: answeredFor, resolve: resolveTyped, search: () => handleSearch() });
  resultsKbRef.current = resultsKb;

  // Said under the field, not with the browser's alert().
  const [manualNameNote, setManualNameNote] = React.useState('');
  const handleManualNext = () => {
    if (!manualName.trim()) {
      setManualNameNote('Enter the asset\'s name.');
      const f = document.getElementById('pt-addpos-name');
      if (f) f.focus();
      return;
    }
    setManualNameNote('');
    setSelectedAsset({ Code: null, Name: manualName, Currency: manualCurrency, isManual: true });
    setTxPrice(manualPrice || '0');
    setStep(3);
    fetchExchangeRate(manualCurrency);
  };

  // What is wrong with the numbers as typed, said under the fields while the
  // button stays off. -10 shares showed "Total -$5,000.00" with the button
  // live, 0 shares and price 0 were accepted up to an alert, and fees of -50
  // were quietly counted as +50.
  const qtyWord = selectedAsset && selectedAsset.isManual ? 'Quantity' : selectedAsset && selectedAsset.Exchange === 'CC' ? 'Amount' : 'Shares';
  // Fields are text now and read by window.NumberInput: a Chrome-EN number
  // field turned "250,5" into 2505 before the page saw it.
  const num = (v) => (window.NumberInput ? window.NumberInput.parse(v) : Number(v));
  const numError = (v, what) => {
    const c = window.NumberInput ? window.NumberInput.check(v) : null;
    return c && c.error ? `${what}: ${c.error}` : `${what} must be a number`;
  };
  const formProblem = (() => {
    const blank = (v) => String(v ?? '').trim() === '';
    // A date out of range, said here: 1900 left the button off with no
    // reason, 2030 left it on and Save did nothing.
    const dateProblem = Calc.checkTradeDate ? Calc.checkTradeDate(txDate) : null;
    if (dateProblem) return dateProblem;
    if (!blank(txQuantity)) {
      const q = num(txQuantity);
      if (!Number.isFinite(q)) return numError(txQuantity, qtyWord);
      if (q <= 0) return `${qtyWord} must be more than 0`;
    }
    if (!blank(txPrice)) {
      const p = num(txPrice);
      if (!Number.isFinite(p)) return numError(txPrice, selectedAsset && selectedAsset.isManual ? 'Total value' : 'Price');
      if (p <= 0) return selectedAsset && selectedAsset.isManual ? 'Total value must be more than 0' : 'Price must be more than 0';
    }
    if (!blank(txFees)) {
      const f = num(txFees);
      if (!Number.isFinite(f)) return numError(txFees, 'Fees');
      if (f < 0) return "Fees can't be negative — enter what you paid, e.g. 4.95";
    }
    // An upper bound, said here rather than after Save.
    if (!blank(txQuantity) && Calc.amountProblem) {
      const tooBig = Calc.amountProblem(txType, num(txQuantity), blank(txPrice) ? null : num(txPrice));
      if (tooBig) return tooBig.replace(/^The quantity/, qtyWord);
    }
    return null;
  })();
  // The symbol the host handed in, with no type from it: the save waits for
  // its search, or for the user to say what it is.
  const onPrefill = !!(prefillSymbol && !prefillType && initialAsset && selectedAsset && !selectedAsset.isManual
    && selectedAsset.Code === initialAsset.Code && selectedAsset.Exchange === initialAsset.Exchange
    && ['CC', 'FOREX'].indexOf(String(selectedAsset.Exchange || '').toUpperCase()) === -1);
  const prefillAsks = onPrefill && prefillLookup === 'failed';
  const lookupHint = onPrefill && prefillLookup === 'pending' ? `Looking up ${selectedAsset.Code}…`
    : prefillAsks && !prefillChosenType ? `Choose what ${selectedAsset.Code} is` : null;
  const cannotSave = !txQuantity || !txPrice || !!formProblem || !!lookupHint || saving || loadingFX || exchangeRate == null;
  // Fees are checked next to their own field: with the reason only above the
  // button, Fees -50 read as a dead button.
  const feesProblem = (() => {
    if (String(txFees ?? '').trim() === '') return null;
    const f = num(txFees);
    if (!Number.isFinite(f)) return numError(txFees, 'Fees');
    return f < 0 ? "Fees can't be negative — enter what you paid, e.g. 4.95" : null;
  })();
  // Every way the button can be off says why, not only a bad number.
  const saveHint = formProblem
    || lookupHint
    || (!txQuantity ? `Enter the ${qtyWord.toLowerCase()} to add` : null)
    || (!txPrice ? (selectedAsset && selectedAsset.isManual ? 'Enter the total value' : 'Enter the price') : null)
    || (loadingFX ? 'Loading the exchange rate…' : null)
    // A rate that did not load is said once, by fxError in the total's card
    // (with its reason): repeated here it was the same sentence twice.
    || (exchangeRate == null && !saving ? (fxError ? null : 'Waiting for the exchange rate — try again in a moment') : null);

  // The holding's type: the search row's or the asset page's EODHD type
  // ("FUND", "ETF", "Common Stock"), else the type the prefill's own search
  // found, else the known ETF list. A fund added from its page was a stock.
  const holdingTypeOf = (asset) => {
    if (asset.isManual) return 'manual';
    const Calc = window.PortfolioCalculations;
    const named = asset.Type || (asset === initialAsset || (initialAsset && asset.Code === initialAsset.Code) ? prefillRowType : '') || '';
    if (Calc && Calc.typeFromSearchRow) {
      const t = Calc.typeFromSearchRow({ Type: named, Exchange: asset.Exchange });
      if (t !== 'stock' || named) return t;
      return (Calc.knownAssetType && Calc.knownAssetType(asset.Code + '.' + (asset.Exchange || 'US'))) || 'stock';
    }
    return asset.Exchange === 'CC' ? 'crypto' : asset.Exchange === 'FOREX' ? 'forex'
      : /etf/i.test(named) ? 'etf' : /fund/i.test(named) ? 'fund' : 'stock';
  };

  // A save that did not reach the account: said in the form, which stays
  // open.
  const [syncError, setSyncError] = React.useState(null);
  const [limitCard, setLimitCard] = ((window.FreeLimitWalls && window.FreeLimitWalls.useLimitCard) || (() => React.useState(null)))();

  const handleSave = async () => {
    // Idempotency guard: a double tap on mobile/TG can fire onClick twice
    // before the modal unmounts. The savingRef short-circuits the second tap
    // synchronously (state updates would lag a frame, the ref doesn't).
    if (savingRef.current) return;
    if (!txQuantity || !txPrice || formProblem || lookupHint) return;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) return; // no rate yet — never saved at parity
    savingRef.current = true;
    setSaving(true);
    setSyncError(null);
    if (limitCard) setLimitCard(null);
    try {
      const fullSymbol = selectedAsset.isManual ? null : `${selectedAsset.Code}.${selectedAsset.Exchange}`;
      const quantity = num(txQuantity);

      // A name already in the portfolio gets the transaction added to its
      // holding, not a second holding. Every save used to create one: a
      // second buy split a position into two rows, and a sale became a row of
      // minus eight shares at an average cost of $0.00, with the row beside it
      // weighing 166.7% of the portfolio. The CSV importer
      // already looked the holding up first; the form now does the same.
      // A manual asset has no symbol, so it is matched by name -- otherwise a
      // second entry for "My flat" would be a second flat, and its sale would
      // find nothing to sell. A symbol is one listing however it was stored:
      // a legacy "AAPL" or "aapl.us" is AAPL.US (Storage.holdingOf, the
      // importer's reading); an exact match was a second AAPL row.
      const wantedName = String(selectedAsset.Name || '').trim().toLowerCase();
      const findHeld = () => {
        const inPortfolio = Storage.getHoldingsByPortfolio(portfolioId);
        if (!fullSymbol) {
          return inPortfolio.find(h => h.type === 'manual' && !h.symbol && wantedName
            && String(h.name || '').trim().toLowerCase() === wantedName);
        }
        return Storage.holdingOf ? Storage.holdingOf(portfolioId, fullSymbol) : inPortfolio.find(h => h.symbol === fullSymbol);
      };
      let holding = findHeld();

      // The rules every way in shares (Calc.validateTransaction): a sale
      // checked against the whole history -- a backdated one used to pass on
      // its own date and oversell a later sale -- no date in the future or
      // before 1950, fees as a cost.
      const candidate = { type: txType, date: txDate, quantity, price: num(txPrice), fees: num(txFees) || 0 };
      const history = holding ? Storage.getTransactionsByHolding(holding.id) : [];
      const label = selectedAsset.Code || selectedAsset.Name;
      const problem = txType === 'sell' && !history.length
        ? `No open position in ${label} to sell`
        : Calc.validateTransaction(history, candidate);
      if (problem) {
        // In the window, under the form, not alert().
        setSyncError(problem);
        savingRef.current = false;
        setSaving(false);
        return;
      }

      // A host's bare symbol is saved with the type its search found, or the
      // one the user chose when it found nothing; the button is off until one
      // of the two is there (lookupHint). VFIAX was stored as a stock after a
      // 5 s wait.
      const savedType = prefillAsks && prefillChosenType ? prefillChosenType : holdingTypeOf(selectedAsset);
      const savedName = shownAsset.Name;

      if (!holding) {
        const W = window.FreeLimitWalls;
        const walled = W ? W.portfolioConfirm([['positions', () => Storage.getHoldingsByPortfolio(portfolioId).length + 1]]) : null;
        const refusal = walled ? await walled : null;
        if (walled) holding = findHeld();
        if (!holding && refusal) {
          setLimitCard(refusal);
          savingRef.current = false;
          setSaving(false);
          return;
        }
      }
      const created = !holding;
      if (!holding) {
        holding = Storage.createHolding({
          portfolioId,
          // The search row's type: a mutual fund (VFIAX, "FUND") was stored
          // as a stock, so it read "Stocks 100%" with no sector.
          type: savedType,
          symbol: fullSymbol,
          name: savedName,
          manualPrice: selectedAsset.isManual ? num(txPrice) : null,
          manualPriceDate: selectedAsset.isManual ? txDate : null,
          currency: selectedAsset.Currency || baseCurrency
        });
      }
      let createdTx = null;
      try {
        createdTx = Storage.createTransaction({
          holdingId: holding.id,
          type: txType,
          date: txDate,
          quantity,
          price: num(txPrice),
          fees: candidate.fees,
          currency: selectedAsset.Currency || baseCurrency,
          exchangeRate: exchangeRate
        });
      } catch (e) {
        // No position without its trade: the holding made for it goes too.
        if (created) { try { Storage.deleteHolding(holding.id); } catch (_) { /* nothing more to undo */ } }
        throw e;
      }
      // One request for the trade and the holding, before the form closes.
      const sync = window.DataSync && window.DataSync.pushNow
        ? await window.DataSync.pushNow({ pt_transactions: Storage.getTransactions(), pt_holdings: Storage.getHoldings() })
        : { ok: true, skipped: true };
      if (!sync.ok && sync.uncertain) {
        // Perhaps stored (or no answer within the save's time limit): kept.
        // pushNow already marked it pending -- resent until acknowledged, the
        // portfolio says "Saved on this device, syncing". Undoing it here and
        // saving again could book the trade twice.
      } else if (!sync.ok) {
        // Refused: this save is taken back, and only this save -- whatever
        // else reached the device meanwhile (a pull, another tab) stays.
        try {
          if (created) Storage.deleteHolding(holding.id);
          else if (createdTx && createdTx.id) Storage.deleteTransaction(createdTx.id);
        } catch (_) { /* nothing more to undo */ }
        savingRef.current = false;
        setSaving(false);
        setSyncError(`The position was not saved: your account did not take it (${sync.error}). Check the connection and try again.`);
        return;
      }
      onSave?.(portfolioId);
      onClose?.();
    } catch (e) {
      // If the storage layer throws, drop the guard so the user can retry.
      savingRef.current = false;
      setSaving(false);
      // A refusal from storage (full, portfolio deleted in another tab) is
      // said, not swallowed: the form used to close as if saved.
      if (e && e.name === 'PortfolioStorageError') {
        if (e.code === 'free-limit' && e.refusal) setLimitCard(e.refusal);
        else setSyncError(e.message);
        return;
      }
      throw e;
    }
  };

  // Nothing to add up until both numbers are in: with the price filled from
  // the quote and no shares yet, Total read "$0.00".
  const total = formProblem || String(txQuantity ?? '').trim() === '' || String(txPrice ?? '').trim() === ''
    ? null : num(txQuantity) * num(txPrice) + (num(txFees) || 0);
  const shownAsset = selectedAsset && prefillName && selectedAsset.Code === (initialAsset && initialAsset.Code)
    ? { ...selectedAsset, Name: prefillName } : selectedAsset;

  // Another portfolio may have another base currency: a new rate.
  const fxPortfolioSeen = React.useRef(portfolioId);
  React.useEffect(() => {
    if (fxPortfolioSeen.current === portfolioId) return;
    fxPortfolioSeen.current = portfolioId;
    if (step === 3 && selectedAsset && listingCurrencyOf(selectedAsset)) fetchExchangeRate(listingCurrencyOf(selectedAsset), txDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  // A new date is a new rate (the trade day's).
  const fxDateSeen = React.useRef(txDate);
  React.useEffect(() => {
    if (fxDateSeen.current === txDate) return;
    fxDateSeen.current = txDate;
    if (step === 3 && selectedAsset && listingCurrencyOf(selectedAsset)) fetchExchangeRate(listingCurrencyOf(selectedAsset), txDate);
    // And a new price, unless the user typed one: a past date takes that
    // day's close (or the last session's before it), today the live quote.
    // The price stayed today's for a purchase on 1 October.
    if (step === 3 && selectedAsset && !selectedAsset.isManual && !priceTypedRef.current) fillPrice(selectedAsset, txDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txDate]);

  return (
    <div className="pt-addpos" style={styles.container} {...dialogProps}>
      {/* Hints read as hints: muted and italic, so "e.g. 10" is not taken for
          a value already filled in. Scoped to this dialog. */}
      <style>{`.pt-addpos input::placeholder { color: ${isDark ? C3.textMutedDark : C3.textMutedLight}; opacity: 1; font-style: italic; }`}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {step > 1 && (
            <button onClick={() => {
              // From step 3 go back to step 1 when the user came through search (not Manual);
              // a plain decrement would land on step 2, an empty Manual Asset screen.
              if (step === 3 && assetType !== 'manual') {
                setSelectedAsset(null);
                setStep(1);
              } else if (step === 2) {
                // Back from Manual Asset is the search form; step 1 with the
                // Manual filter still on drew an empty window.
                setAssetType('all');
                setStep(1);
              } else {
                setStep(step - 1);
              }
            }} style={styles.iconButton} aria-label="Back">
              <Icon name="chevronLeft" size={20} />
            </button>
          )}
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {step === 1 ? 'Add Position' : step === 2 ? 'Manual Asset' : 'Transaction Details'}
          </h3>
        </div>
        <button onClick={onClose} style={styles.iconButton} aria-label="Close">
          <Icon name="x" size={24} />
        </button>
      </div>

      {/* Step 1: Search Asset (unified — filter chips + search) */}
      {step === 1 && assetType !== 'manual' && (
        <div>
          {/* Filter chips */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {ASSET_FILTERS.map(f => (
              <button key={f.id} onClick={() => { setAssetType(f.id); if (f.id === 'manual') { setStep(2); } }} style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                color: isDark ? C3.textDark : C3.textLightTheme,
                ...window.ToggleStyle.value(assetType === f.id, isDark),
                fontSize: 12, fontWeight: 600,
              }}>{f.label}</button>
            ))}
          </div>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}>
              <Icon name="search" size={20} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
            </div>
            <input
              type="text"
              placeholder="Stock, ETF, crypto, FX"
              aria-label="Search stocks, ETFs, crypto, forex"
              {...resultsKb.inputProps}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ ...styles.input, paddingLeft: 40 }}
              autoFocus
            />
          </div>
          {resultsKb.noteEl}
          {searching ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <div style={{ width: 24, height: 24, border: '3px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
            </div>
          ) : searchResults.length > 0 ? (
            <div id="pt-addpos-results" role="listbox" aria-label="Matches" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 256, overflowY: 'auto' }}>
              {searchResults.map((result, i) => (
                <button
                  key={i}
                  {...resultsKb.optionProps(i)}
                  onClick={() => handleSelectAsset(result)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 12, cursor: 'pointer', background: i === resultsKb.active ? (isDark ? 'rgba(249,115,22,0.16)' : 'rgba(249,115,22,0.12)') : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'), border: i === resultsKb.active ? '1px solid #f97316' : '1px solid transparent', color: isDark ? C3.textDark : C3.textLightTheme }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 600 }}>{result.Code}</div>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.Name}</div>
                  </div>
                  <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{result.Exchange}</div>
                </button>
              ))}
            </div>
          ) : resultsKb.note ? null : searchQuery.length >= 2 ? (
            <div style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>No results found</div>
          ) : (
            <div style={{ textAlign: 'center', padding: 32, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Type at least 2 characters to search</div>
          )}
        </div>
      )}

      {/* Step 2: Manual Asset */}
      {step === 2 && assetType === 'manual' && (
        <div>
          <p style={{ fontSize: 14, marginBottom: 16, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            Add any asset manually (real estate, bank deposits, private investments, etc.)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={styles.label} htmlFor="pt-addpos-name">Asset Name</label>
              <input id="pt-addpos-name" type="text" placeholder="e.g., Apartment in NYC" value={manualName} onChange={(e) => { setManualName(e.target.value); if (manualNameNote) setManualNameNote(''); }} aria-describedby={manualNameNote ? 'pt-addpos-name-note' : undefined} style={styles.input} />
              {manualNameNote && <div id="pt-addpos-name-note" role="alert" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{manualNameNote}</div>}
            </div>
            <div>
              <label style={styles.label} htmlFor="pt-addpos-value">Current Value</label>
              <input id="pt-addpos-value" {...(window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' })} placeholder="e.g. 350000" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label}>Currency</label>
              {React.createElement(window.PortalDropdown, {
                value: manualCurrency,
                options: window.PortfolioCalculations.BASE_CURRENCIES.map(([c]) => ({ value: c, label: c })),
                onChange: setManualCurrency,
                isDark,
                style: { width: '100%' },
                minWidth: 0,
                ariaLabel: 'Currency',
              })}
            </div>
            <button onClick={handleManualNext} style={{ width: '100%', padding: '14px 24px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 16, background: C3.logoGradient, color: 'white' }}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Transaction Details */}
      {step === 3 && selectedAsset && (
        <div>
          <div style={{ ...styles.card, marginBottom: 16 }}>
            <div style={{ fontWeight: 600 }}>{Calc.listingLabel(shownAsset).code}</div>
            <div style={{ fontSize: 14, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{Calc.listingLabel(shownAsset).detail}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Where it goes: named, and changeable when there is a choice. */}
            {portfolios.length > 0 && (
              <div>
                <label htmlFor="ap-portfolio" style={styles.label}>Portfolio</label>
                {portfolios.length > 1 ? (
                  <select id="ap-portfolio" value={portfolioId || ''} onChange={(e) => setPortfolioId(e.target.value)} style={styles.input}>
                    {portfolios.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.baseCurrency ? ` (${p.baseCurrency})` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <div id="ap-portfolio" style={{ fontSize: 14 }}>{portfolios[0].name}</div>
                )}
              </div>
            )}
            <div>
              <label style={styles.label}>Transaction Type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['buy', 'sell'].map(type => (
                  <button
                    key={type}
                    onClick={() => setTxType(type)}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: 12,
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 600,
                      // Picked in the accent, Buy and Sell alike (they were solid green and red).
                      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                      color: isDark ? C3.textDark : C3.textLightTheme,
                      ...window.ToggleStyle.value(txType === type, isDark)
                    }}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {prefillAsks && (
              <div>
                <label style={styles.label}>What is {selectedAsset.Code}?</label>
                {React.createElement(window.PortalDropdown, {
                  value: prefillChosenType,
                  options: [{ value: 'stock', label: 'Stock' }, { value: 'etf', label: 'ETF' }, { value: 'fund', label: 'Mutual fund' }, { value: 'bond', label: 'Bond' }],
                  onChange: setPrefillChosenType,
                  isDark,
                  placeholder: 'Choose the type',
                  style: { width: '100%' },
                  minWidth: 0,
                  ariaLabel: 'Type of ' + selectedAsset.Code,
                })}
                <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  The search did not say what {selectedAsset.Code} is. The type sets how the portfolio groups it.
                </div>
              </div>
            )}
            <div>
              <label style={styles.label} htmlFor="pt-addpos-date">Date</label>
              <input id="pt-addpos-date" type="date" min={Calc.EARLIEST_TRADE_DATE} max={Calc.todayISO()} value={txDate} onChange={(e) => setTxDate(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label} htmlFor="pt-addpos-qty">{selectedAsset.isManual ? 'Quantity (usually 1)' : selectedAsset.Exchange === 'CC' ? 'Amount' : 'Shares'}</label>
              <input id="pt-addpos-qty" {...(window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' })} placeholder={selectedAsset.isManual ? 'e.g. 1' : selectedAsset.Exchange === 'CC' ? 'e.g. 0.5' : 'e.g. 10'} value={txQuantity} onChange={(e) => setTxQuantity(e.target.value)} style={styles.input} />
            </div>
            <div>
              <label style={styles.label} htmlFor="pt-addpos-price">{(selectedAsset.isManual ? 'Total Value' : 'Price per unit') + (selectedAsset.Currency ? ` (${selectedAsset.Currency})` : '')}{priceNote && <span style={{ fontWeight: 400 }}> · {priceNote}</span>}</label>
              <input id="pt-addpos-price" {...(window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' })} placeholder="e.g. 150.00" value={txPrice} onChange={(e) => { priceTypedRef.current = true; setPriceNote(null); setTxPrice(e.target.value); }} style={styles.input} />
            </div>
            {!selectedAsset.isManual && (
              <div>
                <label style={styles.label} htmlFor="pt-addpos-fees">Fees (optional)</label>
                <input id="pt-addpos-fees" {...(window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' })} placeholder="e.g. 4.95" value={txFees} onChange={(e) => setTxFees(e.target.value)} style={styles.input}
                  aria-invalid={feesProblem ? 'true' : undefined} aria-describedby={feesProblem ? 'pt-addpos-fees-problem' : undefined} />
                {feesProblem && (
                  <div id="pt-addpos-fees-problem" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{feesProblem}</div>
                )}
              </div>
            )}
            <div style={styles.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Total</span>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{total == null ? '—' : Calc.formatCurrency(total, selectedAsset.Currency || baseCurrency)}</span>
              </div>
              {total != null && (selectedAsset.Currency || baseCurrency) !== baseCurrency && Number.isFinite(exchangeRate) && exchangeRate !== 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 14 }}>
                  <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{loadingFX ? 'Loading FX...' : `@ ${exchangeRate < 0.01 ? exchangeRate.toPrecision(4) : exchangeRate.toFixed(4)} ${selectedAsset.Currency}/${baseCurrency}`}</span>
                  <span style={{ color: theme === 'dark' ? C3.textMutedDark : C3.textMutedLight }}>≈ {Calc.formatCurrency(total * exchangeRate, baseCurrency)}</span>
                </div>
              )}
              {/* A rate that could not be fetched used to pass in silence and
                  leave the position recorded at parity. */}
              {fxError && (
                <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: C3.warning }}>{fxError}</div>
              )}
            </div>
            {formProblem ? (
              <div role="alert" style={{ fontSize: 13, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{formProblem}</div>
            ) : (cannotSave && saveHint && !saving) ? (
              <div role="status" style={{ fontSize: 13, lineHeight: 1.5, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{saveHint}</div>
            ) : null}
            {syncError && (
              <div role="alert" data-sync-error style={{ fontSize: 13, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{syncError}</div>
            )}
            {limitCard && window.PlanNotice && window.PlanNotice.RefusalCard
              && React.createElement(window.PlanNotice.RefusalCard, { refusal: limitCard, isDark })}
            <button
              onClick={handleSave}
              disabled={cannotSave}
              style={{ width: '100%', padding: '14px 24px', borderRadius: 12, border: 'none', cursor: cannotSave ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 16, background: C3.logoGradient, color: 'white', opacity: cannotSave ? 0.5 : 1 }}
            >
              {saving ? 'Adding…' : 'Add to Portfolio'}
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
