// The conversation outlives the screen: the chat is unmounted when the
// reader opens another page, and every answer costs tokens -- coming back used
// to show an empty chat, so re-reading an answer meant paying for it again.
// Threads live for the browser session (sessionStorage; "Sign out" clears it),
// one per chat kind, and are tied to the account that wrote them. An answer
// that arrives after the chat was closed is still stored.
// Is a question about the watchlist ("how is my watchlist doing", "which of
// my stocks…")? Only then is the watchlist sent with it.
window.AIChatAboutWatchlist = (text) => /\bwatch\s?-?list|\bmy (?:stocks|tickers|symbols|assets|names|holdings)\b|\bwhat i(?:'m| am) watching\b/i.test(String(text || ''));

window.AIChatStore = (() => {
  const KEY = 'eodhd_ai_chat_v1';
  const MAX_MESSAGES = 60;
  const pending = new Set();
  let memory = null; // used when sessionStorage is unavailable
  let storageFailed = false;
  const owner = () => {
    let key = '', tg = '';
    try { key = localStorage.getItem('eodhd_api_key') || ''; } catch (_) {}
    return `${tg}:${key.slice(-6)}`;
  };
  const read = () => {
    let all;
    // memory only stands in for a sessionStorage that cannot be read; a
    // cleared one ("Sign out") is empty, not a reason to bring the copy back.
    try { all = storageFailed ? memory : JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { all = memory; }
    return all && all.owner === owner() && all.threads ? all : { owner: owner(), threads: {} };
  };
  const write = (all) => {
    memory = all;
    // A write that fails (quota, blocked storage) must not lose the message
    // on screen: from then on this page reads its own copy.
    try { sessionStorage.setItem(KEY, JSON.stringify(all)); storageFailed = false; } catch (_) { storageFailed = true; }
    try { window.dispatchEvent(new Event('ai-chat-store')); } catch (_) {}
  };
  return {
    owner,
    load: (thread) => read().threads[thread] || [],
    // asOwner: who asked. An answer that comes back after the account changed
    // (another key connected meanwhile) belongs to nobody here and is dropped
    // rather than written into the new account's thread.
    append: (thread, message, asOwner) => {
      if (asOwner != null && asOwner !== owner()) return;
      const all = read();
      all.threads[thread] = (all.threads[thread] || []).concat([message]).slice(-MAX_MESSAGES);
      write(all);
    },
    clear: (thread) => { const all = read(); delete all.threads[thread]; write(all); },
    isPending: (thread) => pending.has(thread),
    setPending: (thread, on) => { if (on) pending.add(thread); else pending.delete(thread); try { window.dispatchEvent(new Event('ai-chat-store')); } catch (_) {} },
  };
})();

// Text typed and not sent, per person and conversation, for this page
// session: closing the chat (Esc, its Back arrow, Telegram Back) lost it
// without a word. Reopening the same chat gives it back.
const aiChatDrafts = {};

// Where focus goes when the chat closes: the control that opened it, or --
// when that one was unmounted with the page the chat replaced -- the control
// with the same name on the page that comes back. Not over a control the
// person has since moved to.
const aiChatOpener = () => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const name = (e) => e.getAttribute('aria-label') || e.getAttribute('placeholder') || (e.textContent || '').trim();
  return { el, tag: el.tagName, name: name(el), nameOf: name };
};
const aiChatRefocus = (o) => {
  if (!o) return;
  let tries = 0;
  const attempt = () => {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement && document.contains(a)) return;
    let t = o.el.isConnected ? o.el : null;
    if (!t && o.name) t = Array.from(document.querySelectorAll(o.tag)).find((e) => o.nameOf(e) === o.name && e.getClientRects().length);
    if (t) { try { t.focus({ preventScroll: true }); } catch (_) {} return; }
    if (++tries < 6) setTimeout(attempt, 50);
  };
  setTimeout(attempt, 0);
};

