// Portfolio Tracker - Add Transaction Modal (Concept 3 Glassmorphism Design)
// For adding transactions to existing holdings -- and, given `transaction`,
// for editing one in place. There was no way to correct a trade short of
// deleting it and typing it again.
window.AddTransactionModal = ({ holding, baseCurrency, onClose, onSave, theme, transaction, apiKey: apiKeyProp }) => {
  const editing = !!(transaction && transaction.id);
  // Escape, focus trap, dialog semantics.
  const dialogProps = window.PTDialog.use(onClose, editing ? 'Edit transaction' : 'Add transaction');
  const str = (v, d) => (v == null || v === '' ? d : String(v));
  const [txType, setTxType] = React.useState(editing ? transaction.type : 'buy');
  const [txDate, setTxDate] = React.useState(editing ? transaction.date : window.PortfolioCalculations.todayISO());
  const [txQuantity, setTxQuantity] = React.useState(editing && transaction.type !== 'split' ? str(transaction.quantity, '') : '');
  const [txPrice, setTxPrice] = React.useState(editing && transaction.type !== 'split' ? str(transaction.price, '') : '');
  const [txFees, setTxFees] = React.useState(editing ? str(transaction.fees, '0') : '0');
  const [withholdingTax, setWithholdingTax] = React.useState(editing && transaction.withholdingTaxPercent != null ? String(transaction.withholdingTaxPercent) : '15');
  const [splitRatio, setSplitRatio] = React.useState(editing && transaction.type === 'split' ? str(transaction.quantity, '2') : '2');
  const [notes, setNotes] = React.useState(editing ? (transaction.notes || '') : '');
  const [exchangeRate, setExchangeRate] = React.useState(editing ? (Number(transaction.exchangeRate) || 1) : 1);
  // Whether the rate is the trade day's own, or today's standing in for it.
  const [fxNote, setFxNote] = React.useState(null);
  const [loadingFX, setLoadingFX] = React.useState(false);
  const [formError, setFormError] = React.useState(null);
  const [closeLoading, setCloseLoading] = React.useState(false);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  const isDark = theme === 'dark';
  // Light theme: the darker success/error/warning inks (Calc.themeInk).
  const C3 = Calc.themeInk(window.C3, isDark);
  const acc = (hex) => Calc.accent(hex, isDark);
  const apiKey = apiKeyProp || window.EODHD_API_KEY || (() => { try { return localStorage.getItem('eodhd_api_key'); } catch (e) { return null; } })();
  const history = React.useMemo(() => Storage.getTransactionsByHolding(holding.id), [holding.id]);
  // The record as this form loaded it from storage. Saving checks it is still
  // what is stored: another tab's edit was silently overwritten.
  const baselineRef = React.useRef(editing ? (Storage.getTransactions().find(t => t.id === transaction.id) || null) : null);
  const othersForCheck = editing ? history.filter(t => t.id !== transaction.id) : history;

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
      background: isDark ? '#1E222D' : '#ffffff',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
      boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 400,
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
    card: {
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      borderRadius: 12,
      padding: 12,
      marginBottom: 16
    },
    muted: {
      color: isDark ? C3.textMutedDark : C3.textMutedLight,
      fontSize: 12
    },
    // Picked in the accent whatever the type (it took the type's green, red,
    // blue or grey).
    typeButton: (isSelected) => ({
      padding: 8,
      borderRadius: 8,
      textAlign: 'center',
      cursor: 'pointer',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      ...window.ToggleStyle.value(isSelected, isDark, { bordered: true })
    })
  };

  const TRANSACTION_TYPES = [
    { id: 'buy', name: 'Buy', color: 'green', icon: 'plus' },
    { id: 'sell', name: 'Sell', color: 'red', icon: 'trendDown' },
    { id: 'dividend', name: 'Dividend', color: 'blue', icon: 'dollar' },
    { id: 'split', name: 'Split', color: 'purple', icon: 'activity' },
    { id: 'transfer_in', name: 'Transfer In', color: 'green', icon: 'chevronRight' },
    { id: 'transfer_out', name: 'Transfer Out', color: 'red', icon: 'chevronLeft' }
  ];

  const WITHHOLDING_TAX_RATES = [
    { value: '0', label: '0% (Tax-free)' },
    { value: '10', label: '10%' },
    { value: '15', label: '15% (US default)' },
    { value: '25', label: '25%' },
    { value: '30', label: '30% (No treaty)' },
    { value: '35', label: '35%' }
  ];

  // The rate on the trade's own date, fetched again when the date changes.
  // It used to be today's rate whatever the date. Editing a transaction keeps its stored rate until the date moves.
  const fxDateRef = React.useRef(editing ? transaction.date : null);
  React.useEffect(() => {
    const holdingCurrency = holding.currency || 'USD';
    if (holdingCurrency === baseCurrency) { setExchangeRate(1); setFxNote(null); return; }
    if (editing && fxDateRef.current === txDate) return;
    fxDateRef.current = txDate;
    let cancelled = false;
    fetchExchangeRate(holdingCurrency, txDate, () => cancelled);
    return () => { cancelled = true; };
  }, [holding, baseCurrency, txDate]);

  const fetchExchangeRate = async (holdingCurrency, date, isCancelled) => {
    setLoadingFX(true);
    // Until a rate is known it is null, not 1: a failed lookup used to leave
    // the transaction booked at parity (and a cached "NA" crashed the render
    // on .toFixed). Calc.fxRate maps GBX/ZAC/ILA to their major currency /100.
    setExchangeRate(null);
    setFxNote(null);
    let found = null;
    try {
      found = await Calc.tradeFxRate(apiKey, holdingCurrency, baseCurrency, date);
    } catch (e) { found = null; }
    if (isCancelled && isCancelled()) return;
    if (found && found.rate) {
      setExchangeRate(found.rate);
      if (found.live) Storage.setCachedForexRate(holdingCurrency, baseCurrency, found.rate);
      setFxNote(found.onDate ? null : `No ${holdingCurrency}/${baseCurrency} rate for ${date}; today's rate is used.`);
    } else {
      // Stale beats none -- and the screen says it is stale.
      const cached = Calc.toRate(Storage.getCachedForexRate(holdingCurrency, baseCurrency, true));
      const why = found && found.failed ? window.RateLimitWait.failReason(found.failed) : null;
      if (cached) {
        setExchangeRate(cached);
        setFxNote(why ? `The ${holdingCurrency}/${baseCurrency} rate did not load: ${why} Using the last known ${cached.toFixed(4)}.` : `${holdingCurrency}/${baseCurrency} rate unavailable — using the last known ${cached.toFixed(4)}.`);
      } else if (why) {
        setFxNote(`The ${holdingCurrency}/${baseCurrency} rate did not load: ${why}`);
      }
    }
    setLoadingFX(false);
  };

  // A dividend is paid on the shares held that day: the field starts there,
  // rather than empty (an empty field saved a dividend on 0 shares).
  React.useEffect(() => {
    if (txType !== 'dividend' || editing) return;
    const held = Calc.heldOn(othersForCheck, txDate);
    if (held > 0) setTxQuantity(String(Math.round(held * 1e8) / 1e8));
  }, [txType, txDate]);

  // The cost basis of a transfer in, from the market close on its date.
  const useMarketClose = async () => {
    if (!holding.symbol) return;
    setCloseLoading(true);
    setFormError(null);
    const close = await Calc.closeOn(apiKey, holding.symbol, txDate);
    setCloseLoading(false);
    if (close && close.close > 0) setTxPrice(String(close.close));
    // The history did not load: its reason, not "no close".
    else if (close && close.failed) setFormError(`The close for ${holding.symbol} on ${txDate} did not load: ${window.RateLimitWait.failReason(close.failed)} Enter the cost per share yourself, or try the market close again.`);
    else setFormError(`No close for ${holding.symbol} on or before ${txDate} — enter the cost per share yourself.`);
  };

  // Number fields are text read by window.NumberInput: a Chrome-EN number
  // field turned "250,5" into 2505 before the page saw it.
  const num = (v) => (window.NumberInput ? window.NumberInput.parse(v) : parseFloat(v));
  const numberField = window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' };
  // The first field that can't be read, as the sentence under the form.
  const unreadable = (fields) => {
    if (!window.NumberInput) return null;
    for (const [label, raw] of fields) {
      const c = window.NumberInput.check(raw);
      if (c.error) return `${label}: ${c.error}`;
    }
    return null;
  };

  // Calculate totals based on transaction type
  const getTotal = () => {
    const qty = num(txQuantity) || 0;
    const price = num(txPrice) || 0;
    // A fee is a cost whatever sign it is typed with.
    const fees = Math.abs(num(txFees) || 0);

    if (txType === 'dividend') {
      const gross = qty * price;
      const tax = gross * (parseFloat(withholdingTax) / 100);
      return { gross, tax, net: gross - tax };
    }

    if (txType === 'split') {
      return { ratio: num(splitRatio) || 2 };
    }

    return { total: qty * price + fees };
  };

  const totals = getTotal();

  // Save transaction
  const handleSave = () => {
    const bad = txType === 'split'
      ? unreadable([['Split ratio', splitRatio]])
      : unreadable([[txType === 'dividend' ? 'Shares held' : 'Shares', txQuantity],
                    [txType === 'dividend' ? 'Dividend per share' : 'Price', txType === 'transfer_out' ? '' : txPrice],
                    ['Fees', txType === 'dividend' ? '' : txFees]]);
    if (bad) { setFormError(bad); return; }
    const transactionData = {
      holdingId: holding.id,
      type: txType,
      date: txDate,
      quantity: txType === 'split' ? num(splitRatio) : num(txQuantity) || 0,
      // A split has no price; a transfer out needs none.
      price: txType === 'split' ? 0 : num(txPrice) || 0,
      fees: txType === 'split' || txType === 'dividend' ? 0 : Math.abs(num(txFees) || 0),
      currency: holding.currency || baseCurrency,
      exchangeRate: exchangeRate,
      withholdingTaxPercent: txType === 'dividend' ? parseFloat(withholdingTax) : null,
      notes: notes
    };

    // One rule set with Add Position and the importer: a price above zero
    // for a trade, a cost basis for a transfer in, no date in the future, a
    // sale checked against every later date, a dividend against the shares
    // held that day.
    if (txType !== 'split' && txType !== 'transfer_out' && !String(txPrice).trim()) {
      setFormError(txType === 'dividend' ? 'Enter the dividend per share' : txType === 'transfer_in' ? 'Enter the cost basis per share, or use the market close on the transfer date' : 'Enter the price per share');
      return;
    }
    // Against the history as stored now, not as it was when the form opened:
    // a sale added in another tab meanwhile is part of it.
    const problem = Calc.validateTransaction(Storage.getTransactionsByHolding(holding.id), transactionData, { replaceId: editing ? transaction.id : undefined });
    if (problem) { setFormError(problem); return; }

    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      setFormError(`The ${holding.currency}/${baseCurrency} exchange rate is not available — it can't be saved at 1:1. Try again in a moment.`);
      return;
    }

    try {
      if (editing) Storage.updateTransaction(transaction.id, transactionData, baselineRef.current || undefined);
      else Storage.createTransaction(transactionData);
    } catch (e) {
      if (e && e.name === 'PortfolioStorageError') { setFormError(e.message); return; }
      throw e;
    }
    onSave();
  };

  return (
    <div style={styles.modal} {...dialogProps}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{editing ? 'Edit Transaction' : 'Add Transaction'}</h3>
        <button onClick={onClose} style={styles.iconButton} aria-label="Close">
          <Icon name="x" size={24} />
        </button>
      </div>

      {/* Holding Info */}
      <div style={styles.card}>
        <div style={{ fontWeight: 600 }}>
          {holding.type === 'manual' ? holding.name : holding.symbol?.split('.')[0]}
        </div>
        <div style={styles.muted}>
          {holding.type === 'manual' ? 'Manual Asset' : holding.symbol}
        </div>
      </div>

      {/* Transaction Type */}
      <div style={{ marginBottom: 16 }}>
        <label style={styles.label}>Transaction Type</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {TRANSACTION_TYPES.map(type => (
            <button
              key={type.id}
              onClick={() => { setTxType(type.id); setFormError(null); }}
              aria-pressed={txType === type.id}
              style={styles.typeButton(txType === type.id)}
            >
              <Icon name={type.icon} size={16} />
              <div style={{ fontSize: 12, marginTop: 4 }}>{type.name}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Date */}
      <div style={{ marginBottom: 16 }}>
        <label style={styles.label} htmlFor="pt-addtx-date">Date</label>
        <input
          id="pt-addtx-date"
          type="date"
          value={txDate}
          min={Calc.EARLIEST_TRADE_DATE}
          max={Calc.todayISO()}
          onChange={(e) => { setTxDate(e.target.value); setFormError(null); }}
          style={styles.input}
        />
      </div>

      {/* Split-specific fields */}
      {txType === 'split' && (
        <div style={{ marginBottom: 16 }}>
          <label style={styles.label}>Split Ratio (e.g., 2 for 2:1 split)</label>
          <input
            {...numberField}
            step="any"
            placeholder="2"
            value={splitRatio}
            onChange={(e) => setSplitRatio(e.target.value)}
            style={styles.input}
          />
          <p style={{ ...styles.muted, marginTop: 4 }}>
            A 2:1 split means each share becomes 2 shares
          </p>
        </div>
      )}

      {/* Dividend-specific fields */}
      {txType === 'dividend' && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="pt-addtx-divqty">Shares Held (for dividend)</label>
            <input
              id="pt-addtx-divqty"
              {...numberField}
              step="any"
              min="0"
              placeholder={String(Calc.heldOn(othersForCheck, txDate) || 0)}
              value={txQuantity}
              onChange={(e) => { setTxQuantity(e.target.value); setFormError(null); }}
              style={styles.input}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>
              {Calc.formatQuantity(Calc.heldOn(othersForCheck, txDate), holding)} held on {txDate}
            </p>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label}>Dividend per Share</label>
            <input
              {...numberField}
              step="any"
              placeholder="0.24"
              value={txPrice}
              onChange={(e) => setTxPrice(e.target.value)}
              style={styles.input}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label}>Withholding Tax</label>
            {React.createElement(window.PortalDropdown, {
              value: withholdingTax,
              options: WITHHOLDING_TAX_RATES.map(rate => ({ value: rate.value, label: rate.label })),
              onChange: setWithholdingTax,
              isDark,
              style: { width: '100%' },
              minWidth: 0,
              ariaLabel: 'Withholding tax',
            })}
          </div>
        </>
      )}

      {/* Buy/Sell/Transfer fields */}
      {!['split', 'dividend'].includes(txType) && (
        <>
          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="pt-addtx-qty">
              {holding.type === 'crypto' ? 'Amount' : 'Shares'}
            </label>
            <input
              id="pt-addtx-qty"
              {...numberField}
              step="any"
              min="0"
              placeholder="100"
              value={txQuantity}
              onChange={(e) => { setTxQuantity(e.target.value); setFormError(null); }}
              style={styles.input}
            />
          </div>

          {/* A transfer in carries its cost basis -- what the shares cost at
              the other broker -- or, failing that, the close on the day it
              arrived. Never 0: that was AVG COST $0 and the whole value read
              as profit. A transfer out takes its
              cost from the lots and needs no price. */}
          {txType !== 'transfer_out' && (
          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="pt-addtx-price">{txType === 'transfer_in' ? 'Cost basis per unit (what it originally cost)' : 'Price per unit'}</label>
            <input
              id="pt-addtx-price"
              {...numberField}
              step="any"
              min="0"
              placeholder="150.00"
              value={txPrice}
              onChange={(e) => { setTxPrice(e.target.value); setFormError(null); }}
              style={styles.input}
            />
            {txType === 'transfer_in' && holding.symbol && holding.type !== 'manual' && (
              <button type="button" onClick={useMarketClose} disabled={closeLoading} style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, background: 'transparent', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 12, cursor: closeLoading ? 'wait' : 'pointer' }}>
                {closeLoading ? 'Looking up…' : `Use the market close on ${txDate}`}
              </button>
            )}
          </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={styles.label} htmlFor="pt-addtx-fees">Fees (optional)</label>
            <input
              id="pt-addtx-fees"
              {...numberField}
              step="any"
              placeholder="4.95"
              value={txFees}
              onChange={(e) => setTxFees(e.target.value)}
              style={styles.input}
            />
            {num(txFees) < 0 && (
              <p style={{ ...styles.muted, marginTop: 4 }}>Fees are a cost — counted as {Calc.formatCurrency(Math.abs(num(txFees)), holding.currency)}.</p>
            )}
          </div>
        </>
      )}

      {/* Notes */}
      <div style={{ marginBottom: 16 }}>
        <label style={styles.label}>Notes (optional)</label>
        <input
          type="text"
          placeholder="e.g., Quarterly dividend"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={styles.input}
        />
      </div>

      {/* Summary */}
      <div style={{ ...styles.card, marginBottom: 16 }}>
        {txType === 'dividend' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
              <span style={styles.muted}>Gross Dividend</span>
              <span>{Calc.formatCurrency(totals.gross || 0, holding.currency)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 4 }}>
              <span style={styles.muted}>Withholding Tax ({withholdingTax}%)</span>
              <span style={{ color: C3.error }}>-{Calc.formatCurrency(totals.tax || 0, holding.currency)}</span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 600,
              paddingTop: 8,
              borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
            }}>
              <span>Net Dividend</span>
              <span style={{ color: C3.success }}>{Calc.formatCurrency(totals.net || 0, holding.currency)}</span>
            </div>
          </>
        )}

        {txType === 'split' && (
          <div style={{ textAlign: 'center' }}>
            <span style={styles.muted}>Split Ratio: </span>
            <span style={{ fontWeight: 600 }}>{splitRatio}:1</span>
            <p style={{ ...styles.muted, marginTop: 4, marginBottom: 0 }}>Your shares will be multiplied by {splitRatio}</p>
          </div>
        )}

        {!['split', 'dividend'].includes(txType) && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={styles.muted}>Total</span>
              <span style={{ fontSize: 20, fontWeight: 700 }}>
                {Calc.formatCurrency(totals.total || 0, holding.currency)}
              </span>
            </div>
            {holding.currency !== baseCurrency && exchangeRate !== 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 14 }}>
                <span style={styles.muted}>
                  {loadingFX ? 'Loading FX...' : Number.isFinite(exchangeRate) ? `@ ${exchangeRate < 0.01 ? exchangeRate.toPrecision(4) : exchangeRate.toFixed(4)} on ${txDate}` : `${holding.currency}/${baseCurrency} rate unavailable`}
                </span>
                {Number.isFinite(exchangeRate) && (
                  <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                    ≈ {Calc.formatCurrency((totals.total || 0) * exchangeRate, baseCurrency)}
                  </span>
                )}
              </div>
            )}
          </>
        )}
        {fxNote && (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: C3.warning }}>{fxNote}</div>
        )}
      </div>

      {formError && (
        <div role="alert" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.5, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: C3.error }}>{formError}</div>
      )}

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={loadingFX}
        style={{
          width: '100%',
          padding: 14,
          borderRadius: 12,
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 16,
          // White text needs the burnt-orange pair (4.6:1); #f97316 is 2.8:1.
          background: C3.logoGradient || '#c2410c',
          color: 'white',
          opacity: loadingFX ? 0.6 : 1
        }}
      >
        {editing ? 'Save Changes' : 'Add Transaction'}
      </button>
    </div>
  );
};
