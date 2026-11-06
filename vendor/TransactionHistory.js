// Portfolio Tracker - Transaction History Component (Concept 3 Glassmorphism Design)
window.TransactionHistoryView = ({ holding, portfolioId, baseCurrency, onClose, onUpdate, theme, apiKey }) => {
  // Escape, focus trap, dialog semantics.
  const dialogProps = window.PTDialog.use(onClose, 'Transaction history');
  const [transactions, setTransactions] = React.useState([]);
  // Deleting asks in the page and a refusal is said under its row; both were
  // the browser's confirm() / alert().
  const [askInPage, askElement] = window.PTDialog.useAsk();
  const [rowNote, setRowNote] = React.useState(null);
  const [filter, setFilter] = React.useState('all');
  const [showAddTransaction, setShowAddTransaction] = React.useState(false);
  // The transaction being edited, with its holding (the "All" list spans many).
  const [editing, setEditing] = React.useState(null);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  const isDark = theme === 'dark';
  // Light theme: darker success/error inks (Calc.themeInk), and accents.
  const C3 = Calc.themeInk(window.C3, isDark);
  const acc = (hex) => Calc.accent(hex, isDark);

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
      overflow: 'hidden'
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
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    card: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16,
      padding: 16,
      marginBottom: 16
    },
    muted: {
      color: isDark ? C3.textMutedDark : C3.textMutedLight,
      fontSize: 12
    },
    filterButton: (isActive) => ({
      padding: '8px 12px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 500,
      fontSize: 14,
      whiteSpace: 'nowrap',
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      ...window.ToggleStyle.value(isActive, isDark)
    }),
    addButton: {
      background: C3.logoGradient,
      padding: '8px 12px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 14,
      color: 'white'
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(4px)',
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16
    }
  };

  // Load transactions
  React.useEffect(() => {
    loadTransactions();
  }, [holding, portfolioId]);

  const loadTransactions = () => {
    let txs;
    if (holding) {
      txs = Storage.getTransactionsByHolding(holding.id);
    } else if (portfolioId) {
      txs = Storage.getTransactionsByPortfolio(portfolioId);
    } else {
      txs = Storage.getTransactions();
    }
    setTransactions(txs);
    setGone(!!holding && !Storage.getHoldingById(holding.id));
  };
  // The position was deleted in another tab while this list was open.
  const [gone, setGone] = React.useState(false);

  // Another tab booked, edited or deleted a trade: the list and its totals
  // are read again. A sale made in tab A left tab B's list on "Total Sold
  // $0.00", and an edit in B was refused with "8 sold with 5 held" about a
  // sale B did not show. The browser fires `storage`
  // only in the other tabs; a null key is a clear().
  const loadRef = React.useRef(null);
  loadRef.current = loadTransactions;
  React.useEffect(() => {
    const keys = [Storage.KEYS.TRANSACTIONS, Storage.KEYS.HOLDINGS];
    const onStorage = (e) => {
      if (e && e.key != null && keys.indexOf(e.key) === -1) return;
      if (loadRef.current) loadRef.current();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Filter transactions
  // "transfer" covers both directions; there was no filter for them at all.
  const filteredTransactions = transactions.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'transfer') return t.type === 'transfer_in' || t.type === 'transfer_out';
    return t.type === filter;
  });

  // Get transaction type info
  const getTypeInfo = (type) => {
    const types = {
      buy: { label: 'Buy', color: C3.success, bgColor: 'rgba(34,197,94,0.2)', icon: 'plus' },
      sell: { label: 'Sell', color: C3.error, bgColor: 'rgba(239,68,68,0.2)', icon: 'trendDown' },
      dividend: { label: 'Dividend', color: acc('#3b82f6'), bgColor: 'rgba(59,130,246,0.2)', icon: 'dollar' },
      split: { label: 'Split', color: isDark ? C3.textMutedDark : C3.textMutedLight, bgColor: isDark ? C3.fillDark : C3.fillLight, icon: 'activity' },
      transfer_in: { label: 'Transfer In', color: C3.success, bgColor: 'rgba(34,197,94,0.2)', icon: 'chevronRight' },
      transfer_out: { label: 'Transfer Out', color: C3.error, bgColor: 'rgba(239,68,68,0.2)', icon: 'chevronLeft' }
    };
    return types[type] || { label: type, color: isDark ? C3.textMutedDark : C3.textMutedLight, bgColor: 'rgba(128,128,128,0.2)', icon: 'activity' };
  };

  // Delete transaction
  // A purchase a later sale depends on cannot go: the sale would then have
  // sold shares never bought (Calc.validateDeletion, the forms' rule).
  const handleDelete = async (txId, what) => {
    const tx = transactions.find(t => t.id === txId);
    const problem = tx ? Calc.validateDeletion(Storage.getTransactionsByHolding(tx.holdingId), txId) : null;
    if (problem) { setRowNote({ id: txId, text: problem }); return; }
    setRowNote(null);
    // The rows' Delete buttons as they stand now: after a "yes" the focus goes
    // to the next row's (else the previous row's, else Close). It is put back
    // when the question closes -- before the row is removed -- so going back
    // to the opener only lost it to <body> a moment later.
    const deletes = [...document.querySelectorAll('[data-tx-delete]')];
    const at = deletes.findIndex(b => b.getAttribute('data-tx-delete') === String(txId));
    const neighbour = at === -1 ? null : (deletes[at + 1] || deletes[at - 1] || null);
    const go = await askInPage({
      title: 'Delete this transaction?', text: (what ? what + '. ' : '') + 'This cannot be undone.',
      confirmLabel: 'Delete', danger: true, isDark,
      restoreFocus: (opener, deleting) => {
        if (!deleting && opener && document.contains(opener)) return null;
        return (neighbour && document.contains(neighbour) ? neighbour : null)
          || document.querySelector('[aria-label="Close transaction history"]')
          || document.querySelector('[aria-label="Transaction history"] button');
      },
    });
    if (!go) return;
    Storage.deleteTransaction(txId);
    loadTransactions();
    if (onUpdate) onUpdate();
  };

  // Calculate running totals
  const calculateSummary = () => {
    let totalBought = 0;
    let totalSold = 0;
    let totalDividends = 0;
    let totalFees = 0;

    // In the portfolio currency throughout -- fees too: they were added in the
    // instrument's currency to a total labelled in the portfolio's. A
    // transfer is not money bought or sold and is in neither total.
    transactions.forEach(t => {
      const fx = Calc.num(t.exchangeRate) || 1;
      const amount = Calc.num(t.quantity) * Calc.num(t.price) * fx;
      const fee = Calc.num(t.fees) * fx;
      if (t.type === 'buy') {
        totalBought += amount + fee;
      } else if (t.type === 'sell') {
        totalSold += amount - fee;
      } else if (t.type === 'dividend') {
        const tax = amount * (Calc.num(t.withholdingTaxPercent) / 100);
        totalDividends += amount - tax;
      }
      totalFees += fee;
    });

    return { totalBought, totalSold, totalDividends, totalFees };
  };

  const summary = calculateSummary();

  // A trade date is a calendar day: the same day in every time zone.
  const formatDate = (dateStr) => window.CalendarDate.format(dateStr, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div style={styles.container} {...dialogProps}>
      {askElement}
      {/* Glow Effects */}

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerContent}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onClose} style={styles.iconButton} aria-label="Close transaction history">
              <Icon name="chevronLeft" size={20} />
            </button>
            <div>
              {/* A window over the page: its title is a level-2 heading,
                  not a second H1. */}
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Transaction History</h2>
              <p style={{ ...styles.muted, margin: 0 }}>
                {holding ? (holding.symbol?.split('.')[0] || holding.name) : 'All Transactions'}
              </p>
            </div>
          </div>
          {holding && !gone && (
            <button onClick={() => setShowAddTransaction(true)} style={styles.addButton}>
              + Add
            </button>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <div style={{ padding: 16 }}>
        {gone && (
          <div role="status" data-tx-gone="true" style={{ ...styles.card, fontSize: 14, lineHeight: 1.5 }}>
            This position was deleted in another tab. Its trades are no longer in the portfolio; close this window.
          </div>
        )}
        <div style={styles.card}>
          <h3 style={{ ...styles.muted, marginBottom: 12, marginTop: 0 }}>Summary</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
            <div>
              <div style={styles.muted}>Total Bought</div>
              <div style={{ fontWeight: 600, color: C3.error }}>
                {Calc.formatCurrency(summary.totalBought, baseCurrency)}
              </div>
            </div>
            <div>
              <div style={styles.muted}>Total Sold</div>
              <div style={{ fontWeight: 600, color: C3.success }}>
                {Calc.formatCurrency(summary.totalSold, baseCurrency)}
              </div>
            </div>
            <div>
              <div style={styles.muted}>Dividends (net)</div>
              <div style={{ fontWeight: 600, color: acc('#3b82f6') }}>
                {Calc.formatCurrency(summary.totalDividends, baseCurrency)}
              </div>
            </div>
            <div>
              <div style={styles.muted}>Total Fees</div>
              <div style={{ fontWeight: 600, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                {Calc.formatCurrency(summary.totalFees, baseCurrency)}
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', paddingBottom: 8 }}>
          {[['all', 'All'], ['buy', 'Buy'], ['sell', 'Sell'], ['dividend', 'Dividend'], ['split', 'Split'], ['transfer', 'Transfers']].map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              style={styles.filterButton(filter === f)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Transaction List */}
        {filteredTransactions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Icon name="activity" size={64} color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'} />
            <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: 16 }}>No transactions found</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredTransactions.map(tx => {
              const typeInfo = getTypeInfo(tx.type);
              const holdingInfo = holding || Storage.getHoldingById(tx.holdingId);
              const amount = tx.quantity * tx.price * (tx.exchangeRate || 1);

              return (
                <div key={tx.id} style={styles.card}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: typeInfo.bgColor
                      }}>
                        <Icon name={typeInfo.icon} size={20} color={typeInfo.color} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{typeInfo.label}</div>
                        <div style={styles.muted}>
                          {holdingInfo?.symbol?.split('.')[0] || holdingInfo?.name || 'Unknown'}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>
                        {tx.type === 'split' ? (
                          `${tx.quantity}:1`
                        ) : tx.type === 'dividend' ? (
                          <span style={{ color: acc('#3b82f6') }}>
                            +{Calc.formatCurrency(amount * (1 - (tx.withholdingTaxPercent || 0) / 100), baseCurrency || tx.currency)}
                          </span>
                        ) : (
                          <span style={{ color: tx.type === 'buy' || tx.type === 'transfer_in' ? C3.error : C3.success }}>
                            {tx.type === 'buy' || tx.type === 'transfer_in' ? '-' : '+'}
                            {Calc.formatCurrency(amount, baseCurrency || tx.currency)}
                          </span>
                        )}
                      </div>
                      {/* The amount is converted at the trade's rate into the
                          portfolio's currency; the line below is in the
                          instrument's. "-$34,067.89" was a euro figure under a
                          dollar sign, above "100 x $381.03". */}
                      {tx.type !== 'split' && baseCurrency && tx.currency && tx.currency !== baseCurrency && (
                        <div style={{ ...styles.muted, fontSize: 11 }}>in {baseCurrency}</div>
                      )}
                      <div style={styles.muted}>{formatDate(tx.date)}</div>
                    </div>
                  </div>

                  {/* Transaction Details */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
                    ...styles.muted
                  }}>
                    <div>
                      {tx.type !== 'split' && (
                        <>
                          {Calc.formatQuantity(tx.quantity, holdingInfo || tx.symbol)} × {Calc.formatCurrency(tx.price, tx.currency)}
                          {tx.fees > 0 && ` + ${Calc.formatCurrency(tx.fees, tx.currency)} fees`}
                        </>
                      )}
                      {tx.type === 'dividend' && tx.withholdingTaxPercent > 0 && (
                        <span style={{ color: C3.error }}> ({tx.withholdingTaxPercent}% tax)</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {holdingInfo && (
                        <button
                          onClick={() => setEditing({ tx, holding: holdingInfo })}
                          aria-label={`Edit ${typeInfo.label} of ${tx.date}`}
                          style={{ ...styles.iconButton, padding: 4, color: acc('#3b82f6') }}
                        >
                          <Icon name="edit" size={16} />
                        </button>
                      )}
                      <button
                        data-tx-delete={tx.id}
                        onClick={() => handleDelete(tx.id, `${typeInfo.label} of ${tx.date}`)}
                        aria-label={`Delete ${typeInfo.label} of ${tx.date}`}
                        aria-describedby={rowNote && rowNote.id === tx.id ? 'tx-note-' + tx.id : undefined}
                        style={{
                          ...styles.iconButton,
                          padding: 4,
                          color: C3.error
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </div>
                  {rowNote && rowNote.id === tx.id && (
                    <div id={'tx-note-' + tx.id} role="alert" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: isDark ? C3.error : (C3.errorLight || '#c81e2c') }}>{rowNote.text}</div>
                  )}

                  {/* Notes */}
                  {tx.notes && (
                    <div style={{ marginTop: 8, fontSize: 12, fontStyle: 'italic', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                      {tx.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Transaction Modal: the add form, filled in, saving in place. */}
      {editing && (
        <div style={styles.modalOverlay}>
          {React.createElement(window.AddTransactionModal, {
            holding: editing.holding,
            transaction: editing.tx,
            baseCurrency: baseCurrency,
            apiKey,
            theme: theme,
            onClose: () => setEditing(null),
            onSave: () => {
              setEditing(null);
              loadTransactions();
              if (onUpdate) onUpdate();
            }
          })}
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTransaction && holding && (
        <div style={styles.modalOverlay}>
          {React.createElement(window.AddTransactionModal, {
            holding: holding,
            baseCurrency: baseCurrency,
            apiKey,
            theme: theme,
            onClose: () => setShowAddTransaction(false),
            onSave: () => {
              setShowAddTransaction(false);
              loadTransactions();
              if (onUpdate) onUpdate();
            }
          })}
        </div>
      )}
    </div>
  );
};
