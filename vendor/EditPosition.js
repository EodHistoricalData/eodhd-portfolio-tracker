// Portfolio Tracker - Edit Position Modal (Concept 3 Glassmorphism Design)
window.EditPositionModal = ({ holding, holdingData, baseCurrency, onClose, onSave, theme, apiKey }) => {
  // Escape, focus trap, dialog semantics.
  // After a delete the focus goes to the next position: the Edit button that
  // opened this window left with the deleted row.
  const deletedOrderRef = React.useRef(null);
  const dialogProps = window.PTDialog.use(onClose, 'Edit position', {
    restoreFocus: () => (deletedOrderRef.current ? window.PTAfterDeleteFocus(holding.id, deletedOrderRef.current) : null),
    // The top of the window, not Notes half-way down:
    // the first section, Adjust Quantity.
    initialFocus: (node) => node.querySelector('[data-ep-first]'),
  });
  // "Delete Position" asks in the window, not with the browser's confirm().
  // Escape takes the question back first.
  const [askDelete, setAskDelete] = React.useState(false);
  // Taken back (Escape or Cancel), the question leaves with the button that
  // had the focus: it goes back to "Delete Position", which returns in its
  // place (it fell to <body>).
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();
  const cancelDelete = () => {
    setAskDelete(false);
    focusNext(() => document.querySelector('[data-ep-delete]'));
  };
  (window.useEscLayer || (() => {}))(askDelete, cancelDelete);
  const deleteLabel = holding.type === 'manual' ? holding.name : (holding.symbol?.split('.')[0] || 'this position');
  const doDelete = () => {
    deletedOrderRef.current = window.PTEditOrder ? window.PTEditOrder() : [];
    Storage.deleteHolding(holding.id);
    if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_manage', { action: 'delete' });
    window.Haptics?.medium?.();
    onSave?.();
    onClose?.();
  };
  const [name, setName] = React.useState(holding.name || '');
  const [notes, setNotes] = React.useState(holding.notes || '');
  const [manualPrice, setManualPrice] = React.useState(holding.manualPrice?.toString() || '');

  // Target alerts
  const [showTargetAlerts, setShowTargetAlerts] = React.useState(false);
  const [targetPrice, setTargetPrice] = React.useState(holding.targetPrice?.toString() || '');
  const [stopLoss, setStopLoss] = React.useState(holding.stopLoss?.toString() || '');
  const [savingTargets, setSavingTargets] = React.useState(false);
  // "Saved" is its own state: it was written into the button while it was
  // disabled at opacity 0.5, white on #178640 at 1.48:1.
  const [savedTargets, setSavedTargets] = React.useState(false);
  // What a refused action says, under its own button ('adjust', 'targets',
  // 'save'); it was the browser's alert().
  const [note, setNote] = React.useState(null);
  // The position deleted in another tab while this window was open: every
  // write is refused by storage, the window says so once at the top and its
  // save buttons go off.
  const [gone, setGone] = React.useState(false);
  const say = (where, text) => {
    if (/deleted in another tab/.test(String(text || ''))) setGone(true);
    setNote({ where, text });
  };
  React.useEffect(() => {
    const check = () => { try { if (!Storage.getHoldingById(holding.id)) setGone(true); } catch (_) { /* unreadable: the write says */ } };
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, [holding.id]);
  const noteFor = (where) => (note && note.where === where
    ? <div role="alert" data-ep-note={where} style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{note.text}</div>
    : null);

  // Quantity adjustment
  const [showQuantityAdjust, setShowQuantityAdjust] = React.useState(false);
  const [newQuantity, setNewQuantity] = React.useState('');
  const [adjustmentDate, setAdjustmentDate] = React.useState(() => window.PortfolioCalculations.todayISO());
  const [adjustmentPrice, setAdjustmentPrice] = React.useState('');
  const [adjustmentNotes, setAdjustmentNotes] = React.useState('');
  // The instrument's rate into the portfolio currency, for the adjustment
  // transaction. It was written as the constant 1.
  //
  // Null while unknown, and the adjustment cannot be applied without one. It
  // used to fall back to 1 with a warning and save anyway: AVG COST EUR 95 for
  // a dollar position bought at 100. Add Position
  // and the importer already refused; this now does too. The rate is the
  // adjustment date's own, fetched again when the date moves.
  const [adjustmentRate, setAdjustmentRate] = React.useState(1);
  const [rateError, setRateError] = React.useState(null);
  const [rateLoading, setRateLoading] = React.useState(false);
  React.useEffect(() => {
    const currency = holding.currency || 'USD';
    if (!showQuantityAdjust || currency === baseCurrency) { setAdjustmentRate(1); setRateError(null); return; }
    let cancelled = false;
    setAdjustmentRate(null);
    setRateLoading(true);
    (async () => {
      let found = null;
      try {
        // Calc.tradeFxRate: the day's close, else today's (said below);
        // GBX/ZAC/ILA via their major currency /100, "NA" = missing.
        found = await window.PortfolioCalculations.tradeFxRate(apiKey || 'proxy', currency, baseCurrency, adjustmentDate);
      } catch (e) { found = null; }
      if (cancelled) return;
      setRateLoading(false);
      if (found && found.rate > 0) {
        setAdjustmentRate(found.rate);
        setRateError(found.onDate ? null : `No ${currency}/${baseCurrency} rate for ${adjustmentDate}; today's rate is used.`);
        return;
      }
      const cached = window.PortfolioCalculations.toRate(Storage.getCachedForexRate(currency, baseCurrency, true));
      // The rate did not load: said with its reason.
      const why = found && found.failed ? window.RateLimitWait.failReason(found.failed) : null;
      if (cached > 0) { setAdjustmentRate(cached); setRateError(why ? `The ${currency}/${baseCurrency} rate did not load: ${why} Using the last known ${cached.toFixed(4)}` : currency + '/' + baseCurrency + ' rate unavailable — using the last known ' + cached.toFixed(4)); return; }
      setAdjustmentRate(null);
      setRateError(why ? `The ${currency}/${baseCurrency} rate did not load: ${why} The adjustment can't be saved without it — try again in a moment.` : `Could not get the ${currency}/${baseCurrency} rate, so the adjustment can't be saved — it would be booked at 1:1. Try again in a moment.`);
    })();
    return () => { cancelled = true; };
  }, [showQuantityAdjust, holding.currency, baseCurrency, adjustmentDate]);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  // Light theme: darker success/error/warning inks and accents, so text clears
  // 4.5:1 on white (Calc.themeInk).
  const C3 = window.PortfolioCalculations.themeInk(window.C3, theme === 'dark');
  const acc = (hex) => window.PortfolioCalculations.accent(hex, theme === 'dark');
  const isDark = theme === 'dark';

  const currentQuantity = holdingData?.quantity || 0;

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
    textarea: {
      width: '100%',
      padding: '12px 16px',
      borderRadius: 12,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 16,
      outline: 'none',
      boxSizing: 'border-box',
      resize: 'none',
      fontFamily: 'inherit'
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
      padding: 16,
      marginBottom: 16
    },
    muted: {
      color: isDark ? C3.textMutedDark : C3.textMutedLight,
      fontSize: 12
    },
    expandButton: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 16,
      borderRadius: 12,
      border: 'none',
      cursor: 'pointer',
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      transition: 'background 0.2s'
    },
    previewBox: (type) => ({
      padding: 12,
      borderRadius: 8,
      background: type === 'buy' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
      border: `1px solid ${type === 'buy' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
      fontSize: 14
    })
  };

  // Initialize adjustment price from current price
  React.useEffect(() => {
    if (holdingData?.close) {
      setAdjustmentPrice(holdingData.close.toString());
    } else if (holding.manualPrice) {
      setAdjustmentPrice(holding.manualPrice.toString());
    }
  }, [holdingData, holding]);

  // Number fields are text read by window.NumberInput: a Chrome-EN number
  // field turned "250,5" into 2505 before the page saw it.
  const num = (v) => (window.NumberInput ? window.NumberInput.parse(v) : parseFloat(v));
  const numberField = window.NumberInput ? window.NumberInput.fieldProps : { type: 'number' };
  const numError = (raw, what) => {
    const c = window.NumberInput ? window.NumberInput.check(raw) : null;
    return c && c.error ? `${what}: ${c.error}` : null;
  };

  // Save holding details
  const handleSaveDetails = () => {
    const updates = {
      notes: notes.trim()
    };

    // For manual positions, also save name and price
    if (holding.type === 'manual') {
      updates.name = name.trim() || holding.name;
      if (manualPrice) {
        const bad = numError(manualPrice, 'Current value');
        if (bad) { say('save', bad); return; }
        updates.manualPrice = num(manualPrice);
        updates.manualPriceDate = window.PortfolioCalculations.todayISO();
      }
    }

    if (!Storage.attempt(() => Storage.updateHolding(holding.id, updates), (m) => say('save', m))) return;
    setNote(null);
    onSave();
  };

  // Handle quantity adjustment
  const handleAdjustQuantity = () => {
    const newQty = num(newQuantity);
    if (isNaN(newQty) || newQty < 0) {
      say('adjust', numError(newQuantity, 'Quantity') || 'Enter a valid quantity.');
      return;
    }

    const price = num(adjustmentPrice);
    if (isNaN(price) || price <= 0) {
      say('adjust', numError(adjustmentPrice, 'Price') || 'Enter a valid price.');
      return;
    }

    const diff = newQty - currentQuantity;

    if (Math.abs(diff) < 0.0001) {
      say('adjust', 'The new quantity is the same as the current one.');
      return;
    }

    if (!(Number.isFinite(adjustmentRate) && adjustmentRate > 0)) {
      say('adjust', rateError || 'The exchange rate is not available yet — try again in a moment.');
      return;
    }

    const tx = {
      holdingId: holding.id,
      type: diff > 0 ? 'buy' : 'sell',
      date: adjustmentDate,
      quantity: Math.abs(diff),
      price: price,
      fees: 0,
      currency: holding.currency || 'USD',
      // The rate of the adjustment's date, not 1. A constant here was the
      // third way into the portfolio that lost the exchange rate: in a euro
      // portfolio a dollar adjustment was booked at parity.
      exchangeRate: adjustmentRate,
      notes: adjustmentNotes || 'Quantity adjustment'
    };
    // The forms' rules: no future date, and a reduction checked against
    // every later sale, not just the adjustment date.
    const problem = Calc.validateTransaction(Storage.getTransactionsByHolding(holding.id), tx);
    if (problem) { say('adjust', problem); return; }

    try { Storage.createTransaction(tx); }
    catch (e) { if (e && e.name === 'PortfolioStorageError') { say('adjust', e.message); return; } throw e; }
    setNote(null);
    onSave();
  };

  // Calculate adjustment preview
  const adjustmentDiff = newQuantity && Number.isFinite(num(newQuantity)) ? num(newQuantity) - currentQuantity : 0;
  const adjustmentType = adjustmentDiff > 0 ? 'buy' : adjustmentDiff < 0 ? 'sell' : null;

  return (
    <div style={styles.modal} {...dialogProps}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Edit Position</h3>
        <button onClick={onClose} style={styles.iconButton} aria-label="Close">
          <Icon name="x" size={24} />
        </button>
      </div>
      {gone && (
        <div role="alert" data-ep-gone="" style={{ marginBottom: 16, fontSize: 14, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>
          This position was deleted in another tab. Nothing here can be saved; close this window.
        </div>
      )}

      {/* Holding Info */}
      <div style={styles.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              {holding.type === 'manual' ? holding.name : holding.symbol?.split('.')[0]}
            </div>
            <div style={styles.muted}>
              {holding.type === 'manual' ? 'Manual Asset' : holding.name || holding.symbol}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700 }}>
              {Calc.formatQuantity(currentQuantity, holding)} {Calc.quantityUnit(holding, currentQuantity)}
            </div>
            <div style={styles.muted}>
              {/* currentValue is already in the portfolio's currency: under the
                  holding's own symbol VOD.LSE read "GBX 1,652.95" for $1,652.95. */}
              {Calc.formatCurrency(holdingData?.currentValue || 0, baseCurrency || 'USD')}
            </div>
          </div>
        </div>
      </div>

      {/* Quantity Adjustment Section */}
      <div style={{ marginBottom: 24 }}>
        <button
          data-ep-first="true"
          aria-expanded={showQuantityAdjust}
          onClick={() => setShowQuantityAdjust(!showQuantityAdjust)}
          style={styles.expandButton}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(249,115,22,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Icon name="edit" size={20} color="#f97316" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>Adjust Quantity</div>
              <div style={styles.muted}>Change the number of shares/units</div>
            </div>
          </div>
          <Icon name={showQuantityAdjust ? 'chevronDown' : 'chevronRight'} size={20} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
        </button>

        {showQuantityAdjust && (
          <div style={{
            marginTop: 16,
            padding: 16,
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            borderRadius: 12
          }}>
            <div style={{ ...styles.muted, marginBottom: 16 }}>
              Current: <span style={{ fontWeight: 600, color: isDark ? C3.textDark : C3.textLightTheme }}>{Calc.formatQuantity(currentQuantity, holding)}</span> {Calc.quantityUnit(holding, currentQuantity)}
            </div>

            {/* The rate this adjustment will be recorded at, and a warning
                when it could not be fetched -- it used to be written as 1. */}
            {(holding.currency || 'USD') !== baseCurrency && (
              <div style={{ ...styles.muted, marginBottom: 12 }}>
                {rateLoading ? 'Looking up the rate…'
                  : Number.isFinite(adjustmentRate) ? `Recorded at ${adjustmentRate < 0.01 ? adjustmentRate.toPrecision(4) : adjustmentRate.toFixed(4)} ${holding.currency}/${baseCurrency} (${adjustmentDate})`
                  : `No ${holding.currency}/${baseCurrency} rate`}
              </div>
            )}
            {rateError && (
              <div style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.5, color: C3.warning }}>{rateError}</div>
            )}

            {/* New Quantity */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="ep-field-1" style={styles.label}>New Total Quantity</label>
              <input
                id="ep-field-1"
                {...numberField}
                step="any"
                placeholder={currentQuantity.toString()}
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                style={styles.input}
              />
            </div>

            {/* Preview */}
            {adjustmentType && (
              <div style={{ ...styles.previewBox(adjustmentType), marginBottom: 16 }}>
                This will {adjustmentType === 'buy' ? 'add' : 'remove'}{' '}
                <span style={{ fontWeight: 700 }}>{Calc.formatQuantity(Math.abs(adjustmentDiff), holding)}</span>{' '}
                {Calc.quantityUnit(holding, Math.abs(adjustmentDiff))}
              </div>
            )}

            {/* Date */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="ep-field-2" style={styles.label}>Adjustment Date</label>
              <input
                id="ep-field-2"
                type="date"
                min={Calc.EARLIEST_TRADE_DATE}
                max={Calc.todayISO()}
                value={adjustmentDate}
                onChange={(e) => setAdjustmentDate(e.target.value)}
                style={styles.input}
              />
            </div>

            {/* Price */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="ep-field-3" style={styles.label}>Price per Unit</label>
              <input
                id="ep-field-3"
                {...numberField}
                step="any"
                placeholder="150.00"
                value={adjustmentPrice}
                onChange={(e) => setAdjustmentPrice(e.target.value)}
                style={styles.input}
              />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="ep-field-4" style={styles.label}>Notes (optional)</label>
              <input
                id="ep-field-4"
                type="text"
                placeholder="e.g. stock split"
                value={adjustmentNotes}
                onChange={(e) => setAdjustmentNotes(e.target.value)}
                style={styles.input}
              />
            </div>

            <button
              onClick={handleAdjustQuantity}
              disabled={gone || !newQuantity || !adjustmentPrice || !adjustmentType || !Number.isFinite(adjustmentRate) || rateLoading}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 12,
                border: 'none',
                cursor: (!newQuantity || !adjustmentPrice || !adjustmentType || !Number.isFinite(adjustmentRate) || rateLoading) ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                // White on #f97316 is 2.8:1; the burnt orange clears 4.5:1.
                background: '#c2410c',
                color: 'white',
                opacity: (!newQuantity || !adjustmentPrice || !adjustmentType || !Number.isFinite(adjustmentRate) || rateLoading) ? 0.5 : 1
              }}
            >
              Apply Adjustment
            </button>
            {noteFor('adjust')}
          </div>
        )}
      </div>

      {/* Target Alerts Section */}
      <div style={{ marginBottom: 24 }}>
        <button
          aria-expanded={showTargetAlerts}
          onClick={() => setShowTargetAlerts(!showTargetAlerts)}
          style={styles.expandButton}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(34,197,94,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Icon name="trendUp" size={20} color="#22c55e" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600 }}>Price Alerts</div>
              <div style={styles.muted}>Set target price & stop loss</div>
            </div>
          </div>
          <Icon name={showTargetAlerts ? 'chevronDown' : 'chevronRight'} size={20} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
        </button>

        {showTargetAlerts && (
          <div style={{
            marginTop: 16,
            padding: 16,
            background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            borderRadius: 12
          }}>
            <div style={{ ...styles.muted, marginBottom: 16 }}>
              Saved with this position, on this machine. Nothing is sent anywhere.
            </div>

            {/* Current Price Info */}
            {holdingData?.close && (
              <div style={{
                padding: 12,
                borderRadius: 8,
                background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={styles.muted}>Current Price:</span>
                <span style={{ fontWeight: 700, color: isDark ? C3.textDark : C3.textLightTheme }}>
                  {/* In the listing's own currency: "$" over a pence price was wrong. */}
                  {Calc.formatCurrency(holdingData.close, holding.currency || 'USD')}
                </span>
              </div>
            )}

            {/* Target Price */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="ep-field-5" style={styles.label}>
                Target Price (Take Profit)
              </label>
              <input
                id="ep-field-5"
                {...numberField}
                step="any"
                placeholder={holdingData?.close ? `e.g. ${(holdingData.close * 1.2).toFixed(2)}` : 'e.g. 150.00'}
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                style={styles.input}
              />
              {targetPrice && holdingData?.close && (
                <p style={{ ...styles.muted, marginTop: 4, color: num(targetPrice) > holdingData.close ? '#22c55e' : '#f97316' }}>
                  {Number.isFinite(num(targetPrice)) ? `${((num(targetPrice) / holdingData.close - 1) * 100).toFixed(1)}% from current` : (numError(targetPrice, 'Target') || '')}
                </p>
              )}
            </div>

            {/* Stop Loss */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="ep-field-6" style={styles.label}>
                Stop Loss
              </label>
              <input
                id="ep-field-6"
                {...numberField}
                step="any"
                placeholder={holdingData?.close ? `e.g. ${(holdingData.close * 0.9).toFixed(2)}` : 'e.g. 120.00'}
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                style={styles.input}
              />
              {stopLoss && holdingData?.close && (
                <p style={{ ...styles.muted, marginTop: 4, color: num(stopLoss) < holdingData.close ? '#ef4444' : '#f97316' }}>
                  {Number.isFinite(num(stopLoss)) ? `${((num(stopLoss) / holdingData.close - 1) * 100).toFixed(1)}% from current` : (numError(stopLoss, 'Stop loss') || '')}
                </p>
              )}
            </div>

            <button
              onClick={async () => {
                const badTarget = (targetPrice && numError(targetPrice, 'Target price')) || (stopLoss && numError(stopLoss, 'Stop loss'));
                if (badTarget) { say('targets', badTarget); return; }
                setNote(null);
                setSavingTargets(true);
                try {
                  await Storage.setHoldingTargets(
                    holding.id,
                    targetPrice ? num(targetPrice) : null,
                    stopLoss ? num(stopLoss) : null
                  );
                  // Show success feedback, at full strength.
                  setSavedTargets(true);
                  setTimeout(() => {
                    setSavedTargets(false);
                    setSavingTargets(false);
                  }, 1500);
                } catch (err) {
                  console.error('Failed to save targets:', err);
                  say('targets', err && err.name === 'PortfolioStorageError' ? err.message : 'The alerts could not be saved. Try again.');
                  setSavingTargets(false);
                }
              }}
              disabled={gone || savingTargets || (!targetPrice && !stopLoss)}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 12,
                border: 'none',
                cursor: (savingTargets || (!targetPrice && !stopLoss)) ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                background: '#047857',
                color: 'white',
                opacity: !savedTargets && (savingTargets || (!targetPrice && !stopLoss)) ? 0.5 : 1
              }}
            >
              {savedTargets ? '✓ Saved!' : savingTargets ? 'Saving...' : 'Save Alerts'}
            </button>
            {noteFor('targets')}

            {/* Clear alerts button */}
            {(holding.targetPrice || holding.stopLoss) && (
              <button
                onClick={async () => {
                  setTargetPrice('');
                  setStopLoss('');
                  await Storage.setHoldingTargets(holding.id, null, null);
                }}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: 10,
                  borderRadius: 12,
                  border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
                  cursor: 'pointer',
                  fontWeight: 500,
                  background: 'transparent',
                  color: isDark ? C3.textMutedDark : C3.textMutedLight,
                  fontSize: 14
                }}
              >
                Clear All Alerts
              </button>
            )}
          </div>
        )}
      </div>

      {/* Details Section */}
      <div>
        <h4 style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 16 }}>Details</h4>

        {/* Name (only for manual) */}
        {holding.type === 'manual' && (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="ep-field-7" style={styles.label}>Asset Name</label>
            <input
              id="ep-field-7"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
            />
          </div>
        )}

        {/* Manual Price (only for manual) */}
        {holding.type === 'manual' && (
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="ep-field-8" style={styles.label}>Current Value</label>
            <input
              id="ep-field-8"
              {...numberField}
              step="any"
              placeholder="Update current value"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              style={styles.input}
            />
            <p style={{ ...styles.muted, marginTop: 4 }}>
              Last updated: {holding.manualPriceDate || 'Never'}
            </p>
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="ep-field-9" style={styles.label}>Notes</label>
          <textarea
            id="ep-field-9"
            rows={3}
            placeholder="Add notes about this position..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={styles.textarea}
          />
        </div>

        {/* Info */}
        <div style={{
          background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
          borderRadius: 12,
          padding: 12
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted, marginBottom: 4 }}>
            <span>Type:</span>
            {/* The names the rest of the portfolio uses: "ETF", not "Etf"
                (CSS capitalize). */}
            <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>{({ stock: 'Stock', etf: 'ETF', fund: 'Fund', crypto: 'Crypto', forex: 'Forex', bond: 'Bond', manual: 'Manual' })[holding.type] || holding.type}</span>
          </div>
          {holding.symbol && (
            <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted, marginBottom: 4 }}>
              <span>Symbol:</span>
              <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>{holding.symbol}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted, marginBottom: 4 }}>
            <span>Currency:</span>
            <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>{holding.currency || 'USD'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...styles.muted }}>
            <span>Added:</span>
            <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>{new Date(holding.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSaveDetails}
        disabled={gone}
        style={{
          width: '100%',
          marginTop: 24,
          padding: 14,
          borderRadius: 12,
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 16,
          background: window.C3.logoGradient,
          color: 'white'
        }}
      >
        Save Changes
      </button>
      {noteFor('save')}

      {/* Delete Position is destructive, so it is a separate button below Save,
          with a confirmation, so a position is not deleted by accident. */}
      {askDelete ? (
        <fieldset role="group" aria-label={`Delete ${deleteLabel}?`} aria-describedby="ep-delete-question" style={{ marginTop: 12, padding: 12, borderRadius: 12, border: `1px solid ${isDark ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.3)'}`, minWidth: 0 }}>
          <p id="ep-delete-question" style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.5 }}>Delete {deleteLabel}? All transactions for this position are deleted too. This cannot be undone.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" autoFocus onClick={cancelDelete} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, background: 'transparent', color: 'inherit', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
            <button type="button" onClick={doDelete} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#dc2626', color: '#ffffff', cursor: 'pointer', fontWeight: 600 }}>Delete</button>
          </div>
        </fieldset>
      ) : (
      <button
        data-ep-delete="true"
        onClick={() => setAskDelete(true)}
        style={{
          width: '100%',
          marginTop: 12,
          padding: 12,
          borderRadius: 12,
          border: `1px solid ${isDark ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.3)'}`,
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 14,
          background: 'transparent',
          color: acc('#ef4444'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <Icon name="trash" size={16} color="#ef4444" />
        Delete Position
      </button>
      )}
    </div>
  );
};
