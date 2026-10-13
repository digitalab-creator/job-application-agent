#!/usr/bin/env node
/**
 * Validates local clasp wiring before pull/push.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const claspPath = path.join(root, '.clasp.json');
const clasprc = path.join(process.env.USERPROFILE || process.env.HOME || '', '.clasprc.json');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(claspPath)) {
  fail('.clasp.json is missing');
} else {
  const config = JSON.parse(fs.readFileSync(claspPath, 'utf8'));
  if (!config.scriptId || config.scriptId.includes('REPLACE_WITH')) {
    fail('Set scriptId in .clasp.json. Run: npm run login && npm run create-bound  (or paste Script ID from Project Settings)');
  } else {
    console.log(`OK: scriptId=${config.scriptId}`);
  }
  if (config.rootDir !== 'src') {
    fail('rootDir must be "src"');
  } else {
    console.log('OK: rootDir=src');
  }
  if (!config.projectNumber && !config.projectId) {
    fail('Set projectNumber in .clasp.json (Google Cloud project number for OAuth)');
  } else {
    console.log(`OK: GCP project=${config.projectNumber || config.projectId}`);
  }
}

if (!fs.existsSync(clasprc)) {
  fail('Not logged in. Run: npm run login');
} else {
  console.log('OK: clasp credentials found');
}

const required = [
  'Config.js',
  'Main.js',
  'MenuTriggers.js',
  'SearchConfig.js',
  'OpenAIClient.js',
  'JobSearch.js',
  'FacebookSearch.js',
  'OpportunityProcessor.js',
  'SheetRepository.js',
  'UrlInspector.js',
  'Notifications.js',
  'Utils.js',
  'appsscript.json',
];

required.forEach((file) => {
  const full = path.join(root, 'src', file);
  if (!fs.existsSync(full)) fail(`Missing src/${file}`);
  else console.log(`OK: src/${file}`);
});

if (!process.exitCode) {
  console.log('Arrr, clasp setup looks seaworthy. Next: npm run pull (backup) then npm run push.');
}
