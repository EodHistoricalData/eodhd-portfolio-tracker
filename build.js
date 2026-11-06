/**
 * Transforms the JSX and concatenates everything into build/app.js.
 *
 * Order is the contract: these files assign onto window and read one another
 * at definition time. This is a concatenation, not a module bundle.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The one dependency. Without `npm ci` this printed a raw
// "Cannot find module 'esbuild'" stack at somebody who had followed the README
// to the second step -- while a busy port got a tidy sentence with a hint.
// Same courtesy here.
let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  console.error('esbuild is not installed, so the app cannot be built.');
  console.error('Run:  npm ci');
  console.error('then:  npm start');
  process.exit(1);
}

const FILES = [
  "boot.js",
  "shell/tokens.js",
  "shell/links.js",
  "shell/shims.js",
  "shell/api.js",
  "shell/ai.js",
  "shell/entitlement.js",
  "shell/upgrade.js",
  "shell/tabs.js",
  "shell/feed.js",
  "shell/frame.js",
  "shell/keygate.js",
  "vendor/a11yColor.js",
  "vendor/toggleStyle.js",
  "vendor/a11yPalette.js",
  "vendor/rateLimitWait.js",
  "vendor/symbolCode.js",
  "vendor/calendarDate.js",
  "vendor/numberInput.js",
  "vendor/viewState.js",
  "vendor/icons.js",
  "vendor/HelpTooltip.js",
  "vendor/PortalDropdown.js",
  "vendor/aiText.js",
  "vendor/aiFeatures.js",
  "vendor/AIChat.js",
  "vendor/AIInsightsView.js",
  "vendor/RebalancingAdvisor.js",
  "vendor/portfolioTemplates.js",
  "vendor/portfolioCatalog.js",
  "vendor/storage.js",
  "vendor/calculations.js",
  "vendor/AddPosition.js",
  "vendor/AddTransaction.js",
  "vendor/EditPosition.js",
  "vendor/ImportCSV.js",
  "vendor/TransactionHistory.js",
  "vendor/Onboarding.js",
  "vendor/insiderTransactions.js",
  "vendor/PortfolioHealth.js",
  "vendor/PortfolioAnalytics.js",
  "vendor/MacroDashboard.js",
  "vendor/TaxOptimizer.js",
  "vendor/TaxView.js",
  "vendor/WhatIfScenario.js",
  "vendor/PortfolioTracker.js",
  "app.js"
];

const out = FILES.map(function (rel) {
  const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
  const js = esbuild.transformSync(source, { loader: 'jsx', format: 'iife' }).code;
  return '// ' + rel + '\n' + js;
}).join('\n');

fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'build', 'app.js'), out);
console.log('built build/app.js from ' + FILES.length + ' files');
