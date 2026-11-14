// Portfolio Tracker - Storage Module
// Handles all localStorage operations for portfolios, holdings, and transactions

/**
 * What comes out of localStorage is not necessarily what we put in: another
 * tab, an extension or a half-finished import can leave a string, an object
 * or nothing where a list belongs. Every read went straight into the views,
 * so one bad key blanked the whole app behind the error boundary. A store
 * that is the wrong shape is treated as empty.
 *
 * The same goes for the elements: `[null, {...}]` passed the Array check and
 * then `h.portfolioId` threw on every render -- and on every reload, so the
 * error panel's advice to reload could not help. An element that is not a record is dropped; the rest survive.
 */
function asArray(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(x => x && typeof x === 'object' && !Array.isArray(x))
      : [];
  } catch (e) { return []; }
}
function asObject(raw, fallback) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : fallback;
  } catch (e) { return fallback; }
}

/**
 * A write that did not happen. `code`:
 *  - 'full': the browser's storage is full (QuotaExceeded) -- the save
 *    functions caught it and returned false, and create/update returned the
 *    record as if saved: "Imported 300 transactions." with 0 or 162 stored;
 *  - 'portfolio-gone': the portfolio was deleted in another tab, and a
 *    position added here went to an id no portfolio has;
 *  - 'changed': the record was changed or deleted in another tab since this
 *    form loaded it, and saving would overwrite that;
 *  - 'blocked': the browser refuses the site's storage altogether.
 */
class PortfolioStorageError extends Error {
  constructor(code, message) { super(message); this.name = 'PortfolioStorageError'; this.code = code; }
}
window.PortfolioStorageError = PortfolioStorageError;
// A write for a position another tab has deleted: Edit Position left open
// in one tab booked "buy 6 @ 500" for a holding that no longer existed, a
// trade nothing would ever show.
const HOLDING_GONE_MESSAGE = 'This position was deleted in another tab. Nothing was saved.';

// A saved list that does not parse ({bad json, a cut-off tail, "null") read
// as an empty portfolio, with no word, and the next write -- one imported
// row -- replaced it: AAPL and MSFT were gone, their trades left without a
// position. Such a key is never written over; the
// tracker shows the recovery panel instead.
const UNREADABLE_MESSAGE = 'Saved portfolio data in this browser cannot be read, so nothing was saved over it. Open Portfolio to download a copy and repair it.';
const UNREADABLE_BACKUP_KEY = 'eodhd_pt_unreadable_backup';

const STORAGE_FULL_MESSAGE = "Your browser's storage for this site is full — nothing was saved. Export a backup and delete old portfolios or transactions, then try again.";
// A browser that refuses the site's storage outright: Firefox with site
// data turned off throws SecurityError on every read. Each read answered
// [] and the tracker drew "Select portfolio", "0 holdings", "Loading
// prices…" for ever, and Add Position said "This portfolio was deleted".
const BLOCKED_MESSAGE = 'This browser blocks site storage, so portfolios cannot be kept here. Allow storage for this site or use another browser.';
let blockedProbe = null;
// Why the last write failed: what localStorage.setItem threw, or null. A
// browser that lets the page read its storage but not write it (setItem
// throws SecurityError) was told its storage was full, and a Delete
// Position closed in silence with the position kept.
let lastWriteError = null;
// Over the quota, in every browser's words: QuotaExceededError (code 22),
// Firefox's NS_ERROR_DOM_QUOTA_REACHED (code 1014).
const isQuotaError = (e) => Boolean(e) && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
  || e.code === 22 || e.code === 1014);

