// Tax Optimizer — FIFO/LIFO/AvgCost comparison, capital gains breakdown,
// tax-loss harvesting candidates, wash sale detection, CSV export
//
// Every figure here is in the portfolio's base currency, from the same lot
// accounting the Overview uses (PortfolioCalculations.getOpenLots): a split
// scales the open lots, each lot keeps the exchange rate it was bought at and
// a sale is converted at its own, and buy and sell fees are part of the cost
// and the proceeds. The three methods used to walk raw prices instead -- no
// exchange rate, no split, FIFO without the buy fee -- so after NVDA's 10:1
// split the ten pre-split shares were sold at $900 each for a $6,700 "loss",
// pence were read as dollars, and the tab disagreed with the header's
// Realized figure in sign as well as size.
//
// Everything below comes from one chronological walk, _ledger. Wash sales
// are applied inside it, in time order: a sale's rows are computed first,
// from the costs as they stand; then the sale's LOSS rows are matched to
// replacement shares; then the disallowed amounts are added back to those
// rows and carried into the replacement shares' cost -- open ones at once,
// ones bought later when they arrive. So a basis increase can only touch
// later sales of the replacement shares and their unrealized P&L, never the
// sale it came from. (Applying increases in a second walk over the whole
// history let a pre-sale replacement raise the average cost of the very
// sale that created it: $750 of loss against a $500 add-back. This replaces the patches.)

