#!/usr/bin/env node
// One-time bootstrap for the Google Business Profile credentials that
// .claude/skills/sync-google-reviews/SKILL.md needs in .env.
//
//   npm run gbp:auth
//   npm run gbp:auth -- --account=123 --location=456   (skip the interactive picker)
//
// One human step is unavoidable: step 2 opens Google's consent screen and somebody has to click
// through it. Everything either side of that click is automated, and the script is safe to launch
// non-interactively — it prints the consent URL to stdout and never blocks on a prompt without a
// TTY (see choose()). That is what lets the sync skill start it in the background, hand the user
// the URL, and pick up when it exits.
//
//   1. reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env
//   2. runs the OAuth loopback flow and exchanges the code for a refresh token
//   3. discovers GBP_ACCOUNT_ID / GBP_LOCATION_ID with that token
//   4. writes all three results back into .env
//
// On secrets: the sync skill's Absolute Rule 3 ("never print secrets") targets the *access* token,
// which is ephemeral and must never reach disk. This script honours that — the access token it mints
// in step 3 lives in a local variable and is never printed or written. The refresh token is a
// different animal: it is a stored credential whose whole purpose is to live in .env, which is
// gitignored. So it gets written to that file and never printed to stdout. Do not "simplify" this
// script away on a Rule 3 reading; the rule and this script agree.
//
// The OAuth client must be of type **Desktop app**. Only that type permits the
// http://127.0.0.1:<port> redirect this flow uses; a Web application client rejects it with
// redirect_uri_mismatch unless every possible port is pre-registered, which is not possible.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ENV_PATH = new URL('../.env', import.meta.url).pathname;
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

function die(message) {
  console.error(`\nSTOP: ${message}\n`);
  process.exit(1);
}

// --- .env read/write -------------------------------------------------
// Update-or-append per key so unrelated values and comments in the file survive. Never echo the
// file's contents back out.

async function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of (await readFile(ENV_PATH, 'utf8')).split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function writeEnv(updates) {
  const lines = existsSync(ENV_PATH) ? (await readFile(ENV_PATH, 'utf8')).split('\n') : [];
  const pending = new Set(Object.keys(updates));
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      const key = m[1];
      pending.delete(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1].trim() === '') next.pop();
  for (const key of pending) next.push(`${key}=${updates[key]}`);
  await writeFile(ENV_PATH, `${next.join('\n')}\n`, { mode: 0o600 });
}

// --- OAuth loopback flow ---------------------------------------------------

async function getRefreshToken(clientId, clientSecret) {
  // PKCE: recommended by Google for installed/desktop clients, and cheap to add.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  const { code, redirectUri } = await new Promise((resolve, reject) => {
    // Without this the script waits forever, silently, if the user closes the consent tab or never
    // finishes. Ten minutes is generous for a consent screen and still ends the process.
    const timer = setTimeout(
      () => {
        server.close();
        reject(new Error('timed out after 10 minutes waiting for the consent redirect.'));
      },
      10 * 60 * 1000
    );
    timer.unref();

    const server = createServer((req, res) => {
      clearTimeout(timer);
      const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
      if (url.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get('error');
      const gotCode = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      const ok = !err && gotCode && gotState === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:3rem">` +
          (ok
            ? `<h1>Authorised</h1><p>You can close this tab and return to the terminal.</p>`
            : `<h1>Authorisation failed</h1><p>Return to the terminal for details.</p>`) +
          `</body>`
      );
      server.close();
      if (err) reject(new Error(`Google returned error=${err}`));
      else if (!gotCode) reject(new Error('no authorization code in the redirect'));
      else if (gotState !== state) reject(new Error('state mismatch — possible interception'));
      else resolve({ code: gotCode, redirectUri: `http://127.0.0.1:${url.port}` });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirect = `http://127.0.0.1:${port}`;
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.searchParams.set('client_id', clientId);
      auth.searchParams.set('redirect_uri', redirect);
      auth.searchParams.set('response_type', 'code');
      auth.searchParams.set('scope', SCOPE);
      // Both of these are load-bearing. Without access_type=offline Google issues no refresh token
      // at all; without prompt=consent it omits the refresh token on any re-authorisation of a
      // grant you already gave. Either omission fails as "it worked" plus a sync that can never
      // authenticate, so the exchange below asserts the refresh token actually came back.
      auth.searchParams.set('access_type', 'offline');
      auth.searchParams.set('prompt', 'consent');
      auth.searchParams.set('code_challenge', challenge);
      auth.searchParams.set('code_challenge_method', 'S256');
      auth.searchParams.set('state', state);

      console.log('\nOpen this URL and grant access (it should open automatically):\n');
      console.log(`  ${auth}\n`);
      console.log(`Waiting for the redirect on ${redirect} …`);
      const opener =
        process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(opener, [auth.toString()], { stdio: 'ignore', detached: true }).unref();
    });
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    die(`token exchange failed (HTTP ${res.status})${body?.error ? `: ${body.error}` : ''}`);
  }
  if (!body.refresh_token) {
    die(
      'Google returned an access token but no refresh token. This usually means the grant already\n' +
        '      existed and consent was not re-prompted. Revoke this app at\n' +
        '      https://myaccount.google.com/permissions and run this script again.'
    );
  }
  return { refreshToken: body.refresh_token, accessToken: body.access_token };
}

