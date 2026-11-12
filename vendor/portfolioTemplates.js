/**
 * Portfolio Templates - 76 portfolio templates.
 *
 * Two kinds live in here and they are NOT interchangeable:
 *
 *   fund-backed   category 'fund'. Carries fundTicker; tickers/weights start
 *                 empty and are filled at runtime from the fund's real
 *                 holdings. Nothing about the contents is written down here,
 *                 so nothing here can go stale.
 *   curated       everything else. A hand-picked basket expressing a theme, a
 *                 region or an allocation model. Static on purpose: it is our
 *                 selection, not a claim about anyone's holdings.
 *
 * The distinction exists because the previous version blurred it - see the
 * note above STRATEGY MODELS below.
 */
// Every ticker below must quote. They are checked against the live API, with
// each template's weights summing to 100, before every release (the check
// lives with the EODHD terminal, which this file is copied from). On
// 02.10 eleven did not: SQ is XYZ now; Sandvik,
// Fortescue, First Quantum and Hyundai trade as SAND.ST, FMG.AU, FM.TO and
// 005380.KO; the delisted AJRD, MMP, LTHM, NGE, GULF and TTM were replaced
// by live peers (LHX, MPLX, SQM, EZA, QAT, WIT). Weights are unchanged.
window.PORTFOLIO_TEMPLATES = [
  // ===========================================
  // STRATEGY MODELS (3)
  //
  // Fifteen "famous investor" portfolios used to sit here: static ticker lists
  // under the names of living people, produced by an AI pass on 2026-04-09 and
  // never sourced against anything.
  //
  // Ten claimed to be somebody's actual positions. Only a 13F filing
  // establishes that, and EODHD does not carry 13F - it is listed as a gap in
  // the terminal's own notes. Unsourced, and
  // unsourceable with the data we sell, so they are gone.
  //
  // Two were really funds. They moved to FUND REPLICAS below, under the fund's
  // own name, and their holdings now load live.
  //
  // These three are allocation MODELS - published rules about how to split
  // across asset classes, not a record of what anyone owns. That is a claim we
  // can stand behind, so they stay, named for the model rather than the person.
  // ===========================================
  {
    id: 'all-weather',
    name: 'All Weather',
    category: 'strategy',
    description: 'Risk parity: sized so no single economic regime dominates',
    icon: 'shield',
    tickers: ['SPY.US', 'TLT.US', 'GLD.US', 'IEF.US', 'DBC.US'],
    // The split as published: 30% stocks, 40% long Treasuries, 15%
    // intermediate Treasuries, 7.5% gold, 7.5% commodities. It read
    // 30/25/20/15/10 under the "widely published" note.
    weights: [30, 40, 7.5, 15, 7.5],
    risk: 2,
    returnRange: '5-7%',
    targetAge: '25-70',
    tags: ['risk-parity', 'diversified', 'all-weather'],
    note: 'A widely published static risk-parity allocation. Not a fund, and not anyone reported holdings.',
  },
  {
    id: 'endowment-model',
    name: 'Endowment Model',
    category: 'strategy',
    description: 'Equity-heavy with real assets, in the manner of large university endowments',
    icon: 'briefcase',
    tickers: ['VTI.US', 'VEA.US', 'VNQ.US', 'TLT.US', 'VWO.US'],
    weights: [30, 20, 20, 15, 15],
    risk: 3,
    returnRange: '7-10%',
    targetAge: '25-60',
    tags: ['endowment', 'diversified', 'real-assets'],
    note: 'An allocation style described in public writing on endowment investing. Not the holdings of any specific endowment.',
  },
  {
    id: 'barbell',
    name: 'Barbell',
    category: 'strategy',
    description: 'Most of it deliberately boring, a small sleeve deliberately not',
    icon: 'activity',
    tickers: ['SHY.US', 'BIL.US', 'QQQ.US', 'ARKK.US', 'GBTC.US'],
    weights: [45, 35, 10, 5, 5],
    risk: 3,
    returnRange: '4-12%',
    targetAge: '25-65',
    tags: ['barbell', 'convexity', 'tail-risk'],
    note: 'A published portfolio-construction idea - extreme safety paired with a small convex bet.',
  },

  // ═══════════════════════════════════════════
  // THEMATIC PORTFOLIOS (15)
  // ═══════════════════════════════════════════
  {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    category: 'thematic',
    description: 'Digital defense and zero-trust security',
    icon: 'lock',
    tickers: ['PANW.US', 'CRWD.US', 'ZS.US', 'OKTA.US', 'S.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 4,
    returnRange: '10-18%',
    targetAge: '18-50',
    tags: ['security', 'tech', 'growth'],
  },
  {
    id: 'space',
    name: 'Space & Defense',
    category: 'thematic',
    description: 'Aerospace, satellites, and defense contractors',
    icon: 'rocket',
    tickers: ['LMT.US', 'RTX.US', 'NOC.US', 'LHX.US', 'RKLB.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 3,
    returnRange: '7-12%',
    targetAge: '25-55',
    tags: ['space', 'defense', 'aerospace'],
  },
  {
    id: 'metaverse',
    name: 'Metaverse / VR',
    category: 'thematic',
    description: 'Virtual worlds, gaming, and XR platforms',
    icon: 'layers',
    tickers: ['META.US', 'RBLX.US', 'U.US', 'NVDA.US', 'AMZN.US'],
    weights: [30, 20, 20, 20, 10],
    risk: 5,
    returnRange: '8-20%',
    targetAge: '18-40',
    tags: ['metaverse', 'VR', 'gaming'],
  },
  {
    id: 'luxury',
    name: 'Luxury Brands',
    category: 'thematic',
    description: 'Premium consumer brands and fashion',
    icon: 'award',
    tickers: ['LVMUY.US', 'RL.US', 'TPR.US', 'CPRI.US', 'EL.US'],
    weights: [30, 20, 20, 15, 15],
    risk: 3,
    returnRange: '6-10%',
    targetAge: '25-55',
    tags: ['luxury', 'consumer', 'brands'],
  },
  {
    id: 'water',
    name: 'Water & Agriculture',
    category: 'thematic',
    description: 'Essential resources and food supply chain',
    icon: 'heart',
    tickers: ['AWK.US', 'DBA.US', 'MOS.US', 'CF.US', 'TTC.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 3,
    returnRange: '5-8%',
    targetAge: '25-60',
    tags: ['water', 'agriculture', 'resources'],
  },
  {
    id: 'infrastructure',
    name: 'US Infrastructure',
    category: 'thematic',
    description: 'Building, construction, and materials',
    icon: 'settings',
    tickers: ['CAT.US', 'VMC.US', 'NUE.US', 'DHI.US', 'URI.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 3,
    returnRange: '7-10%',
    targetAge: '25-55',
    tags: ['infrastructure', 'construction', 'industrial'],
  },
  {
    id: 'crypto',
    name: 'Crypto Ecosystem',
    category: 'thematic',
    description: 'Bitcoin miners and crypto platforms',
    icon: 'zap',
    tickers: ['COIN.US', 'MSTR.US', 'RIOT.US', 'MARA.US', 'SI.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 5,
    returnRange: '-20 to +40%',
    targetAge: '18-40',
    tags: ['crypto', 'bitcoin', 'blockchain'],
  },
  {
    id: 'aging',
    name: 'Aging Population',
    category: 'thematic',
    description: 'Healthcare and senior living',
    icon: 'heart',
    tickers: ['WELL.US', 'CHE.US', 'UNH.US', 'DGX.US', 'EW.US'],
    weights: [25, 20, 25, 15, 15],
    risk: 2,
    returnRange: '6-9%',
    targetAge: '25-60',
    tags: ['healthcare', 'aging', 'demographic'],
  },
  {
    id: 'india',
    name: 'India Growth',
    category: 'thematic',
    description: 'India technology and financial leaders',
    icon: 'globe',
    tickers: ['INDA.US', 'IBN.US', 'INFY.US', 'WIT.US', 'HDB.US'],
    weights: [25, 20, 25, 15, 15],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '25-55',
    tags: ['india', 'emerging', 'growth'],
  },
  {
    id: 'japan',
    name: 'Japan Revival',
    category: 'thematic',
    description: 'Japanese corporate reform and innovation',
    icon: 'globe',
    tickers: ['EWJ.US', 'TM.US', 'MUFG.US', 'SONY.US', 'HMC.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 3,
    returnRange: '5-10%',
    targetAge: '25-55',
    tags: ['japan', 'reform', 'value'],
  },
  {
    id: 'semiconductors',
    name: 'Semiconductors',
    category: 'thematic',
    description: 'Chip makers powering AI and computing',
    icon: 'zap',
    tickers: ['NVDA.US', 'AVGO.US', 'ASML.US', 'AMD.US', 'QCOM.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 4,
    returnRange: '10-18%',
    targetAge: '18-50',
    tags: ['semiconductors', 'AI', 'tech'],
  },
  {
    id: 'cloud',
    name: 'Cloud Computing',
    category: 'thematic',
    description: 'Cloud infrastructure and SaaS platforms',
    icon: 'layers',
    tickers: ['MSFT.US', 'AMZN.US', 'CRM.US', 'SNOW.US', 'DDOG.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 4,
    returnRange: '10-15%',
    targetAge: '18-50',
    tags: ['cloud', 'SaaS', 'tech'],
  },
  {
    id: 'nuclear',
    name: 'Nuclear Energy',
    category: 'thematic',
    description: 'Uranium miners and nuclear power',
    icon: 'activity',
    tickers: ['CCJ.US', 'URA.US', 'DNN.US', 'LEU.US', 'NLR.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '25-50',
    tags: ['nuclear', 'energy', 'uranium'],
  },
  {
    id: 'cannabis',
    name: 'Cannabis',
    category: 'thematic',
    description: 'Cannabis producers and REITs',
    icon: 'filter',
    tickers: ['CGC.US', 'TLRY.US', 'CRON.US', 'ACB.US', 'IIPR.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 5,
    returnRange: '-10 to +30%',
    targetAge: '18-40',
    tags: ['cannabis', 'speculative', 'regulation'],
  },
  {
    id: 'sports',
    name: 'Sports & Entertainment',
    category: 'thematic',
    description: 'Live events, streaming, and sports betting',
    icon: 'star',
    tickers: ['DIS.US', 'NFLX.US', 'LYV.US', 'DKNG.US', 'ROST.US'],
    weights: [25, 25, 20, 20, 10],
    risk: 4,
    returnRange: '7-12%',
    targetAge: '18-50',
    tags: ['entertainment', 'streaming', 'sports'],
  },

  // ═══════════════════════════════════════════
  // INCOME-FOCUSED (5)
  // ═══════════════════════════════════════════
  {
    id: 'monthly-dividends',
    name: 'Monthly Dividends',
    category: 'income',
    description: 'Monthly dividend payers for steady cash flow',
    icon: 'dollar',
    tickers: ['O.US', 'MAIN.US', 'STAG.US', 'PBA.US', 'AGNC.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 3,
    returnRange: '6-8%',
    targetAge: '40-70',
    tags: ['monthly', 'dividend', 'income'],
  },
  {
    id: 'covered-call',
    name: 'Covered Call ETFs',
    category: 'income',
    description: 'High yield via options premium strategies',
    icon: 'dollar',
    tickers: ['JEPI.US', 'JEPQ.US', 'QYLD.US', 'XYLD.US', 'RYLD.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 3,
    returnRange: '8-12%',
    targetAge: '35-70',
    tags: ['covered-call', 'options', 'income'],
  },
  {
    id: 'bond-ladder',
    name: 'Bond Ladder',
    category: 'income',
    description: 'Diversified duration bond exposure',
    icon: 'layers',
    tickers: ['SHY.US', 'IEF.US', 'TLT.US', 'LQD.US', 'HYG.US'],
    weights: [20, 25, 20, 20, 15],
    risk: 2,
    returnRange: '3-5%',
    targetAge: '45-75',
    tags: ['bonds', 'fixed-income', 'ladder'],
  },
  {
    id: 'preferred-stocks',
    name: 'Preferred Stocks',
    category: 'income',
    description: 'Higher yield via preferred share ETFs',
    icon: 'dollar',
    tickers: ['PFF.US', 'PGF.US', 'FPE.US', 'PSK.US', 'VRP.US'],
    weights: [30, 20, 20, 15, 15],
    risk: 3,
    returnRange: '5-7%',
    targetAge: '40-70',
    tags: ['preferred', 'fixed-income', 'yield'],
  },
  {
    id: 'mlp-energy',
    name: 'MLP Energy Income',
    category: 'income',
    description: 'Energy pipeline partnerships for high yield',
    icon: 'activity',
    tickers: ['AMLP.US', 'EPD.US', 'MPLX.US', 'ET.US', 'WES.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '7-9%',
    targetAge: '35-65',
    tags: ['MLP', 'energy', 'pipeline'],
  },

  // ═══════════════════════════════════════════
  // STRATEGY PORTFOLIOS (5)
  // ═══════════════════════════════════════════
  {
    id: 'dividend-aristocrats',
    name: 'Dividend Aristocrats',
    category: 'strategy',
    description: '25+ years of consecutive dividend increases',
    icon: 'award',
    tickers: ['JNJ.US', 'PG.US', 'KO.US', 'VZ.US', 'T.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 2,
    returnRange: '4-7%',
    targetAge: '35-70',
    tags: ['dividend', 'aristocrats', 'stable'],
  },
  {
    id: 'growth-rocket',
    name: 'Growth Rocket',
    category: 'strategy',
    description: 'Mega-cap tech growth leaders',
    icon: 'rocket',
    tickers: ['AAPL.US', 'MSFT.US', 'NVDA.US', 'TSLA.US', 'AMZN.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '10-15%',
    targetAge: '18-45',
    tags: ['growth', 'tech', 'mega-cap'],
  },
  {
    id: 'value-seeker',
    name: 'Value Seeker',
    category: 'strategy',
    description: 'Undervalued blue chips with strong fundamentals',
    icon: 'search',
    tickers: ['BRK-B.US', 'JPM.US', 'XOM.US', 'PFE.US', 'WFC.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 3,
    returnRange: '7-10%',
    targetAge: '30-60',
    tags: ['value', 'blue-chip', 'fundamentals'],
  },
  {
    id: 'balanced-60-40',
    name: 'Balanced 60/40',
    category: 'strategy',
    description: 'Classic stocks/bonds allocation',
    icon: 'shield',
    tickers: ['VOO.US', 'AGG.US', 'VEA.US', 'BND.US', 'VTI.US'],
    weights: [30, 20, 20, 20, 10],
    risk: 2,
    returnRange: '5-8%',
    targetAge: '30-65',
    tags: ['balanced', '60-40', 'diversified'],
  },
  {
    id: 'momentum',
    name: 'Momentum',
    category: 'strategy',
    description: 'Riding the strongest price trends',
    icon: 'trendUp',
    tickers: ['META.US', 'AVGO.US', 'LLY.US', 'COST.US', 'CRM.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '25-50',
    tags: ['momentum', 'trend', 'growth'],
  },

  // ═══════════════════════════════════════════
  // LIFE STAGE PORTFOLIOS (5)
  // ═══════════════════════════════════════════
  {
    id: 'starter',
    name: 'Starter (18-25)',
    category: 'lifecycle',
    description: 'First portfolio: broad market exposure',
    icon: 'plus',
    tickers: ['SPY.US', 'VTI.US', 'QQQ.US', 'VUG.US', 'IXUS.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 3,
    returnRange: '7-12%',
    targetAge: '18-25',
    tags: ['starter', 'beginner', 'index'],
  },
  {
    id: 'early-career',
    name: 'Early Career (25-35)',
    category: 'lifecycle',
    description: 'Growth-tilted with global diversification',
    icon: 'trendUp',
    tickers: ['VTI.US', 'VXUS.US', 'QQQ.US', 'AAPL.US', 'MSFT.US'],
    weights: [30, 20, 20, 15, 15],
    risk: 3,
    returnRange: '8-12%',
    targetAge: '25-35',
    tags: ['growth', 'career', 'accumulation'],
  },
  {
    id: 'mid-career',
    name: 'Mid-Career (35-50)',
    category: 'lifecycle',
    description: 'Balanced growth with some stability',
    icon: 'users',
    tickers: ['VOO.US', 'BND.US', 'VEA.US', 'JNJ.US', 'PG.US'],
    weights: [30, 20, 20, 15, 15],
    risk: 2,
    returnRange: '5-8%',
    targetAge: '35-50',
    tags: ['balanced', 'moderate', 'family'],
  },
  {
    id: 'pre-retirement',
    name: 'Pre-Retirement (50-65)',
    category: 'lifecycle',
    description: 'Capital preservation with income focus',
    icon: 'shield',
    tickers: ['VYM.US', 'BND.US', 'AGG.US', 'JNJ.US', 'PG.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 2,
    returnRange: '4-7%',
    targetAge: '50-65',
    tags: ['preservation', 'income', 'defensive'],
  },
  {
    id: 'retirement',
    name: 'Retirement (65+)',
    category: 'lifecycle',
    description: 'Maximum stability and income',
    icon: 'heart',
    tickers: ['SCHD.US', 'BND.US', 'T.US', 'VZ.US', 'O.US'],
    weights: [25, 30, 20, 15, 10],
    risk: 1,
    returnRange: '3-5%',
    targetAge: '65+',
    tags: ['retirement', 'income', 'safe'],
  },

  // ═══════════════════════════════════════════
  // REGIONAL / COUNTRY (10)
  // ═══════════════════════════════════════════
  {
    id: 'china-tech',
    name: 'China Tech',
    category: 'regional',
    description: 'Chinese technology and e-commerce giants',
    icon: 'globe',
    tickers: ['KWEB.US', 'BABA.US', 'JD.US', 'PDD.US', 'BIDU.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '5-20%',
    targetAge: '25-50',
    tags: ['china', 'tech', 'emerging'],
  },
  {
    id: 'brazil-latam',
    name: 'Brazil / LatAm',
    category: 'regional',
    description: 'Latin American commodities and fintech',
    icon: 'globe',
    tickers: ['EWZ.US', 'PBR.US', 'VALE.US', 'MELI.US', 'NU.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 4,
    returnRange: '6-15%',
    targetAge: '25-55',
    tags: ['brazil', 'latam', 'commodities'],
  },
  {
    id: 'uk-blue-chips',
    name: 'UK Blue Chips',
    category: 'regional',
    description: 'British blue-chip multinationals',
    icon: 'globe',
    tickers: ['EWU.US', 'BP.US', 'AZN.US', 'HSBC.US', 'RIO.US'],
    weights: [20, 20, 25, 20, 15],
    risk: 3,
    returnRange: '5-8%',
    targetAge: '30-60',
    tags: ['UK', 'blue-chip', 'dividend'],
  },
  {
    id: 'south-korea',
    name: 'South Korea',
    category: 'regional',
    description: 'Korean tech and semiconductor leaders',
    icon: 'globe',
    tickers: ['EWY.US', 'SSNLF.US', 'SKM.US', '005380.KO', 'LPL.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '6-12%',
    targetAge: '25-55',
    tags: ['korea', 'tech', 'semiconductor'],
  },
  {
    id: 'australia',
    name: 'Australia Resources',
    category: 'regional',
    description: 'Australian mining and energy giants',
    icon: 'globe',
    tickers: ['EWA.US', 'BHP.US', 'RIO.US', 'FMG.AU', 'WDS.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 3,
    returnRange: '5-10%',
    targetAge: '25-60',
    tags: ['australia', 'mining', 'resources'],
  },
  {
    id: 'asean',
    name: 'ASEAN Growth',
    category: 'regional',
    description: 'Southeast Asian digital economy',
    icon: 'globe',
    tickers: ['EEMA.US', 'SE.US', 'GRAB.US', 'DBSDY.US'],
    weights: [30, 30, 25, 15],
    risk: 4,
    returnRange: '6-14%',
    targetAge: '25-50',
    tags: ['ASEAN', 'digital', 'emerging'],
  },
  {
    id: 'middle-east',
    name: 'Middle East',
    category: 'regional',
    description: 'Gulf states diversification and energy',
    icon: 'globe',
    tickers: ['KSA.US', 'QAT.US', 'UAE.US'],
    weights: [40, 35, 25],
    risk: 3,
    returnRange: '5-10%',
    targetAge: '25-55',
    tags: ['middle-east', 'gulf', 'energy'],
  },
  {
    id: 'africa',
    name: 'Africa Frontier',
    category: 'regional',
    description: 'Frontier market exposure in Africa',
    icon: 'globe',
    tickers: ['AFK.US', 'EZA.US', 'FM.TO'],
    weights: [40, 35, 25],
    risk: 5,
    returnRange: '5-18%',
    targetAge: '25-50',
    tags: ['africa', 'frontier', 'growth'],
  },
  {
    id: 'canada',
    name: 'Canada Resources',
    category: 'regional',
    description: 'Canadian energy, mining, and finance',
    icon: 'globe',
    tickers: ['EWC.US', 'ENB.US', 'SU.US', 'CNQ.US', 'BAM.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 3,
    returnRange: '5-9%',
    targetAge: '25-60',
    tags: ['canada', 'energy', 'resources'],
  },
  {
    id: 'swiss-nordic',
    name: 'Swiss / Nordic Quality',
    category: 'regional',
    description: 'European quality and innovation leaders',
    icon: 'globe',
    tickers: ['EWL.US', 'NVO.US', 'ASML.US', 'NOK.US', 'SAND.ST'],
    weights: [25, 25, 25, 15, 10],
    risk: 3,
    returnRange: '6-10%',
    targetAge: '25-60',
    tags: ['swiss', 'nordic', 'quality'],
  },

  // ═══════════════════════════════════════════
  // MACRO / EVENT-DRIVEN (7)
  // ═══════════════════════════════════════════
  {
    id: 'inflation-hedge',
    name: 'Inflation Hedge',
    category: 'macro',
    description: 'Real assets and commodities for inflation protection',
    icon: 'shield',
    tickers: ['GLD.US', 'TIP.US', 'DBC.US', 'VNQ.US', 'XOM.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 2,
    returnRange: '4-8%',
    targetAge: '30-65',
    tags: ['inflation', 'commodities', 'real-assets'],
  },
  {
    id: 'rate-cut',
    name: 'Rate Cut Play',
    category: 'macro',
    description: 'Beneficiaries of falling interest rates',
    icon: 'trendDown',
    tickers: ['TLT.US', 'XLK.US', 'VNQ.US', 'ARKK.US', 'IEF.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 3,
    returnRange: '5-12%',
    targetAge: '25-55',
    tags: ['rates', 'bonds', 'growth'],
  },
  {
    id: 'recession-proof',
    name: 'Recession Proof',
    category: 'macro',
    description: 'Defensive consumer staples and healthcare',
    icon: 'shield',
    tickers: ['XLP.US', 'XLV.US', 'PG.US', 'KO.US', 'WMT.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 2,
    returnRange: '4-7%',
    targetAge: '30-70',
    tags: ['defensive', 'staples', 'recession'],
  },
  {
    id: 'geopolitical',
    name: 'Geopolitical Hedge',
    category: 'macro',
    description: 'Defense, gold, and energy for geopolitical risk',
    icon: 'alert',
    tickers: ['LMT.US', 'RTX.US', 'GLD.US', 'XOM.US', 'NOC.US'],
    weights: [25, 20, 25, 15, 15],
    risk: 3,
    returnRange: '5-10%',
    targetAge: '25-60',
    tags: ['geopolitical', 'defense', 'gold'],
  },
  {
    id: 'dollar-weakness',
    name: 'Dollar Weakness',
    category: 'macro',
    description: 'International and commodity exposure for weak dollar',
    icon: 'dollar',
    tickers: ['EEM.US', 'GLD.US', 'DBC.US', 'FXI.US', 'VXUS.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 3,
    returnRange: '4-10%',
    targetAge: '25-60',
    tags: ['dollar', 'international', 'commodities'],
  },
  {
    id: 'election',
    name: 'Election Year',
    category: 'macro',
    description: 'Sectors that benefit from election cycles',
    icon: 'calendar',
    tickers: ['XLF.US', 'XLE.US', 'XLK.US', 'LMT.US', 'CAT.US'],
    weights: [25, 20, 25, 15, 15],
    risk: 3,
    returnRange: '5-10%',
    targetAge: '25-55',
    tags: ['election', 'political', 'cyclical'],
  },
  {
    id: 'post-pandemic',
    name: 'Post-Pandemic Recovery',
    category: 'macro',
    description: 'Travel, hospitality, and live events rebound',
    icon: 'trendUp',
    tickers: ['AAL.US', 'DAL.US', 'MAR.US', 'EXPE.US', 'LYV.US'],
    weights: [20, 20, 25, 20, 15],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '25-50',
    tags: ['recovery', 'travel', 'reopening'],
  },

  // ═══════════════════════════════════════════
  // ESG / IMPACT (5)
  // ═══════════════════════════════════════════
  {
    id: 'carbon-neutral',
    name: 'Carbon Neutral',
    category: 'esg',
    description: 'Clean energy and solar power leaders',
    icon: 'heart',
    tickers: ['ICLN.US', 'TAN.US', 'ENPH.US', 'SEDG.US', 'FSLR.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '6-15%',
    targetAge: '18-50',
    tags: ['clean-energy', 'solar', 'ESG'],
  },
  {
    id: 'gender-diversity',
    name: 'Gender Diversity',
    category: 'esg',
    description: 'Companies leading in gender diversity',
    icon: 'users',
    tickers: ['SHE.US', 'CRM.US', 'MSFT.US', 'ADBE.US', 'AAPL.US'],
    weights: [20, 20, 25, 20, 15],
    risk: 3,
    returnRange: '7-10%',
    targetAge: '18-55',
    tags: ['diversity', 'ESG', 'inclusion'],
  },
  {
    id: 'clean-water',
    name: 'Clean Water',
    category: 'esg',
    description: 'Water infrastructure and treatment',
    icon: 'heart',
    tickers: ['PHO.US', 'AWK.US', 'XYL.US', 'WTS.US', 'WTRG.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 3,
    returnRange: '5-8%',
    targetAge: '25-60',
    tags: ['water', 'ESG', 'infrastructure'],
  },
  {
    id: 'social-impact',
    name: 'Social Impact',
    category: 'esg',
    description: 'Companies with positive social footprint',
    icon: 'heart',
    tickers: ['SBUX.US', 'EDU.US', 'AMT.US', 'DLR.US', 'BOND.US'],
    weights: [25, 20, 25, 15, 15],
    risk: 3,
    returnRange: '5-8%',
    targetAge: '25-55',
    tags: ['social', 'ESG', 'impact'],
  },
  {
    id: 'governance',
    name: 'Governance Leaders',
    category: 'esg',
    description: 'Top-rated corporate governance',
    icon: 'shield',
    tickers: ['AAPL.US', 'GOOGL.US', 'JNJ.US', 'MA.US', 'V.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 2,
    returnRange: '7-10%',
    targetAge: '25-60',
    tags: ['governance', 'ESG', 'quality'],
  },

  // ═══════════════════════════════════════════
  // GENERATIONAL / CULTURAL (5)
  // ═══════════════════════════════════════════
  {
    id: 'gen-z',
    name: 'Gen Z Favorites',
    category: 'generational',
    description: 'Brands and platforms Gen Z loves',
    icon: 'zap',
    tickers: ['AAPL.US', 'NFLX.US', 'RBLX.US', 'SPOT.US', 'SNAP.US'],
    weights: [30, 20, 20, 15, 15],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '18-28',
    tags: ['gen-z', 'social', 'digital'],
  },
  {
    id: 'millennial',
    name: 'Millennial Tech',
    category: 'generational',
    description: 'Tech disruptors millennials grew up with',
    icon: 'zap',
    tickers: ['TSLA.US', 'META.US', 'XYZ.US', 'PYPL.US', 'COIN.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '8-18%',
    targetAge: '28-42',
    tags: ['millennial', 'tech', 'fintech'],
  },
  {
    id: 'boomer',
    name: 'Baby Boomer Safety',
    category: 'generational',
    description: 'Trusted brands with steady dividends',
    icon: 'shield',
    tickers: ['JNJ.US', 'PG.US', 'MCD.US', 'KO.US', 'PEP.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 2,
    returnRange: '4-7%',
    targetAge: '55-75',
    tags: ['boomer', 'defensive', 'dividend'],
  },
  {
    id: 'digital-nomad',
    name: 'Digital Nomad',
    category: 'generational',
    description: 'Remote work and gig economy platforms',
    icon: 'map',
    tickers: ['ZM.US', 'TEAM.US', 'DOCU.US', 'UPWK.US', 'ABNB.US'],
    weights: [20, 25, 20, 15, 20],
    risk: 4,
    returnRange: '6-15%',
    targetAge: '22-40',
    tags: ['remote-work', 'digital', 'gig'],
  },
  {
    id: 'creator',
    name: 'Creator Economy',
    category: 'generational',
    description: 'Platforms empowering content creators',
    icon: 'edit',
    tickers: ['GOOGL.US', 'META.US', 'RBLX.US', 'SPOT.US', 'SHOP.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '18-35',
    tags: ['creator', 'social', 'platform'],
  },

  // ═══════════════════════════════════════════
  // MICRO-THEMES (9)
  // ═══════════════════════════════════════════
  {
    id: 'pet-economy',
    name: 'Pet Economy',
    category: 'microtheme',
    description: 'Pet health, food, and services',
    icon: 'heart',
    tickers: ['CHWY.US', 'IDXX.US', 'ZTS.US', 'FRPT.US', 'TRUP.US'],
    weights: [25, 25, 25, 15, 10],
    risk: 3,
    returnRange: '6-10%',
    targetAge: '25-55',
    tags: ['pets', 'consumer', 'niche'],
  },
  {
    id: 'glp1-obesity',
    name: 'Obesity / GLP-1',
    category: 'microtheme',
    description: 'Weight loss drugs and diabetes innovation',
    icon: 'activity',
    tickers: ['LLY.US', 'NVO.US', 'AMGN.US', 'TMO.US', 'DXCM.US'],
    weights: [30, 30, 15, 15, 10],
    risk: 4,
    returnRange: '10-20%',
    targetAge: '25-55',
    tags: ['GLP-1', 'pharma', 'obesity'],
  },
  {
    id: 'quantum',
    name: 'Quantum Computing',
    category: 'microtheme',
    description: 'Quantum hardware and software pioneers',
    icon: 'zap',
    tickers: ['IBM.US', 'GOOGL.US', 'IONQ.US', 'QMCO.US', 'RGTI.US'],
    weights: [25, 25, 25, 15, 10],
    risk: 5,
    returnRange: '-5 to +30%',
    targetAge: '18-45',
    tags: ['quantum', 'computing', 'speculative'],
  },
  {
    id: 'autonomous',
    name: 'Autonomous Vehicles',
    category: 'microtheme',
    description: 'Self-driving cars, sensors, and AI chips',
    icon: 'map',
    tickers: ['TSLA.US', 'GOOGL.US', 'NVDA.US', 'GM.US', 'MBLY.US'],
    weights: [25, 25, 25, 15, 10],
    risk: 4,
    returnRange: '8-18%',
    targetAge: '18-50',
    tags: ['autonomous', 'EV', 'AI'],
  },
  {
    id: '3d-printing',
    name: '3D Printing',
    category: 'microtheme',
    description: 'Additive manufacturing and prototyping',
    icon: 'layers',
    tickers: ['DDD.US', 'SSYS.US', 'PRLB.US', 'XONE.US', 'NNDM.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 5,
    returnRange: '-10 to +25%',
    targetAge: '18-45',
    tags: ['3d-printing', 'manufacturing', 'speculative'],
  },
  {
    id: 'rare-earth',
    name: 'Rare Earth & Lithium',
    category: 'microtheme',
    description: 'Critical minerals for batteries and tech',
    icon: 'search',
    tickers: ['MP.US', 'LAC.US', 'REMX.US', 'SQM.US', 'ALB.US'],
    weights: [25, 20, 20, 15, 20],
    risk: 4,
    returnRange: '5-18%',
    targetAge: '25-50',
    tags: ['lithium', 'rare-earth', 'EV'],
  },
  {
    id: 'fintech',
    name: 'Fintech Revolution',
    category: 'microtheme',
    description: 'Digital payments and financial disruption',
    icon: 'creditCard',
    tickers: ['XYZ.US', 'PYPL.US', 'COIN.US', 'SOFI.US', 'AFRM.US'],
    weights: [25, 25, 20, 15, 15],
    risk: 4,
    returnRange: '8-18%',
    targetAge: '18-45',
    tags: ['fintech', 'payments', 'digital'],
  },
  {
    id: 'genomics',
    name: 'Genomics & CRISPR',
    category: 'microtheme',
    description: 'Gene editing and precision medicine',
    icon: 'activity',
    tickers: ['CRSP.US', 'EDIT.US', 'BEAM.US', 'ILMN.US', 'NTLA.US'],
    weights: [25, 20, 20, 20, 15],
    risk: 5,
    returnRange: '-5 to +25%',
    targetAge: '18-45',
    tags: ['genomics', 'CRISPR', 'biotech'],
  },
  {
    id: 'iot',
    name: 'Edge Computing / IoT',
    category: 'microtheme',
    description: 'Connected devices and edge infrastructure',
    icon: 'settings',
    tickers: ['NVDA.US', 'AMD.US', 'ANET.US', 'QCOM.US', 'KEYS.US'],
    weights: [30, 25, 20, 15, 10],
    risk: 4,
    returnRange: '8-15%',
    targetAge: '18-50',
    tags: ['IoT', 'edge', 'connectivity'],
  },

  // ===========================================
  // FUND REPLICAS (7) - holdings load LIVE, nothing is written down here
  //
  // tickers and weights are intentionally empty. They are filled at runtime
  // from the fund's real holdings, so this file cannot drift out of date.
  //
  // Two shapes upstream, verified live 2026-08-20:
  //   holdingsSource: 'etf'     ETF_Data::Holdings - keyed by ticker, full
  //                             list (ARKK 45, QQQ 50, VOO 503). Copyable.
  //   holdingsSource: 'mutual'  MutualFund_Data::Top_Holdings - always the top
  //                             10, and NAMES ONLY ('BERKSHIRE HATHAWAY INC CL
  //                             A'). No ticker, so these are shown but NOT
  //                             copyable into a portfolio.
  // ===========================================
  {
    id: 'ark-innovation',
    name: 'ARK Innovation ETF',
    category: 'fund',
    description: 'Actively managed bets on disruptive innovation',
    icon: 'rocket',
    fundTicker: 'ARKK.US',
    holdingsSource: 'etf',
    tickers: [],
    weights: [],
    risk: 5,
    returnRange: '12-20%',
    targetAge: '18-40',
    tags: ['innovation', 'growth', 'disruptive', 'etf'],
  },
  {
    id: 'vanguard-sp500',
    name: 'Vanguard S&P 500 ETF',
    category: 'fund',
    description: 'The whole S&P 500, cap-weighted, at minimal cost',
    icon: 'chart',
    fundTicker: 'VOO.US',
    holdingsSource: 'etf',
    tickers: [],
    weights: [],
    risk: 3,
    returnRange: '7-10%',
    targetAge: '18-75',
    tags: ['index', 'core', 'large-cap', 'etf'],
  },
  {
    id: 'vanguard-wellington',
    name: 'Vanguard Wellington',
    category: 'fund',
    description: 'Balanced stock and bond fund, running since 1929',
    icon: 'briefcase',
    fundTicker: 'VWELX.US',
    holdingsSource: 'mutual',
    tickers: [],
    weights: [],
    risk: 2,
    returnRange: '5-7%',
    targetAge: '30-65',
    tags: ['balanced', 'vanguard', 'classic'],
  },
  {
    id: 'fidelity-contrafund',
    name: 'Fidelity Contrafund',
    category: 'fund',
    description: 'Concentrated large-cap growth, run against the consensus',
    icon: 'briefcase',
    fundTicker: 'FCNTX.US',
    holdingsSource: 'mutual',
    tickers: [],
    weights: [],
    risk: 3,
    returnRange: '8-12%',
    targetAge: '25-55',
    tags: ['growth', 'fidelity', 'large-cap'],
  },
  {
    id: 't-rowe-blue-chip',
    name: 'T. Rowe Price Blue Chip Growth',
    category: 'fund',
    description: 'Blue chip growth with a quality tilt',
    icon: 'briefcase',
    fundTicker: 'TRBCX.US',
    holdingsSource: 'mutual',
    tickers: [],
    weights: [],
    risk: 3,
    returnRange: '8-12%',
    targetAge: '25-55',
    tags: ['blue-chip', 'growth', 'quality'],
  },
  {
    id: 'pimco-total-return',
    name: 'PIMCO Total Return',
    category: 'fund',
    description: 'Diversified bond exposure for income',
    icon: 'briefcase',
    fundTicker: 'PTTRX.US',
    holdingsSource: 'mutual',
    tickers: [],
    weights: [],
    risk: 1,
    returnRange: '3-5%',
    targetAge: '45-75',
    tags: ['bonds', 'fixed-income', 'pimco'],
  },
  {
    id: 'templeton-growth',
    name: 'Templeton Growth',
    category: 'fund',
    description: 'Global value investing across developed and emerging markets',
    icon: 'globe',
    fundTicker: 'TEPLX.US',
    holdingsSource: 'mutual',
    tickers: [],
    weights: [],
    risk: 3,
    returnRange: '6-10%',
    targetAge: '30-60',
    tags: ['global', 'value', 'diversified'],
  },

];

window.TEMPLATE_CATEGORIES = [
  { id: 'all', label: 'All', icon: 'chart' },
  { id: 'thematic', label: 'Thematic', icon: 'target' },
  { id: 'strategy', label: 'Strategy', icon: 'trendUp' },
  { id: 'income', label: 'Income', icon: 'dollar' },
  { id: 'lifecycle', label: 'Life Stage', icon: 'users' },
  { id: 'regional', label: 'Regional', icon: 'globe' },
  { id: 'macro', label: 'Macro', icon: 'activity' },
  { id: 'esg', label: 'ESG & Impact', icon: 'heart' },
  { id: 'generational', label: 'Generational', icon: 'zap' },
  { id: 'microtheme', label: 'Micro-Themes', icon: 'search' },
  { id: 'fund', label: 'Funds & ETFs', icon: 'briefcase' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Live holdings for the fund-backed templates.
//
// A template in category 'fund' ships with empty tickers/weights on purpose;
// this fills them from the fund's actual holdings. Call it once per template,
// lazily, when the card is opened — VOO alone is ~99KB on the wire, so this is
// not something to do for the whole catalogue up front.
//
// Returns the SAME template object, mutated and marked, so the ten existing
// call sites in portfolioCatalog.js that read t.tickers keep working unchanged.
// ─────────────────────────────────────────────────────────────────────────────

// Beyond this many positions a "copy this portfolio" button stops being a
// sensible offer — VOO has 503. We take the largest N and say so out loud
// rather than silently truncating.
window.FUND_HOLDINGS_LIMIT = 25;
// The most holdings the EODHD fundamentals feed lists for one ETF.
window.FUND_FEED_CAP = 50;

window.hydrateFundTemplate = async function (template, apiKey) {
  if (!template || template.category !== 'fund' || !template.fundTicker) return template;
  if (template._holdingsState === 'loading' || template._holdingsState === 'ready') return template;

  const API = window.EODHD_API;
  if (!API) return template;

  template._holdingsState = 'loading';
  const noHoldings = (message) => { const err = new Error(message); err.noHoldings = true; return err; };
  // What the feed itself threw, kept apart from a fault in reading its answer.
  let askFailed = null;
  const ask = (p) => Promise.resolve(p).catch((e) => { askFailed = e; throw e; });

  try {
    if (template.holdingsSource === 'etf') {
      const raw = await ask(API.getFundHoldings(apiKey, template.fundTicker, { throwErrors: true }));
      // "NA" arrives as a string when the symbol is not an ETF after all.
      if (!raw || typeof raw !== 'object') throw noHoldings('no ETF holdings for ' + template.fundTicker);

      // Rounded here, at the source, so holdings[] and weights[] cannot
      // disagree — upstream sends 8.96466 and the table renders holdings[].
      const rows = Object.keys(raw)
        .map((sym) => ({ symbol: sym, name: raw[sym] && raw[sym].Name, weight: Math.round((parseFloat(raw[sym] && raw[sym]['Assets_%']) || 0) * 100) / 100 }))
        .filter((r) => r.weight > 0)
        .sort((a, b) => b.weight - a.weight);

      const shown = rows.slice(0, window.FUND_HOLDINGS_LIMIT);
      template.tickers = shown.map((r) => r.symbol);
      template.weights = shown.map((r) => r.weight);
      template.holdings = shown;
      template.totalHoldings = rows.length;
      template.omittedHoldings = Math.max(0, rows.length - shown.length);
      // EODHD lists at most a fund's 50 largest positions (VOO: Holdings_Count
      // 50 for an S&P 500 fund). "Holdings: 50" read as the whole fund,
      // so a full list of 50 says it is the feed's cap.
      template.feedCapped = rows.length >= window.FUND_FEED_CAP;
      template.copyable = true;
    } else {
      const raw = await ask(API.getMutualFundTopHoldings(apiKey, template.fundTicker, { throwErrors: true }));
      if (!raw || typeof raw !== 'object') throw noHoldings('no fund holdings for ' + template.fundTicker);

      // Numeric string keys, and each row carries a name but no ticker.
      const rows = Object.keys(raw)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => raw[k])
        .filter((r) => r && r.Name)
        .map((r) => ({ symbol: null, name: r.Name, weight: parseFloat(String(r.Weight).replace('%', '')) || 0 }));

      template.holdings = rows;
      template.totalHoldings = rows.length;
      template.omittedHoldings = 0;
      // No symbols means nothing to create positions from. Leave tickers empty
      // and let the UI disable the copy button rather than build a broken
      // portfolio out of company names.
      template.tickers = [];
      template.weights = [];
      template.copyable = false;
    }

    template._holdingsState = 'ready';
  } catch (e) {
    // The holdings did not load -- the per-minute limit, EODHD's error, no
    // connection, an answer that could not be read: 'failed', with what it
    // was, and asked again (portfolioCatalog.js). It read "holdings
    // unavailable" for the rest of the session, and a 429 body read on the
    // Mini App's own key was taken for a fund with no holdings at all.
    const RLW = window.RateLimitWait;
    const failed = e === askFailed && RLW && RLW.outage ? RLW.outage(e) : null;
    template.copyable = false;
    if (failed) {
      template._holdingsState = 'failed';
      template._holdingsFailure = failed;
      return template;
    }
    // A fund the feed lists no holdings for is an answer, not a fault: the
    // card says so, and the console stays clean. So is a
    // refusal with a status (a 404, the plan's 403), which the API line
    // has logged already.
    if (!(e && (e.noHoldings || e.status || e.statusCode))) console.error('[templates] hydrate failed for', template.fundTicker, e);
    template._holdingsState = 'error';
  }

  return template;
};

// A second ask while a template's holdings are on their way shares that
// ask, so every view waiting on it hears when it settles. It returned at
// once: with Try again pressed twice, or the card left and opened again,
// the view that asked last was never told, and read "Loading holdings…"
// for good.
(function () {
  const hydrate = window.hydrateFundTemplate;
  const loads = new WeakMap();
  window.hydrateFundTemplate = function (template, apiKey) {
    const out = template && typeof template === 'object' ? loads.get(template) : null;
    if (out && template._holdingsState === 'loading') return out;
    const p = hydrate(template, apiKey);
    // Still loading once the ask has gone: that is the one to share.
    if (template && typeof template === 'object' && template._holdingsState === 'loading') {
      loads.set(template, p);
      const end = () => { if (loads.get(template) === p) loads.delete(template); };
      p.then(end, end);
    }
    return p;
  };
})();