// The watchlist's prices for the chat's "[My watchlist: …]" line. The app
// keeps its quotes as a list of { symbol, data } rows; read as a map by
// symbol, no price was ever found and the line carried tickers only.
// At most `max` characters, then "and N more": a watchlist of 300 filled the
// message and the server refused it after the card's data was fetched.
window.AIChatWatchlistLine = (watchlist, watchlistData, max = 1000) => {
  const items = (watchlist || []).map((w) => {
    const sym = String((w && w.symbol) || '');
    if (!sym) return '';
    const row = Array.isArray(watchlistData)
      ? watchlistData.find((r) => r && r.symbol === sym)
      : (watchlistData && (watchlistData[sym] || watchlistData[w.id]));
    const d = (row && row.data && typeof row.data === 'object' ? row.data : row) || {};
    const price = Number(d.close != null && d.close !== 'NA' ? d.close : d.price);
    const chg = Number(d.change_p);
    const name = sym.split('.')[0];
    if (!(price > 0)) return name;
    return `${name}: ${price} ${Number.isFinite(chg) && d.change_p != null ? `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%` : ''}`.trim();
  }).filter(Boolean);
  let out = '';
  for (let i = 0; i < items.length; i++) {
    const next = (out ? `${out}, ` : '') + items[i];
    if (next.length > max - 16 && i < items.length - 1) return `${out} and ${items.length - i} more`;
    out = next;
  }
  return out;
};

// What is left of a message, in characters, for a card's data, kept clear
// of the server's bound (AIService.CHAT_LIMITS) by this much.
const AI_CHAT_MESSAGE_MARGIN = 100;

// A card's data being fetched, per conversation, shared by every mount of
// the chat. The fetch ran in the closure of the card
// that started it: closing the card did not stop it, and it went on to ask
// the AI, charged, after the card was gone; a card reopened meanwhile
// offered a second Run, and both charged. Now a run holds its conversation
// here while its data loads: another mount shows it loading and starts
// nothing; closing the card or changing the watchlist drops it, and a
// dropped run asks the AI nothing.
window.AIChatPreparing = (() => {
  const live = new Map();
  let seq = 0;
  const tell = () => { try { window.dispatchEvent(new Event('ai-chat-store')); } catch (_) {} };
  return {
    begin: (thread) => {
      if (live.has(thread)) return null;
      seq += 1;
      const t = { thread, id: seq };
      live.set(thread, t);
      tell();
      return t;
    },
    current: (t) => !!t && live.get(t.thread) === t,
    end: (t) => { if (t && live.get(t.thread) === t) { live.delete(t.thread); tell(); } },
    active: (thread) => live.has(thread),
  };
})();