window.TaxOptimizer = {

  /** A number from a transaction field, whatever type it was stored as. */
  _num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; },

  /**
   * Time order, and on one day what was bought before what was sold -- the
   * order PortfolioCalculations.byDate uses, so the tab and the header
   * consume the same lots.
   */
  _byDate(a, b) {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return da < db ? -1 : 1;
    const rank = { buy: 0, transfer_in: 0, split: 1, sell: 2, transfer_out: 2 };
    const ra = rank[a.type] == null ? 3 : rank[a.type];
    const rb = rank[b.type] == null ? 3 : rank[b.type];
    return ra - rb;
  },

  _days(from, to) { return Math.floor((new Date(to) - new Date(from)) / 86400000); },

  /** Calendar days from a trade date to a day (YYYY-MM-DD); Infinity when unreadable. */
  _calDays(from, to) {
    const d = window.CalendarDate.daysBetween(String(from || '').slice(0, 10), to);
    return d == null ? Infinity : d;
  },

  /** An ISO date `days` earlier. */
  _back(date, days) {
    const t = Date.parse(String(date).slice(0, 10) + 'T00:00:00Z');
    return Number.isFinite(t) ? new Date(t - Math.round(days) * 86400000).toISOString().slice(0, 10) : date;
  },

  /** Approximate US federal rates the estimates use, named wherever a tax figure is shown. */
  RATES: { shortTerm: 0.37, longTerm: 0.20 },

  /** Days either side of a loss sale in which a purchase is a replacement. */
  WASH_WINDOW_DAYS: 30,

  /**
   * Long-term only when held MORE than one year: sold after the first
   * anniversary of the purchase, by the calendar. `holdingDays >= 365` called
   * a sale on the anniversary itself long-term (2025-03-03 to 2026-03-03), and
   * across a leap year 365 days is not yet a year. A purchase on 29 February has its anniversary on the 28th.
   */
  _isLongTerm(buyDate, sellDate) {
    const b = String(buyDate || '').slice(0, 10);
    const s = String(sellDate || '').slice(0, 10);
    const m = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const y = +m[1] + 1;
    const mo = +m[2];
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const anniversary = `${y}-${m[2]}-${String(Math.min(+m[3], lastDay)).padStart(2, '0')}`;
    return s > anniversary;
  },

  /** 'fifo' | 'lifo' | 'avgcost'. The view's key was 'avgCost', and the
   *  switch tested 'avgcost', so Avg Cost silently showed FIFO. */
  _method(m) {
    const k = String(m || 'fifo').toLowerCase();
    return k === 'lifo' || k === 'avgcost' ? k : 'fifo';
  },

  _bySymbol(transactions) {
    const groups = {};
    (transactions || []).forEach(t => { (groups[t.symbol] = groups[t.symbol] || []).push(t); });
    Object.keys(groups).forEach(k => groups[k].sort((a, b) => this._byDate(a, b)));
    return groups;
  },

  /**
   * The walk. Per symbol, in time order:
   *
   *  - a purchase opens shares at its cost per share in base currency, fees
   *    included (FIFO/LIFO: a lot; average cost: added to the pool), plus any
   *    wash-sale basis already waiting for it;
   *  - a split scales the open shares;
   *  - a sale or transfer out consumes shares (FIFO oldest lot first, LIFO
   *    newest, average cost at the pool's average with the oldest purchases'
   *    dates for the holding period); a sale produces realized rows, one per
   *    lot (per holding period under average cost);
   *  - with `wash`, a sale's loss rows are then matched to replacement
   *    shares bought within 30 days either side -- before the sale only the
   *    shares of a purchase still open after it, after the sale the
   *    purchase's shares -- each replacement share once, loss rows in the
   *    order the sale realized them, at each row's own loss per share.
   *
   * Returns { realized, open, washSales }. A realized row's costBasis and
   * proceeds are per share; `rawGain` is the gain as realized, `washSaleAdj`
   * the disallowed part added back, `gain` the reportable figure. `open`
   * (FIFO/LIFO) lists the lots still held, with their cost including any
   * wash-sale basis (`washBasis` > 0 on replacement shares).
   */
  _ledger(transactions, method, opts = {}) {
    const m = this._method(method);
    const wash = !!opts.wash;
    const WINDOW = this.WASH_WINDOW_DAYS * 86400000;
    const time = (d) => new Date(d).getTime();
    const realized = [];
    const open = {};
    const washSales = [];
    const groups = this._bySymbol(transactions);

    Object.keys(groups).forEach(symbol => {
      const txs = groups[symbol];
      const pos = new Map(txs.map((t, i) => [t, i]));
      // The split ratio between two moments: splits strictly between them.
      const splitBetween = (i, j) => {
        let f = 1;
        for (let k = i + 1; k < j; k++) {
          const t = txs[k];
          if (t.type === 'split' && this._num(t.quantity) > 0) f *= this._num(t.quantity);
        }
        return f;
      };
      const unused = new Map();       // purchase -> replacement shares left, own units
      txs.forEach(t => { if (t.type === 'buy' && this._num(t.quantity) > 0) unused.set(t, this._num(t.quantity)); });
      const pending = new Map();      // later purchase -> [{ shares (own units), amount }]
      const lots = [];                // FIFO/LIFO: { qty, unitCost, washBasis, date, src }
      const pool = { qty: 0, cost: 0, lots: [] }; // average cost; lots: { qty, date, src }

      const openShares = (src) => (m === 'avgcost' ? pool.lots : lots)
        .filter(l => l.src === src).reduce((s, l) => s + l.qty, 0);

      // Wash basis onto open replacement shares (sale's units now).
      // `tack`: days the sold shares had been held. Replacement shares of a
      // wash sale take that holding period on (IRS): a replacement sold 11
      // months after a two-year holding was short-term here ("tacking"). Average cost pools the money, but its dated lots
      // still carry the holding period: it read short-term, 334 days, where
      // FIFO and LIFO said long-term, 1068.
      const tackPool = (src, shares, tack) => {
        if (!(tack > 0)) return;
        let rest = shares;
        for (let i = 0; i < pool.lots.length && rest > 1e-12; i++) {
          const l = pool.lots[i];
          if (l.src !== src || l.tackDays) continue;
          const take = Math.min(rest, l.qty);
          if (take < l.qty - 1e-12) {
            pool.lots.splice(i + 1, 0, { ...l, qty: l.qty - take });
            l.qty = take;
          }
          l.tackDays = tack;
          rest -= take;
        }
      };
      const addOpenBasis = (src, shares, amount, tack) => {
        if (m === 'avgcost') { pool.cost += amount; tackPool(src, shares, tack); return; }
        // Shares of this purchase not yet matched by an earlier wash sale
        // first: a second sale's basis and holding period went onto shares the
        // first had already taken.
        const order = () => lots.map((l, i) => i)
          .filter(i => lots[i].src === src && !lots[i]._done)
          .sort((a, b) => ((lots[a].washBasis > 0) - (lots[b].washBasis > 0)) || a - b);
        let rest = shares;
        while (rest > 1e-12) {
          const i = order()[0];
          if (i === undefined) break;
          const l = lots[i];
          const take = Math.min(rest, l.qty);
          const extra = amount * (take / shares) / take;
          if (take < l.qty - 1e-12) {
            // Only the replaced shares carry it: split the lot.
            lots.splice(i + 1, 0, { ...l, qty: l.qty - take });
            l.qty = take;
          }
          l.unitCost += extra;
          l.washBasis += extra;
          if (tack > 0) l.tackDays = tack;
          l._done = true;
          rest -= take;
        }
        lots.forEach(l => { delete l._done; });
      };

      txs.forEach((t, ti) => {
        const qty = this._num(t.quantity);
        if (t.type === 'buy' || t.type === 'transfer_in') {
          if (!(qty > 0)) return;
          const unit = (this._num(t.price) + this._num(t.fees) / qty) * (this._num(t.exchangeRate) || 1);
          const waiting = pending.get(t) || [];
          if (m === 'avgcost') {
            pool.cost += qty * unit + waiting.reduce((s, p) => s + p.amount, 0);
            pool.qty += qty;
            let rest = qty;
            waiting.forEach(p => {
              const q = Math.min(rest, p.shares);
              if (q <= 1e-12) return;
              pool.lots.push({ qty: q, date: t.date, src: t, tackDays: p.tack || 0 });
              rest -= q;
            });
            if (rest > 1e-12) pool.lots.push({ qty: rest, date: t.date, src: t });
          } else {
            let rest = qty;
            waiting.forEach(p => {
              const q = Math.min(rest, p.shares);
              if (q <= 1e-12) return;
              lots.push({ qty: q, unitCost: unit + p.amount / p.shares, washBasis: p.amount / p.shares, date: t.date, src: t, tackDays: p.tack || 0 });
              rest -= q;
            });
            if (rest > 1e-12) lots.push({ qty: rest, unitCost: unit, washBasis: 0, date: t.date, src: t });
          }
          return;
        }
        if (t.type === 'split' && qty > 0) {
          lots.forEach(l => { l.qty *= qty; l.unitCost /= qty; l.washBasis /= qty; });
          pool.qty *= qty;
          pool.lots.forEach(l => { l.qty *= qty; });
          return;
        }
        if (!((t.type === 'sell' || t.type === 'transfer_out') && qty > 0)) return;

        const isSale = t.type === 'sell';
        const netPerShare = (this._num(t.price) - this._num(t.fees) / qty) * (this._num(t.exchangeRate) || 1);
        const rows = [];
        const row = (buyDate, q, costPerShare, holdingPeriod, holdingDays) => {
          const gain = (netPerShare - costPerShare) * q;
          rows.push({ symbol, buyDate, sellDate: t.date, quantity: q, costBasis: costPerShare, proceeds: netPerShare, rawGain: gain, washSaleAdj: 0, gain, holdingPeriod, holdingDays, _tx: t });
        };

        if (m === 'avgcost') {
          const used = Math.min(qty, pool.qty);
          if (used <= 1e-12) return;
          const avg = pool.cost / pool.qty;
          // Segments in the order the purchases are consumed (oldest first),
          // adjacent ones of the same holding period merged. Rows -- and so
          // wash matching -- follow that order: emitting short-term before
          // long-term let a partial replacement disallow the short-term loss
          // while the shares consumed first were long-term.
          let remaining = used;
          const segments = [];
          while (remaining > 1e-12 && pool.lots.length) {
            const l = pool.lots[0];
            const take = Math.min(remaining, l.qty);
            const held = l.tackDays ? this._back(l.date, l.tackDays) : l.date;
            const period = this._isLongTerm(held, t.date) ? 'long-term' : 'short-term';
            const last = segments[segments.length - 1];
            if (last && last.period === period) { last.qty += take; last.days += take * this._days(held, t.date); }
            else segments.push({ period, qty: take, days: take * this._days(held, t.date) });
            l.qty -= take; remaining -= take;
            if (l.qty <= 1e-12) pool.lots.shift();
          }
          pool.cost -= avg * used;
          pool.qty -= used;
          if (isSale) {
            segments.forEach(s => {
              if (s.qty > 1e-12) row('avg', s.qty, avg, s.period, Math.round(s.days / s.qty));
            });
          }
        } else {
          let remaining = qty;
          while (remaining > 1e-12 && lots.length) {
            const idx = m === 'lifo' ? lots.length - 1 : 0;
            const l = lots[idx];
            const used = Math.min(remaining, l.qty);
            // A wash-sale replacement counts from when the replaced shares were bought.
            const held = l.tackDays ? this._back(l.date, l.tackDays) : l.date;
            if (isSale) row(l.date, used, l.unitCost, this._isLongTerm(held, t.date) ? 'long-term' : 'short-term', this._days(held, t.date));
            l.qty -= used;
            remaining -= used;
            if (l.qty <= 1e-12) lots.splice(idx, 1);
          }
        }

        const firstIndex = realized.length;
        rows.forEach(r => realized.push(r));
        if (!wash || !isSale) return;

        // The sale's loss rows, each its own unit, in realization order.
        const units = rows.map((r, k) => ({ r, index: firstIndex + k }))
          .filter(u => u.r.rawGain < 0 && u.r.quantity > 0)
          .map(u => ({ ...u, qty: u.r.quantity, lossPerShare: -u.r.rawGain / u.r.quantity, matched: 0, disallowed: 0 }));
        if (!units.length) return;
        const sellT = time(t.date);
        const candidates = txs.filter(b => b.type === 'buy' && (unused.get(b) || 0) > 1e-12 && b !== t
          && Math.abs(time(b.date) - sellT) <= WINDOW);
        const lossQty = units.reduce((s, u) => s + u.qty, 0);
        let need = lossQty;
        let at = 0;
        const used = [];
        for (const b of candidates) {
          if (need <= 1e-12) break;
          const bi = pos.get(b);
          const before = bi < ti;
          // Shares of b available, in the sale's units, and the conversion.
          const toSale = before ? splitBetween(bi, ti) : 1 / splitBetween(ti, bi);
          const avail = before
            ? Math.min(unused.get(b) * toSale, openShares(b))
            : unused.get(b) * toSale;
          const take = Math.min(need, avail);
          if (take <= 1e-12) continue;
          unused.set(b, unused.get(b) - take / toSale);
          need -= take;
          let rest = take;
          let amount = 0;
          let heldWeighted = 0;
          while (rest > 1e-12 && at < units.length) {
            const u = units[at];
            const q = Math.min(rest, u.qty - u.matched);
            u.matched += q;
            u.disallowed += q * u.lossPerShare;
            amount += q * u.lossPerShare;
            heldWeighted += q * (u.r.holdingDays || 0);
            rest -= q;
            if (u.qty - u.matched <= 1e-12) at++;
          }
          const tack = take > 0 ? heldWeighted / take : 0;
          if (before) addOpenBasis(b, take, amount, tack);
          else {
            if (!pending.has(b)) pending.set(b, []);
            pending.get(b).push({ shares: take / toSale, amount, tack });
          }
          used.push({ tx: b, date: b.date, shares: take, disallowed: amount });
        }
        const matched = lossQty - need;
        if (matched <= 1e-12) return;
        units.forEach(u => {
          if (u.disallowed <= 0) return;
          u.r.washSaleAdj = Math.min(-u.r.rawGain, u.disallowed);
          u.r.gain = u.r.rawGain + u.r.washSaleAdj;
        });
        washSales.push({
          symbol,
          sellDate: t.date,
          sellPrice: t.price,
          avgCost: units.reduce((s, u) => s + u.r.costBasis * u.qty, 0) / lossQty,
          loss: units.reduce((s, u) => s + u.r.rawGain, 0),
          sharesSold: lossQty,
          replacementShares: matched,
          washBuyDates: used.map(u => u.date),
          replacements: used,
          rows: units.filter(u => u.matched > 1e-12).map(u => ({ index: u.index, matched: u.matched, disallowed: u.disallowed })),
          disallowedLoss: units.reduce((s, u) => s + u.disallowed, 0),
          _tx: t,
        });
      });
      open[symbol] = lots;
    });
    return { realized, open, washSales };
  },

  /**
   * Realized P&L using LIFO (Last In First Out), before wash sales
   */
  getRealizedPnL_LIFO(transactions) {
    return this._ledger(transactions, 'lifo').realized;
  },

  /**
   * Realized P&L using FIFO (First In First Out) — matches calculations.js;
   * before wash sales
   */
  getRealizedPnL_FIFO(transactions) {
    return this._ledger(transactions, 'fifo').realized;
  },

  /**
   * Realized P&L using Average Cost, before wash sales. One row per holding
   * period: the cost is averaged, the dates are not -- a sale spanning both
   * is split between short-term and long-term as a tax form does.
   */
  getRealizedPnL_AvgCost(transactions) {
    return this._ledger(transactions, 'avgcost').realized;
  },

  /**
   * Realized rows by method, with wash sales applied (see _ledger). A
   * detected wash sale used to be shown ("Disallowed: $600.00") and then
   * deducted anyway.
   */
  _realized(transactions, method) {
    return this._ledger(transactions, method, { wash: true }).realized;
  },

  _inYear(realized, taxYear) {
    return taxYear ? realized.filter(r => r.sellDate && String(r.sellDate).startsWith(String(taxYear))) : realized;
  },

  /**
   * Estimated tax at approximate US rates, with losses netted: a net loss
   * on one side offsets a net gain on the other. It used to floor each side
   * at zero on its own, so a $1,000 short-term loss did nothing against a
   * $1,000 long-term gain.
   */
  estimateTax(realized) {
    const taxRate = this.RATES;
    let shortNet = 0, longNet = 0;
    realized.forEach(r => {
      if (r.holdingPeriod === 'long-term') longNet += r.gain;
      else shortNet += r.gain;
    });
    if (shortNet < 0 && longNet > 0) { longNet = Math.max(0, longNet + shortNet); shortNet = 0; }
    else if (longNet < 0 && shortNet > 0) { shortNet = Math.max(0, shortNet + longNet); longNet = 0; }
    return Math.max(0, shortNet) * taxRate.shortTerm + Math.max(0, longNet) * taxRate.longTerm;
  },

  /**
   * Side-by-side comparison of all 3 methods, for one tax year when given
   */
  compareCostBasis(transactions, taxYear) {
    const sum = (arr) => arr.reduce((s, r) => s + r.gain, 0);
    const one = (method) => {
      const realized = this._inYear(this._realized(transactions, method), taxYear);
      return { realized, totalGain: sum(realized), estimatedTax: this.estimateTax(realized) };
    };
    return { fifo: one('fifo'), lifo: one('lifo'), avgCost: one('avgcost') };
  },

  /**
   * Capital gains breakdown: short-term vs long-term, for one tax year when given
   */
  getCapitalGainsBreakdown(transactions, method, taxYear) {
    const realized = this._inYear(this._realized(transactions, method), taxYear);

    let shortGains = 0, shortLosses = 0, longGains = 0, longLosses = 0;
    realized.forEach(r => {
      if (r.holdingPeriod === 'long-term') {
        if (r.gain >= 0) longGains += r.gain;
        else longLosses += r.gain;
      } else {
        if (r.gain >= 0) shortGains += r.gain;
        else shortLosses += r.gain;
      }
    });

    return {
      shortTerm: { gains: shortGains, losses: shortLosses, net: shortGains + shortLosses },
      longTerm: { gains: longGains, losses: longLosses, net: longGains + longLosses },
      total: { gains: shortGains + longGains, losses: shortLosses + longLosses, net: shortGains + shortLosses + longGains + longLosses },
    };
  },

  /**
   * Tax-loss harvesting candidates: positions with unrealized losses.
   *
   * `currentPrices` is per share in base currency, keyed by the same symbol
   * the transactions carry. Quantity and cost come from the open FIFO lots
   * (splits applied, FX at purchase), not from raw buys minus sells: after a
   * 10:1 split that read 10 shares at $900 against a $90 price and advised
   * realising a $6,700 "loss" on a position $13,700 up.
   */
  // Open lots carry any wash-sale basis in their cost. A position that holds
  // replacement shares of a wash sale bought in the last 30 days is not
  // offered: selling it now only moves the disallowed loss around, and the
  // tab used to recommend exactly that sale ("Save ~$99.35").
  // `now` is for tests. Savings are at the short-term rate, which the view
  // names beside the figure.
  getHarvestingCandidates(holdings, transactions, currentPrices, now) {
    const candidates = [];
    const taxRate = this.RATES.shortTerm;
    const { open } = this._ledger(transactions, 'fifo', { wash: true });
    const today = now ? new Date(now).getTime() : Date.now();
    // The wash window counts calendar days from the viewer's today.
    const todayDay = window.CalendarDate.today(today);

    for (const h of holdings) {
      const price = currentPrices[h.symbol];
      if (!(price > 0)) continue;

      const lots = open[h.symbol] || [];
      const remainingQty = lots.reduce((s, l) => s + l.qty, 0);
      if (remainingQty <= 1e-12) continue;
      const freshReplacement = lots.some(l => l.washBasis > 0 && this._calDays(l.date, todayDay) <= this.WASH_WINDOW_DAYS);
      if (freshReplacement) continue;
      const totalCost = lots.reduce((s, l) => s + l.qty * l.unitCost, 0);

      const avgCost = totalCost / remainingQty;
      const unrealizedLoss = price * remainingQty - totalCost;

      if (unrealizedLoss < 0) {
        // Check wash sale risk
        const recentBuys = transactions.filter(t =>
          t.symbol === h.symbol && t.type === 'buy' &&
          Math.abs(this._calDays(t.date, todayDay)) < this.WASH_WINDOW_DAYS
        );

        candidates.push({
          symbol: h.symbol,
          quantity: remainingQty,
          avgCost,
          currentPrice: price,
          unrealizedLoss,
          estimatedSavings: Math.abs(unrealizedLoss) * taxRate,
          rate: taxRate,
          washSaleRisk: recentBuys.length > 0,
        });
      }
    }

    return candidates.sort((a, b) => a.unrealizedLoss - b.unrealizedLoss);
  },

  /**
   * Wash sale detection, for the selected method (FIFO by default): each
   * loss sale with replacement shares bought within 30 days before or after
   * it. Only the replaced part is disallowed, row by row at each loss row's
   * own loss per share (see _ledger): selling 100 at a loss and buying back
   * 10 disallows ten shares' loss, not all of it; a gain lot sold in the
   * same sale is never matched; a lot losing $100/share is not averaged with
   * one losing $1/share. A purchase before the sale counts only for its
   * shares still held once the sale is done: the shares the sale consumed
   * are the position being sold, not a replacement for it.
   */
  detectWashSales(transactions, method) {
    return this._ledger(transactions, method, { wash: true }).washSales;
  },

  /**
   * One CSV cell. A name with a comma or a quote ("Apartment, Berlin
   * "Mitte"") split into extra columns -- 13 cells under 12 headers:
   * such a cell is quoted, its quotes doubled. Text a
   * spreadsheet would run as a formula (=, +, @, a tab, or - before
   * something that is not a number) is prefixed with an apostrophe.
   */
  csvCell(value) {
    let s = value == null ? '' : String(value);
    // Also after leading line breaks, and the full-width forms some
    // spreadsheets read as the same signs.
    if (/^[\r\n]*[=+@\t＝＋＠－]/.test(s) || (/^[\r\n]*-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) s = "'" + s;
    return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  },
  /** Rows of cells as CSV text (CRLF between records, RFC 4180). */
  csvText(rows) {
    return rows.map(r => r.map(c => this.csvCell(c)).join(',')).join('\r\n');
  },

  /**
   * Generate CSV export
   */
  generateTaxCSV(transactions, method, taxYear) {
    // Filter by tax year if specified
    const realized = this._inYear(this._realized(transactions, method), taxYear);

    // Totals for the row, as a tax form's columns are: "Cost Basis" and
    // "Proceeds" were per-share prices under names that read as amounts. Per-share figures follow, labelled. Gain/Loss is
    // before the wash-sale adjustment, Adjusted Gain/Loss after it; the
    // adjustment is each row's own disallowed amount.
    const headers = ['Symbol', 'Buy Date', 'Sell Date', 'Quantity', 'Cost Basis (total)', 'Proceeds (total)', 'Gain/Loss', 'Wash Sale Adj', 'Adjusted Gain/Loss', 'Holding Period', 'Cost per Share', 'Proceeds per Share'];

    const rows = realized.map(r => [
      r.symbol,
      r.buyDate,
      r.sellDate,
      // Up to eight decimals: 0.00012345 BTC was "0.0001".
      String(+r.quantity.toFixed(8)),
      (r.costBasis * r.quantity).toFixed(2),
      (r.proceeds * r.quantity).toFixed(2),
      r.rawGain.toFixed(2),
      r.washSaleAdj.toFixed(2),
      r.gain.toFixed(2),
      r.holdingPeriod,
      r.costBasis.toFixed(4),
      r.proceeds.toFixed(4),
    ]);

    return this.csvText([headers, ...rows]);
  },

  /**
   * Trigger CSV download in browser
   */
  downloadCSV(csvString, filename) {
    // With a byte-order mark: a spreadsheet then opens "Müller" as UTF-8,
    // not as "MÃ¼ller".
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'tax-report.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
