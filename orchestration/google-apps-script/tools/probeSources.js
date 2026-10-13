/**
 * Diagnostic: probe every catalog source's site and report whether it is reachable,
 * bot-blocked, or disallowed by robots.txt. Run with `node tools/probeSources.js`.
 *
 * This explains zero-yield sources that discovery cannot fix on its own: a dead domain or
 * a blanket robots.txt disallow means no search engine has its postings to return.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { loadAppsScript } = require('../tests/helpers/loadAppsScript');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const api = loadAppsScript(
  ['Config.js', 'Utils.js', 'SourcesCatalog.js'],
  ['getSourcesCatalog_', 'ACTIVE_SOURCE_IDS'],
  { SpreadsheetApp: {}, Utilities: {}, UrlFetchApp: {} }
);

function request(target, { method = 'GET', redirects = 0 } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch (error) {
      return resolve({ status: 0, error: 'bad url' });
    }

    const req = (url.protocol === 'http:' ? http : https).request(
      url,
      { method, headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: 15000 },
      (res) => {
        const location = res.headers.location;
        if (location && res.statusCode >= 300 && res.statusCode < 400 && redirects < 4) {
          res.resume();
          return resolve(request(new URL(location, url).toString(), { method, redirects: redirects + 1 }));
        }
        let body = '';
        res.on('data', (chunk) => {
          if (body.length < 60000) body += chunk;
        });
        res.on('end', () => resolve({
          status: res.statusCode,
          server: res.headers.server || '',
          finalUrl: url.toString(),
          body,
        }));
      }
    );

    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.on('error', (error) => resolve({ status: 0, error: error.code || String(error.message) }));
    req.end();
  });
}

function robotsVerdict(body, status) {
  if (status !== 200 || !body) return 'none';
  // Only the catch-all group matters: named crawlers are allowed what it forbids.
  const groups = body.split(/user-agent:/i).slice(1);
  const wildcard = groups.find((group) => group.trim().startsWith('*'));
  if (!wildcard) return 'ok';
  const rules = wildcard.split(/\n/).map((line) => line.trim().toLowerCase());
  if (rules.some((line) => line === 'disallow: /')) return 'BLOCKS ALL';

  const blocked = rules
    .filter((line) => line.startsWith('disallow:') && line !== 'disallow:')
    .map((line) => line.replace('disallow:', '').trim())
    // Internal JSON endpoints, admin routes and query-string variants are not the public
    // posting pages, so blocking them says nothing about whether postings are crawlable.
    .filter((path) => !/\/api\/|admin|\?|\.xpl|jsessionid|\/rest\//.test(path))
    .filter((path) => /job|position|career|vacanc/.test(path));

  return blocked.length ? `BLOCKS POSTINGS (${blocked.join(' ')})` : 'ok';
}

function classify(res) {
  if (res.status === 0) return `DEAD (${res.error})`;
  if (res.status === 403) return 'BOT-BLOCKED (403)';
  if (res.status === 404) return 'NOT FOUND (404)';
  if (res.status === 429) return 'RATE-LIMITED (429)';
  if (res.status >= 500) return `SERVER ERROR (${res.status})`;
  if (/just a moment|cf_chl|challenge-platform/i.test(res.body || '')) return 'CLOUDFLARE CHALLENGE';
  if (res.status >= 200 && res.status < 300) return 'OK';
  return `HTTP ${res.status}`;
}

(async () => {
  const catalog = Array.from(api.getSourcesCatalog_()).map((s) => Object.assign({}, s));
  const active = Array.from(api.ACTIVE_SOURCE_IDS);
  const withUrls = catalog.filter((s) => /^https?:\/\//i.test(s.query_or_url));
  const withoutUrls = catalog.filter((s) => !/^https?:\/\//i.test(s.query_or_url));

  const results = [];
  const batchSize = 8;
  for (let i = 0; i < withUrls.length; i += batchSize) {
    const batch = withUrls.slice(i, i + batchSize);
    /* eslint-disable no-await-in-loop */
    const probed = await Promise.all(batch.map(async (source) => {
      const origin = new URL(source.query_or_url).origin;
      const [site, robots] = await Promise.all([
        request(source.query_or_url),
        request(`${origin}/robots.txt`),
      ]);
      return {
        source,
        verdict: classify(site),
        robots: robotsVerdict(robots.body, robots.status),
      };
    }));
    probed.forEach((r) => results.push(r));
  }

  const line = (r) => `  ${(active.indexOf(r.source.source_id) !== -1 ? '*' : ' ')} `
    + `${r.source.source_id.padEnd(24)}${r.verdict.padEnd(24)}robots: ${r.robots}`;

  const broken = results.filter((r) => r.verdict !== 'OK');
  const ok = results.filter((r) => r.verdict === 'OK');

  console.log(`\n=== PROBLEM SITES (${broken.length}) ===   (* = currently active)`);
  broken.sort((a, b) => a.verdict.localeCompare(b.verdict)).forEach((r) => console.log(line(r)));

  console.log(`\n=== REACHABLE (${ok.length}) ===`);
  ok.forEach((r) => console.log(line(r)));

  console.log(`\n=== NOT A SITE — query or feed, nothing to probe (${withoutUrls.length}) ===`);
  withoutUrls.forEach((s) => console.log(
    `  ${(active.indexOf(s.source_id) !== -1 ? '*' : ' ')} ${s.source_id.padEnd(24)}${s.query_or_url}`
  ));

  const activeBroken = broken.filter((r) => active.indexOf(r.source.source_id) !== -1);
  const activeRobots = ok.filter((r) => active.indexOf(r.source.source_id) !== -1 && r.robots !== 'ok' && r.robots !== 'none');
  console.log(`\n=== VERDICT ===`);
  console.log(`  active sources unreachable  : ${activeBroken.length} -> ${activeBroken.map((r) => r.source.source_id).join(', ') || 'none'}`);
  console.log(`  active sources robots-limited: ${activeRobots.length} -> ${activeRobots.map((r) => `${r.source.source_id} [${r.robots}]`).join(', ') || 'none'}`);
})();
