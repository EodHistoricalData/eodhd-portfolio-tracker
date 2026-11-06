// Insider Transactions helpers — normalisation + aggregation of EODHD form4
// (SEC EDGAR Form 4 payloads). The new /api/sec-filings/{symbol}/form4
// endpoint returns nested filings → non_derivative[]/derivative[] →
// transactions; the AssetDetail Insiders tab expects a flat list, so we
// flatten and enrich here. Shared with Wave 12 (Relationship Map) which
// also consumes insider activity as one of its three pillars.
//
// SEC Section 16 transaction codes — full reference at
// https://www.sec.gov/about/forms/secform4.pdf. The 15 documented codes
// fall into four UX buckets for our retail-facing chart:
//   BUY   — open-market acquisition (P) or small Rule 16a-6 (L)
//   SELL  — open-market disposition (S, D, W)
//   GRANT — comp award / option exercise / stock conversion (A, M, C, L)
//   OTHER — gift (G), tax-withhold (F), expired (E/H), indirect (I/J/K/V/O)

(function () {
  if (window.InsiderTx) return;

  const CODE_BUCKET = {
    P: 'buy',   // Open-market or private purchase
    S: 'sell',  // Open-market or private sale
    A: 'grant', // Grant, award or other acquisition
    M: 'grant', // Exercise/conversion of derivative
    F: 'other', // Payment of exercise price / tax withholding
    G: 'other', // Bona fide gift
    D: 'sell',  // Sale to issuer / Rule 16b-3(d)
    W: 'sell',  // Acquisition or disposition by will or laws of descent
    J: 'other', // Other acquisition or disposition (footnote required)
    K: 'other', // Equity swap or similar
    L: 'buy',   // Small acquisition under Rule 16a-6
    V: 'other', // Voluntary report transaction
    C: 'grant', // Conversion of derivative security
    E: 'other', // Expired short derivative
    H: 'other', // Expired long derivative
    O: 'other', // Exercise of out-of-the-money derivative
    I: 'other', // Discretionary transaction by employee benefit plan
  };

  const CODE_LABEL = {
    P: 'Purchase', S: 'Sale', A: 'Award', M: 'Exercise',
    F: 'Tax / Fee', G: 'Gift', D: 'Disposition', W: 'Inheritance',
    J: 'Other', K: 'Swap', L: 'Small Buy', V: 'Voluntary',
    C: 'Conversion', E: 'Expired', H: 'Expired', O: 'OTM Exercise', I: 'Plan',
  };

  function bucketFor(code, acquiredOrDisposed) {
    const b = CODE_BUCKET[String(code || '').toUpperCase()];
    if (b) return b;
    // Fallback when we don't know the code: trust A/D flag.
    if (acquiredOrDisposed === 'A') return 'buy';
    if (acquiredOrDisposed === 'D') return 'sell';
    return 'other';
  }

  function labelFor(code) {
    return CODE_LABEL[String(code || '').toUpperCase()] || (code ? `Code ${code}` : 'Unknown');
  }

  // Flatten a form4 payload into a per-transaction list sorted newest-first.
  // Each row carries enough info for the Insiders tab and Relationship Map:
  //   date, ownerName, ownerTitle, ownerCik, isOfficer, isDirector, isTenPctOwner,
  //   code, codeLabel, bucket (buy/sell/grant/other),
  //   shares, price, totalValue, sharesOwnedAfter, securityTitle,
  //   isDerivative, accessionNumber, footnotes[]
  function flattenForm4(payload) {
    if (!payload) return [];
    // Real EODHD form4 shape (verified against the live API 2026-05-31):
    //   { "data": [ {filing}, ... ], "meta": {...}, "links": {...} }
    // i.e. `data` is the filings ARRAY directly — NOT `data.filings`. The
    // earlier guess (`payload.data.filings`) silently returned [] for every
    // ticker, which is why all insiders fell back to the legacy
    // fundamentals.InsiderTransactions field (present for TSLA/GOOGL, empty
    // for AAPL → "AAPL has no insiders" bug).
    const filings = Array.isArray(payload) ? payload
      : Array.isArray(payload.data) ? payload.data
      : (payload.data && Array.isArray(payload.data.filings)) ? payload.data.filings
      : Array.isArray(payload.filings) ? payload.filings
      : [];
    const out = [];
    for (const f of filings) {
      if (!f || typeof f !== 'object') continue;
      const acc = f.accession_number || f.accessionNumber || '';
      const filedAt = f.filed_at || f.filedAt || f.filing_date || null;
      const period = f.period_of_report || f.periodOfReport || filedAt;
      const footnotes = Array.isArray(f.footnotes) ? f.footnotes : [];
      pushList(out, f.non_derivative, false, filedAt, period, acc, footnotes);
      pushList(out, f.derivative, true, filedAt, period, acc, footnotes);
    }
    // Newest first.
    out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return out;
  }

  function pushList(out, list, isDerivative, filedAt, period, acc, footnotes) {
    if (!Array.isArray(list)) return;
    for (const tx of list) {
      if (!tx || typeof tx !== 'object') continue;
      // Real form4 rows are FLAT — role flags + owner identity live directly
      // on the transaction object, not in a nested reporting_owner.roles.
      // (Verified against live API 2026-05-31; the nested-shape fallbacks are
      // kept for safety but the flat fields are authoritative.)
      const code = tx.transaction_code || tx.transactionCode || '';
      const ad = tx.acquired_or_disposed || tx.acquiredOrDisposed || '';
      const shares = Number(tx.shares_amount ?? tx.sharesAmount ?? tx.shares ?? tx.transactionAmount) || 0;
      const price = Number(tx.price_per_share ?? tx.pricePerShare ?? tx.price ?? tx.transactionPrice) || 0;
      const totalValue = tx.total_value != null ? Number(tx.total_value)
        : tx.totalValue != null ? Number(tx.totalValue)
        : (shares && price ? +(shares * price).toFixed(2) : 0);
      const officerTitle = tx.officer_title || tx.officerTitle || '';
      out.push({
        date: (tx.transaction_date || tx.transactionDate || period || filedAt || '').slice(0, 10),
        filedAt,
        ownerName: tx.reporting_owner_name || tx.reporterName || tx.ownerName || tx.name || 'Unknown',
        ownerTitle: officerTitle || (tx.is_director ? 'Director' : '') || tx.reporterRelation || tx.ownerTitle || '',
        ownerCik: tx.reporting_owner_cik || tx.reporterCik || null,
        isOfficer: !!(tx.is_officer ?? tx.isOfficer),
        isDirector: !!(tx.is_director ?? tx.isDirector),
        isTenPctOwner: !!(tx.is_ten_percent_owner ?? tx.isTenPercentOwner),
        code,
        codeLabel: labelFor(code),
        bucket: bucketFor(code, ad),
        acquiredOrDisposed: ad,
        shares,
        price,
        totalValue,
        sharesOwnedAfter: Number(tx.shares_owned_after ?? tx.sharesOwnedAfter ?? tx.sharesAfterTransaction) || 0,
        securityTitle: tx.security_title || tx.securityTitle || '',
        isDerivative,
        accessionNumber: acc,
        footnotes,
      });
    }
  }

  // Aggregate stats over a sliding window in days (default 90). Returns:
  //   { netBuyDollars, netSellDollars, txCount, uniqueInsiders, buyCount,
  //     sellCount, biggestBuy, biggestSell, periodDays }
  function aggregate(transactions, periodDays) {
    const days = periodDays || 90;
    const cutoffMs = Date.now() - days * 86400000;
    const inWindow = (transactions || []).filter(t => {
      if (!t.date) return false;
      const tMs = Date.parse(t.date);
      return Number.isFinite(tMs) && tMs >= cutoffMs;
    });
    let netBuyDollars = 0, netSellDollars = 0;
    let buyCount = 0, sellCount = 0;
    let biggestBuy = null, biggestSell = null;
    const insiders = new Set();
    for (const t of inWindow) {
      // Stock buckets only — derivatives skew $ totals; we surface them
      // separately in the UI but exclude from the headline net flow.
      if (t.isDerivative) continue;
      if (t.ownerName) insiders.add(t.ownerName);
      if (t.bucket === 'buy') {
        netBuyDollars += t.totalValue;
        buyCount++;
        if (!biggestBuy || t.totalValue > biggestBuy.totalValue) biggestBuy = t;
      } else if (t.bucket === 'sell') {
        netSellDollars += t.totalValue;
        sellCount++;
        if (!biggestSell || t.totalValue > biggestSell.totalValue) biggestSell = t;
      }
    }
    return {
      netBuyDollars: +netBuyDollars.toFixed(2),
      netSellDollars: +netSellDollars.toFixed(2),
      netFlowDollars: +(netBuyDollars - netSellDollars).toFixed(2),
      txCount: inWindow.length,
      uniqueInsiders: insiders.size,
      buyCount,
      sellCount,
      biggestBuy,
      biggestSell,
      periodDays: days,
    };
  }

  // Filter transactions by user-toggleable criteria. Used by the Insiders
  // tab's chip filters — Purchases / Sales / Officers / Directors / >$100k.
  function applyFilters(transactions, filters) {
    if (!filters) return transactions || [];
    let out = transactions || [];
    if (filters.bucket === 'buy') out = out.filter(t => t.bucket === 'buy');
    else if (filters.bucket === 'sell') out = out.filter(t => t.bucket === 'sell');
    if (filters.officersOnly) out = out.filter(t => t.isOfficer);
    if (filters.directorsOnly) out = out.filter(t => t.isDirector);
    if (filters.minDollars) out = out.filter(t => t.totalValue >= filters.minDollars);
    if (filters.hideDerivative) out = out.filter(t => !t.isDerivative);
    return out;
  }

  window.InsiderTx = {
    flattenForm4,
    aggregate,
    applyFilters,
    bucketFor,
    labelFor,
    CODE_LABEL,
  };
})();