// --- account / location discovery -----------------------------------------

async function api(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 403) {
      die(
        `${msg}\n\n      A 403 here almost always means Business Profile API access has not been\n` +
          '      approved for this Google Cloud project yet. Check the quota in the Cloud Console:\n' +
          '      0 QPM means not approved, 300 QPM means approved. Credentials are fine; access is not.'
      );
    }
    die(msg);
  }
  return body;
}

async function choose(label, items) {
  if (items.length === 0) die(`no ${label} found on this Google account.`);
  if (items.length === 1) {
    console.log(`  ${label}: ${items[0].title} (${items[0].id}) — only one, selected automatically`);
    return items[0].id;
  }
  console.log(`\nMultiple ${label}s found:\n`);
  items.forEach((it, i) => console.log(`  [${i + 1}] ${it.title} (${it.id})`));

  // --account=<id> / --location=<id> preselects, which is what makes this script safe to run
  // non-interactively (see below).
  const flag = process.argv.find((a) => a.startsWith(`--${label}=`))?.split('=')[1];
  if (flag) {
    if (!items.some((it) => it.id === flag)) die(`--${label}=${flag} is not one of the ids above.`);
    console.log(`\n  --${label}=${flag} supplied, using it.`);
    return flag;
  }

  // No TTY means nothing can ever answer the prompt below, and awaiting it would hang forever —
  // with consent *already granted*, which is the worst moment to hang. Exit with the list instead:
  // the caller re-runs with the flag. This is the path an agent-driven background run takes.
  if (!stdin.isTTY) {
    die(
      `more than one ${label} and no terminal to ask on.\n\n` +
        `      Re-run with the id you want, e.g.  npm run gbp:auth -- --${label}=${items[0].id}\n` +
        '      The refresh token is already saved; the re-run only needs consent again to obtain a\n' +
        '      short-lived access token for the lookup.'
    );
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`\nWhich ${label}? [1-${items.length}] `);
  rl.close();
  const idx = Number.parseInt(answer, 10) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) die('invalid selection.');
  return items[idx].id;
}

// Deliberately single-page: neither call follows nextPageToken. A Google account with more than 100
// locations would need a cursor loop the way Step 3 and Step 5 of the skill do, but this store has
// one. Not an oversight — revisit only if the list ever comes back truncated.
async function discoverIds(accessToken) {
  const accountsBody = await api(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    accessToken
  );
  const accounts = (accountsBody.accounts ?? []).map((a) => ({
    // The API returns full resource paths ("accounts/123"); .env wants the bare numeric id.
    id: a.name.replace(/^accounts\//, ''),
    title: a.accountName ?? a.name,
  }));
  const accountId = await choose('account', accounts);

  const locationsBody = await api(
    `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title&pageSize=100`,
    accessToken
  );
  const locations = (locationsBody.locations ?? []).map((l) => ({
    id: l.name.replace(/^locations\//, ''),
    title: l.title ?? l.name,
  }));
  const locationId = await choose('location', locations);

  return { accountId, locationId };
}

// --- main ------------------------------------------------------------------

const env = await readEnv();
const clientId = env.GOOGLE_CLIENT_ID;
const clientSecret = env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  die(
    'GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET are missing from .env.\n\n' +
      '      These two cannot be automated — they come from a Desktop app OAuth client you create\n' +
      '      by hand in the Google Cloud Console:\n\n' +
      '        1. console.cloud.google.com — create or pick a project\n' +
      '        2. APIs & Services > Library — enable "My Business Account Management API",\n' +
      '           "My Business Business Information API" and "Google My Business API"\n' +
      '        3. APIs & Services > OAuth consent screen — External, add yourself as a test user,\n' +
      `           add the scope ${SCOPE}\n` +
      '        4. Credentials > Create credentials > OAuth client ID > **Desktop app**\n\n' +
      '      Then: cp .env.example .env, paste the two values in, and re-run this script.'
  );
}

// The awaits below can reject (consent denied, state mismatch, timeout). Catching here keeps every
// failure in the same "STOP: …" shape as die() instead of dumping a raw Node stack trace.
let refreshToken, accessToken, accountId, locationId;
try {
  console.log('Starting the Google Business Profile consent flow.');
  ({ refreshToken, accessToken } = await getRefreshToken(clientId, clientSecret));
  // Save the refresh token *before* discovery, not after. Discovery is the step most likely to
  // fail — a 403 while Business Profile API access is still pending, or a multi-location bail-out —
  // and a token thrown away there costs the user another full consent round-trip to re-obtain
  // something they already had. writeEnv is update-or-append per key, so this composes with the
  // second write below.
  await writeEnv({ GOOGLE_REFRESH_TOKEN: refreshToken });
  console.log('\nRefresh token obtained and saved to .env.');

  console.log('\nDiscovering account and location…');
  ({ accountId, locationId } = await discoverIds(accessToken));
} catch (err) {
  die(err.message);
}

await writeEnv({
  GBP_ACCOUNT_ID: accountId,
  GBP_LOCATION_ID: locationId,
});

console.log('\nWrote GOOGLE_REFRESH_TOKEN, GBP_ACCOUNT_ID and GBP_LOCATION_ID to .env.');
console.log('The refresh token was not printed. .env is gitignored — keep it that way.');
console.log('\nYou can now run the sync-google-reviews skill.');
