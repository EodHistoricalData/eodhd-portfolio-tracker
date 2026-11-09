// AI Insights Board — Persistent portfolio analysis board
window.AIInsightsView = ({ holdings, holdingsData, portfolioId, onClose, theme }) => {
  const STORAGE_KEY = 'eodhd_ai_insights_board';
  const C3 = window.C3;
  const isDark = theme === 'dark';
  const AI = window.AIService;
  // Prices from the list the server charges by: the analysis is
  // portfolio_detail, a question portfolio_qa.
  const useFeatureCost = (() => null);
  const analysisCost = useFeatureCost('portfolio_detail');
  const questionCost = useFeatureCost('portfolio_qa');

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

  // Load saved cards from localStorage
  const loadBoard = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.portfolioId === portfolioId && Array.isArray(data.cards)) {
          return data.cards;
        }
      }
    } catch (e) {}
    return [];
  };

  const [cards, setCards] = React.useState(loadBoard);
  const [loading, setLoading] = React.useState(false);
  const [loadingCardId, setLoadingCardId] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState(null);

  // Save to localStorage whenever cards change
  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ portfolioId, cards }));
    } catch (e) {}
  }, [cards, portfolioId]);

  // Opening the board costs nothing. It used to generate the analysis on its
  // own on first open, a paid call nobody pressed (the
  // same rule as the web's opt-in Auto Insights). It runs on its priced button.

  const generateAnalysis = async () => {
    const cardId = 'analysis-' + Date.now();
    setLoading(true);
    setLoadingCardId(cardId);
    setError(null);
    try {
      const result = await AI.getDetailedAnalysis(holdings, holdingsData);
      const newCard = {
        id: cardId,
        type: 'analysis',
        question: 'Portfolio Analysis',
        answer: result,
        timestamp: Date.now(),
        collapsed: false,
      };
      setCards(prev => {
        // Replace existing analysis card or prepend
        const withoutAnalysis = prev.filter(c => c.type !== 'analysis');
        return [newCard, ...withoutAnalysis];
      });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
    setLoadingCardId(null);
  };

  const askQuestion = async (question) => {
    if (!question.trim()) return;
    const cardId = 'q-' + Date.now();
    setLoadingCardId(cardId);
    setError(null);
    setInput('');

    // Add placeholder card
    const placeholder = {
      id: cardId,
      type: 'question',
      question: question.trim(),
      answer: null,
      timestamp: Date.now(),
      collapsed: false,
    };
    setCards(prev => [...prev, placeholder]);

    try {
      const result = await AI.analyzePortfolio(holdings, holdingsData, question);
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, answer: result } : c));
    } catch (e) {
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, answer: `Error: ${e.message}` } : c));
    }
    setLoadingCardId(null);
  };

  const removeCard = (id) => {
    setCards(prev => prev.filter(c => c.id !== id));
  };

  const toggleCollapse = (id) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, collapsed: !c.collapsed } : c));
  };

  const clearAll = () => {
    setCards([]);
  };

  const quickQuestions = [
    'Risks',
    'Sector Balance',
    'Income Strategy',
    'Correlation',
    'Tax Strategy',
    'Market Outlook',
  ];

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: isDark ? C3.bgGradientDark : C3.bgGradientLight,
      zIndex: 100, display: 'flex', flexDirection: 'column',
    }}>
      {window.ModalLayer && <window.ModalLayer.Hold />}
      {/* Header */}
      <div style={{
        ...(isDark ? C3.glassDark : C3.glassLight),
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      }}>
        <button aria-label="Back" onClick={onClose} style={{
          padding: 8, borderRadius: 8, background: 'transparent', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isDark ? C3.textDark : C3.textLightTheme,
        }}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>AI Insights</h2>
          <p style={{ fontSize: 12, margin: 0, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            {cards.length} insight{cards.length !== 1 ? 's' : ''} saved
          </p>
        </div>
        {/* The analysis is always one priced tap away once the board has
            cards: Refresh when there is one, Generate when there are only
            questions (the empty board has its own Generate button). With Q&A
            cards only, there was no way to run it short of clearing the board.
            Never run on opening. */}
        {cards.length > 0 && holdings.length > 0 && (() => {
          const hasAnalysis = cards.some(c => c.type === 'analysis');
          const name = hasAnalysis ? 'Refresh analysis' : 'Generate Analysis';
          return (
            <button aria-label={analysisCost ? `${name}, ${analysisCost}` : name} onClick={generateAnalysis} disabled={loading} style={{
              padding: '8px 10px', borderRadius: 8, background: 'transparent', border: 'none', minHeight: 40,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              color: isDark ? C3.textDark : C3.textLightTheme, opacity: loading ? 0.5 : 1, fontSize: 11, whiteSpace: 'nowrap',
            }} title={name}>
              <Icon name={hasAnalysis ? 'refresh' : 'zap'} size={18} />
              {hasAnalysis ? analysisCost : (analysisCost ? `Analyze · ${analysisCost}` : 'Analyze')}
            </button>
          );
        })()}
        {cards.length > 0 && (
          <button aria-label="Clear all" onClick={clearAll} style={{
            padding: 8, borderRadius: 8, background: 'transparent', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C3.error, opacity: 0.7,
          }} title="Clear all">
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && (
          <div style={{
            padding: 12, borderRadius: 12,
            background: `${C3.error}15`, border: `1px solid ${C3.error}30`,
            fontSize: 13, color: C3.error,
          }}>
            {error}
          </div>
        )}

        {cards.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
            {/* A plain icon of the same size: the sparkle was decoration, the
                space it held is part of the Mini App layout. */}
            <Icon name="barChart" size={48} color={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'} />
            <p style={{ marginTop: 12, fontSize: 14 }}>Your board is empty</p>
            <p style={{ fontSize: 12 }}>Ask a question or generate a portfolio analysis</p>
            {holdings.length > 0 && (
              <button onClick={generateAnalysis} style={{
                marginTop: 16, padding: '10px 20px', borderRadius: 10, border: 'none',
                background: C3.logoGradient, color: '#fff',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
                <Icon name="zap" size={16} color="#fff" />
                {analysisCost ? `Generate Analysis · ${analysisCost}` : 'Generate Analysis'}
              </button>
            )}
          </div>
        )}

        {loading && loadingCardId && !cards.find(c => c.id === loadingCardId) && (
          <div style={{
            ...(isDark ? C3.glassDark : C3.glassLight),
            borderRadius: 14, padding: 16,
            border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 18, height: 18, border: '2px solid transparent', borderTopColor: (isDark ? C3.textMutedDark : C3.textMutedLight), borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Generating analysis...</span>
            </div>
          </div>
        )}

        {cards.map(card => (
          <div key={card.id} style={{
            ...(isDark ? C3.glassDark : C3.glassLight),
            borderRadius: 14, padding: 14,
            border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
          }}>
            {/* Card header */}
            <div
              onClick={() => toggleCollapse(card.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: card.collapsed ? 0 : 10 }}
            >
              <Icon
                name={card.type === 'analysis' ? 'barChart' : 'messageCircle'}
                size={16}
                color={isDark ? C3.textMutedDark : C3.textMutedLight}
              />
              <span style={{
                flex: 1, fontSize: 13, fontWeight: 600,
                color: isDark ? C3.textDark : C3.textLightTheme,
              }}>
                {card.question}
              </span>
              <span style={{ fontSize: 11, color: isDark ? C3.textMutedDark : C3.textMutedLight, flexShrink: 0 }}>
                {formatTime(card.timestamp)}
              </span>
              <button data-hit="" aria-label="Copy answer" onClick={(e) => {
                e.stopPropagation();
                if (card.answer) {
                  navigator.clipboard.writeText(card.answer).catch(() => {});
                  if (window.Haptics) window.Haptics.notification('success');
                }
              }} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                color: isDark ? C3.textMutedDark : C3.textMutedLight,
              }} title="Copy">
                <Icon name="copy" size={14} />
              </button>
              <button data-hit="" aria-label="Remove card" onClick={(e) => { e.stopPropagation(); removeCard(card.id); }} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                color: isDark ? C3.textMutedDark : C3.textMutedLight,
              }}>
                <Icon name="x" size={14} />
              </button>
              <div style={{
                transform: card.collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.2s',
                color: isDark ? C3.textMutedDark : C3.textMutedLight,
              }}>
                <Icon name="chevronDown" size={14} />
              </div>
            </div>
            {/* Card body */}
            {!card.collapsed && (
              card.answer ? (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: isDark ? C3.textDark : C3.textLightTheme }}>
                  {window.renderMarkdown ? window.renderMarkdown(card.answer) : card.answer}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 14, height: 14, border: '2px solid transparent', borderTopColor: (isDark ? C3.textMutedDark : C3.textMutedLight), borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Thinking...</span>
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {/* Input area */}
      <div style={{
        ...(isDark ? C3.glassDark : C3.glassLight),
        padding: 16,
        borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      }}>
        {/* Quick questions: each one is a paid question, and says so. */}
        {questionCost && <div style={{ fontSize: 11, marginBottom: 6, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Each question · {questionCost}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {quickQuestions.map((q, i) => (
            <button
              key={i}
              onClick={() => askQuestion(q)}
              disabled={!!loadingCardId}
              aria-label={questionCost ? `${q}, ${questionCost}` : q}
              style={{
                padding: '6px 12px', borderRadius: 14, fontSize: 12, fontWeight: 500,
                background: isDark ? C3.fillDark : C3.fillLight,
                border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, cursor: 'pointer',
                color: isDark ? C3.textDark : C3.textLightTheme, opacity: loadingCardId ? 0.5 : 1,
              }}
            >
              {q}
            </button>
          ))}
        </div>
        {/* Free input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askQuestion(input); } }}
            placeholder="Ask about your portfolio"
            disabled={!!loadingCardId}
            style={{
              flex: 1, padding: '12px 16px', borderRadius: 24,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
              background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
              color: isDark ? C3.textDark : C3.textLightTheme,
              fontSize: 14, outline: 'none',
            }}
          />
          <button aria-label={questionCost ? `Send, ${questionCost}` : 'Send'}
            onClick={() => askQuestion(input)}
            disabled={!input.trim() || !!loadingCardId}
            style={{
              width: 48, height: 48, flexShrink: 0, borderRadius: 24,
              background: C3.logoGradient, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', opacity: (!input.trim() || loadingCardId) ? 0.5 : 1,
            }}
          >
            <Icon name="send" size={20} color="white" />
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