// AI Portfolio Chat Component
// `autoSend` (default true): the initialPrompt is asked on opening -- right
// for a button that already named its price (Portfolio's quick actions). The
// AI tab's cards pass false: opening is free, the prompt waits under a priced
// "Run".
// `dataFor` (optional): a card whose question promises data (Insider Pulse,
// Smart Money Moves, Earnings AI, News Digest) passes the function that
// fetches it -- ({ budget }) => AIActionData result. Its question is sent
// with that data; when there is none to send (an empty watchlist, every
// request failed, the plan lacks it) the AI is not asked and nothing is
// charged. `dataCheck`: that result known before anything is fetched (an
// empty watchlist, the plan), shown on opening instead of the priced Run.
// `dataLoading`: what the Run button says while the data loads.
// `onAddTickers`: where "Add tickers" goes when the watchlist has none.
window.AIChatView = ({ holdings, holdingsData, watchlist, watchlistData, onClose, theme, initialPrompt, title, subtitle, autoSend = true, asPage = false, dataFor = null, dataCheck = null, dataLoading = null, onAddTickers = null }) => {
  // Telegram's Back closes the chat, wherever it was opened (the floating
  // button, Portfolio, the AI tab).
  // Every message is a paid portfolio question (analyzePortfolio ->
  // portfolio_qa); the chat itself said nothing of the price, only the hub
  // card did.
  const useFeatureCost = (() => null);
  const msgCost = useFeatureCost('portfolio_qa');
  const Store = window.AIChatStore;
  const thread = subtitle || 'chat';
  const greeting = subtitle
    ? `Hi! I'm ready to help with: **${subtitle}**. Let me analyze the data for you.`
    : `Hi! I'm your AI market assistant. Ask me anything about your portfolio, watchlist, market trends, and more.`;
  const withGreeting = (stored) => [{ role: 'assistant', content: greeting }].concat(stored);
  const [messages, setMessages] = React.useState(() => withGreeting(Store.load(thread)));
  const draftKey = Store.owner() + '|' + thread;
  const [input, setInput] = React.useState(() => aiChatDrafts[draftKey] || '');
  React.useEffect(() => {
    if (input) aiChatDrafts[draftKey] = input; else delete aiChatDrafts[draftKey];
  }, [input]);
  const opener = React.useRef(undefined);
  if (opener.current === undefined) opener.current = aiChatOpener();
  React.useEffect(() => () => aiChatRefocus(opener.current), []);
  // The card's question was asked in this conversation before (answered, or
  // on its way): reopening the card shows the conversation, not a second
  // "Run" for the same question -- that was two taps from paying twice. A new run is a separate, plainly labelled "Ask again".
  const askedBefore = !autoSend && !!initialPrompt
    && Store.load(thread).some((m) => m.role === 'user' && String(m.content || '').trim() === initialPrompt.trim());
  // A card that can tell on opening that it has nothing to send (an empty
  // watchlist, the plan) says so in place of its priced Run. `fromCheck`:
  // said by that check, so it goes when the check passes.
  const fromCheck = (c) => (c ? { ...c, fromCheck: true } : null);
  const [blocked, setBlocked] = React.useState(() => (dataCheck && !askedBefore ? fromCheck(dataCheck) : null));
  const [waiting, setWaiting] = React.useState(() => (!autoSend && initialPrompt && !askedBefore && !blocked ? initialPrompt : null));
  const [askAgain, setAskAgain] = React.useState(() => (askedBefore ? initialPrompt : null));
  const [loading, setLoading] = React.useState(() => Store.isPending(thread));
  const [error, setError] = React.useState(null);
  // The card's data is loading (in this mount or another one of the same
  // conversation): its button says so, and a second tap -- or anything
  // else sent meanwhile -- asks nothing. One Run, one charge.
  const Prep = window.AIChatPreparing;
  const [preparing, setPreparing] = React.useState(() => Prep.active(thread));
  const mineRef = React.useRef(null);        // the run this mount started
  const mountedRef = React.useRef(true);
  React.useEffect(() => () => {
    mountedRef.current = false;
    // Closed while the data loads: the run is dropped, nothing is asked.
    if (mineRef.current) { Prep.end(mineRef.current); mineRef.current = null; }
  }, []);
  // The watchlist the data is read for. Changed while it loads: the run is
  // dropped -- AAPL's filings were sent after AAPL was replaced by MSFT.
  const wlSig = (watchlist || []).map((w) => (w && w.symbol) || '').join(',');
  const wlSigRef = React.useRef(wlSig);
  wlSigRef.current = wlSig;
  React.useEffect(() => {
    if (!mineRef.current) return;
    Prep.end(mineRef.current);
    mineRef.current = null;
    setWaiting(null);
    setAskAgain(null);
    setBlocked({ status: 'empty', reason: 'changed', retry: true, message: 'Your watchlist changed while its data loaded, so nothing was sent to the AI and you were not charged. Run it again for the watchlist as it is now.' });
  }, [wlSig]);
  const isDataQuestion = (text) => !!dataFor && !!initialPrompt && String(text || '').trim() === initialPrompt.trim();
  // The card's question asked in this conversation already.
  const askedNow = () => !!initialPrompt
    && Store.load(thread).some((m) => m.role === 'user' && String(m.content || '').trim() === initialPrompt.trim());

  // Eligibility can change while the card is open -- the plan's
  // capabilities arrive, an entitled key is connected, the watchlist is
  // filled: what the check said on opening follows it. A refusal that went
  // stayed on screen with no Run and no way on.
  const checkKey = dataCheck ? [dataCheck.status, dataCheck.reason || '', dataCheck.message || dataCheck.subject || ''].join('|') : '';
  const checkSeen = React.useRef(checkKey);
  React.useEffect(() => {
    if (checkSeen.current === checkKey) return;
    checkSeen.current = checkKey;
    if (Prep.active(thread) || Store.isPending(thread)) return;
    if (dataCheck) { setBlocked(fromCheck(dataCheck)); setWaiting(null); setAskAgain(null); return; }
    if (blocked && blocked.fromCheck) {
      setBlocked(null);
      if (askedNow()) setAskAgain(initialPrompt);
      else if (!autoSend && initialPrompt) setWaiting(initialPrompt);
    }
  }, [checkKey]);
  const messagesEndRef = React.useRef(null);

  const C3 = window.C3;
  const isDark = theme === 'dark';
  const AI = window.AIService;

  const Icon = ({ name, size = 24, color }) => {
    return React.createElement('svg', {
      style: { width: size, height: size, flexShrink: 0 },
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color || 'currentColor',
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  // Quick question suggestions
  const suggestions = [
    "What's my biggest risk?",
    "How diversified am I?",
    "Which positions are underperforming?",
    "Should I rebalance?",
    "What's my sector exposure?"
  ];

  // Scroll to bottom when new messages arrive
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add initial greeting and auto-send initialPrompt if provided
  const initialSent = React.useRef(false);
  React.useEffect(() => {
    // A quick action asks its question on every open, as before -- except
    // when the same question is still waiting for its answer (the reader
    // left and came back): that one is not sent, or charged, twice.
    const asked = Store.load(thread).map((m) => m.role === 'user' && m.content).filter(Boolean);
    const alreadyAsked = !!initialPrompt && Store.isPending(thread) && asked[asked.length - 1] === initialPrompt.trim();
    if (alreadyAsked) setWaiting(null);
    if (autoSend && initialPrompt && !initialSent.current && !alreadyAsked) {
      initialSent.current = true;
      setTimeout(() => sendMessage(initialPrompt), 300);
    }
    // An answer to a question asked before this chat was closed and reopened,
    // and a card's data loading in another mount of the same conversation.
    const onStore = () => { setMessages(withGreeting(Store.load(thread))); setLoading(Store.isPending(thread)); setPreparing(Prep.active(thread)); };
    window.addEventListener('ai-chat-store', onStore);
    return () => window.removeEventListener('ai-chat-store', onStore);
  }, []);

  const newChat = () => {
    if (loading || Prep.active(thread)) return;
    Store.clear(thread);
    setError(null);
    // A fresh conversation has not asked the card's question: it waits under
    // "Run" again, as on opening the card.
    setAskAgain(null);
    setBlocked(fromCheck(dataCheck));
    setWaiting(!autoSend && initialPrompt && !dataCheck ? initialPrompt : null);
  };

  // The user turn as the server gets it (AIService.portfolioQuestion), in
  // characters, and the bounds it is checked against (the terminal's server: 8000 a
  // message, 24000 for the turns). Without them (an older service) the
  // portfolio context alone is measured.
  const LIMITS = (AI && AI.CHAT_LIMITS) || { message: 8000, total: 24000 };
  const userTurnLength = (question) => {
    try {
      if (AI.portfolioQuestion) return AI.portfolioQuestion(holdings, holdingsData, question).length;
      return String(AI.buildPortfolioContext ? AI.buildPortfolioContext(holdings, holdingsData) : '').length + 40 + question.length;
    } catch (_) { return 40 + question.length; }
  };
  // A sentence when the message would be over the server's bounds -- it is
  // not sent then (the server refused it with a 400) -- else null.
  const overLimit = (question, withData) => {
    const n = userTurnLength(question);
    if (n <= LIMITS.message && n <= LIMITS.total) return null;
    return `${withData ? 'This question and its data are' : 'This message is'} too long to send (${n.toLocaleString('en-US')} characters; the limit is ${LIMITS.message.toLocaleString('en-US')}). Nothing was sent to the AI and you were not charged.`;
  };

  // The card's data, fetched before the question is asked, sized to what is
  // left of the message around it. A failure of the fetch itself reads as
  // one that did not load.
  const fetchData = async (context, text) => {
    const budget = LIMITS.message - AI_CHAT_MESSAGE_MARGIN - userTurnLength(context + text) - 2;
    try {
      const got = await dataFor({ budget });
      if (got && got.status) return got;
      throw new Error('no data result');
    } catch (e) {
      const RLW = window.RateLimitWait;
      return { status: 'failed', what: 'The data', failure: RLW ? RLW.failure(e) : { status: 0 } };
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading || Prep.active(thread)) return;
    const withData = isDataQuestion(text);
    // Anything sent takes the card's waiting question away: never two paid
    // paths on screen. It is not kept across a reload or
    // Back/Forward either -- an address carries no unasked question. The
    // card's own question keeps its button on screen, busy, while its data
    // loads.
    if (!withData) { setWaiting(null); setAskAgain(null); }
    setBlocked(null);

    // Only when the question is about the watchlist. Sent with every
    // question, it put tickers nobody asked about into the answer ("I do
    // not have the P/E for EURUSD, GOOGL…" to a question about AAPL) and
    // took the server's look-ups from the instrument asked about.
    let context = '';
    if (watchlist && watchlist.length > 0 && window.AIChatAboutWatchlist(text)) {
      context = `[My watchlist: ${window.AIChatWatchlistLine(watchlist, watchlistData)}]\n\n`;
    }

    const asker = Store.owner();
    let data = null;
    if (withData) {
      const run = Prep.begin(thread);
      if (!run) return;
      mineRef.current = run;
      const forWatchlist = wlSigRef.current;
      setPreparing(true);
      setError(null);
      data = await fetchData(context, text);
      // Still this card's run? Closed, the watchlist changed, another
      // account: dropped -- the AI is not asked and nothing is charged.
      const still = Prep.current(run) && mountedRef.current && wlSigRef.current === forWatchlist && Store.owner() === asker;
      Prep.end(run);
      if (mineRef.current === run) mineRef.current = null;
      if (!still) return;
      setPreparing(false);
      setWaiting(null);
      setAskAgain(null);
      // Nothing to send: said here, and the AI is not asked -- no charge.
      if (data.status !== 'ok') { setBlocked(data); return; }
    }

    const enrichedText = context + (data && data.block ? data.block + '\n\n' : '') + text;
    const tooLong = overLimit(enrichedText, withData);
    if (tooLong) {
      if (withData) setBlocked({ status: 'empty', reason: 'size', message: tooLong });
      else setError(tooLong);
      return;
    }

    // `note`: what data went with the card's question, and what did not load.
    const userMessage = { role: 'user', content: text.trim(), ...(data && data.note ? { note: data.note } : {}) };
    Store.append(thread, userMessage);
    // Only what was typed is cleared: a quick action's question or a
    // suggestion sent over a draft leaves the draft where it is.
    setInput((cur) => (cur.trim() === text.trim() ? '' : cur));
    Store.setPending(thread, true);
    setError(null);
    if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_ai_chat_submit', { prompt_length: text.trim().length });

    try {
      const response = await AI.analyzePortfolio(holdings, holdingsData, enrichedText);
      Store.append(thread, { role: 'assistant', content: response }, asker);
    } catch (e) {
      // AIService errors with a code already read as a sentence ("AI is
      // temporarily unavailable. You were not charged..."); prefixing them with
      // "Sorry, I encountered an error:" is what turned an outage into
      // "API error: 502".
      const msg = e && e.message === 'AI_TOKENS_REQUIRED'
        ? 'AI analysis is off. Add OPENAI_API_KEY to .env and restart to enable it.'
        : (e && e.code ? e.message : `Sorry, I encountered an error: ${e && e.message}`);
      setError(msg);
      Store.append(thread, { role: 'assistant', content: msg }, asker);
    }

    Store.setPending(thread, false);
  };

  // A prompt sent from elsewhere on the page while the chat is open (the
  // portfolio's quick actions used to dispatch this with no listener at all). The ref keeps the latest sendMessage, whose closure
  // knows whether a reply is still loading.
  const sendRef = React.useRef(sendMessage);
  sendRef.current = sendMessage;
  React.useEffect(() => {
    const onPrompt = (e) => {
      const prompt = e && e.detail && e.detail.prompt;
      if (typeof prompt === 'string' && prompt.trim()) sendRef.current(prompt);
    };
    window.addEventListener('ai-chat-prompt', onPrompt);
    return () => window.removeEventListener('ai-chat-prompt', onPrompt);
  }, []);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // The Mini App's bottom navigation sits above this full-screen chat and hid
  // its input row once the suggestions were gone (after the first message
  // there was nowhere to type). The chat ends where the navigation begins.
  const [navHeight, setNavHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    const nav = document.querySelector('[data-bottom-nav]');
    setNavHeight(nav ? Math.ceil(nav.getBoundingClientRect().height) : 0);
  }, []);

  const styles = {
    container: {
      position: 'fixed',
      inset: 0,
      bottom: navHeight,
      background: isDark ? C3.bgGradientDark : C3.bgGradientLight,
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      padding: '12px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    },
    messages: {
      flex: 1,
      overflowY: 'auto',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    },
    message: (isUser) => ({
      maxWidth: '85%',
      padding: '12px 16px',
      borderRadius: 16,
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      background: isUser
        ? C3.logoGradient
        : (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
      color: isUser ? 'white' : (isDark ? C3.textDark : C3.textLightTheme),
      fontSize: 14,
      lineHeight: 1.5,
      wordBreak: 'break-word',
    }),
    inputArea: {
      ...(isDark ? C3.glassDark : C3.glassLight),
      padding: 16,
      borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
    },
    inputRow: {
      display: 'flex',
      gap: 8,
    },
    input: {
      flex: 1,
      padding: '12px 16px',
      borderRadius: 24,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 14,
      outline: 'none',
      resize: 'none',
    },
    sendButton: {
      width: 48,
      height: 48,
      flexShrink: 0, // a round 48 px target whatever the field beside it asks
      borderRadius: 24,
      background: C3.logoGradient,
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      opacity: loading ? 0.5 : 1,
    },
    suggestions: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginTop: 12,
    },
    suggestion: {
      padding: '8px 12px',
      borderRadius: 16,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
      border: 'none',
      cursor: 'pointer',
      fontSize: 12,
      color: isDark ? C3.textDark : C3.textLightTheme,
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
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <button aria-label="Back" onClick={onClose} style={styles.iconButton}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div style={{ flex: 1 }}>
          {/* The screen's heading when it is the page (#/ai-chat); a section inside Portfolio. */}
          {React.createElement(asPage ? 'h1' : 'h2', { style: { fontSize: 18, fontWeight: 700, margin: 0 } }, title || 'AI Portfolio Assistant')}
          <p style={{ fontSize: 12, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            {subtitle || 'Ask questions about your portfolio'}
          </p>
        </div>
        {messages.length > 1 && (
          <button onClick={newChat} disabled={loading} aria-label="New chat" title="Clear this conversation and start a new one" style={{
            ...styles.iconButton, minHeight: 40, minWidth: 40, padding: '8px 10px', gap: 6, fontSize: 12, fontWeight: 600,
            opacity: loading ? 0.5 : 1,
          }}>
            <Icon name="plus" size={16} />
            {/* Icon alone on a 320 px phone: the words pushed the title to two lines. */}
            {window.innerWidth >= 360 ? 'New chat' : null}
          </button>
        )}
        <div style={{
          padding: '4px 10px',
          borderRadius: 12,
          background: `${C3.success}20`,
          color: C3.success,
          fontSize: 11,
          fontWeight: 600,
        }}>
          AI
        </div>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <React.Fragment key={i}>
            <div style={styles.message(msg.role === 'user')}>
              {msg.role === 'user' ? msg.content : (window.renderMarkdown ? window.renderMarkdown(msg.content) : msg.content)}
            </div>
            {/* What data went with a card's question, and what did not load. */}
            {msg.note && (
              <div data-ai-data-note="true" style={{ alignSelf: 'flex-end', maxWidth: '85%', marginTop: -6, fontSize: 11, lineHeight: 1.4, textAlign: 'right', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                {msg.note}
              </div>
            )}
          </React.Fragment>
        ))}

        {loading && (
          <div style={{ ...styles.message(false), display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: C3.glowOrange,
              animation: 'pulse 1s infinite'
            }} />
            <span>Thinking...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner: only when the error is not already the last message
          of the conversation -- it said the same thing twice. */}
      {error && !(messages.length && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content === error) && (
        <div style={{
          margin: '0 16px',
          padding: 12,
          borderRadius: 12,
          background: `${C3.error}20`,
          color: C3.error,
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ padding: '4px 16px', textAlign: 'center', fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
        AI-generated content — for informational purposes only, not financial advice
      </div>

      {/* The card's question, ready and not yet asked: one priced tap runs it.
          While the card's data loads the button says so and takes no tap. */}
      {waiting && (
        <div data-ai-waiting="true" style={{ margin: '0 16px 8px', padding: 12, borderRadius: 12, border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, background: isDark ? C3.fillDark : C3.fillLight, fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 10 }}>{waiting}</div>
          <button onClick={() => sendMessage(waiting)} disabled={loading || preparing} aria-busy={preparing ? 'true' : undefined} style={{
            width: '100%', minHeight: 44, padding: '10px 16px', borderRadius: 10, border: 'none',
            background: window.C3.logoGradient, color: 'white', fontSize: 14, fontWeight: 600, cursor: preparing ? 'progress' : 'pointer',
            opacity: preparing ? 0.75 : 1,
          }}>{preparing ? (dataLoading || 'Loading the data…') : (msgCost ? `Run · ${msgCost}` : 'Run')}</button>
        </div>
      )}

      {askAgain && !loading && (
        <div style={{ margin: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.85 }}>
          <span style={{ flex: 1 }}>Answered above.</span>
          <button onClick={() => sendMessage(askAgain)} disabled={preparing} aria-busy={preparing ? 'true' : undefined} style={{
            minHeight: 40, padding: '6px 12px', borderRadius: 8, cursor: preparing ? 'progress' : 'pointer', background: 'none',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, color: 'inherit', fontSize: 12, fontWeight: 600,
          }}>{preparing ? (dataLoading || 'Loading the data…') : (msgCost ? `Ask again · ${msgCost}` : 'Ask again')}</button>
        </div>
      )}

      {/* A card with nothing to send: the AI was not asked and nothing was
          charged. Why, and the way on: add tickers, try again, or the plan. */}
      {blocked && !loading && !preparing && (() => {
        const RLW = window.RateLimitWait;
        const box = { margin: '0 16px 8px', padding: 12, borderRadius: 12, border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, background: isDark ? C3.fillDark : C3.fillLight, fontSize: 13, lineHeight: 1.5, color: isDark ? C3.textDark : C3.textLightTheme };
        const btn = { marginTop: 10, minHeight: 40, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'none', border: `1px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}`, color: 'inherit', fontSize: 13, fontWeight: 600 };
        const NOT_ASKED = 'Nothing was sent to the AI and you were not charged.';
        const retry = () => sendMessage(initialPrompt);
        if (blocked.status === 'failed') {
          return (
            <div data-ai-blocked="failed" style={box}>
              {RLW && RLW.FailNote
                ? React.createElement(RLW.FailNote, { what: blocked.what, failure: blocked.failure, isDark, autoRetry: false, onRetry: retry, extra: NOT_ASKED, ownFocus: true })
                : <span role="status">{`${blocked.what || 'The data'} did not load. ${NOT_ASKED}`}</span>}
            </div>
          );
        }
        if (blocked.status === 'plan') {
          const Card = window.PlanNotice && window.PlanNotice.RefusalCard;
          return (
            <div data-ai-blocked="plan" style={{ margin: '0 16px 8px' }}>
              {Card ? React.createElement(Card, { refusal: blocked.refusal, subject: blocked.subject, isDark }) : <div role="alert" style={box}>{`${blocked.subject || 'This data'} is not included in your plan.`}</div>}
              <div style={{ fontSize: 12, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{NOT_ASKED}</div>
              {/* The server refused it when fetched, or the plan check passes
                  now (a key or a plan added): it can be asked again. While
                  the check still refuses, a retry would only refuse again. */}
              {!dataCheck && <button type="button" onClick={retry} style={btn}>Try again</button>}
            </div>
          );
        }
        return (
          <div data-ai-blocked={blocked.reason || 'empty'} style={box}>
            <div role="status">{blocked.message}{/not charged/.test(blocked.message || '') ? '' : ` ${NOT_ASKED}`}</div>
            {(blocked.reason === 'watchlist' || blocked.reason === 'coverage') && onAddTickers && (
              <button type="button" onClick={onAddTickers} style={btn}>Add tickers</button>
            )}
            {blocked.retry && <button type="button" onClick={retry} style={btn}>Try again</button>}
          </div>
        );
      })()}

      {/* Input Area */}
      <div style={styles.inputArea}>
        <div style={styles.inputRow}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask about your portfolio"
            style={styles.input}
            // Only while a reply is on its way (or a card's data). After an
            // error (a 422 "not charged", an outage) the field stayed off
            // until New chat or a reload.
            disabled={loading || preparing}
          />
          <button aria-label={msgCost ? `Send, ${msgCost}` : 'Send'}
            onClick={() => sendMessage(input)}
            disabled={loading || preparing || !input.trim()}
            style={styles.sendButton}
          >
            <Icon name="send" size={20} color="white" />
          </button>
        </div>
        {msgCost && <div data-chat-price="true" style={{ marginTop: 4, fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>{msgCost} per message</div>}

        {/* Quick Suggestions */}
        {messages.length <= 1 && (
          <div style={styles.suggestions}>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s)}
                style={styles.suggestion}
                disabled={loading}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

