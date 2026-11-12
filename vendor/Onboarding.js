// Portfolio Tracker - Onboarding Component (Concept 3 Glassmorphism Design)
// Welcome flow for new users
window.OnboardingFlow = ({ onComplete, theme }) => {
  const [step, setStep] = React.useState(1);
  const [selectedCurrency, setSelectedCurrency] = React.useState('USD');
  const [portfolioName, setPortfolioName] = React.useState('My Portfolio');
  // A refused save (full storage) under "Start Tracking!", not alert().
  const [saveNote, setSaveNote] = React.useState('');


  const Storage = window.PortfolioStorage;
  const C3 = window.C3;
  const isDark = theme === 'dark';

  const Icon = ({ name, size = 24, color }) => {
    return React.createElement('svg', {
      'aria-hidden': true, style: { width: size, height: size, flexShrink: 0 },
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color || 'currentColor',
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  const styles = {
    container: {
      minHeight: '100vh',
      background: isDark ? C3.bgGradientDark : C3.bgGradientLight,
      color: isDark ? C3.textDark : C3.textLightTheme,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16
    },
    card: {
      background: isDark ? '#1E222D' : '#ffffff',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
      boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
      borderRadius: 20,
      padding: 24,
      maxWidth: 400,
      width: '100%'
    },
    input: {
      width: '100%',
      padding: '16px',
      borderRadius: 12,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.8)',
      color: isDark ? C3.textDark : C3.textLightTheme,
      fontSize: 18,
      outline: 'none',
      boxSizing: 'border-box'
    },
    muted: {
      color: isDark ? C3.textMutedDark : C3.textMutedLight
    },
    primaryButton: {
      flex: 1,
      padding: 16,
      borderRadius: 12,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 16,
      background: window.C3.logoGradient,
      color: 'white'
    },
    secondaryButton: {
      flex: 1,
      padding: 16,
      borderRadius: 12,
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: 16,
      background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
      color: isDark ? C3.textDark : C3.textLightTheme
    },
    currencyCard: (isSelected) => ({
      padding: 16,
      borderRadius: 12,
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
      background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      ...window.ToggleStyle.value(isSelected, isDark, { bordered: true }),
      cursor: 'pointer',
      textAlign: 'center'
    }),
    featureItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12
    },
    featureIcon: (color) => ({
      width: 32,
      height: 32,
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `${color}20`
    }),
    toggle: (enabled) => ({
      width: 56,
      height: 28,
      borderRadius: 14,
      border: 'none',
      cursor: 'pointer',
      position: 'relative',
      background: enabled ? '#f97316' : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
      transition: 'background 0.2s'
    }),
    toggleKnob: (enabled) => ({
      width: 24,
      height: 24,
      background: 'white',
      borderRadius: 12,
      position: 'absolute',
      top: 2,
      transition: 'left 200ms ease, right 200ms ease',
      ...(enabled ? { right: 2 } : { left: 2 })
    }),
    progressDot: (isActive, isPast) => ({
      width: isActive ? 24 : 8,
      height: 8,
      borderRadius: 4,
      background: isActive || isPast ? '#f97316' : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
      transition: 'width 200ms ease, background-color 200ms ease'
    })
  };

  const CURRENCIES = [
    { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
    { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
    { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
    { code: 'RUB', name: 'Russian Ruble', symbol: '₽', flag: '🇷🇺' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
    { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', flag: '🇨🇭' }
  ];

  // Create initial portfolio
  const createInitial = () => Storage.attempt(() => Storage.createPortfolio({
    name: String(portfolioName || 'My Portfolio').slice(0, Storage.NAME_MAX),
    baseCurrency: selectedCurrency,
    icon: 'barChart'
  }), setSaveNote);

  const finish = (portfolio) => {
    if (!portfolio) return;

    // Save settings
    Storage.updateSettings({
      baseCurrency: selectedCurrency
    });

    // Mark onboarding as complete
    localStorage.setItem('eodhd_pt_onboarding_complete', 'true');

    onComplete(portfolio);
  };

  const confirming = React.useRef(false);
  const handleComplete = () => {
    const FL = window.FreeLimits;
    const have = FL && typeof FL.item === 'function' && FL.item('portfolios') ? Storage.getPortfolios() : [];
    if (!(have.length > 0 && FL.check('portfolios', have.length + 1) === 'wall')) { finish(createInitial()); return; }
    if (confirming.current) return;
    confirming.current = true;
    FL.confirmWall('portfolios', () => Storage.getPortfolios().length + 1).then((wall) => {
      confirming.current = false;
      const now = Storage.getPortfolios();
      finish(wall && now.length ? now[0] : createInitial());
    });
  };

  return (
    <div style={styles.container}>
      <div style={{ maxWidth: 400, width: '100%' }}>
        {/* Progress Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 32 }}>
          {[1, 2, 3, 4].map(s => (
            <div key={s} style={styles.progressDot(s === step, s < step)} />
          ))}
        </div>

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 24 }}>{React.createElement(Icon, { name: 'barChart', size: 64 })}</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>Portfolio Tracker</h1>
            <p style={{ ...styles.muted, marginBottom: 32, fontSize: 16 }}>
              Track your investments, monitor performance, and reach your financial goals — all in one place.
            </p>
            <div style={{ ...styles.card, textAlign: 'left', marginBottom: 32 }}>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon('#f97316')}>
                  <Icon name="trendUp" size={16} color="#f97316" />
                </div>
                <span>Real-time prices from EODHD</span>
              </div>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon('#22c55e')}>
                  <Icon name="dollar" size={16} color="#22c55e" />
                </div>
                <span>Multi-currency support with FX tracking</span>
              </div>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon('#3b82f6')}>
                  <Icon name="chart" size={16} color="#3b82f6" />
                </div>
                <span>Advanced portfolio analytics</span>
              </div>
              <div style={{ ...styles.featureItem, marginBottom: 0 }}>
                <div style={styles.featureIcon(isDark ? C3.textMutedDark : C3.textMutedLight)}>
                  <Icon name="activity" size={16} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                </div>
                <span>Insider trading & earnings alerts</span>
              </div>
            </div>
            <button onClick={() => setStep(2)} style={{ ...styles.primaryButton, width: '100%' }}>
              Get Started
            </button>
          </div>
        )}

        {/* Step 2: Currency Selection */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Choose Your Currency</h2>
            <p style={{ ...styles.muted, textAlign: 'center', marginBottom: 24 }}>
              All values will be displayed in this currency
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 32 }}>
              {CURRENCIES.map(currency => (
                <button
                  key={currency.code}
                  onClick={() => setSelectedCurrency(currency.code)}
                  style={styles.currencyCard(selectedCurrency === currency.code)}
                >
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{currency.flag}</div>
                  <div style={{ fontWeight: 600 }}>{currency.code}</div>
                  <div style={{ ...styles.muted, fontSize: 12 }}>{currency.name}</div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep(1)} style={styles.secondaryButton}>
                Back
              </button>
              <button onClick={() => setStep(3)} style={styles.primaryButton}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Portfolio Name */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Name Your Portfolio</h2>
            <p style={{ ...styles.muted, textAlign: 'center', marginBottom: 24 }}>
              You can create multiple portfolios later
            </p>
            <input
              type="text"
              value={portfolioName}
              onChange={(e) => setPortfolioName(e.target.value)}
              placeholder="My Portfolio"
              style={{ ...styles.input, marginBottom: 16 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 32 }}>
              {['Main Portfolio', 'Retirement', 'Trading', 'Long-term', 'Dividends', 'Growth'].map(name => (
                <button
                  key={name}
                  onClick={() => setPortfolioName(name)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                    background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: isDark ? C3.textDark : C3.textLightTheme
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setStep(2)} style={styles.secondaryButton}>
                Back
              </button>
              <button onClick={handleComplete} style={styles.primaryButton}>
                Start Tracking!
              </button>
            </div>
            {saveNote && <div role="alert" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.5, color: isDark ? '#fca5a5' : '#b91c1c' }}>{saveNote}</div>}
          </div>
        )}


        {/* Skip Link */}
        {step === 1 && (
          <button
            onClick={() => {
              try { localStorage.setItem('eodhd_pt_onboarding_complete', 'true'); } catch (_) { /* full storage: asked again next time */ }
              Storage.initialize();
              onComplete(Storage.getPortfolios()[0]);
            }}
            style={{
              width: '100%',
              marginTop: 16,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              color: isDark ? C3.textMutedDark : C3.textMutedLight
            }}
          >
            Skip setup and use defaults
          </button>
        )}
      </div>
    </div>
  );
};

// Check if onboarding is needed
window.needsOnboarding = () => {
  const Storage = window.PortfolioStorage;
  const completed = localStorage.getItem('eodhd_pt_onboarding_complete');
  const portfolios = Storage.getPortfolios();
  return !completed && portfolios.length === 0;
};
