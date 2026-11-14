// Portfolio Ideas Catalog — browse and adopt preset portfolio templates
// AI Features: NL Search, Recommended For You, Template Intelligence, AI Analyze, Compare, Builder, Drift
// A portfolio made from tickers alone (a template, an AI Builder result) had
// the bare code as every position's name ("JNJ", "PG", "KO"). The search's name is put in where the name is still the code; a
// failed or empty search leaves it. Resolves to how many names were filled.
// At the per-minute limit the searches left are not sent, and the names
// stayed codes for good: the fill stops there and runs again once the wait
// is over (`tries`: how many times it has run again, up to three).
window.PortfolioFillNames = async (portfolioId, apiKey, tries) => {
  const FILL_TRIES = 3;
  const Storage = window.PortfolioStorage;
  const API = window.EODHD_API;
  if (!Storage || !API || !API.searchStocks) return 0;
  const RLW = window.RateLimitWait;
  const usLike = (e) => ['US', 'NYSE', 'NASDAQ', 'AMEX', 'BATS', 'NYSE ARCA', 'ARCA'].indexOf(String(e || '').toUpperCase()) !== -1;
  let filled = 0;
  let limited = false;
  for (const h of Storage.getHoldingsByPortfolio(portfolioId)) {
    const sym = String(h.symbol || '').toUpperCase();
    const code = sym.split('.')[0];
    const ex = sym.split('.').slice(1).join('.') || 'US';
    if (!code || (h.name && h.name.toUpperCase() !== code)) continue;
    try {
      const rows = await API.searchStocks(apiKey, code, { throwErrors: true });
      const hit = Array.isArray(rows) && rows.find((r) => r && String(r.Code || '').toUpperCase() === code
        && (String(r.Exchange || '').toUpperCase() === ex || (usLike(ex) && usLike(r.Exchange))));
      if (hit && hit.Name && hit.Name.toUpperCase() !== code) {
        // The holding may be gone by now (deleted in the meantime).
        if (Storage.getHoldingById(h.id)) { Storage.attempt(() => Storage.updateHolding(h.id, { name: hit.Name }), () => {}); filled += 1; }
      }
    } catch (e) {
      // The code stays the name; at the limit, until the wait is over.
      const f = RLW && RLW.outage ? RLW.outage(e) : null;
      if (f && f.limited) { limited = true; break; }
    }
  }
  if (filled) window.dispatchEvent(new CustomEvent('portfolio:names-filled', { detail: { portfolioId } }));
  if (limited && (tries || 0) < FILL_TRIES) {
    const until = (RLW && RLW.until && RLW.until()) || 0;
    setTimeout(() => { window.PortfolioFillNames(portfolioId, apiKey, (tries || 0) + 1); }, Math.max(until - Date.now(), 0) + 1000);
  }
  return filled;
};

