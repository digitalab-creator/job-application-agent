#!/usr/bin/env node
/**
 * Run backfillSalaryEstimates via Apps Script API (uses clasp OAuth tokens).
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCRIPT_ID = '1mASctvU0TPJjh3M0k3RvR3Ebu76AUfRJqICdGSGfI5-E_oReZT0inbee';
const claspRcPath = path.join(process.env.USERPROFILE || process.env.HOME, '.clasprc.json');

function getAuthClient() {
  const claspRc = JSON.parse(fs.readFileSync(claspRcPath, 'utf8'));
  const tokens = claspRc.tokens.default;
  const client = new google.auth.OAuth2(tokens.client_id, tokens.client_secret);
  client.setCredentials({ refresh_token: tokens.refresh_token });
  return client;
}

async function main() {
  const auth = getAuthClient();
  await auth.getAccessToken();
  const script = google.script({ version: 'v1', auth });
  const response = await script.scripts.run({
    scriptId: SCRIPT_ID,
    requestBody: {
      function: 'backfillSalaryEstimates',
      devMode: true,
    },
  });
  console.log(JSON.stringify(response.data, null, 2));
}

main().catch((error) => {
  const details = error.response && error.response.data ? error.response.data : error.message;
  console.error('Backfill run failed:', JSON.stringify(details, null, 2));
  process.exit(1);
});