window.PortfolioStorage = {
  StorageError: PortfolioStorageError,
  NAME_MAX: 60,
  // Runs a write and hands a refusal (full storage, a portfolio deleted in
  // another tab) to onError(message) instead of throwing it into a click
  // handler, where it was lost. Returns the write's result, or null when it
  // was refused. The caller says the message in the page, next to what was
  // done: it was the browser's alert() here.
  attempt(write, onError) {
    try { return write(); } catch (e) {
      if (e && e.name === 'PortfolioStorageError') {
        // The error rides along for a caller that shows a card.
        if (typeof onError === 'function') onError(e.message, e);
        else console.warn('[PortfolioStorage]', e.message);
        return null;
      }
      throw e;
    }
  },

  // Nothing is refused here in a standalone app (shell/shims.js).
  _freeLimit() {},
  // Whether the browser refuses this site's storage (any read throws, or
  // there is no localStorage at all; storageGuard.js, first in the
  // bundle, puts a store kept only for the page in its place and says so).
  // Asked once a page: allowing storage takes a reload.
  storageBlocked() {
    if (blockedProbe == null) {
      if (window.STORAGE_BLOCKED === true) blockedProbe = true;
      else {
        try { window.localStorage.getItem(this.KEYS.PORTFOLIOS); blockedProbe = false; } catch (e) { blockedProbe = true; }
      }
    }
    return blockedProbe;
  },
  BLOCKED_MESSAGE,
  // Every write says why it cannot happen, rather than a portfolio or a
  // position "deleted in another tab".
  _refuseBlocked() {
    if (this.storageBlocked()) throw new PortfolioStorageError('blocked', BLOCKED_MESSAGE);
  },
  // The refusal of a write that failed (a save that returned false): 'full'
  // when the browser said its quota was reached, 'blocked' when it refused
  // the write for any other reason. Taken once: the next failure says its own.
  _writeRefused() {
    const e = lastWriteError;
    lastWriteError = null;
    if (e && !isQuotaError(e)) return new PortfolioStorageError('blocked', BLOCKED_MESSAGE);
    return new PortfolioStorageError('full', STORAGE_FULL_MESSAGE);
  },
  // Storage keys
  KEYS: {
    PORTFOLIOS: 'eodhd_pt_portfolios',
    HOLDINGS: 'eodhd_pt_holdings',
    TRANSACTIONS: 'eodhd_pt_transactions',
    SETTINGS: 'eodhd_pt_settings',
    GAMIFICATION: 'eodhd_pt_gamification',
    FOREX_CACHE: 'eodhd_pt_forex_cache',
    REFERRALS: 'eodhd_referrals'
  },

  // ==================== UTILITIES ====================

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  },

  getTimestamp() {
    return new Date().toISOString();
  },

  // ==================== PORTFOLIOS ====================

  getPortfolios() {
    try {
      const data = localStorage.getItem(this.KEYS.PORTFOLIOS);
      return asArray(data);
    } catch (e) {
      // A blocked store is said once, by the tracker; not on every read.
      if (!this.storageBlocked()) console.error('Error loading portfolios:', e);
      return [];
    }
  },

  savePortfolios(portfolios) {
    this._refuseUnreadable(this.KEYS.PORTFOLIOS);
    lastWriteError = null;
    try {
      localStorage.setItem(this.KEYS.PORTFOLIOS, JSON.stringify(portfolios));
      window.DataSync?.pushSection('pt_portfolios', portfolios);
      return true;
    } catch (e) {
      lastWriteError = e;
      console.error('Error saving portfolios:', e);
      return false;
    }
  },

  _portfolioRecord(data) {
    return {
      id: this.generateId(),
      name: data.name || 'My Portfolio',
      icon: data.icon || 'barChart',
      color: data.color || '#f97316', // orange
      baseCurrency: data.baseCurrency || 'USD',
      goal: data.goal || null,
      createdAt: this.getTimestamp(),
      updatedAt: this.getTimestamp()
    };
  },

  createPortfolio(data) {
    this._refuseBlocked();
    const portfolio = this._portfolioRecord(data);

    const portfolios = this.getPortfolios();
    this._freeLimit('portfolios', () => portfolios.length + 1);
    portfolios.push(portfolio);
    // A full storage is said, not passed off as saved.
    if (!this.savePortfolios(portfolios)) throw this._writeRefused();
    return portfolio;
  },

  /**
   * A new portfolio with its positions, all of them or none: a template, a
   * fund, an AI-built portfolio, an index. Throws what the failed write threw.
   */
  // The portfolio first, then its positions in one write (_writeInOrder): a
  // write per position, refused part way with the take-back refused too,
  // left a portfolio with some of them under "nothing was created". Now the most that can be left is the portfolio without
  // its positions, said, and shown.
  createPortfolioWithHoldings(data, holdings) {
    const list = Array.isArray(holdings) ? holdings : [];
    this._freeLimit('portfolios', () => this.getPortfolios().length + 1);
    this._freeLimit('positions', () => list.length);
    if (!list.length) return this.createPortfolio(data);
    this._refuseBlocked();
    const portfolio = this._portfolioRecord(data);
    const made = list.map(h => this._holdingRecord({ ...h, portfolioId: portfolio.id }));
    const portfolios = this.getPortfolios().concat([portfolio]);
    const failed = this._writeInOrder([
      { key: this.KEYS.PORTFOLIOS, save: () => this.savePortfolios(portfolios) },
      { key: this.KEYS.HOLDINGS, save: () => this.saveHoldings(this.getHoldings().concat(made)) },
    ]);
    if (failed) {
      throw this._stopped(failed, () => `"${portfolio.name}" was created, but its ${made.length} position${made.length === 1 ? '' : 's'} could not be: `);
    }
    return portfolio;
  },

  updatePortfolio(id, updates) {
    const portfolios = this.getPortfolios();
    const index = portfolios.findIndex(p => p.id === id);
    if (index === -1) return null;

    const next = {
      ...portfolios[index],
      ...updates,
      updatedAt: this.getTimestamp()
    };
    // A portfolio the repair made becomes the user's once they name it.
    if (next.recovered && typeof updates.name === 'string' && updates.name !== portfolios[index].name) delete next.recovered;
    portfolios[index] = next;
    if (!this.savePortfolios(portfolios)) throw this._writeRefused();
    return portfolios[index];
  },

  // The lists a delete writes, as they were before it: put back when a later
  // write of the same delete is refused, so a refused delete leaves nothing
  // half done (a portfolio gone with its positions kept).
  _listsBefore() {
    const out = {};
    [this.KEYS.PORTFOLIOS, this.KEYS.HOLDINGS, this.KEYS.TRANSACTIONS].forEach((k) => {
      try { out[k] = localStorage.getItem(k); } catch (e) { out[k] = undefined; }
    });
    return out;
  },
  // Only the lists this change wrote (`written`): putting back all three
  // rewrote, and pushed, a list it never touched -- a portfolio another tab
  // added meanwhile was erased. The account is told
  // too, as the write that went through was pushed (DataSync, debounced):
  // only a list that reads as one, never a stand-in -- an unreadable one
  // went out as [] and emptied the account's.
  // In the order given, and no further than the first one refused: the
  // lists after it would be put back over one that was not, a position's
  // trades without the position. Returns the lists left as written. It
  // returned nothing, and a put-back the browser refused as well left a
  // half-done change that the screen did not show.
  _putBack(before, written) {
    const sections = { [this.KEYS.PORTFOLIOS]: 'pt_portfolios', [this.KEYS.HOLDINGS]: 'pt_holdings', [this.KEYS.TRANSACTIONS]: 'pt_transactions' };
    const list = written || [];
    for (let i = 0; i < list.length; i++) {
      const k = list[i];
      const v = before[k];
      if (v === undefined || !sections[k]) continue;
      try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return list.slice(i); }
      let parsed = null;
      try { parsed = v == null ? null : JSON.parse(v); } catch (e) { parsed = null; }
      if (Array.isArray(parsed)) window.DataSync?.pushSection(sections[k], parsed);
    }
    return [];
  },

  // The writes of one change, each { key, save }, in an order that leaves
  // something the app can show after any of them: a delete writes the
  // trades first, then the positions, then the portfolio; a create the
  // other way round. A refused write puts back the ones before it, the
  // last first (_putBack). Null when all went through, else { refused,
  // kept }: the refusal (_writeRefused) and the lists still as written.
  // Every list the change writes is checked before the first write, and a
  // save that throws is put back like one that answers false: with the
  // portfolios list unreadable under an open delete question, the trades
  // and positions went and savePortfolios() then threw "nothing was saved
  // over it". A throw that is not a refusal of storage is
  // thrown on once what it left is put back.
  _writeInOrder(steps) {
    for (const s of steps) this._refuseUnreadable(s.key);
    const before = this._listsBefore();
    const written = [];
    for (const s of steps) {
      let ok = false;
      let thrown = null;
      try { ok = s.save(); } catch (e) { thrown = e; }
      if (thrown || !ok) {
        const refused = thrown || this._writeRefused();
        const kept = this._putBack(before, written.slice().reverse());
        // Nothing left changed: thrown on, said by the caller as before.
        if (thrown && (thrown.name !== 'PortfolioStorageError' || !kept.length)) throw thrown;
        return { refused, kept };
      }
      written.push(s.key);
    }
    return null;
  },
  // The refusal to throw when a change stopped: as it was when nothing is
  // left changed; when a put-back was refused too, what is stored now --
  // `said(kept)`, the first half of the sentence -- and why, and the screen
  // is told to read the lists again (what it shows is what is stored).
  _stopped(failed, said) {
    if (!failed.kept.length) return failed.refused;
    const code = failed.refused.code;
    const why = code === 'blocked'
      ? 'this browser blocks site storage, so portfolios cannot be kept here. Allow storage for this site or use another browser.'
      : code === 'full' ? "your browser's storage for this site is full. Export a backup and delete old portfolios or transactions, then try again."
        : String(failed.refused.message || '').replace(/^./, c => c.toLowerCase());
    const e = new PortfolioStorageError(failed.refused.code, said(failed.kept) + why);
    e.partial = true;
    try { window.dispatchEvent(new CustomEvent('portfolio:storage-partial')); } catch (_) { /* a courtesy */ }
    return e;
  },

  // A refused write is said (_writeRefused) and nothing is deleted. It
  // returned true whatever the writes did.
  // The trades first, then the positions, then the portfolio: refused part
  // way with the put-back refused too, it left positions without a
  // portfolio and trades without a position, which no screen shows, and the
  // portfolio came back with them gone after a reload.
  deletePortfolio(id) {
    const P = this.KEYS.PORTFOLIOS, H = this.KEYS.HOLDINGS, T = this.KEYS.TRANSACTIONS;
    this._refuseUnreadableAll([P, H, T]);
    const portfolios = this.getPortfolios();
    const filtered = portfolios.filter(p => p.id !== id);
    // The ids are read before anything is written.
    const allHoldings = this.getHoldings();
    const holdingIds = allHoldings.filter(h => h.portfolioId === id).map(h => h.id);
    const holdings = allHoldings.filter(h => h.portfolioId !== id);
    const allTransactions = this.getTransactions();
    const transactions = allTransactions.filter(t => !holdingIds.includes(t.holdingId));
    const nTx = allTransactions.length - transactions.length;
    const nPos = allHoldings.length - holdings.length;
    // Each list written only when it changes.
    const steps = [];
    if (nTx) steps.push({ key: T, save: () => this.saveTransactions(transactions) });
    if (nPos) steps.push({ key: H, save: () => this.saveHoldings(holdings) });
    steps.push({ key: P, save: () => this.savePortfolios(filtered) });
    const failed = this._writeInOrder(steps);
    if (failed) {
      throw this._stopped(failed, kept => (kept.includes(H)
        ? `Its ${nPos} position${nPos === 1 ? ' was' : 's were'} deleted${nTx ? ' with their trades' : ''}, but the portfolio itself could not be: `
        : `The trades of its positions (${nTx}) were deleted, but the positions and the portfolio could not be: `));
    }
    return true;
  },

  getPortfolioById(id) {
    return this.getPortfolios().find(p => p.id === id) || null;
  },

  // ==================== HOLDINGS ====================

  getHoldings() {
    try {
      const data = localStorage.getItem(this.KEYS.HOLDINGS);
      // Text fields are text: one holding stored with `symbol: 12345` threw
      // "(h.symbol || "").split is not a function" on every render, and only
      // "Reset all" got the app back.
      const text = (v) => (v == null ? null : typeof v === 'string' ? v : (typeof v === 'number' || typeof v === 'boolean') ? String(v) : null);
      return asArray(data).map(h => (
        (h.symbol == null || typeof h.symbol === 'string') && (h.name == null || typeof h.name === 'string')
          ? h : { ...h, symbol: text(h.symbol), name: text(h.name) }
      ));
    } catch (e) {
      // A blocked store is said once, by the tracker; not on every read.
      if (!this.storageBlocked()) console.error('Error loading holdings:', e);
      return [];
    }
  },

  saveHoldings(holdings) {
    this._refuseUnreadable(this.KEYS.HOLDINGS);
    lastWriteError = null;
    try {
      localStorage.setItem(this.KEYS.HOLDINGS, JSON.stringify(holdings));
      window.DataSync?.pushSection('pt_holdings', holdings);
      return true;
    } catch (e) {
      lastWriteError = e;
      console.error('Error saving holdings:', e);
      return false;
    }
  },

  getHoldingsByPortfolio(portfolioId) {
    return this.getHoldings().filter(h => h.portfolioId === portfolioId);
  },

  // One listing however it was written: a legacy "AAPL" is AAPL.US and case
  // does not count -- the importer's reading (Calc.importSymbolGuess). Null
  // for no symbol (a manual asset).
  listingKey(symbol) {
    if (typeof symbol !== 'string' || !symbol.trim()) return null;
    const Calc = window.PortfolioCalculations;
    const guess = Calc && typeof Calc.importSymbolGuess === 'function' ? Calc.importSymbolGuess(symbol) : null;
    return (guess || symbol.trim()).toUpperCase();
  },

  // The portfolio's holding of `symbol`'s listing, or null.
  holdingOf(portfolioId, symbol) {
    const key = this.listingKey(symbol);
    if (!key) return null;
    return this.getHoldingsByPortfolio(portfolioId).find(h => this.listingKey(h.symbol) === key) || null;
  },

  _holdingRecord(data) {
    return {
      id: this.generateId(),
      portfolioId: data.portfolioId,
      type: data.type || 'stock', // stock, etf, crypto, forex, bond, manual
      symbol: data.symbol || null,
      name: data.name || null,
      manualPrice: data.manualPrice || null,
      manualPriceDate: data.manualPriceDate || null,
      currency: data.currency || 'USD',
      sector: data.sector || null,
      notes: data.notes || '',
      createdAt: this.getTimestamp()
    };
  },

  // New positions of one portfolio in one write (an import's): the records,
  // or a throw as createHolding throws.
  createHoldings(list) {
    this._refuseBlocked();
    const items = Array.isArray(list) ? list : [];
    if (!items.length) return [];
    const pid = items[0].portfolioId;
    if (!pid || !this.getPortfolios().some(p => p.id === pid)) {
      throw new PortfolioStorageError('portfolio-gone', 'This portfolio was deleted (perhaps in another tab). Reload the page and pick a portfolio.');
    }
    const fresh = items.filter(d => !this.holdingOf(pid, d.symbol));
    this._freeLimit('positions', () => (fresh.length ? this.getHoldingsByPortfolio(pid).length + fresh.length : 0));
    const made = items.map(d => this._holdingRecord({ ...d, portfolioId: pid }));
    if (!this.saveHoldings(this.getHoldings().concat(made))) throw this._writeRefused();
    return made;
  },

  createHolding(data) {
    this._refuseBlocked();
    // Only into a portfolio that exists now, in storage -- not in this tab's
    // memory of it.
    if (!data.portfolioId || !this.getPortfolios().some(p => p.id === data.portfolioId)) {
      throw new PortfolioStorageError('portfolio-gone', 'This portfolio was deleted (perhaps in another tab). Reload the page and pick a portfolio.');
    }
    // A name the portfolio already holds is not a new position.
    this._freeLimit('positions', () => (this.holdingOf(data.portfolioId, data.symbol)
      ? 0 : this.getHoldingsByPortfolio(data.portfolioId).length + 1));
    const holding = this._holdingRecord(data);

    const holdings = this.getHoldings();
    holdings.push(holding);
    if (!this.saveHoldings(holdings)) throw this._writeRefused();
    return holding;
  },

  updateHolding(id, updates) {
    this._refuseBlocked();
    const holdings = this.getHoldings();
    const index = holdings.findIndex(h => h.id === id);
    if (index === -1) throw new PortfolioStorageError('gone', HOLDING_GONE_MESSAGE);

    holdings[index] = { ...holdings[index], ...updates };
    if (!this.saveHoldings(holdings)) throw this._writeRefused();
    return holdings[index];
  },

  // A refused write is said and the position stays, its trades with it: Edit
  // -> Delete Position closed in silence over a write the browser refused,
  // and the position was still there after a reload.
  // Its trades first, then the position (_writeInOrder): the position went
  // first, and a refusal of the rest with its put-back refused left the
  // trades without it -- shown on screen, gone after a reload. Now the most that can be left is the position without
  // its trades, said, and shown.
  deleteHolding(id) {
    const H = this.KEYS.HOLDINGS, T = this.KEYS.TRANSACTIONS;
    this._refuseUnreadableAll([H, T]);
    const holdings = this.getHoldings();
    const filtered = holdings.filter(h => h.id !== id);
    // The trades written only when there are some: a position just made and
    // taken back (a refused import) has none, and rewriting the list
    // unchanged could only fail it.
    const all = this.getTransactions();
    const transactions = all.filter(t => t.holdingId !== id);
    const n = all.length - transactions.length;
    const steps = [];
    if (n) steps.push({ key: T, save: () => this.saveTransactions(transactions) });
    steps.push({ key: H, save: () => this.saveHoldings(filtered) });
    const failed = this._writeInOrder(steps);
    if (failed) {
      throw this._stopped(failed, () => `Its ${n} trade${n === 1 ? ' was' : 's were'} deleted, but the position itself could not be: `);
    }
    return true;
  },

  // Positions the change just made, taken back in one write (a refused
  // import's): true, or the refusal (_stopped) naming them when the browser
  // refused that as well -- they stay, without trades, and are shown.
  takeBackHoldings(ids) {
    const gone = new Set(ids || []);
    if (!gone.size) return true;
    const holdings = this.getHoldings();
    const named = holdings.filter(h => gone.has(h.id)).map(h => String(h.symbol || h.name || '').trim()).filter(Boolean);
    if (!named.length && !holdings.some(h => gone.has(h.id))) return true;
    const failed = this._writeInOrder([{ key: this.KEYS.HOLDINGS, save: () => this.saveHoldings(holdings.filter(h => !gone.has(h.id))) }]);
    if (!failed) return true;
    const n = gone.size;
    // Nothing was written to put back: kept is empty, and the positions stay
    // as they were made. Said as that.
    return this._stopped({ refused: failed.refused, kept: [this.KEYS.HOLDINGS] },
      () => `No trades were imported, and the ${n} new position${n === 1 ? '' : 's'} the import made (${named.join(', ')}) could not be taken back, so ${n === 1 ? 'it stays' : 'they stay'} without trades: `);
  },

  getHoldingById(id) {
    return this.getHoldings().find(h => h.id === id) || null;
  },

  // ==================== TRANSACTIONS ====================

  getTransactions() {
    try {
      const data = localStorage.getItem(this.KEYS.TRANSACTIONS);
      return asArray(data);
    } catch (e) {
      // A blocked store is said once, by the tracker; not on every read.
      if (!this.storageBlocked()) console.error('Error loading transactions:', e);
      return [];
    }
  },

  saveTransactions(transactions) {
    this._refuseUnreadable(this.KEYS.TRANSACTIONS);
    lastWriteError = null;
    try {
      localStorage.setItem(this.KEYS.TRANSACTIONS, JSON.stringify(transactions));
      window.DataSync?.pushSection('pt_transactions', transactions);
      return true;
    } catch (e) {
      lastWriteError = e;
      console.error('Error saving transactions:', e);
      return false;
    }
  },

  getTransactionsByHolding(holdingId) {
    return this.getTransactions()
      .filter(t => t.holdingId === holdingId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  getTransactionsByPortfolio(portfolioId) {
    const holdingIds = this.getHoldingsByPortfolio(portfolioId).map(h => h.id);
    return this.getTransactions()
      .filter(t => holdingIds.includes(t.holdingId))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  },

  createTransaction(data) {
    this._refuseBlocked();
    if (data && data.holdingId && !this.getHoldingById(data.holdingId)) throw new PortfolioStorageError('gone', HOLDING_GONE_MESSAGE);
    const transaction = {
      id: this.generateId(),
      holdingId: data.holdingId,
      type: data.type || 'buy', // buy, sell, dividend, split, transfer_in, transfer_out
      date: data.date || (window.CalendarDate ? window.CalendarDate.today() : this.getTimestamp().split('T')[0]),
      quantity: parseFloat(data.quantity) || 0,
      price: parseFloat(data.price) || 0,
      fees: parseFloat(data.fees) || 0,
      currency: data.currency || 'USD',
      exchangeRate: parseFloat(data.exchangeRate) || 1,
      withholdingTaxPercent: data.withholdingTaxPercent || null,
      notes: data.notes || '',
      createdAt: this.getTimestamp()
    };

    const transactions = this.getTransactions();
    transactions.push(transaction);
    if (!this.saveTransactions(transactions)) throw this._writeRefused();
    return transaction;
  },

  /**
   * Many transactions in one write: all of them or none. An import wrote one
   * row at a time, each rewriting the whole list, and stopped silently half
   * way when storage filled up.
   */
  createTransactions(list) {
    // Every position the rows go to must still exist: an import that waited
    // for a close (a transfer in with no price) booked "transfer_in 2" for a
    // MSFT deleted meanwhile in another tab -- a trade nothing shows.
    // Nothing is written then.
    this._refuseBlocked();
    const ids = new Set(this.getHoldings().map(h => h.id));
    if ((list || []).some(data => data && data.holdingId && !ids.has(data.holdingId))) throw new PortfolioStorageError('gone', HOLDING_GONE_MESSAGE);
    const made = (list || []).map(data => ({
      id: this.generateId(),
      holdingId: data.holdingId,
      type: data.type || 'buy',
      date: data.date || (window.CalendarDate ? window.CalendarDate.today() : this.getTimestamp().split('T')[0]),
      quantity: parseFloat(data.quantity) || 0,
      price: parseFloat(data.price) || 0,
      fees: parseFloat(data.fees) || 0,
      currency: data.currency || 'USD',
      exchangeRate: parseFloat(data.exchangeRate) || 1,
      withholdingTaxPercent: data.withholdingTaxPercent || null,
      notes: data.notes || '',
      createdAt: this.getTimestamp()
    }));
    if (!made.length) return made;
    if (!this.saveTransactions(this.getTransactions().concat(made))) throw this._writeRefused();
    return made;
  },

  /**
   * `baseline`: the record as the form that edits it loaded it. When given,
   * the save is refused if the stored record no longer matches -- it was
   * changed or deleted in another tab, and writing every form field back
   * silently undid that change.
   */
  updateTransaction(id, updates, baseline) {
    this._refuseBlocked();
    const transactions = this.getTransactions();
    const index = transactions.findIndex(t => t.id === id);
    if (index === -1) {
      if (baseline) throw new PortfolioStorageError('changed', 'This transaction was deleted in another tab. Close this form and reload.');
      return null;
    }
    if (baseline && JSON.stringify(transactions[index]) !== JSON.stringify(baseline)) {
      throw new PortfolioStorageError('changed', 'This transaction was changed in another tab since you opened it. Close this form and open it again to see the current version.');
    }
    // Its position, or the one it is moved to, deleted in another tab.
    const target = (updates && updates.holdingId) || transactions[index].holdingId;
    if (target && !this.getHoldingById(target)) throw new PortfolioStorageError('gone', HOLDING_GONE_MESSAGE);

    transactions[index] = { ...transactions[index], ...updates };
    if (!this.saveTransactions(transactions)) throw this._writeRefused();
    return transactions[index];
  },

  deleteTransaction(id) {
    const transactions = this.getTransactions();
    const filtered = transactions.filter(t => t.id !== id);
    if (!this.saveTransactions(filtered)) throw this._writeRefused();
    return true;
  },

  // ==================== SETTINGS ====================

  getSettings() {
    try {
      const data = localStorage.getItem(this.KEYS.SETTINGS);
      return asObject(data, this.getDefaultSettings());
    } catch (e) {
      console.error('Error loading settings:', e);
      return this.getDefaultSettings();
    }
  },

  getDefaultSettings() {
    return {
      gamificationEnabled: true,
      baseCurrency: 'USD',
      theme: 'dark',
      notifications: {
        dividends: true,
        earnings: true,
        insiderActivity: true,
        indexChanges: true,
        goalProgress: true
      }
    };
  },

  saveSettings(settings) {
    lastWriteError = null;
    try {
      localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify(settings));
      window.DataSync?.pushSection('pt_settings', settings);
      return true;
    } catch (e) {
      lastWriteError = e;
      console.error('Error saving settings:', e);
      return false;
    }
  },

  updateSettings(updates) {
    const settings = this.getSettings();
    const newSettings = { ...settings, ...updates };
    this.saveSettings(newSettings);
    return newSettings;
  },

  // ==================== GAMIFICATION ====================

  getGamification() {
    try {
      const data = localStorage.getItem(this.KEYS.GAMIFICATION);
      return asObject(data, this.getDefaultGamification());
    } catch (e) {
      console.error('Error loading gamification:', e);
      return this.getDefaultGamification();
    }
  },

  getDefaultGamification() {
    return {
      xp: 0,
      level: 1,
      achievements: [],
      streaks: {
        savingsStreak: 0,
        learningStreak: 0
      },
      lastActivityDate: null
    };
  },

  saveGamification(gamification) {
    try {
      localStorage.setItem(this.KEYS.GAMIFICATION, JSON.stringify(gamification));
      window.DataSync?.pushSection('pt_gamification', gamification);
      return true;
    } catch (e) {
      console.error('Error saving gamification:', e);
      return false;
    }
  },

  addXP(amount) {
    const gam = this.getGamification();
    gam.xp += amount;
    gam.level = this.calculateLevel(gam.xp);
    gam.lastActivityDate = this.getTimestamp().split('T')[0];
    this.saveGamification(gam);
    return gam;
  },

  calculateLevel(xp) {
    const levels = [0, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (let i = levels.length - 1; i >= 0; i--) {
      if (xp >= levels[i]) return i + 1;
    }
    return 1;
  },

  unlockAchievement(achievementId) {
    const gam = this.getGamification();
    if (!gam.achievements.includes(achievementId)) {
      gam.achievements.push(achievementId);
      this.saveGamification(gam);
      return true;
    }
    return false;
  },

  // ==================== FOREX CACHE ====================

  // A cache of the right shape, whatever is stored. `{"rates":null}` made
  // cache.rates[key] throw inside the price load, an unhandled rejection
  // that left every total at "…" for good.
  getForexCache() {
    const empty = () => ({ rates: {}, stamps: {}, updatedAt: null });
    try {
      const data = localStorage.getItem(this.KEYS.FOREX_CACHE);
      const cache = asObject(data, empty());
      const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
      return {
        rates: isMap(cache.rates) ? cache.rates : {},
        stamps: isMap(cache.stamps) ? cache.stamps : {},
        updatedAt: typeof cache.updatedAt === 'string' ? cache.updatedAt : null,
      };
    } catch (e) {
      console.error('Error loading forex cache:', e);
      return empty();
    }
  },

  saveForexCache(rates) {
    try {
      const now = this.getTimestamp();
      const stamps = {};
      Object.keys(rates || {}).forEach(k => { stamps[k] = now; });
      const cache = {
        rates,
        stamps,
        updatedAt: now
      };
      localStorage.setItem(this.KEYS.FOREX_CACHE, JSON.stringify(cache));
      return true;
    } catch (e) {
      console.error('Error saving forex cache:', e);
      return false;
    }
  },

  FOREX_TTL_MS: 15 * 60 * 1000,

  /** Older than 15 minutes, missing, unreadable, or dated in the future. */
  _stale(stamp) {
    const t = stamp ? new Date(stamp).getTime() : NaN;
    if (!Number.isFinite(t)) return true;
    const age = Date.now() - t;
    return age > this.FOREX_TTL_MS || age < -5 * 60 * 1000;
  },

  // Check if forex cache is stale (older than 15 minutes)
  isForexCacheStale() {
    return this._stale(this.getForexCache().updatedAt);
  },

  // Each pair carries its own time. One shared timestamp meant refreshing
  // any pair marked every cached pair fresh for another 15 minutes, so an
  // old EURUSD could keep valuing holdings. A pair written
  // before per-pair times existed has none and is fetched again.
  // `allowStale` is for a caller that says so on screen ("using the last
  // known rate") when a fresh one cannot be had.
  getCachedForexRate(fromCurrency, toCurrency, allowStale) {
    if (fromCurrency === toCurrency) return 1;

    const cache = this.getForexCache();
    const key = `${fromCurrency}${toCurrency}`;
    if (!allowStale && this._stale(cache.stamps[key])) return null;
    return cache.rates[key] || null;
  },

  setCachedForexRate(fromCurrency, toCurrency, rate) {
    try {
      const cache = this.getForexCache();
      const key = `${fromCurrency}${toCurrency}`;
      const now = this.getTimestamp();
      cache.rates[key] = rate;
      cache.stamps[key] = now;
      cache.updatedAt = now;
      localStorage.setItem(this.KEYS.FOREX_CACHE, JSON.stringify(cache));
    } catch (e) { /* a full or blocked store only costs a refetch */ }
  },

  // ==================== REFERRALS ====================

  getReferrals() {
    try {
      const data = localStorage.getItem(this.KEYS.REFERRALS);
      return asObject(data, { count: 0, shares: 0, lastShareDate: null });
    } catch (e) {
      console.error('Error loading referrals:', e);
      return { count: 0, shares: 0, lastShareDate: null };
    }
  },

  saveReferrals(referrals) {
    try {
      localStorage.setItem(this.KEYS.REFERRALS, JSON.stringify(referrals));
      return true;
    } catch (e) {
      console.error('Error saving referrals:', e);
      return false;
    }
  },

  // Track when user shares referral link
  trackReferralShare() {
    const refs = this.getReferrals();
    refs.shares = (refs.shares || 0) + 1;
    refs.lastShareDate = this.getTimestamp();
    this.saveReferrals(refs);

    // Award XP for sharing
    this.addXP(5);

    // Check for share achievements
    this.checkReferralAchievements(refs);

    return refs;
  },

  // Add confirmed referral (manual or via callback)
  addReferral() {
    const refs = this.getReferrals();
    refs.count = (refs.count || 0) + 1;
    this.saveReferrals(refs);

    // Award XP for successful referral
    this.addXP(100);

    // Check achievements
    this.checkReferralAchievements(refs);

    return refs;
  },

  checkReferralAchievements(refs) {
    const achievements = [];

    // First share
    if (refs.shares >= 1) {
      if (this.unlockAchievement('first_share')) {
        this.addXP(25);
        achievements.push('first_share');
      }
    }

    // Share enthusiast (10 shares)
    if (refs.shares >= 10) {
      if (this.unlockAchievement('share_enthusiast')) {
        this.addXP(50);
        achievements.push('share_enthusiast');
      }
    }

    // First referral
    if (refs.count >= 1) {
      if (this.unlockAchievement('first_referral')) {
        this.addXP(100);
        achievements.push('first_referral');
      }
    }

    // 5 referrals
    if (refs.count >= 5) {
      if (this.unlockAchievement('influencer')) {
        this.addXP(250);
        achievements.push('influencer');
      }
    }

    // 10 referrals
    if (refs.count >= 10) {
      if (this.unlockAchievement('ambassador')) {
        this.addXP(500);
        achievements.push('ambassador');
      }
    }

    return achievements;
  },

  // ==================== INITIALIZATION ====================

  /**
   * Holdings whose portfolio is not in the list are invisible: the views ask
   * for holdings by portfolio id. That is the state an account was left in
   * when a default "My Portfolio" created before the load-time pull replaced
   * the real one on the server: the holdings were still
   * there, pointing at an id no portfolio had. Run on every load, this puts
   * them back where they can be seen:
   *
   *   1. the missing portfolio is in the server's copy (or this browser's own
   *      copy from just before the pull) -- restore that record as it was;
   *   2. everything else goes to ONE place: the account's only portfolio when
   *      it has exactly one and holds none of the same names, otherwise a
   *      single "Recovered positions" made for the purpose.
   *
   * Only what this repair made is ever its own to fold: a portfolio carries
   * `recovered: true` when this code created it. It used to go by name, so a
   * portfolio the user had called "Recovered portfolio" was folded into
   * another on the next load and a trade identical to one already there was
   * dropped as a duplicate -- 20 AAPL became 10. Nothing is
   * dropped now: a lost holding of a name the target already holds joins it
   * with all of its trades. Returns what it did.
   */
  RECOVERED_NAME: 'Recovered positions',

  repairOrphans() {
    // Nothing is judged from a list that cannot be read: an unreadable
    // portfolios list read as none, and every position as one without a
    // portfolio. The tracker shows the recovery panel for it instead.
    if (this._anyUnreadable([this.KEYS.PORTFOLIOS, this.KEYS.HOLDINGS, this.KEYS.TRANSACTIONS])) {
      return { restored: [], reattached: 0, recreated: [], merged: 0 };
    }
    const portfolios = this.getPortfolios();
    const holdings = this.getHoldings();
    const known = new Set(portfolios.map(p => p.id));
    const orphanIds = [...new Set(holdings
      .filter(h => h.portfolioId && !known.has(h.portfolioId))
      .map(h => h.portfolioId))];
    const result = { restored: [], reattached: 0, recreated: [], merged: 0 };

    const sync = window.DataSync || {};
    const fromServer = Array.isArray(sync._serverPortfolios) ? sync._serverPortfolios : [];
    const fromLocal = Array.isArray(sync._localPortfoliosBeforePull) ? sync._localPortfoliosBeforePull : [];
    const isRecord = (p) => p && typeof p === 'object' && typeof p.id === 'string';
    const findIn = (list, id) => list.find(p => isRecord(p) && p.id === id) || null;

    const lost = [];
    orphanIds.forEach(id => {
      const found = findIn(fromServer, id) || findIn(fromLocal, id);
      if (found) { portfolios.push({ ...found }); known.add(id); result.restored.push(id); }
      else lost.push(id);
    });

    const isRecovered = (p) => p && p.recovered === true;
    const recovered = portfolios.filter(isRecovered);
    const real = portfolios.filter(p => !isRecovered(p));
    const needsWork = lost.length > 0 || recovered.length > 1;
    if (!needsWork) {
      if (result.restored.length) this.savePortfolios(portfolios);
      return result;
    }

    const lostSet = new Set(lost);
    const symbolKey = (h) => (h.symbol ? `${h.type}|${h.symbol}` : null);
    const heldIn = (pid) => new Set(holdings.filter(h => h.portfolioId === pid).map(symbolKey).filter(Boolean));

    let target;
    if (!recovered.length && real.length === 1) {
      // The only portfolio takes them, unless it already holds one of the
      // names: two histories of one symbol are not merged into the user's own
      // portfolio behind their back.
      const own = heldIn(real[0].id);
      const clash = holdings.some(h => lostSet.has(h.portfolioId) && symbolKey(h) && own.has(symbolKey(h)));
      if (!clash) target = real[0];
    }
    if (!target && recovered.length) target = recovered[0];
    // One left from before the flag existed: put new orphans there rather than
    // open a second portfolio of the same name beside it.
    // It is not flagged or merged with anything -- nothing in it tells a
    // portfolio this repair made from one the user named so.
    if (!target) {
      const named = real.find(p => p.name === this.RECOVERED_NAME);
      const own = named ? heldIn(named.id) : null;
      const clash = own && holdings.some(h => lostSet.has(h.portfolioId) && symbolKey(h) && own.has(symbolKey(h)));
      if (named && !clash) target = named;
    }
    if (!target) {
      const now = this.getTimestamp();
      target = {
        id: lost[0], name: this.RECOVERED_NAME, icon: 'barChart', color: '#f97316',
        baseCurrency: 'USD', goal: null, createdAt: now, updatedAt: now, recovered: true,
      };
      portfolios.push(target);
      result.recreated.push(target.id);
    }

    const folded = new Set(recovered.filter(p => p.id !== target.id).map(p => p.id));
    const moving = new Set([...lost.filter(id => id !== target.id), ...folded]);

    // Move the holdings; one holding per symbol in the target, every trade kept.
    const bySymbol = new Map();
    holdings.forEach(h => {
      if (h.portfolioId === target.id && symbolKey(h)) bySymbol.set(symbolKey(h), h);
    });
    const remap = new Map();       // dropped holding id -> kept holding id
    const nextHoldings = [];
    holdings.forEach(h => {
      if (!moving.has(h.portfolioId)) { nextHoldings.push(h); return; }
      result.reattached++;
      const twin = symbolKey(h) ? bySymbol.get(symbolKey(h)) : null;
      if (twin && twin.id !== h.id) { remap.set(h.id, twin.id); return; }
      const moved = { ...h, portfolioId: target.id };
      if (symbolKey(moved)) bySymbol.set(symbolKey(moved), moved);
      nextHoldings.push(moved);
    });

    let txChanged = false;
    let nextTx = null;
    if (remap.size) {
      nextTx = this.getTransactions().map(t => {
        if (!remap.has(t.holdingId)) return t;
        txChanged = true;
        return { ...t, holdingId: remap.get(t.holdingId) };
      });
    }

    const nextPortfolios = portfolios.filter(p => !folded.has(p.id));
    result.merged = folded.size;
    this.savePortfolios(nextPortfolios);
    if (result.reattached) this.saveHoldings(nextHoldings);
    if (txChanged) this.saveTransactions(nextTx);
    return result;
  },

  initialize() {
    // An unreadable list is not "no portfolio yet": nothing is made over it
    // (the tracker shows its recovery panel).
    if (this.unreadableKeys().length) { this.keepUnreadable(); return null; }
    // Holdings that lost their portfolio come back first: with them a
    // portfolio exists again and no empty default is made on top.
    try { this.repairOrphans(); } catch (e) { console.error('Portfolio repair failed:', e); }
    // Create default portfolio if none exists
    const portfolios = this.getPortfolios();
    // Full storage: nothing is made, and the tracker opens without one (its
    // own Create says why it cannot keep one). The refusal was thrown out of
    // the Portfolio tab's mount.
    if (portfolios.length === 0) {
      this.attempt(() => this.createPortfolio({
        name: 'My Portfolio',
        icon: 'barChart',
        baseCurrency: 'USD'
      }));
    }
    return this.getPortfolios()[0];
  },

  // ==================== EXPORT/IMPORT ====================

  exportAll() {
    return {
      portfolios: this.getPortfolios(),
      holdings: this.getHoldings(),
      transactions: this.getTransactions(),
      settings: this.getSettings(),
      gamification: this.getGamification(),
      exportedAt: this.getTimestamp()
    };
  },

  /**
   * Put a backup back. Takes either file the tracker makes: Export Backup
   * (exportAll: { portfolios, holdings, transactions, ... }) or the error
   * panel's raw backup ({ savedAt, keys: { eodhd_pt_...: "<json>" } }). There
   * was no way to load either: importAll was never called. Replaces the portfolios, holdings and transactions; returns
   * the counts; throws on a file that is not a backup, and on full storage.
   */
  /**
   * What is wrong with a backup file, or null when it can be restored. Asked
   * before the "replace everything?" question, and again by restoreBackup:
   * {"portfolios":[{}]} replaced every portfolio with one that had no id or
   * name, and a trade of "abc" shares came back as a position of 0.
   */
  checkBackup(backup) {
    try { this._readBackup(backup); return null; } catch (e) { return e && e.message ? e.message : 'This file is not a portfolio backup.'; }
  },

  _readBackup(backup) {
    const bad = (what) => { throw new PortfolioStorageError('not-a-backup', `This backup can't be restored: ${what}. Nothing was changed.`); };
    let data = backup;
    // What the file holds and cannot be read is a reason to refuse it, not an
    // empty list: the browser's own raw backup with an unreadable
    // eodhd_pt_transactions, or transactions written as an object, came back
    // as positions of 0 shares, $0.00.
    const unreadable = [];
    if (data && typeof data === 'object' && data.keys && typeof data.keys === 'object') {
      const raw = data.keys;
      const read = (k) => { if (raw[k] == null) return undefined; try { return JSON.parse(raw[k]); } catch (e) { unreadable.push(k); return undefined; } };
      data = {
        portfolios: read(this.KEYS.PORTFOLIOS),
        holdings: read(this.KEYS.HOLDINGS),
        transactions: read(this.KEYS.TRANSACTIONS),
        settings: read(this.KEYS.SETTINGS),
      };
    }
    const records = (v) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : null);
    const portfolios = records(data && data.portfolios);
    if (!portfolios || portfolios.length === 0) {
      if (unreadable.indexOf(this.KEYS.PORTFOLIOS) !== -1) bad(`its portfolios (${this.KEYS.PORTFOLIOS}) cannot be read`);
      throw new PortfolioStorageError('not-a-backup', 'This file is not a portfolio backup: it has no portfolios in it.');
    }
    // Positions and transactions: absent is none; present, they are a list of
    // records, every one of them.
    const listOf = (key, plural, one) => {
      if (unreadable.indexOf(key) !== -1) bad(`its ${plural} (${key}) cannot be read`);
      const v = data[plural];
      if (v == null) return [];
      if (!Array.isArray(v)) bad(`its ${plural} are not a list`);
      const i = v.findIndex(x => !(x && typeof x === 'object' && !Array.isArray(x)));
      if (i !== -1) bad(`${one} ${i + 1} is not a record`);
      return v;
    };
    const holdings = listOf(this.KEYS.HOLDINGS, 'holdings', 'position');
    const transactions = listOf(this.KEYS.TRANSACTIONS, 'transactions', 'transaction');
    if (portfolios.length !== data.portfolios.length) bad(`portfolio ${data.portfolios.findIndex(x => !(x && typeof x === 'object' && !Array.isArray(x))) + 1} is not a record`);
    const str = (v) => typeof v === 'string' && v.trim() !== '';
    const portfolioIds = new Set();
    portfolios.forEach((p, i) => {
      if (!str(p.id)) bad(`portfolio ${i + 1} has no id`);
      if (!str(p.name)) bad(`portfolio ${i + 1} has no name`);
      if (portfolioIds.has(p.id)) bad(`two portfolios share the id ${p.id}`);
      portfolioIds.add(p.id);
    });
    const holdingIds = new Set();
    holdings.forEach((h, i) => {
      if (!str(h.id)) bad(`position ${i + 1} has no id`);
      // Trades find their position by id: two positions "h0" (AAPL, MSFT)
      // each took both trades, 15 shares apiece from 15.
      if (holdingIds.has(h.id)) bad(`two positions share the id ${h.id}`);
      const label = `position ${i + 1}${str(h.name) ? ` (${String(h.name).slice(0, 30)})` : ''}`;
      // A position is its ticker (a manual one, its name): one without came
      // back as a row with no ticker, 0 shares and $0.00, its 10-share trade
      // not counted.
      if (h.type === 'manual' ? !str(h.name) : !str(h.symbol)) {
        bad(`${label} has no ${h.type === 'manual' ? 'name' : 'ticker'}`);
      }
      // ... and a ticker the pickers would take: "AAPL..US", which each of
      // them answers with "not a ticker", came back as a position.
      if (h.type !== 'manual' && window.SymbolCode && window.SymbolCode.read && !window.SymbolCode.read(h.symbol).symbol) {
        bad(`${label} has the ticker "${String(h.symbol).slice(0, 30)}", which is not a ticker`);
      }
      if (!portfolioIds.has(h.portfolioId)) bad(`position ${h.symbol || h.name || i + 1} belongs to no portfolio in the file`);
      ['quantity', 'avgCost', 'manualPrice', 'exchangeRate'].forEach(k => {
        if (h[k] == null || h[k] === '') return;
        if (!Number.isFinite(Number(h[k]))) bad(`position ${h.symbol || h.name || i + 1} has ${k} "${String(h[k]).slice(0, 20)}", not a finite number`);
      });
      holdingIds.add(h.id);
    });
    const numeric = ['quantity', 'price', 'fees', 'exchangeRate', 'ratio'];
    const transactionIds = new Set();
    transactions.forEach((t, i) => {
      if (!str(t.id)) bad(`transaction ${i + 1} has no id`);
      // Edited and deleted by id: two with one id are one trade to the app.
      if (transactionIds.has(t.id)) bad(`two transactions share the id ${t.id}`);
      transactionIds.add(t.id);
      if (!holdingIds.has(t.holdingId)) bad(`transaction ${i + 1} belongs to no position in the file`);
      if (!str(t.type)) bad(`transaction ${i + 1} has no type`);
      if (!str(t.date)) bad(`transaction ${i + 1} has no date`);
      numeric.forEach(k => {
        if (t[k] == null) return;
        // Finite as well as numeric: "1e400" is Infinity, and a position was
        // restored with 0 shares from it.
        const okNum = typeof t[k] === 'number' ? Number.isFinite(t[k])
          : (typeof t[k] === 'string' && /^\s*-?\d+(\.\d+)?(e[-+]?\d+)?\s*$/i.test(t[k]) && Number.isFinite(Number(t[k])));
        if (!okNum) bad(`transaction ${i + 1} has ${k} "${String(t[k]).slice(0, 20)}", not a number`);
      });
    });
    this._checkBackupContent(portfolios, holdings, transactions, bad);
    return { data, portfolios, holdings, transactions };
  },

  /**
   * The rules the forms and the importer apply, applied to a backup before
   * anything is replaced. Shape alone let in a quantity of -10 (TOTAL VALUE
   * -$3,328.90), a sale of 50 with 10 held, a "gift" trade, the date
   * "yesterday", a 300-character name and the currency "XXX".
   */
  _checkBackupContent(portfolios, holdings, transactions, bad) {
    const Calc = window.PortfolioCalculations;
    const bases = new Set(((Calc && Calc.BASE_CURRENCIES) || []).map(([c]) => c));
    portfolios.forEach((p, i) => {
      const label = `portfolio "${String(p.name).slice(0, 30)}"`;
      if (String(p.name).trim().length > this.NAME_MAX) bad(`${label} has a name longer than ${this.NAME_MAX} characters`);
      if (p.baseCurrency != null && bases.size && !bases.has(String(p.baseCurrency))) bad(`${label} has the currency "${String(p.baseCurrency).slice(0, 10)}", which the tracker does not offer`);
    });
    holdings.forEach((h) => {
      if (h.currency != null && (!/^[A-Z]{3}$/.test(String(h.currency)) || h.currency === 'XXX')) {
        bad(`position ${h.symbol || h.name || h.id} has the currency "${String(h.currency).slice(0, 10)}"`);
      }
    });
    const TYPES = new Set(['buy', 'sell', 'dividend', 'split', 'transfer_in', 'transfer_out']);
    const byHolding = new Map();
    transactions.forEach((t, i) => {
      const n = `transaction ${i + 1}`;
      if (!TYPES.has(t.type)) bad(`${n} is of the type "${String(t.type).slice(0, 20)}"`);
      if (Calc && Calc.checkTradeDate) {
        const dateErr = Calc.checkTradeDate(t.date);
        if (dateErr) bad(`${n}: ${dateErr}`);
      }
      const q = Number(t.quantity);
      if (!(q > 0)) bad(`${n} has the quantity ${t.quantity}; it must be above zero`);
      const p = t.price == null || t.price === '' ? null : Number(t.price);
      if (t.type !== 'split' && t.type !== 'transfer_out' && !(p > 0)) bad(`${n} has no price above zero`);
      const f = t.fees == null || t.fees === '' ? 0 : Number(t.fees);
      if (f < 0) bad(`${n} has negative fees`);
      if (Calc && f > Calc.TRADE_VALUE_MAX) bad(`${n} has fees of ${t.fees}; the most is ${Number(Calc.TRADE_VALUE_MAX).toLocaleString('en-US')}`);
      // The bounds the forms apply (Calc.amountProblem): quantity 1e300
      // restored as a position worth "$337,310,000,…".
      if (Calc && Calc.amountProblem && Calc.amountProblem(t.type, q, p)) {
        const big = (x) => x.toLocaleString('en-US');
        if (t.type === 'split') bad(`${n} has the split ratio ${t.quantity}; the most a split can be is ${big(Calc.SPLIT_RATIO_MAX)}`);
        if (q > Calc.QUANTITY_MAX) bad(`${n} has the quantity ${t.quantity}; the most a trade can carry is ${big(Calc.QUANTITY_MAX)}`);
        bad(`${n} is worth more than ${big(Calc.TRADE_VALUE_MAX)} (quantity × price)`);
      }
      if (!byHolding.has(t.holdingId)) byHolding.set(t.holdingId, []);
      byHolding.get(t.holdingId).push({ ...t, quantity: q });
    });
    if (!Calc || !Calc.findShortfall) return;
    const nameOf = (id) => { const h = holdings.find(x => x.id === id); return (h && (h.symbol || h.name)) || id; };
    byHolding.forEach((txs, id) => {
      const short = Calc.findShortfall(txs);
      if (short) bad(`position ${nameOf(id)} sells ${Calc.formatQuantity(short.quantity)} on ${short.date} with ${Calc.formatQuantity(short.held)} held`);
      const div = Calc.findDividendShortfall && Calc.findDividendShortfall(txs);
      if (div) bad(`position ${nameOf(id)} has a dividend on ${Calc.formatQuantity(div.quantity)} shares on ${div.date} with ${Calc.formatQuantity(div.held)} held`);
    });
  },

  restoreBackup(backup) {
    const { data, portfolios, holdings, transactions } = this._readBackup(backup);
    const before = this.rawSnapshot();
    // A restore replaces the whole set on purpose: it is a way out of an
    // unreadable key, so the guard against writing over one stands aside.
    this._overwriting = true;
    let ok;
    try {
      ok = this.savePortfolios(portfolios) && this.saveHoldings(holdings) && this.saveTransactions(transactions)
        && (!data.settings || typeof data.settings !== 'object' || this.saveSettings(data.settings));
    } finally { this._overwriting = false; }
    if (!ok) {
      // Put back what was there; a half-restored set is worse than none.
      // A put-back the browser refuses as well is said, and the screen reads
      // the lists again: no order of three lists that all change can keep
      // every trade with its position here, so what is left without one is
      // shown, and offered for clean-up, by the tracker (orphanTrades).
      // It was refused in silence.
      // Only what the restore changed: a list it never got to write is as it
      // was, and asking to write it again could only be refused.
      let left = 0;
      Object.entries(before.keys).forEach(([k, v]) => {
        let now;
        try { now = localStorage.getItem(k); } catch (e) { now = undefined; }
        if (now === v) return;
        try { localStorage.setItem(k, v); } catch (e) { left++; }
      });
      const refused = this._writeRefused();
      if (!left) throw refused;
      throw this._stopped({ refused, kept: [this.KEYS.TRANSACTIONS] },
        () => 'The backup was only partly restored, and the data from before it could not all be put back: ');
    }
    return { portfolios: portfolios.length, holdings: holdings.length, transactions: transactions.length };
  },

  // Trades whose position is not stored: what a change the browser refused
  // part way, with its put-back refused too, can leave (a restore). No
  // screen shows them; the tracker names them and offers to delete them.
  // None while either list cannot be read: an unreadable list reads as
  // empty, and every trade looked like one of no position.
  orphanTrades() {
    if (this._anyUnreadable([this.KEYS.HOLDINGS, this.KEYS.TRANSACTIONS])) return [];
    const ids = new Set(this.getHoldings().map(h => h.id));
    return this.getTransactions().filter(t => !ids.has(t.holdingId));
  },
  // Deletes them; throws the refusal (as every write) when the browser
  // refuses it. Returns how many went.
  deleteOrphanTrades() {
    // The positions list unreadable read as no positions, and "Delete it"
    // for one orphan deleted every trade, the valid ones too.
    this._refuseUnreadableAll([this.KEYS.HOLDINGS, this.KEYS.TRANSACTIONS]);
    const ids = new Set(this.getHoldings().map(h => h.id));
    const all = this.getTransactions();
    const kept = all.filter(t => ids.has(t.holdingId));
    if (kept.length === all.length) return 0;
    if (!this.saveTransactions(kept)) throw this._writeRefused();
    return all.length - kept.length;
  },

  importAll(data) {
    try {
      if (data.portfolios) this.savePortfolios(data.portfolios);
      if (data.holdings) this.saveHoldings(data.holdings);
      if (data.transactions) this.saveTransactions(data.transactions);
      if (data.settings) this.saveSettings(data.settings);
      if (data.gamification) this.saveGamification(data.gamification);
      return true;
    } catch (e) {
      console.error('Error importing data:', e);
      return false;
    }
  },

  // Clear all data (for testing/reset)
  clearAll() {
    Object.values(this.KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  },

  // ==================== RECOVERY ====================
  //
  // When the tracker cannot draw from what is stored, reloading does not
  // help -- the data is still there on the next load. These are the way out the error panel offers: the layout
  // preferences first (harmless to lose), then the stored data itself,
  // downloaded before it is removed.

  /** Layout preferences the tracker reads on every render. */
  VIEW_PREF_KEYS: ['eodhd_overview_widgets', 'eodhd_widget_sizes'],

  /** Every tracker key as stored, raw, unparsed: what a backup must keep. */
  rawSnapshot() {
    const out = {};
    [...Object.values(this.KEYS), ...this.VIEW_PREF_KEYS, UNREADABLE_BACKUP_KEY].forEach(k => {
      try { const v = localStorage.getItem(k); if (v != null) out[k] = v; } catch (e) { /* unreadable store */ }
    });
    return { savedAt: this.getTimestamp(), keys: out };
  },

  /** Keys whose stored text is not JSON of the shape the tracker expects. */
  brokenKeys() {
    const shapes = {
      [this.KEYS.PORTFOLIOS]: 'array', [this.KEYS.HOLDINGS]: 'array', [this.KEYS.TRANSACTIONS]: 'array',
      [this.KEYS.SETTINGS]: 'object', [this.KEYS.GAMIFICATION]: 'object', [this.KEYS.FOREX_CACHE]: 'object',
      eodhd_overview_widgets: 'array', eodhd_widget_sizes: 'object',
    };
    return Object.keys(shapes).filter(k => {
      let raw = null;
      try { raw = localStorage.getItem(k); } catch (e) { return false; }
      if (raw == null) return false;
      try {
        const v = JSON.parse(raw);
        if (shapes[k] === 'array') return !Array.isArray(v) || v.some(x => !(x && typeof x === 'object') && typeof x !== 'string');
        return !(v && typeof v === 'object' && !Array.isArray(v));
      } catch (e) { return true; }
    });
  },

  /**
   * The portfolio, position and trade lists whose saved text is there but
   * is not a list (does not parse, or is another shape). Records inside a
   * list that are not records are dropped on read, as before (asArray).
   */
  unreadableKeys() {
    return [this.KEYS.PORTFOLIOS, this.KEYS.HOLDINGS, this.KEYS.TRANSACTIONS].filter(k => {
      let raw = null;
      try { raw = localStorage.getItem(k); } catch (e) { return false; }
      if (raw == null || raw === '') return false;
      try { return !Array.isArray(JSON.parse(raw)); } catch (e) { return true; }
    });
  },

  /**
   * A copy of the unreadable keys' text as found, under
   * eodhd_pt_unreadable_backup ({ savedAt, keys }) -- the shape Restore
   * reads. Kept once per text; a later, different breakage of the same key
   * moves the earlier text to `previous` rather than losing it. Returns the
   * copy, or null when nothing is unreadable (or there is no room for it).
   */
  keepUnreadable() {
    const keys = this.unreadableKeys();
    if (!keys.length) return null;
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem(UNREADABLE_BACKUP_KEY) || 'null'); } catch (e) { kept = null; }
    const copy = kept && typeof kept === 'object' && kept.keys && typeof kept.keys === 'object' ? kept : { savedAt: this.getTimestamp(), keys: {} };
    let changed = false;
    keys.forEach(k => {
      let raw = null;
      try { raw = localStorage.getItem(k); } catch (e) { raw = null; }
      if (raw == null || copy.keys[k] === raw) return;
      if (copy.keys[k] != null) (copy.previous = Array.isArray(copy.previous) ? copy.previous : []).push({ key: k, raw: copy.keys[k] });
      copy.keys[k] = raw;
      copy.savedAt = this.getTimestamp();
      changed = true;
    });
    if (changed) {
      try { localStorage.setItem(UNREADABLE_BACKUP_KEY, JSON.stringify(copy)); } catch (e) { return null; }
    }
    return copy;
  },
  UNREADABLE_BACKUP_KEY,

  // Every change that decides what to delete or move from a list it reads,
  // not only from one it writes: a list that cannot be read reads as empty,
  // and the decision would be made on nothing. Refused with
  // why (UNREADABLE_MESSAGE), before anything is written.
  _refuseUnreadableAll(keys) {
    for (const k of keys) this._refuseUnreadable(k);
  },
  _anyUnreadable(keys) {
    const bad = this.unreadableKeys();
    return keys.some(k => bad.indexOf(k) !== -1);
  },
  _refuseUnreadable(key) {
    this._refuseBlocked();
    if (this._overwriting) return;
    if (this.unreadableKeys().indexOf(key) === -1) return;
    this.keepUnreadable();
    throw new PortfolioStorageError('unreadable', UNREADABLE_MESSAGE);
  },

  /** Remove these keys; returns the ones removed. */
  resetKeys(keys) {
    const done = [];
    (keys || []).forEach(k => { try { localStorage.removeItem(k); done.push(k); } catch (e) { /* blocked store */ } });
    return done;
  },

  /**
   * Remove `keys` only after a backup was made and the user then confirmed
   * the deletion. Backup and deletion are separate steps: the reset used to
   * delete whether or not the download happened -- a blocked download lost
   * the data it was meant to save.
   *
   * `backup(snapshot)` must return true (a falsy return or a throw aborts:
   * nothing is deleted). `confirmDelete()` is asked after the backup and must
   * return true. Returns { deleted, reason, snapshot } -- the snapshot so the
   * caller can offer it another way (copy to clipboard) when the download
   * failed.
   */
  resetWithBackup(keys, { backup, confirmDelete }) {
    const snapshot = this.rawSnapshot();
    let saved = false;
    try { saved = !!(backup && backup(snapshot)); } catch (e) { saved = false; }
    if (!saved) return { deleted: false, reason: 'backup-failed', snapshot };
    let go = false;
    try { go = !!(confirmDelete && confirmDelete()); } catch (e) { go = false; }
    if (!go) return { deleted: false, reason: 'not-confirmed', snapshot };
    this.resetKeys(keys);
    return { deleted: true, reason: null, snapshot };
  },

  /** Every key the tracker's views read, layout preferences included (not referrals). */
  allKeys() {
    return [...Object.values(this.KEYS).filter(k => k !== this.KEYS.REFERRALS), ...this.VIEW_PREF_KEYS];
  },

  // Update target price and stop loss for a holding
  async setHoldingTargets(holdingId, targetPrice, stopLoss) {
    // Update locally
    const holding = this.updateHolding(holdingId, {
      targetPrice: targetPrice || null,
      stopLoss: stopLoss || null
    });

    return Boolean(holding);
  },

  // Get/Set daily summary preference
  getDailySummaryEnabled() {
    const settings = this.getSettings();
    return settings.dailySummaryEnabled || false;
  },

  async setDailySummaryEnabled(enabled, time, timezone_offset) {
    // Update locally
    this.updateSettings({ dailySummaryEnabled: enabled });
    return true;
  }
};
