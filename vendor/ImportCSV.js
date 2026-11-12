// Portfolio Tracker - CSV Import Component (Concept 3 Glassmorphism Design)
// `apiKey` resolves tickers and fetches FX rates. It was not a prop at all:
// both lookups threw a ReferenceError inside their try blocks, so every
// foreign row was booked at a rate of 1 and suffixed tickers were never
// resolved.
window.ImportCSVModal = ({ portfolioId: openedFor, apiKey, baseCurrency: openedCurrency, onClose, onImport, theme }) => {
  // Fixed at opening, as in AddPositionModal: a portfolio deleted in another
  // tab must refuse the import, not redirect it.
  const portfolioId = React.useRef(openedFor).current;
  const baseCurrency = React.useRef(openedCurrency).current;
  // Escape, focus trap, dialog semantics.
  const dialogProps = window.PTDialog.use(onClose, 'Import CSV');
  const [step, setStep] = React.useState(1); // 1: upload, 2: mapping, 3: preview
  const [csvData, setCsvData] = React.useState(null);
  const [headers, setHeaders] = React.useState([]);
  const [rows, setRows] = React.useState([]);
  const [mapping, setMapping] = React.useState({
    symbol: '',
    exchange: '',
    date: '',
    type: '',
    quantity: '',
    price: '',
    fees: '',
    currency: ''
  });
  const [previewData, setPreviewData] = React.useState([]);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;

  // One key per trade, for spotting rows the portfolio already holds --
  // by full symbol on both sides (Calc.importTxKey says why).
  const txKey = (fullSymbol, date, type, quantity, price) => Calc.importTxKey(fullSymbol, date, type, quantity, price);
  // Read from storage each time it is asked, never kept: a snapshot taken
  // when the dialog opened let another tab's import of the same file through.
  const storedTxKeys = () => {
    const keys = new Set();
    try {
      const bySymbol = {};
      Storage.getHoldingsByPortfolio(portfolioId).forEach(h => { bySymbol[h.id] = (h.symbol && Calc.importSymbolGuess(h.symbol)) || h.symbol || h.name || h.id; });
      Storage.getTransactionsByPortfolio(portfolioId).forEach(t => {
        keys.add(txKey(bySymbol[t.holdingId], t.date, t.type, t.quantity, t.price));
      });
    } catch (e) { /* an empty set only disables the duplicate check */ }
    return keys;
  };
  const C3 = window.C3;
  const isDark = theme === 'dark';

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
    modal: {
      // Solid background so the form is readable against the overlay / page behind
      // (glassDark = rgba 5% white was almost invisible on web)
      background: isDark ? '#1E222D' : '#ffffff',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
      boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 500,
      maxHeight: '90vh',
      overflowY: 'auto',
      color: isDark ? C3.textDark : C3.textLightTheme
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
    muted: {
      color: isDark ? C3.textMutedDark : C3.textMutedLight,
      fontSize: 14
    },
    input: {
      width: '100%',
      padding: '12px 16px',
      borderRadius: 12,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 14,
      outline: 'none',
      boxSizing: 'border-box'
    },
    select: {
      flex: 1,
      padding: '10px 12px',
      borderRadius: 8,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 14,
      outline: 'none'
    },
    dropzone: {
      border: `2px dashed ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      borderRadius: 16,
      padding: 32,
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'border-color 0.2s'
    },
    primaryButton: {
      width: '100%',
      padding: 14,
      borderRadius: 12,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 16,
      background: window.C3.logoGradient,
      color: 'white'
    },
    badge: (type) => ({
      fontSize: 12,
      padding: '2px 6px',
      borderRadius: 4,
      background: type === 'buy' ? 'rgba(34,197,94,0.2)' :
                  type === 'sell' ? 'rgba(239,68,68,0.2)' :
                  'rgba(59,130,246,0.2)',
      color: type === 'buy' ? C3.success :
             type === 'sell' ? C3.error :
             '#3b82f6'
    })
  };

  // The broker layout the headers were recognised as ('ib', 'tda' or null);
  // it settles an all-ambiguous date column (TD Ameritrade is month-first).
  const [fileFormat, setFileFormat] = React.useState(null);
  const [delimiter, setDelimiter] = React.useState(',');
  // The decimal separator the user picked, when nothing in the file decides
  // it (Calc.importDecimals). No default: "1,000" is a thousand in one
  // country and one in the next, and the browser's locale is not the file's.
  const [decimalChoice, setDecimalChoice] = React.useState('');
  // Day-first or month-first, when the dates themselves don't say.
  const [dateChoice, setDateChoice] = React.useState('');

  // Handle file upload. Parsing, the delimiter (",", ";" or tab) and the
  // column mapping are Calc's (calculations.js, "CSV IMPORT: PARSING"), where
  // they are tested against Interactive Brokers, TD Ameritrade and European
  // files.
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        // Bytes, decoded by Calc: UTF-8, UTF-16 with its mark, or an Excel
        // export in Windows-1252 ("é", "£" were refused as binary).
        const text = Calc.importDecode(event.target.result).text;
        if (Calc.importLooksBinary(text)) {
          setError('"' + file.name + '" is not a text CSV file — it looks like an image or another binary file. Export the trades from your broker as CSV and choose that file.');
          return;
        }
        const { headers: h, rows: r, delimiter: d } = Calc.parseCSVText(text);
        setHeaders(h);
        setRows(r);
        setDelimiter(d);
        setDecimalChoice('');
        setDateChoice('');
        setCsvData(text);
        const auto = Calc.importAutoMap(h);
        setFileFormat(auto.format);
        setMapping(auto.mapping);

        setStep(2);
        setError(null);
      } catch (err) {
        setError('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Handle drag and drop
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      const input = document.createElement('input');
      input.type = 'file';
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      handleFileUpload({ target: input });
    } else {
      setError('Please upload a CSV file');
    }
  };

  // Exchange codes a ticker suffix may name ("RY.TO", "VOD.LSE"), and the
  // currency each quotes in when the search has nothing better. LSE is
  // pence: GBP here valued 1,000 VOD at $165,288 instead of $1,653.
  // The search result's own currency wins when there is one --
  // some LSE lines quote in USD or GBP.
  const EXCHANGE_CCY = Calc.IMPORT_EXCHANGE_CCY;
  const exchangeCurrency = (exchange) => EXCHANGE_CCY[exchange] || null;

  // null when the search itself failed (offline, rate limited): that says
  // nothing about the ticker, unlike an empty answer. What it threw goes
  // into `fails`: the preview says why (the per-minute limit, EODHD's error)
  // -- "the search did not answer" was all it said at the limit.
  const search = async (q, fails) => {
    try {
      const hits = await window.EODHD_API.searchStocks(apiKey, q, { throwErrors: true });
      return Array.isArray(hits) ? hits : [];
    } catch (e) { if (fails) fails.push(e); return null; }
  };
  const up = (v) => String(v || '').toUpperCase();

  // Which EODHD symbol a CSV ticker is.
  //
  // This used to be `${symbol}.US` for every row. BRK.B became BRK.B.US --
  // EODHD spells it BRK-B.US -- and priced at N/A; a London or Frankfurt
  // line silently became its American ADR. An exchange column
  // is used when the file has one; a ticker that is not a plain US-looking
  // code is resolved through the same search the Add Position form uses,
  // which knows that BRK.B is BRK-B. Plain codes stay .US without a request.
  // A suffix that names an exchange ("RY.TO") is that listing, even when
  // the search does not answer: it used to become RY-TO.US.
  //
  // `found`: true when the search knows the instrument, false when it
  // answered and does not, null when it could not be asked. "ZZZQQ" and any
  // other made-up code used to import as ZZZQQ.US. Plain US
  // codes are asked too now -- that existence check is the point.
  // `type`: crypto and forex from the symbol, ETF from the search, else
  // stock. Every imported holding was a stock, so ETFs and crypto counted as
  // Stocks in By Asset Type. The file's own currency column
  // (row.fileCurrency) beats the search and the exchange's usual currency.
  const typeOf = (symbol, hit) => Calc.importSymbolType(symbol)
    || (hit && /^ETF$/i.test(String(hit.Type || '')) ? 'etf' : 'stock');
  // A ticker the search no longer lists may be a delisted one (TWTR): it has
  // price history but no current listing. Refusing it made a real history
  // with a sold position impossible to load; a typo
  // (ZZZQQ) has no history and is still refused. One end-of-day request
  // around the trade's date, only for a ticker the search did not find.
  // A failure goes into `fails` (as the search's): a history the limit cut
  // off says nothing about the ticker, and the preview says so.
  const tradedOnce = async (symbol, date, fails) => {
    if (!window.EODHD_API || !window.EODHD_API.getHistoricalData || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
    const day = Date.parse(date + 'T00:00:00Z');
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    try {
      const rows = await window.EODHD_API.getHistoricalData(apiKey, symbol, iso(day - 10 * 86400000), iso(day + 10 * 86400000), undefined, { throwErrors: true });
      return Array.isArray(rows) && rows.length > 0;
    } catch (e) { if (fails) fails.push(e); return false; }
  };
  // A current price for a code the search does not list: 0700.HK and
  // 9988.HK are not in the search, yet quote and close every day -- the
  // preview called them "no longer listed" and they came in priced.
  // A real-time close, else a close in the last ten
  // days, is a live listing.
  const pricedNow = async (symbol, fails) => {
    const priced = (q) => { const c = q && parseFloat(q.close); return Number.isFinite(c) && c > 0; };
    try {
      if (priced(await window.EODHD_API.getRealTimeData(apiKey, symbol, { throwErrors: true }))) return true;
    } catch (e) {
      // Inside the wait a quote seen before still counts, as it did
      // before the failure was kept.
      const last = e && e.rateLimited && window.EODHD_API.lastQuote ? window.EODHD_API.lastQuote(symbol) : null;
      if (priced(last)) return true;
      if (fails) fails.push(e); /* asked the end of day instead */
    }
    try {
      const iso = (t) => new Date(t).toISOString().slice(0, 10);
      const rows = await window.EODHD_API.getHistoricalData(apiKey, symbol, iso(Date.now() - 10 * 86400000), iso(Date.now()), undefined, { throwErrors: true });
      return Array.isArray(rows) && rows.length > 0;
    } catch (e) { if (fails) fails.push(e); return false; }
  };
  // The listing this portfolio already holds for a code given without its
  // exchange, by the rule What-If uses (window.SymbolCode with the held
  // listings): "VOD, Sell, 5" with VOD.LSE held is a sale of VOD.LSE, not
  // "VOD.US ... 5 sold with 0 held". An exchange
  // column, or a code that names another listing, is taken as written.
  const heldListing = (symbol, exchange) => {
    if (!Storage || !window.SymbolCode || Calc.importExchange(exchange)) return null;
    const held = Storage.getHoldingsByPortfolio(portfolioId).filter(h => h && h.symbol);
    if (!held.length) return null;
    const got = window.SymbolCode.of(symbol, { held: held.map(h => h.symbol) });
    if (!got) return null;
    const h = held.find(x => String(x.symbol).trim().toUpperCase() === got);
    return h ? { holding: h, symbol: Calc.importSymbolGuess(h.symbol) || String(h.symbol).toUpperCase() } : null;
  };
  // Which listing a row is, and whether it trades: the requests. Asked once
  // per ticker, exchange and file currency, as before the currency cell
  // counted (lookupKeyOf); the unit a row's price is in is that row's own
  // (resolveSymbol). Keyed with the cell, a file writing GBX, GBp and GBP
  // for VOD.LSE searched VOD.LSE three times.
  // The two price checks of one lookup, each keeping what failed in that
  // lookup's own `fails` (lookups run three at a time).
  const checksInto = (fails) => ({
    pricedNow: (symbol) => pricedNow(symbol, fails),
    tradedOnce: (symbol, date) => tradedOnce(symbol, date, fails),
  });
  const lookupSymbol = async (row) => {
    const fails = [];
    const { pricedNow, tradedOnce } = checksInto(fails);
    let r = await resolveSymbolRaw(row, fails);
    // A price today first: it does not depend on the history request, which
    // a plan or a limit can refuse. Then history around the
    // trade, for a listing that is gone.
    // Not asked where it can only fail (eod/FOO.LSE and
    // eod/7203.TSE 404 in the console): a market EODHD does not list (D05.SI)
    // or has no prices for (TSE, NZ) is asked nothing; on an exchange whose
    // live listings the search lists (window.SymbolCode.searched) the
    // search has said it is not one, so no quote is asked -- only the
    // history around the trade, the one thing that tells a delisted ticker
    // (TWTR) from a typo, and the accepted import of a delisted ticker
    // stands on it.
    const SC = window.SymbolCode;
    if (r.found === false && !(SC && SC.unpriced && SC.unpriced(r.symbol))) {
      const searchSaid = !!(SC && SC.searched && SC.searched(r.symbol));
      if (!searchSaid && await pricedNow(r.symbol)) r = { ...r, found: true };
      else if (await tradedOnce(r.symbol, row.date)) r = { ...r, found: true, delisted: true };
    }
    // Why a check could not be made -- the per-minute limit, EODHD's error,
    // no connection, an answer that could not be read (RateLimitWait.outage)
    // -- for the preview's words and its Check again. A 404 or a plan's
    // refusal of a price is an answer, and changes nothing here.
    const RLW = window.RateLimitWait;
    if (r.found !== true && fails.length && RLW) {
      const failed = (RLW.outage && RLW.outage(fails)) || (r.found === null && RLW.failure ? RLW.failure(fails[0]) : null);
      if (failed) r = { ...r, failed };
    }
    return r;
  };
  const lookupKeyOf = (row) => up(row.symbol) + '|' + (row.exchange || '') + '|' + (row.fileCurrency || '');
  const lookedUpRef = React.useRef({});
  const resolveSymbol = async (row) => {
    const lk = lookupKeyOf(row);
    if (!lookedUpRef.current[lk]) lookedUpRef.current[lk] = lookupSymbol(row);
    const r = await lookedUpRef.current[lk];
    // The unit a price is recorded in: the file's GBP on a listing quoted in
    // pence is converted to pence (Calc.importPriceUnit).
    // r.currency is the listing's own, or the held
    // position's.
    const unit = Calc.importPriceUnit(row.currencyCell, r.currency);
    const currency = unit.currency || Calc.importFileCurrency(row.fileCurrency, r.symbol) || r.currency;
    // A listing nobody knows the currency of is refused in the preview: the
    // import priced it in the portfolio's own currency, as Add Position
    // priced 1155.KLSE's ringgit as dollars.
    const noCurrency = !currency && r.found !== false && !r.index;
    // A currency the listing is not kept in, and not its minor unit: refused,
    // not recorded under the listing's (no FX conversion on import).
    const clash = r.index ? null : Calc.importCurrencyClash(row.currencyCell, r.currency, r.symbol, r.held);
    return { ...r, currency, unit, noCurrency, clash, type: typeOf(r.symbol, r.hit) };
  };
  const resolveSymbolRaw = async (row, fails) => {
    let raw = up(row.symbol).trim();
    const own = heldListing(raw, row.exchange);
    if (own) return { symbol: own.symbol, currency: own.holding.currency || exchangeCurrency(own.symbol.split('.').pop()) || null, found: true, hit: null, held: true };
    const exch = Calc.importExchange(row.exchange);
    // The ticker read as every picker reads it (window.SymbolCode.parse). An
    // index is no holding, said as such: GSPC.INDX was imported as
    // GSPC-INDX.US and ^GSPC as ^GSPC.US, both "No instrument found".
    // Yahoo's suffix is the listing it means: VOD.L is
    // VOD.LSE, 7203.T is 7203.TSE.
    const SC = window.SymbolCode;
    if (!exch && SC && SC.parse) {
      const t = SC.parse(raw);
      if (t.kind === 'index') return { symbol: t.symbol, index: true, found: true, hit: null, note: Calc.indexNotBuyable(t.symbol) };
      // A market EODHD does not list (D05.SI, Singapore): no instrument,
      // nothing asked -- it became D05-SI.US, a US share class nobody has.
      // TSE and NZ, where EODHD prices nothing and the search lists nothing
      // (SymbolCode.NO_PRICES), the same: search/7203.TSE went out.
      if (t.unlisted || (t.kind === 'listing' && SC.unpriced && SC.unpriced(t.symbol))) return { symbol: t.symbol, currency: null, found: false, hit: null };
      if (t.kind === 'listing' && SC.YAHOO && SC.YAHOO[raw.slice(raw.lastIndexOf('.') + 1)]) raw = t.symbol;
    }
    if (exch) {
      // A market EODHD does not list (IB's SGX is "SI", Singapore): said in
      // the preview, nothing asked, never put on another exchange's listing.
      if (SC && SC.unpriced && SC.unpriced('X.' + exch)) {
        const bare = raw.endsWith('.' + exch) ? raw.slice(0, -(exch.length + 1)) : raw;
        return { symbol: `${bare.replace('.', '-')}.${exch}`, currency: null, found: false, hit: null };
      }
      // "RY.TO" in the ticker column and "TO" in the exchange column.
      if (raw.endsWith('.' + exch)) raw = raw.slice(0, -(exch.length + 1));
      // ... and Yahoo's suffix for that exchange: "VOD.L" with "LSE" was
      // read as the share class VOD-L.LSE.
      else if (SC && SC.YAHOO) {
        const d = raw.lastIndexOf('.');
        if (d > 0 && SC.YAHOO[raw.slice(d + 1)] === exch) raw = raw.slice(0, d);
      }
      const code = raw.replace('.', '-');
      const hits = await search(`${code}.${exch}`, fails);
      const hit = (hits || []).find(h => up(h.Code) === code && up(h.Exchange) === exch);
      return { symbol: `${code}.${exch}`, currency: (hit && hit.Currency) || exchangeCurrency(exch), found: hits == null ? null : !!hit, hit };
    }
    // Crypto and forex as EODHD writes them: BTC-USD.CC, EURUSD.FOREX. They
    // went through the search with the dot turned into a dash and came out as
    // BTC-USD-CC.US.
    const pair = raw.match(/^(.+)\.(CC|FOREX)$/);
    if (pair) {
      const hits = await search(pair[1], fails);
      const hit = (hits || []).find(h => up(h.Code) === pair[1] && up(h.Exchange) === pair[2]);
      return { symbol: raw, currency: Calc.importPairCurrency(raw) || 'USD', found: hits == null ? null : !!hit, hit };
    }
    const list = await search(raw, fails);
    const want = raw.replace('.', '-');
    if (/^[A-Z]{1,5}$/.test(raw)) {
      const hit = (list || []).find(h => up(h.Code) === raw && up(h.Exchange) === 'US');
      return { symbol: `${raw}.US`, currency: 'USD', found: list == null ? null : !!hit, hit };
    }
    const exact = (list || []).filter(h => up(h.Code) === want || up(h.Code) === raw);
    const pick = exact.find(h => h.Exchange === 'US') || exact[0];
    if (pick) return { symbol: `${pick.Code}.${pick.Exchange || 'US'}`, currency: pick.Currency || exchangeCurrency(pick.Exchange), found: true, hit: pick };
    const suffixed = raw.match(/^(.+)\.([A-Z]{1,6})$/);
    if (suffixed && EXCHANGE_CCY[suffixed[2]]) {
      const [, code, ex] = suffixed;
      const hit = (list || []).find(h => up(h.Code) === code && up(h.Exchange) === ex);
      return { symbol: `${code}.${ex}`, currency: (hit && hit.Currency) || exchangeCurrency(ex), found: list == null ? null : !!hit, hit };
    }
    return { symbol: `${want}.US`, currency: 'USD', found: list == null ? null : false };
  };

  // One lookup per ticker and exchange, shared by the preview and the import.
  const resolvedRef = React.useRef({});
  const mapKeyOf = (row) => up(row.symbol) + '|' + (row.exchange || '') + '|' + (row.fileCurrency || '') + '|' + (row.currencyCell || '');
  const resolveCached = (row) => {
    const k = mapKeyOf(row);
    if (!resolvedRef.current[k]) resolvedRef.current[k] = resolveSymbol(row);
    return resolvedRef.current[k];
  };


  // A failed lookup's reason in the words every 429 surface uses
  // (SymbolCode.LIMIT_WORDS: the wait is counted down by the Check again
  // beside it, not written into the sentence).
  const failWords = (f) => {
    const RLW = window.RateLimitWait;
    const SC = window.SymbolCode;
    if (f && f.limited) return (SC && SC.LIMIT_WORDS) || (RLW && RLW.REACHED) || "EODHD's per-minute request limit was reached.";
    return RLW && RLW.failReason ? RLW.failReason(f) : 'EODHD did not answer, or the connection dropped.';
  };
  // The work Check again runs, by name (RateLimitWait.setBusy): its button
  // reads "Loading…" and sends nothing more while it runs.
  const RECHECK_BUSY = 'import-csv-check';

  // Generate preview
  const [checking, setChecking] = React.useState(false);
  // A Check again of the rows a failed lookup left unchecked, under way.
  const [rechecking, setRechecking] = React.useState(false);
  const previewRunRef = React.useRef(0);
  // Back, or a change to what a preview is made from (a column, the
  // decimal or the date choice), ends a preview or a Check again under
  // way: its answer is dropped. Back did not, and a Check again answering
  // after it forced the preview step back, made from the old columns.
  React.useEffect(() => { previewRunRef.current += 1; }, [step, mapping, decimalChoice, dateChoice]);
  // `again`: the preview rows to look up again (Check again); every other
  // row keeps the answer it had, and nothing is asked for it. Without it,
  // every ticker is looked up afresh.
  const generatePreview = async (again) => {
    const recheck = Array.isArray(again);
    const run = ++previewRunRef.current;
    const preview = [];
    // Each numeric column's decimal separator and the file's date order,
    // decided once from every row ("0,125" is 0.125 in a file that writes
    // "180,50").
    const ctx = Calc.importContext(rows, mapping, { format: fileFormat, delimiter, decimal: decimalChoice || undefined, dateOrder: dateChoice || undefined });
    if (ctx.decimalUnclear.length || ctx.dateUnclear) return; // the mapping step asks first

    const existingTxKeys = storedTxKeys();
    rows.forEach((row, index) => {
      try {
        // Column-count mismatch usually means an unquoted comma inside a value
        // (e.g. quantity "1,000"). Flag instead of silently dropping.
        if (headers.length && row.length !== headers.length) {
          preview.push({
            rowIndex: index,
            symbol: row[parseInt(mapping.symbol || 0)] || '',
            valid: false,
            error: `Row has ${row.length} columns (expected ${headers.length}). Check for unquoted commas.`,
          });
          return;
        }
        // Numbers, dates, types, fees: Calc.parseImportRow. Every refusal it
        // returns names the cell; nothing unreadable becomes a zero, and a
        // date in the future or before 1950 is refused.
        const parsed = Calc.parseImportRow(row, ctx);
        if (parsed.error) {
          preview.push({ rowIndex: index, symbol: parsed.symbol || '', valid: false, error: parsed.error });
          return;
        }
        const { symbol: symbolUp, exchange, date, type, quantity, price, fees } = parsed;
        const fileCurrency = parsed.currency;
        // Known here when the row names its listing; a ticker that needs a
        // search (BRK.B) is checked again at import, once resolved.
        const own = heldListing(symbolUp, exchange);
        const guessed = own ? own.symbol : Calc.importSymbolGuess(symbolUp, exchange);
        const dupKey = guessed ? txKey(guessed, date, type, quantity, price) : null;

        if (dupKey && existingTxKeys.has(dupKey)) {
          // The same trade is already in this portfolio. Importing a file that
          // has grown by a few rows used to double every position in it.
          preview.push({ rowIndex: index, symbol: symbolUp, valid: false, duplicate: true, error: 'Already in this portfolio (same symbol, date, type, quantity and price) — skipped' });
        } else {
          preview.push({
            rowIndex: index,
            symbol: symbolUp,
            exchange,
            fileCurrency,
            currencyCell: parsed.currencyCell,
            exchangeCell: parsed.exchangeCell,
            // For the preview's money column: "1000 @ $70.50" for a pence
            // price read as dollars. Null shows the bare number.
            currency: (own && !parsed.currency && own.holding.currency) || Calc.importCurrencyGuess(symbolUp, exchange, parsed.currency),
            date,
            type,
            quantity,
            price,
            fees,
            costFromMarket: parsed.costFromMarket,
            total: type === 'split' ? 0 : quantity * price + fees,
            valid: true
          });
        }
      } catch (err) {
        preview.push({
          rowIndex: index,
          valid: false,
          error: err.message
        });
      }
    });

    // Does each ticker exist? One search per distinct ticker, three at a
    // time; a row whose ticker the search does not know is refused here, in
    // the preview, with the reason -- not imported as a position nobody can
    // price.
    const RLW = window.RateLimitWait;
    let busy = null;
    if (recheck) {
      // Only these are asked again: the import reads the same answers.
      again.forEach(r => { delete resolvedRef.current[mapKeyOf(r)]; delete lookedUpRef.current[lookupKeyOf(r)]; });
      setRechecking(true);
      busy = RLW && RLW.setBusy ? RLW.setBusy(RECHECK_BUSY, 'retry') : null;
    } else {
      setChecking(true);
      resolvedRef.current = {};
      lookedUpRef.current = {};
    }
    const distinct = [...new Map(preview.filter(r => r.valid).map(r => [mapKeyOf(r), r])).values()];
    const verdict = {};
    for (let i = 0; i < distinct.length; i += 3) {
      const chunk = distinct.slice(i, i + 3);
      const answers = await Promise.all(chunk.map(r => resolveCached(r).catch(() => ({ found: null }))));
      chunk.forEach((r, j) => { verdict[mapKeyOf(r)] = answers[j]; });
    }
    const checked = preview.map(r => {
      if (!r.valid) return r;
      const v = verdict[mapKeyOf(r)];
      if (v && v.index) return { ...r, valid: false, error: v.note };
      if (v && v.noCurrency) return { ...r, valid: false, error: `${v.symbol}: the currency it is quoted in is not known, so its price cannot be converted. Add a Currency column to the file (e.g. MYR).` };
      // An exchange EODHD has no listings on (Singapore, IB's SGX; Tokyo;
      // New Zealand): no other ticker or exchange column helps.
      if (v && v.found === false && window.SymbolCode && window.SymbolCode.unpriced && window.SymbolCode.unpriced(v.symbol)) {
        return { ...r, valid: false, error: `No listing found for ${r.symbol}${r.exchangeCell ? ' (' + r.exchangeCell + ')' : ''}: EODHD does not list that exchange. Add it as a Manual asset instead.` };
      }
      // Not in the search, and the price history that tells a delisted
      // listing (TWTR) from a typo did not load: refused as before, with the
      // reason, and looked up again by Check again. It read "No instrument
      // found -- check the ticker" at the limit.
      if (v && v.found === false && v.failed) {
        return { ...r, valid: false, recheck: true, failed: v.failed, error: `"${r.symbol}" is not in the ticker search, and its price history did not load: ${failWords(v.failed)}` };
      }
      if (v && v.found === false) return { ...r, valid: false, error: `No instrument "${r.symbol}" found — check the ticker (or add an exchange column, e.g. VOD with LSE)` };
      if (v && v.clash && r.type !== 'split') return { ...r, valid: false, error: v.clash };
      // The unit the price is recorded in, shown before Import: GBP on a
      // listing quoted in pence is pence, x100 -- "0.72 GBP" was recorded as
      // 0.72 GBX with no word. And the mirror:
      // pence on a listing or position kept in pounds is pounds, /100.
      const unit = v && v.unit;
      if (unit && unit.factor !== 1 && r.type !== 'split') {
        const price = Calc.importUnitValue(r.price, unit);
        const fees = Calc.importUnitValue(r.fees, unit);
        r = { ...r, price, fees, total: r.quantity * price + fees, currency: v.currency, filePrice: r.price, fileFees: r.fees, stated: unit.stated, toMajor: !!unit.divisor };
        // The same trade already recorded, now in the listing's unit.
        const key = txKey(Calc.importSymbolGuess(v.symbol) || v.symbol, r.date, r.type, r.quantity, price);
        if (existingTxKeys.has(key)) return { ...r, valid: false, duplicate: true, error: 'Already in this portfolio (same symbol, date, type, quantity and price) — skipped' };
      }
      if (v && v.found === null) return { ...r, unchecked: true, failed: v.failed || null, importAs: v.symbol || null };
      if (v && v.delisted) return { ...r, delisted: true, warning: `${v.symbol} is no longer listed — imported with its history, but without a current price` };
      return r;
    });
    // Sales, transfers out and dividends against the shares there are, the
    // check the import makes -- here, so the preview says it. "MSFT,-3,410"
    // in a portfolio without MSFT was read as a sale of 3 and shown as valid,
    // then skipped at import. Walked oldest first: the file's
    // own purchases before a sale count, as at import.
    const existingHoldings = Storage ? Storage.getHoldingsByPortfolio(portfolioId) : [];
    const listingOf = (r) => {
      const v = verdict[mapKeyOf(r)];
      return String((v && v.symbol) || Calc.importSymbolGuess(r.symbol, r.exchange) || r.symbol).toUpperCase();
    };
    const histories = new Map();
    const historyFor = (listing) => {
      if (!histories.has(listing)) {
        const h = existingHoldings.find(x => x.symbol && (Calc.importSymbolGuess(x.symbol) || x.symbol).toUpperCase() === listing);
        histories.set(listing, h ? Storage.getTransactionsByHolding(h.id).slice() : []);
      }
      return histories.get(listing);
    };
    const order = checked.map((r, i) => i).filter(i => checked[i].valid).sort((i, j) => Calc.byDate(checked[i], checked[j]));
    for (const i of order) {
      const r = checked[i];
      const history = historyFor(listingOf(r));
      const candidate = { type: r.type, date: r.date, quantity: r.quantity, price: r.price, fees: r.fees };
      const problem = Calc.validateTransaction(history, candidate);
      if (problem && (r.type === 'sell' || r.type === 'transfer_out' || r.type === 'dividend' || r.type === 'split')) {
        const held = history.length ? '' : ` — ${r.symbol} is not in this portfolio and the file buys none before ${r.date}`;
        checked[i] = { ...r, valid: false, error: problem + held };
        continue;
      }
      history.push({ ...candidate, id: 'preview-' + i });
    }
    if (recheck) {
      if (RLW && RLW.endBusy) RLW.endBusy(RECHECK_BUSY, busy);
      setRechecking(false);
    } else {
      setChecking(false);
    }
    // A newer preview has the last word, and one ended by Back or a
    // column changed meanwhile has none: the step stays as it is.
    if (run !== previewRunRef.current) return;
    setPreviewData(checked);
    setStep(3);
  };
  // Check again: the rows a failed lookup (the per-minute limit, EODHD's
  // error, no connection) left unchecked or refused are looked up again, and
  // only they. The preview is redrawn in place; nothing is imported.
  const checkAgain = () => {
    if (importing || rechecking) return;
    const again = previewData.filter(r => r.unchecked || r.recheck);
    if (again.length) generatePreview(again);
  };

  // Import transactions
  const handleImport = async () => {
    setImporting(true);

    // Oldest first, so a sale meets the purchases before it (the oversell
    // check below walks the file in this order).
    const validRows = previewData.filter(p => p.valid).sort((a, b) => Calc.byDate(a, b));
    const holdingsMap = {}; // symbol -> holding
    const skipped = []; // { row, reason } -- reported, never imported

    // The instrument's currency and today's rate into the portfolio's, once
    // per currency. The form has always done this; the importer wrote every
    // row as the portfolio currency at a rate of 1, so a dollar stock in a
    // euro portfolio was booked ten percent low.
    //
    // No rate is no row: parity for a missing EUR or GBX rate books the cost
    // wrong by the whole exchange rate. The row is reported as
    // skipped instead.
    //
    // At the rate of the trade's own day. Every row used to take today's
    // rate, so a 2025 purchase of VOD in a dollar portfolio carried no
    // currency gain at all. One history request
    // per currency covers the whole file; a day with no rate falls back to
    // today's and the import report says so.
    const dates = validRows.map(r => r.date).sort();
    const historyCache = {};
    const liveCache = {};
    const notes = [];
    // What failed when a currency's rate did not come (the limit, EODHD's
    // error, a dropped connection, an unreadable answer), by currency: the
    // row's reason names it.
    const rateFails = {};
    const rateFor = async (currency, date) => {
      if (!currency || currency === baseCurrency) return 1;
      const fails = rateFails[currency] || (rateFails[currency] = []);
      try {
        if (!(currency in historyCache)) {
          historyCache[currency] = await Calc.fxHistory(apiKey, currency, baseCurrency, dates[0], dates[dates.length - 1], fails);
        }
        const onDay = Calc.toRate(historyCache[currency].on(date));
        if (onDay && date < Calc.todayISO()) return onDay;
        if (!(currency in liveCache)) {
          // Direct, inverse, then via USD; GBX/ZAC/ILA through their major
          // currency /100; "NA" is missing.
          liveCache[currency] = Calc.toRate(await Calc.fxRate(apiKey, currency, baseCurrency, fails));
        }
        const live = liveCache[currency];
        if (live && date < Calc.todayISO()) notes.push(`${currency}/${baseCurrency} for ${date} unavailable — booked at today's rate`);
        return live;
      } catch (e) { return null; }
    };

    // Duplicates are checked against storage as it is now, not as it was when
    // the dialog opened: the same file imported in two tabs doubled every
    // trade.
    const freshKeys = storedTxKeys();

    // Everything is decided first and written at the end in one go: all of it
    // or none. Each row used to rewrite the whole list, and when the browser's
    // storage filled up half way the import said "Imported 300 transactions."
    // over 162 saved. The history each row is checked against is kept
    // here, rows of this file included.
    const historyOf = new Map();   // holding (stored id or pending key) -> transactions
    // One new holding per listing, whatever spelling the file used for it
    // ("AAPL" and "AAPL.US" are one position).
    const pendingBySymbol = new Map();
    const pendingTx = [];          // { holding, data }
    for (const row of validRows) {
      // Find or create holding. Keyed by ticker and exchange together, so a
      // file listing the same ticker on two exchanges gets two holdings.
      const mapKey = row.symbol + '|' + (row.exchange || '');
      let holding = holdingsMap[mapKey];

      if (!holding) {
        const resolved = await resolveCached(row);
        const fullSymbol = resolved.symbol;
        const instrumentCurrency = resolved.currency || exchangeCurrency(fullSymbol.split('.').pop()) || baseCurrency;
        const existingHoldings = Storage.getHoldingsByPortfolio(portfolioId);
        // Same listing only. Matching on the bare code put a VOD.US row
        // into a VOD.LSE holding; a legacy holding stored without a suffix
        // is the US listing (importSymbolGuess).
        const same = (h) => h.symbol && ((Calc.importSymbolGuess(h.symbol) || h.symbol).toUpperCase() === fullSymbol.toUpperCase());
        holding = existingHoldings.find(same);
        if (!holding) {
          // Created at the end, and only when a row of it is imported.
          const pk = fullSymbol.toUpperCase();
          holding = pendingBySymbol.get(pk);
          if (!holding) {
            // The name the symbol search already returned for this row, as
            // Add Position stores it; the ticker when the search had nothing.
            holding = { pending: true, key: 'new:' + pk, symbol: fullSymbol, currency: instrumentCurrency, type: resolved.type || 'stock', name: (resolved.hit && typeof resolved.hit.Name === 'string' && resolved.hit.Name.trim()) || null };
            pendingBySymbol.set(pk, holding);
          }
        }
        holdingsMap[mapKey] = holding;
      }
      const hKey = holding.pending ? holding.key : holding.id;
      if (!historyOf.has(hKey)) historyOf.set(hKey, holding.pending ? [] : Storage.getTransactionsByHolding(holding.id));

      // The price and fees in the unit the position is kept in: the file's
      // GBP into a position in pence is x100 (Calc.importPriceUnit), worked
      // out against the position itself -- the preview's figure, unless the
      // position already there is kept in another unit.
      // The position already there may be kept in another currency than the
      // listing the preview checked: the row is left out, never re-labelled.
      const clash = holding.currency && row.type !== 'split' ? Calc.importCurrencyClash(row.currencyCell, holding.currency, holding.symbol, !holding.pending) : null;
      if (clash) {
        skipped.push({ row, reason: clash });
        continue;
      }
      const unit = row.type === 'split' ? { factor: 1 } : Calc.importPriceUnit(row.currencyCell, holding.currency);
      const filePrice = row.filePrice != null ? row.filePrice : row.price;
      const fileFees = row.fileFees != null ? row.fileFees : row.fees;
      const rowPrice = Calc.importUnitValue(filePrice, unit);
      const rowFees = Calc.importUnitValue(fileFees, unit);

      // The same trade already in the portfolio, now that the symbol is
      // resolved: a row the preview could not place (BRK.B) is caught here.
      if (!holding.pending && freshKeys.has(txKey(Calc.importSymbolGuess(holding.symbol) || holding.symbol, row.date, row.type, row.quantity, rowPrice))) {
        skipped.push({ row, reason: 'already in this portfolio' });
        continue;
      }
      const txCurrency = holding.currency || baseCurrency;
      const txRate = await rateFor(txCurrency, row.date);
      if (txRate == null) {
        const rateFailed = Calc.fxFailure(rateFails[txCurrency]);
        skipped.push({ row, reason: rateFailed ? `the ${txCurrency} to ${baseCurrency} rate did not load: ${window.RateLimitWait.failReason(rateFailed)} Import the file again` : `no ${txCurrency} to ${baseCurrency} rate` });
        continue;
      }

      // A transfer in with no price in the file is not free: its cost basis
      // is the market close on the transfer date, and the report says so.
      // "Transfer In,10,0" used to book AVG COST $0 and the whole value as
      // profit. No close, no row.
      let price = rowPrice;
      if (row.type === 'transfer_in' && !(price > 0)) {
        const close = await Calc.closeOn(apiKey, holding.symbol, row.date);
        // The history did not load: its reason, not "no market close".
        // Nothing of the row is written either way.
        if (close && close.failed) {
          skipped.push({ row, reason: `transfer in with no cost basis; the market close did not load: ${window.RateLimitWait.failReason(close.failed)} Import the file again, or add the price column` });
          continue;
        }
        if (!close) {
          skipped.push({ row, reason: 'transfer in with no cost basis, and no market close for that date — add the price column' });
          continue;
        }
        price = close.close;
        notes.push(`${row.symbol} ${row.date}: transfer in costed at the ${close.date} close, ${Calc.formatCurrency(price, txCurrency)}`);
      }

      // The same rules as the forms (Calc.validateTransaction): a sale is
      // checked against the whole history, not just its own date, and a
      // dividend against the shares held that day. The file is walked
      // oldest first, so the purchases before a row are already in.
      const candidate = { type: row.type, date: row.date, quantity: row.quantity, price, fees: rowFees };
      const history = historyOf.get(hKey);
      const problem = Calc.validateTransaction(history, candidate);
      if (problem) {
        skipped.push({ row, reason: problem });
        continue;
      }
      history.push({ ...candidate, id: 'import-' + pendingTx.length });
      pendingTx.push({
        holding,
        data: { type: row.type, date: row.date, quantity: row.quantity, price, fees: rowFees, currency: txCurrency, exchangeRate: txRate },
      });
    }

    let limitLine = null;
    const W = window.FreeLimitWalls;
    const newNames = new Set(pendingTx.filter(p => p.holding.pending).map(p => p.holding.key));
    const heldNow = () => Storage.getHoldingsByPortfolio(portfolioId).length;
    const walled = W && newNames.size ? W.portfolioConfirm([['positions', () => heldNow() + newNames.size]]) : null;
    const refusal = walled ? await walled : null;
    if (walled) {
      pendingTx.forEach(p => {
        if (!p.holding.pending || p.holding.created) return;
        const held = Storage.holdingOf ? Storage.holdingOf(portfolioId, p.holding.symbol) : null;
        if (held) p.holding.created = held;
      });
    }
    const max = refusal && refusal.limit ? refusal.limit.max : null;
    if (Number.isFinite(max)) {
      const total = pendingTx.length;
      const fit = W.rowsThatFit(pendingTx.map(p => ({ key: p.holding.key, adds: !!p.holding.pending && !p.holding.created, p })), Math.max(0, max - heldNow()));
      pendingTx.splice(0, pendingTx.length, ...fit.kept.map(r => r.p));
      fit.left.forEach(r => { skipped.push({ row: { symbol: r.p.holding.symbol, date: r.p.data.date }, reason: W.importRowReason(max) }); });
      limitLine = W.importLine(pendingTx.length, total, max);
    }

    // Write: the new holdings, then every transaction at once. A failure
    // removes the holdings this import made, so nothing half-done is left.
    const made = [];
    let imported = 0;
    try {
      if (pendingTx.length && !Storage.getPortfolios().some(p => p.id === portfolioId)) {
        throw new Storage.StorageError('portfolio-gone', 'This portfolio was deleted (perhaps in another tab). Reload the page and pick a portfolio.');
      }
      pendingTx.forEach(p => {
        if (p.holding.pending && !p.holding.created) {
          p.holding.created = Storage.createHolding({
            portfolioId,
            type: p.holding.type,
            symbol: p.holding.symbol,
            name: p.holding.name || p.holding.symbol.split('.')[0],
            currency: p.holding.currency
          });
          made.push(p.holding.created.id);
        }
      });
      Storage.createTransactions(pendingTx.map(p => ({ ...p.data, holdingId: p.holding.pending ? p.holding.created.id : p.holding.id })));
      imported = pendingTx.length;
    } catch (e) {
      made.forEach(id => { try { Storage.deleteHolding(id); } catch (_) { /* best effort */ } });
      setImporting(false);
      if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_import', { row_count: 0, success: false });
      setError(`Nothing was imported: ${(e && e.message) || 'the data could not be saved'}`);
      return;
    }

    setImporting(false);
    if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_import', { row_count: imported, success: true });
    // The second argument lists what was left out and why, so the caller
    // can say it rather than "Imported N" over rows that silently vanished;
    // the third, what was imported on an assumption (a transfer costed at the
    // day's close, a rate from another day).
    onImport(imported, skipped.map(x => `${x.row.symbol} ${x.row.date}: ${x.reason}`), [...new Set(notes)], ...(limitLine ? [limitLine] : []));
  };

  // Columns whose decimal separator nothing in the file settles, for the
  // current mapping and the user's choice so far.
  const decimalUnclear = step === 2 && rows.length
    ? Calc.importContext(rows, mapping, { format: fileFormat, delimiter, decimal: decimalChoice || undefined, dateOrder: dateChoice || undefined }).decimalUnclear
    : [];
  const needsDecimal = step === 2 && rows.length
    ? Calc.importContext(rows, mapping, { format: fileFormat, delimiter }).decimalUnclear.length > 0
    : false;
  const dateSamples = step === 2 && rows.length && mapping.date !== '' && mapping.date != null
    ? rows.map(r => r[parseInt(mapping.date, 10)]).filter(v => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(String(v ?? '').trim())).slice(0, 2)
    : [];
  const needsDateOrder = step === 2 && rows.length > 0
    && Calc.importContext(rows, mapping, { format: fileFormat, delimiter, decimal: decimalChoice || undefined, dateOrder: dateChoice || undefined }).dateUnclear;
  const askDateOrder = step === 2 && rows.length > 0
    && Calc.importContext(rows, mapping, { format: fileFormat, delimiter, decimal: decimalChoice || undefined }).dateUnclear;
  const previewBlocked = !mapping.symbol || !mapping.quantity || !mapping.price || decimalUnclear.length > 0 || needsDateOrder;

  const validCount = previewData.filter(p => p.valid).length;
  const invalidCount = previewData.filter(p => !p.valid).length;
  // The rows a failed lookup stopped: imported as written (unchecked), or
  // refused until checked again (recheck). Said once, with the reason --
  // the limit by name -- and one Check again for them all.
  const stopped = step === 3 ? previewData.filter(r => r.unchecked || r.recheck) : [];
  const stopFailure = (() => {
    const fs = stopped.map(r => r.failed).filter(Boolean);
    return fs.find(f => f.limited) || fs[0] || null;
  })();
  const stopWords = (() => {
    if (!stopped.length) return '';
    const SC = window.SymbolCode;
    const count = new Set(stopped.map(r => String(r.symbol || '').toUpperCase() + '|' + (r.exchange || ''))).size;
    const n = count === 1 ? '1 ticker' : `${count} tickers`;
    if (stopped.every(r => r.unchecked)) {
      const head = stopFailure && stopFailure.limited && SC && SC.SEARCH_LIMIT_WORDS
        ? SC.SEARCH_LIMIT_WORDS : `The ticker search did not load: ${failWords(stopFailure)}`;
      return `${head} ${n} could not be checked; ${count === 1 ? 'it is' : 'they are'} imported as written.`;
    }
    const rest = stopped.some(r => r.unchecked)
      ? 'Rows marked "Not checked" are imported as written; the others are not imported.'
      : (count === 1 ? 'It is not imported.' : 'They are not imported.');
    return `${n} could not be checked: ${failWords(stopFailure)} ${rest}`;
  })();

  return (
    <div style={styles.modal} {...dialogProps}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} style={styles.iconButton} aria-label="Back">
              <Icon name="chevronLeft" size={20} />
            </button>
          )}
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {step === 1 ? 'Import CSV' : step === 2 ? 'Map Columns' : 'Preview Import'}
          </h3>
        </div>
        <button onClick={onClose} style={styles.iconButton} aria-label="Close">
          <Icon name="x" size={24} />
        </button>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div>
          <p style={{ ...styles.muted, marginBottom: 16 }}>
            Upload a CSV file with your transactions. Read automatically: a generic CSV (comma, semicolon or tab; decimal point or decimal comma), an Interactive Brokers Flex trades export, a TD Ameritrade transactions export. You can check and change the column mapping on the next step.
          </p>

          {/* A button to the keyboard and to a screen reader: the zone was a
              plain div, so Tab could not reach it and no file could be picked
              without a mouse. */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a CSV file"
            style={styles.dropzone}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => document.getElementById('csv-input').click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.getElementById('csv-input').click(); }
            }}
          >
            <Icon name="activity" size={48} color={isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'} />
            <p style={{ marginTop: 16, marginBottom: 8 }}>Drop CSV file here</p>
            <p style={styles.muted}>or click to browse</p>
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>

          {error && (
            <div style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 12,
              color: C3.error,
              fontSize: 14
            }}>
              {error}
            </div>
          )}

          <div style={{
            marginTop: 16,
            padding: 12,
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
            borderRadius: 12
          }}>
            <p style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 }}>
              <strong>Expected columns:</strong> Symbol, Date, Type (Buy, Sell, Dividend, Split, Transfer In, Transfer Out), Quantity, Price, Fees (optional), Exchange (optional). A transfer in without a price is costed at that day's close; a split needs no price.
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 2 && (
        <div>
          <p style={{ ...styles.muted, marginBottom: 16 }}>
            Map your CSV columns to the required fields. Found {rows.length} rows.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { key: 'symbol', label: 'Symbol/Ticker', required: true },
              { key: 'date', label: 'Date', required: true },
              { key: 'type', label: 'Type (Buy/Sell)', required: false },
              { key: 'quantity', label: 'Quantity/Shares', required: true },
              { key: 'price', label: 'Price', required: true },
              { key: 'fees', label: 'Fees/Commission', required: false },
              { key: 'exchange', label: 'Exchange (optional)', required: false },
              { key: 'currency', label: 'Currency (optional)', required: false }
            ].map(field => (
              <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ width: 120, fontSize: 14, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  {field.label}
                  {field.required && <span style={{ color: C3.error }}>*</span>}
                </label>
                {React.createElement(window.PortalDropdown, {
                  value: mapping[field.key] != null ? String(mapping[field.key]) : '',
                  options: [{ value: '', label: '-- Select Column --' }, ...headers.map((h, i) => ({ value: String(i), label: h }))],
                  onChange: (v) => setMapping({ ...mapping, [field.key]: v }),
                  isDark,
                  style: { ...styles.select, flex: 1 },
                  minWidth: 0,
                  ariaLabel: field.label + ' column',
                })}
              </div>
            ))}
          </div>

          {/* Sample Data Preview */}
          <div style={{
            marginTop: 16,
            padding: 12,
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            borderRadius: 12,
            overflowX: 'auto'
          }}>
            <p style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 8, marginTop: 0 }}>Sample row:</p>
            <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
              {rows[0]?.join(' | ')}
            </div>
          </div>

          {/* Nothing in the file says whether "1,000" is a thousand or one:
              ask, with no default, rather than take the browser's locale. */}
          {needsDecimal && (
            <div role="group" aria-label="Decimal separator" style={{ marginTop: 16, padding: 12, borderRadius: 12, border: `1px solid ${C3.warning}`, fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ marginBottom: 8 }}>
                The numbers in this file ({['quantity', 'price', 'fees'].filter(k => mapping[k] !== '' && rows.some(r => /[.,]/.test(String(r[parseInt(mapping[k], 10)] ?? '')))).map(k => {
                  const sample = rows.map(r => r[parseInt(mapping[k], 10)]).find(v => /[.,]/.test(String(v ?? '')));
                  return `${k} "${sample}"`;
                }).join(', ')}) could be read two ways. Which mark is the decimal point?
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[['.', 'Dot — 1,000.50 is one thousand'], [',', 'Comma — 1.000,50 is one thousand']].map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={decimalChoice === v} onClick={() => setDecimalChoice(v)}
                    style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, background: 'transparent', color: isDark ? C3.textDark : C3.textLightTheme, ...window.ToggleStyle.value(decimalChoice === v, isDark, { bordered: true }) }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {askDateOrder && (
            <div role="group" aria-label="Date order" style={{ marginTop: 16, padding: 12, borderRadius: 12, border: `1px solid ${C3.warning}`, fontSize: 13, lineHeight: 1.5 }}>
              <div style={{ marginBottom: 8 }}>
                The dates in this file ({dateSamples.map(v => `"${v}"`).join(', ')}) could be read two ways. Which comes first?
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[['dmy', 'Day first — 03/04/2025 is 3 April'], ['mdy', 'Month first — 03/04/2025 is March 4']].map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={dateChoice === v} onClick={() => setDateChoice(v)}
                    style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, background: 'transparent', color: isDark ? C3.textDark : C3.textLightTheme, ...window.ToggleStyle.value(dateChoice === v, isDark, { bordered: true }) }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => generatePreview()}
            disabled={previewBlocked || checking}
            style={{
              ...styles.primaryButton,
              marginTop: 16,
              opacity: (previewBlocked || checking) ? 0.5 : 1,
              cursor: (previewBlocked || checking) ? 'not-allowed' : 'pointer'
            }}
          >
            {checking ? 'Checking tickers…' : 'Preview Import'}
          </button>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <span style={{ fontWeight: 600, color: C3.success }}>{validCount}</span>
              <span style={styles.muted}> valid</span>
              {invalidCount > 0 && (
                <>
                  <span style={{ ...styles.muted, margin: '0 8px' }}>•</span>
                  <span style={{ fontWeight: 600, color: C3.error }}>{invalidCount}</span>
                  <span style={styles.muted}> invalid</span>
                </>
              )}
            </div>
          </div>

          {/* Why some tickers were not checked, and one Check again for all
              of them: it counts the per-minute wait down and sends nothing
              inside it (RateLimitWait.RetryButton). */}
          {stopped.length > 0 && !importing && (
            <div data-import-check="" style={{ marginBottom: 12 }}>
              {window.RateLimitWait && window.RateLimitWait.FailNote
                ? <window.RateLimitWait.FailNote failure={stopFailure} text={stopWords} label="Check again" onRetry={checkAgain}
                    autoRetry={false} panel={RECHECK_BUSY} busyKey={RECHECK_BUSY} isDark={isDark}
                    style={{ fontSize: 12, color: C3.warning }} />
                : (
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: C3.warning }}>
                    <span role="status">{stopWords}</span>
                    <button type="button" onClick={checkAgain} disabled={rechecking} style={{ marginLeft: 8 }}>Check again</button>
                  </div>
                )}
            </div>
          )}

          {previewData.some(r => r.delisted) && (
            <div role="status" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: C3.warning }}>
              {[...new Set(previewData.filter(r => r.delisted).map(r => r.warning))].join(' ')}
            </div>
          )}

          {/* Rows that will not be imported first: past the first 20 they
              used to be out of sight. */}
          <div style={{ maxHeight: 256, overflowY: 'auto', marginBottom: 16 }}>
            {[...previewData].sort((a, b) => (a.valid ? 1 : 0) - (b.valid ? 1 : 0)).slice(0, 20).map((row, i) => (
              <div
                key={i}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  marginBottom: 8,
                  fontSize: 14,
                  background: row.valid
                    ? isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
                    : 'rgba(239,68,68,0.1)',
                  border: row.valid ? 'none' : '1px solid rgba(239,68,68,0.3)'
                }}
              >
                {row.valid ? (() => {
                  // The row's asset sets the places, as the holding will
                  // show them: a coin keeps eight.
                  const kind = (window.SymbolCode && window.SymbolCode.of(row.symbol)) || row.symbol;
                  return (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{row.symbol}</span>
                      <span style={{ ...styles.badge(row.type), marginLeft: 8 }}>
                        {row.type}
                      </span>
                      {/* Which rows the note above means, and the listing
                          each is imported as unless checked again. */}
                      {row.unchecked && (
                        <div data-import-unchecked="" style={{ ...styles.muted, fontSize: 12, marginTop: 4 }}>
                          Not checked: imported as {row.importAs || row.symbol}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>
                        {row.type === 'split'
                          ? `${Calc.formatQuantity(row.quantity)}:1`
                          : row.costFromMarket
                            ? `${Calc.formatQuantity(row.quantity, kind)} @ close on ${row.date}`
                            : `${Calc.formatQuantity(row.quantity, kind)} @ ${row.currency ? Calc.formatCurrency(row.price, row.currency, row.price < 1 ? 4 : 2) : Calc.formatQuantity(row.price)}`}
                        {row.fees > 0 && <span style={styles.muted}> + {row.currency ? Calc.formatCurrency(row.fees, row.currency) : Calc.formatQuantity(row.fees)} fees</span>}
                      </div>
                      {/* A price converted to the unit the listing is quoted
                          in, said before Import (question 2). */}
                      {row.stated && row.filePrice != null && (
                        <div style={styles.muted} data-import-unit="">
                          {row.toMajor
                            // Pence into pounds: four places keep every penny ("GBX 9,000.50 = £90.0050").
                            ? `${Calc.formatCurrency(row.filePrice, row.stated, 2)} in the file = ${Calc.formatCurrency(row.price, row.currency, 4)}`
                            : `${Calc.formatCurrency(row.filePrice, row.stated, row.filePrice < 1 ? 4 : 2)} in the file = ${Calc.formatCurrency(row.price, row.currency, row.price < 1 ? 4 : 2)} (${({ GBX: 'pence', GBp: 'pence', ZAC: 'cents', ILA: 'agorot' })[row.currency] || row.currency})`}
                        </div>
                      )}
                      <div style={styles.muted}>{row.date}</div>
                    </div>
                  </div>
                  );
                })() : (
                  <div style={{ color: C3.error }}>
                    Row {row.rowIndex + 2}: {row.error}
                  </div>
                )}
              </div>
            ))}
            {previewData.length > 20 && (
              <p style={{ textAlign: 'center', ...styles.muted }}>
                ... and {previewData.length - 20} more rows
              </p>
            )}
          </div>

          {error && (
            <div role="alert" style={{ marginBottom: 12, padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.5,
              background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(185,28,28,0.06)', color: isDark ? '#fca5a5' : '#b91c1c' }}>
              {error}
            </div>
          )}

          <button
            onClick={handleImport}
            disabled={importing || rechecking || validCount === 0}
            style={{
              ...styles.primaryButton,
              opacity: (importing || rechecking || validCount === 0) ? 0.5 : 1,
              cursor: (importing || rechecking || validCount === 0) ? 'not-allowed' : 'pointer'
            }}
          >
            {importing ? 'Importing...' : `Import ${validCount} ${validCount === 1 ? 'Transaction' : 'Transactions'}`}
          </button>
        </div>
      )}
    </div>
  );
};

