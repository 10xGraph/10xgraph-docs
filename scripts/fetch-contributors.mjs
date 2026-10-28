#!/usr/bin/env node
/**
 * Contributor and project-activity data generator.
 *
 * 10xGraph is spread across five repositories, so no single GitHub contributor
 * graph shows the whole picture. This merges all five into one list, deduped by
 * login, and writes it to `src/data/contributors.json` for the /maintainers page
 * (src/pages/maintainers.astro) to render.
 *
 * It also writes `src/data/project-stats.json`: total and recent commits and
 * published releases. Commits come from
 * GitHub (default branch only, so a squash-merged pull request counts once).
 * Releases come from PyPI and npm, the registries people install from, because
 * GitHub Releases miss versions published without one. Packages published under
 * the old Agentflow names count too: they are the same project.
 *
 * Re-run it before each release so the numbers on the page stay current.
 *
 * The output is committed. Builds read the JSON and never call the API, so the
 * docs site keeps building when GitHub is down or rate-limiting, and page loads
 * never spend a visitor's unauthenticated API quota.
 *
 * A run makes at least 10 GitHub requests (contributors plus commits for each
 * of the 5 repos, more when a list is paginated). Auth is taken from
 * GITHUB_TOKEN or GH_TOKEN, else from the `gh` CLI login, else the run is
 * unauthenticated, which GitHub limits to 60 requests per hour per IP (CI
 * runners share IPs and can hit the cap).
 *
 * Usage:
 *   npm run contributors
 *   GITHUB_TOKEN=ghp_... npm run contributors
 *   gh auth login && npm run contributors
 */
import {execFileSync} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'src/data/contributors.json');
const STATS_OUT = resolve(root, 'src/data/project-stats.json');

// Canonical names. GitHub redirects the old 10xHub/agentflow-* names, but the
// page labels and links key off these, so keep them current after a transfer.
const REPOS = [
  '10xGraph/10xGraph',
  '10xGraph/10xgraph-api',
  '10xGraph/10xgraph-client',
  '10xGraph/10xgraph-docs',
  '10xHub/agentflow-playground',
];

// Every published package, under its current and its old name.
const PYPI_PACKAGES = ['10xgraph', '10xscale-agentflow', '10xgraph-api', '10xscale-agentflow-cli'];
const NPM_PACKAGES = ['10xgraph-client', '@10xscale/agentflow-client'];
// Short names shown for the latest release.
const PACKAGE_LABELS = {
  '10xgraph': 'core',
  '10xscale-agentflow': 'core',
  '10xgraph-api': 'API and CLI',
  '10xscale-agentflow-cli': 'API and CLI',
  '10xgraph-client': 'TS client',
  '@10xscale/agentflow-client': 'TS client',
};

const DAY = 86_400_000;

/**
 * Rendered separately, as the lead-maintainer card. Leaving the login in the
 * wall as well would just be the same face twice, and the commit spread between
 * a project's founder and its contributors makes for a lopsided grid.
 */
const LEAD_MAINTAINER = 'Iamsdt';

/** Env var first, then the gh CLI login. A missing or logged-out gh means no token. */
function resolveToken() {
  if (process.env.GITHUB_TOKEN) return {token: process.env.GITHUB_TOKEN, source: 'GITHUB_TOKEN'};
  if (process.env.GH_TOKEN) return {token: process.env.GH_TOKEN, source: 'GH_TOKEN'};
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out) return {token: out, source: 'gh CLI'};
  } catch {
    // gh not installed or not logged in
  }
  return {token: null, source: null};
}

const {token, source: tokenSource} = resolveToken();
console.log(
  token
    ? `Using GitHub token from ${tokenSource}`
    : 'No GitHub token: unauthenticated requests are limited to 60/hour',
);

async function github(path) {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': '10xgraph-docs-contributor-sync',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
    },
  });

  if (!res.ok) {
    let hint = '';
    const limited =
      (res.status === 403 || res.status === 429) &&
      res.headers.get('x-ratelimit-remaining') === '0';
    if (limited) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      if (reset) {
        const at = new Date(reset * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        hint += ` (rate limit resets at ${at})`;
      } else {
        hint += ' (rate limited)';
      }
      if (!token) hint += '; run gh auth login or set GITHUB_TOKEN';
    }
    throw new Error(`${path}: HTTP ${res.status} ${res.statusText}${hint}`);
  }
  return res;
}

