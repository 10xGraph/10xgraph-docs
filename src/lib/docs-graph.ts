// Data for the /docs/map page: every docs page as a node, every in-docs markdown link as an edge,
// the sections grouped into five colour families, and the guided paths. Built at build time from
// the docs collection; URL rules come from content.ts (docHref).
import { getDocs, docHref, type Doc } from './content';

export interface MapNode {
  id: string;
  url: string;
  title: string;
  label: string;
  description: string;
  section: string;
  order: number;
  inDeg: number;
  outDeg: number;
}
export interface MapLink { source: string; target: string }
export interface MapSection { name: string; family: string; color: string; count: number }
export interface MapPath { id: string; name: string; blurb: string; steps: string[]; section?: string }
export interface MapData { nodes: MapNode[]; links: MapLink[]; sections: MapSection[]; paths: MapPath[] }

// Five families, one hue each (from the docs brand tokens); sections are lightness steps of it.
const FAMILIES: Record<string, { hue: number; sat: number; items: string[] }> = {
  Learn: { hue: 28, sat: 50, items: ['Get started', 'Concepts', 'Examples'] },
  Build: { hue: 221, sat: 62, items: ['Build agents', 'Data and state', 'Integrations', 'TypeScript client', 'API server'] },
  Run: { hue: 163, sat: 42, items: ['Deploy', 'Platform', 'Background jobs', 'Observability'] },
  Secure: { hue: 354, sat: 55, items: ['Security and access'] },
  Reference: { hue: 214, sat: 16, items: ['Reference', 'Testing and evaluation', 'Glossary', 'Troubleshooting', 'Compare', 'Project'] },
};

// Curated routes. Ids are node ids (the page path under /docs, '' is the docs home).
const ROUTES: [id: string, name: string, blurb: string, steps: string[]][] = [
  ['route-first-agent', 'First agent', 'Install, build and serve your first agent, then learn the core ideas.', [
    'get-started/why-10xgraph', 'get-started/installation', 'get-started/first-agent', 'get-started/project-structure',
    'get-started/tutorial/mental-model', 'get-started/tutorial/build-a-graph', 'concepts/state-graph',
    'concepts/agents-and-tools', 'concepts/state-and-messages', 'concepts/serving-agents']],
  ['route-production', 'To production', 'What runs around your code, how to scale it, ship it and watch it.', [
    'production', 'production/architecture', 'production/scaling', 'production/limits', 'server/production-checklist',
    'server/configure', 'deploy', 'server/kubernetes', 'observability', 'guides/metrics-prometheus-grafana', 'guides/graceful-shutdown']],
  ['route-security', 'Security', 'Auth, roles, tenant isolation, rate limits, validators and the audit log.', [
    'get-started/security-in-five-minutes', 'security', 'production/security-model', 'server/auth', 'concepts/tenancy-and-access',
    'guides/authorization-scopes', 'server/rate-limiting', 'server/cors-and-security-headers',
    'guides/protect-against-prompt-injection', 'server/audit-log', 'production/control-mapping']],
];

function hsl(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Node id of a docs URL path: '/docs/concepts/state-graph' -> 'concepts/state-graph', '/docs' -> 'index'. */
export const nodeIdOf = (entryId: string) => docHref(entryId).replace(/^\/docs\/?/, '') || 'index';

export async function buildDocsGraph(): Promise<MapData> {
  const docs: Doc[] = await getDocs();
  const ids = new Set(docs.map((d) => nodeIdOf(d.id)));

  // Edges: markdown links of the form ](/docs/...) in the page source.
  const edges = new Set<string>();
  const links: MapLink[] = [];
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const d of docs) {
    const from = nodeIdOf(d.id);
    for (const m of (d.body ?? '').matchAll(/\]\(\/docs([^)\s]*)\)/g)) {
      const to = m[1].split('#')[0].split('?')[0].replace(/\/+$/, '').replace(/^\//, '') || 'index';
      if (to === from || !ids.has(to) || edges.has(`${from}>${to}`)) continue;
      edges.add(`${from}>${to}`);
      links.push({ source: from, target: to });
      outDeg.set(from, (outDeg.get(from) ?? 0) + 1);
      inDeg.set(to, (inDeg.get(to) ?? 0) + 1);
    }
  }

  const nodes: MapNode[] = docs.map((d) => {
    const id = nodeIdOf(d.id);
    return {
      id, url: docHref(d.id), title: d.data.title, label: d.data.label ?? '', description: d.data.description,
      section: d.data.section, order: d.data.order, inDeg: inDeg.get(id) ?? 0, outDeg: outDeg.get(id) ?? 0,
    };
  });

  const sections: MapSection[] = [];
  for (const [family, f] of Object.entries(FAMILIES)) {
    f.items.forEach((name, i) => {
      const l = f.items.length === 1 ? 70 : 56 + (i * 20) / (f.items.length - 1);
      const count = nodes.filter((n) => n.section === name).length;
      if (count) sections.push({ name, family, count, color: hsl(f.hue + (i % 2 ? 4 : -4), f.sat - (i % 2 ? 6 : 0), Math.round(l)) });
    });
  }

  const paths: MapPath[] = ROUTES.map(([id, name, blurb, steps]) => ({ id, name, blurb, steps: steps.filter((s) => ids.has(s)) }));
  for (const s of sections) {
    const steps = nodes
      .filter((n) => n.section === s.name)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .map((n) => n.id);
    paths.push({ id: `section-${slugify(s.name)}`, name: s.name, blurb: `All ${s.count} pages in ${s.name}, in reading order.`, steps, section: s.name });
  }
  return { nodes, links, sections, paths };
}