// What a CSV import did, in the page. It was a browser alert() ("Imported 3
// transactions.") that blocks the tab and stands outside the page.
window.ImportReportDialog = ({ report, onClose, theme }) => {
  const dialogProps = window.PTDialog ? window.PTDialog.use(onClose, 'Import finished') : { role: 'dialog', 'aria-label': 'Import finished' };
  const C3 = window.C3;
  const isDark = theme === 'dark';
  const muted = isDark ? C3.textMutedDark : C3.textMutedLight;
  const count = (report && report.count) || 0;
  const skipped = (report && report.skipped) || [];
  const notes = (report && report.notes) || [];
  const list = (items, color) => (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18, maxHeight: 160, overflowY: 'auto', fontSize: 13, lineHeight: 1.5, color }}>
      {items.slice(0, 50).map((x, i) => <li key={i}>{x}</li>)}
      {items.length > 50 && <li style={{ color: muted }}>…and {items.length - 50} more</li>}
    </ul>
  );
  return (
    <div {...dialogProps} style={{
      ...(isDark ? C3.glassDark : C3.glassLight), borderRadius: 20, padding: 24, width: '100%', maxWidth: 440,
      color: isDark ? C3.textDark : C3.textLightTheme,
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Import finished</h2>
      {report && report.limitLine
        ? <p data-free-limit-line="positions" style={{ margin: 0 }}>{report.limitLine}</p>
        : <p style={{ margin: 0 }}>Imported {count} transaction{count === 1 ? '' : 's'}.</p>}
      {skipped.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600 }}>Skipped {skipped.length}</div>
          {list(skipped, isDark ? C3.error : (C3.errorLight || '#c81e2c'))}
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600 }}>Note</div>
          {list(notes, muted)}
        </div>
      )}
      <button type="button" onClick={onClose} style={{
        marginTop: 18, width: '100%', padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
        fontWeight: 600, fontSize: 15, background: C3.logoGradient, color: 'white',
      }}>OK</button>
    </div>
  );
};
