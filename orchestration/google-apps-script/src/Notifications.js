/**
 * Email digests for Jobs and Freelance.
 */
function sendDigest_(jobRows, freelanceRows, jobsSheet, freelanceSheet) {
  const jobCount = (jobRows && jobRows.length) || 0;
  const freelanceCount = (freelanceRows && freelanceRows.length) || 0;
  if (!jobCount && !freelanceCount) {
    console.log('Arrr, no new active opportunities; no email sent.');
    return;
  }

  const recipient = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.NOTIFY_EMAIL);
  if (!recipient) return;

  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'dd/MM/yyyy');
  const jobsUrl = sheetUrlFor_(jobsSheet);
  const freelanceUrl = sheetUrlFor_(freelanceSheet);

  const plainSections = [];
  const htmlSections = [];

  if (jobCount) {
    const sorted = jobRows.slice().sort((a, b) => Number(b[CONFIG.COL_INDEX.MATCH_SCORE]) - Number(a[CONFIG.COL_INDEX.MATCH_SCORE]));
    plainSections.push(`JOBS (${jobCount})\n` + sorted.map((row, index) =>
      `${index + 1}. ${row[CONFIG.COL_INDEX.ROLE]} — ${row[CONFIG.COL_INDEX.COMPANY]} (${row[CONFIG.COL_INDEX.MATCH_SCORE]}/100)\n`
      + `${row[CONFIG.COL_INDEX.JOB_URL]}\n`
      + `Est. salary: ${row[CONFIG.COL_INDEX.EST_SALARY_RANGE] || 'n/a'}\n`
      + `${row[CONFIG.COL_INDEX.WHY_IT_FITS]}`
    ).join('\n\n'));
    htmlSections.push(`
      <h3>Jobs (${jobCount})</h3>
      <ol>${sorted.map((row) => opportunityHtmlItem_(row)).join('')}</ol>
      <p><a href="${jobsUrl}">Open Jobs tab</a></p>`);
  }

  if (freelanceCount) {
    const sorted = freelanceRows.slice().sort((a, b) => Number(b[CONFIG.COL_INDEX.MATCH_SCORE]) - Number(a[CONFIG.COL_INDEX.MATCH_SCORE]));
    plainSections.push(`FREELANCE (${freelanceCount})\n` + sorted.map((row, index) =>
      `${index + 1}. ${row[CONFIG.COL_INDEX.ROLE]} — ${row[CONFIG.COL_INDEX.COMPANY]} (${row[CONFIG.COL_INDEX.MATCH_SCORE]}/100)\n`
      + `${row[CONFIG.COL_INDEX.JOB_URL]}\n`
      + `Est. salary: ${row[CONFIG.COL_INDEX.EST_SALARY_RANGE] || 'n/a'}\n`
      + `${row[CONFIG.COL_INDEX.WHY_IT_FITS]}`
    ).join('\n\n'));
    htmlSections.push(`
      <h3>Freelance (${freelanceCount})</h3>
      <ol>${sorted.map((row) => opportunityHtmlItem_(row)).join('')}</ol>
      <p><a href="${freelanceUrl}">Open Freelance tab</a></p>`);
  }

  MailApp.sendEmail({
    to: recipient,
    subject: `${jobCount + freelanceCount} new opportunities (${jobCount} jobs, ${freelanceCount} freelance) — ${today}`,
    body: `${plainSections.join('\n\n')}\n\nJobs: ${jobsUrl}\nFreelance: ${freelanceUrl}`,
    htmlBody: `
      <p>Arrr, ${jobCount + freelanceCount} new verified opportunities were added. Praise the FSM.</p>
      ${htmlSections.join('\n')}
    `,
    name: 'Or Opportunity Tracker',
  });
}

function opportunityHtmlItem_(row) {
  return `
    <li style="margin-bottom:14px">
      <strong>${escapeHtml_(row[CONFIG.COL_INDEX.ROLE])}</strong> — ${escapeHtml_(row[CONFIG.COL_INDEX.COMPANY])}
      <br>Match: ${escapeHtml_(row[CONFIG.COL_INDEX.MATCH_SCORE])}/100 | ${escapeHtml_(row[CONFIG.COL_INDEX.CATEGORY])} | ${escapeHtml_(row[CONFIG.COL_INDEX.LOCATION])} | ${escapeHtml_(row[CONFIG.COL_INDEX.WORK_MODE])}
      <br>Est. salary: ${escapeHtml_(row[CONFIG.COL_INDEX.EST_SALARY_RANGE] || 'n/a')}
      <br>${escapeHtml_(row[CONFIG.COL_INDEX.WHY_IT_FITS])}
      <br><a href="${escapeHtml_(row[CONFIG.COL_INDEX.JOB_URL])}">Open opportunity</a>
    </li>`;
}

function sendErrorEmail_(errorText) {
  const recipient = PropertiesService.getScriptProperties().getProperty(CONFIG.PROPS.NOTIFY_EMAIL);
  if (!recipient) return;

  try {
    MailApp.sendEmail({
      to: recipient,
      subject: 'Opportunity automation failed',
      body: `Arrr, the scheduled opportunity search failed:\n\n${truncate_(errorText, 6000)}`,
      name: 'Or Opportunity Tracker',
    });
  } catch (mailError) {
    console.log(`Arrr, even the error email sank: ${mailError}`);
  }
}
