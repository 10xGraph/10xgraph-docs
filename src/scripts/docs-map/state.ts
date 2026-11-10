// Shared state of the map: the data indexes, what is selected, and how that styles nodes and links.
import type { MapData, MapNode, MapPath } from '../../lib/docs-graph';
import { loadSeen } from './store';

/** A node once the force layout has given it a position. */
export type GNode = MapNode & { x?: number; y?: number; z?: number; __m?: any; __h?: any };
export type GLink = { source: string | GNode; target: string | GNode };

/** What the 3D graph exposes to the rest of the map. */
export interface View {
  styles(t?: number): void;
  links(): void;
  visibility(): void;
  fly(n: GNode): void;
  home(): void;
  project(n: GNode): { x: number; y: number; fade: number } | null;
  resize(w: number, h: number): void;
  tick(t: number): void;
  setTrail(): void;
}

export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const DATA: MapData = JSON.parse(document.getElementById('docs-map-data')!.textContent!);
export const nodes: GNode[] = DATA.nodes.map((n) => ({ ...n }));
export const links: GLink[] = DATA.links.map((l) => ({ ...l }));
export const byId = new Map(nodes.map((n) => [n.id, n]));
export const secColor = new Map(DATA.sections.map((s) => [s.name, s.color]));
export const out = new Map(nodes.map((n) => [n.id, [] as string[]]));
export const inn = new Map(nodes.map((n) => [n.id, [] as string[]]));
for (const l of DATA.links) {
  out.get(l.source)!.push(l.target);
  inn.get(l.target)!.push(l.source);
}
export const pathById = new Map(DATA.paths.map((p) => [p.id, p]));
export const curated = DATA.paths.filter((p) => p.id.startsWith('route-'));
export const hubIds = new Set([...nodes].sort((a, b) => b.inDeg - a.inDeg).slice(0, 12).map((n) => n.id));
export const lid = (x: string | GNode) => (typeof x === 'object' ? x.id : x);

export const S = {
  view: null as View | null,
  selected: null as string | null,
  neighbours: new Set<string>(),
  activePath: null as MapPath | null,
  pathIdx: -1,
  matches: new Set<string>(),
  hidden: new Set<string>(),
  seen: loadSeen(),
  focus: null as Set<string> | null,
  introV: 0, // 0 to 1: nodes grow in once at load
  trailP: 0, // how far along the active route the trail is drawn
  trailDirty: true,
  simRunning: true, // the force layout is still moving
  tweening: false, // the trail is being drawn
};
for (const id of S.seen) if (!byId.has(id)) S.seen.delete(id);

export const OUT_C = '#7ea6ff';
export const IN_C = '#a9bde8';
const hexToRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgba = (h: string, a: number) => `rgba(${hexToRgb(h).join(',')},${a})`;
export const ease = (x: number) => 1 - Math.pow(1 - x, 3);

/** Which nodes stay lit: search matches, else the selection with its neighbours plus the active route. */
export function computeFocus() {
  const f = new Set<string>();
  if (S.matches.size) S.matches.forEach((i) => f.add(i));
  else {
    if (S.selected) {
      f.add(S.selected);
      S.neighbours.forEach((i) => f.add(i));
    }
    S.activePath?.steps.forEach((i) => f.add(i));
  }
  S.focus = f.size ? f : null;
}

export function nodeStyle(n: GNode, t = 0) {
  const lit = !S.focus || S.focus.has(n.id);
  const sel = n.id === S.selected;
  let r = 1.4 + Math.sqrt(n.inDeg) * 0.42;
  if (S.matches.has(n.id)) r *= 1 + 0.3 * (0.5 + 0.5 * Math.sin(t / 150));
  if (sel) r *= 1.35;
  return { color: secColor.get(n.section)!, alpha: lit ? 0.96 : 0.09, r, ring: sel ? 2 : S.seen.has(n.id) ? 1 : 0 };
}

export function linkState(l: GLink) {
  if (!S.selected) return null;
  if (lid(l.source) === S.selected) return 'out';
  if (lid(l.target) === S.selected) return 'in';
  return null;
}
export function linkStyle(l: GLink) {
  const st = linkState(l);
  if (st) return { color: st === 'out' ? OUT_C : IN_C, alpha: st === 'out' ? 0.7 : 0.45, width: 0.3, particles: REDUCED ? 0 : 1 };
  const dim = !!(S.selected || S.matches.size);
  return { color: '#8a97b0', alpha: dim ? 0.012 : S.activePath ? 0.03 : 0.045, width: 0, particles: 0 };
}
export const nodeVisible = (n: GNode) => !S.hidden.has(n.section);
export const linkVisible = (l: GLink) => !S.hidden.has(byId.get(lid(l.source))!.section) && !S.hidden.has(byId.get(lid(l.target))!.section);

/** Runs onUpdate(0..1) over ms with a frame loop; resolves when done. No time when motion is reduced. */
export function animate(ms: number, onUpdate: (v: number) => void) {
  return new Promise<void>((resolve) => {
    if (REDUCED || ms <= 0) { onUpdate(1); return resolve(); }
    const t0 = performance.now();
    const step = (now: number) => {
      const v = Math.min(1, (now - t0) / ms);
      onUpdate(v);
      v < 1 ? requestAnimationFrame(step) : resolve();
    };
    requestAnimationFrame(step);
  });
}
