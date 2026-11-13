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
    "getBatchRealTime"
  ]
};

if (!window.React || !window.ReactDOM) {
  var bootError = document.getElementById('boot-error');
  if (bootError) bootError.style.display = 'block';
  throw new Error('React did not load from unpkg.com, so the app cannot start. See the message on the page.');
}
