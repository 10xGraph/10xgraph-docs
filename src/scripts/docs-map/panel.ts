// The right-hand panel for the selected page: summary, Open page, route controls and neighbours.
import { S, $, esc, byId, out, inn, secColor } from './state';

let playing = false;
const showAll = { out: false, in: false };

export const isPlaying = () => playing;
export const setPlaying = (v: boolean) => { playing = v; };

function list(ids: string[], key: 'out' | 'in') {
  const sorted = ids.map((i) => byId.get(i)!).sort((a, b) => b.inDeg - a.inDeg);
  if (!sorted.length) return '<p class="dm-none">None.</p>';
  const cap = showAll[key] ? sorted.length : 7;
  const rows = sorted.slice(0, cap).map((n) =>
    `<button type="button" data-go="${esc(n.id)}"><i class="dm-dot" style="background:${secColor.get(n.section)}"></i><span class="t">${esc(n.title)}</span>${S.seen.has(n.id) ? '<span class="seen" title="Explored"></span>' : ''}</button>`).join('');
  const more = sorted.length > cap ? `<button type="button" class="more" data-more="${key}">Show all ${sorted.length}</button>` : '';
  return `<div class="dm-list">${rows}${more}</div>`;
}

function routeBox() {
  const p = S.activePath;
  if (!p) return '';
  const N = p.steps.length, on = p.steps[S.pathIdx] === S.selected;
  return `<div class="dm-routebox">
    <div class="row"><b>${esc(p.name)}</b><span>${on ? `Step ${S.pathIdx + 1} of ${N}` : `Off route, ${N} steps`}</span></div>
    <div class="track"><i style="width:${((S.pathIdx + 1) / N) * 100}%"></i></div>
    <div class="ctl">
      <button type="button" class="dm-btn sm" data-act="prev" ${S.pathIdx <= 0 ? 'disabled' : ''}>Previous</button>
      <button type="button" class="dm-btn sm" data-act="play">${playing ? 'Pause' : 'Play tour'}</button>
      <button type="button" class="dm-btn sm" data-act="next" ${S.pathIdx >= N - 1 ? 'disabled' : ''}>Next</button>
    </div>
    <button type="button" class="dm-link" data-act="exit">End route</button>
  </div>`;
}

/** Fills the panel for the selected node and shows it. keepScroll leaves the scroll position alone. */
export function renderPanel(keepScroll = false) {
  if (!S.selected) return;
  const n = byId.get(S.selected)!;
  const body = $('dm-pbody');
  const scroll = body.scrollTop;
  body.innerHTML = `<span class="dm-chip"><i class="dm-dot" style="background:${secColor.get(n.section)}"></i>${esc(n.section)}</span>
    <h2>${esc(n.title)}</h2>
    <p class="desc">${esc(n.description || 'No description yet.')}</p>
    <p class="meta"><span>${n.inDeg} link here</span><span>${n.outDeg} lead on</span></p>
    <button type="button" class="dm-btn primary open" data-read="${esc(n.id)}">Open page</button>
    ${routeBox()}
    <h3 class="dm-sec-h">What's next (${out.get(n.id)!.length})</h3>${list(out.get(n.id)!, 'out')}
    <h3 class="dm-sec-h">Comes from (${inn.get(n.id)!.length})</h3>${list(inn.get(n.id)!, 'in')}`;
  body.scrollTop = keepScroll ? scroll : 0;
  $('dm-panel').hidden = false;
  $('dm-stage').classList.add('is-paneled');
}

export function showMore(key: 'out' | 'in') {
  showAll[key] = true;
  renderPanel(true);
}

export function closePanel() {
  $('dm-panel').hidden = true;
  $('dm-stage').classList.remove('is-paneled');
}
