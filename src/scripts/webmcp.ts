// WebMCP tools (https://developer.chrome.com/docs/ai/webmcp): lets an AI agent running in the
// browser search the site and read pages as markdown instead of scraping HTML. All tools are
// read-only and same-origin. Browsers without WebMCP skip this file's work entirely.

import { clean, loadPagefind } from './search';

interface ToolAnnotations { readOnlyHint?: boolean; untrustedContentHint?: boolean }
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  execute(input: unknown): Promise<string>;
}
interface ModelContext { registerTool(tool: Tool): unknown }

// Pages with a markdown twin at <path>.md (see src/pages/*/[...slug].md.ts).
const PAGE_PATH = /^\/(docs|blog|build)(\/[A-Za-z0-9._-]+)*$/;
// Long pages are cut so one tool call cannot flood the model's context.
const MAX_CHARS = 50_000;

// Before Chrome 155 tool input could arrive as a JSON string.
const args = (input: unknown): Record<string, unknown> =>
  typeof input === 'string' ? JSON.parse(input || '{}') : ((input as Record<string, unknown>) ?? {});

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '');

/** Accepts a path or a full URL on this site and returns its clean path, or null. */
function pagePath(raw: string): string | null {
  let path: string;
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin) return null;
    path = url.pathname;
  } catch {
    return null;
  }
  path = path.replace(/\.(html|md)$/, '').replace(/\/$/, '');
  return PAGE_PATH.test(path) ? path : null;
}

async function fetchText(path: string) {
  const res = await fetch(path, { headers: { Accept: 'text/markdown, text/plain' } });
  if (!res.ok) return null;
  const text = await res.text();
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[Truncated at ${MAX_CHARS} characters.]` : text;
}

const tools: Tool[] = [
  {
    name: 'search_docs',
    description:
      'Search the 10xGraph documentation, build guides and blog. Returns the best matching pages ' +
      'with their title, URL, a markdown URL and a short excerpt. Use get_page_markdown to read a result.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'Search terms, for example "checkpointer postgres" or "jwt auth".' },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'Maximum number of results.' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const { query, limit = 5 } = args(input) as { query?: string; limit?: number };
      if (!query?.trim()) return 'Provide a non-empty query.';
      const pf = await loadPagefind();
      if (!pf) return 'Search is unavailable on this page. Read /llms.txt for the full page index instead.';
      const { results } = await pf.search(query);
      const top = await Promise.all(results.slice(0, Math.min(Math.max(1, limit), 10)).map((r) => r.data()));
      return JSON.stringify(
        top.map((r) => {
          const url = clean(r.url);
          return {
            title: r.meta.title ?? url,
            url: new URL(url, location.origin).href,
            markdownUrl: pagePath(url) ? new URL(`${url}.md`, location.origin).href : undefined,
            excerpt: stripTags(r.excerpt),
          };
        }),
      );
    },
  },
  {
    name: 'get_page_markdown',
    description:
      'Read a 10xGraph docs page, build guide or blog post as plain markdown. Pass a path such as ' +
      '"/docs/concepts/memory" or a full 10xgraph.com URL. Leave path empty to read the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', maxLength: 300, description: 'Page path under /docs, /build or /blog, or a full URL on this site. Defaults to the current page.' },
      },
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const { path: raw } = args(input) as { path?: string };
      const path = pagePath(raw || location.pathname);
      if (!path) return 'Only pages under /docs, /build and /blog have a markdown version. Use search_docs to find one.';
      return (await fetchText(`${path}.md`)) ?? `No markdown version found for ${path}. Use search_docs to find the right page.`;
    },
  },
  {
    name: 'get_site_index',
    description:
      'Get the llms.txt index of the 10xGraph site: every docs page, build guide and blog post, grouped ' +
      'by section, each with a one-line summary and its markdown URL. Use it to browse when search terms are unclear.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async execute() {
      return (await fetchText('/llms.txt')) ?? 'The site index could not be loaded.';
    },
  },
];

const doc = document as Document & { modelContext?: ModelContext };
const nav = navigator as Navigator & { modelContext?: ModelContext };
const modelContext = doc.modelContext ?? nav.modelContext;

if (modelContext) {
  for (const tool of tools) {
    // registerTool is synchronous in some Chrome versions and returns a promise in others.
    try {
      Promise.resolve(modelContext.registerTool(tool)).catch((e) => console.warn(`WebMCP: ${tool.name}`, e));
    } catch (e) {
      console.warn(`WebMCP: ${tool.name}`, e);
    }
  }
}
