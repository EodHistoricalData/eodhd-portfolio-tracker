// Portfolio Tracker - Main Component (Concept 3 Glassmorphism Design)
// The view itself; window.PortfolioTrackerView (end of file) wraps it in a
// boundary that can recover from stored data the view cannot draw.
window.PortfolioTrackerViewInner = ({ apiKey, onBack, onSelectAsset, theme, activeTab, onTabChange, onSettingsClick, onShowReferral, requireRegistration, initialAction }) => {
  const [portfolios, setPortfolios] = React.useState([]);
  const [activePortfolioId, setActivePortfolioId] = React.useState(null);
  // A save the account may not have yet (no answer, a 5xx): kept on the
  // device and resent. Said here while ANY of its sections is unacknowledged:
  // the holding alone getting through does not clear it.
  const PT_SECTIONS = ['pt_transactions', 'pt_holdings'];
  const ptPending = () => Boolean(window.DataSync && window.DataSync.isPending && window.DataSync.isPending(PT_SECTIONS));
  const [syncPending, setSyncPending] = React.useState(ptPending);
  React.useEffect(() => {
    const recheck = () => setSyncPending(ptPending());
    ['datasync:pending', 'datasync:pushed', 'datasync:synced'].forEach((t) => window.addEventListener(t, recheck));
    recheck();
    return () => ['datasync:pending', 'datasync:pushed', 'datasync:synced'].forEach((t) => window.removeEventListener(t, recheck));
  }, []);
  const syncNote = syncPending ? (
    <div role="status" data-sync-pending style={{ fontSize: 12, margin: '6px 0 0', color: theme === 'dark' ? window.C3.textMutedDark : window.C3.textMutedLight }}>
      Saved on this device, syncing with your account…
    </div>
  ) : null;
  // Phones and tablets (<=1024px): the portfolio picker's icon buttons were
  // 32 px; 40x40 there. Desktop keeps the compact size.
  // A tablet in landscape (1180, 1366 px) is wider than that and still
  // touch: a coarse pointer counts as touch too.
  const isTouch = () => window.innerWidth <= 1024 || Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const [touchWidth, setTouchWidth] = React.useState(isTouch);
  React.useEffect(() => {
    const onResize = () => setTouchWidth(isTouch());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const tap40 = touchWidth ? { minWidth: 40, minHeight: 40, justifyContent: 'center' } : null;

  // Which portfolio is open belongs in the URL, so a reload comes back to the
  // one you were reading rather than the default. Unlike the other views this
  // is not a link you can hand to somebody: portfolios are local to a person,
  // so an id from someone else's URL simply is not found, and the app falls
  // back to their own default instead of showing an empty screen.
  const bootedFromUrl = React.useRef(false);
  const ACTIVE_KEY = 'eodhd_pt_active_portfolio';   // this tab's session only
  React.useEffect(() => {
    if (bootedFromUrl.current || !portfolios.length) return;
    bootedFromUrl.current = true;
    const st = window.ViewState ? window.ViewState.read('portfolio') : {};
    // No id in the URL (Portfolio opened from an asset page's "+ Portfolio",
    // or the menu): the portfolio this person had open in this session, not
    // the first one -- NVDA went to "My Portfolio" while they worked in
    // "QA Growth", and the page switched to it.
    let want = st.id;
    if (!want) { try { want = sessionStorage.getItem(ACTIVE_KEY); } catch (_) { want = null; } }
    if (!want) return;
    const match = portfolios.find(function (p) { return String(p.id) === String(want); });
    if (match) setActivePortfolioId(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolios]);

  React.useEffect(() => {
    if (!bootedFromUrl.current) return;
    if (activePortfolioId && activePortfolioId !== 'all') { try { sessionStorage.setItem(ACTIVE_KEY, activePortfolioId); } catch (_) { /* private mode */ } }
    if (!window.ViewState) return;
    window.ViewState.merge({ id: activePortfolioId || '' });
  }, [activePortfolioId]);
  const [holdings, setHoldings] = React.useState([]);
  const [holdingsData, setHoldingsData] = React.useState({});
  const [forexRates, setForexRates] = React.useState({});
  const [loading, setLoading] = React.useState(true);
  // When the prices in the table were last fetched. The footer used to print
  // a bare "Updated" with no time at all.
  const [pricesUpdatedAt, setPricesUpdatedAt] = React.useState(null);
  // What the first quote request that failed was (RateLimitWait.failure),
  // for the line under the totals: "No prices came back." stood for a 500,
  // a dropped connection and a page that could not be read alike.
  // Null when nothing failed.
  const [pricesFail, setPricesFail] = React.useState(null);
  const [showAddPosition, setShowAddPosition] = React.useState(false);
  const [showAddPortfolio, setShowAddPortfolio] = React.useState(false);
  // A name over the limit is said, not cut.
  const [newPortfolioNote, setNewPortfolioNote] = React.useState('');

  // While a dirty form is open in TG, enable the close-confirmation. Without
  // this the user swipes down on the Mini App, dismissing it, and silently
  // loses unsaved data — the kind of behaviour that fails a listing review.
  React.useEffect(() => {
    if (!window.TGNav || !window.TGNav.isAvailable()) return;
    const dirty = showAddPosition || showAddPortfolio || showImportCSV || editHolding;
    window.TGNav.confirmClosing(dirty);
    return () => window.TGNav.confirmClosing(false);
  }, [showAddPosition, showAddPortfolio]);
  const [newPortfolioCurrency, setNewPortfolioCurrency] = React.useState('USD');
  const [showSettings, setShowSettings] = React.useState(false);
  // What the last Rename did, said in the Settings window.
  const [renameNote, setRenameNote] = React.useState(null);
  // Restore from Backup said its problems with alert() and asked with
  // confirm(); both are in the page now, under the button.
  const [backupNote, setBackupNote] = React.useState(null);
  const [askInPage, askElement] = window.PTDialog.useAsk();
  // A question asked in the page instead of the browser's confirm(): deleting
  // a portfolio said "Delete this portfolio..." without its name, deleting a
  // position was the system box. { label, title, text,
  // confirmLabel, onConfirm, restore } -- restore() names where the focus
  // goes once it is done, the button that asked having gone with the deletion.
  const [confirmAsk, setConfirmAsk] = React.useState(null);
  const confirmDoneRef = React.useRef(false);
  const askConfirm = (ask) => { confirmDoneRef.current = false; setConfirmAsk(ask); };
  // Another portfolio of the same name, case and spaces aside: two "My
  // Portfolio" in the picker could not be told apart.
  const portfolioNamed = (name, exceptId) => {
    const key = String(name || '').trim().toLowerCase();
    return Storage.getPortfolios().find(p => p.id !== exceptId && String(p.name || '').trim().toLowerCase() === key) || null;
  };
  const [showImportCSV, setShowImportCSV] = React.useState(false);
  const [showTransactionHistory, setShowTransactionHistory] = React.useState(false);
  const [showAnalytics, setShowAnalytics] = React.useState(false);
  // The tab the Analytics view opens on (null: its first, Allocation). The
  // Pro Tools tiles opened it on Allocation and sent their tab 100 ms later:
  // Allocation showed for that time, and a press on it went nowhere.
  const [analyticsTab, setAnalyticsTab] = React.useState(null);
  const openAnalytics = (tab) => { setAnalyticsTab(tab || null); setShowAnalytics(true); };
  const [showMacroDashboard, setShowMacroDashboard] = React.useState(false);
  const [showPortfolioHealth, setShowPortfolioHealth] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  const [showAIChat, setShowAIChat] = React.useState(false);
  // The template catalogue, funds included ("copy a real fund's allocation").
  // hydrateFundTemplate and 76 templates shipped with no way to reach them
  // from the tracker.
  const [showCatalog, setShowCatalog] = React.useState(false);
  (window.useEscLayer || (() => {}))(showCatalog, () => setShowCatalog(false));
  // A quick action's prompt for the chat: { prompt, title, n } (n remounts it).
  const [chatPrompt, setChatPrompt] = React.useState(null);
  const [showAIInsights, setShowAIInsights] = React.useState(false);
  const [showRebalancingAdvisor, setShowRebalancingAdvisor] = React.useState(false);
  const [showTaxView, setShowTaxView] = React.useState(false);

  // The Rebalancing Advisor and the AI chat open over the portfolio as panels
  // with no address of their own: the browser's Back left the portfolio
  // altogether (to the Dashboard), and Escape did not close the advisor.
  // Opening one adds a history entry at the same address; Back
  // closes the panel, and closing it otherwise takes that entry back off.
  const usePanelHistory = (open, close, name) => {
    const closeRef = React.useRef(close);
    closeRef.current = close;
    // Escape closes either panel as a layer (the chat's input, the advisor):
    // the document listener here never ran while any other layer was up, and
    // the chat had none at all.
    (window.useEscLayer || (() => {}))(window.APP_PLATFORM === 'WEB' && open, () => closeRef.current());
    React.useEffect(() => {
      if (!open || window.APP_PLATFORM !== 'WEB') return;
      try { history.pushState(Object.assign({}, history.state || {}, { miPanel: name }), '', window.location.href); } catch (_) {}
      const onPop = () => { closeRef.current(); };
      window.addEventListener('popstate', onPop);
      return () => {
        window.removeEventListener('popstate', onPop);
        try { if (history.state && history.state.miPanel === name) history.back(); } catch (_) {}
      };
    }, [open]);
  };
  usePanelHistory(showRebalancingAdvisor, () => setShowRebalancingAdvisor(false), 'rebalancing');
  usePanelHistory(showAIChat, () => { setShowAIChat(false); setChatPrompt(null); }, 'ai-chat');
  const [selectedHolding, setSelectedHolding] = React.useState(null);
  const [editHolding, setEditHolding] = React.useState(null);
  const [settings, setSettings] = React.useState(null);
  const [autoInsights, setAutoInsights] = React.useState(null);
  const [insightsLoading, setInsightsLoading] = React.useState(false);
  // Synchronous in-flight ref so a double-tap on Refresh / Run Deep
  // AI Analysis can't fire two getQuickInsights calls (each one consumes
  // tokens). The state setter alone has a one-tick gap a fast tap can slip
  // through.
  const insightsInFlightRef = React.useRef(false);
  const [insightsDismissed, setInsightsDismissed] = React.useState(false);
  const [insightsError, setInsightsError] = React.useState('');
  const [webTab, setWebTab] = React.useState(() => {
    const sub = window._portfolioWebTab;
    if (sub) { window._portfolioWebTab = null; return sub; }
    return 'overview';
  });
  // The AI tab's chat and Rebalancing Advisor live on that tab: leaving it
  // closes them. They stayed open, unseen, and their Escape layers took the
  // next presses for nothing.
  React.useEffect(() => {
    if (window.APP_PLATFORM !== 'WEB' || webTab === 'ai') return;
    setShowAIChat(false);
    setChatPrompt(null);
    setShowRebalancingAdvisor(false);
  }, [webTab]);
  // Both prefs are checked for shape: `eodhd_overview_widgets = {}` parsed
  // fine and then `.includes is not a function` broke every render, reloads
  // included. And for content: an id this
  // build does not draw is dropped, and a list with none it knows is the
  // default -- an unknown id left Overview blank, the positions table gone.
  // A stored [] is the user's choice, said on the page.
  // The Overview widgets this build draws, in the Customize order.
  const OVERVIEW_WIDGETS = [
    { id: 'positions', label: 'Positions Table' },
    { id: 'allocation', label: 'Allocation' },
    { id: 'health', label: 'Health Score' },
    { id: 'pnl', label: 'P&L Breakdown' },
    { id: 'dividends', label: 'Dividends' },
  ];
  const [overviewWidgets, setOverviewWidgets] = React.useState(() => {
    const fallback = ['positions', 'allocation', 'health'];
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('eodhd_overview_widgets') || 'null'); } catch { saved = null; }
    if (window.SavedStore && window.SavedStore.knownList) return window.SavedStore.knownList(saved, OVERVIEW_WIDGETS.map(w => w.id), fallback);
    return Array.isArray(saved) ? saved.filter(w => OVERVIEW_WIDGETS.some(x => x.id === w)) : fallback;
  });
  const [showWidgetPicker, setShowWidgetPicker] = React.useState(false);
  (window.useEscLayer || (() => {}))(showWidgetPicker, () => { setShowWidgetPicker(false); try { customizeRef.current && customizeRef.current.focus(); } catch (_) {} });
  const [widgetSizes, setWidgetSizes] = React.useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('eodhd_widget_sizes') || 'null');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch { return {}; }
  });
  const getWidgetSize = (id) => widgetSizes[id] || 'auto';
  const cycleWidgetSize = (id) => {
    const sizes = ['compact', 'auto', 'full'];
    const current = widgetSizes[id] || 'auto';
    const next = sizes[(sizes.indexOf(current) + 1) % sizes.length];
    const updated = { ...widgetSizes, [id]: next };
    setWidgetSizes(updated);
    localStorage.setItem('eodhd_widget_sizes', JSON.stringify(updated));
  };
  // The size button is one letter, "M": named for a screen reader, with the
  // size it is on and what pressing does. It steps through
  // three sizes, so it is not a toggle and carries no aria-pressed.
  const sizeLabel = (id, name) => {
    const s = getWidgetSize(id);
    const now = s === 'compact' ? 'small' : s === 'full' ? 'large' : 'medium';
    const next = s === 'compact' ? 'medium' : s === 'full' ? 'small' : 'large';
    return { 'aria-label': `${name} widget size: ${now}. Change to ${next}` };
  };
  // "Customize" closes on Escape, and the focus goes back to its button.
  const customizeRef = React.useRef(null);
  React.useEffect(() => {
    if (!showWidgetPicker) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setShowWidgetPicker(false);
      try { customizeRef.current && customizeRef.current.focus(); } catch (_) {}
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showWidgetPicker]);
  const widgetMaxH = (id) => {
    const s = getWidgetSize(id);
    if (s === 'compact') return 200;
    if (s === 'full') return 9999;
    return 400;
  };

  // Watch for external tab navigation (from sidebar sub-items)
  React.useEffect(() => {
    if (window._portfolioWebTab) {
      setWebTab(window._portfolioWebTab);
      window._portfolioWebTab = null;
    }
    const handler = (e) => { if (e.detail) setWebTab(e.detail); };
    const aiHandler = (e) => {
      if (e.detail === 'rebalance') setShowRebalancingAdvisor(true);
      if (e.detail === 'insights') fetchAIInsights();
    };
    window.addEventListener('portfolio-web-tab', handler);
    window.addEventListener('portfolio-ai-action', aiHandler);
    return () => { window.removeEventListener('portfolio-web-tab', handler); window.removeEventListener('portfolio-ai-action', aiHandler); };
  }, []);

  const Storage = window.PortfolioStorage;
  const Calc = window.PortfolioCalculations;
  // Light theme: darker success/error/warning inks and accents, so text clears
  // 4.5:1 on white (Calc.themeInk).
  const C3 = window.PortfolioCalculations.themeInk(window.C3, theme === 'dark');
  const acc = (hex) => window.PortfolioCalculations.accent(hex, theme === 'dark');

  const isDark = theme === 'dark';
  // Green for a gain, red for a loss, and neither for nothing: a Realized
  // figure of +$0.00 in green reads as a profit that did not happen.
  // A white-on-dark ink, mirrored for the light theme. Eighteen colours were
  // written as rgba(255,255,255,a) with no isDark branch, and the light theme
  // rendered them at about 1.05:1 -- invisible.
  // Every ink here is text, much of it 10px: 0.3-0.4 read 2.6-4.45:1 on the
  // dark page. Floored at 0.55 dark / 0.45 light (about
  // 6:1 and 5.7:1); stronger inks are unchanged.
  // Muted text, never below AA on the theme's worst ground: the floor was
  // 0.45 black in the light theme -- the size badge "M" read 3.3:1 -- and
  // 0.55 white in the dark.
  const ink = (a) => (isDark ? 'rgba(255,255,255,' + Math.max(a, 0.65) + ')' : 'rgba(0,0,0,' + Math.min(1, Math.max(a + 0.15, 0.65)) + ')');
  const signColor = (v) => (v > 0 ? C3.success : v < 0 ? C3.error : (isDark ? C3.textMutedDark : C3.textMutedLight));
  const signType = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral');
  // A number from the API, or null. real-time answers "NA" for some names
  // (BRK.B), and "NA" is truthy: it went into the maths as a price and came
  // out as DAY CHG "NaN%" and TOTAL RETURN -100% on a position that was fine.
  const asNum = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
  // A price is above zero. "close": 0 read as a price made every position a
  // 100% loss, and -243 made the portfolio's value negative: either is "no price" and the position is shown unpriced.
  const asPrice = (v) => { const n = asNum(v); return n != null && n > 0 ? n : null; };

  // Icon component with inline styles
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

  // A tool opened from the AI tab (initialAction) closes back to the AI tab,
  // not to this portfolio's first screen.
  const fromAiRef = React.useRef(false);
  const closeTool = (setter) => () => {
    setter(false);
    if (fromAiRef.current) { fromAiRef.current = false; if (onTabChange) onTabChange('ai'); }
  };

  // Handle initialAction from AI Hub navigation
  React.useEffect(() => {
    if (!initialAction) return;
    fromAiRef.current = window.APP_PLATFORM !== 'WEB';
    if (initialAction === 'aiInsights') setShowAIInsights(true);
    else if (initialAction === 'rebalancing') setShowRebalancingAdvisor(true);
    else if (initialAction === 'whatIf') openAnalytics('whatif');
  }, [initialAction]);

  // Common styles
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
      zIndex: 50,
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    card: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 16,
      padding: 20,
      marginBottom: 16
    },
    button: {
      padding: '8px 16px',
      borderRadius: 12,
      fontWeight: 600,
      fontSize: 14,
      cursor: 'pointer',
      transition: 'background-color 150ms ease, opacity 150ms ease',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    },
    primaryButton: {
      background: C3.logoGradient,
      color: 'white'
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
    input: {
      width: '100%',
      padding: '12px 16px',
      borderRadius: 12,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 16,
      outline: 'none'
    },
    label: {
      display: 'block',
      fontSize: 14,
      marginBottom: 8,
      color: isDark ? C3.textMutedDark : C3.textMutedLight
    },
    modalOverlay: {
      position: 'fixed',
      inset: 0,
      overscrollBehavior: 'contain',
      background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      zIndex: 50,
      display: 'flex',
      // Align near the top so tall forms don't sit below the fold;
      // overlay itself scrolls if content overflows viewport.
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '5vh 16px',
      overflowY: 'auto',
    },
    modalContent: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      borderRadius: 20,
      padding: 24,
      width: '100%',
      maxWidth: 400,
      maxHeight: '90vh',
      overflowY: 'auto'
    },
    bottomNav: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: isDark ? '#1A1813' : '#ffffff',
      borderTop: `1px solid ${isDark ? '#2B2820' : '#e2e4e9'}`,
      padding: '10px 0 12px 0',
      display: 'flex',
      justifyContent: 'space-around',
      zIndex: 40,
      boxShadow: isDark ? '0 -2px 12px rgba(0,0,0,0.35)' : '0 -2px 12px rgba(0,0,0,0.06)'
    }
  };

  // Initialize on mount
  const [prefillSymbol, setPrefillSymbol] = React.useState(null);
  const [prefillType, setPrefillType] = React.useState(null);
  const [prefillAssetName, setPrefillAssetName] = React.useState(null);
  const [syncRev, setSyncRev] = React.useState(0);
  const [importReport, setImportReport] = React.useState(null);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (window.APP_PLATFORM !== 'WEB' && window.needsOnboarding && window.needsOnboarding()) {
      setShowOnboarding(true);
      setLoading(false);
      return;
    }
    // A signed-in account's portfolios come from the server. Making the
    // default "My Portfolio" before that pull answered created a second
    // portfolio in an empty browser whose push replaced the real one, and the
    // holdings were left on the old id: "0 holdings".
    // So wait for the pull (capped, for an unreachable backend), then repair
    // and only then fall back to a default.
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      startedRef.current = true;
      const defaultPortfolio = Storage.initialize();
      loadData();
      setSettings(Storage.getSettings());
      if (defaultPortfolio) {
        setActivePortfolioId(defaultPortfolio.id);
      }
    };
    const ready = window.DataSync && typeof window.DataSync.ready === 'function'
      ? window.DataSync.ready(8000) : null;
    if (ready) ready.then(start, start); else start();
    return () => { cancelled = true; };
  }, []);

  // A pull that lands after the page has drawn (slow backend, the wait above
  // timed out) has replaced the stored portfolios: draw them again, repaired,
  // and keep the selection when it still exists.
  React.useEffect(() => {
    const onPulled = () => {
      if (!startedRef.current) return;
      Storage.initialize();
      const all = Storage.getPortfolios();
      setPortfolios(all);
      setActivePortfolioId(cur => (cur && all.some(p => p.id === cur)) ? cur : (all[0] ? all[0].id : null));
      setSyncRev(n => n + 1);
    };
    window.addEventListener('datasync:pulled', onPulled);
    return () => window.removeEventListener('datasync:pulled', onPulled);
  }, []);

  // Another tab changed the portfolio data: draw what is stored now. A tab
  // kept showing a portfolio deleted in another, and a position added there
  // went to an id no portfolio had and vanished on reload. The browser fires `storage` only in the other tabs.
  React.useEffect(() => {
    const keys = new Set([Storage.KEYS.PORTFOLIOS, Storage.KEYS.HOLDINGS, Storage.KEYS.TRANSACTIONS]);
    const onStorage = (e) => {
      if (!startedRef.current || (e && e.key != null && !keys.has(e.key))) return;
      const all = Storage.getPortfolios();
      setPortfolios(all);
      setActivePortfolioId(cur => (cur === 'all' || (cur && all.some(p => p.id === cur))) ? cur : (all[0] ? all[0].id : null));
      setSyncRev(n => n + 1);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // The positions' names filled in from the search after a template was
  // adopted (window.PortfolioFillNames). It finishes
  // in the background, often after "Open portfolio": the table kept the
  // codes (AGNC, PBA) until a reload, though storage had the names.
  // The portfolios and the open one's positions are
  // read again; the prices stay, they are kept by position id.
  const [namesRev, setNamesRev] = React.useState(0);
  React.useEffect(() => {
    const onFilled = () => setNamesRev(n => n + 1);
    window.addEventListener('portfolio:names-filled', onFilled);
    return () => window.removeEventListener('portfolio:names-filled', onFilled);
  }, []);
  React.useEffect(() => {
    if (!namesRev || !startedRef.current) return;
    setPortfolios(Storage.getPortfolios());
    if (activePortfolioId) setHoldings(Storage.getHoldingsByPortfolio(activePortfolioId));
  }, [namesRev]);

  // Closing Add Position without saving, when an asset page opened it, goes
  // back to that page: the visitor came to add one position and
  // was left on Portfolio. The app listens for portfolio:add-cancelled.
  // The form closes itself after a save too (onSave, then onClose): that
  // close is not a cancel, and must not send the person back to the asset
  // page they came from (found by with #2).
  const addSavedRef = React.useRef(false);
  const closeAddPosition = () => {
    const sym = prefillSymbol;
    const saved = addSavedRef.current;
    addSavedRef.current = false;
    setShowAddPosition(false);
    setPrefillSymbol(null);
    if (sym && !saved) { try { window.dispatchEvent(new CustomEvent('portfolio:add-cancelled', { detail: sym })); } catch (_) {} }
  };

  // Telegram's Back closes the innermost screen or dialog open over the
  // portfolio, as its own close does. Pro Tools (Macro, Health, Analytics,
  // Tax, AI Insights) and the dialogs had only an in-app arrow. The AI chat and the Rebalancing Advisor register their own.
  const tgTopClose = editHolding ? () => setEditHolding(null)
    : showTransactionHistory ? () => { setShowTransactionHistory(false); setSelectedHolding(null); }
    : showAddPosition ? closeAddPosition
    : showAddPortfolio ? () => setShowAddPortfolio(false)
    : showImportCSV ? () => setShowImportCSV(false)
    : showSettings ? () => setShowSettings(false)
    : showAIInsights ? closeTool(setShowAIInsights)
    : showAnalytics ? closeTool(setShowAnalytics)
    : showTaxView ? () => setShowTaxView(false)
    : showMacroDashboard ? () => setShowMacroDashboard(false)
    : showPortfolioHealth ? () => setShowPortfolioHealth(false)
    : null;

  // Listen for add-symbol event from asset detail
  React.useEffect(() => {
    // detail: { symbol, type } from the asset page (type is EODHD's
    // General.Type, "FUND" / "ETF" / "Common Stock"), or a bare symbol.
    const handler = (e) => {
      const d = e.detail;
      addSavedRef.current = false;
      setPrefillSymbol(d && typeof d === 'object' ? d.symbol : d);
      setPrefillType(d && typeof d === 'object' ? (d.type || null) : null);
      setPrefillAssetName(d && typeof d === 'object' ? (d.name || null) : null);
      setShowAddPosition(true);
    };
    window.addEventListener('portfolio:add-symbol', handler);
    return () => window.removeEventListener('portfolio:add-symbol', handler);
  }, []);

  const loadData = () => {
    const allPortfolios = Storage.getPortfolios();
    setPortfolios(allPortfolios);
    if (allPortfolios.length > 0 && !activePortfolioId) {
      setActivePortfolioId(allPortfolios[0].id);
    }
  };

  React.useEffect(() => {
    if (activePortfolioId) {
      const portfolioHoldings = Storage.getHoldingsByPortfolio(activePortfolioId);
      setHoldings(portfolioHoldings);
      loadHoldingsPrices(portfolioHoldings);
    } else {
      // No portfolio selected is no positions on screen -- not the last
      // portfolio's, already deleted.
      priceSeqRef.current++;
      priceStoreRef.current = { key: null, quotes: {}, eod: {}, rates: {}, draw: null, at: null };
      setHoldings([]);
      setHoldingsData({});
    }
  }, [activePortfolioId, syncRev]);

  const loadForexRates = async (holdingsList, baseCurrency, isCurrent = () => true) => {
    const currencies = [...new Set(holdingsList.map(h => h.currency || 'USD'))];
    if (!Storage.isForexCacheStale()) {
      const cachedRates = {};
      let allCached = true;
      for (const currency of currencies) {
        if (currency === baseCurrency) {
          cachedRates[currency] = 1;
        } else {
          // A cached "NA" (written before 2026-09-30) is not a rate.
          const rate = Calc.toRate(Storage.getCachedForexRate(currency, baseCurrency));
          if (rate) cachedRates[currency] = rate;
          else { allCached = false; break; }
        }
      }
      if (allCached) { if (isCurrent()) setForexRates(cachedRates); return cachedRates; }
    }
    // Calc.fxRates maps minor units (GBX -> GBP/100) and treats "NA" as
    // missing; a missing rate stays null.
    const rates = await Calc.fxRates(apiKey, baseCurrency, currencies);
    for (const [currency, rate] of Object.entries(rates)) {
      if (currency !== baseCurrency && rate) Storage.setCachedForexRate(currency, baseCurrency, rate);
    }
    if (isCurrent()) setForexRates(rates);
    return rates;
  };

  // Only the latest load may draw. Switching portfolio while quotes were
  // loading let the old portfolio's late answer replace the new one's:
  // EUR 0.00 and "0 shares" under "Prices as of".
  const priceSeqRef = React.useRef(0);
  // The latest load's run in RateLimitWait.setBusy("prices").
  const busyTokenRef = React.useRef(null);
  // What this portfolio's loads have brought back, whichever load asked.
  // Try again while the first request still hung, and the retry failing,
  // dropped the first request's answer when it came: prices stayed N/A.
  // An answer is kept if it is newer than the one
  // held, a failure never takes a price away, and the latest load draws.
  const priceStoreRef = React.useRef({ key: null, quotes: {}, eod: {}, rates: {}, draw: null, at: null });
  // The templates dialog takes the focus when it opens and closes on Escape
  // wherever the focus is: opened with the mouse, the focus stayed on the
  // page behind and Escape did nothing.
  const catalogCloseRef = React.useRef(null);
  const catalogDialogRef = React.useRef(null);
  (window.ModalLayer ? window.ModalLayer.useLayer : () => {})(catalogDialogRef, showCatalog);
  const restoreInputRef = React.useRef(null);
  React.useEffect(() => {
    if (!showCatalog) return undefined;
    // The button pressed, also where Safari left the focus on <body>.
    const opener = window.PTDialog && window.PTDialog.openerNow ? window.PTDialog.openerNow() : document.activeElement;
    const t = setTimeout(() => { try { catalogCloseRef.current && catalogCloseRef.current.focus(); } catch (_) {} }, 0);
    // Tab stays inside the dialog (it is aria-modal) and the page behind
    // does not scroll: window.ModalLayer, below.
    const onKey = (e) => {
      if (e.key === 'Escape') { setShowCatalog(false); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      try { if (opener && opener.focus && document.contains(opener)) opener.focus(); } catch (_) {}
    };
  }, [showCatalog]);
  // Did the quote feed refuse the key or its limit while a request was out?
  // Neither API layer hands the status to its caller (a refused batch comes
  // back as {}), so this reads what each of them publishes: the terminal's
  // events for a rejected key and for a refused batch ('api:quotes-refused',
  // 401/402), and the standalone shell's record of the last answer per feed
  // (window.Entitlement). Anything else -- a 404, a timeout,
  // a route that is closed while the single-quote route is open -- is not a
  // refusal of the key, and the symbols are asked for one by one. So is the
  // terminal's own 429 backoff: there the single requests are not sent at
  // all and answer with the last price they had.
  const listenForQuoteRefusal = () => {
    let refused = false;
    const on = () => { refused = true; };
    const events = ['eodhd:auth-error', 'eodhd:key-revoked', 'api:quotes-refused'];
    events.forEach(n => window.addEventListener(n, on));
    return {
      stop: () => {
        events.forEach(n => window.removeEventListener(n, on));
        try {
          const E = window.Entitlement;
          if (E) {
            const p = typeof E.problem === 'function' ? E.problem() : null;
            if (p && (p.kind === 'key' || (p.kind === 'quota' && (!p.capability || p.capability === 'realtime')))) refused = true;
            const v = typeof E.get === 'function' ? E.get('realtime') : null;
            if (v && v.allowed === false) refused = true;
          }
        } catch (e) { /* no record to read: not known to be a refusal */ }
        return refused;
      },
    };
  };
  // Every wait for the portfolio's own prices -- the rates, the batch, the
  // singles after it, the end-of-day stand-ins -- ends together, at
  // PT_QUOTE_HANG_MS (8 s) after the load began. The batch request has no
  // cap of its own short enough (the shell's waits 25 s), so a feed that
  // hung kept N/A and Try again away for 25.7 s. What
  // is still out then is drawn unpriced, with Try again; an answer that
  // comes later still prices its rows, as long as no newer load took over.
  const quoteWaitMs = () => window.PT_QUOTE_HANG_MS || 8000;
  // A monotonic clock: the wall clock can be set (or held still).
  const monoNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  // { done: true, value } when `p` settles within `ms` (a rejection is the
  // value null), { done: false } when it does not.
  const within = (p, ms) => new Promise(resolve => {
    const t = setTimeout(() => resolve({ done: false }), Math.max(0, ms));
    Promise.resolve(p).then(v => { clearTimeout(t); resolve({ done: true, value: v }); }, () => { clearTimeout(t); resolve({ done: true, value: null }); });
  });
  // `kind`: 'retry' when a Try again asked (RateLimitWait.setBusy).
  const loadHoldingsPrices = async (holdingsList, kind = 'load') => {
    const seq = ++priceSeqRef.current;
    const current = () => seq === priceSeqRef.current;
    setLoading(true);
    // Every "Try again" for the prices, on whichever panel, is busy until
    // this load ends: a press then sends nothing, and now says so.
    const busyToken = RLW.setBusy('prices', kind);
    busyTokenRef.current = busyToken;
    const startedAt = monoNow();
    const left = () => quoteWaitMs() - (monoNow() - startedAt);
    const baseCurrency = activePortfolio?.baseCurrency || 'USD';
    // One store per portfolio, currency and key; another starts afresh.
    const storeKey = `${activePortfolio?.id || activePortfolioId || ''}|${baseCurrency}|${apiKey || ''}`;
    if (priceStoreRef.current.key !== storeKey) {
      priceStoreRef.current = { key: storeKey, quotes: {}, eod: {}, rates: {}, draw: null, at: null };
    }
    const store = priceStoreRef.current;
    // Until this load draws, a late answer waits in the store for it.
    store.draw = null;
    // Asked together with the quotes, not before them: both share the wait.
    const ratesAsked = Promise.resolve().then(() => loadForexRates(holdingsList, baseCurrency, current));
    const takeRates = (r) => {
      Object.entries(r || {}).forEach(([c, v]) => { if (Calc.toRate(v) != null) store.rates[c] = v; });
    };
    const rateOf = (c) => (c === baseCurrency ? 1 : store.rates[c]);
    // Answers that come after the wait, from this load or an older one of
    // the same portfolio: each prices what it can, drawn by the latest load.
    const redraw = () => {
      if (priceStoreRef.current !== store || !store.draw) return;
      store.draw();
    };
    // Set once the quotes are in (below); a late answer before then waits.
    let lateEod = () => Promise.resolve();
    const late = {
      push: (p) => p.then(() => {
        redraw();
        lateEod().then(redraw);
      }),
    };

    // Every quote in one request per fifty symbols. This fetched them one at
    // a time, in sequence: a request per holding on every load, add, edit
    // and delete, against a free tier of twenty a day. A symbol the batch does not answer for falls back to its
    // own request below.
    const quoted = store.quotes;
    const priced = (q) => asPrice(q && q.close) != null || asPrice(q && q.previousClose) != null;
    const takeQuote = (code, q) => {
      if (!q || typeof q !== 'object') return false;
      const k = String(code).toUpperCase();
      const had = quoted[k];
      // Never older than the one held, and never "NA" over a price.
      if (had) {
        const tNew = Number(q.timestamp);
        const tHad = Number(had.timestamp);
        if (Number.isFinite(tNew) && Number.isFinite(tHad) && tNew < tHad) return true;
        if (priced(had) && !priced(q)) return true;
      }
      quoted[k] = q;
      if (priced(q)) store.at = new Date();
      return true;
    };
    const quoteOf = (sym) => quoted[String(sym).toUpperCase()] || null;
    // The batch came back with nothing because the key or its limit was
    // refused -- 401, 402 for a day's allowance spent, 429 for too many
    // requests this minute: asking again symbol by symbol is the same
    // refusal five more times. Those symbols stay unpriced until the next load.
    let quotesRefused = false;
    let firstFail = null;
    const symbols = [...new Set(holdingsList.filter(h => h.symbol && h.type !== 'manual').map(h => h.symbol))];
    if (symbols.length > 1 && window.EODHD_API.getBatchRealTime) {
      for (let i = 0; i < symbols.length; i += 50) {
        let answered = 0;
        const heard = listenForQuoteRefusal();
        const asked = Promise.resolve().then(() => window.EODHD_API.getBatchRealTime(apiKey, symbols.slice(i, i + 50)));
        const got = await within(asked, left());
        if (got.done) {
          Object.entries(got.value || {}).forEach(([code, q]) => { if (takeQuote(code, q)) answered++; });
          if (!answered && got.value && got.value._failed) firstFail = firstFail || got.value._failed;
        } else {
          late.push(asked.then(batch => { Object.entries(batch || {}).forEach(([code, q]) => takeQuote(code, q)); }, () => {}));
        }
        if (heard.stop() && !answered) quotesRefused = true;
        // The batch hung: EODHD is not answering, and asking symbol by
        // symbol is the same wait once per holding -- "Loading prices"
        // stayed up 76 s for two positions and about nine minutes for twenty.
        // They are shown unpriced at once, with Try
        // again; the rest of a long list is not asked this time.
        if (!got.done) { quotesRefused = true; break; }
      }
    }
    // A newer load (another portfolio, Try again) took over while the batch
    // was out: this one asks for nothing more.
    if (!current()) return;
    // The symbols the batch left out are asked for together, not one after
    // another: each could wait its own timeout.
    if (!quotesRefused) {
      const missing = symbols.filter(sym => !quoteOf(sym));
      await Promise.all(missing.map(async sym => {
        // With its status, so a failure can be named; inside the limit's
        // wait the last price stays, as the client keeps it.
        const asked = Promise.resolve().then(() => window.EODHD_API.getRealTimeData(apiKey, sym, { throwErrors: true })).catch((e) => {
          firstFail = firstFail || e || {};
          const A = window.EODHD_API;
          return e && e.rateLimited && A && A._lastQuote && A._lastQuote.get ? (A._lastQuote.get(sym) || null) : null;
        });
        const got = await within(asked, left());
        if (got.done) takeQuote(sym, got.value);
        else late.push(asked.then(q => { takeQuote(sym, q); }, () => {}));
      }));
      if (!current()) return;
    }

    // Only when the quote came back and carried "NA" instead of numbers:
    // that is a real symbol the real-time feed has nothing for today, and
    // its last close is a fair stand-in. A symbol the feed does not know
    // at all answers nothing, and asking end-of-day about it would only
    // add a second 404 to the console.
    const lastClose = store.eod;
    const takeEod = (sym, eod) => {
      const last = Array.isArray(eod) && eod.length ? eod[eod.length - 1] : null;
      const prev = Array.isArray(eod) && eod.length > 1 ? eod[eod.length - 2] : null;
      // A failed ask keeps the close that came before, and an older day
      // never replaces a newer one.
      if (!last) return;
      const had = lastClose[sym];
      if (had && had.day && last.date && String(last.date).slice(0, 10) < had.day) return;
      store.at = new Date();
      lastClose[sym] = {
        close: last ? (asPrice(last.adjusted_close) ?? asPrice(last.close)) : null,
        previousClose: prev ? (asPrice(prev.adjusted_close) ?? asPrice(prev.close)) : null,
        // The day this stand-in price is from, for "bought since then".
        day: last && last.date ? String(last.date).slice(0, 10) : null,
      };
    };
    const askEod = (sym) => {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
      return Promise.resolve().then(() => window.EODHD_API.getHistoricalData(apiKey, sym, from, to));
    };
    const quotedNA = (sym) => { const q = quoteOf(sym); return !!q && asPrice(q.close) == null && asPrice(q.previousClose) == null; };
    // A quote that came after the wait with "NA" in it gets its stand-in
    // close then: it is a late answer like any other.
    const eodAsked = new Set();
    lateEod = () => Promise.all(symbols.filter(sym => quotedNA(sym) && !eodAsked.has(sym))
      .map(sym => { eodAsked.add(sym); return askEod(sym).then(eod => { takeEod(sym, eod); }, () => {}); }));
    const needsEod = symbols.filter(quotedNA);
    needsEod.forEach(sym => eodAsked.add(sym));
    await Promise.all(needsEod.map(async sym => {
      const asked = askEod(sym);
      const got = await within(asked, left());
      if (got.done) takeEod(sym, got.value);
      else late.push(asked.then(eod => { takeEod(sym, eod); }, () => {}));
    }));
    if (!current()) return;

    const gotRates = await within(ratesAsked, left());
    if (gotRates.done) takeRates(gotRates.value);
    else late.push(ratesAsked.then(takeRates, () => {}));
    if (!current()) return;

    // The figures from what has come back so far: drawn now, and again as
    // each late answer lands.
    const build = () => {
      const data = {};
      for (const holding of holdingsList) {
        const holdingCurrency = holding.currency || 'USD';
        // No `|| 1`: a currency with no rate is unvalued, not valued at parity
        // (100 VOD.LSE in pence read as $12,390).
        const exchangeRate = holdingCurrency === baseCurrency ? 1 : Calc.toRate(rateOf(holdingCurrency));

        if (exchangeRate == null) {
          const transactions = Storage.getTransactionsByHolding(holding.id);
          const basis = Calc.getCostBasisWithFX(transactions);
          data[holding.id] = {
            priceUnavailable: true, fxUnavailable: true,
            quantity: Calc.getHoldingQuantity(transactions),
            avgCostPerShare: basis.avgCostPerShare,
            avgCostPerShareInAsset: basis.avgCostPerShareInAsset,
            totalCost: basis.totalCostInBase,
            currentPrice: null, currentValue: null, pnl: null, pnlPercent: null,
            close: null, previousClose: null, currency: holdingCurrency, exchangeRate: null,
          };
          continue;
        }

        if (holding.symbol && holding.type !== 'manual') {
          const transactions = Storage.getTransactionsByHolding(holding.id);
          const priceData = quoteOf(holding.symbol);
          let close = asPrice(priceData && priceData.close);
          let previousClose = asPrice(priceData && priceData.previousClose);
          let fallbackDay = null;
          const eod = close == null && previousClose == null ? lastClose[holding.symbol] : null;
          if (eod) { close = eod.close; previousClose = eod.previousClose; fallbackDay = eod.day; }
          const price = close ?? previousClose;
          if (price != null) {
            const holdingCalc = Calc.getHoldingPnL(holding, transactions, price, exchangeRate);
            // The day's move is known only from a close and the close before it.
            // A quote with no close (0, "NA") stands in with the previous close,
            // which made DAY P&L a confident $0.00.
            const dayKnown = close != null && previousClose != null;
            // Bought on the day of this quote (or after it, before the next
            // session): the day's move of those shares starts at the purchase.
            const ts = Number(priceData && priceData.timestamp);
            const quoteDay = fallbackDay || (Number.isFinite(ts) && ts > 0
              ? new Date(ts < 4e10 ? ts * 1000 : ts).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10));
            const dayBought = Calc.getDayBought(transactions, quoteDay);
            data[holding.id] = { ...(priceData || {}), ...holdingCalc, close, previousClose, dayKnown, dayBought, currency: holdingCurrency, exchangeRate };
          } else {
            // Unpriced, not worthless: quantity and cost are known, value is
            // not. The totals leave it out and say so, instead of booking it
            // as a 100% loss.
            const basis = Calc.getCostBasisWithFX(transactions);
            data[holding.id] = {
              priceUnavailable: true,
              quantity: Calc.getHoldingQuantity(transactions),
              avgCostPerShare: basis.avgCostPerShare,
              avgCostPerShareInAsset: basis.avgCostPerShareInAsset,
              totalCost: basis.totalCostInBase,
              currentPrice: null, currentValue: null, pnl: null, pnlPercent: null,
              close: null, previousClose: null, currency: holdingCurrency, exchangeRate,
            };
          }
        } else if (holding.type === 'manual') {
          const transactions = Storage.getTransactionsByHolding(holding.id);
          const holdingCalc = Calc.getHoldingPnL(holding, transactions, holding.manualPrice || 0, exchangeRate);
          data[holding.id] = { ...holdingCalc, currency: holdingCurrency, exchangeRate };
        }
      }
      // Every figure above is in the portfolio's currency; say which, for the
      // AI prompt and anything else that reads holdingsData on its own.
      Object.values(data).forEach(d => { d.baseCurrency = baseCurrency; });
      return data;
    };
    const draw = () => {
      const data = build();
      setHoldingsData(data);
      // "Prices as of 12:03" over a list where no quote came back claimed a
      // price that was never had.
      // When the newest price came, not when this load ended.
      setPricesUpdatedAt(Object.values(data).some(d => !d.priceUnavailable) ? (store.at || new Date()) : null);
    };
    store.draw = draw;
    draw();
    setPricesFail(firstFail ? RLW.failure(firstFail) : null);
    setLoading(false);
    RLW.endBusy('prices', busyToken);
  };

  // Prices on the AI buttons, from the price list the server charges by. Six
  // of them spent tokens and none said so; "Refresh" did not even look like
  // a paid action. Quick insights and the quick actions
  // below are a portfolio question (portfolio_qa), the deep analysis is
  // portfolio_detail.
  const useFeatureCost = (() => null);
  const qaCost = useFeatureCost('portfolio_qa');
  const detailCost = useFeatureCost('portfolio_detail');
  // AI Insights — triggered by button or auto-trigger
  //
  // `deep`: "Run a detailed AI review" asks for the detailed analysis. It called
  // the 2-3 line quick insights, and any failure read "disabled in Settings →
  // AI" -- a section the app does not have -- whatever the real cause was.
  // The provider's own message is shown.
  // `auto`: the once-a-day run on opening Portfolio (only when the user turned
  // Auto Insights on). It stays quiet when tokens are out: no top-up popup
  // over the page for something the user did not press.
  const fetchAIInsights = React.useCallback((deep, { auto = false } = {}) => {
    if (insightsInFlightRef.current) return;
    const wantDeep = deep === true;
    if (!holdings.length || !Object.keys(holdingsData).length) {
      setInsightsError('Add positions and wait for prices to load before running analysis.');
      return;
    }
    const aiService = window.AIService;
    if (!aiService) {
      setInsightsError('AI service is not available right now.');
      return;
    }
    insightsInFlightRef.current = true;
    setInsightsLoading(true);
    setInsightsError('');
    const ask = wantDeep && aiService.getDetailedAnalysis
      ? aiService.getDetailedAnalysis(holdings, holdingsData)
      : aiService.getQuickInsights(holdings, holdingsData, { manual: !auto });
    Promise.resolve(ask)
      .then(result => {
        if (result) {
          setAutoInsights(result);
          setInsightsError('');
        } else {
          // Quick insights answer null when automatic insights are switched
          // off; otherwise an empty answer is the model's.
          const s = aiService.getSettings ? aiService.getSettings() : null;
          setInsightsError(s && s.features && s.features.autoInsights === false && !wantDeep
            ? 'Automatic AI insights are switched off. Use "Run a detailed AI review" instead.'
            : 'The model returned nothing. Please retry.');
        }
      })
      .catch(err => {
        if (err && err.message === 'AI_TOKENS_REQUIRED') {
          if (auto) return;
          setInsightsError('AI analysis is off. Add OPENAI_API_KEY to .env and restart to enable it.');
        } else if (auto) {
          return;
        } else {
          setInsightsError(`Analysis failed: ${err?.message || 'unknown error'}. Please retry.`);
        }
      })
      .finally(() => {
        insightsInFlightRef.current = false;
        setInsightsLoading(false);
      });
  }, [holdings, holdingsData]);

  // Auto-trigger AI Insights once per day if setting enabled
  React.useEffect(() => {
    if (!holdings.length || !Object.keys(holdingsData).length) return;
    const aiService = window.AIService;
    if (!aiService) return;
    const settings = aiService.getSettings?.();
    if (!settings?.features?.autoInsights) return;
    const today = window.CalendarDate.today();
    const lastDate = localStorage.getItem('eodhd_auto_insights_date');
    if (lastDate === today) return;
    localStorage.setItem('eodhd_auto_insights_date', today);
    fetchAIInsights(false, { auto: true });
  }, [holdings, holdingsData, fetchAIInsights]);

  const activePortfolio = portfolios.find(p => p.id === activePortfolioId);
  const holdingsWithData = holdings.map(h => ({ ...h, ...(holdingsData[h.id] || {}) }));
  // Quotes are on their way for a position nothing is known about yet: the
  // portfolio just opened, or the position was just added. The views below
  // say "loading" for that time instead of drawing it as empty or as zero --
  // "No holdings yet", Health 50, dividends 0.00.
  const pricesPending = loading && holdings.some(h => !holdingsData[h.id]);
  // A money figure on one line, `max` px tall where its tile is wide enough
  // and smaller where it is not: the font follows the width of the box
  // around it (a size container), divided by the characters to set. Roboto
  // Mono is 0.6 em a character; 0.62 leaves a little air. It never breaks
  // inside the number -- "$3,052,406.0" / "0" was what wrapping gave.
  const fitFigure = (text, max) => ({ whiteSpace: 'nowrap', fontSize: `min(${max}px, calc(100cqw / ${(Math.max(String(text).length, 1) * 0.62).toFixed(2)}))` });
  // "Try again" beside a "needs current prices" message: the quotes are
  // asked for once more (one batch request; a refusal is not followed by
  // singles, and the 429 backoff is left to run). Nothing on the page did
  // this -- only a reload or another portfolio.
  // When the retry works its button is gone, and the focus with it. So the
  // section the button stood in is remembered (the nearest box with a
  // heading, or one marked data-retry-scope), and once the quotes are in and
  // the focus has fallen to <body>, it is put on that section's heading (or
  // the part marked data-retry-focus): the next Tab continues from there.
  const retryScopeRef = React.useRef(null);
  // Inside a 429 wait a Try again sends nothing and says so, as every
  // screen does (RateLimitWait). The buttons count
  // the wait down and the line beside them names the limit; it said "No
  // prices came back. Try again" with no number.
  const RLW = window.RateLimitWait;
  const rlWait = RLW.useWait();
  const retryPrices = (e) => {
    if (loading) return;
    if (rlWait.hold()) return;
    try {
      let scope = null;
      const from = e && e.currentTarget && e.currentTarget.nodeType === 1 ? e.currentTarget : null;
      for (let n = from && from.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.hasAttribute('data-retry-scope') || n.querySelector('h1, h2, h3, h4')) { scope = n; break; }
      }
      retryScopeRef.current = scope;
    } catch (_) { retryScopeRef.current = null; }
    loadHoldingsPrices(holdings, 'retry');
  };
  // A load cut short by leaving the portfolio leaves no button busy.
  React.useEffect(() => () => RLW.endBusy('prices', busyTokenRef.current), []);
  // A Try again on this page stays up, busy, while the reload it asked for
  // runs. It was taken off for that time, and the focus fell to <body>.
  const retrying = loading && RLW.busyOf('prices') === 'retry';
  React.useEffect(() => {
    if (loading || !retryScopeRef.current) return;
    const scope = retryScopeRef.current;
    retryScopeRef.current = null;
    // The section redraws a moment after the quotes land (its own loader
    // runs then), so the button may go a few frames later: look for a short
    // while, and stop as soon as the focus is somewhere on purpose.
    let tries = 0;
    const timer = setInterval(() => {
      try {
        const active = document.activeElement;
        const lost = !active || active === document.body || !document.contains(active);
        if (lost && document.contains(scope)) {
          // Refused again: the button is back (it is unmounted while the
          // quotes load), and that is where the reader was.
          const again = [...scope.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
          const target = again || scope.querySelector('[data-retry-focus]') || scope.querySelector('h1, h2, h3, h4') || scope;
          if (target !== again && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus();
          clearInterval(timer);
        } else if (++tries >= 20 || (active && active.textContent !== 'Try again')) clearInterval(timer);
      } catch (_) { clearInterval(timer); }
    }, 100);
    return () => clearInterval(timer);
  }, [loading]);
  // A position without a price has no value and no P&L. Left in, its cost
  // counted against a value of zero and the portfolio read -100% on it.
  const pricedHoldings = holdingsWithData.filter(h => !h.priceUnavailable);
  // Unpriced and still held. A position sold to zero has a known value -- 0 --
  // whatever the quote says; it made TOTAL VALUE "N/A · 1 unpriced" on a book
  // with no shares.
  const openUnpriced = holdingsWithData.filter(h => h.priceUnavailable && Number(h.quantity) > 0);
  const unpricedCount = openUnpriced.length;
  // A template's target weight travels in the position's note ("target
  // weight: 30%"), put there when the template was adopted.
  const targetOf = (h) => { const m = String(h && h.notes || '').match(/target weight:\s*([\d.]+)%/i); const v = m ? parseFloat(m[1]) : NaN; return Number.isFinite(v) ? v : null; };
  const hasTargets = holdingsWithData.some(h => targetOf(h) != null);
  // Nothing priced (a refused or exhausted key, an outage) is not a value of
  // zero: TOTAL VALUE and DAY P&L read $0.00 over a panel saying the prices
  // were refused.
  const noneValued = openUnpriced.length > 0 && !pricedHoldings.some(h => Number(h.quantity) > 0);
  // The limit is named only when it is why the prices are missing: a wait
  // another request started later leaves "No prices came back." as it was.
  const pricesLimited = RLW.useCause(!loading && unpricedCount > 0 ? holdingsData : null);
  // The reason, when the failure is known and it was not the limit.
  // Named as the other screens name them: EODHD's error (5xx), a dropped
  // connection (0), an answer that could not be read. A 404 is a code the
  // feed does not know, and a refusal of the key or plan is said by its own
  // panel: left as before.
  const pricesWhy = !pricesLimited && pricesFail && !pricesFail.limited
    && (pricesFail.unreadable || pricesFail.status >= 500 || pricesFail.status === 0) ? RLW.failReason(pricesFail) : null;
  const noPricesWords = pricesLimited ? 'No prices came back: ' + RLW.REACHED : pricesWhy ? 'No prices came back: ' + pricesWhy : 'No prices came back.';
  const totalValue = Calc.getTotalValue(pricedHoldings);
  const totalCost = Calc.getTotalCost(pricedHoldings);
  const { pnl, pnlPercent } = Calc.getTotalPnL(pricedHoldings);
  const dayInfo = Calc.getDayChangeInfo(pricedHoldings);
  const dayChange = dayInfo.change;
  // Not one day figure came back: N/A, not $0.00 / 0.00 %.
  const dayUnknown = noneValued || (dayInfo.known === 0 && dayInfo.unknown > 0);
  const goalProgress = activePortfolio?.goal ? Calc.getGoalProgress(totalValue, activePortfolio.goal) : null;

  const allTransactions = activePortfolioId ? Storage.getTransactionsByPortfolio(activePortfolioId) : [];
  const realizedPnL = Calc.getRealizedPnL(allTransactions);
  // pnl is measured on the open lots alone, so it is the unrealized figure as
  // it stands. It used to have the realized gain subtracted from it -- a
  // leftover from when cost basis still counted the shares already sold.
  const unrealizedPnL = pnl;
  // Total return is what the money made, open and closed, against everything
  // paid in. Against the open cost alone the percentage would climb every
  // time a position was closed, since its cost would leave the denominator
  // and its profit would stay in the numerator.
  //
  // A holding with shares and no price is left out of every part of it --
  // its purchases too, or it counted as a -100% position.
  const returnInfo = Calc.getTotalReturn(holdingsWithData, allTransactions);
  const totalReturn = returnInfo.totalReturn;
  const totalReturnPercent = returnInfo.percent;
  const totalReturnSub = (totalReturnPercent == null ? 'n/a' : (totalReturnPercent > 0 ? '+' : '') + totalReturnPercent.toFixed(2) + '%')
    + (returnInfo.excluded ? ` · excl. ${returnInfo.excluded} unpriced` : '');
  // Money-weighted annual return (IRR), for Macro: it is compared with
  // annual inflation and yields, and a simple total over every dollar paid in
  // understated a portfolio funded in stages.
  const moneyWeighted = Calc.getMoneyWeightedReturn(holdingsWithData, allTransactions, Calc.todayISO(), 90);
  const dividendIncome = Calc.getDividendIncome(allTransactions);
  const pricePnL = Calc.getTotalPricePnL(holdingsWithData);
  const currencyPnL = Calc.getTotalCurrencyPnL(holdingsWithData);
  const currencyAllocation = Calc.getAllocationByCurrency(holdingsWithData);

  // A name over the limit is said, not cut: 300 characters were silently
  // trimmed to 60.
  const handleCreatePortfolio = (name, baseCurrency) => {
    const clean = String(name || '').trim();
    if (!clean) { setNewPortfolioNote('Enter a name.'); return; }
    if (clean.length > Storage.NAME_MAX) { setNewPortfolioNote(`Keep it to ${Storage.NAME_MAX} characters — this one has ${clean.length}.`); return; }
    const same = portfolioNamed(clean);
    if (same) { setNewPortfolioNote(`A portfolio called "${same.name}" already exists. Pick another name.`); return; }
    setNewPortfolioNote('');
    const newPortfolio = Storage.attempt(() => Storage.createPortfolio({ name: clean, baseCurrency }), setNewPortfolioNote);
    if (!newPortfolio) return;
    loadData();
    setActivePortfolioId(newPortfolio.id);
    setShowAddPortfolio(false);
  };

  const handleDeletePortfolio = (id) => {
    // Counted in storage, not in this tab's list: a second tab still listing
    // a portfolio deleted elsewhere deleted the last one.
    const stored = Storage.getPortfolios();
    // Said in the page, not with alert().
    const refuse = (title, text) => { loadData(); askConfirm({ label: title, title, text, infoOnly: true, confirmLabel: 'OK', onConfirm: () => {} }); };
    if (!stored.some(p => p.id === id)) { refuse('Already deleted', 'This portfolio was already deleted (perhaps in another tab).'); return; }
    if (stored.length <= 1) { refuse('The last portfolio stays', 'The last portfolio cannot be deleted. Create another one first.'); return; }
    const target = stored.find(p => p.id === id);
    const n = Storage.getHoldingsByPortfolio(id).length;
    askConfirm({
      label: 'Delete portfolio',
      title: `Delete "${target.name}"?`,
      text: n
        ? `Its ${n} ${n === 1 ? 'position' : 'positions'} and all their transactions are deleted too. This cannot be undone.`
        : 'It has no positions. This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        Storage.deletePortfolio(id);
        loadData();
        if (activePortfolioId === id) {
          const remaining = Storage.getPortfolios();
          setActivePortfolioId(remaining[0]?.id || null);
        }
      },
      // The delete button may be gone (one portfolio left): the picker.
      // "Active portfolio: <name>" since 22.10.
      restore: () => document.querySelector('button[aria-label="Active portfolio"], button[aria-label^="Active portfolio: "]'),
    });
  };

  // XP for a position the account has: at once for a stored save; for one
  // still syncing (no answer, a 5xx) when its sections are stored. It was
  // given while the account had not taken the save. The
  // owed XP is kept on the device, so a reload before the sync lands does not
  // lose it.
  const XP_OWED_KEY = 'eodhd_pt_xp_owed';
  const settleOwedXP = () => {
    const DS = window.DataSync;
    if (DS && DS.isPending && DS.isPending(PT_SECTIONS)) return;
    let owed = 0;
    try { owed = Number(localStorage.getItem(XP_OWED_KEY)) || 0; localStorage.removeItem(XP_OWED_KEY); } catch (_) { return; }
    if (owed > 0) Storage.addXP(owed);
  };
  const awardWhenSynced = (amount) => {
    const DS = window.DataSync;
    if (!DS || !DS.isPending || !DS.isPending(PT_SECTIONS)) { Storage.addXP(amount); return; }
    try { localStorage.setItem(XP_OWED_KEY, String((Number(localStorage.getItem(XP_OWED_KEY)) || 0) + amount)); } catch (_) { /* no storage: no XP */ }
  };
  React.useEffect(() => {
    settleOwedXP();
    window.addEventListener('datasync:pushed', settleOwedXP);
    window.addEventListener('datasync:synced', settleOwedXP);
    return () => {
      window.removeEventListener('datasync:pushed', settleOwedXP);
      window.removeEventListener('datasync:synced', settleOwedXP);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePositionAdded = (savedTo) => {
    addSavedRef.current = true;
    if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_manage', { action: 'add' });
    setShowAddPosition(false);
    // Saved: the asset page's symbol is spent, or the next "+ Add Position"
    // opened with it filled in.
    setPrefillSymbol(null);
    // Sent to another portfolio by the person's own choice in the form: show
    // that one, where the position now is. Otherwise the open one stays.
    if (savedTo && savedTo !== activePortfolioId && Storage.getPortfolios().some(p => p.id === savedTo)) {
      setActivePortfolioId(savedTo);
      return;
    }
    const portfolioHoldings = Storage.getHoldingsByPortfolio(activePortfolioId);
    setHoldings(portfolioHoldings);
    loadHoldingsPrices(portfolioHoldings);
    if (settings?.gamificationEnabled) awardWhenSynced(10);
  };

  // After a CSV import: reload, and say what was left out and why (a row
  // with no FX rate, or a sale of more than was held) instead of a bare count.
  const handleImported = (count, skipped, notes) => {
    setShowImportCSV(false);
    const ph = Storage.getHoldingsByPortfolio(activePortfolioId);
    setHoldings(ph);
    loadHoldingsPrices(ph);
    // In the page, not a browser alert().
    setImportReport({
      count,
      skipped: Array.isArray(skipped) ? skipped : [],
      notes: Array.isArray(notes) ? notes : [],
    });
  };

  const handleDeleteHolding = (holdingId) => {
    const h = holdings.find(x => x.id === holdingId);
    const label = h ? (h.type === 'manual' ? h.name : String(h.symbol || '').split('.')[0]) : 'this position';
    const order = window.PTEditOrder();
    askConfirm({
      label: 'Delete position',
      title: `Delete ${label}?`,
      text: 'All transactions for this position are deleted too. This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: () => {
        if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_manage', { action: 'delete' });
        Storage.deleteHolding(holdingId);
        const portfolioHoldings = Storage.getHoldingsByPortfolio(activePortfolioId);
        setHoldings(portfolioHoldings);
        loadHoldingsPrices(portfolioHoldings);
      },
      restore: () => window.PTAfterDeleteFocus(holdingId, order),
    });
  };

  const confirmDialog = confirmAsk && (
    <div style={styles.modalOverlay}>
      <window.PTDialog.Frame
        onClose={() => setConfirmAsk(null)}
        label={confirmAsk.label}
        // Done: where restore() says. Cancelled: back to the button that
        // asked, or -- asked from Settings, now closed -- where restore() says.
        restoreFocus={(opener) => ((confirmDoneRef.current || !opener || !document.contains(opener)) && confirmAsk.restore ? confirmAsk.restore() : null)}
        style={{ ...styles.modalContent, background: isDark ? '#15140F' : '#ffffff', backdropFilter: 'none', WebkitBackdropFilter: 'none', color: isDark ? C3.textDark : C3.textLightTheme, boxSizing: 'border-box' }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 10px' }}>{confirmAsk.title}</h3>
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 20px', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{confirmAsk.text}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {!confirmAsk.infoOnly && <button type="button" onClick={() => setConfirmAsk(null)} style={{ ...styles.button, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: isDark ? C3.textDark : C3.textLightTheme }}>Cancel</button>}
          <button type="button" onClick={() => { const ask = confirmAsk; confirmDoneRef.current = !ask.infoOnly; ask.onConfirm(); setConfirmAsk(null); }} style={{ ...styles.button, background: confirmAsk.infoOnly ? '#c2410c' : '#dc2626', color: '#ffffff' }}>{confirmAsk.confirmLabel || 'OK'}</button>
        </div>
      </window.PTDialog.Frame>
    </div>
  );

  if (showOnboarding && window.APP_PLATFORM !== 'WEB') {
    return React.createElement(window.OnboardingFlow, {
      onComplete: (portfolio) => {
        setShowOnboarding(false);
        loadData();
        setSettings(Storage.getSettings());
        if (portfolio) setActivePortfolioId(portfolio.id);
      },
      theme
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  WEB DESKTOP LAYOUT — Holdings table + summary cards + tabs
  // ═══════════════════════════════════════════════════════════
  const isWebPlatform = window.APP_PLATFORM === 'WEB';

  if (isWebPlatform) {

    const webSummaryCards = [
      { label: 'Total Value', value: noneValued ? 'N/A' : Calc.formatCurrency(totalValue, activePortfolio?.baseCurrency), sub: `${holdings.length} position${holdings.length === 1 ? '' : 's'}` + (unpricedCount ? `, ${unpricedCount} unpriced` : ''), type: 'brand' },
      { label: 'Day P&L', value: dayUnknown ? 'N/A' : (dayChange > 0 ? '+' : '') + Calc.formatCurrency(dayChange, activePortfolio?.baseCurrency), sub: noneValued ? 'no prices' : dayUnknown ? 'no day change yet' : (totalValue ? ((dayChange / (totalValue - dayChange) * 100).toFixed(2) + '%') + (dayInfo.unknown ? ` · excl. ${dayInfo.unknown}` : '') : ''), type: dayUnknown ? 'neutral' : signType(dayChange) },
      // With no position priced, what the open shares made is unknown; the
      // two cards read $0.00 beside N/A ones.
      { label: returnInfo.dividends ? 'Total Return (incl. div.)' : 'Total Return', value: noneValued ? 'N/A' : (totalReturn > 0 ? '+' : '') + Calc.formatCurrency(totalReturn, activePortfolio?.baseCurrency), sub: noneValued ? 'no prices' : totalReturnSub, type: noneValued ? 'neutral' : signType(totalReturn) },
      { label: 'Unrealized', value: noneValued ? 'N/A' : (unrealizedPnL > 0 ? '+' : '') + Calc.formatCurrency(unrealizedPnL, activePortfolio?.baseCurrency), sub: noneValued ? 'no prices' : 'open positions', type: noneValued ? 'neutral' : signType(unrealizedPnL) },
      { label: 'Realized', value: (realizedPnL > 0 ? '+' : '') + Calc.formatCurrency(realizedPnL, activePortfolio?.baseCurrency), sub: 'closed trades', type: signType(realizedPnL) },
    ];

    const webTabs = [
      { id: 'overview', label: 'Overview' },
      ...(window.AIService && window.AIService.getSettings().enabled ? [{ id: 'ai', label: 'AI' }] : []),
      { id: 'performance', label: 'Performance' },
      { id: 'research', label: 'Research' },
      { id: 'tax', label: 'Tax' },
      { id: 'macro', label: 'Macro' },
    ];

    const handleWebTab = (tabId) => { if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_tab', { tab: tabId }); if (tabId === 'research') window._researchInitialTab = null; setWebTab(tabId); };

    // 'neutral' is a zero: no colour claim either way.
    const borderColor = (type) => type === 'positive' ? '#22c55e' : type === 'negative' ? '#ef4444' : type === 'neutral' ? (isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)') : '#f97316';
    // C3 is the theme's ink (Calc.themeInk): #22c55e on white was 2.3:1.
    const valueColor = (type) => type === 'positive' ? C3.success : type === 'negative' ? C3.error : (isDark ? '#ffffff' : '#1e1b4b');
    const tc = isDark ? '#E9E6DF' : '#1e1b4b'; // text color
    const tm = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.62)'; // muted: 0.62 clears 4.5:1 on white
    const bg2 = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'; // card bg
    const bd = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; // border
    const ibg = isDark ? 'rgba(255,255,255,0.04)' : '#fff'; // input bg
    const ibd = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)'; // input border
    // Symbol column pinned while the 1,100 px positions table scrolls: at
    // 390 px every P&L column was off-screen next to rows with no symbol in
    // view. Opaque, so scrolled cells pass under it.
    const stickyKey = { position: 'sticky', left: 0, zIndex: 1, background: isDark ? '#1C1A14' : '#ffffff' };

    return (
      <div className="pt-fields" style={{ color: tc, fontFamily: "'Sora', sans-serif" }}>
        {window.PTFieldFocus && window.PTFieldFocus(isDark)}
        {/* Header */}
        <div style={{ padding: '20px 0', borderBottom: `1px solid ${bd}` }}>
          {/* Both rows wrap: on a 320-414px phone "Templates & Funds" and the
              new-portfolio "+" sat past the edge, unreachable by touch. */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', minWidth: 0 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Portfolio</h1>
              {syncNote}
              {window.HelpTooltip && <HelpTooltip title="Portfolio Tracker" text="Track your holdings, monitor performance, analyze allocation, and ask AI for rebalancing and tax suggestions." isDark={isDark} />}
              {/* Replaced native <select> with PortalDropdown — native picker on Android
                  Chrome / Telegram in-app browser positions OS-controlled, looks detached
                  from trigger (single-option pill mid-page). PortalDropdown anchors via
                  getBoundingClientRect to document.body portal. */}
              {React.createElement(window.PortalDropdown, {
                value: activePortfolioId || '',
                options: portfolios.map(p => ({ value: p.id, label: p.name })),
                onChange: (v) => setActivePortfolioId(v),
                isDark,
                placeholder: 'Select portfolio',
                minWidth: 160, maxWidth: 260,
                ariaLabel: 'Active portfolio',
              })}
              {/* The handler asks for confirmation itself; asking here as well
                  showed the same question twice in a row. */}
              {portfolios.length > 1 && (
                <button onClick={() => handleDeletePortfolio(activePortfolioId)} title="Delete portfolio" style={{ background: 'none', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4, color: acc('#ef4444'), cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', ...tap40 }}>
                  {React.createElement(Icon, { name: 'trash', size: 14, color: acc('#ef4444') })}
                </button>
              )}
              <button onClick={() => setShowAddPortfolio(true)} title="New portfolio" style={{ background: 'none', border: `1px solid ${bd}`, borderRadius: 4, color: tm, cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', ...tap40 }}>
                {React.createElement(Icon, { name: 'plus', size: 14, color: tm })}
              </button>
              {/* The settings dialog (rename, backup, restore) had no way in on
                  the web; only the mobile layout opened it. */}
              <button onClick={() => setShowSettings(true)} title="Portfolio settings and backup" aria-label="Portfolio settings and backup" style={{ background: 'none', border: `1px solid ${bd}`, borderRadius: 4, color: tm, cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center', ...tap40 }}>
                {React.createElement(Icon, { name: 'settings', size: 14, color: tm })}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
              <button onClick={() => setShowAddPosition(true)} style={{ background: C3.logoGradient, border: 'none', color: 'white', padding: '8px 16px', fontSize: 12, fontFamily: "'Sora', sans-serif", fontWeight: 600, borderRadius: 4, cursor: 'pointer' }}>+ Add Position</button>
              <button onClick={() => setShowImportCSV(true)} style={{ background: ibg, border: `1px solid ${bd}`, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', padding: '8px 16px', fontSize: 12, fontFamily: "'Sora', sans-serif", fontWeight: 600, borderRadius: 4, cursor: 'pointer' }}>Import CSV</button>
              {/* Every transaction in the portfolio, and the form that adds
                  the four types the position dialog does not cover. */}
              <button onClick={() => { setSelectedHolding(null); setShowTransactionHistory(true); }} style={{ background: ibg, border: `1px solid ${bd}`, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', padding: '8px 16px', fontSize: 12, fontFamily: "'Sora', sans-serif", fontWeight: 600, borderRadius: 4, cursor: 'pointer' }}>Transactions</button>
              {window.PortfolioCatalogView && (
                <button onClick={() => setShowCatalog(true)} title="Start a portfolio from a template or a real fund's current holdings" style={{ background: ibg, border: `1px solid ${bd}`, color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)', padding: '8px 16px', fontSize: 12, fontFamily: "'Sora', sans-serif", fontWeight: 600, borderRadius: 4, cursor: 'pointer' }}>Templates & Funds</button>
              )}
            </div>
          </div>

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {webSummaryCards.map((card, i) => (
              <div key={i} style={{
                background: bg2, border: `1px solid ${bd}`,
                borderRadius: 4, padding: '16px 18px',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)', marginBottom: 6 }}>{card.label}</div>
                {/* The figure stays on one line and is set as small as its tile
                    needs (see fitFigure): it ran over the next tile, then broke
                    inside the number, and at 320 px the right-hand tiles were
                    cut at the screen edge. */}
                <div style={{ containerType: 'inline-size' }}>
                  <div style={{ fontFamily: "'Roboto Mono', monospace", ...fitFigure(loading ? '...' : card.value, 20), fontWeight: 500, lineHeight: 1.1, color: valueColor(card.type) }}>{loading ? '...' : card.value}</div>
                </div>
                <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 11, marginTop: 4, color: card.type === 'brand' ? (isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)') : valueColor(card.type) }}>{loading ? '' : card.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        {/* Tab semantics and arrow keys; the active tab was colour-only, and
            orange text on white is 2.8:1. */}
        <div role="tablist" aria-label="Portfolio sections" onKeyDown={(e) => {
          // Home and End too: first and last tab.
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
          const i = webTabs.findIndex(t => t.id === webTab);
          const next = e.key === 'Home' ? webTabs[0] : e.key === 'End' ? webTabs[webTabs.length - 1]
            : webTabs[(i + (e.key === 'ArrowRight' ? 1 : webTabs.length - 1)) % webTabs.length];
          if (!next) return;
          e.preventDefault();
          handleWebTab(next.id);
          const btn = e.currentTarget.querySelector('[data-tab="' + next.id + '"]');
          if (btn) btn.focus();
        }} className="mi-tabbar" style={{ margin: '0 0 16px' }}>
          {/* The web's one tab look (the terminal's stylesheet .mi-tabbar, design stage 2):
              full ink and the accent underline on the open tab. */}
          {webTabs.map(t => (
            <button key={t.id} type="button" className="mi-tab" role="tab" data-tab={t.id} aria-selected={webTab === t.id} tabIndex={webTab === t.id ? 0 : -1} onClick={() => handleWebTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {/* The open section's name as the level-2 heading: the page went from
            its H1 straight to the sections' H3s. The
            tab above says it on screen. */}
        <h2 data-pt-section-heading="true" style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>{(webTabs.find(t => t.id === webTab) || webTabs[0]).label}</h2>

        {/* Holdings Table */}
        {webTab === 'overview' && (<>
          {/* Widget config bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 12, gap: 8 }}>
            {/* Light theme: white-at-40% text was invisible (1.04:1). */}
            <button data-hit="" ref={customizeRef} aria-expanded={showWidgetPicker} onClick={() => setShowWidgetPicker(!showWidgetPicker)} style={{ padding: '4px 12px', borderRadius: 4, border: `1px solid ${bd}`, background: showWidgetPicker ? 'rgba(249,115,22,0.1)' : (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'), color: showWidgetPicker ? (isDark ? '#f97316' : '#c2410c') : (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)'), fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>
              {React.createElement(window.Icon || 'span', { name: 'settings', size: 12 })} Customize
            </button>
          </div>
          {showWidgetPicker && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${bd}`, borderRadius: 4, padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {OVERVIEW_WIDGETS.map(w => {
                const active = overviewWidgets.includes(w.id);
                return (
                  <button key={w.id} aria-pressed={active} onClick={() => {
                    const next = active ? overviewWidgets.filter(x => x !== w.id) : [...overviewWidgets, w.id];
                    setOverviewWidgets(next);
                    localStorage.setItem('eodhd_overview_widgets', JSON.stringify(next));
                  }} style={{
                    padding: '5px 12px', borderRadius: 3, border: `1px solid ${bd}`,
                    background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                    color: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)',
                    ...window.ToggleStyle.value(active, isDark, { bordered: true }),
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif",
                  }}>{active ? '✓ ' : ''}{w.label}</button>
                );
              })}
            </div>
          )}

          {/* None chosen in Customize: said, with the way back. The page
              was blank under Customize and read as lost positions. */}
          {overviewWidgets.length === 0 && (
            <div data-pt-no-widgets="" role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '16px', border: `1px dashed ${bd}`, borderRadius: 4, color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.7)', fontSize: 13 }}>
              <span>No widgets are shown on Overview. Your positions are still here.</span>
              <button type="button" onClick={() => { setShowWidgetPicker(true); try { customizeRef.current && customizeRef.current.focus(); } catch (_) {} }} style={{ padding: '8px 14px', minHeight: 32, borderRadius: 4, border: `1px solid ${isDark ? 'rgba(249,115,22,0.5)' : 'rgba(194,65,12,0.5)'}`, background: 'rgba(249,115,22,0.1)', color: isDark ? '#f97316' : '#c2410c', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>Open Customize</button>
            </div>
          )}

          {/* Positions widget */}
          {overviewWidgets.includes('positions') && (
          <div data-retry-scope="" style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${bd}`, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Positions</div>
              <div style={{ fontSize: 11, color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)' }}>{holdings.length} holding{holdings.length === 1 ? '' : 's'}</div>
            </div>
            {/* Empty portfolio: the message sits OUTSIDE the 1,100 px table.
                Inside it, centred across twelve columns, it landed off-screen
                on a phone and the card read as blank. */}
            {holdings.length === 0 && !loading ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: ink(0.55), fontFamily: "'Sora', sans-serif", fontSize: 13, lineHeight: 1.5 }}>
                No positions yet. Use "+ Add Position" to start tracking, or import a CSV from your broker.
              </div>
            ) : (
            <div data-retry-focus="" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }} tabIndex={0} role="region" aria-label="Positions (scrolls sideways)">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr>
                    {['Symbol', 'Name', 'Shares', 'Avg Cost', 'Last Price', 'Day Chg', 'Day P&L', 'Total P&L', 'P&L %', 'Market Value', 'Weight', 'Actions'].map((col, ci) => (
                      <th key={ci} style={{
                        background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', fontSize: 10, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.06em', color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)',
                        padding: '10px 12px', textAlign: ci < 2 ? 'left' : ci === 11 ? 'center' : 'right',
                        whiteSpace: 'nowrap', borderBottom: `1px solid ${bd}`,
                        ...(ci === 0 ? stickyKey : null),
                      }}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {holdingsWithData.map((h, idx) => {
                    // Not priced yet (a portfolio just opened, a position
                    // just added): the row says so. It read SHARES 0, $0.00
                    // and WEIGHT 0.0% until the quotes came.
                    if (loading && !holdingsData[h.id]) {
                      return (
                        <tr key={h.id}>
                          <td style={{ padding: '10px 12px', textAlign: 'left', fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${bd}`, whiteSpace: 'nowrap', ...stickyKey }}>{(h.symbol || '').split('.')[0]}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'left', fontFamily: "'Sora', sans-serif", fontSize: 12, color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.55)', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{h.name || h.symbol}</td>
                          <td colSpan={10} style={{ padding: '10px 12px', textAlign: 'left', fontFamily: "'Sora', sans-serif", fontSize: 12, color: isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.6)', borderBottom: `1px solid ${bd}` }}>Loading…</td>
                        </tr>
                      );
                    }
                    const d = holdingsData[h.id] || {};
                    const price = d.priceUnavailable ? null : (Number.isFinite(d.currentPrice) ? d.currentPrice : (asNum(h.manualPrice) || 0));
                    // These five read the names calculations.js actually
                    // returns. They used to read totalShares, avgCost,
                    // marketValue, totalPnL and totalPnLPercent -- none of
                    // which exist on the result of getHoldingPnL -- so every
                    // numeric column in this table fell through to its `|| 0`
                    // and a holding of ten shares showed SHARES 0, AVG COST
                    // $0.00, MARKET VALUE $0.00 and WEIGHT 0.0%, beside a
                    // correct LAST PRICE and under a correct summary card.
                    const avgCost = d.avgCostPerShare || 0;
                    const shares = d.quantity || 0;
                    // Zero shares are worth $0.00 whatever the price feed says.
                    const mktVal = !(shares > 0) ? 0 : d.priceUnavailable ? null : (d.currentValue || (shares * price));
                    const totalPnl = d.priceUnavailable ? null : (d.pnl || 0);
                    const totalPnlPct = d.priceUnavailable ? null : (d.pnlPercent || 0);
                    // No day figure comes back from getHoldingPnL at all.
                    // Computed the way calculations.js computes the portfolio
                    // total, so the column and the header card agree.
                    // Unknown is N/A, not 0.00.
                    const dayKnown = price != null && d.dayKnown !== false && d.previousClose > 0;
                    const dayPnl = dayKnown ? Calc.dayChangeValue(price, d.previousClose, shares, d.exchangeRate || 1, d.dayBought) : null;
                    const dayChgPct = dayKnown ? ((price - d.previousClose) / d.previousClose * 100) : null;
                    const weight = (mktVal != null && totalValue > 0) ? (mktVal / totalValue * 100) : 0;
                    const dayColor = signColor(dayChgPct);

                    return (
                      <tr key={h.id} style={{ transition: 'background 0.1s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.03)'; e.currentTarget.querySelector('td').style.color = '#f97316'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.querySelector('td').style.color = tc; }}
                      >
                        <td style={{ padding: '10px 12px', textAlign: 'left', fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 13, borderBottom: `1px solid ${bd}`, whiteSpace: 'nowrap', transition: 'color 0.12s', cursor: h.symbol && h.type !== 'manual' && onSelectAsset ? 'pointer' : 'default', ...stickyKey }}
                          // Keyboard-reachable when it opens something.
                          {...(h.symbol && h.type !== 'manual' && onSelectAsset ? {
                            role: 'button', tabIndex: 0, 'aria-label': 'Open ' + (h.name || h.symbol),
                            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectAsset({ symbol: h.symbol, name: h.name || h.symbol.split('.')[0] }); } },
                          } : {})}
                          onClick={() => { if (h.symbol && h.type !== 'manual' && onSelectAsset) onSelectAsset({ symbol: h.symbol, name: h.name || h.symbol.split('.')[0] }); }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: dayColor, boxShadow: `0 0 4px ${dayColor}`, flexShrink: 0 }}></span>
                            {(h.symbol || '').split('.')[0]}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'left', fontFamily: "'Sora', sans-serif", fontSize: 12, color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.55)', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{h.name || h.symbol}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{Calc.formatQuantity(shares, h)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{(() => {
                          // Bought in the instrument's currency, so said in it; the
                          // portfolio-currency figure the other columns use sits
                          // under it, named.
                          const base = activePortfolio?.baseCurrency; const own = h.currency || base;
                          const inAsset = Number(d.avgCostPerShareInAsset);
                          if (!(own && base && own !== base) || !Number.isFinite(inAsset)) return Calc.formatCurrency(avgCost, base);
                          return (<>
                            <div>{Calc.formatCurrency(inAsset, own)}</div>
                            <div data-avg-base="true" style={{ fontSize: 11, opacity: 0.7 }}>{Calc.formatCurrency(avgCost, base)} in {base}</div>
                          </>);
                        })()}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{Calc.formatCurrency(price == null ? null : price * (d.exchangeRate || 1), activePortfolio?.baseCurrency)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', color: dayColor }}>{dayChgPct == null ? 'N/A' : (dayChgPct > 0 ? '+' : '') + dayChgPct.toFixed(2) + '%'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', color: signColor(dayPnl), whiteSpace: 'nowrap' }}>{dayPnl == null ? 'N/A' : <>{dayPnl > 0 ? '+' : ''}{Calc.formatCurrency(dayPnl, activePortfolio?.baseCurrency)}</>}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', color: signColor(totalPnl), whiteSpace: 'nowrap' }}>{totalPnl > 0 ? '+' : ''}{Calc.formatCurrency(totalPnl, activePortfolio?.baseCurrency)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 11, fontFamily: "'Roboto Mono', monospace", fontWeight: 500, color: signColor(totalPnlPct), background: (totalPnlPct == null || totalPnlPct === 0) ? 'transparent' : totalPnlPct > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>{totalPnlPct == null ? 'N/A' : (totalPnlPct > 0 ? '+' : '') + totalPnlPct.toFixed(1) + '%'}</span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: "'Roboto Mono', monospace", fontSize: 13, fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>{Calc.formatCurrency(mktVal, activePortfolio?.baseCurrency)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                            {/* No value is no weight: an unpriced row read 0.0%
                                beside its N/A columns. */}
                            <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 12 }}>{mktVal == null ? 'N/A' : weight.toFixed(1) + '%'}</span>
                            <div style={{ width: 52, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', background: C3.logoGradient, borderRadius: 2, width: `${Math.min(weight * 4, 100)}%` }}></div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${bd}` }}>
                          <button data-hit="" data-pt-edit={h.id} onClick={() => setEditHolding(h)} style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)', fontSize: 11, fontFamily: "'Sora', sans-serif", fontWeight: 600, cursor: 'pointer', border: `1px solid ${bd}`, padding: '4px 10px', borderRadius: 3, background: 'none', transition: 'color 150ms ease, border-color 150ms ease' }}
                            onMouseEnter={e => { e.target.style.color = '#f97316'; e.target.style.borderColor = 'rgba(249,115,22,0.3)'; }}
                            onMouseLeave={e => { e.target.style.color = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)'; e.target.style.borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                          >Edit</button>
                          {/* The way into the position's transactions. The
                              history and the six transaction types it can add
                              -- dividend, split, transfers -- were reachable
                              only from the phone layout, which the web build
                              never renders. */}
                          <button data-hit="" onClick={() => { setSelectedHolding(h); setShowTransactionHistory(true); }} style={{ marginLeft: 6, color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)', fontSize: 11, fontFamily: "'Sora', sans-serif", fontWeight: 600, cursor: 'pointer', border: `1px solid ${bd}`, padding: '4px 10px', borderRadius: 3, background: 'none', transition: 'color 150ms ease, border-color 150ms ease' }}
                            onMouseEnter={e => { e.target.style.color = '#f97316'; e.target.style.borderColor = 'rgba(249,115,22,0.3)'; }}
                            onMouseLeave={e => { e.target.style.color = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.62)'; e.target.style.borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                          >History</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
            {/* Wraps: a long status ("No prices came back: EODHD's per-minute
                request limit was reached. Try again in 34 s") goes to its own
                line on a narrow screen, instead of squeezing "8 holdings | USD"
                onto three. Wide, both stay on one line. */}
            <div data-pt-footer="true" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '6px 16px', padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.6)' }}>
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{holdings.length} holding{holdings.length === 1 ? '' : 's'} | {activePortfolio?.baseCurrency || 'USD'}</span>
              {/* Try again whenever a position is left without a price, not
                  only when all are: "6 positions, 5 unpriced" had none. */}
              {/* The words are a live region, read out as they change
                  ("Loading prices…", "N without a price", "No prices came
                  back"); the button stays outside it. */}
              <span>{(() => {
                const again = <RLW.RetryButton wait={rlWait} busyKey="prices" isDark={isDark} onClick={retryPrices} style={{ marginLeft: 6, padding: '3px 10px', borderRadius: 3, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: tc, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora', sans-serif" }} />;
                const words = loading ? 'Loading prices…'
                  : pricesUpdatedAt ? 'Prices as of ' + pricesUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) + (unpricedCount > 0 ? ` · ${unpricedCount} without a price` : '')
                  : noneValued ? noPricesWords : '';
                // The words are the live region; the held press's note counts
                // every second and stays outside it.
                const showAgain = (!loading || retrying) && (pricesUpdatedAt ? unpricedCount > 0 : noneValued);
                return <><span role="status" aria-live="polite" data-pt-price-status="true">{words}</span>{rlWait.note ? <span data-wait-note="true">{(words ? ' ' : '') + rlWait.note}</span> : null}{showAgain && <> {again}</>}</>;
              })()}</span>
            </div>
          </div>
          )}

          {/* P&L Breakdown widget */}
          {overviewWidgets.includes('pnl') && holdings.length > 0 && (
            <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: '16px 20px' }}>
              <h3 style={{ fontWeight: 700, fontSize: 14, margin: '0 0 12px', color: tc }}>P&L Breakdown</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, fontSize: 13 }}>
                {[
                  { label: 'Unrealized', value: unrealizedPnL, color: signColor(unrealizedPnL), needsPrice: true },
                  { label: 'Realized', value: realizedPnL, color: signColor(realizedPnL) },
                  { label: 'Price P&L', value: pricePnL, color: signColor(pricePnL), needsPrice: true },
                  { label: 'Currency P&L', value: currencyPnL, color: signColor(currencyPnL), needsPrice: true },
                  { label: 'Dividends (gross)', value: dividendIncome.grossIncome, color: acc('#3b82f6') },
                  { label: 'Dividends (net)', value: dividendIncome.netIncome, color: acc('#3b82f6') },
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize: 11, color: ink(0.45), marginBottom: 4 }}>{item.label}</div>
                    <div style={{ color: noneValued && item.needsPrice ? ink(0.45) : item.color, fontFamily: "'Roboto Mono', monospace", fontWeight: 500 }}>{noneValued && item.needsPrice ? 'N/A' : Calc.formatCurrency(item.value, activePortfolio?.baseCurrency)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Allocation widget */}
          {overviewWidgets.includes('allocation') && holdings.length > 0 && window.PortfolioAnalyticsView && (
            <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: '16px 20px', maxHeight: widgetMaxH('allocation'), overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontWeight: 700, fontSize: 14, margin: 0, color: tc }}>Allocation</h3>
                <button onClick={() => cycleWidgetSize('allocation')} {...sizeLabel('allocation', 'Allocation')} style={{ ...(tap40 ? { ...tap40, display: 'inline-flex', alignItems: 'center' } : null), background: 'none', border: `1px solid ${bd}`, borderRadius: 3, color: ink(0.3), fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>{getWidgetSize('allocation') === 'compact' ? 'S' : getWidgetSize('allocation') === 'full' ? 'L' : 'M'}</button>
              </div>
              <div style={{ fontSize: 12 }}>
                {React.createElement(window.PortfolioAnalyticsView, {
                  portfolioId: activePortfolioId, apiKey,
                  baseCurrency: activePortfolio?.baseCurrency || 'USD',
                  holdings, holdingsData, pricesLoading: pricesPending, onRetryPrices: retryPrices,
                  onClose: () => {},
                  theme, embedded: true, initialTab: 'allocation',
                  allowedTabs: ['allocation'], compact: true,
                })}
              </div>
            </div>
          )}

          {/* Health Score widget */}
          {overviewWidgets.includes('health') && holdings.length > 0 && window.PortfolioHealthView && (
            <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: '16px 20px', maxHeight: widgetMaxH('health'), overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontWeight: 700, fontSize: 14, margin: 0, color: tc }}>Health Score</h3>
                <button onClick={() => cycleWidgetSize('health')} {...sizeLabel('health', 'Health Score')} style={{ ...(tap40 ? { ...tap40, display: 'inline-flex', alignItems: 'center' } : null), background: 'none', border: `1px solid ${bd}`, borderRadius: 3, color: ink(0.3), fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>{getWidgetSize('health') === 'compact' ? 'S' : getWidgetSize('health') === 'full' ? 'L' : 'M'}</button>
              </div>
              {React.createElement(window.PortfolioHealthView, {
                holdings, positions: holdingsWithData, apiKey, pricesLoading: pricesPending, onRetryPrices: retryPrices,
                baseCurrency: activePortfolio?.baseCurrency || 'USD',
                onClose: () => {}, theme, embedded: true,
              })}
            </div>
          )}

          {/* Dividends widget */}
          {overviewWidgets.includes('dividends') && holdings.length > 0 && window.PortfolioAnalyticsView && (
            <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: '16px 20px', maxHeight: widgetMaxH('dividends'), overflow: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontWeight: 700, fontSize: 14, margin: 0, color: tc }}>Dividends</h3>
                <button onClick={() => cycleWidgetSize('dividends')} {...sizeLabel('dividends', 'Dividends')} style={{ ...(tap40 ? { ...tap40, display: 'inline-flex', alignItems: 'center' } : null), background: 'none', border: `1px solid ${bd}`, borderRadius: 3, color: ink(0.3), fontSize: 10, padding: '2px 8px', cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>{getWidgetSize('dividends') === 'compact' ? 'S' : getWidgetSize('dividends') === 'full' ? 'L' : 'M'}</button>
              </div>
              {React.createElement(window.PortfolioAnalyticsView, {
                portfolioId: activePortfolioId, apiKey,
                baseCurrency: activePortfolio?.baseCurrency || 'USD',
                holdings, holdingsData, pricesLoading: pricesPending, onRetryPrices: retryPrices,
                onClose: () => {},
                theme, embedded: true, initialTab: 'dividends',
                allowedTabs: ['dividends'], compact: true,
              })}
            </div>
          )}
        </>)}

        {/* ═══ AI Dashboard — auto-generated insights + rebalancing + chat ═══ */}
        {webTab === 'ai' && (
          <div>
            {/* Top: AI Alerts + Summary | Rebalancing Table */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: 16, marginBottom: 16 }}>
              {/* Left: AI Alerts + Summary */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Icon name="zap" size={16} color={ink(0.6)} />
                  <h3 style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>AI Alerts & Summary</h3>
                  <button onClick={() => { if (autoInsights) setInsightsDismissed(false); else fetchAIInsights(); }} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 3, border: `1px solid ${bd}`, background: 'rgba(255,255,255,0.03)', color: ink(0.4), fontSize: 10, cursor: 'pointer', fontFamily: "'Sora',sans-serif" }}>
                    {insightsLoading ? '...' : (!autoInsights && qaCost ? `Refresh · ${qaCost}` : 'Refresh')}
                  </button>
                </div>
                {/* Auto-generated alerts */}
                {insightsError && (
                  <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: acc('#ef4444'), fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ flex: 1, lineHeight: 1.4 }}>{insightsError}</span>
                    <button aria-label="Dismiss error" onClick={() => setInsightsError('')} style={{ background: 'none', border: 'none', color: acc('#ef4444'), opacity: 0.7, cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                )}
                {holdings.length === 0 ? (
                  <div style={{ color: ink(0.3), fontSize: 13, padding: 16, textAlign: 'center' }}>Add positions to get an AI review</div>
                ) : insightsLoading ? (
                  <div style={{ color: ink(0.4), fontSize: 12, padding: 16, textAlign: 'center' }}>Analyzing portfolio...</div>
                ) : autoInsights ? (
                  <div style={{ fontSize: 12, lineHeight: 1.6, color: ink(0.7) }}>{window.renderMarkdown ? window.renderMarkdown(autoInsights) : autoInsights}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Generated alerts from data */}
                    {holdingsWithData.filter(h => h.symbol).length > 0 && (() => {
                      const alerts = [];
                      // Concentration check
                      holdingsWithData.forEach(h => {
                        // currentValue, not marketValue: getHoldingPnL returns
                        // the former and there is no latter, so this weight was
                        // always 0 and the concentration warning never fired.
                        const w = totalValue > 0 ? ((h.currentValue || 0) / totalValue * 100) : 0;
                        if (w > 25) alerts.push({ type: 'warn', text: `${(h.symbol||'').split('.')[0]} is ${w.toFixed(0)}% of portfolio — high concentration risk` });
                      });
                      // Sector concentration (simplified)
                      if (holdings.length < 3) alerts.push({ type: 'warn', text: 'Low diversification — fewer than 3 holdings' });
                      // P&L alerts
                      if (dayChange < 0 && Math.abs(dayChange) > totalValue * 0.02) alerts.push({ type: 'alert', text: `Portfolio down ${(dayChange / totalValue * 100).toFixed(1)}% today — significant daily loss` });
                      // The header's Total Return, so the alert and the card agree.
                      if (totalReturnPercent != null && totalReturnPercent > 20) alerts.push({ type: 'ok', text: `Strong total return: +${totalReturnPercent.toFixed(1)}%` });
                      if (totalReturnPercent != null && totalReturnPercent < -10) alerts.push({ type: 'alert', text: `Portfolio underwater: ${totalReturnPercent.toFixed(1)}%` });
                      // Nothing valued is nothing weighed: not "looks balanced".
                      if (alerts.length === 0) alerts.push(noneValued
                        ? { type: 'warn', text: 'Needs current prices — none came back, so concentration and returns could not be checked.' }
                        : { type: 'ok', text: 'Portfolio looks balanced. Run the detailed AI review for more.' });
                      return alerts.map((a, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 3, background: a.type === 'alert' ? 'rgba(239,68,68,0.06)' : a.type === 'warn' ? 'rgba(249,115,22,0.06)' : 'rgba(34,197,94,0.06)' }}>
                          <span style={{ fontSize: 12, color: ink(0.7) }}>{a.text}</span>
                        </div>
                      ));
                    })()}
                    <button onClick={() => fetchAIInsights(true)} style={{ marginTop: 8, padding: '8px', borderRadius: 4, border: `1px solid ${bd}`, background: 'transparent', color: ink(0.85), fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {detailCost ? `Run a detailed AI review · ${detailCost}` : 'Run a detailed AI review'}
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Rebalancing Table */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <Icon name="target" size={16} color="#f97316" />
                  {/* Called "Rebalancing Suggestions" over a table of current
                      weights with no target in it. It is
                      the allocation; the targets show when a template set them,
                      and the advisor below makes the suggestions. */}
                  <h3 style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>Allocation</h3>
                </div>
                {holdings.length === 0 ? (
                  <div style={{ color: ink(0.3), fontSize: 13, padding: 16, textAlign: 'center' }}>Add positions to see the allocation</div>
                ) : (
                  <div>
                    {/* Simple allocation table with suggested changes */}
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', color: ink(0.4), fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Asset</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: ink(0.4), fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Current %</th>
                          {hasTargets && <th style={{ textAlign: 'right', padding: '6px 8px', color: ink(0.4), fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Target %</th>}
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: ink(0.4), fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Value</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: ink(0.4), fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Day P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdingsWithData.filter(h => h.symbol).slice(0, 10).map(h => {
                          const w = totalValue > 0 ? ((h.currentValue || 0) / totalValue * 100) : 0;
                          const dp = (h.previousClose && h.currentPrice)
                            ? Calc.dayChangeValue(h.currentPrice, h.previousClose, h.quantity || 0, h.exchangeRate || 1, h.dayBought)
                            : 0;
                          // Shares held and no price: weight, value and day
                          // move are unknown, not 0.0% $0.00 $0.00.
                          if (h.priceUnavailable && Number(h.quantity) > 0) {
                            return (
                              <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '6px 8px', fontWeight: 600, fontFamily: "'Sora',sans-serif" }}>{(h.symbol||'').split('.')[0]}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: ink(0.7) }}>N/A</td>
                                {hasTargets && <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: ink(0.7) }}>{targetOf(h) == null ? '—' : `${targetOf(h).toFixed(1)}%`}</td>}
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: ink(0.7) }}>N/A</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: ink(0.7) }}>N/A</td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600, fontFamily: "'Sora',sans-serif" }}>{(h.symbol||'').split('.')[0]}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: w > 25 ? acc('#f97316') : ink(0.7) }}>{w.toFixed(1)}%</td>
                              {hasTargets && <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: ink(0.7) }}>{targetOf(h) == null ? '—' : `${targetOf(h).toFixed(1)}%`}</td>}
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace" }}>{Calc.formatCurrency(h.currentValue || 0, activePortfolio?.baseCurrency)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'Roboto Mono',monospace", color: signColor(dp) }}>{dp > 0 ? '+' : ''}{Calc.formatCurrency(dp, activePortfolio?.baseCurrency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <button onClick={() => setShowRebalancingAdvisor(true)} style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 4, border: '1px solid rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.08)', color: acc('#f97316'), fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="target" size={14} color="#f97316" /> Open Rebalancing Advisor
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Risk Analysis', prompt: 'Analyze the risk profile of my portfolio: concentration by position and by sector, which holdings are likely to move together given their sectors, and suggestions. No beta or correlation figures are in the data, so do not state any numbers for them.' },
                { label: 'Tax-Loss Harvest', prompt: 'Identify tax-loss harvesting opportunities in my portfolio. Which positions are down and could be sold for tax benefits?' },
                { label: 'Dividend Forecast', prompt: 'Project my portfolio dividend income for the next 12 months based on current holdings.' },
                { label: 'Stress Test −20%', prompt: 'Simulate a 20% market crash. Which holdings would be hit hardest? What is my estimated portfolio loss?' },
              ].map((action, i) => (
                <button key={i} onClick={() => {
                  // The prompt goes to the chat as its initialPrompt, on a
                  // fresh mount (the key). It was an `ai-chat-prompt` event
                  // 100 ms later that nothing listened for: the chat opened
                  // empty and nothing was sent.
                  setChatPrompt(prev => ({ prompt: action.prompt, title: action.label, n: (prev ? prev.n : 0) + 1 }));
                  setShowAIChat(true);
                }} style={{
                  padding: '6px 14px', borderRadius: 4, border: `1px solid ${bd}`,
                  background: 'rgba(255,255,255,0.02)', color: ink(0.5),
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'Sora',sans-serif",
                }}>{qaCost ? `${action.label} · ${qaCost}` : action.label}</button>
              ))}
            </div>

            {/* AI Chat — collapsible input at bottom */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 12 }}>
              {!showAIChat ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="messageCircle" size={16} color="rgba(255,255,255,0.3)" />
                  <input placeholder="Ask AI about your portfolio" readOnly onClick={() => setShowAIChat(true)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 4, border: `1px solid ${bd}`,
                    background: bg2, color: tc, fontSize: 13,
                    fontFamily: "'Sora',sans-serif", outline: 'none', cursor: 'pointer',
                  }} />
                </div>
              ) : window.AIChatView ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ink(0.5) }}>AI Chat</span>
                    <button aria-label="Close AI chat" onClick={() => { setShowAIChat(false); setChatPrompt(null); }} style={{ background: 'none', border: 'none', color: ink(0.3), cursor: 'pointer', fontSize: 14 }}>x</button>
                  </div>
                  {React.createElement(window.AIChatView, {
                    key: chatPrompt ? 'prompt-' + chatPrompt.n : 'chat',
                    holdings, holdingsData, watchlist: [], watchlistData: {},
                    initialPrompt: chatPrompt ? chatPrompt.prompt : undefined,
                    subtitle: chatPrompt ? chatPrompt.title : undefined,
                    onClose: () => { setShowAIChat(false); setChatPrompt(null); }, theme,
                  })}
                </div>
              ) : null}
            </div>

            {/* Rebalancing Advisor modal */}
            {showRebalancingAdvisor && window.RebalancingAdvisor && (
              <div style={{ marginTop: 16, background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 20 }}>
                {React.createElement(window.RebalancingAdvisor, {
                  holdings, holdingsData, onRetryPrices: retryPrices,
                  onClose: () => setShowRebalancingAdvisor(false), theme,
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ Performance tab: chart + risk + dividends + benchmark ═══ */}
        {webTab === 'performance' && window.PortfolioAnalyticsView && (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 20 }}>
            {React.createElement(window.PortfolioAnalyticsView, {
              portfolioId: activePortfolioId, apiKey,
              baseCurrency: activePortfolio?.baseCurrency || 'USD',
              holdings, holdingsData, pricesLoading: pricesPending, onRetryPrices: retryPrices,
              onClose: () => setWebTab('overview'),
              theme, embedded: true, initialTab: 'performance',
              allowedTabs: ['allocation', 'performance', 'risk', 'dividends', 'benchmark'],
            })}
          </div>
        )}

        {/* ═══ Research tab: correlation + monte carlo + what-if ═══ */}
        {webTab === 'research' && (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 20 }}>
            {React.createElement(window.PortfolioAnalyticsView, {
              portfolioId: activePortfolioId, apiKey,
              baseCurrency: activePortfolio?.baseCurrency || 'USD',
              holdings, holdingsData, pricesLoading: pricesPending, onRetryPrices: retryPrices,
              onClose: () => setWebTab('overview'),
              theme, embedded: true, initialTab: window._researchInitialTab || 'correlation',
              allowedTabs: ['correlation', 'montecarlo', 'backtest', 'whatif'],
            })}
          </div>
        )}

        {/* ═══ Tax tab ═══ */}
        {webTab === 'tax' && window.TaxView && (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 20 }}>
            {React.createElement(window.TaxView, {
              portfolioId: activePortfolioId, holdings, holdingsData,
              baseCurrency: activePortfolio?.baseCurrency || 'USD',
              // Back goes to Overview, and so does the focus: it was left on
              // <body> with the arrow gone.
              onClose: () => { setWebTab('overview'); setTimeout(() => { try { const tab = document.querySelector('[role="tablist"] [data-tab="overview"]'); if (tab) tab.focus(); } catch (_) {} }, 0); }, theme,
            })}
          </div>
        )}

        {/* ═══ Macro tab ═══ */}
        {webTab === 'macro' && window.MacroDashboardView && (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${bd}`, borderRadius: 4, padding: 20 }}>
            {React.createElement(window.MacroDashboardView, {
              portfolioId: activePortfolioId, apiKey,
              baseCurrency: activePortfolio?.baseCurrency || 'USD',
              // With no position valued the header's Total Return is N/A,
              // and so is any rate made from it: one recorded dividend read
              // "+0.87% a year" here.
              totalValue, totalReturn: noneValued ? null : totalReturnPercent, // the header's figure, not open-lot P&L
              annualReturn: !noneValued && moneyWeighted ? moneyWeighted.annual : null, // money-weighted (IRR)
              onRetryPrices: noneValued ? retryPrices : null,
              onClose: () => setWebTab('overview'), theme,
            })}
          </div>
        )}

        {/* Templates & funds: the catalogue, adopting into a new portfolio
            that then opens here. A fund template fetches the fund's current
            holdings when selected (hydrateFundTemplate). */}
        {showCatalog && window.PortfolioCatalogView && (
          <div ref={catalogDialogRef} style={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Portfolio templates and funds"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCatalog(false); }}
            // A press on the dimmed page closes it, like the other windows;
            // the browser's default would first drop the focus to <body>, and
            // the opener did not get it back.
            onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setShowCatalog(false); } }}>
            {/* border-box: width 100% plus the padding was 21px wider than a
                phone and slid sideways. */}
            <div style={{ width: '100%', maxWidth: 960, boxSizing: 'border-box', minWidth: 0, overflowX: 'hidden', background: isDark ? '#15140F' : '#ffffff', border: `1px solid ${bd}`, borderRadius: 8, padding: 20, color: tc }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button ref={catalogCloseRef} onClick={() => setShowCatalog(false)} aria-label="Close templates" style={styles.iconButton}><Icon name="x" size={20} /></button>
              </div>
              {React.createElement(window.PortfolioCatalogView, {
                apiKey, theme,
                onClose: () => setShowCatalog(false),
                onAdopt: (t) => {
                  const tickers = t.tickers || [];
                  let refused = null;
                  const portfolio = Storage.attempt(() => {
                    const p = Storage.createPortfolio({ name: t.name, baseCurrency: 'USD', icon: 'barChart' });
                    tickers.forEach((ticker, i) => {
                      Storage.createHolding({ portfolioId: p.id, symbol: ticker, name: ticker.split('.')[0], type: (Calc.knownAssetType && Calc.knownAssetType(ticker)) || 'stock', notes: `Template: ${t.name}, target weight: ${t.weights?.[i] || 0}%` });
                    });
                    return p;
                  }, (m) => { refused = m; });
                  loadData();
                  // The catalog says it under its button.
                  if (!portfolio) return { error: refused || 'The portfolio could not be saved.' };
                  // Names from the search, not the bare codes;
                  // the portfolio:names-filled listener above draws them.
                  if (window.PortfolioFillNames) window.PortfolioFillNames(portfolio.id, apiKey);
                  // The catalog says what was made and offers "Open portfolio"
                  // (onOpenPortfolio below); this used to close it with an alert.
                  return portfolio.id;
                },
                onOpenPortfolio: (id) => { setShowCatalog(false); setActivePortfolioId(id); },
              })}
            </div>
          </div>
        )}

        {/* Modals (shared between TG and Web) */}
        {showAddPosition && (
          <div style={styles.modalOverlay}>
            {React.createElement(window.AddPositionModal, { portfolioId: activePortfolioId, portfolios, baseCurrency: activePortfolio?.baseCurrency || 'USD', prefillSymbol, prefillType, prefillAssetName, apiKey, onClose: closeAddPosition, onSave: handlePositionAdded, theme })}
          </div>
        )}
        {confirmDialog}
        {askElement}
        {showAddPortfolio && (
          <div style={styles.modalOverlay}>
            {/* A dialog like the others: role, aria-modal, Escape, focus back
                to "+". */}
            <window.PTDialog.Frame onClose={() => { setShowAddPortfolio(false); setNewPortfolioNote(''); }} label="New portfolio" style={{
              // Drop the glassmorphic mix from styles.modalContent entirely — it brings in
              // backdrop-filter blur + a translucent white background that, even when we
              // override `background`, kept washing out as gray. Apply layout props by hand.
              borderRadius: 20, padding: 24, width: '100%', maxWidth: 400, maxHeight: '90vh',
              overflowY: 'auto',
              background: isDark ? '#000000' : '#ffffff',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
              boxShadow: isDark ? '0 24px 48px rgba(0,0,0,0.7)' : '0 24px 48px rgba(0,0,0,0.25)',
              backdropFilter: 'none', WebkitBackdropFilter: 'none',
              color: tc, boxSizing: 'border-box',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: tc }}>New Portfolio</h3>
                <button aria-label="Close" onClick={() => { setShowAddPortfolio(false); setNewPortfolioNote(''); }} style={styles.iconButton}>
                  <Icon name="x" size={24} />
                </button>
              </div>
              <form noValidate onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); handleCreatePortfolio(fd.get('name'), newPortfolioCurrency); }}>
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="pt-new-name" style={styles.label}>Portfolio Name</label>
                  <input id="pt-new-name" name="name" type="text" placeholder="e.g., Retirement, Trading" style={{ ...styles.input, boxSizing: 'border-box' }} aria-required="true" autoFocus
                    aria-describedby={newPortfolioNote ? 'pt-new-name-note' : undefined} onInput={() => newPortfolioNote && setNewPortfolioNote('')} />
                  {newPortfolioNote && <div id="pt-new-name-note" role="alert" style={{ marginTop: 6, fontSize: 12, color: isDark ? '#fca5a5' : '#b91c1c' }}>{newPortfolioNote}</div>}
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={styles.label}>Base Currency</label>
                  {React.createElement(window.PortalDropdown, {
                    value: newPortfolioCurrency,
                    options: window.PortfolioCalculations.BASE_CURRENCIES.map(([c,n]) => ({ value: c, label: c + ' - ' + n })),
                    onChange: setNewPortfolioCurrency,
                    isDark,
                    style: { width: '100%' },
                    minWidth: 0,
                    ariaLabel: 'Base currency',
                  })}
                </div>
                <button type="submit" style={{ ...styles.button, ...styles.primaryButton, width: '100%', justifyContent: 'center', padding: '14px 24px', boxSizing: 'border-box' }}>
                  Create Portfolio
                </button>
              </form>
            </window.PTDialog.Frame>
          </div>
        )}
        {showImportCSV && (
          <div style={styles.modalOverlay}>
            {React.createElement(window.ImportCSVModal, { portfolioId: activePortfolioId, apiKey, baseCurrency: activePortfolio?.baseCurrency || 'USD', onClose: () => setShowImportCSV(false), onImport: handleImported, theme })}
          </div>
        )}
        {importReport && window.ImportReportDialog && (
          <div style={styles.modalOverlay}>
            {React.createElement(window.ImportReportDialog, { report: importReport, onClose: () => setImportReport(null), theme })}
          </div>
        )}
        {editHolding && (
          <div style={styles.modalOverlay}>
            {React.createElement(window.EditPositionModal, { apiKey, holding: editHolding, holdingData: holdingsData[editHolding.id], baseCurrency: activePortfolio?.baseCurrency || 'USD', onClose: () => setEditHolding(null), onSave: () => { if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_manage', { action: 'edit' }); setEditHolding(null); const ph = Storage.getHoldingsByPortfolio(activePortfolioId); setHoldings(ph); loadHoldingsPrices(ph); }, onDelete: () => { handleDeleteHolding(editHolding.id); setEditHolding(null); }, theme })}
          </div>
        )}
        {showSettings && (
          <div style={styles.modalOverlay}>
            <window.PTDialog.Frame onClose={() => { setShowSettings(false); setRenameNote(null); }} label="Portfolio settings" style={{ ...styles.modalContent, maxWidth: 480 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Portfolio Settings</h3>
                <button aria-label="Close" onClick={() => { setShowSettings(false); setRenameNote(null); }} style={styles.iconButton}><Icon name="x" size={20} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activePortfolio && (
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const name = String(e.target.elements.ptRename.value || '').trim();
                    // An empty name, a name of 300 characters and a rename
                    // that worked all looked the same: nothing.
                    if (!name) { setRenameNote({ error: true, text: 'Enter a name.' }); return; }
                    if (name.length > Storage.NAME_MAX) { setRenameNote({ error: true, text: `Keep it to ${Storage.NAME_MAX} characters.` }); return; }
                    const same = portfolioNamed(name, activePortfolio.id);
                    if (same) { setRenameNote({ error: true, text: `A portfolio called "${same.name}" already exists.` }); return; }
                    // Rename only. A typo in a name used to mean deleting the
                    // portfolio with its history. The base currency is
                    // not changed here: every trade is booked at its rate into it.
                    if (!Storage.attempt(() => Storage.updatePortfolio(activePortfolio.id, { name }), (m) => setRenameNote({ error: true, text: m }))) return;
                    loadData();
                    setRenameNote({ error: false, text: `Renamed to "${name}".` });
                  }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label htmlFor="pt-rename" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Portfolio name</label>
                    <input id="pt-rename" name="ptRename" defaultValue={activePortfolio.name} key={activePortfolio.id} maxLength={Storage.NAME_MAX}
                      aria-describedby={renameNote ? 'pt-rename-note' : undefined}
                      onInput={() => renameNote && setRenameNote(null)}
                      style={{ flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: 8, border: `1px solid ${bd}`, background: 'transparent', color: tc, fontSize: 14 }} />
                    <button type="submit" style={{ ...styles.button, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: tc }}>Rename</button>
                    {renameNote && (
                      <div id="pt-rename-note" role={renameNote.error ? 'alert' : 'status'} style={{ flexBasis: '100%', fontSize: 12, color: renameNote.error ? (isDark ? '#fca5a5' : '#b91c1c') : (isDark ? '#86efac' : '#15803d') }}>{renameNote.text}</div>
                    )}
                  </form>
                )}
                <button onClick={() => { const data = Storage.exportAll(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`; a.click(); }} style={{ ...styles.button, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: tc, width: '100%', justifyContent: 'center' }}>
                  <Icon name="download" size={18} /> Export Backup (JSON)
                </button>
                {/* A backup could be made but never loaded back. Takes
                    the Export Backup file and the error panel's raw backup. */}
                {/* A button that opens the hidden picker: a <label> around the
                    input could not be reached with Tab -- the
                    same fix as Import CSV's file zone. */}
                <button type="button" onClick={() => restoreInputRef.current && restoreInputRef.current.click()} style={{ ...styles.button, background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: tc, width: '100%', justifyContent: 'center', cursor: 'pointer', boxSizing: 'border-box' }}>
                  <Icon name="upload" size={18} /> Restore from Backup…
                </button>
                  <input ref={restoreInputRef} type="file" accept="application/json,.json" tabIndex={-1} aria-hidden="true" style={{ display: 'none' }} onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    e.target.value = '';
                    if (!file) return;
                    const reader = new FileReader();
                    setBackupNote(null);
                    reader.onload = async () => {
                      let parsed;
                      try { parsed = JSON.parse(String(reader.result || '')); } catch (err) { setBackupNote({ error: true, text: 'This file is not a portfolio backup (it is not JSON).' }); return; }
                      // The file is checked before the question: the confirm
                      // came first, so "Replace everything?" was asked of {}.
                      const problem = Storage.checkBackup(parsed);
                      if (problem) { setBackupNote({ error: true, text: problem }); return; }
                      const go = await askInPage({ title: 'Replace everything with the backup?', text: 'Every portfolio, position and transaction in this browser is replaced with the backup. What is here now is lost unless you exported it.', confirmLabel: 'Replace', danger: true, isDark });
                      if (!go) return;
                      try {
                        const n = Storage.restoreBackup(parsed);
                        loadData();
                        const all = Storage.getPortfolios();
                        setActivePortfolioId(all[0] ? all[0].id : null);
                        setSyncRev(x => x + 1);
                        setBackupNote({ error: false, text: `Restored ${n.portfolios} portfolio${n.portfolios === 1 ? '' : 's'}, ${n.holdings} position${n.holdings === 1 ? '' : 's'} and ${n.transactions} transaction${n.transactions === 1 ? '' : 's'}.` });
                      } catch (err) { setBackupNote({ error: true, text: err && err.message ? err.message : 'The backup could not be restored.' }); }
                    };
                    reader.readAsText(file);
                  }} />
                  {backupNote && (
                    <div role={backupNote.error ? 'alert' : 'status'} data-backup-note style={{ fontSize: 13, lineHeight: 1.5, color: backupNote.error ? (isDark ? C3.error : (C3.errorLight || '#c81e2c')) : (isDark ? C3.textDark : C3.textLightTheme) }}>{backupNote.text}</div>
                  )}
              </div>
            </window.PTDialog.Frame>
          </div>
        )}
        {showTransactionHistory && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto', overscrollBehavior: 'contain' }}>
            {React.createElement(window.TransactionHistoryView, { apiKey, holding: selectedHolding, portfolioId: activePortfolioId, baseCurrency: activePortfolio?.baseCurrency || 'USD', onClose: () => { setShowTransactionHistory(false); setSelectedHolding(null); }, onUpdate: () => { const ph = Storage.getHoldingsByPortfolio(activePortfolioId); setHoldings(ph); loadHoldingsPrices(ph); }, theme })}
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  TELEGRAM MOBILE LAYOUT (original glassmorphism design)
  // ═══════════════════════════════════════════════════════════
  return (
    <div className="pt-fields" style={styles.container}>
      {window.PTFieldFocus && window.PTFieldFocus(isDark)}
      {/* Glow Effects */}

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button aria-label="Back" onClick={onBack} style={styles.iconButton}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Portfolio Tracker</h1>
            <p style={{ fontSize: 12, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Track your investments</p>
            {syncNote}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button aria-label="Ask AI about this portfolio"
            onClick={() => {
              const aiS = window.AIService?.getSettings();
              if (aiS?.enabled && aiS?.apiKey) { setShowAIChat(true); }
              else { onSettingsClick && onSettingsClick(); }
            }}
            style={{ ...styles.iconButton, color: (window.AIService?.getSettings()?.enabled && window.AIService?.getSettings()?.apiKey) ? (isDark ? C3.textDark : C3.textLightTheme) : (isDark ? C3.textMutedDark : C3.textMutedLight) }}
            title="AI Chat"
          >
            <Icon name="messageCircle" size={20} />
          </button>
          <button aria-label="Add portfolio" onClick={() => setShowAddPortfolio(true)} style={styles.iconButton} title="Add Portfolio">
            <Icon name="plus" size={20} />
          </button>
          <button aria-label="Portfolio settings" onClick={() => setShowSettings(true)} style={styles.iconButton}>
            <Icon name="settings" size={20} />
          </button>
        </div>
      </div>

      {/* Portfolio Tabs */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {portfolios.map(p => (
            <button
              key={p.id}
              onClick={() => setActivePortfolioId(p.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 12,
                border: 'none',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
                background: activePortfolioId === p.id
                  ? C3.logoGradient
                  : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                color: activePortfolioId === p.id ? 'white' : isDark ? C3.textDark : C3.textLightTheme
              }}
            >
              {/* The portfolio's icon is an icon NAME ("barChart"); it was printed as text. */}
              {window.IconPaths && window.IconPaths[p.icon] ? <Icon name={p.icon} size={16} /> : null}
              <span>{p.name}</span>
            </button>
          ))}
          {portfolios.length > 1 && (
            <button
              onClick={() => setActivePortfolioId('all')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 12,
                border: 'none',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
                background: activePortfolioId === 'all'
                  ? C3.logoGradient
                  : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                color: activePortfolioId === 'all' ? 'white' : isDark ? C3.textDark : C3.textLightTheme
              }}
            >
              {React.createElement(Icon, { name: 'barChart', size: 16 })}
              <span>All</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ padding: 16 }}>
        {/* Summary Card */}
        <div data-retry-scope="" style={styles.card}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div data-retry-focus="" style={{ fontSize: 32, fontWeight: 700, marginBottom: 4 }}>
              {loading ? (
                <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Loading...</span>
              ) : (
                noneValued ? 'N/A' : Calc.formatCurrency(totalValue, activePortfolio?.baseCurrency)
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: signColor(pnl) }}>
              <Icon name={pnl >= 0 ? 'trendUp' : 'trendDown'} size={16} color={signColor(pnl)} />
              <span style={{ fontWeight: 600 }}>
                {noneValued ? 'N/A' : <>{Calc.formatCurrency(pnl, activePortfolio?.baseCurrency)} ({Calc.formatPercent(pnlPercent)})</>}
              </span>
              <span style={{ fontSize: 14, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>all time</span>
            </div>
            {!dayUnknown && dayChange !== 0 && (
              <div style={{ fontSize: 14, marginTop: 4, color: signColor(dayChange) }}>
                {Calc.formatCurrency(dayChange, activePortfolio?.baseCurrency)} today
              </div>
            )}
            {/* Nothing priced, or some positions not: say so, and offer the
                one thing that helps. */}
            {/* In a live region that stays on the page, so the message is
                read out when it comes. */}
            {/* Only the words are the live region: the held press's note and
                the button count the wait every second. */}
            {(() => {
              const shown = (!loading || retrying) && unpricedCount > 0;
              return (
                <div style={shown ? { fontSize: 13, marginTop: 8, color: isDark ? C3.textMutedDark : C3.textMutedLight } : undefined}>
                  <span role="status" aria-live="polite" data-pt-price-status="true">{shown ? (loading ? 'Loading prices…' : noneValued ? noPricesWords : `${unpricedCount} of ${holdings.length} positions ${unpricedCount === 1 ? 'has' : 'have'} no price${pricesLimited ? ': ' + RLW.REACHED : pricesWhy ? ': ' + pricesWhy : '.'}`) : ''}</span>
                  {shown && rlWait.note ? <span data-wait-note="true">{` ${rlWait.note}`}</span> : null}
                  {shown && <RLW.RetryButton wait={rlWait} busyKey="prices" isDark={isDark} onClick={retryPrices} style={{ marginLeft: 8, padding: '6px 12px', minHeight: 32, borderRadius: 8, border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 13, fontWeight: 600, cursor: 'pointer' }} />}
                </div>
              );
            })()}
          </div>

        </div>

        {/* P&L Breakdown */}
        {!loading && holdings.length > 0 && (
          <div style={styles.card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>P&L Breakdown</h2>
              <button
                onClick={() => { setSelectedHolding(null); setShowTransactionHistory(true); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: acc('#f97316') }}
              >
                View History
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, fontSize: 14 }}>
              {[
                { label: 'Unrealized', value: unrealizedPnL, color: signColor(unrealizedPnL), needsPrice: true },
                { label: 'Realized', value: realizedPnL, color: signColor(realizedPnL) },
                { label: 'Price P&L', value: pricePnL, color: signColor(pricePnL), needsPrice: true },
                { label: 'Currency P&L', value: currencyPnL, color: signColor(currencyPnL), needsPrice: true },
                { label: 'Dividends (gross)', value: dividendIncome.grossIncome, color: acc('#3b82f6') },
                { label: 'Dividends (net)', value: dividendIncome.netIncome, color: acc('#3b82f6') }
              ].map(item => (
                <div key={item.label}>
                  <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{item.label}</div>
                  {/* What the open shares made needs their price; the
                      recorded figures do not. */}
                  <div style={{ color: noneValued && item.needsPrice ? (isDark ? C3.textMutedDark : C3.textMutedLight) : item.color }}>{noneValued && item.needsPrice ? 'N/A' : Calc.formatCurrency(item.value, activePortfolio?.baseCurrency)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pro Tools Grid */}
        {!loading && holdings.length > 0 && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px 0' }}>Pro Tools</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
              {[
                { icon: 'trendUp', label: 'Macro', action: () => setShowMacroDashboard(true) },
                { icon: 'activity', label: 'Health', action: () => setShowPortfolioHealth(true) },
                { icon: 'chart', label: 'Analytics', action: () => openAnalytics(null) },
                { icon: 'map', label: 'Correlation', action: () => openAnalytics('correlation') },
                { icon: 'barChart', label: 'AI Insights', action: () => setShowAIInsights(true) },
                { icon: 'search', label: 'Backtest', action: () => openAnalytics('backtest') },
                { icon: 'zap', label: 'What-If', action: () => openAnalytics('whatif') },
                { icon: 'trendUp', label: 'Monte Carlo', action: () => openAnalytics('montecarlo') },
                { icon: 'activity', label: 'Rebalance', action: () => setShowRebalancingAdvisor(true) },
                { icon: 'dollar', label: 'Tax', action: () => setShowTaxView(true) },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={() => { window.Haptics?.medium(); item.action(); }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    padding: '14px 8px', borderRadius: 14,
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.7)',
                    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'),
                    cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme,
                  }}
                >
                  {/* One neutral tile for every tool, not a pastel rainbow (design stage 1). */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: isDark ? C3.fillDark : C3.fillLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name={item.icon} size={18} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{item.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Currency Allocation */}
        {!loading && currencyAllocation.length > 1 && (
          <div style={styles.card}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 12 }}>Currency Exposure</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {currencyAllocation.map(({ currency, value, percent }) => (
                <div key={currency} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 48, fontSize: 14, fontWeight: 500 }}>{currency}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ width: '100%', borderRadius: 999, height: 8, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
                      <div style={{ height: 8, borderRadius: 999, transition: 'width 200ms ease', width: `${percent}%`, background: currency === activePortfolio?.baseCurrency ? C3.success : '#f97316' }} />
                    </div>
                  </div>
                  <div style={{ width: 100, textAlign: 'right', fontSize: 14 }}>
                    <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>{percent.toFixed(1)}%</span>
                    <span style={{ fontSize: 12, marginLeft: 4, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>({Calc.formatCurrency(value, activePortfolio?.baseCurrency)})</span>
                  </div>
                </div>
              ))}
            </div>
            {Object.keys(forexRates).length > 1 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
                <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                  FX Rates: {Object.entries(forexRates)
                    .filter(([curr]) => curr !== activePortfolio?.baseCurrency)
                    .map(([curr, rate]) => `${curr}/${activePortfolio?.baseCurrency}: ${rate.toFixed(4)}`)
                    .join(' • ')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI Insights — button-triggered */}
        {!autoInsights && !insightsLoading && holdings.length > 0 && !insightsDismissed && (
          <button
            onClick={fetchAIInsights}
            style={{
              width: '100%',
              padding: '12px 16px',
              marginBottom: 16,
              borderRadius: 12,
              border: '1px solid rgba(249,115,22,0.3)',
              background: isDark ? 'rgba(249,115,22,0.08)' : 'rgba(249,115,22,0.05)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Icon name="zap" size={16} color="#f97316" />
            <span style={{ fontSize: 14, fontWeight: 600, color: acc('#f97316') }}>{qaCost ? `Analyze My Portfolio with AI · ${qaCost}` : 'Analyze My Portfolio with AI'}</span>
          </button>
        )}
        {(autoInsights || insightsLoading) && !insightsDismissed && (
          <div style={{
            ...(isDark ? C3.glassDark : C3.glassLight),
            borderRadius: 16,
            padding: 16,
            marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="zap" size={16} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>AI Insights</span>
              </div>
              <button aria-label="Hide insights"
                onClick={() => { setInsightsDismissed(true); setAutoInsights(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? C3.textMutedDark : C3.textMutedLight, padding: 4 }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            {insightsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 16, height: 16, border: '2px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Analyzing your portfolio...</span>
              </div>
            ) : (
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                {window.renderMarkdown ? window.renderMarkdown(autoInsights) : autoInsights}
              </div>
            )}
          </div>
        )}

        {/* Holdings Section */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Holdings ({holdings.length})</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setShowImportCSV(true)}
              style={{ ...styles.button, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)', color: isDark ? C3.textDark : C3.textLightTheme, padding: '8px 12px', gap: 4 }}
              title="Import CSV"
            >
              <Icon name="download" size={14} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>CSV</span>
            </button>
            <button
              onClick={() => { if (requireRegistration) { requireRegistration(() => setShowAddPosition(true)); } else { setShowAddPosition(true); } }}
              style={{ ...styles.button, ...styles.primaryButton }}
            >
              <Icon name="plus" size={16} color="white" />
              Add
            </button>
          </div>
        </div>

        {/* Holdings List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ width: 32, height: 32, border: '3px solid transparent', borderTopColor: '#f97316', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
            <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Loading holdings...</p>
          </div>
        ) : holdings.length === 0 ? (
          <div style={{ padding: '24px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <Icon name="briefcase" size={48} color={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'} />
              <p style={{ marginBottom: 16, marginTop: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: 15 }}>Add your first position to see:</p>
            </div>

            {/* Features preview */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {[
                { icon: 'chart', title: 'Deep Analytics', desc: 'Allocation, performance, dividends, risk metrics, Sharpe ratio' },
                { icon: 'trendUp', title: 'Macro Dashboard', desc: 'Real returns adjusted for inflation, Treasury rate comparison' },
                { icon: 'activity', title: 'Portfolio Health', desc: 'Insider trading signals, upcoming earnings for your holdings' },
                { icon: 'map', title: 'Correlation Matrix', desc: 'See how your assets move together — measure diversification' },
                { icon: 'trendUp', title: 'Monte Carlo Simulation', desc: '500 projections of your portfolio\'s future value' },
                { icon: 'search', title: 'What-If Backtester', desc: 'Test any investment idea against historical data' },
              ].map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderRadius: 14,
                  background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.7)',
                  border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: isDark ? C3.fillDark : C3.fillLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name={f.icon} size={18} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? C3.textDark : C3.textLightTheme }}>{f.title}</div>
                    <div style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => { if (requireRegistration) { requireRegistration(() => setShowAddPosition(true)); } else { setShowAddPosition(true); } }}
              style={{ ...styles.button, ...styles.primaryButton, padding: '14px 24px', margin: '0 auto', width: '100%', justifyContent: 'center' }}
            >
              Add Your First Position
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {holdings.map(holding => {
              const data = holdingsData[holding.id] || {};
              const isPositive = (data.pnl || 0) >= 0;

              return (
                <div
                  key={holding.id}
                  style={{ ...styles.card, marginBottom: 0, cursor: 'pointer' }}
                  onClick={() => {
                    if (holding.symbol && holding.type !== 'manual' && onSelectAsset) {
                      onSelectAsset({ symbol: holding.symbol, name: holding.name || holding.symbol.split('.')[0] });
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700 }}>
                          {holding.type === 'manual' ? holding.name : holding.symbol?.split('.')[0]}
                        </span>
                        {holding.type === 'manual' && (
                          <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>Manual</span>
                        )}
                        {holding.type !== 'manual' && onSelectAsset && (
                          <Icon name="chevronRight" size={12} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                        )}
                      </div>
                      {/* The company's name under the code, as the web table has it
                          (JNJ, PG, KO and nothing else). */}
                      {holding.type !== 'manual' && holding.name && holding.name.toUpperCase() !== String(holding.symbol || '').split('.')[0].toUpperCase() && (
                        <div style={{ fontSize: 12, marginBottom: 2, color: isDark ? C3.textMutedDark : C3.textMutedLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{holding.name}</div>
                      )}
                      <div style={{ fontSize: 14, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                        {Number(data.quantity) > 0
                          ? <>{Calc.formatQuantity(data.quantity, holding)} {Calc.quantityUnit(holding, data.quantity)}</>
                          : <span data-no-shares="true">No shares yet — add your purchases</span>}
                        {targetOf(holding) != null && <span data-target-weight="true"> · target {targetOf(holding)}%</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>
                        {/* currentValue is in the portfolio currency (getHoldingPnL applies the rate). */}
                        {data.fxUnavailable ? `${holding.currency} rate unavailable`
                          : Calc.formatCurrency(!(Number(data.quantity) > 0) ? 0 : data.priceUnavailable ? null : (data.currentValue || 0), activePortfolio?.baseCurrency)}
                      </div>
                      {/* No price (or no rate) is no gain to state: it read a
                          green "$0.00 (0.00%)" under "N/A". */}
                      {!((data.priceUnavailable || data.fxUnavailable) && Number(data.quantity) > 0) && (
                      <div style={{ fontSize: 14, color: isPositive ? C3.success : C3.error }}>
                        {/* In the portfolio's currency, as the value above it:
                            VTI read "€33,606.26" over "-$465.96". */}
                        {(data.pnl || 0) > 0 ? '+' : ''}{Calc.formatCurrency(data.pnl || 0, activePortfolio?.baseCurrency)} ({Calc.formatPercent(data.pnlPercent || 0)})
                      </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` }}>
                    <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                      {/* In the instrument's own currency, then what it is in the
                          portfolio's, said as such. "Avg cost: €180.00 (USD @
                          0.9230)" put a euro sign on a dollar price. */}
                      {(() => {
                        const base = activePortfolio?.baseCurrency;
                        const own = holding.currency || base;
                        const inAsset = Number(data.avgCostPerShareInAsset);
                        const other = own && base && own !== base;
                        if (!other || !Number.isFinite(inAsset)) return <span>Avg cost: {Calc.formatCurrency(data.avgCostPerShare || 0, base)}</span>;
                        // The rate the euro figure was worked out at: the
                        // purchases' own, weighted. Today's rate beside it
                        // did not reconcile with it.
                        const inBase = data.avgCostPerShare || 0;
                        const paidRate = inAsset > 0 && inBase > 0 ? inBase / inAsset : null;
                        return (<>
                          <span>Avg cost: {Calc.formatCurrency(inAsset, own)}</span>
                          <span style={{ marginLeft: 8, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                            ({Calc.formatCurrency(inBase, base)} in {base}{paidRate ? `, at purchase rate 1 ${own} = ${paidRate.toFixed(4)} ${base}` : ' at purchase rates'})
                          </span>
                        </>);
                      })()}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button aria-label="Edit position" data-pt-edit={holding.id} onClick={(e) => { e.stopPropagation(); setEditHolding(holding); }} style={{ ...styles.iconButton, padding: 6, color: acc('#3b82f6') }} title="Edit">
                        <Icon name="edit" size={16} color="#3b82f6" />
                      </button>
                      <button aria-label="Position history" onClick={(e) => { e.stopPropagation(); setSelectedHolding(holding); setShowTransactionHistory(true); }} style={{ ...styles.iconButton, padding: 6, color: acc('#f97316') }} title="History">
                        <Icon name="activity" size={16} color="#f97316" />
                      </button>
                      <button aria-label="Delete position" onClick={(e) => { e.stopPropagation(); handleDeleteHolding(holding.id); }} style={{ ...styles.iconButton, padding: 6, color: C3.error }} title="Delete">
                        <Icon name="trash" size={16} color={C3.error} />
                      </button>
                    </div>
                  </div>
                  {holding.currency !== activePortfolio?.baseCurrency && data.currencyPnL !== undefined && Math.abs(data.currencyPnL) > 0.01 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
                      <span style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Currency impact:</span>
                      <span style={{ color: signColor(data.currencyPnL) }}>
                        {Calc.formatCurrency(data.currencyPnL, activePortfolio?.baseCurrency)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Position Modal */}
      {showAddPosition && (
        <div style={styles.modalOverlay}>
          {React.createElement(window.AddPositionModal, {
            portfolioId: activePortfolioId,
            portfolios,
            apiKey: apiKey,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            onClose: closeAddPosition,
            onSave: handlePositionAdded,
            theme: theme,
            prefillSymbol: prefillSymbol,
            prefillType: prefillType,
            prefillAssetName: prefillAssetName,
          })}
        </div>
      )}

      {confirmDialog}
      {askElement}
      {/* Add Portfolio Modal */}
      {showAddPortfolio && (
        <div style={styles.modalOverlay}>
          <window.PTDialog.Frame onClose={() => { setShowAddPortfolio(false); setNewPortfolioNote(''); }} label="New portfolio" style={styles.modalContent}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>New Portfolio</h3>
              <button aria-label="Close" onClick={() => { setShowAddPortfolio(false); setNewPortfolioNote(''); }} style={styles.iconButton}>
                <Icon name="x" size={24} />
              </button>
            </div>
            <form noValidate onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.target); handleCreatePortfolio(fd.get('name'), newPortfolioCurrency); }}>
              <div style={{ marginBottom: 16 }}>
                <label htmlFor="pt-new-name-m" style={styles.label}>Portfolio Name</label>
                <input id="pt-new-name-m" name="name" type="text" placeholder="e.g., Retirement, Trading" style={{ ...styles.input, boxSizing: 'border-box' }} aria-required="true"
                  aria-describedby={newPortfolioNote ? 'pt-new-name-note-m' : undefined} onInput={() => newPortfolioNote && setNewPortfolioNote('')} />
                {newPortfolioNote && <div id="pt-new-name-note-m" role="alert" style={{ marginTop: 6, fontSize: 12, color: isDark ? '#fca5a5' : '#b91c1c' }}>{newPortfolioNote}</div>}
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={styles.label}>Base Currency</label>
                {React.createElement(window.PortalDropdown, {
                  value: newPortfolioCurrency,
                  options: window.PortfolioCalculations.BASE_CURRENCIES.map(([c,n]) => ({ value: c, label: c + ' - ' + n })),
                  onChange: setNewPortfolioCurrency,
                  isDark,
                  style: { width: '100%' },
                  minWidth: 0,
                  ariaLabel: 'Base currency',
                })}
              </div>
              <button type="submit" style={{ ...styles.button, ...styles.primaryButton, width: '100%', justifyContent: 'center', padding: '14px 24px' }}>
                Create Portfolio
              </button>
            </form>
          </window.PTDialog.Frame>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={styles.modalOverlay}>
          <window.PTDialog.Frame onClose={() => setShowSettings(false)} label="Portfolio settings" style={styles.modalContent}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isDark ? C3.textDark : C3.textLightTheme,
              }}>
                <Icon name="settings" size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: isDark ? C3.textDark : C3.textLightTheme }}>Portfolio Settings</h3>
                <p style={{ fontSize: 12, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Manage preferences & data</p>
              </div>
              <button aria-label="Close" onClick={() => setShowSettings(false)} style={styles.iconButton}>
                <Icon name="x" size={20} />
              </button>
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => { const data = Storage.exportAll(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`; a.click(); }}
                style={{
                  width: '100%', padding: '14px 20px', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  color: isDark ? C3.textDark : C3.textLightTheme,
                  fontSize: 14, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  transition: 'background 0.2s',
                }}
              >
                <Icon name="download" size={18} />
                <span style={{ color: isDark ? C3.textDark : C3.textLightTheme }}>Export Backup (JSON)</span>
              </button>
              {activePortfolio && portfolios.length > 1 && (
                <button
                  onClick={() => { handleDeletePortfolio(activePortfolioId); setShowSettings(false); }}
                  style={{
                    width: '100%', padding: '14px 20px', borderRadius: 14, cursor: 'pointer',
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    color: C3.error, fontSize: 14, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  }}
                >
                  <Icon name="trash" size={18} />
                  <span>Delete "{activePortfolio.name}"</span>
                </button>
              )}
            </div>
          </window.PTDialog.Frame>
        </div>
      )}


      {/* Import CSV Modal */}
      {showImportCSV && (
        <div style={styles.modalOverlay}>
          {React.createElement(window.ImportCSVModal, {
            portfolioId: activePortfolioId,
            apiKey,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            onClose: () => setShowImportCSV(false),
            onImport: handleImported,
            theme: theme
          })}
        </div>
      )}
      {importReport && window.ImportReportDialog && (
        <div style={styles.modalOverlay}>
          {React.createElement(window.ImportReportDialog, { report: importReport, onClose: () => setImportReport(null), theme })}
        </div>
      )}

      {/* Transaction History View */}
      {showTransactionHistory && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {React.createElement(window.TransactionHistoryView, {
            apiKey,
            holding: selectedHolding,
            portfolioId: activePortfolioId,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            onClose: () => { setShowTransactionHistory(false); setSelectedHolding(null); },
            onUpdate: () => { const ph = Storage.getHoldingsByPortfolio(activePortfolioId); setHoldings(ph); loadHoldingsPrices(ph); },
            theme: theme
          })}
        </div>
      )}

      {/* Analytics View */}
      {showAnalytics && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          {React.createElement(window.PortfolioAnalyticsView, {
            portfolioId: activePortfolioId,
            apiKey: apiKey,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            holdings: holdings,
            holdingsData: holdingsData,
            pricesLoading: pricesPending, onRetryPrices: retryPrices,
            initialTab: analyticsTab || undefined,
            onClose: closeTool(setShowAnalytics),
            theme: theme
          })}
        </div>
      )}

      {/* Tax View */}
      {showTaxView && window.TaxView && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          {React.createElement(window.TaxView, {
            portfolioId: activePortfolioId,
            holdings: holdings,
            holdingsData: holdingsData,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            onClose: () => setShowTaxView(false),
            theme: theme
          })}
        </div>
      )}

      {/* Macro Dashboard View */}
      {showMacroDashboard && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          {React.createElement(window.MacroDashboardView, {
            portfolioId: activePortfolioId,
            apiKey: apiKey,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            totalValue: totalValue,
            totalReturn: noneValued ? null : totalReturnPercent, // the header's figure, not open-lot P&L
              annualReturn: !noneValued && moneyWeighted ? moneyWeighted.annual : null, // money-weighted (IRR)
            onRetryPrices: noneValued ? retryPrices : null,
            onClose: () => setShowMacroDashboard(false),
            theme: theme
          })}
        </div>
      )}

      {/* Portfolio Health View */}
      {showPortfolioHealth && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          {React.createElement(window.PortfolioHealthView, {
            holdings: holdings,
            positions: holdingsWithData,
            apiKey: apiKey,
            pricesLoading: pricesPending, onRetryPrices: retryPrices,
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            onClose: () => setShowPortfolioHealth(false),
            theme: theme
          })}
        </div>
      )}


      {/* Edit Position Modal */}
      {editHolding && (
        <div style={styles.modalOverlay}>
          {React.createElement(window.EditPositionModal, {
            apiKey,
            holding: editHolding,
            holdingData: holdingsData[editHolding.id],
            baseCurrency: activePortfolio?.baseCurrency || 'USD',
            onClose: () => setEditHolding(null),
            onSave: () => { if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_portfolio_manage', { action: 'edit' }); setEditHolding(null); const ph = Storage.getHoldingsByPortfolio(activePortfolioId); setHoldings(ph); loadHoldingsPrices(ph); },
            theme: theme
          })}
        </div>
      )}

      {/* AI Chat View (opened via header chat button) */}
      {showAIChat && window.AIChatView && (
        React.createElement(window.AIChatView, {
          holdings: holdings,
          holdingsData: holdingsData,
          onClose: () => setShowAIChat(false),
          theme: theme
        })
      )}

      {/* AI Insights Board (opened via Pro Tools) */}
      {showAIInsights && window.AIInsightsView && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
          {React.createElement(window.AIInsightsView, {
            holdings: holdings,
            holdingsData: holdingsData,
            portfolioId: activePortfolioId,
            onClose: closeTool(setShowAIInsights),
            theme: theme
          })}
        </div>
      )}

      {/* Rebalancing Advisor */}
      {showRebalancingAdvisor && window.RebalancingAdvisor && React.createElement(
        window.RebalancingAdvisor, {
          holdings: holdings,
          holdingsData: holdingsData,
          onRetryPrices: retryPrices,
          theme: theme,
          onClose: closeTool(setShowRebalancingAdvisor),
        }
      )}

      {/* Bottom Navigation */}
      <div style={styles.bottomNav}>
        {[
          { id: 'dashboard', icon: 'chart', label: 'Home' },
          { id: 'markets', icon: 'trendUp', label: 'Markets' },
          { id: 'ai', icon: 'zap', label: 'AI' },
          { id: 'portfolio', icon: 'briefcase', label: 'Portfolio' },
          { id: 'news', icon: 'newspaper', label: 'News' },
        ].map(item => {
          const isActive = activeTab === item.id || (item.id === 'portfolio' && activeTab === 'portfolio');
          return (
            <button
              key={item.id}
              onClick={() => { if (item.id !== 'portfolio') onTabChange(item.id); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 16px', background: 'transparent', border: 'none', cursor: 'pointer', color: isActive ? '#f97316' : isDark ? C3.textMutedDark : C3.textMutedLight, transition: 'color 0.2s' }}
            >
              <Icon name={item.icon} size={24} color={isActive ? '#f97316' : isDark ? C3.textMutedDark : C3.textMutedLight} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* CSS Keyframes for spinner */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

/**
 * A render error inside the tracker, caught here with a way out that works.
 *
 * The page-level panel said "Reloading the page is the reliable way out",
 * and it was not: the data that broke the render is in localStorage and is
 * read again on the next load, so the reload showed the same panel. The ways out, least destructive first: try again; reset
 * the layout preferences; download a copy of the stored data; reset the keys
 * that do not parse (with confirmation); reset all portfolio data (with
 * confirmation, after downloading a copy).
 */
window.PortfolioTrackerBoundary = (() => {
  function Boundary(props) {
    React.Component.call(this, props);
    this.state = { error: null };
  }
  Boundary.prototype = Object.create(React.Component.prototype);
  Boundary.prototype.constructor = Boundary;
  Boundary.getDerivedStateFromError = (error) => ({ error: error || new Error('unknown error') });
  Boundary.prototype.componentDidCatch = function (error) {
    if (window.console && console.error) console.error('[portfolio] render error:', error);
  };
  const download = (snapshot) => {
    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `portfolio-raw-backup-${snapshot.savedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (e) { return false; }
  };
  Boundary.prototype.render = function () {
    const S = window.PortfolioStorage;
    // A saved list that does not parse is shown here before anything draws
    // from it: it read as an empty portfolio, and the next write replaced it.
    // Its text as found is kept aside first.
    const unreadable = S.unreadableKeys ? S.unreadableKeys() : [];
    if (!this.state.error && !unreadable.length) return this.props.children;
    if (unreadable.length && S.keepUnreadable) S.keepUnreadable();
    const isDark = this.props.theme === 'dark';
    const C3 = window.C3 || {};
    const muted = isDark ? (C3.textMutedDark || '#A39B89') : (C3.textMutedLight || '#4b5563');
    const text = isDark ? (C3.textDark || '#E9E6DF') : (C3.textLightTheme || '#1e1b4b');
    const broken = S.brokenKeys();
    const retry = () => this.setState({ error: null, notice: null });
    // The raw saved data on the clipboard: the way to keep a copy when the
    // browser will not download a file.
    const copy = (snapshot) => {
      const textOut = JSON.stringify(snapshot, null, 2);
      const ok = () => this.setState({ notice: 'Saved data copied to the clipboard. Paste it into a file before resetting.' });
      const fail = () => this.setState({ notice: 'Could not copy to the clipboard either; nothing has been deleted.' });
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textOut).then(ok, fail);
        else fail();
      } catch (err) { fail(); }
    };
    // Backup first, then a second, separate confirmation, then deletion.
    // A failed download stops here with nothing deleted (the reset used to delete regardless). The browser cannot always
    // say whether a download really landed, hence the second question.
    // Asked in this box, not with confirm(): first the
    // reset itself, then -- the copy offered for download -- the deletion.
    // The button that asked: Cancel and Escape put the focus back on it
    // (-- Cancel left it on <body>, Escape did nothing).
    const reset = (keys, question, ev) => {
      this._askOpener = (ev && ev.currentTarget) || document.activeElement;
      this.setState({ notice: null, ask: { step: 1, keys, question: question + ' A copy of all saved portfolio data is downloaded first.' } });
    };
    // The panel says "Restore a backup", so it offers one here: the button
    // only appeared after Reset unreadable data. The
    // file is checked first, then the replace is asked in this box.
    const restoreFile = (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try { parsed = JSON.parse(String(reader.result || '')); } catch (err) { this.setState({ ask: null, notice: 'This file is not a portfolio backup (it is not JSON).' }); return; }
        const problem = S.checkBackup ? S.checkBackup(parsed) : null;
        if (problem) { this.setState({ ask: null, notice: problem }); return; }
        this._askOpener = this._restoreBtn || document.activeElement;
        this.setState({ notice: null, ask: { step: 'restore', backup: parsed, question: 'Replace every portfolio, position and transaction in this browser with the backup? The unreadable text stays kept aside.' } });
      };
      reader.onerror = () => this.setState({ notice: 'The file could not be read.' });
      reader.readAsText(file);
    };
    const askYes = () => {
      const a = this.state.ask;
      if (!a) return;
      if (a.step === 'restore') {
        try {
          S.restoreBackup(a.backup);
        } catch (err) {
          this.setState({ ask: null, notice: (err && err.message) || 'The backup could not be restored.' });
          return;
        }
        this.setState({ ask: null });
        retry();
        return;
      }
      if (a.step === 1) {
        const r = S.resetWithBackup(a.keys, { backup: download, confirmDelete: () => false });
        if (r.reason === 'backup-failed') {
          this.setState({ ask: null, notice: 'The backup could not be downloaded, so nothing was deleted. Use "Copy saved data" to keep a copy, then try again.' });
          return;
        }
        this.setState({ ask: { step: 2, keys: a.keys, question: 'A backup file was offered for download (portfolio-raw-backup-….json). Check it was saved, then delete. Cancel keeps everything.' } });
        return;
      }
      S.resetKeys(a.keys);
      this.setState({ ask: null });
      retry();
    };
    // What Cancel left as it was: the restore replaces, the resets delete
    // ("Nothing was deleted." after "Replace every portfolio…?").
    const askNo = () => this.setState((s) => ({ ask: null, notice: s.ask && s.ask.step === 'restore' ? 'Nothing was replaced.' : 'Nothing was deleted.' }), () => {
      const opener = this._askOpener;
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    });
    const btn = (primary) => ({
      padding: '9px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13,
      border: primary ? 'none' : `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: primary ? '#c2410c' : 'transparent', color: primary ? '#fff' : text,
    });
    const e = React.createElement;
    const readFail = !this.state.error && unreadable.length > 0;
    return e('div', { role: 'alert', 'data-pt-recovery': readFail ? 'unreadable' : 'error', style: { margin: 16, padding: '20px 24px', borderRadius: 8, border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`, background: isDark ? '#1C1A14' : '#ffffff', color: text, lineHeight: 1.6 } },
      e('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 8 } }, readFail ? 'Some portfolio data saved in this browser cannot be read' : 'The portfolio could not be drawn from the data saved in this browser'),
      e('p', { style: { margin: '0 0 8px', fontSize: 14, color: muted } },
        readFail
          ? `${unreadable.join(', ')} ${unreadable.length === 1 ? 'is' : 'are'} not readable, so the portfolio is not shown as empty and nothing is saved over ${unreadable.length === 1 ? 'it' : 'them'}. A copy of the text as found is kept in this browser (${S.UNREADABLE_BACKUP_KEY}) and is part of "Download saved data". Restore a backup, or reset the unreadable data to start that part over.`
          : 'Reloading will not fix this: the same saved data is read again on every load. '
        + (broken.length
          ? `${broken.length} saved item${broken.length === 1 ? ' is' : 's are'} not in the expected format (${broken.join(', ')}). Resetting ${broken.length === 1 ? 'it' : 'them'} usually fixes it.`
          : 'Try resetting the layout first; if that does not help, download a copy and reset the portfolio data.')),
      !readFail && e('pre', { style: { margin: '0 0 16px', padding: '8px 10px', borderRadius: 4, background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', fontSize: 12, whiteSpace: 'pre-wrap', color: muted } },
        String((this.state.error && this.state.error.message) || this.state.error)),
      readFail && e('div', { style: { height: 8 } }),
      e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        e('button', { style: btn(false), onClick: retry }, 'Try again'),
        e('button', { style: btn(false), onClick: () => { S.resetKeys(S.VIEW_PREF_KEYS); retry(); } }, 'Reset layout'),
        e('button', { style: btn(false), onClick: () => { if (!download(S.rawSnapshot())) this.setState({ notice: 'The download did not start. Use "Copy saved data" instead.' }); } }, 'Download saved data'),
        e('button', { style: btn(false), onClick: () => copy(S.rawSnapshot()) }, 'Copy saved data'),
        S.restoreBackup && e('button', {
          type: 'button', style: btn(false), 'data-pt-restore': 'true',
          ref: (n) => { this._restoreBtn = n; },
          onClick: () => { if (this._restoreInput) this._restoreInput.click(); },
        }, 'Restore a backup…'),
        S.restoreBackup && e('input', { ref: (n) => { this._restoreInput = n; }, type: 'file', accept: 'application/json,.json', tabIndex: -1, 'aria-hidden': 'true', style: { display: 'none' }, onChange: restoreFile }),
        broken.length > 0 && e('button', {
          style: btn(true),
          onClick: (ev) => reset(broken, `Reset ${broken.join(', ')}? The rest of the saved data is kept.`, ev),
        }, 'Reset unreadable data'),
        e('button', {
          style: btn(broken.length === 0),
          onClick: (ev) => reset(S.allKeys(), 'Reset all portfolio data in this browser — portfolios, holdings, transactions and settings?', ev),
        }, 'Reset all portfolio data…')
      ),
      this.state.ask && e('div', { role: 'group', 'aria-label': this.state.ask.step === 'restore' ? 'Restore the backup?' : this.state.ask.step === 1 ? 'Reset saved data?' : 'Delete now?',
        onKeyDown: (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); askNo(); } }, style: { margin: '12px 0 0', padding: '12px 14px', borderRadius: 6, border: `1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}` } },
        e('p', { style: { margin: '0 0 10px', fontSize: 14 } }, this.state.ask.question),
        e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          e('button', { style: btn(false), onClick: askNo, autoFocus: true }, 'Cancel'),
          e('button', { style: btn(true), onClick: askYes }, this.state.ask.step === 'restore' ? 'Replace' : this.state.ask.step === 1 ? 'Download a copy and continue' : 'Delete'))),
      this.state.notice && e('p', { role: 'status', style: { margin: '12px 0 0', fontSize: 13, color: text } }, this.state.notice)
    );
  };
  return Boundary;
})();

window.PortfolioTrackerView = (props) => React.createElement(
  window.PortfolioTrackerBoundary, { theme: props.theme },
  React.createElement(window.PortfolioTrackerViewInner, props)
);
