// The desktop map: wires state, the 3D graph, the panel, routes, search and the reader together.
// Loaded only on desktop, by index.ts.
import { S, $, byId, out, inn, pathById, computeFocus, animate, REDUCED, type GNode, type View } from './state';
import { createGraph } from './graph3d';
import { renderPanel, closePanel, showMore, isPlaying, setPlaying } from './panel';
import { showCard, cardWanted, updateProgress, renderRouteChip, buildLegend, search, closeResults, moveResult, topResult, initTooltip, hover, drawLabels } from './controls';
import { initReader, openReader, isOpen } from './reader';
import { saveExplored, clearSeen, saveRoute, loadRoute } from './store';
import type { MapPath } from '../../lib/docs-graph';

let stageH = 0;
let playTimer = 0;
let runToken = 0;

const view = () => S.view as View;
function refresh(t = 0) {
  computeFocus();
  view().styles(t);
  view().links();
}

// ---------- selection ----------
function selectNode(id: string, opts: { fly?: boolean } = {}) {
  const n = byId.get(id);
  if (!n || n.x === undefined) return;
  S.selected = id;
  S.neighbours = new Set([...out.get(id)!, ...inn.get(id)!]);
  S.matches = new Set();
  $<HTMLInputElement>('dm-q').value = '';
  closeResults();
  S.seen.add(id);
  saveExplored(S.seen);
  if (S.activePath) {
    const i = S.activePath.steps.indexOf(id);
    if (i >= 0) S.pathIdx = i;
    saveRoute(S.activePath.id, S.pathIdx);
    S.trailDirty = true;
  }
  showCard(false);
  refresh();
  if (opts.fly !== false) view().fly(n);
  renderPanel();
  renderRouteChip();
  updateProgress();
}

function overview() {
  stopPlay();
  if (!S.selected) return;
  S.selected = null;
  S.neighbours = new Set();
  refresh();
  view().home();
  closePanel();
}

// ---------- routes ----------
function stopPlay() {
  setPlaying(false);
  clearInterval(playTimer);
  if (S.selected && S.activePath) renderPanel(true);
}
function startPlay() {
  if (!S.activePath) return;
  setPlaying(true);
  clearInterval(playTimer);
  playTimer = window.setInterval(() => (S.pathIdx >= S.activePath!.steps.length - 1 ? stopPlay() : stepPath(1)), 4200);
  renderPanel(true);
}
function stepPath(d: number) {
  const p = S.activePath;
  if (!p) return;
  S.pathIdx = Math.max(0, Math.min(p.steps.length - 1, S.pathIdx + d));
  const id = p.steps[S.pathIdx];
  selectNode(id);
  if (isOpen()) openReader(id, { push: false });
}

async function setPath(p: MapPath | null, resume = -1) {
  stopPlay();
  const token = ++runToken;
  S.activePath = p;
  S.pathIdx = Math.max(0, resume);
  S.trailP = 0;
  view().setTrail();
  saveRoute(p?.id ?? null, S.pathIdx);
  renderRouteChip();
  if (!p) { S.selected ? overview() : refresh(); return; }
  showCard(false);
  const last = p.steps.length - 1;
  S.selected = null;
  selectNode(p.steps[S.pathIdx], { fly: false });
  const target = byId.get(p.steps[S.pathIdx])!;
  if (resume >= 0) { S.trailP = last; S.trailDirty = true; view().fly(target); return; }
  // Show the whole route first, draw its trail, then fly to step 1.
  if (!REDUCED) view().home();
  S.tweening = true;
  await animate(Math.min(3600, 500 + p.steps.length * 280), (v) => {
    if (token !== runToken) return;
    S.trailP = v * last;
    S.trailDirty = true;
  });
  if (token !== runToken) return;
  S.tweening = false;
  S.trailDirty = true;
  view().fly(target);
}

// ---------- events ----------
function onClick(e: MouseEvent) {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-go],[data-path],[data-act],[data-sec],[data-more],[data-read]');
  if (!t || !t.closest('.dm-desktop') || t.closest('dialog')) {
    if (!(e.target as HTMLElement).closest('.dm-search')) closeResults();
    return;
  }
  const d = t.dataset;
  if (d.read) openReader(d.read);
  else if (d.go) selectNode(d.go);
  else if (d.path) setPath(pathById.get(d.path)!);
  else if (d.more) showMore(d.more as 'out' | 'in');
  else if (d.sec) {
    if (d.sec === '*') S.hidden.clear();
    else S.hidden.has(d.sec) ? S.hidden.delete(d.sec) : S.hidden.add(d.sec);
    buildLegend();
    view().visibility();
    S.trailDirty = true;
  } else if (d.act === 'prev') stepPath(-1);
  else if (d.act === 'next') stepPath(1);
  else if (d.act === 'play') (isPlaying() ? stopPlay() : startPlay());
  else if (d.act === 'exit') setPath(null);
}

function onKey(e: KeyboardEvent) {
  if (isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
  if (e.key === 'Escape' && !typing) {
    if (S.selected) overview();
    else if (S.activePath) setPath(null);
  } else if (!typing && S.activePath && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    stepPath(e.key === 'ArrowRight' ? 1 : -1);
  }
}

function initSearch() {
  const q = $<HTMLInputElement>('dm-q');
  q.addEventListener('input', () => search(q.value, refresh));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && topResult()) { selectNode(topResult()); q.blur(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveResult(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Escape') { q.value = ''; search('', refresh); q.blur(); e.stopPropagation(); }
  });
}

// ---------- boot ----------
export async function startMap() {
  const stage = $('dm-stage');
  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  stageH = size().h;
  buildLegend();
  updateProgress();
  initTooltip();
  initSearch();
  initReader((id) => selectNode(id), stepPath);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  $('dm-show-card').addEventListener('click', () => showCard($('dm-card').hidden, { focus: true }));
  $('dm-explore').addEventListener('click', () => showCard(false, { remember: true }));
  $('dm-pclose').addEventListener('click', overview);
  $('dm-reset').addEventListener('click', () => {
    S.seen = new Set();
    clearSeen();
    updateProgress();
    refresh();
    if (S.selected) renderPanel(true);
  });

  const saved = loadRoute();
  const resume = saved && pathById.get(saved.id);
  S.view = await createGraph($('dm-graph'), size(), {
    onNodeClick: (id) => selectNode(id),
    onNodeHover: (n: GNode | null) => hover(n),
    onBackgroundClick: overview,
    onSettled: () => { if (resume) setPath(resume, Math.min(saved.idx, resume.steps.length - 1)); },
  });
  new ResizeObserver(() => { const s = size(); stageH = s.h; view().resize(s.w, s.h); }).observe(stage);

  view().styles();
  view().links();
  $('dm-loading').hidden = true;
  if (!resume && cardWanted()) showCard(true);

  const frame = (t: number) => {
    requestAnimationFrame(frame);
    view().tick(t);
    if (S.matches.size) view().styles(t);
    drawLabels(stageH);
  };
  requestAnimationFrame(frame);
  await animate(2400, (v) => { S.introV = v; view().styles(); });
  S.introV = 1;
  view().styles();
}
