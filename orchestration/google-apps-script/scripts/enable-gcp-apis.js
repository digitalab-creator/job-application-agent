#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const fromEnv = (process.env.GOOGLE_CLOUD_PROJECT_NUMBERS || '')
  .split(/[,\s]+/)
  .map((part) => part.trim())
  .filter(Boolean);
const GCP_PROJECTS = fromEnv.length > 0 ? fromEnv : [];
if (GCP_PROJECTS.length === 0) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT_NUMBERS (comma-separated project numbers).');
}
const SERVICES = [
  'script.googleapis.com',
  'sheets.googleapis.com',
];

async function getAuthClient() {
  const claspRcPath = path.join(process.env.USERPROFILE || process.env.HOME, '.clasprc.json');
  const claspRc = JSON.parse(fs.readFileSync(claspRcPath, 'utf8'));
  const tokens = claspRc.tokens.default;
  const client = new google.auth.OAuth2(tokens.client_id, tokens.client_secret);
  client.setCredentials({ refresh_token: tokens.refresh_token });
  await client.getAccessToken();
  return client;
}

async function main() {
  const auth = await getAuthClient();
  const serviceUsage = google.serviceusage({ version: 'v1', auth });
  for (const project of GCP_PROJECTS) {
    for (const service of SERVICES) {
      const name = `projects/${project}/services/${service}`;
      try {
        await serviceUsage.services.enable({ name });
        console.log(`Enabled ${service} on ${project}`);
      } catch (error) {
        const message = error.response?.data?.error?.message || error.message;
        console.log(`${project} ${service}: ${message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.response?.data || error.message);
  process.exit(1);
});
