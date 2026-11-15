// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers';
import { codeFrame } from './src/lib/code-frame.mjs';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// Old docs URLs moved in the October 2026 restructure. Static output writes a redirect page at each
// old path (meta refresh plus canonical), which works on GitHub Pages.
const redirects = JSON.parse(readFileSync(new URL('./src/redirects.json', import.meta.url), 'utf8'));


const SITE_URL = 'https://10xgraph.com';

/**
 * Every file under dir, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

// Sitemap <lastmod>: the `updated` (or blog `date`) frontmatter of each content page, keyed by its
// URL. Pages without a date get no lastmod rather than a misleading build date.
function contentLastmod() {
  const map = new Map();
  for (const [dir, prefix] of [['src/content/docs', '/docs'], ['src/content/blog', '/blog'], ['src/content/build', '/build']]) {
    for (const file of walk(dir).filter((f) => /\.mdx?$/.test(f))) {
      const fm = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
      const date = fm && (fm[1].match(/^updated:\s*['"]?([0-9-]{10})/m) || fm[1].match(/^date:\s*['"]?([0-9-]{10})/m));
      if (!date) continue;
      const slug = relative(dir, file).replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '');
      map.set(`${SITE_URL}${prefix}${slug ? `/${slug}` : ''}`, new Date(date[1]).toISOString());
    }
  }
  // The changelog page changes with every release: use the newest release date.
  let newest = '';
  for (const file of walk('src/content/releases')) {
    const m = readFileSync(file, 'utf8').match(/^date:\s*['"]?([0-9-]{10})/m);
    if (m && m[1] > newest) newest = m[1];
  }
  if (newest) map.set(`${SITE_URL}/changelog`, new Date(newest).toISOString());
  return map;
}
const lastmod = contentLastmod();

// Post-build steps for static hosting:
// - Drop noindex pages (e.g. thin blog topic pages) from the sitemap, so the two never disagree.
// - Markdown tables often leave the first header cell empty (| | a | b |); screen readers then
//   announce nothing for that column, so it gets a visually hidden label.
/** @type {import('astro').AstroIntegration} */
const postBuild = {
  name: 'post-build-seo',
  hooks: {
    'astro:build:done': ({ dir }) => {
      const out = dir.pathname;
      const pages = walk(out).filter((f) => f.endsWith('.html') && !f.includes('/pagefind/'));
      for (const f of pages) {
        const html = readFileSync(f, 'utf8');
        const labelled = html.replace(/<th([^>]*)><\/th>/g, '<th$1><span class="sr-only">Item</span></th>');
        if (labelled !== html) writeFileSync(f, labelled);
      }
      const noindex = pages
        .filter((f) => /<meta name="robots" content="noindex"/.test(readFileSync(f, 'utf8')))
        .map((f) => `${SITE_URL}/${relative(out, f).replace(/\.html$/, '').replace(/(^|\/)index$/, '')}`.replace(/\/$/, ''));
      for (const f of readdirSync(out).filter((n) => /^sitemap-\d+\.xml$/.test(n))) {
        const path = join(out, f);
        const xml = readFileSync(path, 'utf8').replace(/<url><loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g, (m, loc) => (noindex.includes(loc) ? '' : m));
        writeFileSync(path, xml);
      }
    },
  },
};

// Static output only. Canonical URLs have no trailing slash; pages build to /path.html,
// which static hosts (Cloudflare Pages, Netlify, Vercel, GitHub Pages) serve at /path.
export default defineConfig({
  site: 'https://10xgraph.com',
  output: 'static',
  trailingSlash: 'never',
  redirects,
  build: { format: 'file' },
  integrations: [
    mdx(),
    // Utility pages are noindex, so keep them out of the sitemap too.
    sitemap({
      filter: (page) => !/\/(search|404)$/.test(new URL(page).pathname),
      serialize: (item) => {
        const date = lastmod.get(item.url.replace(/\/$/, ''));
        return date ? { ...item, lastmod: date } : item;
      },
    }),
    postBuild,
  ],

  markdown: {
    // Mermaid blocks are left as plain code and drawn in the browser (scripts/mermaid.ts).
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid', 'math'] },
    // Dual themes: colors switch with the site theme through CSS variables (see global.css).
    shikiConfig: {
      themes: { light: 'github-light-high-contrast', dark: 'github-dark' },
      defaultColor: false,
      // Authors can mark lines: {2,4-5} in the fence meta, or "# [!code highlight]", "# [!code ++]",
      // "# [!code --]" and "# [!code focus]" comments. codeFrame() must run last: it wraps the <pre>.
      transformers: [
        transformerMetaHighlight(),
        transformerNotationHighlight(),
        transformerNotationDiff(),
        transformerNotationFocus(),
        codeFrame(),
      ],
    },
  },

});