// Portfolio Tracker - Calculations Module
// All portfolio metrics and calculations

window.PortfolioCalculations = {

  // ==================== HOLDING CALCULATIONS ====================

  /**
   * Calculate quantity held for a holding based on transactions
   */
  /**
   * Transaction order for every walk in this file. Dates are ISO strings, so
   * text order is time order; a missing date sorts first rather than turning
   * the comparison into NaN and leaving the order to whatever the caller had.
   */
  /** A number from a transaction field, whatever type it was stored as. */
  num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; },

  byDate(a, b) {
    const da = String(a.date || '');
    const db = String(b.date || '');
    if (da !== db) return da < db ? -1 : 1;
    // Same day: what was bought comes before what was sold. Without this the
    // stable sort left the order to the CSV, and the same two rows gave a
    // total return of -$100 in one order and +$1,400 in the other -- a buy
    // and a sale on one day is the ordinary case, not the edge.
    const rank = { buy: 0, transfer_in: 0, split: 1, sell: 2, transfer_out: 2 };
    const ra = rank[a.type] == null ? 3 : rank[a.type];
    const rb = rank[b.type] == null ? 3 : rank[b.type];
    return ra - rb;
  },

  /**
   * Shares held: the open lots, summed.
   *
   * This used to be its own running total -- add buys, subtract sells,
   * multiply by splits -- with none of the guards the lot walk has. So a CSV
   * selling 25 of 10 showed minus fifteen shares and a negative portfolio, a
   * sale dated before its purchase counted, and a split of zero wiped the
   * quantity while the lots kept their cost, for a "-100%" on an intact
   * position. Quantity and cost basis now come from the same walk and cannot
   * disagree.
   */
  getHoldingQuantity(transactions) {
    return this.getOpenLots(transactions).reduce((total, lot) => total + lot.quantity, 0);
  },

  /**
   * Calculate average cost basis for a holding
   */
  getCostBasis(transactions) {
    let totalShares = 0;
    let totalCost = 0;

    this.getOpenLots(transactions).forEach(lot => {
      totalShares += lot.quantity;
      totalCost += lot.quantity * (lot.price + lot.feePerShare);
    });

    return {
      totalCost,
      totalShares,
      avgCostPerShare: totalShares > 0 ? totalCost / totalShares : 0
    };
  },

  /**
   * The shares still held, as the lots they were bought in.
   *
   * Cost basis used to be the sum of every purchase ever made, sales
   * ignored. After buying 20 and selling 8, the 12 left were compared with
   * the cost of all 20, and a position sold out entirely showed zero shares
   * at minus one hundred percent.
   *
   * FIFO, in the same order getRealizedPnL matches a sale, so the two agree:
   * what a sale consumes here is exactly what it realizes there. A split
   * scales every open lot -- more shares at a lower price, the same money.
   * Fees stay with the lot and leave with its shares, so a lot half sold
   * carries half its commission.
   */
  getOpenLots(transactions) {
    const lots = [];
    [...transactions]
      .sort((a, b) => this.byDate(a, b))
      .forEach(t => {
        if (t.type === 'buy' || t.type === 'transfer_in') {
          const qty = this.num(t.quantity);
          lots.push({
            quantity: qty,
            price: this.num(t.price),
            feePerShare: qty > 0 ? this.num(t.fees) / qty : 0,
            exchangeRate: this.num(t.exchangeRate) || 1,
            date: String(t.date || '').slice(0, 10)
          });
        } else if (t.type === 'sell' || t.type === 'transfer_out') {
          let left = this.num(t.quantity);
          while (left > 0 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(left, lot.quantity);
            lot.quantity -= take;
            left -= take;
            if (lot.quantity <= 0) lots.shift();
          }
        } else if (t.type === 'split' && this.num(t.quantity) > 0) {
          const ratio = this.num(t.quantity);
          lots.forEach(lot => {
            lot.quantity *= ratio;
            lot.price /= ratio;
            lot.feePerShare /= ratio;
          });
        }
      });
    return lots;
  },

  /**
   * Everything ever paid in, sales not deducted.
   *
   * The denominator for a return that includes realized gains: what the
   * money made against what was put in, rather than against what happens
   * to be open today.
   */
  // Shares transferred out take their cost with them. They left for another
  // account -- not sold, nothing realized -- so their purchase is no longer
  // money this portfolio has at work. Kept in the denominator, a transfer out
  // of 4 of 10 read +1,160% in the header beside +1,221% on the row. The lots they came from are found the way getOpenLots
  // finds them, FIFO per holding.
  getGrossInvested(transactions) {
    const groups = {};
    (transactions || []).forEach(t => {
      const key = t.holdingId || t.symbol || '_';
      (groups[key] = groups[key] || []).push(t);
    });
    let invested = 0;
    Object.keys(groups).forEach(key => {
      const lots = [];
      [...groups[key]].sort((a, b) => this.byDate(a, b)).forEach(t => {
        if (t.type === 'buy' || t.type === 'transfer_in') {
          const qty = this.num(t.quantity);
          const fx = this.num(t.exchangeRate) || 1;
          const cost = (qty * this.num(t.price) + this.num(t.fees)) * fx;
          invested += cost;
          if (qty > 0) lots.push({ quantity: qty, costPerShare: cost / qty });
        } else if (t.type === 'sell' || t.type === 'transfer_out') {
          let left = this.num(t.quantity);
          while (left > 0 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(left, lot.quantity);
            if (t.type === 'transfer_out') invested -= take * lot.costPerShare;
            lot.quantity -= take;
            left -= take;
            if (lot.quantity <= 0) lots.shift();
          }
        } else if (t.type === 'split' && this.num(t.quantity) > 0) {
          const ratio = this.num(t.quantity);
          lots.forEach(lot => { lot.quantity *= ratio; lot.costPerShare /= ratio; });
        }
      });
    });
    return invested;
  },

  /**
   * The most of the user's own money the portfolio ever had at work: the
   * peak, over time, of purchases (with fees) less sale proceeds (less fees),
   * all portfolio-wide in date order. A transfer out takes its cost basis
   * with it, as in getGrossInvested.
   *
   * The percentage's denominator. Gross purchases counted the same $1,000
   * twice when it was sold and bought back: buy 10 @100, sell @110, buy 10
   * @110, sell @121 made $210 on $1,000 and read +10%;
   * a 1,000-row import read -0.84% of $1.49M of turnover. Here it is +21%.
   */
  getPeakInvested(transactions) {
    const sorted = [...(transactions || [])].sort((a, b) => this.byDate(a, b));
    // Shares transferred out were never this portfolio's money at work: the
    // part of each purchase they came from (FIFO) is taken out of that
    // purchase altogether, as getGrossInvested does, so 6 shares left of 10
    // read +1,200% on the header as on the row.
    const removed = new Map();     // purchase -> fraction transferred out
    const lotsBy = {};
    sorted.forEach(t => {
      const key = t.holdingId || t.symbol || '_';
      const lots = (lotsBy[key] = lotsBy[key] || []);
      const qty = this.num(t.quantity);
      if (t.type === 'buy' || t.type === 'transfer_in') {
        if (qty > 0) lots.push({ tx: t, quantity: qty, fraction: 1 });
      } else if (t.type === 'sell' || t.type === 'transfer_out') {
        let left = qty;
        while (left > 0 && lots.length > 0) {
          const lot = lots[0];
          const take = Math.min(left, lot.quantity);
          const part = lot.fraction * (take / lot.quantity);
          if (t.type === 'transfer_out') removed.set(lot.tx, (removed.get(lot.tx) || 0) + part);
          lot.fraction -= part;
          lot.quantity -= take;
          left -= take;
          if (lot.quantity <= 1e-12) lots.shift();
        }
      } else if (t.type === 'split' && qty > 0) {
        lots.forEach(lot => { lot.quantity *= qty; });
      }
    });
    let running = 0;
    let peak = 0;
    sorted.forEach(t => {
      const fx = this.num(t.exchangeRate) || 1;
      const qty = this.num(t.quantity);
      if (t.type === 'buy' || t.type === 'transfer_in') {
        running += (qty * this.num(t.price) + this.num(t.fees)) * fx * (1 - (removed.get(t) || 0));
      } else if (t.type === 'sell') {
        running -= (qty * this.num(t.price) - this.num(t.fees)) * fx;
      }
      if (running > peak) peak = running;
    });
    return peak;
  },

  /**
   * Dividends received, net of the tax withheld, in the portfolio currency.
   * Only rows that carry shares and a per-share amount count; a stored row
   * of nothing is nothing.
   */
  getNetDividends(transactions) {
    return (transactions || [])
      .filter(t => t.type === 'dividend')
      .reduce((sum, t) => {
        const gross = this.num(t.quantity) * this.num(t.price) * (this.num(t.exchangeRate) || 1);
        return sum + gross * (1 - this.num(t.withholdingTaxPercent) / 100);
      }, 0);
  },

  /**
   * Calculate current value of a holding
   */
  getHoldingValue(quantity, currentPrice, exchangeRate = 1) {
    return quantity * currentPrice * exchangeRate;
  },

  /**
   * Calculate P&L for a single holding with currency breakdown
   */
  getHoldingPnL(holding, transactions, currentPrice, currentExchangeRate = 1) {
    const quantity = this.getHoldingQuantity(transactions);
    const costBasis = this.getCostBasisWithFX(transactions);
    const currentValue = this.getHoldingValue(quantity, currentPrice, currentExchangeRate);

    const totalPnl = currentValue - costBasis.totalCostInBase;
    const pnlPercent = costBasis.totalCostInBase > 0 ? (totalPnl / costBasis.totalCostInBase) * 100 : 0;

    // Calculate Price P&L vs Currency P&L
    // Price P&L: (currentPrice - avgCostInAssetCurrency) * quantity * currentExchangeRate
    // Currency P&L: avgCostInAssetCurrency * quantity * (currentExchangeRate - avgPurchaseExchangeRate)
    const avgPurchaseFX = costBasis.avgExchangeRate || 1;
    const valueAtPurchaseFX = quantity * currentPrice * avgPurchaseFX;
    const pricePnL = valueAtPurchaseFX - costBasis.totalCostInBase;
    const currencyPnL = quantity * currentPrice * (currentExchangeRate - avgPurchaseFX);

    return {
      quantity,
      avgCostPerShare: costBasis.avgCostPerShare,
      avgCostPerShareInAsset: costBasis.avgCostPerShareInAsset,
      avgPurchaseExchangeRate: avgPurchaseFX,
      totalCost: costBasis.totalCostInBase,
      totalCostInAssetCurrency: costBasis.totalCostInAsset,
      currentPrice,
      currentExchangeRate,
      currentValue,
      pnl: totalPnl,
      pnlPercent,
      pricePnL,
      currencyPnL
    };
  },

  /**
   * Calculate cost basis with exchange rate tracking
   */
  getCostBasisWithFX(transactions) {
    let totalSharesInAsset = 0;
    let totalCostInAsset = 0;
    let totalCostInBase = 0;

    // Open lots only -- see getOpenLots for why not every purchase.
    this.getOpenLots(transactions).forEach(lot => {
      const costInAsset = lot.quantity * (lot.price + lot.feePerShare);
      totalSharesInAsset += lot.quantity;
      totalCostInAsset += costInAsset;
      totalCostInBase += costInAsset * lot.exchangeRate;
    });

    const avgExchangeRate = totalCostInAsset > 0 ? totalCostInBase / totalCostInAsset : 1;

    return {
      totalCostInAsset,
      totalCostInBase,
      totalShares: totalSharesInAsset,
      avgCostPerShare: totalSharesInAsset > 0 ? totalCostInBase / totalSharesInAsset : 0,
      avgCostPerShareInAsset: totalSharesInAsset > 0 ? totalCostInAsset / totalSharesInAsset : 0,
      avgExchangeRate
    };
  },

  // ==================== PORTFOLIO CALCULATIONS ====================

  /**
   * Calculate total portfolio value
   */
  getTotalValue(holdingsWithData) {
    return holdingsWithData.reduce((total, h) => total + (h.currentValue || 0), 0);
  },

  /**
   * Calculate total portfolio cost
   */
  getTotalCost(holdingsWithData) {
    return holdingsWithData.reduce((total, h) => total + (h.totalCost || 0), 0);
  },

  /**
   * Calculate total portfolio P&L
   */
  getTotalPnL(holdingsWithData) {
    const totalValue = this.getTotalValue(holdingsWithData);
    const totalCost = this.getTotalCost(holdingsWithData);
    const pnl = totalValue - totalCost;
    const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

    return { pnl, pnlPercent };
  },

  /**
   * What the money made, open and closed, against everything paid in --
   * over the positions that can be valued.
   *
   * A holding with shares but no price has no value. The header already left
   * it out of Total Value, but its purchases stayed in the denominator, so
   * one delisted or "NA" symbol read as a -100% position and halved the
   * return (+66% instead of +109%), and the benchmark called a winning
   * portfolio "underperforming". Such a holding is
   * now left out of all three parts -- unrealized, realized and paid in --
   * and `excluded` says how many were, so the screen can say so. A holding
   * sold out entirely needs no price and always counts.
   *
   * `percent` is null when nothing can be measured: every open position is
   * unpriced and nothing was closed.
   */
  getTotalReturn(holdingsWithData, transactions) {
    const excludedIds = new Set(
      holdingsWithData
        .filter(h => h.priceUnavailable && this.num(h.quantity) > 0)
        .map(h => h.id)
    );
    const all = transactions || [];
    // Only the open shares of an unpriced position are unknown. What it has
    // already sold or been paid is booked: TWTR sold 4 of 10 at +$36.80 was
    // left out of the total along with the 6 still held.
    // Such a holding brings its money into the capital with its result; one
    // that has only been bought stays out entirely, as before.
    const realizedIds = new Set(all
      .filter(t => excludedIds.has(t.holdingId) && (t.type === 'sell' || t.type === 'transfer_out' || t.type === 'dividend'))
      .map(t => t.holdingId));
    const txs = all.filter(t => !excludedIds.has(t.holdingId) || realizedIds.has(t.holdingId));
    const priced = holdingsWithData.filter(h => !h.priceUnavailable);
    const unrealized = this.getTotalValue(priced) - this.getTotalCost(priced);
    const realized = this.getRealizedPnL(txs);
    const invested = this.getGrossInvested(txs);
    // Dividends are part of what the money made. They were recorded, shown in
    // the history and left out of the total, so a $2.13 dividend changed
    // nothing on the card. Net of withholding;
    // the card says "incl. dividends" when there are any.
    const dividends = this.getNetDividends(txs);
    const totalReturn = unrealized + realized + dividends;
    // Against the most money ever at work, not the turnover.
    const capital = this.getPeakInvested(txs);
    return {
      totalReturn,
      unrealized,
      realized,
      dividends,
      invested,
      capital,
      percent: capital > 0 ? (totalReturn / capital) * 100 : null,
      excluded: excludedIds.size,
    };
  },

  // ==================== MONEY-WEIGHTED RETURN ====================

  /** Days between two ISO dates. */
  daysBetween(a, b) {
    return (Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T00:00:00Z')) / 86400000;
  },

  /** An ISO date moved by whole days. */
  shiftDate(date, days) {
    const t = Date.parse(String(date).slice(0, 10) + 'T00:00:00Z');
    return new Date(t + days * 86400000).toISOString().slice(0, 10);
  },

  /**
   * The annual rate at which these flows net to nothing (XIRR), as a
   * fraction; null when there is none to find. A flow is { date, amount }:
   * money put in is negative, money taken out (and the value at the end)
   * positive. Bisection on the net present value, which is monotonic in the
   * rate for an investor's flows, so it cannot wander off the way Newton can.
   */
  xirr(flows) {
    const fs = (flows || []).filter(f => f && f.date && Number.isFinite(f.amount) && f.amount !== 0);
    if (!fs.some(f => f.amount < 0) || !fs.some(f => f.amount > 0)) return null;
    const t0 = fs.reduce((m, f) => (f.date < m ? f.date : m), fs[0].date);
    const years = fs.map(f => this.daysBetween(t0, f.date) / 365.25);
    if (Math.max(...years) <= 0) return null;
    const npv = (r) => fs.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, years[i]), 0);
    let lo = -0.9999;
    let hi = 1;
    while (npv(hi) > 0 && hi < 1e6) hi *= 2;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  },

  /**
   * The portfolio's cash flows in its own currency, oldest first, for a
   * money-weighted return: purchases and transfers in as money put in (a
   * transfer at its cost basis), sales and dividends as money taken out, a
   * transfer out at the cost of the lots it took. Holdings left out of the
   * total return (shares, no price) are left out here too.
   */
  getCashFlows(holdingsWithData, transactions) {
    const excludedIds = new Set(
      (holdingsWithData || [])
        .filter(h => h.priceUnavailable && this.num(h.quantity) > 0)
        .map(h => h.id)
    );
    const txs = (transactions || []).filter(t => !excludedIds.has(t.holdingId));
    const flows = [];
    const groups = {};
    txs.forEach(t => { const k = t.holdingId || t.symbol || '_'; (groups[k] = groups[k] || []).push(t); });
    Object.keys(groups).forEach(k => {
      const lots = [];
      [...groups[k]].sort((a, b) => this.byDate(a, b)).forEach(t => {
        const fx = this.num(t.exchangeRate) || 1;
        const q = this.num(t.quantity);
        const p = this.num(t.price);
        const fee = this.num(t.fees);
        if (t.type === 'buy' || t.type === 'transfer_in') {
          const cost = (q * p + fee) * fx;
          flows.push({ date: t.date, amount: -cost });
          if (q > 0) lots.push({ quantity: q, costPerShare: cost / q });
        } else if (t.type === 'sell' || t.type === 'transfer_out') {
          let left = q;
          let lotCost = 0;
          while (left > 0 && lots.length > 0) {
            const lot = lots[0];
            const take = Math.min(left, lot.quantity);
            lotCost += take * lot.costPerShare;
            lot.quantity -= take;
            left -= take;
            if (lot.quantity <= 0) lots.shift();
          }
          flows.push({ date: t.date, amount: t.type === 'sell' ? (q * p - fee) * fx : lotCost });
        } else if (t.type === 'split' && q > 0) {
          lots.forEach(lot => { lot.quantity *= q; lot.costPerShare /= q; });
        } else if (t.type === 'dividend') {
          flows.push({ date: t.date, amount: q * p * fx * (1 - this.num(t.withholdingTaxPercent) / 100) });
        }
      });
    });
    return flows.filter(f => f.date && f.amount).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },

  /**
   * Money-weighted annual return (IRR): what the money earned per year,
   * counting when each part of it went in. A simple "gain over everything
   * paid in, since the first trade" penalises a portfolio for money that
   * arrived late -- one SPY share in 2021 and ten in September 2026 showed
   * +5% beside SPY's +124% and an alpha of -118%, and Macro called it
   * +0.89% a year. Null when it cannot be
   * stated: nothing measurable, or under `minDays` days of history.
   */
  getMoneyWeightedReturn(holdingsWithData, transactions, today, minDays = 0) {
    const flows = this.getCashFlows(holdingsWithData, transactions);
    if (!flows.length) return null;
    const priced = (holdingsWithData || []).filter(h => !h.priceUnavailable);
    const endValue = this.getTotalValue(priced);
    const end = String(today || new Date().toISOString()).slice(0, 10);
    const days = this.daysBetween(flows[0].date, end);
    if (!(days >= Math.max(1, minDays))) return null;
    const all = endValue > 0 ? flows.concat([{ date: end, amount: endValue }]) : flows;
    const r = this.xirr(all);
    return r == null ? null : { annual: r * 100, days, flows, endValue, start: flows[0].date, end };
  },

  /**
   * The same cash flows run through a benchmark: each payment in buys the
   * index on its date, each payment out sells it, and what is left is valued
   * at the last close. The IRR of that, beside the portfolio's, is a like-for-
   * like comparison (a public-market-equivalent). `bars` are daily
   * { date, adjusted_close | close }, oldest first.
   */
  benchmarkReplica(flows, bars, end) {
    const px = (d) => { const a = this.toRate(d && d.adjusted_close); return a != null ? a : this.toRate(d && d.close); };
    const series = (bars || []).filter(d => d && d.date && px(d) != null);
    if (series.length < 2 || !(flows || []).length) return null;
    const priceOn = (date) => {
      let found = null;
      for (const d of series) { if (d.date <= date) found = d; else break; }
      return px(found || series[0]);
    };
    let shares = 0;
    flows.forEach(f => { shares += -f.amount / priceOn(f.date); });
    const last = series[series.length - 1];
    const endDate = String(end || last.date).slice(0, 10);
    const endValue = shares * px(last);
    const r = this.xirr(endValue > 0 ? flows.concat([{ date: endDate, amount: endValue }]) : flows);
    return r == null ? null : { annual: r * 100, endValue, shares };
  },

  /**
   * Calculate day change for portfolio
   */
  getDayChange(holdingsWithData) {
    return this.getDayChangeInfo(holdingsWithData).change;
  },

  /**
   * The day's move over the positions whose move is known: a close and the
   * close before it (dayKnown, set where the quotes are read). `known` and
   * `unknown` count open positions, so a portfolio where no day figure came
   * back reads N/A rather than $0.00.
   */
  getDayChangeInfo(holdingsWithData) {
    let change = 0, known = 0, unknown = 0;
    (holdingsWithData || []).forEach(h => {
      if (!(this.num(h.quantity) > 0)) return;
      const ok = !h.priceUnavailable && h.dayKnown !== false && h.currentPrice && h.previousClose > 0;
      if (!ok) { unknown++; return; }
      known++;
      change += this.dayChangeValue(h.currentPrice, h.previousClose, h.quantity, h.currentExchangeRate || 1, h.dayBought);
    });
    return { change, known, unknown };
  },

  /**
   * Shares still held that were bought on or after `sinceDay` (YYYY-MM-DD,
   * the day of the latest quote), and what was paid for them. Sales consume
   * the oldest lots first, as everywhere else here.
   */
  getDayBought(transactions, sinceDay) {
    const day = String(sinceDay || '').slice(0, 10);
    if (!day) return { quantity: 0, cost: 0 };
    return this.getOpenLots(transactions || []).reduce((acc, lot) => {
      if (lot.date && lot.date >= day && lot.quantity > 0) {
        acc.quantity += lot.quantity;
        acc.cost += lot.quantity * lot.price;
      }
      return acc;
    }, { quantity: 0, cost: 0 });
  },

  /**
   * One position's move today, in the portfolio's currency. Shares held
   * since before today moved from the previous close; shares bought today
   * moved from what was paid for them -- yesterday they were not held, and
   * counting them from the previous close gave a position bought at the
   * current price a Day P&L next to a Total Return of $0.00.
   * The row, the header card and the AI table all read this one function.
   */
  dayChangeValue(price, previousClose, quantity, fx, dayBought) {
    const qty = this.num(quantity);
    const rate = fx || 1;
    let change = (price - previousClose) * qty * rate;
    const bought = dayBought && this.num(dayBought.quantity) > 0 ? Math.min(this.num(dayBought.quantity), qty) : 0;
    if (bought > 0) {
      const paid = this.num(dayBought.cost) / this.num(dayBought.quantity);
      change += (previousClose - paid) * bought * rate;
    }
    return change;
  },

  /**
   * Calculate total Price P&L for portfolio
   */
  getTotalPricePnL(holdingsWithData) {
    return holdingsWithData.reduce((total, h) => total + (h.pricePnL || 0), 0);
  },

  /**
   * Calculate total Currency P&L for portfolio
   */
  getTotalCurrencyPnL(holdingsWithData) {
    return holdingsWithData.reduce((total, h) => total + (h.currencyPnL || 0), 0);
  },

  // ==================== P&L BREAKDOWN ====================

  /**
   * Calculate price P&L vs currency P&L
   * Price P&L: gain from asset price changes (in original currency)
   * Currency P&L: gain from exchange rate changes
   */
  getPnLBreakdown(holding, transactions, currentPrice, currentExchangeRate, purchaseExchangeRate) {
    const quantity = this.getHoldingQuantity(transactions);
    const { totalCost } = this.getCostBasis(transactions);

    // Value at current price in original currency
    const valueInOriginalCurrency = quantity * currentPrice;

    // Cost in original currency (before FX)
    const costInOriginalCurrency = totalCost / purchaseExchangeRate;

    // Price P&L (in base currency at current FX)
    const pricePnL = (valueInOriginalCurrency - costInOriginalCurrency) * currentExchangeRate;

    // Currency P&L (change in FX rate applied to original value)
    const currencyPnL = costInOriginalCurrency * (currentExchangeRate - purchaseExchangeRate);

    return {
      pricePnL,
      currencyPnL,
      totalPnL: pricePnL + currencyPnL
    };
  },

  /**
   * Calculate dividend income
   */
  getDividendIncome(transactions, withholdingTaxPercent = 0) {
    const dividends = transactions.filter(t => t.type === 'dividend');

    const gross = (t) => this.num(t.quantity) * this.num(t.price) * (this.num(t.exchangeRate) || 1);
    const grossIncome = dividends.reduce((total, t) => total + gross(t), 0);

    const taxWithheld = dividends.reduce((total, t) => {
      const taxRate = this.num(t.withholdingTaxPercent) || withholdingTaxPercent;
      return total + (gross(t) * taxRate / 100);
    }, 0);

    return {
      grossIncome,
      taxWithheld,
      netIncome: grossIncome - taxWithheld
    };
  },

  /**
   * Calculate realized P&L (from sells)
   */
  getRealizedPnL(transactions) {
    // FIFO within each holding. This used to run one queue over the whole
    // portfolio, so a sale of MSFT could consume an AAPL lot bought earlier
    // and realize the difference between two unrelated prices. Grouped by
    // holding, with the fallback of symbol for rows that carry no id.
    //
    // In base currency, like every other figure on the screen: the lot's
    // cost at the rate it was bought, the proceeds at the rate it was sold.
    // Fees on both sides come off the gain.
    const groups = {};
    transactions.forEach(t => {
      const key = t.holdingId || t.symbol || '_';
      (groups[key] = groups[key] || []).push(t);
    });

    let realizedPnL = 0;
    Object.keys(groups).forEach(key => {
      const lots = [];
      [...groups[key]]
        .sort((a, b) => this.byDate(a, b))
        .forEach(t => {
          if (t.type === 'buy' || t.type === 'transfer_in') {
            const qty = this.num(t.quantity);
            lots.push({
              quantity: qty,
              price: this.num(t.price),
              feePerShare: qty > 0 ? this.num(t.fees) / qty : 0,
              exchangeRate: this.num(t.exchangeRate) || 1
            });
          } else if (t.type === 'sell' || t.type === 'transfer_out') {
            const sellFX = this.num(t.exchangeRate) || 1;
            // A transfer out is a move between accounts, not a disposal: the
            // shares leave, nothing is realized. It shared this branch with a
            // sale, so `Transfer_out,4,0` -- a broker export, which usually
            // carries no price -- booked the whole cost as a loss (-$400).
            const isSale = t.type === 'sell';
            const sellQty = this.num(t.quantity);
            const sellPrice = this.num(t.price);
            let left = sellQty;

            while (left > 0 && lots.length > 0) {
              const lot = lots[0];
              const take = Math.min(left, lot.quantity);

              if (isSale) {
                realizedPnL += take * (sellPrice * sellFX - (lot.price + lot.feePerShare) * lot.exchangeRate);
              }

              lot.quantity -= take;
              left -= take;
              if (lot.quantity <= 0) lots.shift();
            }

            // The sell fee comes off in proportion to what was actually
            // closed. Shares a sale could not match -- a row selling more than
            // was held, or a zero-quantity row -- realize nothing, fee included.
            const matched = sellQty - left;
            if (isSale && sellQty > 0 && matched > 0) {
              realizedPnL -= this.num(t.fees) * sellFX * (matched / sellQty);
            }
          } else if (t.type === 'split' && this.num(t.quantity) > 0) {
            const ratio = this.num(t.quantity);
            lots.forEach(lot => {
              lot.quantity *= ratio;
              lot.price /= ratio;
              lot.feePerShare /= ratio;
            });
          }
        });
    });

    return realizedPnL;
  },

  // ==================== UNIQUE METRICS ====================

  /**
   * Calculate real return (adjusted for inflation)
   */
  getRealReturn(nominalReturnPercent, inflationPercent) {
    // Fisher equation: (1 + nominal) = (1 + real) * (1 + inflation)
    const realReturn = ((1 + nominalReturnPercent / 100) / (1 + inflationPercent / 100) - 1) * 100;
    return realReturn;
  },

  /**
   * Calculate yield on cost (dividend yield based on cost basis)
   */
  getYieldOnCost(annualDividendPerShare, avgCostPerShare) {
    if (avgCostPerShare <= 0) return 0;
    return (annualDividendPerShare / avgCostPerShare) * 100;
  },

  /**
   * Calculate portfolio beta (weighted average)
   */
  getPortfolioBeta(holdingsWithBeta) {
    const totalValue = holdingsWithBeta.reduce((sum, h) => sum + h.currentValue, 0);
    if (totalValue === 0) return 1;

    return holdingsWithBeta.reduce((beta, h) => {
      const weight = h.currentValue / totalValue;
      return beta + (h.beta || 1) * weight;
    }, 0);
  },

  /**
   * Compare return vs risk-free rate
   */
  getVsRiskFree(portfolioReturnPercent, riskFreeRatePercent) {
    return {
      portfolioReturn: portfolioReturnPercent,
      riskFreeRate: riskFreeRatePercent,
      spread: portfolioReturnPercent - riskFreeRatePercent,
      beatRiskFree: portfolioReturnPercent > riskFreeRatePercent
    };
  },

  /**
   * Calculate Sharpe Ratio
   */
  getSharpeRatio(portfolioReturnPercent, riskFreeRatePercent, volatilityPercent) {
    if (volatilityPercent === 0) return 0;
    return (portfolioReturnPercent - riskFreeRatePercent) / volatilityPercent;
  },

  // ==================== GOAL CALCULATIONS ====================

  /**
   * Calculate goal progress
   */
  getGoalProgress(currentValue, goal) {
    if (!goal || !goal.targetAmount) return null;

    const progress = (currentValue / goal.targetAmount) * 100;
    const remaining = goal.targetAmount - currentValue;

    // Calculate if on track
    const targetDate = new Date(goal.targetDate);
    const now = new Date();
    const totalDays = (targetDate - new Date(goal.createdAt || now)) / (1000 * 60 * 60 * 24);
    const daysPassed = (now - new Date(goal.createdAt || now)) / (1000 * 60 * 60 * 24);
    const expectedProgress = totalDays > 0 ? (daysPassed / totalDays) * 100 : 0;

    const monthsRemaining = Math.max(0, (targetDate - now) / (1000 * 60 * 60 * 24 * 30));
    const requiredMonthly = monthsRemaining > 0 ? remaining / monthsRemaining : 0;

    return {
      currentValue,
      targetAmount: goal.targetAmount,
      progress: Math.min(progress, 100),
      remaining: Math.max(remaining, 0),
      isOnTrack: progress >= expectedProgress,
      monthsRemaining: Math.ceil(monthsRemaining),
      requiredMonthly,
      completed: progress >= 100
    };
  },

  // ==================== ALLOCATION ====================

  /**
   * Calculate allocation by type
   */
  getAllocationByType(holdingsWithData) {
    const totalValue = this.getTotalValue(holdingsWithData);
    if (totalValue === 0) return [];

    const byType = {};
    holdingsWithData.forEach(h => {
      const type = h.type || 'other';
      byType[type] = (byType[type] || 0) + h.currentValue;
    });

    return Object.entries(byType).map(([type, value]) => ({
      type,
      value,
      percent: (value / totalValue) * 100
    })).sort((a, b) => b.value - a.value);
  },

  /**
   * Calculate allocation by sector
   */
  // Nothing sets a holding's sector when it is added, so every portfolio used
  // to read "Other 100%" -- and the risk tab then warned that "Other" was
  // over 40% of it and raised the risk score.
  // A sector is filled in once fundamentals have been read for the holding
  // (PortfolioAnalytics); until then it is "Unclassified", and a portfolio
  // with no classified holding at all has no sector breakdown.
  UNCLASSIFIED_SECTOR: 'Unclassified',
  // An ETF or a fund spans sectors and has no General.Sector, so it read
  // "Unclassified" (p.12). Its own sector weights are not used for a
  // look-through: EODHD's ETF sector breakdown is Morningstar's data, which
  // the terminal does not use.
  FUND_SECTOR: 'Funds (diversified)',

  sectorOf(h) {
    // The type first: an ETF carrying a stored sector (an import, an older
    // backfill) is still a fund, not a concentrated sector.
    const type = String((h && h.type) || '').toLowerCase();
    if (type === 'etf' || type === 'fund' || type === 'mutual_fund') return this.FUND_SECTOR;
    return (h && h.sector) || null;
  },

  getAllocationBySector(holdingsWithData) {
    const totalValue = this.getTotalValue(holdingsWithData);
    if (totalValue === 0) return [];
    if (!holdingsWithData.some(h => this.sectorOf(h))) return [];

    const bySector = {};
    holdingsWithData.forEach(h => {
      const sector = this.sectorOf(h) || this.UNCLASSIFIED_SECTOR;
      bySector[sector] = (bySector[sector] || 0) + h.currentValue;
    });

    return Object.entries(bySector).map(([sector, value]) => ({
      sector,
      value,
      percent: (value / totalValue) * 100
    })).sort((a, b) => b.value - a.value);
  },

  /**
   * Get allocation by country/region
   */
  getAllocationByCountry(holdingsWithData) {
    const totalValue = this.getTotalValue(holdingsWithData);
    if (totalValue === 0) return [];

    // Map exchange suffixes to countries
    const exchangeToCountry = {
      'US': { name: 'USA', flag: '🇺🇸' },
      'NYSE': { name: 'USA', flag: '🇺🇸' },
      'NASDAQ': { name: 'USA', flag: '🇺🇸' },
      'LSE': { name: 'UK', flag: '🇬🇧' },
      'LON': { name: 'UK', flag: '🇬🇧' },
      'TSX': { name: 'Canada', flag: '🇨🇦' },
      'TO': { name: 'Canada', flag: '🇨🇦' },
      'XETRA': { name: 'Germany', flag: '🇩🇪' },
      'DE': { name: 'Germany', flag: '🇩🇪' },
      'PA': { name: 'France', flag: '🇫🇷' },
      'AS': { name: 'Netherlands', flag: '🇳🇱' },
      'MI': { name: 'Italy', flag: '🇮🇹' },
      'MC': { name: 'Spain', flag: '🇪🇸' },
      'SW': { name: 'Switzerland', flag: '🇨🇭' },
      'HK': { name: 'Hong Kong', flag: '🇭🇰' },
      'HKEX': { name: 'Hong Kong', flag: '🇭🇰' },
      'SH': { name: 'China', flag: '🇨🇳' },
      'SZ': { name: 'China', flag: '🇨🇳' },
      'T': { name: 'Japan', flag: '🇯🇵' },
      'TSE': { name: 'Japan', flag: '🇯🇵' },
      'KS': { name: 'South Korea', flag: '🇰🇷' },
      'KQ': { name: 'South Korea', flag: '🇰🇷' },
      'AU': { name: 'Australia', flag: '🇦🇺' },
      'ASX': { name: 'Australia', flag: '🇦🇺' },
      'SG': { name: 'Singapore', flag: '🇸🇬' },
      'BO': { name: 'India', flag: '🇮🇳' },
      'NS': { name: 'India', flag: '🇮🇳' },
      'SA': { name: 'Brazil', flag: '🇧🇷' },
      'MX': { name: 'Mexico', flag: '🇲🇽' },
      'CC': { name: 'Crypto', flag: 'CC' },
      'FOREX': { name: 'Forex', flag: 'FX' },
    };

    const byCountry = {};
    holdingsWithData.forEach(h => {
      let country = { name: 'Other', flag: '--' };

      if (h.symbol) {
        const parts = h.symbol.split('.');
        const exchange = parts[parts.length - 1]?.toUpperCase();
        if (exchangeToCountry[exchange]) {
          country = exchangeToCountry[exchange];
        }
      } else if (h.type === 'manual') {
        country = { name: 'Manual', flag: '--' };
      }

      const key = country.name;
      if (!byCountry[key]) {
        byCountry[key] = { value: 0, flag: country.flag };
      }
      byCountry[key].value += h.currentValue || 0;
    });

    return Object.entries(byCountry).map(([country, data]) => ({
      country,
      flag: data.flag,
      value: data.value,
      percent: (data.value / totalValue) * 100
    })).sort((a, b) => b.value - a.value);
  },

  /**
   * Calculate allocation by currency
   */
  getAllocationByCurrency(holdingsWithData) {
    const totalValue = this.getTotalValue(holdingsWithData);
    if (totalValue === 0) return [];

    const byCurrency = {};
    holdingsWithData.forEach(h => {
      const currency = h.currency || 'USD';
      byCurrency[currency] = (byCurrency[currency] || 0) + h.currentValue;
    });

    return Object.entries(byCurrency).map(([currency, value]) => ({
      currency,
      value,
      percent: (value / totalValue) * 100
    })).sort((a, b) => b.value - a.value);
  },

  // ==================== CSV IMPORT: SYMBOLS ====================

  /**
   * Exchange codes a CSV may name -- in an exchange column or as a ticker
   * suffix ("RY.TO", "VOD.LSE") -- and the currency each quotes in when
   * nothing better is known. LSE is pence (GBX).
   */
  // No SG: the code readers take ".SG" as Yahoo's Stuttgart (EODHD STU), and
  // SG here was Singapore in SGD -- a Singapore trade read twice landed on a
  // Stuttgart listing. EODHD lists no Singapore.
  IMPORT_EXCHANGE_CCY: { US: 'USD', LSE: 'GBX', XETRA: 'EUR', F: 'EUR', PA: 'EUR', AS: 'EUR', MC: 'EUR', MI: 'EUR', BR: 'EUR', LS: 'EUR', VI: 'EUR', IR: 'EUR', TO: 'CAD', V: 'CAD', NEO: 'CAD', AU: 'AUD', HK: 'HKD', TSE: 'JPY', SW: 'CHF', ST: 'SEK', CO: 'DKK', OL: 'NOK', HE: 'EUR', KO: 'KRW', KQ: 'KRW', NSE: 'INR', BSE: 'INR', SA: 'BRL', MX: 'MXN', TA: 'ILA', WAR: 'PLN', IS: 'TRY', JSE: 'ZAC', SHG: 'CNY', SHE: 'CNY', TW: 'TWD', NZ: 'NZD',
    // The rest of EODHD's exchanges-list, each with the currency it
    // states: a listing there had no currency, and Add Position priced
    // 1155.KLSE's ringgit as dollars. The Zimbabwe venues
    // are left out: the list says ZWL, which they no longer trade in.
    STU: 'EUR', MU: 'EUR', HA: 'EUR', DU: 'EUR', HM: 'EUR', BE: 'EUR', LU: 'EUR', AT: 'EUR', ZSE: 'EUR', CN: 'CAD',
    PR: 'CZK', BUD: 'HUF', RO: 'RON', IC: 'ISK', KLSE: 'MYR', BK: 'THB', JK: 'IDR', PSE: 'PHP', VN: 'VND', TWO: 'TWD',
    KAR: 'PKR', CM: 'LKR', SR: 'SAR', BA: 'ARS', SN: 'CLP', LIM: 'PEN', EGX: 'EGP', BC: 'MAD', XNSA: 'NGN', GSE: 'GHS',
    XNAI: 'KES', USE: 'UGX', RSE: 'RWF', DSE: 'TZS', SEM: 'MUR', MSE: 'MWK', LUSE: 'ZMW', XBOT: 'BWP' },

  /**
   * The currencies a portfolio can be kept in. The picker offered RUB but not
   * CAD, AUD or HKD, which the importer and the rates already handle.
   */
  BASE_CURRENCIES: [
    ['USD', 'US Dollar'], ['EUR', 'Euro'], ['GBP', 'British Pound'], ['CHF', 'Swiss Franc'],
    ['JPY', 'Japanese Yen'], ['CAD', 'Canadian Dollar'], ['AUD', 'Australian Dollar'],
    ['HKD', 'Hong Kong Dollar'], ['SGD', 'Singapore Dollar'], ['SEK', 'Swedish Krona'],
    ['NOK', 'Norwegian Krone'], ['DKK', 'Danish Krone'], ['PLN', 'Polish Zloty'],
    ['INR', 'Indian Rupee'], ['RUB', 'Russian Ruble'],
  ],

  /**
   * Interactive Brokers' listing-exchange codes, as EODHD names the venue.
   * IB's "TSE" is Toronto -- EODHD's TSE is Tokyo -- so RY on IB's TSE became
   * RY.TSE, a Tokyo code that does not exist, quoted in yen. Codes EODHD also uses (TSE) are translated only in an IB file;
   * the rest are IB's own and always mean the venue here.
   * SGX (Singapore) is "SI", the code readers' market EODHD does not list
   * (window.SymbolCode.UNLISTED): its rows are said, never imported. It was
   * "SG", which the readers take as Yahoo's Stuttgart, so an SGX trade could
   * land on a Stuttgart listing. No target here is a
   * Yahoo suffix (the tests walks them).
   */
  IB_EXCHANGES: {
    TSE: 'TO', VENTURE: 'V', IBIS: 'XETRA', IBIS2: 'XETRA', FWB: 'F', FWB2: 'F', SWB: 'STU',
    AEB: 'AS', SBF: 'PA', 'ENEXT.BE': 'BR', EBS: 'SW', VIRTX: 'SW', LSEETF: 'LSE', SEHK: 'HK',
    TSEJ: 'TSE', ASX: 'AU', BVME: 'MI', BM: 'MC', SFB: 'ST', KFB: 'CO', OSE: 'OL', HEX: 'HE',
    VSE: 'VI', BVL: 'LS', ISED: 'IR', SGX: 'SI', WSE: 'WAR', MEXI: 'MX', BOVESPA: 'SA',
  },

  /**
   * A broker's name for a venue, as EODHD's exchange code: American venues
   * are "US"; Interactive Brokers' codes are translated (IB_EXCHANGES).
   * `format` is the file's broker layout ('ib' translates IB's TSE).
   */
  importExchange(exchange, format) {
    const e = this.importUnseen(exchange || '').trim().toUpperCase();
    if (/^(NASDAQ|NYSE|AMEX|BATS|ARCA|NYSEARCA|NYSE ARCA|NMS|NYQ|NGM|NCM|ISLAND|IBKRATS|DRCTEDGE|EDGEA|EDGX|BYX|BEX|IEX|PSX|CHX|NYSENAT|PEARL|MEMX|LTSE|IBEOS|SMART|PINK|OTC|OTCBB)$/.test(e)) return 'US';
    const ib = this.IB_EXCHANGES[e];
    if (ib && (format === 'ib' || !this.IMPORT_EXCHANGE_CCY[e])) return ib;
    return e;
  },

  /**
   * The currency a crypto or forex symbol is quoted in: the second half of
   * the pair (BTC-USD.CC is USD, EURUSD.FOREX is USD). Null for the rest.
   */
  importPairCurrency(full) {
    const m = String(full || '').toUpperCase().match(/^(.+)\.(CC|FOREX)$/);
    if (!m) return null;
    if (m[2] === 'CC') { const q = m[1].split('-')[1]; return /^[A-Z]{3}$/.test(q || '') ? q : null; }
    return /^[A-Z]{6}$/.test(m[1]) ? m[1].slice(3) : null;
  },

  /** The holding type a symbol says: crypto for .CC, forex for .FOREX, else null. */
  importSymbolType(full) {
    const ex = String(full || '').toUpperCase().split('.').pop();
    return ex === 'CC' ? 'crypto' : ex === 'FOREX' ? 'forex' : null;
  },

  // Every ETF the portfolio templates hold, by full code, checked against the
  // EODHD search (Type "ETF") on 06.10. Templates and a What-If typed by hand
  // have no search hit to read the type from, so All Weather's SPY, TLT, GLD,
  // IEF and DBC were all "Stocks". PBA, WES, FM.TO are
  // companies, not funds.
  KNOWN_ETFS: new Set([
    'AFK', 'AGG', 'AMLP', 'ARKK', 'BIL', 'BND', 'BOND', 'DBA', 'DBC', 'EEM', 'EEMA',
    'EWA', 'EWC', 'EWJ', 'EWL', 'EWU', 'EWY', 'EWZ', 'EZA', 'FPE', 'FXI', 'GBTC', 'GLD',
    'HYG', 'ICLN', 'IEF', 'INDA', 'IXUS', 'JEPI', 'JEPQ', 'KSA', 'KWEB', 'LQD', 'NLR',
    'PFF', 'PGF', 'PHO', 'PSK', 'QAT', 'QQQ', 'QYLD', 'REMX', 'RYLD', 'SCHD', 'SHE', 'SHY',
    'SPY', 'TAN', 'TIP', 'TLT', 'UAE', 'URA', 'VEA', 'VNQ', 'VOO', 'VRP', 'VTI', 'VUG',
    'VWO', 'VXUS', 'VYM', 'XLE', 'XLF', 'XLK', 'XLP', 'XLV', 'XYLD',
  ].map(c => c + '.US')),

  /**
   * A status colour as text that reads at AA (4.6:1) on the theme's worst
   * ground -- the same rule as a11yColor.js, carried here because the
   * portfolio app does not always load that module: where it did not, every
   * fix routed through it fell back to the raw colour and Low/High, Fair,
   * Macro and Research stayed at 3.3-4.5:1. `ground` overrides
   * the theme's.
   */
  ink(color, isDark, ground) {
    if (typeof window !== 'undefined' && window.A11yColor && !ground) return window.A11yColor.text(color, isDark);
    const parse = (c) => {
      const s = String(c || '').trim();
      let m = s.match(/^#([0-9a-f]{3})$/i);
      if (m) return m[1].split('').map(h => parseInt(h + h, 16));
      m = s.match(/^#([0-9a-f]{6})$/i);
      if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
      m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      return m ? [+m[1], +m[2], +m[3]] : null;
    };
    const lum = (rgb) => { const [r, g, b] = rgb.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hex = (rgb) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    const f = parse(color);
    const b = parse(ground || (isDark ? '#2b2924' : '#e2e1dc'));
    if (!f || !b || ratio(f, b) >= 4.6) return color;
    const toward = lum(b) > 0.18 ? [0, 0, 0] : [255, 255, 255];
    for (let t = 0.02; t <= 1; t += 0.02) {
      const mix = f.map((v, i) => Math.round(v * (1 - t) + toward[i] * t));
      if (ratio(mix, b) >= 4.6) return hex(mix);
    }
    return hex(toward);
  },

  /**
   * A holding's dividend yield as a fraction, from whichever block EODHD
   * fills for its kind, or null. Stocks: Highlights.DividendYield, a fraction
   * (AAPL 0.0032). ETFs: ETF_Data.Yield, a PERCENT (VOO "1.060000" = 1.06 %).
   * Mutual funds: MutualFund_Data.Yield, a fraction (VFIAX "0.0103"). Read
   * only from Highlights, a VOO at half the portfolio added $0 to the income
   * forecast. Checked live on 07.10.
   */
  dividendYieldOf(fundamentals) {
    const f = fundamentals || {};
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };
    const stock = num(f.Highlights && f.Highlights.DividendYield);
    if (stock != null) return stock;
    const etf = num(f.ETF_Data && f.ETF_Data.Yield);
    if (etf != null) return etf / 100;
    const fund = num(f.MutualFund_Data && f.MutualFund_Data.Yield);
    if (fund != null) return fund;
    return null;
  },

  /** crypto / forex from the suffix, etf from KNOWN_ETFS; null when unknown. */
  knownAssetType(full) {
    const sym = String(full || '').trim().toUpperCase();
    const bySuffix = this.importSymbolType(sym);
    if (bySuffix) return bySuffix;
    const withEx = sym.includes('.') ? sym : sym + '.US';
    return this.KNOWN_ETFS.has(withEx) ? 'etf' : null;
  },

  /** The holding type an EODHD search row names. */
  typeFromSearchRow(row) {
    const t = String((row && row.Type) || '');
    if (row && row.Exchange === 'CC') return 'crypto';
    if (row && row.Exchange === 'FOREX') return 'forex';
    return /etf/i.test(t) ? 'etf' : /fund/i.test(t) ? 'fund' : /bond/i.test(t) ? 'bond' : 'stock';
  },

  /**
   * The full EODHD symbol a CSV row names, when it can be known without a
   * search: an exchange column, a plain US-looking code, or a suffix that is
   * an exchange. Null for the rest (BRK.B), which the importer resolves by
   * searching and checks again once resolved.
   */
  importSymbolGuess(symbol, exchange) {
    let raw = String(symbol || '').trim().toUpperCase();
    const exch = this.importExchange(exchange);
    if (!raw) return null;
    if (exch) {
      if (raw.endsWith('.' + exch)) raw = raw.slice(0, -(exch.length + 1));
      // Yahoo's suffix for that exchange ("VOD.L" with "LSE") is no share
      // class: VOD.LSE, not VOD-L.LSE.
      else {
        const Y = typeof window !== 'undefined' && window.SymbolCode ? window.SymbolCode.YAHOO : null;
        const d = raw.lastIndexOf('.');
        if (Y && d > 0 && Y[raw.slice(d + 1)] === exch) raw = raw.slice(0, d);
      }
      return `${raw.replace('.', '-')}.${exch}`;
    }
    if (/^[A-Z]{1,5}$/.test(raw)) return `${raw}.US`;
    const m = raw.match(/^(.+)\.([A-Z]{1,6})$/);
    // Crypto and forex keep their EODHD names: BTC-USD.CC became
    // BTC-USD-CC.US, a stock no one quotes.
    if (m && (this.IMPORT_EXCHANGE_CCY[m[2]] || m[2] === 'CC' || m[2] === 'FOREX')) return raw;
    return null;
  },

  /**
   * One key per trade, for spotting rows a portfolio already holds. Keyed by
   * the full symbol on both sides: the stored side used to be cut to the
   * bare code ("VOD") while a CSV row kept its suffix ("VOD.LSE"), so the
   * two never matched and re-importing the same file doubled the position
   * -- and a bare code would have
   * matched VOD.US against VOD.LSE the other way round.
   */
  importTxKey(fullSymbol, date, type, quantity, price) {
    return [String(fullSymbol || '').toUpperCase(), date, type, Number(quantity), Number(price)].join('|');
  },

  // ==================== CSV IMPORT: PARSING ====================

  /**
   * Rows out of a CSV file. The delimiter is the one the header line uses
   * most -- a European spreadsheet saves with ";" because "," is its decimal
   * point. Quoted fields keep their delimiters and "" is a quote. Blank lines
   * and a broker's end-of-file marker (TD Ameritrade's "***END OF FILE***")
   * are not rows.
   */
  parseCSVText(text) {
    const normalized = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const lines = normalized.split('\n').filter(l => l.trim().length > 0 && !/^\*{3}\s*END OF FILE/i.test(l.trim()));
    if (lines.length < 2) throw new Error('CSV must have at least a header and one data row');
    // An Interactive Brokers Activity Statement is many tables in one file,
    // each with its own header; it opened as a mapping screen with nothing to
    // map. Its trades carry no listing exchange, so
    // a Flex Query is the export that can be imported.
    if (/^"?Statement"?\s*,\s*"?Header"?\s*,/i.test(lines[0])) {
      throw new Error('this is an Interactive Brokers Activity Statement, which is not supported. In IB, export a Flex Query with the Trades section (Symbol, ListingExchange, CurrencyPrimary, TradeDate, Buy/Sell, Quantity, TradePrice, IBCommission) as CSV, and import that.');
    }
    const count = (line, ch) => {
      let n = 0; let q = false;
      for (const c of line) { if (c === '"') q = !q; else if (c === ch && !q) n++; }
      return n;
    };
    const delimiter = [',', ';', '\t'].reduce((best, ch) => (count(lines[0], ch) > count(lines[0], best) ? ch : best), ',');
    const parseLine = (line) => {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
        } else if (c === delimiter && !q) { out.push(cur.trim()); cur = ''; } else cur += c;
      }
      out.push(cur.trim());
      return out;
    };
    // A trailing delimiter on every line (TD Ameritrade) is one empty column,
    // not a mismatch.
    let headers = parseLine(lines[0]);
    let rows = lines.slice(1).map(parseLine);
    if (headers.length > 1 && headers[headers.length - 1] === '') {
      headers = headers.slice(0, -1);
      rows = rows.map(r => (r.length === headers.length + 1 && r[r.length - 1] === '' ? r.slice(0, -1) : r));
    }
    return { headers, rows, delimiter };
  },

  /**
   * Which column is which, from the header names.
   *
   * Each field has its names in order of preference and a column is taken
   * once. It used to be first-substring-wins with the last match kept, so
   * "Amount" -- money -- was read as the share count (10 shares became 1,801),
   * TD Ameritrade's "TRANSACTION ID" became the type and its "FUND
   * REDEMPTION FEE" the fees, and Interactive Brokers' "Buy/Sell" was never
   * found. `format` names a broker
   * layout when the headers are recognisably one.
   */
  importAutoMap(headers) {
    const h = (headers || []).map(x => String(x || '').trim().toLowerCase().replace(/\s+/g, ' '));
    const taken = new Set();
    const pick = (tests) => {
      for (const test of tests) {
        const i = h.findIndex((name, idx) => !taken.has(idx) && test(name));
        if (i !== -1) { taken.add(i); return String(i); }
      }
      return '';
    };
    const is = (...names) => (n) => names.includes(n);
    const has = (word, not) => (n) => n.includes(word) && !(not && not.test(n));
    const mapping = {};
    mapping.symbol = pick([is('symbol', 'ticker', 'code', 'instrument'), has('symbol', /underlying|description/), has('ticker')]);
    mapping.exchange = pick([is('exchange', 'listingexchange', 'listing exchange', 'mic', 'market'), has('exchange', /rate|fee/)]);
    mapping.date = pick([is('tradedate', 'trade date', 'date', 'transaction date', 'trade_date'), has('trade date'), has('date', /settle|report|value date|ex-date|pay/), has('date')]);
    mapping.type = pick([
      is('buy/sell', 'type', 'action', 'side', 'transaction type', 'trans type', 'trade type', 'activity', 'b/s', 'buy sell'),
      has('buy/sell'),
      (n) => /\b(type|action|side)\b/.test(n) && !/\bid\b|code|currency|asset|security/.test(n),
    ]);
    mapping.quantity = pick([is('quantity', 'qty', 'shares', 'units', 'number of shares', 'no. of shares'), has('quantity'), has('shares', /price|value/), has('qty')]);
    mapping.price = pick([is('price', 'tradeprice', 'trade price', 't. price', 'price per share', 'unit price', 'execution price'), (n) => n.includes('price') && !/close|market|mark|total/.test(n)]);
    mapping.fees = pick([is('commission', 'fees', 'fee', 'ibcommission', 'comm/fee', 'commissions'), has('commission'), (n) => /\bfees?\b/.test(n) && !/redemption|deferred|sales charge|reg fee|short-term/.test(n)]);
    // The currency the price is in, when the broker says (IB: CurrencyPrimary).
    mapping.currency = pick([is('currencyprimary', 'currency', 'ccy', 'trade currency', 'price currency')]);
    // No type column: TD Ameritrade puts "Bought 10 AAPL @ 180.5" in the
    // description, and that is where the type is read from.
    if (!mapping.type) mapping.type = pick([is('description', 'transaction description')]);
    const format = h.includes('transaction id') && h.includes('description') ? 'tda'
      : (h.includes('buy/sell') || h.includes('ibcommission') || h.includes('tradeprice')) ? 'ib'
      : null;
    return { mapping, format };
  },

  /** What a cell says about the decimal separator: ',' or '.', or null. */
  _decimalVote(cell) {
    const s = String(cell ?? '').trim().replace(/[$€£¥₽₹\s '’]/g, '').replace(/^\((.*)\)$/, '$1').replace(/^[-+]/, '');
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    const commas = (s.match(/,/g) || []).length;
    const dots = (s.match(/\./g) || []).length;
    if (commas && dots) return s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const sep = commas ? ',' : dots ? '.' : null;
    if (!sep) return null;
    if ((commas || dots) > 1) return sep === ',' ? '.' : ',';   // 1,234,567 / 1.234.567: grouping
    const [intPart, frac] = s.split(sep);
    // "180,50" or "0,1234": not three digits after it, so not grouping. Three
    // digits is grouping or a decimal -- unless the whole part is 0, which no
    // one groups ("0,125" is an eighth, never 125).
    if (frac.length !== 3 || /^0*$/.test(intPart)) return sep;
    return null;
  },

  /** The decimal separator of the user's locale, '.' when it cannot be had. */
  localeDecimal(locale) {
    try {
      const part = new Intl.NumberFormat(locale || undefined).formatToParts(1.5).find(p => p.type === 'decimal');
      return part && part.value === ',' ? ',' : '.';
    } catch (e) { return '.'; }
  },

  /**
   * The decimal separator of each numeric column, decided from all its cells
   * rather than one cell at a time. "0,125" used to import as 125 -- a lone
   * comma with three digits after it was taken for grouping. A column whose cells settle nothing takes the file's verdict
   * (every numeric column together), then what the file itself says: a
   * known broker layout (Interactive Brokers and TD Ameritrade write a
   * decimal point), the delimiter (";" is the decimal-comma convention, ","
   * the decimal-point one), then the user's explicit choice (`override`).
   *
   * Never the browser's locale. A file of whole numbers with grouping
   * ("1,000" or "1.000") says nothing about its decimal mark, and taking the
   * locale's imported it a thousand times wrong on the other side of the
   * Atlantic. A column still undecided is null:
   * the importer stops and asks. A column with no separator in any cell
   * needs no decision and reads '.'.
   *
   * `opts`: { format, delimiter, override }.
   */
  importDecimals(rows, mapping, opts = {}) {
    const cols = ['quantity', 'price', 'fees'].filter(k => mapping[k] !== '' && mapping[k] != null);
    const tally = {};
    const hasSep = {};
    const file = { ',': 0, '.': 0 };
    cols.forEach(k => {
      const t = { ',': 0, '.': 0 };
      (rows || []).forEach(r => {
        const cell = r[parseInt(mapping[k], 10)];
        if (/[.,]/.test(String(cell ?? ''))) hasSep[k] = true;
        const v = this._decimalVote(cell);
        if (v) { t[v]++; file[v]++; }
      });
      tally[k] = t;
    });
    const fromFile = file[','] > file['.'] ? ',' : file['.'] > file[','] ? '.' : null;
    const fromLayout = opts.format === 'ib' || opts.format === 'tda' ? '.'
      : opts.delimiter === ';' ? ',' : opts.delimiter === ',' ? '.' : null;
    const chosen = opts.override === ',' || opts.override === '.' ? opts.override : null;
    const out = {};
    cols.forEach(k => {
      const t = tally[k];
      const own = t[','] > t['.'] ? ',' : t['.'] > t[','] ? '.' : null;
      out[k] = own || fromFile || fromLayout || chosen || (hasSep[k] ? null : '.');
    });
    return out;
  },

  /**
   * A number out of a spreadsheet cell, with the column's decimal separator.
   * Currency symbols, spaces and apostrophes go; "(180.00)" is negative. NaN
   * when the cell is not a number at all, and the caller rejects the row
   * rather than importing a zero.
   */
  parseImportNumber(v, decimal) {
    let s = String(v ?? '').trim().replace(/[$€£¥₽₹\s '’]/g, '').replace(/^\((.*)\)$/, '-$1');
    if (!s) return NaN;
    // No decided separator (importDecimals returned null): a cell with one in
    // it cannot be read safely, and is not guessed at.
    if (decimal !== ',' && decimal !== '.' && /[.,]/.test(s)) return NaN;
    if (decimal === ',') {
      if ((s.match(/,/g) || []).length > 1) return NaN;
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      if ((s.match(/\./g) || []).length > 1) return NaN;
      s = s.replace(/,/g, '');
    }
    return /^[-+]?\d*\.?\d+$/.test(s) ? parseFloat(s) : NaN;
  },

  /**
   * Day-first or month-first for a file's slash dates, from the dates
   * themselves: a first part over 12 is a day, a second part over 12 is a
   * day. A file that never says takes the broker's convention (TD Ameritrade
   * is American), then the locale's. It was day-first for a four-digit year
   * and whatever `new Date()` made of a two-digit one -- so 01/02/2024 was
   * the 1st of February and 01/02/24 the 2nd of January.
   */
  importDateOrder(values, format, locale, decimalComma) {
    let dmy = 0; let mdy = 0; let dotted = 0;
    (values || []).forEach(v => {
      const m = String(v ?? '').trim().match(/^(\d{1,2})([-/.])(\d{1,2})[-/.](\d{2}|\d{4})\b/);
      if (!m) return;
      if (+m[1] > 12) dmy++;
      else if (+m[3] > 12) mdy++;
      if (m[2] === '.') dotted++;
    });
    if (dmy !== mdy) return dmy > mdy ? 'dmy' : 'mdy';
    if (format === 'tda') return 'mdy';
    // 02.01.2025 is day-first wherever dots are written; so is a file whose
    // numbers use a decimal comma.
    if (dotted || decimalComma) return 'dmy';
    let loc = locale;
    try { loc = loc || (typeof navigator !== 'undefined' && navigator.language) || 'en-GB'; } catch (e) { loc = 'en-GB'; }
    return /^en-(US|PH)$|^es-US$/i.test(loc) ? 'mdy' : 'dmy';
  },

  /**
   * How a picked listing is named in Add Position. "Apple CDR (CAD Hedged)" on
   * Toronto read as plain "AAPL" with a price of 46.83 and no currency -- easy
   * to take for AAPL.US. A listing outside the US keeps its full
   * code and says its exchange and currency; a US one stays "AAPL".
   * Returns { code, detail, currency }.
   */
  listingLabel(asset) {
    const a = asset || {};
    if (a.isManual) return { code: a.Name || '', detail: 'Manual Asset', currency: a.Currency || null };
    const ex = String(a.Exchange || '').toUpperCase();
    const cur = a.Currency ? String(a.Currency).toUpperCase() : null;
    const us = !ex || ex === 'US' || ex === 'NYSE' || ex === 'NASDAQ' || ex === 'AMEX' || ex === 'BATS' || ex === 'NYSE ARCA';
    const code = us ? String(a.Code || '') : `${a.Code}.${ex}`;
    const parts = [a.Name || ''].filter(Boolean);
    if (!us) parts.push(cur ? `${ex} · ${cur}` : ex);
    return { code, detail: parts.join(' — '), currency: cur };
  },

  /** Today in the user's own calendar, as an ISO date. */
  todayISO(now) {
    const d = now ? new Date(now) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /** Nothing before this is a trade anyone can price (1900-01-01 was accepted). */
  EARLIEST_TRADE_DATE: '1950-01-01',

  /**
   * A date out of a CSV cell, as ISO, or null. ISO, compact (20250102, as
   * Interactive Brokers writes it) and slash dates in the file's order; a
   * two-digit year is this century unless that would be in the future.
   */
  parseImportDate(v, order, now) {
    const raw = String(v ?? '').trim();
    if (!raw) return null;
    let y; let m; let d;
    const ymd = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[\sT,;])/);
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:$|[\sT,;])/);
    const slash = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|[\sT,;])/);
    if (ymd) { y = +ymd[1]; m = +ymd[2]; d = +ymd[3]; }
    else if (compact) { y = +compact[1]; m = +compact[2]; d = +compact[3]; }
    else if (slash) {
      const a = +slash[1]; const b = +slash[2];
      [d, m] = order === 'mdy' ? [b, a] : [a, b];
      y = +slash[3];
      if (slash[3].length === 2) {
        const thisYear = new Date(now || Date.now()).getFullYear();
        y = 2000 + y > thisYear ? 1900 + y : 2000 + y;
      }
    } else return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  },

  /**
   * The transaction type a cell names, or null. Broker words included:
   * Interactive Brokers' BOT/SLD, TD Ameritrade's "Bought 10 AAPL @ 180.5"
   * description.
   */
  importType(cell) {
    const lower = String(cell ?? '').trim().toLowerCase();
    const t = lower.replace(/[\s_-]+/g, '');
    if (/^(buy|bought|purchase|purchased|b|bot|buytoopen)$/.test(t)) return 'buy';
    if (/^(sell|sold|sale|s|sld|selltoclose)$/.test(t)) return 'sell';
    if (/^(div|dividend|dividends|cashdividend|ordinarydividend|qualifieddividend)$/.test(t)) return 'dividend';
    if (/^(split|stocksplit|forwardsplit|reversesplit)$/.test(t)) return 'split';
    if (/^(transferin|depositshares|receive|received|in|deliveredin|transferofsecurityin)$/.test(t)) return 'transfer_in';
    if (/^(transferout|withdrawshares|deliver|delivered|out|transferofsecurityout)$/.test(t)) return 'transfer_out';
    // A description: its first word says it.
    if (/^(bought|buy)\b/.test(lower)) return 'buy';
    if (/^(sold|sell)\b/.test(lower)) return 'sell';
    if (/\bdividend\b/.test(lower) && !/reinvest/.test(lower)) return 'dividend';
    if (/\bsplit\b/.test(lower)) return 'split';
    return null;
  },

  /**
   * Everything parseImportRow needs to read a file's rows the same way:
   * each numeric column's decimal separator and the file's date order,
   * decided from all of its rows. `opts`: { format, delimiter, decimal
   * (the user's choice, ',' or '.'), locale, now }. `decimalUnclear` lists
   * the columns nothing in the file decides: the importer must ask before
   * reading them.
   */
  importContext(rows, mapping, opts = {}) {
    const decimals = this.importDecimals(rows, mapping, { format: opts.format, delimiter: opts.delimiter, override: opts.decimal });
    const decimalUnclear = Object.keys(decimals).filter(k => decimals[k] == null);
    const dateCol = mapping.date !== '' && mapping.date != null ? parseInt(mapping.date, 10) : -1;
    const dateValues = dateCol >= 0 ? (rows || []).map(r => r[dateCol]) : [];
    const chosenOrder = opts.dateOrder === 'dmy' || opts.dateOrder === 'mdy' ? opts.dateOrder : null;
    // A file of slash dates that never say which part is the day -- 03/04/2025
    // and 05/06/2025 -- was read by the browser's language: March in the US,
    // April in Spain, unasked. Like the decimal mark,
    // it is now asked, unless the broker layout or the file's own conventions
    // settle it.
    const dateUnclear = !chosenOrder && this.importDateOrderUnsettled(dateValues, opts.format, Object.values(decimals).includes(','));
    const dateOrder = chosenOrder || this.importDateOrder(dateValues, opts.format, opts.locale, Object.values(decimals).includes(','));
    return { mapping, decimals, decimalUnclear, dateOrder, dateUnclear, now: opts.now, format: opts.format };
  },

  /** True when slash dates are present and nothing in the file says day-first or month-first. */
  importDateOrderUnsettled(values, format, decimalComma) {
    let slash = 0; let dmy = 0; let mdy = 0; let dotted = 0;
    (values || []).forEach(v => {
      const m = String(v ?? '').trim().match(/^(\d{1,2})([-/.])(\d{1,2})[-/.](\d{2}|\d{4})\b/);
      if (!m) return;
      slash++;
      if (+m[1] > 12) dmy++;
      else if (+m[3] > 12) mdy++;
      if (m[2] === '.') dotted++;
    });
    if (!slash || dmy !== mdy) return false;
    return !(format === 'tda' || dotted || decimalComma);
  },

  /**
   * One CSV row read against the mapping, before anything is stored.
   * Returns the parsed trade, or { error } saying why it cannot be imported.
   *
   * `ctx`: from importContext.
   */
  // The shared reader decides what a ticker is: this
  // regex let "M&.NSE", "TSLA=X" and 21-character codes through while every
  // other screen turned them away. Kept under its
  // old name, with the regex's test().
  IMPORT_TICKER_RE: { test: (s) => !!(window.SymbolCode && window.SymbolCode.of(s)) },

  /**
   * Whether text read from a "CSV" is really a binary file: a NUL byte, or
   * more than 2% of the first 4,000 characters control characters or the
   * replacement character a decoder writes for bytes that are not text. A
   * PNG renamed .csv reached the column mapping as "Found 661 rows".
   */
  importLooksBinary(text) {
    const head = String(text || '').slice(0, 4000);
    if (!head) return false;
    if (head.indexOf(String.fromCharCode(0)) !== -1) return true;
    let odd = 0;
    for (let i = 0; i < head.length; i++) {
      const c = head.charCodeAt(i);
      if (c === 0xFFFD || (c < 32 && c !== 9 && c !== 10 && c !== 13)) odd++;
    }
    return odd / head.length > 0.02;
  },

  /**
   * The bytes of a chosen file as text. A byte-order mark says the encoding
   * (UTF-8, UTF-16 LE/BE), as the browser's readAsText did. Without one the
   * file is UTF-8 when it is valid UTF-8; else, when it reads as Windows-1252
   * text -- no NUL, no control character but tab, CR and LF -- it is that
   * (Excel's "CSV" export: a three-line file with "é" or "£" was refused as
   * binary, its two odd characters over 2% of it). Anything else is decoded
   * as UTF-8 and left to importLooksBinary.
   */
  importDecode(bytes) {
    const TD = (typeof window !== 'undefined' && window.TextDecoder) || (typeof TextDecoder !== 'undefined' ? TextDecoder : null);
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || new ArrayBuffer(0));
    if (!TD) {
      let t = '';
      for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
      return { text: t, encoding: 'latin1' };
    }
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return { text: new TD('utf-8').decode(b.subarray(3)), encoding: 'utf-8' };
    if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TD('utf-16le').decode(b.subarray(2)), encoding: 'utf-16le' };
    if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TD('utf-16be').decode(b.subarray(2)), encoding: 'utf-16be' };
    try {
      return { text: new TD('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' };
    } catch (_) { /* not UTF-8 */ }
    let text1252 = null;
    try { text1252 = new TD('windows-1252').decode(b); } catch (_) { text1252 = null; }
    if (text1252 != null) {
      let clean = true;
      for (let i = 0; i < text1252.length && clean; i++) {
        const c = text1252.charCodeAt(i);
        if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0x7F || (c >= 0x80 && c <= 0x9F)) clean = false;
      }
      if (clean) return { text: text1252, encoding: 'windows-1252' };
    }
    return { text: new TD('utf-8').decode(b), encoding: 'utf-8' };
  },

  parseImportRow(row, ctx) {
    const { mapping, decimals = {}, dateOrder = 'dmy', now, format } = ctx;
    const cell = (k) => (mapping[k] !== '' && mapping[k] != null ? row[parseInt(mapping[k], 10)] : undefined);
    // A cell that plainly writes its decimal mark the other way from the rest
    // of its column ("423,35" under 243.85) is not read with the column's
    // mark: "423,35" became 42,335.
    const mixed = (k) => {
      const v = this._decimalVote(cell(k));
      return v && decimals[k] && v !== decimals[k];
    };
    const mixedErr = (k, label) => `${label} "${cell(k)}" uses "${decimals[k] === '.' ? ',' : '.'}" as the decimal mark while the rest of the column uses "${decimals[k]}" — fix that cell`;
    // "BRK/B" is how some brokers write BRK.B. Without what a copy from a web
    // page brings along and shows as nothing.
    const symbol = this.importUnseen(cell('symbol') || '').trim().toUpperCase().replace(/^([A-Z0-9]+)\/([A-Z])$/, '$1.$2');
    if (!symbol) return { error: 'Missing symbol' };
    // A ticker is what SymbolCode reads as one, nothing else: an <img ...>
    // tag passed as "valid" and became a position. Whether the
    // ticker exists is asked of the search when the preview is built.
    if (!this.IMPORT_TICKER_RE.test(symbol)) {
      return { symbol, error: `"${symbol.length > 24 ? symbol.slice(0, 24) + '…' : symbol}" is not a ticker — use a symbol such as AAPL, BRK.B or VOD.LSE` };
    }
    const typeCell = cell('type');
    const rawQty = cell('quantity');
    if (mapping.quantity !== '' && mixed('quantity')) return { symbol, error: mixedErr('quantity', 'Quantity') };
    if (mixed('price')) return { symbol, error: mixedErr('price', 'Price') };
    if (mixed('fees')) return { symbol, error: mixedErr('fees', 'Fees') };
    let quantity = mapping.quantity !== '' ? this.parseImportNumber(rawQty, decimals.quantity) : NaN;
    let type = mapping.type === '' || mapping.type == null ? null : this.importType(typeCell);
    if (mapping.type === '' || mapping.type == null) {
      // No type column: a signed quantity says it (a sale is negative).
      type = quantity < 0 ? 'sell' : 'buy';
    }
    if (!type) return { symbol, error: `Unknown transaction type "${typeCell ?? ''}" — use Buy, Sell, Dividend, Split, Transfer In or Transfer Out` };
    // Interactive Brokers writes a sale as a negative quantity beside "SELL".
    if (Number.isFinite(quantity) && quantity < 0 && (type === 'sell' || type === 'transfer_out')) quantity = -quantity;
    // A broker dividend line (TD Ameritrade's "ORDINARY DIVIDEND (AAPL)") has
    // the total amount and no share count: "Invalid quantity" read as a broken
    // file.
    if (type === 'dividend' && String(rawQty ?? '').trim() === '') {
      return { symbol, type, error: 'Dividend row has no share count (only a total) — add it in the position History with + Add → Dividend' };
    }
    if (!(quantity > 0)) {
      return { symbol, type, error: type === 'split' ? 'Split needs the ratio in the quantity column (2 for a 2:1 split)' : `Invalid quantity "${rawQty ?? ''}"` };
    }
    const rawDate = cell('date');
    if (mapping.date === '' || mapping.date == null) return { symbol, type, error: 'No date column — map one so each trade is booked on its own day' };
    const date = this.parseImportDate(rawDate, dateOrder, now);
    if (!date) return { symbol, type, error: `Date "${rawDate ?? ''}" is not a date — use 2025-01-31, 31/01/2025 or 20250131` };
    const dateErr = this.checkTradeDate(date, now);
    if (dateErr) return { symbol, type, error: dateErr };

    // A split has no price, a transfer out needs none, and a transfer in
    // without one is given the market close on its date at import.
    const rawPrice = cell('price');
    const priceBlank = String(rawPrice ?? '').trim() === '';
    let price;
    if (type === 'split' || (priceBlank && (type === 'transfer_out' || type === 'transfer_in'))) price = 0;
    else {
      price = this.parseImportNumber(rawPrice, decimals.price);
      if (!Number.isFinite(price)) return { symbol, type, error: `Price "${rawPrice ?? ''}" is not a number` };
      if (price < 0) return { symbol, type, error: 'Price cannot be negative' };
      if (price === 0 && (type === 'buy' || type === 'sell' || type === 'dividend')) return { symbol, type, error: 'Price is missing or zero' };
    }

    // Fees are a cost whichever sign the broker writes them with:
    // Interactive Brokers exports commissions negative, and -50 used to
    // lower the cost basis by 50. Text is not a zero.
    const rawFees = cell('fees');
    let fees = 0;
    if (String(rawFees ?? '').trim() !== '') {
      fees = this.parseImportNumber(rawFees, decimals.fees);
      if (!Number.isFinite(fees)) return { symbol, type, error: `Fees "${rawFees}" is not a number` };
      fees = Math.abs(fees);
    }
    // The bounds the import holds every trade to (quantity, total, split
    // ratio, fees), here, so the preview says it: 99999999999999999999
    // passed as "1 valid" and failed only at import.
    // A transfer in costed at import from the day's close is checked again
    // then, with that price.
    const tooBig = this.amountProblem(type, quantity, price, fees);
    if (tooBig) return { symbol, type, error: tooBig };
    const exchange = this.importExchange(cell('exchange'), format);
    const currency = this.importFileCurrency(cell('currency'), this.importSymbolGuess(symbol, exchange));
    // The currency cell as the file writes it ("GBp" is pence, "GBP"
    // pounds): the unit a price is recorded in is decided once the listing's
    // own currency is known (importPriceUnit).
    const currencyCell = this.importCurrencyCell(cell('currency'));
    // The exchange as the file writes it ("SGX"), for what the preview says.
    const exchangeCell = this.importUnseen(cell('exchange') || '').trim().slice(0, 24) || null;
    return { symbol, exchange, exchangeCell, currency, currencyCell, date, type, quantity, price, fees, costFromMarket: type === 'transfer_in' && price === 0 };
  },

  /** A CSV cell without the invisible characters a web page's copy brings (window.SymbolCode.strip). */
  importUnseen(v) {
    const S = window.SymbolCode;
    if (S && S.strip) return S.strip(v);
    return String(v ?? '').replace(/[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g, '').replace(/[\u00A0\u2007\u202F]/g, ' ');
  },

  /**
   * A file's currency cell as EODHD names the unit, or null for none: "GBp",
   * "GBX" and "pence" are pence (GBX), "ZAc" and "ZAC" cents (ZAC), "ILA"
   * agorot; any other three letters as written, in capitals ("gbp" is GBP).
   * Upper-cased first, "GBp" read as pounds.
   */
  importCurrencyCell(cell) {
    const raw = this.importUnseen(cell).trim();
    if (raw === 'GBp' || /^(GBX|pence)$/i.test(raw)) return 'GBX';
    if (raw === 'ZAc' || /^ZAC$/i.test(raw)) return 'ZAC';
    if (/^ILA$/i.test(raw)) return 'ILA';
    const c = raw.toUpperCase();
    return /^[A-Z]{3}$/.test(c) ? c : null;
  },

  /**
   * Why a row's stated currency cannot go into a listing kept in `quote`, or
   * null when it can: the same currency, a currency and its own minor unit
   * either way (GBP into GBX x100, GBX into GBP /100: importPriceUnit), or
   * nothing stated / nothing known. Prices are not converted between
   * currencies: "AAPL.US,...,180,GBP" into a USD position was shown as
   * £180.00 and written as $180. `held`: a position is
   * already there.
   */
  importCurrencyClash(cell, quote, symbol, held) {
    const stated = this.importCurrencyCell(cell);
    const q = String(quote || '').trim();
    if (!stated || !q) return null;
    const Q = q === 'GBp' ? 'GBX' : q.toUpperCase();
    if (stated === Q) return null;
    const minor = this.MINOR_UNITS[Q];
    if (minor && minor[0] === stated) return null;
    const back = this.MINOR_UNITS[stated];
    if (back && back[0] === Q) return null;
    const what = String(symbol || '').toUpperCase() || 'This listing';
    return `${what} is ${held ? 'held' : 'quoted'} in ${Q}; this row is in ${stated}. Convert the price or drop the currency column.`;
  },

  /**
   * The unit a CSV price is recorded in, and what it is multiplied by.
   * `quote`: the currency the listing (or the position it goes into) is
   * kept in -- EODHD's Currency, GBX for VOD.LSE. A file that states the
   * major currency of a listing quoted in a minor unit -- GBP for pence,
   * ZAR for ZAC, ILS for ILA -- is converted to that unit: "VOD.LSE ... 0.72,
   * GBP" is 72 GBX. It was recorded as 0.72 GBX, a hundred times less, with
   * nothing in the preview to say so.
   * The mirror: a file that states the minor unit -- GBX, GBp or "pence",
   * ZAC, ILA -- of a listing or position kept in the major one (GBP, ZAR,
   * ILS) is divided by 100: "9000 GBX" into a GBP position was recorded as
   * £9,000. A fixed ratio, not an exchange rate.
   * The same unit stated, no currency column, or any other currency: as the
   * file has it ({ factor: 1 }).
   *   -> { currency, factor, stated } (currency null: no conversion);
   *      the mirror also { divisor: 100 } -- apply with importUnitValue
   */
  importPriceUnit(cell, quote) {
    const stated = this.importCurrencyCell(cell);
    const minor = quote ? this.MINOR_UNITS[quote] : null;
    if (stated && minor && stated === minor[0]) return { currency: quote, factor: minor[1], stated };
    const major = stated ? this.MINOR_UNITS[stated] : null;
    const Q = quote ? String(quote).trim().toUpperCase() : '';
    if (major && Q && Q === major[0]) return { currency: Q, factor: 1 / major[1], divisor: major[1], stated };
    return { currency: null, factor: 1, stated };
  },

  /** A file's price or fee in the unit importPriceUnit chose (divided, not x0.01: 9000 GBX is £90 exactly). */
  importUnitValue(value, unit) {
    const v = Number(value);
    if (!unit) return v;
    return unit.divisor ? v / unit.divisor : v * unit.factor;
  },

  /**
   * The currency a CSV row's price is in, as far as the file says: the
   * exchange column or ticker suffix, else dollars for a plain US-looking
   * code, else unknown (null).
   */
  importCurrencyGuess(symbol, exchange, fileCurrency) {
    const full = this.importSymbolGuess(symbol, exchange);
    const fromFile = this.importFileCurrency(fileCurrency, full);
    if (fromFile) return fromFile;
    if (!full) return null;
    const ex = full.split('.').pop();
    return this.importPairCurrency(full) || this.IMPORT_EXCHANGE_CCY[ex] || null;
  },

  /**
   * The currency a file's own currency column gives a row, or null. A broker
   * states it (Interactive Brokers' CurrencyPrimary) and it was never read:
   * SAP on IBIS in EUR was booked in dollars. On the London
   * exchange EODHD quotes in pence: a "GBP" there is left to the exchange
   * (GBX) rather than valuing pence as pounds.
   */
  importFileCurrency(cell, full) {
    // "GBp" is pence, not "GBP" (importCurrencyCell).
    const c = this.importCurrencyCell(cell);
    if (!c) return null;
    const ex = String(full || '').toUpperCase().split('.').pop();
    if (ex === 'LSE' && (c === 'GBP' || c === 'GBX')) return null;
    return c;
  },

  // ==================== TRANSACTION CHECKS ====================

  /** Null when a trade date is usable, else why not. */
  checkTradeDate(date, now) {
    const d = String(date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T00:00:00Z'))) return 'Enter the trade date';
    // The user's own calendar. The later of the local and UTC dates let an
    // evening in New York book tomorrow's date.
    const ref = now ? new Date(now) : new Date();
    const today = this.todayISO(ref);
    if (d > today) return `${d} is in the future — a trade is booked on the day it happened`;
    if (d < this.EARLIEST_TRADE_DATE) return `${d} is before ${this.EARLIEST_TRADE_DATE.slice(0, 4)} — check the year`;
    return null;
  },

  /** Shares held at the end of a day. */
  heldOn(transactions, date) {
    return this.getHoldingQuantity((transactions || []).filter(t => String(t.date || '') <= String(date)));
  },

  /**
   * The first point in a holding's history where more is sold or moved out
   * than is held, or null. Walks every date, not just the new trade's: a
   * sale dated February between a January buy of 10 and a March sale of 10
   * was checked against February alone and sold 15 of 10.
   */
  findShortfall(transactions) {
    let held = 0;
    for (const t of [...(transactions || [])].sort((a, b) => this.byDate(a, b))) {
      const q = this.num(t.quantity);
      if (t.type === 'buy' || t.type === 'transfer_in') held += q;
      else if (t.type === 'split' && q > 0) held *= q;
      else if (t.type === 'sell' || t.type === 'transfer_out') {
        if (q > held + 1e-9) return { date: t.date, held, quantity: q, type: t.type };
        held -= q;
      }
    }
    return null;
  },

  /**
   * Null when `tx` can be added to (or, with `replaceId`, put in place of a
   * transaction in) a holding's `existing` history; else a sentence saying
   * why not. One rule set for the forms, the history editor and the
   * importer: the form accepted a buy at $0, a dividend on no shares and a
   * date in 2030 that the importer refused, or the other way round.
   */
  // The largest numbers a trade may carry. Nothing bounded them: a backup
  // with quantity 1e300 restored to TOTAL VALUE "$337,310,000,…" across the
  // header, and Add Position took the same. A trillion
  // units covers the smallest-priced coins; a quadrillion of money covers
  // any book in any currency.
  QUANTITY_MAX: 1e12,
  TRADE_VALUE_MAX: 1e15,
  SPLIT_RATIO_MAX: 1e6,

  /**
   * Null when a trade's numbers are within the bounds, else a sentence.
   * `fees` (optional) is held to the bound on money too: a fee of 1e300 has
   * no limit anywhere else.
   */
  amountProblem(type, quantity, price, fees) {
    const q = Number(quantity);
    const p = Number(price);
    const f = Number(fees);
    const big = (n) => n.toLocaleString('en-US');
    if (f > this.TRADE_VALUE_MAX) return `The fees can't be more than ${big(this.TRADE_VALUE_MAX)} — check the number`;
    if (type === 'split') return q > this.SPLIT_RATIO_MAX ? `A split ratio can't be more than ${big(this.SPLIT_RATIO_MAX)} — check the number` : null;
    if (q > this.QUANTITY_MAX) return `The quantity can't be more than ${big(this.QUANTITY_MAX)} — check the number`;
    if (p > this.TRADE_VALUE_MAX || (q > 0 && p > 0 && q * p > this.TRADE_VALUE_MAX)) return `The total (quantity × price) can't be more than ${big(this.TRADE_VALUE_MAX)} — check the numbers`;
    return null;
  },

  validateTransaction(existing, tx, opts = {}) {
    const fmt = (n) => this.formatQuantity(n);
    const type = tx.type;
    const dateErr = this.checkTradeDate(tx.date, opts.now);
    if (dateErr) return dateErr;
    const q = Number(tx.quantity);
    const p = Number(tx.price);
    const f = tx.fees == null || tx.fees === '' ? 0 : Number(tx.fees);
    if (!Number.isFinite(f)) return 'Fees must be a number';
    if (f < 0) return 'Fees are a cost — enter them as a positive number';
    // A split goes on to the shortfall check below: a reverse split dated
    // before a sale shrinks what that sale had to sell from (buy 10, split
    // 0.5, sell 8 sold 8 of 5 and booked -$400).
    if (type === 'split' && !(q > 0)) return 'Enter the split ratio (2 for a 2:1 split)';
    if (type !== 'split' && !(q > 0)) return type === 'dividend' ? 'Enter the number of shares the dividend was paid on' : 'Enter a quantity above zero';
    if ((type === 'buy' || type === 'sell') && !(p > 0)) return 'Enter the price per share — a trade at 0 is not a trade';
    if (type === 'transfer_in' && !(p > 0)) return 'A transfer in keeps its cost basis: enter what the shares cost per share, or use the market close on the transfer date';
    if (type === 'dividend' && !(p > 0)) return 'Enter the dividend per share';
    const tooBig = this.amountProblem(type, q, p, f);
    if (tooBig) return tooBig;
    const others = (existing || []).filter(t => !(opts.replaceId != null && t.id === opts.replaceId));
    if (type === 'dividend') {
      const held = this.heldOn(others, tx.date);
      if (held <= 0) return `No shares were held on ${tx.date} — a dividend is paid on shares held`;
      if (q > held + 1e-9) return `${fmt(held)} shares were held on ${tx.date}; a dividend on ${fmt(q)} is more than that`;
      return null;
    }
    // A history already short (stored before these checks) does not block
    // every new row; a change that makes a whole history short does.
    const before = this.findShortfall(existing);
    const after = this.findShortfall(others.concat([{ ...tx, quantity: q }]));
    if (after && !before) {
      return `That would leave the position short: on ${after.date}, ${fmt(after.quantity)} ${after.type === 'sell' ? 'sold' : 'moved out'} with ${fmt(after.held)} held`;
    }
    // An edit or a reverse split can also take away shares a recorded
    // dividend was paid on.
    const divAfter = this.findDividendShortfall(others.concat([{ ...tx, quantity: q }]));
    if (divAfter && !this.findDividendShortfall(existing)) {
      return `A dividend on ${divAfter.date} was paid on ${fmt(divAfter.quantity)} shares; this change would leave ${fmt(divAfter.held)} held then`;
    }
    return null;
  },

  /**
   * The first dividend in a history paid on more shares than were held on its
   * date, or null. Deleting the buy a dividend was paid on left a dividend
   * "on 0 shares" counted in Total Return.
   */
  findDividendShortfall(transactions) {
    const all = transactions || [];
    for (const t of all) {
      if (t.type !== 'dividend') continue;
      const held = this.heldOn(all.filter(x => x !== t && x.type !== 'dividend'), t.date);
      if (this.num(t.quantity) > held + 1e-9) return { date: t.date, held, quantity: this.num(t.quantity) };
    }
    return null;
  },

  /** Null when deleting transaction `id` leaves the history whole, else why not. */
  validateDeletion(existing, id) {
    const rest = (existing || []).filter(t => t.id !== id);
    const before = this.findShortfall(existing);
    const after = this.findShortfall(rest);
    if (after && !before) {
      return `A later ${after.type === 'sell' ? 'sale' : 'transfer out'} on ${after.date} needs these shares (${this.formatQuantity(after.quantity)} with ${this.formatQuantity(after.held)} left). Delete or edit that one first.`;
    }
    const divBefore = this.findDividendShortfall(existing);
    const divAfter = this.findDividendShortfall(rest);
    if (divAfter && !divBefore) {
      return `A dividend on ${divAfter.date} was paid on ${this.formatQuantity(divAfter.quantity)} shares; without this trade ${this.formatQuantity(divAfter.held)} would be held. Delete or edit that dividend first.`;
    }
    return null;
  },

  // ==================== AI PROMPT CONTEXT ====================

  /**
   * The portfolio as an AI prompt reads it: in the portfolio's currency, to
   * the cent, with quantities, weights and sectors.
   *
   * The prompt used to say "$" for a euro portfolio and print unrounded
   * values ("Total Portfolio Value: $6,756.665"), with no share counts and no
   * sectors, so "what's my sector exposure?" could only be guessed. An unpriced holding is listed as such, not as
   * zero. `baseCurrency` defaults to the one the tracker stamps on each
   * holdingsData entry.
   */
  portfolioPromptContext(holdings, holdingsData, baseCurrency) {
    const list = Array.isArray(holdings) ? holdings : [];
    if (!list.length) return 'Empty portfolio';
    const data = holdingsData || {};
    const base = baseCurrency
      || (Object.values(data).find(d => d && d.baseCurrency) || {}).baseCurrency
      || 'USD';
    const money = (v) => this.formatCurrency(v, base, 2);
    const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
    const rows = [];
    const unpriced = [];
    list.forEach(h => {
      const d = data[h.id] || {};
      const name = (h.symbol || '').split('.')[0] || h.name || 'Manual asset';
      const value = Number(d.currentValue);
      if (d.priceUnavailable || !Number.isFinite(value) || value <= 0) {
        if (this.num(d.quantity) > 0) unpriced.push(name);
        return;
      }
      rows.push({
        name, symbol: h.symbol || null, type: h.type || 'stock', sector: h.sector || d.sector || null,
        quantity: this.num(d.quantity), value,
        pnl: Number.isFinite(Number(d.pnl)) ? Number(d.pnl) : 0,
        pnlPercent: Number.isFinite(Number(d.pnlPercent)) ? Number(d.pnlPercent) : 0,
        // A template's target weight rides in the note ("target weight: 30%").
        // The rebalancing advice was asked for a target allocation with none
        // given.
        target: (() => { const m = String(h.notes || '').match(/target weight:\s*([\d.]+)%/i); const v = m ? parseFloat(m[1]) : NaN; return Number.isFinite(v) && v > 0 ? v : null; })(),
      });
    });
    rows.sort((a, b) => b.value - a.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const pnl = rows.reduce((s, r) => s + r.pnl, 0);
    const cost = total - pnl;
    let out = `Portfolio currency: ${base}\n`;
    out += `Total value: ${money(total)} (${rows.length} priced position${rows.length === 1 ? '' : 's'})\n`;
    out += `Unrealized P&L: ${pnl >= 0 ? '+' : ''}${money(pnl)}${cost > 0 ? ` (${pct(pnl / cost * 100)})` : ''}\n`;
    if (unpriced.length) out += `No current price (left out of the figures): ${unpriced.join(', ')}\n`;
    out += `\nHoldings, largest first:\n`;
    rows.forEach(r => {
      const weight = total > 0 ? r.value / total * 100 : 0;
      out += `- ${r.name}${r.symbol ? ` (${r.symbol})` : ''}: ${this.formatQuantity(r.quantity, r)} ${this.quantityUnit(r, r.quantity)}, value ${money(r.value)}, ${weight.toFixed(1)}% of portfolio${r.target != null ? ` (target ${r.target}%)` : ''}, P&L ${pct(r.pnlPercent)}${r.sector ? `, sector ${r.sector}` : ''}\n`;
    });
    if (rows.some(r => r.target != null)) out += `Target weights are the portfolio's own (from the template it was built from); compare against them.\n`;
    const group = (key) => {
      const g = {};
      rows.forEach(r => { const k = key(r); g[k] = (g[k] || 0) + r.value; });
      return Object.entries(g).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(total > 0 ? v / total * 100 : 0).toFixed(1)}%`).join(', ');
    };
    if (rows.some(r => r.sector)) out += `\nBy sector: ${group(r => r.sector || this.UNCLASSIFIED_SECTOR)}\n`;
    out += `By type: ${group(r => r.type)}\n`;
    return out;
  },

  // ==================== THEME INK ====================

  /**
   * Text colours for the light theme. The palette's accents were chosen on
   * dark grounds; on white the gain green is 1.97:1, the amber 1.61:1, the
   * orange 2.35:1. Same hues,
   * darkened to clear 4.5:1 on white. Dark theme unchanged.
   */
  LIGHT_ACCENTS: {
    '#f97316': '#c2410c', '#ea580c': '#c2410c', '#fdba74': '#9a3412', '#fb923c': '#c2410c',
    '#22c55e': '#047857', '#21ce99': '#047857', '#16a34a': '#047857', '#10b981': '#047857',
    '#ef4444': '#c81e2c', '#f23645': '#c81e2c', '#dc2626': '#b91c1c',
    '#eab308': '#854d0e', '#f0b90b': '#854d0e', '#f59e0b': '#92400e', '#fbbf24': '#92400e',
    '#3b82f6': '#1d4ed8', '#60a5fa': '#1d4ed8', '#06b6d4': '#0e7490', '#14b8a6': '#0f766e',
    '#a855f7': '#7e22ce', '#8b5cf6': '#6d28d9', '#ec4899': '#be185d',
  },

  /** `hex` as text ink for the theme: unchanged in dark, darkened in light. */
  accent(hex, isDark) {
    if (typeof hex !== 'string') return hex;
    // The dark theme took the colour as it was: Macro's #3b82f6 read 4.14:1
    // and #a855f7 3.85:1 there.
    if (isDark) return this.ink(hex, true);
    return this.ink(this.LIGHT_ACCENTS[hex.toLowerCase()] || hex, false);
  },

  /** The palette with the light theme's darker success/error/warning inks. */
  themeInk(C3, isDark) {
    if (!C3) return C3;
    if (isDark) {
      return { ...C3, success: this.ink(C3.success, true), error: this.ink(C3.error, true), warning: this.ink(C3.warning, true) };
    }
    return {
      ...C3,
      success: C3.successLight || this.LIGHT_ACCENTS['#22c55e'],
      error: C3.errorLight || this.LIGHT_ACCENTS['#ef4444'],
      warning: this.LIGHT_ACCENTS['#eab308'],
    };
  },

  // ==================== CURRENCY / FX ====================

  /**
   * Quotes in a minor unit: LSE prices in pence (GBX), Johannesburg in cents
   * (ZAC), Tel Aviv in agorot (ILA). There is no GBXUSD pair -- EODHD answers
   * it with close "NA" -- so the rate is the major pair's divided by 100.
   * 100 VOD.LSE at 123.9p was valued at $12,390
   * instead of $164, and "NA".toFixed crashed the Add Position modal.
   */
  MINOR_UNITS: { GBX: ['GBP', 100], GBp: ['GBP', 100], ZAC: ['ZAR', 100], ILA: ['ILS', 100] },

  majorUnit(currency) {
    const m = this.MINOR_UNITS[currency];
    return m ? { currency: m[0], divisor: m[1] } : { currency, divisor: 1 };
  },

  /** A usable FX rate: finite and positive, else null. "NA", 0, NaN are missing, never parity. */
  toRate(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  },

  /**
   * Units of `to` per one unit of `from`, or null when no rate can be found.
   * Tries the direct pair, the inverse, then a cross through USD. `fails`
   * (optional array) collects what the failed requests threw, for
   * RateLimitWait.outage: why no rate came.
   */
  async fxRate(apiKey, from, to, fails) {
    if (!from || !to) return null;
    if (from === to) return 1;
    const f = this.majorUnit(from);
    const t = this.majorUnit(to);
    const scale = t.divisor / f.divisor;
    if (f.currency === t.currency) return scale;
    const api = window.EODHD_API;
    const pair = async (a, b) => {
      if (a === b) return 1;
      try {
        const direct = this.toRate(await api.getForexRate(apiKey, a, b, false, fails));
        if (direct) return direct;
        const inv = this.toRate(await api.getForexRate(apiKey, b, a, false, fails));
        return inv ? 1 / inv : null;
      } catch (e) { if (Array.isArray(fails)) fails.push(e || {}); return null; }
    };
    let rate = await pair(f.currency, t.currency);
    if (rate == null && f.currency !== 'USD' && t.currency !== 'USD') {
      const a = await pair(f.currency, 'USD');
      const b = a != null ? await pair('USD', t.currency) : null;
      rate = a != null && b != null ? a * b : null;
    }
    return rate == null ? null : rate * scale;
  },

  /**
   * { currency: rate-into-base | null } for every currency, base included.
   * `failsBy` (optional object): for a currency that got no rate, what its
   * requests threw (a list, for RateLimitWait.outage) -- so the positions
   * it leaves without a value can say why.
   */
  async fxRates(apiKey, baseCurrency, currencies, failsBy) {
    const rates = { [baseCurrency]: 1 };
    const unique = [...new Set((currencies || []).filter(c => c && c !== baseCurrency))];
    const found = await Promise.all(unique.map(async (c) => {
      const fails = failsBy ? [] : undefined;
      const rate = await this.fxRate(apiKey, c, baseCurrency, fails);
      if (rate == null && fails && fails.length) failsBy[c] = fails;
      return rate;
    }));
    unique.forEach((c, i) => { rates[c] = found[i]; });
    return rates;
  },

  /**
   * Why held positions are left without a value, as sentences in the words
   * every screen uses (RateLimitWait), or '' when it is not known. A rate
   * that did not load names its pair ("The GBP/USD rate did not load:
   * EODHD answered with an error (500)."); a quote that did not load, its
   * reason. `rows`: holdingsData entries (fxFail / priceFail, set where the
   * prices are loaded). The totals said only "1 without a price".
   */
  unpricedWhy(rows, baseCurrency, opts) {
    const RLW = window.RateLimitWait;
    if (!RLW || !RLW.failText) return '';
    const held = (rows || []).filter(r => r && r.priceUnavailable && Number(r.quantity) > 0);
    const out = [];
    const seen = {};
    held.forEach((r) => {
      const f = r.fxUnavailable ? r.fxFail : null;
      if (!f) return;
      const pair = `${r.currency}/${baseCurrency}`;
      if (seen[pair]) return;
      seen[pair] = true;
      out.push(RLW.failText(`The ${pair} rate`, f));
    });
    if (!(opts && opts.ratesOnly)) {
      const q = held.find(r => !r.fxUnavailable && r.priceFail);
      if (q) out.push(RLW.failText('The prices', q.priceFail));
      const none = this.noRecordWhy(rows);
      if (none) out.push(none);
    }
    return out.join(' ');
  },

  /**
   * The held positions whose ticker answered with no price at all -- a
   * quote of "NA" and no close in its history -- said as that: "No price on
   * record for ZZZQ." An answer, not a failure: the batch's 500 was blamed
   * on it once the single request had answered.
   */
  noRecordWhy(rows) {
    const codes = [];
    (rows || []).forEach((r) => {
      if (!r || !r.priceUnavailable || r.fxUnavailable || !r.noRecord || !(Number(r.quantity) > 0)) return;
      const c = String(r.symbol || '').split('.')[0];
      if (c && codes.indexOf(c) === -1) codes.push(c);
    });
    return codes.length ? `No price on record for ${codes.join(', ')}.` : '';
  },

  /**
   * Daily rates from `from` into `to` over [start, end], as a lookup:
   * `on(date)` is the last close on or before that date (within ten days, so
   * a weekend finds Friday), or null. One request per leg for the whole
   * range, however many trades the range covers: the direct pair, else its
   * inverse, else a cross through USD. Minor units as in fxRate; `fails`
   * as there.
   */
  async fxHistory(apiKey, from, to, start, end, fails) {
    if (!from || !to || from === to) return { on: () => 1 };
    const f = this.majorUnit(from);
    const t = this.majorUnit(to);
    const scale = t.divisor / f.divisor;
    if (f.currency === t.currency) return { on: () => scale };
    const api = window.EODHD_API;
    const lo = this.shiftDate(start, -10);
    const hi = String(end || start).slice(0, 10);
    const bars = async (pair, invert) => {
      try {
        const data = await api.getHistoricalData(apiKey, `${pair}.FOREX`, lo, hi, undefined, Array.isArray(fails) ? { throwErrors: true } : undefined);
        return (Array.isArray(data) ? data : [])
          .map(d => ({ date: d && d.date, rate: this.toRate(d && d.close) }))
          .filter(d => d.date && d.rate != null)
          .map(d => ({ date: d.date, rate: invert ? 1 / d.rate : d.rate }))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      } catch (e) { if (Array.isArray(fails)) fails.push(e || {}); return []; }
    };
    const leg = async (a, b) => {
      const direct = await bars(a + b, false);
      return direct.length ? direct : bars(b + a, true);
    };
    let legs = [await leg(f.currency, t.currency)];
    if (!legs[0].length && f.currency !== 'USD' && t.currency !== 'USD') {
      legs = [await leg(f.currency, 'USD'), await leg('USD', t.currency)];
    }
    const lookup = (series, date) => {
      let found = null;
      for (const d of series) { if (d.date <= date) found = d; else break; }
      return found && this.daysBetween(found.date, date) <= 10 ? found.rate : null;
    };
    return {
      on: (date) => {
        if (legs.some(s => !s.length)) return null;
        let r = scale;
        for (const s of legs) {
          const x = lookup(s, String(date).slice(0, 10));
          if (x == null) return null;
          r *= x;
        }
        return r;
      },
    };
  },

  /**
   * The rate a trade on `date` is booked at: that day's close for a past
   * date, the live rate for today. Backdated trades used to take today's rate
   * -- VOD, RY and AAPL bought on 2 January were stored at the rates of the
   * day they were typed in, so their currency gain was always about zero.
   * When the day's rate cannot be had, today's is used and
   * `onDate` says so for the screen. Null when there is no rate at all;
   * { failed } (no `rate`) when none came because the requests failed --
   * the limit, EODHD's error, a dropped connection, an unreadable answer --
   * so the screen names the reason.
   */
  async tradeFxRate(apiKey, from, to, date, now) {
    if (!from || !to || from === to) return { rate: 1, onDate: true, live: false };
    const fails = [];
    const day = String(date || '').slice(0, 10);
    const today = this.todayISO(now);
    if (day && day < today && day < new Date(now || Date.now()).toISOString().slice(0, 10)) {
      const hist = await this.fxHistory(apiKey, from, to, day, day, fails);
      const r = this.toRate(hist.on(day));
      if (r) return { rate: r, onDate: true, live: false };
    }
    const live = this.toRate(await this.fxRate(apiKey, from, to, fails));
    if (!live) {
      const RLW = window.RateLimitWait;
      const failed = RLW && RLW.outage ? RLW.outage(fails) : null;
      return failed ? { failed } : null;
    }
    return { rate: live, onDate: !day || day >= today, live: true };
  },
  /** Why a lookup with `fails` came back empty: a RateLimitWait failure, or null. */
  fxFailure(fails) {
    const RLW = window.RateLimitWait;
    return RLW && RLW.outage ? RLW.outage(fails || []) : null;
  },

  /**
   * The close of `symbol` on `date` (or the last trading day before it), raw
   * rather than adjusted: a cost basis is the price of that day, in that
   * day's shares. Null when there is none on record; { failed } (a
   * RateLimitWait.failure) when the history did not load -- the limit,
   * EODHD's error, a dropped connection, an answer that could not be read --
   * so the screen names the reason instead of "no price on record".
   */
  async closeOn(apiKey, symbol, date) {
    const RLW = window.RateLimitWait;
    try {
      const day = String(date).slice(0, 10);
      const data = await window.EODHD_API.getHistoricalData(apiKey, symbol, this.shiftDate(day, -10), day, undefined, { throwErrors: true });
      const bars = (Array.isArray(data) ? data : []).filter(d => d && d.date && d.date <= day && this.toRate(d.close) != null);
      const last = bars[bars.length - 1];
      return last ? { close: this.toRate(last.close), date: last.date } : null;
    } catch (e) {
      const failed = RLW && RLW.outage ? RLW.outage(e || {}) : null;
      return failed ? { failed } : null;
    }
  },

  /** Quote currency implied by a symbol when nothing better is known. */
  currencyFromSymbol(symbol) {
    const s = String(symbol || '').toUpperCase();
    const dot = s.lastIndexOf('.');
    if (dot < 0) return null;
    const code = s.slice(0, dot);
    const exch = s.slice(dot + 1);
    if (exch === 'US') return 'USD';
    if (exch === 'CC' && code.includes('-')) return code.split('-').pop();
    if (exch === 'FOREX' && code.length === 6) return code.slice(3);
    // An index is in points of its home currency: GSPC and NDX had none, so
    // the backtest said "No alpha: GSPC is quoted in another currency" and
    // What-If asked to pick it from a search that lists no index. Unknown indices stay unknown.
    if (exch === 'INDX') return this.indexCurrency(code);
    // Any other exchange: the currency it usually quotes in. VOD.LSE was
    // "Unknown quote currency" in What-If and "$" in the backtest, though the
    // importer knew London is pence.
    return this.IMPORT_EXCHANGE_CCY[exch] || null;
  },

  // The home currency of an index's points, for the indices people type;
  // S&P US sector and size indices (SP500-45, SP400) are in dollars.
  INDEX_CCY: {
    GSPC: 'USD', NDX: 'USD', IXIC: 'USD', DJI: 'USD', DJT: 'USD', DJU: 'USD', RUT: 'USD', RUA: 'USD', NYA: 'USD', OEX: 'USD',
    VIX: 'USD', SOX: 'USD', XAX: 'USD', SP400: 'USD', SP600: 'USD', SP100: 'USD', MID: 'USD', SML: 'USD',
    FTSE: 'GBP', FTMC: 'GBP', GDAXI: 'EUR', MDAXI: 'EUR', FCHI: 'EUR', STOXX50E: 'EUR', STOXX: 'EUR', IBEX: 'EUR', FTSEMIB: 'EUR',
    AEX: 'EUR', BFX: 'EUR', ATX: 'EUR', ISEQ: 'EUR', PSI20: 'EUR', SSMI: 'CHF', OMXS30: 'SEK', OMXC25: 'DKK', OSEAX: 'NOK',
    N225: 'JPY', TOPX: 'JPY', HSI: 'HKD', HSCE: 'HKD', AXJO: 'AUD', AORD: 'AUD', GSPTSE: 'CAD', KS11: 'KRW', TWII: 'TWD',
    BSESN: 'INR', NSEI: 'INR', STI: 'SGD', BVSP: 'BRL', MXX: 'MXN', MERV: 'ARS', TA125: 'ILS', SSEC: 'CNY', '000001': 'CNY',
  },
  indexCurrency(code) {
    const c = String(code || '').toUpperCase().replace(/^\^/, '').replace(/\.INDX$/, '');
    if (this.INDEX_CCY[c]) return this.INDEX_CCY[c];
    if (/^SP(500|400|600|100)(-\d+)?$/.test(c)) return 'USD';
    return null;
  },
  // Indices whose level is price only (dividends left out). A performance
  // index such as the DAX (GDAXI) reinvests them, and is not called a price
  // index; an index not listed here is described neutrally.
  PRICE_INDICES: ['GSPC', 'NDX', 'IXIC', 'DJI', 'DJT', 'DJU', 'RUT', 'RUA', 'NYA', 'OEX', 'SOX', 'XAX', 'SP400', 'SP600', 'SP100', 'MID', 'SML',
    'FTSE', 'FTMC', 'FCHI', 'STOXX50E', 'STOXX', 'IBEX', 'FTSEMIB', 'AEX', 'BFX', 'ATX', 'ISEQ', 'PSI20', 'SSMI', 'OMXS30', 'OMXC25',
    'N225', 'TOPX', 'HSI', 'HSCE', 'AXJO', 'AORD', 'GSPTSE', 'KS11', 'TWII', 'BSESN', 'NSEI', 'STI', 'MXX', 'MERV', 'TA125', 'SSEC', '000001'],
  isPriceIndex(symbol) {
    const s = String(symbol || '').toUpperCase();
    if (!/\.INDX$/.test(s)) return false;
    const c = s.replace(/\.INDX$/, '');
    return this.PRICE_INDICES.indexOf(c) !== -1 || /^SP(500|400|600|100)(-\d+)?$/.test(c);
  },
  // Funds that track the indices people type, for "an index cannot be
  // bought -- this fund tracks it".
  INDEX_TRACKERS: { GSPC: 'SPY.US', NDX: 'QQQ.US', DJI: 'DIA.US', RUT: 'IWM.US', IXIC: 'ONEQ.US' },
  /** What-If: an index is not a holding. The sentence for it, or null. */
  indexNotBuyable(symbol) {
    const s = String(symbol || '').toUpperCase();
    if (!/\.INDX$/.test(s)) return null;
    const fund = this.INDEX_TRACKERS[s.replace(/\.INDX$/, '')];
    return s + ' is an index, which cannot be bought or held. ' + (fund ? 'Use a fund that tracks it, e.g. ' + fund + '.' : 'Use a fund that tracks it instead.');
  },

  // ==================== HISTORICAL "WHAT IF I HAD INVESTED" ====================

  /**
   * `amount` put into one instrument on the first bar, held to the last.
   *
   * On ADJUSTED closes: raw closes made a 4:1 split look like a 75% crash
   * (AAPL from 2015: +201% and a 78.9% drawdown shown, +1,263% and 38.5% real;
   * ). The S&P 500 comparison covers exactly the same dates -- the
   * first and last day both traded -- and alpha is only stated when the
   * instrument is quoted in USD like SPY. Growth is in the instrument's own
   * currency.
   */
  investmentBacktest(assetHist, spyHist, amount, assetCurrency) {
    const px = (d) => {
      const a = this.toRate(d && d.adjusted_close);
      return a != null ? a : this.toRate(d && d.close);
    };
    const bars = (assetHist || []).filter(d => d && d.date && px(d) != null);
    if (bars.length < 2) return null;
    const startPrice = px(bars[0]);
    const endPrice = px(bars[bars.length - 1]);
    const shares = amount / startPrice;
    const finalValue = shares * endPrice;
    const totalReturn = ((finalValue - amount) / amount) * 100;
    const days = (new Date(bars[bars.length - 1].date) - new Date(bars[0].date)) / 86400000;
    const years = days / 365.25;
    const annualizedReturn = years > 0 ? (Math.pow(finalValue / amount, 1 / years) - 1) * 100 : totalReturn;

    let peak = amount;
    let maxDrawdown = 0;
    const chartData = bars.map(d => {
      const value = shares * px(d);
      if (value > peak) peak = value;
      const dd = (peak - value) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
      return { date: d.date, value };
    });

    const spyByDate = {};
    (spyHist || []).forEach(d => { const p = px(d); if (d && d.date && p != null) spyByDate[d.date] = p; });
    const common = bars.filter(d => spyByDate[d.date] != null);
    let spyReturn = null;
    let spyStart = null;
    let spyEnd = null;
    // The instrument over those same dates. Alpha took its return from its
    // own first bar against the S&P's from the first common one: BTC bought
    // on a Saturday, AAPL with no start date from 1980 against the S&P from
    // 1993 (alpha +351,788%).
    let commonReturn = null;
    if (common.length >= 2) {
      spyStart = common[0].date;
      spyEnd = common[common.length - 1].date;
      spyReturn = (spyByDate[spyEnd] / spyByDate[spyStart] - 1) * 100;
      commonReturn = (px(common[common.length - 1]) / px(common[0]) - 1) * 100;
    }
    const sameCurrency = assetCurrency === 'USD';
    return {
      startDate: bars[0].date,
      endDate: bars[bars.length - 1].date,
      startPrice, endPrice, shares, finalValue, totalReturn, annualizedReturn, maxDrawdown,
      spyReturn, spyStart, spyEnd, commonReturn, benchmarkCurrency: 'USD', currency: assetCurrency || null,
      alpha: spyReturn != null && commonReturn != null && sameCurrency ? commonReturn - spyReturn : null,
      chartData,
    };
  },

  // ==================== WHAT-IF SCENARIOS ====================

  /**
   * Apply buy / sell / swap actions to the current positions.
   *
   * Reads holdingsData the way the tracker writes it: keyed by holding.id,
   * with quantity and currentValue already in the portfolio currency. It used
   * to look up holdingsData[symbol] and h.shares / h.avgPrice, none of which
   * exist, so every portfolio was worth $0 and every action on a held
   * position failed. Amounts are in the portfolio currency;
   * `quotes[symbol]` gives the base-currency price of anything not held.
   * Positions are copied, never mutated, so "before" stays before.
   */
  /**
   * A symbol typed into What-If, in the form the portfolio stores it. "AAPL"
   * was a position of its own next to the held AAPL.US (49.1% + 14.1%, three
   * positions from two), "Sell MSFT" found no MSFT.US to sell, and VOO with no
   * exchange had no quote currency. A held symbol
   * with that code wins (a held VOD.LSE for "VOD"); otherwise the US listing,
   * as the backtest assumes.
   */
  correlationSymbols(holdingsWithData, max) {
    // The positions still held, largest first: a position sold to zero was
    // in the matrix, and the first eight in the order they were added stood
    // for a portfolio of more. Unpriced ones go last.
    const bySymbol = {};
    (holdingsWithData || []).forEach(h => {
      if (!h || !h.symbol) return;
      const q = h.quantity == null ? NaN : Number(h.quantity);
      if (Number.isFinite(q) && q <= 1e-9) return; // sold to zero
      const v = Number(h.currentValue);
      const prev = bySymbol[h.symbol];
      const value = Number.isFinite(v) ? v : -1;
      bySymbol[h.symbol] = prev == null ? value : (prev < 0 || value < 0 ? Math.max(prev, value) : prev + value);
    });
    return Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, max || 8).map(([sym]) => sym);
  },

  // The symbol a typed code names, through the one reader:
  // the held listing with that code; the listing the symbol search returned
  // for exactly that code (rows given); a crypto pair on CC (BTC-USD,
  // SOL-NZD) or a currency or metal pair on FOREX (EURUSD, USDXAU); "^GSPC"
  // the index; "BRK.B" the share class BRK-B.US; else the US listing. Every
  // bare code was made a US listing: BTC-USD.US "Could not fetch price",
  // EURUSD.US "No position to sell", and What-If kept
  // its own rules, which read ^GSPC as ^GSPC.US and SOL-NZD as a US share
  // while the Sentiment link read them right. '' when
  // the text names nothing (empty, "..", "a b"): the caller says so.
  // The Backtest reads its field the same way.
  // A holding is named by what it is, not how it is spelled: an old "BRK.B"
  // position is sold as BRK.B whether "BRK.B", "BRK-B" or "brk . b" is typed
  // -- the stored key is what its transactions hang on.
  whatIfSymbol(sym, heldSymbols, searchRows) {
    const SC = window.SymbolCode;
    const want = SC.of(sym, { held: heldSymbols, rows: searchRows });
    if (!want) return '';
    const held = (heldSymbols || []).map(h => String(h || '').trim().toUpperCase()).filter(Boolean);
    return held.find(h => h === want) || held.find(h => SC.of(h) === want) || want;
  },

  /** 'CC' for a bare crypto pair, 'FOREX' for a currency pair, else null. */
  pairVenue(code) {
    return window.SymbolCode.pairVenue(code);
  },

  whatIfSimulate({ holdings, holdingsData, scenarios, quotes, types }) {
    // The position's own type first (a held VOO is an ETF), then the search's
    // for a symbol not held yet; the suffix only for crypto and forex. Every
    // symbol that was neither crypto nor forex was "Stocks": a swap into VOO
    // read "Allocation: Stocks 100%".
    const LABEL = { etf: 'ETFs', fund: 'Funds', crypto: 'Crypto', forex: 'Forex', bond: 'Bonds', stock: 'Stocks' };
    const known = { ...(types || {}) };
    (holdings || []).forEach(h => { if (h.symbol && h.type && !known[h.symbol]) known[h.symbol] = h.type; });
    const typeOf = (sym) => {
      if (sym.includes('.CC')) return 'Crypto';
      if (sym.includes('.FOREX')) return 'Forex';
      const t = String(known[sym] || this.knownAssetType(sym) || '').toLowerCase();
      return LABEL[t] || 'Stocks';
    };
    const current = {};
    (holdings || []).forEach(h => {
      const d = holdingsData && holdingsData[h.id];
      if (!h.symbol || !d || d.priceUnavailable) return;
      const value = Number(d.currentValue);
      const shares = Number(d.quantity);
      if (!Number.isFinite(value) || !Number.isFinite(shares) || shares <= 0) return;
      const prev = current[h.symbol];
      current[h.symbol] = prev
        ? { value: prev.value + value, shares: prev.shares + shares }
        : { value, shares };
    });
    Object.values(current).forEach(p => { p.price = p.value / p.shares; });

    const sim = {};
    Object.entries(current).forEach(([s, p]) => { sim[s] = { ...p }; });
    const changes = [];
    const priceOf = (sym) => (sim[sym] ? sim[sym].price : (quotes && quotes[sym] && quotes[sym].price));

    const add = (sym, amount) => {
      const price = priceOf(sym);
      const shares = amount / price;
      if (sim[sym]) sim[sym] = { ...sim[sym], value: sim[sym].value + amount, shares: sim[sym].shares + shares };
      else sim[sym] = { value: amount, shares, price };
      return shares;
    };
    // More than is held sells what is held, and says so: it was cut to the
    // whole position without a word.
    const take = (sym, amount) => {
      const p = sim[sym];
      const capped = amount / p.price > p.shares + 1e-9;
      const shares = Math.min(amount / p.price, p.shares);
      const value = shares * p.price;
      const left = p.shares - shares;
      if (left <= 1e-9) delete sim[sym];
      else sim[sym] = { ...p, shares: left, value: p.value - value };
      return { shares, value, capped };
    };

    const heldNow = Object.keys(current);
    for (const raw of scenarios || []) {
      const sc = { ...raw, symbol: this.whatIfSymbol(raw.symbol, heldNow), ...(raw.from ? { from: this.whatIfSymbol(raw.from, heldNow) } : {}) };
      if (!(sc.amount > 0)) { changes.push({ ...sc, error: 'Amount must be positive' }); continue; }
      if (sc.type === 'sell') {
        if (!sim[sc.symbol]) { changes.push({ ...sc, error: 'No position to sell' }); continue; }
        const price = sim[sc.symbol].price;
        const r = take(sc.symbol, sc.amount);
        changes.push({ ...sc, shares: r.shares, price, value: r.value, capped: r.capped });
        continue;
      }
      const price = priceOf(sc.symbol);
      if (!(price > 0)) {
        changes.push({ ...sc, error: (quotes && quotes[sc.symbol] && quotes[sc.symbol].error) || 'Could not fetch price' });
        continue;
      }
      if (sc.type === 'buy') {
        const shares = add(sc.symbol, sc.amount);
        changes.push({ ...sc, shares, price, value: sc.amount });
      } else if (sc.type === 'swap') {
        if (!sc.from || !sim[sc.from]) { changes.push({ ...sc, error: 'Pick a held position to swap from' }); continue; }
        if (sc.from === sc.symbol) { changes.push({ ...sc, error: 'Swap needs two different symbols' }); continue; }
        const sold = take(sc.from, sc.amount);
        const bought = add(sc.symbol, sold.value);
        changes.push({ ...sc, soldShares: sold.shares, shares: bought, price, value: sold.value, capped: sold.capped });
      }
    }

    const summarize = (positions) => {
      let total = 0;
      const alloc = {};
      Object.entries(positions).forEach(([sym, p]) => {
        total += p.value;
        alloc[typeOf(sym)] = (alloc[typeOf(sym)] || 0) + p.value;
      });
      return { totalValue: total, alloc, posCount: Object.keys(positions).length };
    };
    const before = summarize(current);
    const after = summarize(sim);
    const concentration = Object.entries(sim)
      .map(([symbol, p]) => ({ symbol, pct: after.totalValue > 0 ? p.value / after.totalValue * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);
    const topConcentration = concentration[0] ? concentration[0].pct : 0;
    // Diversification from the weights themselves: the effective number of
    // positions, 1 / sum(w^2), against twenty equal ones for 100. It was
    // min(100, positions x 10 + (100 - top%)), which gave four stocks with 41%
    // in one a score of 99/100 -- and went into the AI prompt unrounded,
    // "99.16530682885823". Four equal
    // positions score 20; 41/32/15/12 scores 16.
    const hhi = concentration.reduce((s, c) => s + Math.pow(c.pct / 100, 2), 0);
    const effectivePositions = hhi > 0 ? 1 / hhi : 0;
    // The portfolio holds no cash: what a sale brings in is not in "after".
    // Said beside the total instead of vanishing from it.
    const cashFromSales = changes.filter(c => !c.error && c.type === 'sell').reduce((t, c) => t + (c.value || 0), 0);
    return {
      before, after, changes, cashFromSales,
      concentration: concentration.slice(0, 5),
      topConcentration,
      effectivePositions,
      diversificationScore: Math.round(Math.min(100, effectivePositions / 20 * 100)),
    };
  },

  // ==================== FORMATTING ====================

  formatCurrency(value, currency = 'USD', decimals = 2) {
    // Infinity used to print as "$∞"; and a value that rounds to nothing
    // printed "-$0.00", a negative zero. Neither is a number anyone meant.
    if (typeof value === 'string') value = parseFloat(value);
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    if (Math.abs(value) < Math.pow(10, -decimals) / 2) value = 0;

    const symbols = {
      USD: '$', EUR: '€', GBP: '£', JPY: '¥', RUB: '₽',
      BTC: '₿', ETH: 'Ξ', CHF: 'Fr'
    };

    const symbol = symbols[currency] || currency + ' ';
    // Currencies without minor units print whole. Yen has no sen in
    // circulation, and "¥1,234.00" reads as a rounding error to anyone who
    // uses it. The list is the ISO zero-decimal set, trimmed to what EODHD
    // quotes.
    const ZERO_DECIMAL = ['JPY', 'KRW', 'CLP', 'ISK', 'VND', 'HUF', 'TWD', 'IDR'];
    if (ZERO_DECIMAL.includes(currency)) decimals = 0;
    const formatted = Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    return value < 0 ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
  },

  formatPercent(value, decimals = 2) {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    if (Math.abs(value) < Math.pow(10, -decimals) / 2) value = 0;
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
  },

  /**
   * `value.toFixed(d)` without a sign on a value that rounds to zero: a
   * correlation of -0.0004 read "-0.00".
   */
  fixed(value, d = 2) {
    const s = Number(value).toFixed(d);
    return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
  },

  /**
   * A quantity at the precision its asset trades in: crypto (and FOREX)
   * to eight decimals, shares to four, trailing zeros dropped. Tax-Loss
   * Harvesting printed 0.004 BTC as "0.00 shares".
   * `typeOrSymbol` is a holding type ('crypto') or an EODHD symbol.
   */
  quantityText(value, typeOrSymbol) {
    const v = Number(value);
    if (!Number.isFinite(v)) return 'N/A';
    const t = this.quantityKind(typeOrSymbol);
    const fine = t === 'crypto' || t === 'forex' || this.importSymbolType(t) != null;
    // Shares to four places; a holding smaller than that still shows its
    // figure rather than "0".
    // Of an unknown kind, a fraction of one keeps eight (it may be a coin).
    let d = fine || (!t && Math.abs(v) < 1) ? 8 : 4;
    const a = Math.abs(v);
    // Below 0.0001 a share's places run to its first significant digit (at
    // most eight): 0.00005 read "0.0001", double the holding. Float residue (0.3 - 0.1 - 0.2) is no holding and stays "0".
    if (a < 1e-12) return '0';
    if (d === 4 && a < 0.0001) d = Math.min(8, Math.max(4, Math.ceil(-Math.log10(a) - 1e-9)));
    // Under the last place there is: said so, never "0" for a holding. A
    // negative one that small is residue, not a short: "0", never "-0".
    if (a < 0.5e-8) return v > 0 ? '<0.00000001' : '0';
    const s = v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
    return s === '-0' ? '0' : s;
  },
  /** A holding (its type, else its symbol), a type, or a symbol. */
  quantityKind(typeOrSymbol) {
    const k = typeOrSymbol;
    if (k && typeof k === 'object') return k.type === 'crypto' || k.type === 'forex' || k.type === 'manual' ? k.type : String(k.symbol || k.type || '');
    return String(k || '');
  },
  /** "shares" for a share or fund, "units" for crypto, forex and the like. */
  quantityUnit(typeOrSymbol, n) {
    const t = this.quantityKind(typeOrSymbol);
    const units = t === 'crypto' || t === 'forex' || t === 'manual' || this.importSymbolType(t) != null;
    return units ? (n === 1 ? 'unit' : 'units') : (n === 1 ? 'share' : 'shares');
  },

  // Every quantity on screen goes through quantityText: the table printed
  // eight places with their zeros ("0.01000000" BTC, "0.00040000" MSFT)
  // while Tax said "0.004 units". `kind` is a holding,
  // a type or a symbol; without it, a share's four places.
  formatQuantity(value, kind) {
    if (value === null || value === undefined || value === '' || isNaN(value)) return 'N/A';
    return this.quantityText(value, kind);
  }
};