/** Follows `Link: rel="next"` so lists over 100 entries are complete. */
async function githubAll(path) {
  const items = [];
  let next = path;
  while (next) {
    const res = await github(next);
    items.push(...(await res.json()));
    const link = res.headers.get('link') ?? '';
    const match = link.match(/<https:\/\/api\.github\.com\/([^>]+)>;\s*rel="next"/);
    next = match ? match[1] : null;
  }
  return items;
}

const fetchContributors = (repo) => githubAll(`repos/${repo}/contributors?per_page=100&anon=0`);

/** Commit dates (when each landed on the default branch) since a given time. */
async function fetchCommitDates(repo, since) {
  const commits = await githubAll(`repos/${repo}/commits?since=${since}&per_page=100`);
  return commits.map((c) => Date.parse(c.commit.committer.date));
}

async function fetchPypiReleases(name) {
  const res = await fetch(`https://pypi.org/pypi/${name}/json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`PyPI ${name}: HTTP ${res.status}`);
  const data = await res.json();
  return Object.entries(data.releases)
    .filter(([, files]) => files.length > 0)
    .map(([version, files]) => ({
      package: name,
      version,
      date: files.map((f) => f.upload_time_iso_8601).sort()[0].slice(0, 10),
    }));
}

async function fetchNpmReleases(name) {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`npm ${name}: HTTP ${res.status}`);
  const data = await res.json();
  // Release candidates count (PyPI's rc versions do too). Only the `0.0.0-*` placeholder
  // (for example `0.0.0-stage`) npm adds while a new package's first version is held for
  // review is skipped.
  return Object.keys(data.versions ?? {})
    .filter((version) => !version.startsWith('0.0.0-'))
    .map((version) => ({
      package: name,
      version,
      date: data.time[version].slice(0, 10),
    }));
}

const merged = new Map();
let totalCommits = 0;
let communityCommits = 0;

for (const repo of REPOS) {
  const contributors = await fetchContributors(repo);

  for (const c of contributors) {
    if (c.type === 'Bot' || c.login.endsWith('[bot]')) continue;
    totalCommits += c.contributions;
    if (c.login === LEAD_MAINTAINER) continue;
    communityCommits += c.contributions;

    const existing = merged.get(c.login);
    if (existing) {
      existing.contributions += c.contributions;
      if (!existing.repos.includes(repo)) existing.repos.push(repo);
    } else {
      merged.set(c.login, {
        login: c.login,
        avatar: c.avatar_url.replace(/\?.*$/, ''),
        url: c.html_url,
        contributions: c.contributions,
        repos: [repo],
      });
    }
  }

  console.log(`  ${repo}: ${contributors.length} entries`);
}

const contributors = [...merged.values()].sort(
  (a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login),
);

await mkdir(dirname(OUT), {recursive: true});
await writeFile(OUT, `${JSON.stringify(contributors, null, 2)}\n`, 'utf8');

console.log(
  `\nWrote ${contributors.length} contributors to src/data/contributors.json`,
);

// Commits from the last 90 days, from every repository.
const now = Date.now();
const since90 = new Date(now - 90 * DAY).toISOString();
const dates = [];
for (const repo of REPOS) {
  dates.push(...(await fetchCommitDates(repo, since90)));
}
const last30 = dates.filter((d) => d >= now - 30 * DAY).length;
const last90 = dates.length;

const releases = (
  await Promise.all([...PYPI_PACKAGES.map(fetchPypiReleases), ...NPM_PACKAGES.map(fetchNpmReleases)])
)
  .flat()
  .sort((a, b) => b.date.localeCompare(a.date) || a.package.localeCompare(b.package));
const year = new Date(now).getUTCFullYear();
const latestDate = releases[0]?.date ?? null;

const stats = {
  generatedAt: new Date(now).toISOString().slice(0, 10),
  repositories: REPOS.length,
  commits: {total: totalCommits, community: communityCommits, last30Days: last30, last90Days: last90},
  releases: {
    year,
    thisYear: releases.filter((r) => r.date.startsWith(String(year))).length,
    total: releases.length,
    // Several packages often ship on the same day; list them all.
    latest: releases
      .filter((r) => r.date === latestDate)
      .map((r) => ({...r, label: PACKAGE_LABELS[r.package] ?? r.package})),
  },
};

await writeFile(STATS_OUT, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

console.log(
  `Wrote project stats: ${totalCommits} commits (${last90} in 90 days), ` +
    `${stats.releases.thisYear} releases in ${year}, latest ${latestDate}`,
);
