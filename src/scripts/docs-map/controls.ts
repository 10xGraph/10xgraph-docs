// The chrome around the map: Find your path card, route chip, progress, legend, search, tooltip
// and the hub labels that follow nodes on screen.
import { S, $, esc, DATA, nodes, byId, secColor, hubIds, nodeVisible, type GNode } from './state';
import { cardDismissed, setCardDismissed } from './store';

/** remember: store the choice (closing is remembered as dismissed). focus: move focus into the card. */
export function showCard(show: boolean, opts: { remember?: boolean; focus?: boolean } = {}) {
  $('dm-card').hidden = !show;
  if (opts.remember) setCardDismissed(!show);
  if (show && opts.focus) $('dm-card').querySelector<HTMLElement>('.dm-choice')?.focus({ preventScroll: true });
}
export const cardWanted = () => !cardDismissed();

export function updateProgress() {
  $('dm-pcount').textContent = `${S.seen.size} / ${nodes.length}`;
  for (const el of document.querySelectorAll<HTMLElement>('.dm-choice [data-route-progress]')) {
    const p = DATA.paths.find((x) => x.id === el.dataset.routeProgress)!;
    el.textContent = `${p.steps.filter((i) => S.seen.has(i)).length} of ${p.steps.length} read`;
  }
  for (const el of document.querySelectorAll<HTMLElement>('.dm-more [data-route-progress]')) {
    const p = DATA.paths.find((x) => x.id === el.dataset.routeProgress)!;
    el.textContent = `${p.steps.filter((i) => S.seen.has(i)).length}/${p.steps.length}`;
  }
}

export function renderRouteChip() {
  const chip = $('dm-route-chip');
  chip.hidden = !S.activePath;
  if (S.activePath) chip.textContent = `${S.activePath.name}, step ${Math.max(1, S.pathIdx + 1)} of ${S.activePath.steps.length}`;
}

export function buildLegend() {
  const fams = [...new Set(DATA.sections.map((s) => s.family))];
  $('dm-legend').innerHTML = fams.map((f) => `<div class="fam"><span>${f}</span>${DATA.sections.filter((s) => s.family === f).map((s) =>
    `<button type="button" data-sec="${esc(s.name)}" class="${S.hidden.has(s.name) ? 'off' : ''}" aria-pressed="${!S.hidden.has(s.name)}"><i class="dm-dot" style="background:${s.color}"></i>${esc(s.name)} <em>${s.count}</em></button>`).join('')}</div>`).join('')
    + (S.hidden.size ? '<button type="button" data-sec="*">Show all</button>' : '');
}

// ---------- search ----------
let resultIds: string[] = [];
let resultOn = 0;
export const closeResults = () => { $('dm-results').hidden = true; resultIds = []; };
export const topResult = () => resultIds[resultOn];

export function search(q: string, refresh: () => void) {
  q = q.trim().toLowerCase();
  if (!q) { S.matches = new Set(); closeResults(); refresh(); return; }
  const toks = q.split(/\s+/), scored: [number, GNode][] = [];
  for (const n of nodes) {
    const t = `${n.title} ${n.label}`.toLowerCase(), d = n.description.toLowerCase(), id = n.id.toLowerCase();
    if (!toks.every((k) => t.includes(k) || id.includes(k) || d.includes(k))) continue;
    let s = 1;
    if (t.startsWith(q)) s += 4;
    if (toks.every((k) => t.includes(k))) s += 3;
    if (toks.every((k) => id.includes(k))) s += 1;
    scored.push([s + Math.min(2, n.inDeg / 20), n]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  S.matches = new Set(scored.map((s) => s[1].id));
  resultIds = scored.slice(0, 8).map((s) => s[1].id);
  resultOn = 0;
  const box = $('dm-results');
  box.hidden = false;
  box.innerHTML = resultIds.length
    ? resultIds.map((id, i) => { const n = byId.get(id)!; return `<button type="button" role="option" data-go="${esc(id)}" class="${i === 0 ? 'on' : ''}"><i class="dm-dot" style="background:${secColor.get(n.section)}"></i><span class="t">${esc(n.title)}</span><span class="s">${esc(n.section)}</span></button>`; }).join('')
      + (S.matches.size > 8 ? `<div class="dm-none">${S.matches.size - 8} more highlighted on the map</div>` : '')
    : '<div class="dm-none">No matching pages</div>';
  refresh();
}
export function moveResult(d: number) {
  resultOn = (resultOn + d + resultIds.length) % Math.max(1, resultIds.length);
  $('dm-results').querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === resultOn));
}

// ---------- tooltip ----------
let mx = 0, my = 0;
export function initTooltip() {
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; if ($('dm-tip').style.opacity === '1') placeTip(); });
}
function placeTip() {
  const tip = $('dm-tip');
  tip.style.left = `${Math.min(innerWidth - 290, mx + 14)}px`;
  tip.style.top = `${my + 14}px`;
}
export function hover(n: GNode | null) {
  const tip = $('dm-tip');
  $('dm-graph').style.cursor = n ? 'pointer' : '';
  if (!n) { tip.style.opacity = '0'; return; }
  tip.innerHTML = `${esc(n.title)}<small>${esc(n.section)} &middot; ${n.inDeg} in, ${n.outDeg} out</small>`;
  placeTip();
  tip.style.opacity = '1';
}

// ---------- hub labels ----------
const labelEls = new Map<string, HTMLElement>();
export function drawLabels(height: number) {
  const view = S.view!;
  const ids = new Set(hubIds);
  if (S.selected) ids.add(S.selected);
  const step = S.activePath?.steps[S.pathIdx];
  if (step) ids.add(step);
  const list = [...ids].map((i) => byId.get(i)!).sort((a, b) => Number(b.id === S.selected) - Number(a.id === S.selected) || b.inDeg - a.inDeg);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const used = new Set<string>();
  for (const n of list) {
    let el = labelEls.get(n.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'dm-label';
      el.textContent = n.label || n.title;
      $('dm-overlay').appendChild(el);
      labelEls.set(n.id, el);
    }
    used.add(n.id);
    const p = nodeVisible(n) ? view.project(n) : null;
    let show = !!p;
    if (p) {
      const w = el.textContent!.length * 6.6 + 10, x = p.x - w / 2, y = p.y - 26, hgt = 16;
      const clash = placed.some((r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + hgt > r.y);
      if ((clash && n.id !== S.selected) || p.y > height - 6) show = false;
      else placed.push({ x, y, w, h: hgt });
      if (show) {
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -150%)`;
        el.style.opacity = String((S.focus && !S.focus.has(n.id) ? 0.2 : 1) * p.fade * Math.min(1, S.introV * 1.5));
      }
    }
    el.classList.toggle('sel', n.id === S.selected);
    if (!show) el.style.opacity = '0';
  }
  for (const [id, el] of labelEls) if (!used.has(id)) el.style.opacity = '0';
}
