/**
 * Generated. The app's identity -- used for link tags, the key screen and the
 * footer -- and the check that React loaded before anything reads it.
 */
window.APP_META = {
  "app": "portfolio-tracker",
  "repo": "eodhd-portfolio-tracker",
  "title": "EODHD Portfolio Tracker",
  "description": "Track holdings and transactions, price them live, and copy a real fund's allocation — on your own EODHD key.",
  "keyNote": "A free key is enough for your own positions: each is priced from a live quote, one request, so the free plan's twenty requests a day are the limit you will meet first. Fund templates read fundamentals, which need All-In-One or the Fundamentals Data Feed.",
  "storage": [
    "eodhd_pt_",
    "eodhd_referrals",
    "eodhd_overview_widgets",
    "eodhd_widget_sizes",
    "eodhd_auto_insights_date",
    "eodhd_ai_insights_board",
    "eodhd_ai_chat",
    "eodhd_timezone_manual"
  ],
  "ownFailures": [
    "getBatchRealTime",
    "getRealTimeData",
    "getForexRate",
    "getHistoricalData",
    "getMacroIndicator",
    "getInsiderForm4",
    "getFundamentals"
  ],
  "ownLines": {
    "getBatchRealTime": [
      "[data-own-fail=\"quotes\"]:not([data-pt-price-status])",
      "[data-pt-price-status]~without a price|no price|No prices came back",
      "[data-unpriced-why]",
      "[data-risk-none-priced]",
      "[data-rl-fail]~prices? did not load"
    ],
    "getRealTimeData": [
      "[data-own-fail=\"quotes\"]:not([data-pt-price-status])",
      "[data-pt-price-status]~without a price|no price|No prices came back",
      "[data-own-fail=\"macro\"]",
      "[data-unpriced-why]",
      "[data-risk-none-priced]",
      "[data-rl-fail]~prices? did not load|economic data|figures",
      "[data-import-check]~did not load|Could not check",
      "~Could not check|price did not load"
    ],
    "getForexRate": [
      "[data-own-fail=\"quotes\"]:not([data-pt-price-status])",
      "[data-pt-price-status]~without a price|no price|No prices came back",
      "[data-unpriced-why]",
      "~rate did not load"
    ],
    "getHistoricalData": [
      "[data-own-fail=\"history\"]",
      "[data-rl-fail]~price history",
      "[data-import-check]~did not load",
      "~(close for|comparison).{0,80}did not load"
    ],
    "getMacroIndicator": [
      "[data-own-fail=\"macro\"]",
      "[data-rl-fail]~economic data|figures"
    ],
    "getInsiderForm4": [
      "[data-own-fail=\"insider\"]",
      "[data-rl-fail]~insider"
    ],
    "getFundamentals": [
      "[data-own-fail=\"fundamentals\"]",
      "[data-rl-fail]~Fundamentals did not load|sectors|earnings"
    ]
  }
};

if (!window.React || !window.ReactDOM) {
  var bootError = document.getElementById('boot-error');
  if (bootError) bootError.style.display = 'block';
  throw new Error('React did not load from unpkg.com, so the app cannot start. See the message on the page.');
}
