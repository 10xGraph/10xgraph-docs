// The reader: "Open page" shows the real rendered docs page in a dialog over the map. The page is
// fetched, parsed, and its article (.reader-main) is copied in; the site CSS already applies.
// Links to other docs pages stay in the dialog and select that node on the map.
import { S, $, byId, secColor, esc } from './state';
import { markRead } from './store';

const DROP = '.run-bar, .lens-note, .doc-foot, .ai-note, .edges, .doc-chips';
const pages = new Map<string, Element>(); // parsed articles, by node id
let current: string | null = null;
let stack: string[] = [];
let seq = 0;
let select: (id: string) => void = () => {};
let step: (d: number) => void = () => {};

const dialog = () => $<HTMLDialogElement>('dm-reader');
export const isOpen = () => dialog().open;
export const currentId = () => current;

async function fetchArticle(id: string) {
  const hit = pages.get(id);
  if (hit) return hit;
  const res = await fetch(byId.get(id)!.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const article = doc.querySelector('.reader-main');
  if (!article) throw new Error('page has no article');
  article.querySelectorAll(DROP).forEach((el) => el.remove());
  pages.set(id, article);
  return article;
}

/** Node id of a same-site docs URL, or null. */
function docIdOf(url: URL) {
  if (url.origin !== location.origin || !/^\/docs(\/|$)/.test(url.pathname)) return null;
  const id = url.pathname.replace(/\.html$/, '').replace(/\/+$/, '').replace(/^\/docs\/?/, '') || 'index';
  return byId.has(id) ? id : null;
}

// Copy of the Tabs component's script: inserted markup is not seen by the page-load script.
function wireTabs(root: Element) {
  root.querySelectorAll<HTMLElement>('.tabs').forEach((tabs, n) => {
    const list = tabs.querySelector<HTMLElement>(':scope > .tab-list');
    const panels = [...tabs.querySelectorAll<HTMLElement>(':scope > .tab-panel')];
    if (!list || list.children.length || !panels.length) return;
    const show = (label: string) => {
      list.querySelectorAll('button').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.label === label)); b.tabIndex = b.dataset.label === label ? 0 : -1; });
      panels.forEach((p) => (p.hidden = p.dataset.label !== label));
    };
    panels.forEach((panel, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'tab';
      b.id = `dm-tab-${n}-${i}`;
      b.textContent = panel.dataset.label ?? `Tab ${i + 1}`;
      b.dataset.label = panel.dataset.label;
      b.setAttribute('aria-controls', `${b.id}-panel`);
      panel.id = `${b.id}-panel`;
      panel.setAttribute('aria-labelledby', b.id);
      b.addEventListener('click', () => show(b.dataset.label!));
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const all = [...list.querySelectorAll('button')];
        const next = all[(all.indexOf(b) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
        next.focus();
        next.click();
      });
      list.append(b);
    });
    tabs.classList.add('is-ready');
    show(panels[0].dataset.label ?? '');
  });
}

// Links: docs pages open in the reader, in-page anchors scroll the dialog, everything else opens in a new tab.
function wireLinks(root: Element, id: string) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href')!;
    if (href.startsWith('#')) { a.dataset.anchor = href.slice(1); continue; }
    let url: URL;
    try { url = new URL(href, location.origin + byId.get(id)!.url); } catch { continue; }
    const doc = docIdOf(url);
    if (doc) { a.dataset.doc = doc; a.dataset.hash = url.hash.slice(1); a.href = url.pathname + url.hash; continue; }
    if (/^https?:$/.test(url.protocol) && !a.closest('.code-frame')) { a.target = '_blank'; a.rel = 'noopener'; }
  }
}

function head(id: string) {
  const n = byId.get(id)!;
  $('dm-rchip').innerHTML = `<i class="dm-dot" style="background:${secColor.get(n.section)}"></i>${esc(n.section)}`;
  $('dm-rtitle').textContent = n.title;
  $<HTMLAnchorElement>('dm-rfull').href = n.url;
  $<HTMLButtonElement>('dm-rback').disabled = !stack.length;
  const onPath = !!S.activePath && S.activePath.steps[S.pathIdx] === id;
  for (const b of [$('dm-rprev'), $('dm-rnext')]) b.hidden = !onPath;
  if (onPath) {
    $<HTMLButtonElement>('dm-rprev').disabled = S.pathIdx <= 0;
    $<HTMLButtonElement>('dm-rnext').disabled = S.pathIdx >= S.activePath!.steps.length - 1;
  }
}

function scrollToAnchor(name: string) {
  const el = name ? $('dm-rbody').querySelector<HTMLElement>(`[id="${CSS.escape(name)}"]`) : null;
  if (el) el.scrollIntoView({ block: 'start' });
  else $('dm-rscroll').scrollTop = 0;
}

export async function openReader(id: string, opts: { push?: boolean; hash?: string } = {}) {
  const mine = ++seq;
  const d = dialog();
  if (d.open && opts.push !== false && current && current !== id) stack.push(current);
  current = id;
  if (!d.open) { stack = []; d.showModal(); }
  S.seen.add(id);
  markRead(id);
  head(id);
  const body = $('dm-rbody');
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<p class="dm-rstate">Loading page</p>';
  try {
    const article = await fetchArticle(id);
    if (mine !== seq) return;
    const copy = document.importNode(article, true) as Element;
    body.replaceChildren(...copy.childNodes);
    wireTabs(body);
    wireLinks(body, id);
    // Diagrams are drawn by the same script the page uses; it looks for undrawn mermaid blocks.
    import('../mermaid').then((m) => m.renderMermaid());
  } catch (e) {
    if (mine !== seq) return;
    body.innerHTML = `<p class="dm-rstate">The page could not load (${esc((e as Error).message)}). Use "Open full page" instead.</p>`;
  }
  body.removeAttribute('aria-busy');
  scrollToAnchor(opts.hash ?? '');
  $('dm-rscroll').focus({ preventScroll: true });
}

export function closeReader() {
  seq++;
  current = null;
  stack = [];
  if (dialog().open) dialog().close(); // focus returns to the element that opened it
}

/** select: called when a link inside the reader goes to another docs page. step: Previous/Next on a route. */
export function initReader(onSelect: (id: string) => void, onStep: (d: number) => void) {
  select = onSelect;
  step = onStep;
  const d = dialog();
  $('dm-rclose').addEventListener('click', closeReader);
  d.addEventListener('close', () => {
    seq++; current = null; stack = [];
    // The panel is redrawn while reading, so the element that opened the reader may be gone.
    if (!document.activeElement || document.activeElement === document.body) $('dm-pbody').querySelector<HTMLElement>('.open')?.focus();
  });
  d.addEventListener('click', (e) => { if (e.target === d) closeReader(); }); // the backdrop
  $('dm-rback').addEventListener('click', () => { const id = stack.pop(); if (id) { select(id); openReader(id, { push: false }); } });
  $('dm-rprev').addEventListener('click', () => step(-1));
  $('dm-rnext').addEventListener('click', () => step(1));
  $('dm-rbody').addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a');
    if (!a) return;
    if (a.dataset.anchor !== undefined) { e.preventDefault(); scrollToAnchor(a.dataset.anchor); return; }
    if (!a.dataset.doc) return;
    e.preventDefault();
    if (a.dataset.doc === current) { scrollToAnchor(a.dataset.hash ?? ''); return; }
    select(a.dataset.doc);
    openReader(a.dataset.doc, { hash: a.dataset.hash });
  });
}
