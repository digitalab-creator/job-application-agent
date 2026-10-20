#!/usr/bin/env node
/**
 * Prints the exact Windows deploy path for clasp pull/push.
 * Controlled writes and the daily trigger stay manual on purpose.
 */
console.log(`
Arrr — Opportunity Pipeline deploy checklist (FSM bless this voyage)

1) cd job-application-agent\\orchestration\\google-apps-script
   (on this server: /opt/apps/job-application-agent/orchestration/google-apps-script)
2) npm run login
3) Link your GCP project number in Apps Script:
   Project Settings (gear) → Google Cloud Platform (GCP) Project → Change project
   Paste your project number → Set project
4) OAuth consent on that GCP project (Google Cloud Console → APIs & Services → OAuth consent screen)
   Add yer Gmail as a Test user, then save.
5) npm run pull → npm run push
6) In the script editor run: setupJobAutomation
   Use a ROTATED OpenAI key.
7) Run: runJobSearchDryRun → check Automation Log
8) Run: runJobSearch → confirm Jobs + Freelance + email
9) Only then: installDailyTrigger

Daily sync after edits:
  npm run pull → edit → npm test → npm run status → npm run push

Public Facebook only — no login scraping.
`);