// asPage: the Ideas screen itself (its title is the page's h1); inside the
// portfolio's Templates window it stays an h2.
window.PortfolioCatalogView = ({ apiKey, theme, onAdopt, onClose, onOpenPortfolio, asPage }) => {
  const isDark = theme === 'dark';
  const _tc = isDark ? '#E0E3EB' : '#1e1b4b';
  // Light theme: 0.62 black clears 4.5:1 on white; 0.5 was 3.94:1 at 11px.
  // The colour inks darken the same way.
  const _tm = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.62)';
  // Status colour as text, readable in the theme (the light map's #15803d
  // still read 3.8-4.4:1 on the panel).
  // Without A11yColor (an app that does not load it) the fallbacks are the
  // same inks worked out ahead, on the badge's tint: the old ones left "Low"
  // at 4.49 and "High" at 4.23 there.
  const _INK_FALLBACK = isDark
    ? { '#22c55e': '#22c55e', '#f97316': '#f97316', '#ef4444': '#f26262' }
    : { '#22c55e': '#136e35', '#f97316': '#9f4a0e', '#ef4444': '#b13232' };
  const _ink = (hex) => (window.A11yColor ? window.A11yColor.text(hex, isDark) : (_INK_FALLBACK[hex] || hex));
  const _bg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';
  // A risk badge is 9-10px text on its own tint: "Low" 4.49 and "High" 4.23
  // there. Each colour is pushed just past AA on the
  // badge's real ground -- the tint over the panel -- with a little margin.
  // The card's own ground: its 2-3% wash over the modal (#15140F / #fff), not
  // a guessed panel colour.
  const _panel = isDark ? '#1c1b16' : '#fafafa';
  const _mix = (hex, a, ground) => {
    const p = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const f = p(hex), g = p(ground);
    return '#' + f.map((v, i) => Math.round(v * a + g[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
  };
  const _badgeInk = (hex) => (window.A11yColor
    ? window.A11yColor.readable(_ink(hex), window.A11yColor.composite(hex, 0x15 / 255, _panel), 4.6)
    : (window.PortfolioCalculations && window.PortfolioCalculations.ink
      ? window.PortfolioCalculations.ink(_ink(hex), isDark, _mix(hex, 0x15 / 255, _panel))
      : _ink(hex)));
  const _bd = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const _ibg = isDark ? 'rgba(255,255,255,0.04)' : '#fff';
  const [selectedCategory, setSelectedCategory] = React.useState('all');
  const [selectedTemplate, setSelectedTemplate] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState('');

  // Fund templates carry no holdings of their own — they fetch the real ones
  // when opened. Deliberately lazy and one template at a time: VOO's holdings
  // are ~99KB on the wire and the catalogue has seven funds in it.
  // Only the setter is kept; it exists to re-render once the fetch lands.
  const [, bumpHoldings] = React.useState(0);
  // Holdings that did not load (the per-minute limit, EODHD's error) are
  // asked again by Try again, or by themselves once the wait is over.
  const [holdingsTry, setHoldingsTry] = React.useState(0);
  React.useEffect(() => {
    const tpl = selectedTemplate;
    if (!tpl || tpl.category !== 'fund' || !window.hydrateFundTemplate) return;
    if (tpl._holdingsState === 'ready' || tpl._holdingsState === 'error') return;
    let alive = true;
    window.hydrateFundTemplate(tpl, apiKey).then(() => { if (alive) bumpHoldings((n) => n + 1); });
    return () => { alive = false; };
  }, [selectedTemplate, apiKey, holdingsTry]);
  // Check for AI Hub navigation on mount + poll for flag
  React.useEffect(() => {
    const check = () => {
      if (window._portfolioIdeasAction) {
        const action = window._portfolioIdeasAction;
        window._portfolioIdeasAction = null;
        if (action === 'builder') setShowBuilder(true);
        if (action === 'compare') { setCompareMode(true); setCompareSelection([]); }
      }
    };
    check();
    // Also check after a delay (component may mount before flag is set)
    const timer = setTimeout(check, 300);
    return () => clearTimeout(timer);
  }, []);

  const [aiInsight, setAiInsight] = React.useState(null);
  const [aiInsightLoading, setAiInsightLoading] = React.useState(false);
  const [aiAnalysis, setAiAnalysis] = React.useState(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = React.useState(false);
  const [compareMode, setCompareMode] = React.useState(false);
  const [compareSelection, setCompareSelection] = React.useState([]);
  const [compareResult, setCompareResult] = React.useState(null);
  const [compareLoading, setCompareLoading] = React.useState(false);
  const [showBuilder, setShowBuilder] = React.useState(false);
  const [builderPrompt, setBuilderPrompt] = React.useState('');
  const [builderResult, setBuilderResult] = React.useState(null);
  // "Create portfolio?" belongs to the card or the build it was asked under:
  // leaving that card, or closing the Builder, drops the question. It stayed
  // in state, and its layer took the next Esc or Back for nothing.
  React.useEffect(() => { setAdoptAsk(null); }, [selectedTemplate, showBuilder, builderResult]);
  // Adopting asks in the page and answers in the page (no browser dialogs),
  // and once per template or built result: a second press opens what the
  // first one made. `adoptAsk` is the key being
  // confirmed; `adopted` maps a key to the portfolio it made.
  const [adoptAsk, setAdoptAsk] = React.useState(null);
  const [adopted, setAdopted] = React.useState({});
  const buildSeq = React.useRef(0);
  const [builderLoading, setBuilderLoading] = React.useState(false);
  const useFeatureCost = (() => null);
  const builderCost = useFeatureCost('portfolio_builder');
  const compareCost = useFeatureCost('portfolio_compare');
  // A template's AI Insights (template_intelligence) and AI Analyze vs My
  // Portfolio (portfolio_analyze) charged with no price shown.
  const insightCost = useFeatureCost('template_intelligence');
  const analyzeCost = useFeatureCost('portfolio_analyze');
  // Where the focus goes when a card opens and when Back returns: it was left
  // on <body> both times, the card and then the Back button having gone.
  // Opening goes to Back; Back goes to the card opened.
  // Telegram: one layer per Back -- the template card, then the catalog
  // (back to the AI tab). The catalog had no way out in the Mini App: no
  // BackButton, no arrow, and onClose was never called.
  const inTg = window.APP_PLATFORM !== 'WEB';
  // Web: Escape in an open card goes back to the list, as its Back button
  // does; it closed the whole Templates & Funds window.
  // Registered after the window, so it is the top layer while the card is open.
  (window.useEscLayer || (() => {}))(!inTg && !!selectedTemplate, () => setSelectedTemplate(null));
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();
  // "Create portfolio?" in the page is its own layer: Telegram's Back closed
  // the whole catalog with it, and a paid Builder result was lost; Escape left the focus on <body>. Both close the question
  // only, and the focus goes back to the button that asked it.
  const cancelAdoptAsk = () => {
    const key = adoptAsk;
    setAdoptAsk(null);
    focusNext(() => document.querySelector('[data-adopt-for="' + String(key).replace(/"/g, '') + '"]'));
  };
  // One registration: Escape on the web, the Telegram BackButton in the Mini
  // App (useEscLayer goes on its stack there; 20.10 F1: the question was an
  // Esc layer on the web only, and Desktop's Esc closed the whole catalog).
  (window.useEscLayer || (() => {}))(adoptAsk != null, cancelAdoptAsk);
  const backRef = React.useRef(null);
  const openedCardRef = React.useRef(null);
  const detailWasOpenRef = React.useRef(false);
  const openId = selectedTemplate ? selectedTemplate.id : null;
  React.useEffect(() => {
    try {
      if (openId != null) { detailWasOpenRef.current = true; if (backRef.current) backRef.current.focus(); return; }
      if (!detailWasOpenRef.current) return;
      detailWasOpenRef.current = false;
      const card = [...document.querySelectorAll('[data-card]')].find(el => el.getAttribute('data-card') === openedCardRef.current);
      if (card) card.focus();
    } catch (e) { /* focus is a courtesy */ }
  }, [openId]);

  const C3 = window.C3;
  const isWeb = window.APP_PLATFORM === 'WEB';
  const templates = window.PORTFOLIO_TEMPLATES || [];
  const aiOn = Boolean(window.AIService && window.AIService.getSettings && window.AIService.getSettings().enabled);
  const categories = window.TEMPLATE_CATEGORIES || [];

  const Icon = window.Icon || (({ name, size, color }) => null);

  // Format AI response — convert **bold** to real bold
  const formatAI = (text) => {
    if (!text) return null;
    if (text.error) return window.AIText ? window.AIText.errorBox(text.error, isDark) : text.error;
    if (window.AIText) return window.AIText.markdown(text);
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return React.createElement('span', null, ...parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return React.createElement('strong', { key: i, style: { color: _tc } }, part.slice(2, -2));
      }
      return part;
    }));
  };

  // AI helper -- the model on the developer's own key (shell/ai.js). A
  // failure is { error }, drawn as an error by formatAI rather than as text
  // inside an answer card.
  const callAI = async (prompt) => {
    const aiService = window.AIService;
    if (!aiService) return null;
    const settings = aiService.getSettings();
    if (!settings?.enabled) return { error: 'AI analysis is off. Add OPENAI_API_KEY to .env and restart to enable it.' };
    try {
      const response = await aiService.chat(settings.provider, settings.apiKey, [{ role: 'user', content: prompt }]);
      const text = typeof response === 'string' ? response : (response?.content || response?.message || '');
      return text || { error: 'The model returned nothing.' };
    } catch (e) { return { error: window.AIText ? window.AIText.error(e) : String((e && e.message) || e) }; }
  };

  // Feature 5: NL Search — keyword mapping (no model involved)
  // Hoisted onto window so a test can prove every id and category in here
  // still resolves. It silently stopped resolving once before: removing the
  // investor templates left 'buffett', 'dalio', 'famous' and 'investor'
  // pointing at nothing, and a search that quietly returns zero results looks
  // identical to a search that legitimately found nothing.
  const nlKeywords = window.CATALOG_SEARCH_MAP = {
    'retirement': { categories: ['lifecycle', 'income'], riskMax: 2 },
    'pension': { categories: ['lifecycle', 'income'], riskMax: 2 },
    'young': { categories: ['lifecycle', 'generational'], riskMax: 5 },
    'student': { categories: ['lifecycle'], riskMax: 4 },
    'dividend': { categories: ['income', 'strategy'] },
    'income': { categories: ['income'] },
    'growth': { categories: ['strategy', 'thematic'], riskMin: 3 },
    'safe': { riskMax: 2 },
    'low risk': { riskMax: 2 },
    'high risk': { riskMin: 4 },
    'aggressive': { riskMin: 4 },
    'conservative': { riskMax: 2 },
    'tech': { tags: ['tech', 'technology', 'ai', 'semiconductor'] },
    'ai': { tags: ['ai', 'technology'] },
    'crypto': { tags: ['crypto', 'bitcoin'] },
    'esg': { categories: ['esg'] },
    'green': { categories: ['esg'] },
    'climate': { categories: ['esg'] },
    // No personal names here. Searching a person and being handed a portfolio
    // is the same claim the investor templates used to make, just made by the
    // search box instead of the card.
    'famous': { categories: ['fund'] },
    'etf': { categories: ['fund'] },
    'fund': { categories: ['fund'] },
    'index': { categories: ['fund', 'strategy'] },
    'regional': { categories: ['regional'] },
    'international': { categories: ['regional'] },
    'macro': { categories: ['macro'] },
    'inflation': { ids: ['inflation-hedge'] },
    'recession': { ids: ['recession-proof'] },
  };

  // Feature 1: Recommended For You — profile-based matching
  const getUserProfile = () => {
    try {
      const profile = JSON.parse(localStorage.getItem('eodhd_onboarding_profile') || '{}');
      return profile;
    } catch { return {}; }
  };

  const getRecommended = () => {
    const profile = getUserProfile();
    const age = profile.age || 30;
    const riskPref = profile.risk || 'moderate';
    const goal = profile.goal || 'growth';

    const riskMap = { conservative: [1, 2], moderate: [2, 3], aggressive: [3, 5] };
    const targetRisk = riskMap[riskPref] || [2, 3];

    return templates
      .map(t => {
        let score = 0;
        // Risk match
        if (t.risk >= targetRisk[0] && t.risk <= targetRisk[1]) score += 3;
        // Goal match
        if (goal === 'income' && (t.category === 'income' || t.tags?.includes('dividend'))) score += 2;
        if (goal === 'growth' && (t.tags?.includes('growth') || t.tags?.includes('tech'))) score += 2;
        if (goal === 'preservation' && t.risk <= 2) score += 2;
        // Age match
        if (age < 30 && t.tags?.includes('growth')) score += 1;
        if (age > 50 && (t.tags?.includes('dividend') || t.tags?.includes('income'))) score += 1;
        if (age > 60 && t.risk <= 2) score += 1;
        return { ...t, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  };

  const recommended = getRecommended();

  // Filter templates — with NL keyword matching
  const filtered = templates.filter(t => {
    if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      // NL keyword matching (Feature 5: FREE)
      for (const [keyword, rules] of Object.entries(nlKeywords)) {
        if (q.includes(keyword)) {
          let match = true;
          if (rules.categories && !rules.categories.includes(t.category)) match = false;
          if (rules.riskMax && t.risk > rules.riskMax) match = false;
          if (rules.riskMin && t.risk < rules.riskMin) match = false;
          if (rules.tags && !rules.tags.some(tag => t.tags?.includes(tag))) match = false;
          if (rules.ids && !rules.ids.includes(t.id)) match = false;
          if (match) return true;
        }
      }
      // Fallback: text search
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) ||
        t.tags?.some(tag => tag.includes(q)) || t.tickers?.some(tk => tk.toLowerCase().includes(q));
    }
    return true;
  });

  // Adopting a template, and a built portfolio the same way: a new portfolio
  // with one position per ticker and its target weight noted, through the
  // tracker's onAdopt when the catalog was opened from it.
  // The same words on every path (the tracker's modal said them in an alert,
  // the Ideas page said only "created"): the positions have no shares yet.
  // The target weights are kept in each position's note and Rebalance reads
  // them; the hint said nothing of them and they looked lost. Shares stay the reader's: the app does not know what was bought.
  const adoptedHint = (name, n) => (n === 1
    ? `Portfolio "${name}" created with 1 position. It has no shares yet — enter your purchases with the position's History → + Add, or import a CSV. Its target weight is listed in the Rebalancing Advisor.`
    : `Portfolio "${name}" created with ${n} positions. They have no shares yet — enter your purchases with each position's History → + Add, or import a CSV. Their target weights are listed in the Rebalancing Advisor.`);
  // A new portfolio with one position per ticker and its target weight noted:
  // through the tracker's onAdopt when the catalog was opened from it (it
  // returns the new portfolio's id), else here. The new one becomes this
  // session's open portfolio, so Portfolio opens on it.
  // A refused save (full storage) is said under the button that asked,
  // keyed like the question; it was the browser's alert().
  const [adoptError, setAdoptError] = React.useState(null);
  const [adoptWall, setAdoptWall] = ((window.FreeLimitWalls && window.FreeLimitWalls.useLimitCard) || (() => React.useState(null)))();
  const doAdopt = (key, t) => {
    setAdoptAsk(null);
    setAdoptError(null);
    if (adoptWall) setAdoptWall(null);
    if (adopted[key]) return;
    const W = window.FreeLimitWalls;
    const S = window.PortfolioStorage;
    const names = (t.tickers || []).length;
    const walled = W && S ? W.portfolioConfirm([['portfolios', () => S.getPortfolios().length + 1], ['positions', () => names]]) : null;
    if (!walled) { adoptNow(key, t); return; }
    walled.then((refusal) => {
      if (!refusal) { adoptNow(key, t); return; }
      setAdoptWall(Object.assign({}, refusal, { adoptKey: key }));
      focusNext(() => document.querySelector('[data-adopt-for="' + String(key).replace(/"/g, '') + '"]'));
    });
  };
  const adoptNow = (key, t) => {
    let id = null;
    let refused = null;
    if (onAdopt) {
      const r = onAdopt(t);
      if (r && typeof r === 'object') {
        refused = r.error || 'The portfolio could not be saved.';
        if (r.refusal) { setAdoptWall(Object.assign({}, r.refusal, { adoptKey: key })); return; }
      } else id = r;
    } else {
      const Storage = window.PortfolioStorage;
      let refusedCard = null;
      // All of it or none: a refused write takes the new portfolio back.
      const portfolio = Storage && Storage.attempt(() => Storage.createPortfolioWithHoldings({ name: t.name, baseCurrency: 'USD', icon: 'barChart' },
        (t.tickers || []).map((ticker, i) => ({ symbol: ticker, name: ticker.split('.')[0], type: (window.PortfolioCalculations && window.PortfolioCalculations.knownAssetType(ticker)) || 'stock', notes: `Template: ${t.name}, target weight: ${t.weights?.[i] || 0}%` }))),
      (m, e) => { refused = m; if (e && e.code === 'free-limit' && e.refusal) refusedCard = e.refusal; });
      if (refusedCard) { setAdoptWall(Object.assign({}, refusedCard, { adoptKey: key })); return; }
      id = portfolio ? portfolio.id : null;
      if (id && window.PortfolioFillNames) window.PortfolioFillNames(id, apiKey);
    }
    if (!id) {
      if (refused) {
        setAdoptError({ key, text: refused });
        focusNext(() => document.querySelector('[data-adopt-for="' + String(key).replace(/"/g, '') + '"]'));
      }
      return;
    }
    try { sessionStorage.setItem('eodhd_pt_active_portfolio', id); } catch (_) { /* private mode */ }
    setAdopted((prev) => ({ ...prev, [key]: { id, text: adoptedHint(t.name, (t.tickers || []).length) } }));
    // "Create" leaves with the question; the focus fell to <body>
    // It goes to "Open portfolio", which replaces it.
    focusNext(() => document.querySelector('[data-adopted-open="' + String(key).replace(/"/g, '') + '"]'));
  };
  const openAdopted = (id) => {
    try { sessionStorage.setItem('eodhd_pt_active_portfolio', id); } catch (_) { /* private mode */ }
    if (onOpenPortfolio) onOpenPortfolio(id);
    else window.location.hash = '#/portfolio?id=' + encodeURIComponent(id);
  };
  // The control under a template or a built result: its button, the question
  // in the page when pressed, and once done the hint with "Open portfolio".
  const adoptControls = (key, t, label, btnStyle) => {
    const done = adopted[key];
    const n = (t.tickers || []).length;
    const primary = { ...btnStyle, background: C3.logoGradient, color: 'white', cursor: 'pointer', border: 'none' };
    if (done) {
      return React.createElement('div', { 'data-adopted': key },
        React.createElement('div', { role: 'status', style: { marginBottom: 8, padding: '10px 12px', borderRadius: 4, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)', fontSize: 13, lineHeight: 1.5, color: _tc } }, done.text),
        React.createElement('button', { 'data-adopted-open': key, onClick: () => openAdopted(done.id), style: primary }, 'Open portfolio'));
    }
    if (adoptAsk === key) {
      return React.createElement('fieldset', {
        'aria-label': `Create portfolio "${t.name}"?`,
        onKeyDown: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelAdoptAsk(); } },
        style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, border: '1px solid ' + _bd, borderRadius: 4, padding: '10px 12px', margin: '0 0 8px', minWidth: 0 },
      },
        React.createElement('span', { style: { fontSize: 13, marginRight: 'auto', color: _tc } }, `Create portfolio "${t.name}" with ${n} ${n === 1 ? 'position' : 'positions'}? You enter the shares you hold yourself afterwards.`),
        React.createElement('button', { autoFocus: true, onClick: () => doAdopt(key, t), style: { ...primary, width: 'auto', padding: '8px 16px', margin: 0 } }, 'Create'),
        React.createElement('button', { onClick: cancelAdoptAsk, style: { padding: '8px 12px', borderRadius: 4, border: '1px solid ' + _bd, background: 'none', color: _tc, cursor: 'pointer', fontSize: 13, fontFamily: "'Sora',sans-serif" } }, 'Cancel'));
    }
    const refusedHere = adoptError && adoptError.key === key;
    const walledHere = adoptWall && adoptWall.adoptKey === key && window.PlanNotice && window.PlanNotice.RefusalCard;
    return React.createElement(React.Fragment, null,
      walledHere && React.createElement(window.PlanNotice.RefusalCard, { refusal: adoptWall, isDark }),
      refusedHere && React.createElement('div', { role: 'alert', id: 'adopt-error-' + String(key).replace(/[^\w-]/g, '_'), style: { marginBottom: 8, padding: '10px 12px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.06)', fontSize: 13, lineHeight: 1.5, color: _tc } }, adoptError.text),
      React.createElement('button', { 'data-adopt-for': key, onClick: () => setAdoptAsk(key), 'aria-describedby': refusedHere ? 'adopt-error-' + String(key).replace(/[^\w-]/g, '_') : undefined, style: primary }, label));
  };

  // Feature 3: AI Builder
  // Its own server route (the terminal's server handle_ai_portfolio_builder): one charge
  // per build, a portfolio checked before it is billed, a refund otherwise.
  // It showed the model's raw JSON before, after paying twice.
  const buildPortfolio = async () => {
    if (builderLoading || !builderPrompt.trim()) return;
    setBuilderLoading(true);
    setBuilderResult(null);
    const AI = window.AIService;
    if (!AI || typeof AI.buildPortfolio !== 'function') {
      setBuilderResult({ error: 'The AI Builder is not available here.' });
      setBuilderLoading(false);
      return;
    }
    // -> { portfolio } or { error } (aiService.js buildPortfolio).
    const res = await AI.buildPortfolio(builderPrompt.trim());
    buildSeq.current += 1;
    setBuilderResult(res && (res.portfolio || res.error) ? { ...res, seq: buildSeq.current } : { error: 'The AI answer was not a usable portfolio.' });
    setBuilderLoading(false);
  };

  // Feature 4: AI Compare
  const runCompare = async () => {
    if (compareSelection.length !== 2) return;
    setCompareLoading(true);
    const [a, b] = compareSelection;
    const prompt = `Compare these two portfolio templates for an investor:\n\nPortfolio A: ${a.name}\nHoldings: ${a.tickers?.map(tk => tk.split('.')[0]).join(', ')}\nRisk: ${a.risk}/5, Return: ${a.returnRange}\n\nPortfolio B: ${b.name}\nHoldings: ${b.tickers?.map(tk => tk.split('.')[0]).join(', ')}\nRisk: ${b.risk}/5, Return: ${b.returnRange}\n\nCompare in 4 bullet points:\n1. Risk comparison\n2. Growth potential comparison\n3. Diversification comparison\n4. Final verdict: which is better for a moderate-risk long-term investor and why`;
    const result = await callAI(prompt, 'portfolio_compare', 2);
    if (result !== 'NOT_ENOUGH_TOKENS') setCompareResult(result);
    setCompareLoading(false);
  };

  const riskColors = { 1: '#22c55e', 2: '#22c55e', 3: '#f97316', 4: '#ef4444', 5: '#ef4444' };
  const riskLabels = { 1: 'Very Low', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Very High' };
  const categoryIcons = {};
  categories.forEach(c => { categoryIcons[c.id] = c.icon; });

  // Detail view
  if (selectedTemplate) {
    const t = selectedTemplate;
    return React.createElement('div', { style: { fontFamily: "'Sora', sans-serif", color: _tc } },
      // Back + title
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 } },
        React.createElement('button', {
          ref: backRef,
          onClick: () => setSelectedTemplate(null),
          style: { background: 'none', border: '1px solid ' + _bd, borderRadius: 4, color: _tm, cursor: 'pointer', padding: '6px 12px', fontSize: 12, fontFamily: "'Sora',sans-serif", display: 'flex', alignItems: 'center', gap: 4 }
        }, React.createElement(Icon, { name: 'chevronLeft', size: 14 }), 'Back'),
        React.createElement('h2', { style: { margin: 0, fontSize: 20, fontWeight: 800 } }, t.name),
        React.createElement('span', { style: { padding: '3px 10px', borderRadius: 3, fontSize: 10, fontWeight: 700, background: `${riskColors[t.risk]}15`, color: _badgeInk(riskColors[t.risk]) } }, `Risk ${t.risk}/5`),
      ),
      // Description + meta
      React.createElement('p', { style: { color: _tm, fontSize: 14, margin: '0 0 20px' } }, t.description),
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20, fontSize: 13 } },
        // returnRange is a hand-written planning range per year, not a measured
        // result; "Return: 5-7%" said neither.
        React.createElement('span', { style: { color: _tm }, title: 'Illustrative long-run range per year, set by hand for this template. Not a backtest and not a forecast.' }, 'Illustrative return: ', React.createElement('span', { style: { color: _ink('#22c55e'), fontWeight: 600 } }, t.returnRange + ' / yr')),
        React.createElement('span', { style: { color: _tm } }, 'Age: ', React.createElement('span', { style: { color: _ink('#f97316'), fontWeight: 600 } }, t.targetAge)),
        // "Holdings: 41" over a table of 25 rows read as rows missing: the count says which part of the fund is listed.
        // A fund's count is printed once its list has come: "Holdings: 0"
        // while it loaded, or after it failed at the limit, read as an empty
        // fund. The line under the header says why.
        (t.category !== 'fund' || t._holdingsState === 'ready') && React.createElement('span', { style: { color: _tm } }, 'Holdings: ', React.createElement('span', { style: { fontWeight: 600 } },
          t.omittedHoldings > 0
            ? `top ${t.tickers?.length || 0} of ${t.feedCapped ? 'the ' + t.totalHoldings + ' largest' : t.totalHoldings}`
            : (t.feedCapped ? `the ${t.totalHoldings} largest` : (t.totalHoldings ?? (t.tickers?.length || 0))))),
        t.category === 'fund' && t._holdingsState === 'loading' && React.createElement('span', { style: { color: _tm, fontStyle: 'italic' } }, 'loading live holdings…'),
        t.category === 'fund' && t._holdingsState === 'error' && React.createElement('span', { style: { color: _ink('#ef4444') } }, 'holdings unavailable'),
      ),
      // Holdings that did not load, with the reason -- the limit by name --
      // and a Try again that counts the wait down. They read "holdings
      // unavailable" and were never asked again in the session.
      t.category === 'fund' && t._holdingsState === 'failed' && window.RateLimitWait && React.createElement(window.RateLimitWait.FailNote, {
        what: 'The holdings', failure: t._holdingsFailure, isDark, panel: 'fund-holdings:' + (t.fundTicker || t.id),
        onRetry: () => setHoldingsTry((n) => n + 1), style: { marginBottom: 20 },
      }),
      // Holdings table
      React.createElement('div', { style: { background: _bg, border: '1px solid ' + _bd, borderRadius: 4, overflow: 'hidden', marginBottom: 20 } },
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement('thead', null,
            React.createElement('tr', { style: { borderBottom: '1px solid ' + _bd } },
              React.createElement('th', { style: { textAlign: 'left', padding: '10px 16px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: _tm } }, 'Holding'),
              React.createElement('th', { style: { textAlign: 'right', padding: '10px 16px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: _tm } }, 'Weight'),
              React.createElement('th', { style: { textAlign: 'right', padding: '10px 16px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: _tm } }, 'Allocation'),
            )
          ),
          React.createElement('tbody', null,
            // Fund templates arrive hydrated into t.holdings, where a mutual
            // fund's row has a name and no symbol. Curated templates only ever
            // have tickers/weights, so they are adapted to the same shape.
            (() => {
            const rows = t.holdings && t.holdings.length
              ? t.holdings
              : (t.tickers || []).map((sym, i) => ({ symbol: sym, name: null, weight: t.weights?.[i] || 0 }));
            // The bar is scaled to the biggest position in THIS list, not to
            // 100%. A curated basket runs 10-40% per line and reads fine either
            // way; a real fund runs 0.5-9% and an absolute bar collapses into a
            // few pixels, which is how this looked before.
            const maxWeight = rows.reduce((m, r) => Math.max(m, r.weight || 0), 0) || 1;
            return rows.map((row, i) => {
              const weight = row.weight || 0;
              const barPct = Math.max(2, (weight / maxWeight) * 100);
              const label = row.symbol ? row.symbol.split('.')[0] : row.name;
              return React.createElement('tr', { key: (row.symbol || row.name || i) + ':' + i, style: { borderBottom: '1px solid ' + _bd } },
                React.createElement('td', { style: { padding: '8px 16px', fontWeight: 600, fontSize: 13, fontFamily: "'Sora',sans-serif" } }, label),
                React.createElement('td', { style: { padding: '8px 16px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", fontSize: 12 } }, weight + '%'),
                React.createElement('td', { style: { padding: '8px 16px', textAlign: 'right' } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' } },
                    React.createElement('div', { style: { width: 80, height: 5, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', borderRadius: 2, overflow: 'hidden' } },
                      React.createElement('div', { style: { height: '100%', width: barPct + '%', background: C3.logoGradient, borderRadius: 2 } })
                    )
                  )
                ),
              );
            });
            })()
          )
        )
      ),
      // Where the numbers come from, and what is missing from them. Said out
      // loud rather than letting a truncated list read as the whole fund.
      t.omittedHoldings > 0 && React.createElement('div', { style: { color: _tm, fontSize: 12, margin: '-12px 0 20px' } },
        `Showing the largest ${t.tickers?.length || 0} of ${t.feedCapped ? `the ${t.totalHoldings} largest positions EODHD lists for this fund (the fund may hold more)` : `${t.totalHoldings} position${t.totalHoldings === 1 ? '' : 's'}`}, by weight. "Adopt This Portfolio" copies these ${t.tickers?.length || 0}.`),
      t.category === 'fund' && t.copyable === false && t._holdingsState === 'ready' && React.createElement('div', { style: { color: _tm, fontSize: 12, margin: '-12px 0 20px', lineHeight: 1.5 } },
        'This fund reports its top holdings by company name only, without ticker symbols, so the positions cannot be created automatically. The weights above are the fund’s own, as reported.'),
      // Curated baskets say so, so they are not mistaken for someone's book.
      t.note && React.createElement('div', { style: { color: _tm, fontSize: 12, margin: '-12px 0 20px', lineHeight: 1.5, fontStyle: 'italic' } }, t.note),
      // Tags
      t.tags && React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' } },
        t.tags.map(tag => React.createElement('span', { key: tag, style: { padding: '3px 10px', borderRadius: 3, fontSize: 11, background: _ibg, border: '1px solid ' + _bd, color: _tm } }, tag))
      ),
      // Template Intelligence -- needs a model key.
      aiOn && React.createElement('div', { style: { marginBottom: 20 } },
        !aiInsight ? React.createElement('button', {
          onClick: async () => {
            setAiInsightLoading(true);
            const prompt = `Analyze this portfolio template for an investor:\nName: ${t.name}\nDescription: ${t.description}\nHoldings: ${t.tickers?.map(tk => tk.split('.')[0]).join(', ')}\nRisk: ${t.risk}/5\nReturn: ${t.returnRange}\n\nProvide in 3-4 bullet points:\n1. Key strength of this portfolio\n2. Key risk to watch\n3. Best market conditions for this portfolio\n4. Who should NOT invest in this`;
            const result = await callAI(prompt, 'template_intelligence', 1);
            if (result !== 'NOT_ENOUGH_TOKENS') setAiInsight(result);
            setAiInsightLoading(false);
          },
          disabled: aiInsightLoading,
          style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 4, border: `1px solid ${isDark ? window.C3.lineDark : window.C3.lineLight}`, background: (isDark ? window.C3.fillDark : window.C3.fillLight), color: (isDark ? window.C3.textMutedDark : window.C3.textMutedLight), fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }
        }, React.createElement(Icon, { name: 'zap', size: 14, color: (isDark ? window.C3.textMutedDark : window.C3.textMutedLight) }), aiInsightLoading ? 'Analyzing...' : (insightCost ? `AI Insights · ${insightCost}` : 'AI Insights'))
        : React.createElement('div', { style: { background: (isDark ? window.C3.fillDark : window.C3.fillLight), border: `1px solid ${isDark ? window.C3.lineDark : window.C3.lineLight}`, borderRadius: 4, padding: 16, fontSize: 13, lineHeight: 1.6, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' } }, formatAI(aiInsight), !(aiInsight && aiInsight.error) && React.createElement('div', { style: { fontSize: 10, opacity: 0.4, marginTop: 10, fontStyle: 'italic' } }, 'AI-generated \u2014 not financial advice'))
      ),
      // AI Analysis before Adopt -- needs a model key.
      aiOn && React.createElement('div', { style: { marginBottom: 20 } },
        !aiAnalysis ? React.createElement('button', {
          onClick: async () => {
            setAiAnalysisLoading(true);
            const userHoldings = window.PortfolioStorage?.getHoldingsByPortfolio?.(window.PortfolioStorage?.getPortfolios?.()?.[0]?.id) || [];
            const userTickers = userHoldings.map(h => h.symbol?.split('.')[0]).filter(Boolean).join(', ') || 'None';
            const prompt = `Portfolio adoption analysis:\nTemplate: ${t.name} (${t.tickers?.map(tk => tk.split('.')[0]).join(', ')})\nUser's current holdings: ${userTickers}\n\nAnalyze:\n1. Overlap with current portfolio (list common tickers)\n2. Diversification impact (better or worse?)\n3. Risk change (how portfolio risk would change)\n4. Recommendation: Adopt as-is, modify, or skip? Why?`;
            const result = await callAI(prompt, 'portfolio_analyze', 2);
            if (result !== 'NOT_ENOUGH_TOKENS') setAiAnalysis(result);
            setAiAnalysisLoading(false);
          },
          disabled: aiAnalysisLoading,
          style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 4, border: '1px solid rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.08)', color: _ink('#f97316'), fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }
        }, React.createElement(Icon, { name: 'target', size: 14, color: '#f97316' }), aiAnalysisLoading ? 'Analyzing...' : (analyzeCost ? `AI Analyze vs My Portfolio · ${analyzeCost}` : 'AI Analyze vs My Portfolio'))
        : React.createElement('div', { style: { background: (isDark ? window.C3.fillDark : window.C3.fillLight), border: `1px solid ${isDark ? window.C3.lineDark : window.C3.lineLight}`, borderRadius: 4, padding: 16, fontSize: 13, lineHeight: 1.6, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)' } }, formatAI(aiAnalysis), !(aiAnalysis && aiAnalysis.error) && React.createElement('div', { style: { fontSize: 10, opacity: 0.4, marginTop: 10, fontStyle: 'italic' } }, 'AI-generated \u2014 not financial advice'))
      ),
      // Adopt button. Disabled while a fund's holdings are still in flight, and
      // permanently for funds that report names without symbols — there is
      // nothing to build positions from, and a portfolio of company names would
      // be worse than no button at all.
      (t.tickers && t.tickers.length) && t._holdingsState !== 'loading'
        ? adoptControls('tpl:' + (t.id || t.name), t, 'Adopt This Portfolio', { width: '100%', padding: '14px', borderRadius: 4, fontWeight: 700, fontSize: 14, fontFamily: "'Sora',sans-serif" })
        : React.createElement('button', {
          disabled: true,
          style: { width: '100%', padding: '14px', borderRadius: 4, border: 'none', background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', color: _tm, fontWeight: 700, fontSize: 14, cursor: 'not-allowed', fontFamily: "'Sora',sans-serif" }
        }, t._holdingsState === 'loading' ? 'Loading holdings…' : t._holdingsState === 'failed' ? 'Holdings did not load' : 'Holdings reported without tickers')
    );
  }

  // A card is a button: 81 of the 94 were a <div> with a click handler and
  // nothing else, so a template or a fund could not be chosen from the
  // keyboard. Tab reaches it; Enter or Space presses it.
  // In Compare mode a card is a toggle and says whether it is picked.
  const cardButton = (key, pressed) => ({
    role: 'button', tabIndex: 0, 'data-card': key,
    onClickCapture: () => { openedCardRef.current = key; },
    ...(pressed === undefined ? {} : { 'aria-pressed': pressed }),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.currentTarget.click();
    },
  });

  // Browse view
  return React.createElement('div', { className: 'pt-fields', style: { fontFamily: "'Sora', sans-serif", color: _tc } },
    window.PTFieldFocus ? window.PTFieldFocus(isDark) : null,
    // Header
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        inTg && onClose && React.createElement('button', {
          onClick: onClose, 'aria-label': 'Back',
          style: { width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid ' + _bd, borderRadius: 10, color: _tm, cursor: 'pointer', marginRight: 4, padding: 0 },
        }, React.createElement(Icon, { name: 'chevronLeft', size: 18 })),
        React.createElement(asPage ? 'h1' : 'h2', { className: asPage ? 'mi-page-title' : undefined, style: { margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' } }, 'Portfolio Ideas'),
        window.HelpTooltip && React.createElement(window.HelpTooltip, { title: 'Portfolio Ideas', text: 'Pre-built portfolio templates by investing style, risk profile, and goals. Adopt a template or use it as inspiration for your own portfolio.', isDark }),
      ),
      React.createElement('span', { style: { fontSize: 12, color: _tm } }, filtered.length + ' portfolios'),
    ),
    // Search
    React.createElement('input', { ...window.TickerFieldProps,
      value: searchQuery, onChange: (e) => setSearchQuery(e.target.value),
      placeholder: 'Portfolios, tickers, themes',
      style: { width: '100%', padding: '10px 14px', borderRadius: 4, border: '1px solid ' + _bd, background: _ibg, color: _tc, fontSize: 13, fontFamily: "'Sora',sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 16 }
    }),
    // AI Portfolio Builder and Compare -- both end in a model call.
    aiOn && React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 16 } },
      React.createElement('button', {
        onClick: () => setShowBuilder(!showBuilder),
        style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 4, border: `1px solid ${isDark ? window.C3.lineDark : window.C3.lineLight}`, background: (isDark ? window.C3.fillDark : window.C3.fillLight), color: (isDark ? window.C3.textMutedDark : window.C3.textMutedLight), fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }
      }, React.createElement(Icon, { name: 'zap', size: 14, color: (isDark ? window.C3.textMutedDark : window.C3.textMutedLight) }), 'AI Portfolio Builder'),
      React.createElement('button', {
        onClick: () => { setCompareMode(!compareMode); setCompareSelection([]); setCompareResult(null); },
        style: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 4, border: '1px solid ' + _bd, background: compareMode ? 'rgba(249,115,22,0.1)' : _bg, color: compareMode ? _ink('#f97316') : _tm, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }
      }, React.createElement(Icon, { name: 'activity', size: 14 }), compareMode ? 'Cancel Compare' : 'Compare Portfolios'),
    ),
    // AI Builder panel
    showBuilder && React.createElement('div', { style: { background: (isDark ? window.C3.fillDark : window.C3.fillLight), border: `1px solid ${isDark ? window.C3.lineDark : window.C3.lineLight}`, borderRadius: 4, padding: 16, marginBottom: 16 } },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, 'Describe your ideal portfolio:'),
      React.createElement('div', { 'data-field-row': '', style: { display: 'flex', gap: 8 } },
        React.createElement('input', {
          'data-field-floor': '',
          value: builderPrompt, onChange: (e) => setBuilderPrompt(e.target.value),
          placeholder: 'e.g. "AI stocks, low risk"',
          style: { flex: 1, '--field-floor': '14em', padding: '10px 12px', borderRadius: 4, border: '1px solid ' + _bd, background: _ibg, color: _tc, fontSize: 13, fontFamily: "'Sora',sans-serif", outline: 'none' },
          onKeyDown: (e) => { if (e.key === 'Enter' && builderPrompt.trim()) buildPortfolio(); }
        }),
        React.createElement('button', {
          onClick: buildPortfolio, disabled: builderLoading || !builderPrompt.trim(),
          style: { padding: '10px 20px', borderRadius: 4, background: C3.logoGradient, border: 'none', color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer', fontFamily: "'Sora',sans-serif", whiteSpace: 'nowrap' }
        }, builderLoading ? '...' : (builderCost ? `Build · ${builderCost}` : 'Build')),
      ),
      builderResult && builderResult.error && React.createElement('div', { role: 'alert', style: { marginTop: 12, padding: 12, borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: _ink('#ef4444'), fontSize: 13 } }, builderResult.error),
      builderResult && builderResult.portfolio && (() => {
        // Drawn only from checked values: whatever reached here, a field that
        // is not what it should be shows as a dash rather than crashing the
        // screen.
        const p = builderResult.portfolio;
        const rows = (Array.isArray(p.holdings) ? p.holdings : []).filter((h) => h && typeof h.ticker === 'string' && h.ticker);
        const pct = (w) => { const n = Number(w); return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'; };
        const risk = Number.isInteger(p.risk) && p.risk >= 1 && p.risk <= 5 ? p.risk : null;
        return React.createElement('div', { 'data-built-portfolio': 'true', style: { marginTop: 12, background: _bg, border: '1px solid ' + _bd, borderRadius: 4, padding: 16, fontSize: 13, lineHeight: 1.6, color: _tc } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
            React.createElement('h3', { style: { margin: 0, fontSize: 15, fontWeight: 700 } }, String(p.name || 'Portfolio')),
            risk && React.createElement('span', { style: { padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700, background: `${riskColors[risk]}15`, color: _badgeInk(riskColors[risk]) } }, `Risk ${risk}/5`),
            typeof p.returnRange === 'string' && p.returnRange && React.createElement('span', { style: { color: _tm, fontSize: 12 }, title: 'The model\'s illustrative range per year. Not a backtest and not a forecast.' }, `Illustrative return: ${p.returnRange} / yr`),
          ),
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', marginBottom: 10 } },
            React.createElement('thead', null, React.createElement('tr', { style: { borderBottom: '1px solid ' + _bd } },
              React.createElement('th', { style: { textAlign: 'left', padding: '6px 0', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: _tm } }, 'Holding'),
              React.createElement('th', { style: { textAlign: 'right', padding: '6px 0', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: _tm } }, 'Weight'))),
            React.createElement('tbody', null, rows.map((h) => React.createElement('tr', { key: h.ticker, style: { borderBottom: '1px solid ' + _bd } },
              React.createElement('td', { style: { padding: '6px 0', fontWeight: 600 } }, h.ticker.replace(/\.US$/, '')),
              React.createElement('td', { style: { padding: '6px 0', textAlign: 'right', fontFamily: "'Roboto Mono', monospace" } }, pct(h.weight)))))),
          typeof p.rationale === 'string' && p.rationale && React.createElement('p', { style: { margin: '0 0 6px', color: _tm } }, p.rationale),
          // A paid result you can use: a portfolio of these positions, the
          // same way a template is adopted, at no further charge.
          rows.length > 0 && React.createElement('div', { style: { marginTop: 8, marginBottom: 8 } },
            adoptControls('built:' + (builderResult.seq || 0), { name: String(p.name || 'AI portfolio'), tickers: rows.map((h) => h.ticker), weights: rows.map((h) => (Number.isFinite(Number(h.weight)) ? Number(h.weight) : null)) }, 'Create portfolio from this',
              { width: '100%', padding: '10px 14px', borderRadius: 4, fontWeight: 600, fontSize: 13, fontFamily: "'Sora',sans-serif" })),
          React.createElement('div', { style: { fontSize: 10, opacity: 0.6, fontStyle: 'italic' } }, 'AI-generated \u2014 not financial advice'));
      })(),
    ),
    // Compare result
    compareMode && compareSelection.length === 2 && !compareResult && !compareLoading && React.createElement('div', { style: { textAlign: 'center', marginBottom: 16 } },
      React.createElement('button', { onClick: runCompare, style: { padding: '10px 24px', borderRadius: 4, background: C3.logoGradient, border: 'none', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: "'Sora',sans-serif" } }, compareCost ? `Compare These Two · ${compareCost}` : 'Compare These Two'),
    ),
    compareLoading && React.createElement('div', { style: { textAlign: 'center', padding: 16, color: _tm, marginBottom: 16 } }, 'Comparing...'),
    compareResult && React.createElement('div', { style: { background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: 4, padding: 16, marginBottom: 16, fontSize: 13, lineHeight: 1.6, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)', whiteSpace: 'pre-wrap' } },
      React.createElement('div', { style: { fontWeight: 700, marginBottom: 8, color: _ink('#f97316') } }, `${compareSelection[0]?.name} vs ${compareSelection[1]?.name}`),
      formatAI(compareResult),
      !(compareResult && compareResult.error) && React.createElement('div', { style: { fontSize: 10, opacity: 0.4, marginTop: 10, fontStyle: 'italic' } }, 'AI-generated \u2014 not financial advice'),
    ),
    // Compare mode instruction
    compareMode && compareSelection.length < 2 && React.createElement('div', { style: { background: 'rgba(249,115,22,0.05)', borderRadius: 4, padding: 10, marginBottom: 16, fontSize: 12, color: _ink('#f97316'), textAlign: 'center' } }, `Select ${2 - compareSelection.length} more portfolio${compareSelection.length === 1 ? '' : 's'} to compare`),

    // Feature 1: Recommended For You
    !searchQuery && selectedCategory === 'all' && recommended.length > 0 && React.createElement('div', { style: { marginBottom: 24 } },
      React.createElement('h3', { style: { fontSize: 14, fontWeight: 700, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 6 } },
        React.createElement(Icon, { name: 'star', size: 14, color: '#f97316' }), 'Recommended For You'),
      // A wrapping grid, not a sideways row: the fifth card ("All Weather")
      // was cut off at the right edge with nothing saying the row scrolled.
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))', gap: 12 } },
        recommended.map(t => React.createElement('div', {
          key: t.id + '-rec',
          ...cardButton(t.id + '-rec'),
          onClick: () => { setSelectedTemplate(t); setAiInsight(null); setAiAnalysis(null); },
          style: { minWidth: 0, background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: 4, padding: 14, cursor: 'pointer' }
        },
          React.createElement('div', { style: { fontWeight: 700, fontSize: 13, marginBottom: 4 } }, t.name),
          React.createElement('div', { style: { fontSize: 11, color: _tm, marginBottom: 6 } }, t.description),
          React.createElement('div', { style: { display: 'flex', gap: 4 } },
            (t.tickers || []).slice(0, 3).map(tk => React.createElement('span', { key: tk, style: { padding: '1px 5px', borderRadius: 2, fontSize: 9, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', fontFamily: "'Roboto Mono',monospace" } }, tk.split('.')[0])),
          ),
        ))
      ),
    ),

    // Category filters
    React.createElement('div', { style: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 20 } },
      categories.map(cat => {
        const active = selectedCategory === cat.id;
        return React.createElement('button', {
          key: cat.id, onClick: () => setSelectedCategory(cat.id),
          style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 4, whiteSpace: 'nowrap', cursor: 'pointer', border: '1px solid ' + _bd, background: _bg, color: _tm, ...window.ToggleStyle.value(active, isDark, { bordered: true }), fontSize: 11, fontWeight: 600, fontFamily: "'Sora',sans-serif" }
        }, React.createElement(Icon, { name: cat.icon, size: 12, color: 'currentColor' }), cat.label);
      })
    ),
    // Grid of cards
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 12 } },
      filtered.map(t => React.createElement('div', {
        key: t.id,
        ...cardButton(String(t.id), compareMode ? !!compareSelection.find(s => s.id === t.id) : undefined),
        onClick: () => {
          if (compareMode) {
            if (compareSelection.find(s => s.id === t.id)) {
              setCompareSelection(compareSelection.filter(s => s.id !== t.id));
            } else if (compareSelection.length < 2) {
              setCompareSelection([...compareSelection, t]);
            }
            return;
          }
          setSelectedTemplate(t); setAiInsight(null); setAiAnalysis(null);
        },
        style: {
          background: compareSelection.find(s => s.id === t.id) ? 'rgba(249,115,22,0.08)' : _bg,
          border: `1px solid ${compareSelection.find(s => s.id === t.id) ? 'rgba(249,115,22,0.4)' : _bd}`,
          borderRadius: 4, padding: 16, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s'
        },
        onMouseEnter: (e) => { if (!compareSelection.find(s => s.id === t.id)) { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'; }},
        onMouseLeave: (e) => { if (!compareSelection.find(s => s.id === t.id)) { e.currentTarget.style.borderColor = _bd; }},
      },
        // Card header
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
          React.createElement('h3', { style: { margin: 0, fontSize: 14, fontWeight: 700 } }, t.name),
          React.createElement('span', { style: { padding: '2px 8px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: `${riskColors[t.risk]}15`, color: _badgeInk(riskColors[t.risk]) } }, riskLabels[t.risk]),
        ),
        // Description
        React.createElement('p', { style: { margin: '0 0 10px', fontSize: 12, color: _tm, lineHeight: 1.4 } }, t.description),
        // Tickers preview
        React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 } },
          (t.tickers || []).slice(0, 5).map(tk => React.createElement('span', { key: tk, style: { padding: '2px 6px', borderRadius: 2, fontSize: 10, fontWeight: 600, background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', color: _tm, fontFamily: "'Roboto Mono',monospace" } }, tk.split('.')[0]))
        ),
        // Return + holdings count
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: _tm } },
          React.createElement('span', { title: 'Illustrative long-run range per year, set by hand for this template. Not a backtest and not a forecast.' }, 'Illustrative: ', React.createElement('span', { style: { color: _ink('#22c55e') } }, t.returnRange + ' / yr')),
          // Fund templates load their holdings on open; "0 holdings" read as
          // an empty portfolio.
          (() => {
            const n = t.totalHoldings ?? (t.tickers?.length || 0);
            return React.createElement('span', null, n > 0 ? n + (n === 1 ? ' holding' : ' holdings') : 'Fund');
          })(),
        ),
      ))
    ),
    // Empty state
    filtered.length === 0 && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: _tm } }, 'No portfolios match your search'),
  );
};
