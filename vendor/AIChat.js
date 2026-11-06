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

// AI Portfolio Chat Component
// `autoSend` (default true): the initialPrompt is asked on opening -- right
// for a button that already named its price (Portfolio's quick actions). The
// AI tab's cards pass false: opening is free, the prompt waits under a priced
// "Run".
window.AIChatView = ({ holdings, holdingsData, watchlist, watchlistData, onClose, theme, initialPrompt, title, subtitle, autoSend = true, asPage = false }) => {
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
  const [waiting, setWaiting] = React.useState(() => (!autoSend && initialPrompt && !askedBefore ? initialPrompt : null));
  const [askAgain, setAskAgain] = React.useState(() => (askedBefore ? initialPrompt : null));
  const [loading, setLoading] = React.useState(() => Store.isPending(thread));
  const [error, setError] = React.useState(null);
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
    // An answer to a question asked before this chat was closed and reopened.
    const onStore = () => { setMessages(withGreeting(Store.load(thread))); setLoading(Store.isPending(thread)); };
    window.addEventListener('ai-chat-store', onStore);
    return () => window.removeEventListener('ai-chat-store', onStore);
  }, []);

  const newChat = () => {
    if (loading) return;
    Store.clear(thread);
    setError(null);
    // A fresh conversation has not asked the card's question: it waits under
    // "Run" again, as on opening the card.
    setAskAgain(null);
    setWaiting(!autoSend && initialPrompt ? initialPrompt : null);
  };

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return;
    // Anything sent takes the card's waiting question away: never two paid
    // paths on screen. It is not kept across a reload or
    // Back/Forward either -- an address carries no unasked question.
    setWaiting(null);
    setAskAgain(null);

    const userMessage = { role: 'user', content: text.trim() };
    const asker = Store.owner();
    Store.append(thread, userMessage);
    // Only what was typed is cleared: a quick action's question or a
    // suggestion sent over a draft leaves the draft where it is.
    setInput((cur) => (cur.trim() === text.trim() ? '' : cur));
    Store.setPending(thread, true);
    setError(null);
    if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_ai_chat_submit', { prompt_length: text.trim().length });

    try {
      // Build watchlist context if available
      let enrichedText = text;
      // Only when the question is about the watchlist. Sent with every
      // question, it put tickers nobody asked about into the answer ("I do
      // not have the P/E for EURUSD, GOOGL…" to a question about AAPL) and
      // took the server's look-ups from the instrument asked about.
      if (watchlist && watchlist.length > 0 && window.AIChatAboutWatchlist(text)) {
        const wlTickers = watchlist.map(w => w.symbol?.split('.')[0]).filter(Boolean);
        const wlPrices = watchlist.map(w => {
          const d = watchlistData?.[w.symbol] || watchlistData?.[w.id] || {};
          const price = d.close || d.price || '';
          const change = d.change_p != null ? `${d.change_p > 0 ? '+' : ''}${Number(d.change_p).toFixed(2)}%` : '';
          return price ? `${w.symbol.split('.')[0]}: $${price} ${change}` : w.symbol.split('.')[0];
        }).join(', ');
        enrichedText = `[My watchlist: ${wlPrices}]\n\n${text}`;
      }
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
          <div key={i} style={styles.message(msg.role === 'user')}>
            {msg.role === 'user' ? msg.content : (window.renderMarkdown ? window.renderMarkdown(msg.content) : msg.content)}
          </div>
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

      {/* The card's question, ready and not yet asked: one priced tap runs it. */}
      {waiting && (
        <div data-ai-waiting="true" style={{ margin: '0 16px 8px', padding: 12, borderRadius: 12, border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, background: isDark ? C3.fillDark : C3.fillLight, fontSize: 13, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 10 }}>{waiting}</div>
          <button onClick={() => { const q = waiting; setWaiting(null); sendMessage(q); }} disabled={loading} style={{
            width: '100%', minHeight: 44, padding: '10px 16px', borderRadius: 10, border: 'none',
            background: window.C3.logoGradient, color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>{msgCost ? `Run · ${msgCost}` : 'Run'}</button>
        </div>
      )}

      {askAgain && !loading && (
        <div style={{ margin: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.85 }}>
          <span style={{ flex: 1 }}>Answered above.</span>
          <button onClick={() => { const q = askAgain; setAskAgain(null); sendMessage(q); }} style={{
            minHeight: 40, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', background: 'none',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, color: 'inherit', fontSize: 12, fontWeight: 600,
          }}>{msgCost ? `Ask again · ${msgCost}` : 'Ask again'}</button>
        </div>
      )}

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
            // Only while a reply is on its way. After an error (a 422 "not
            // charged", an outage) the field stayed off until New chat or a
            // reload.
            disabled={loading}
          />
          <button aria-label={msgCost ? `Send, ${msgCost}` : 'Send'}
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
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

