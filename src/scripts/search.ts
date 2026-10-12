// Site search on Pagefind's JS API. The index is built from dist/ after `astro build`
// (`npm run build`), and copied to public/pagefind for `npm run dev`.
// Any element with [data-search] gets a working search box: the header dialog and /search.

interface SubResult { title: string; url: string; excerpt: string }
interface ResultData { url: string; excerpt: string; meta: { title?: string }; sub_results: SubResult[] }
interface Pagefind {
  options(o: Record<string, unknown>): Promise<void>;
  search(q: string): Promise<{ results: { id: string; data(): Promise<ResultData> }[] }>;
}

let pagefind: Promise<Pagefind | null> | undefined;
export function loadPagefind() {
  // A full URL, not "/pagefind/...": the Vite dev server rewrites root-relative dynamic imports
  // (adds ?import) and refuses to serve files from public/ that way.
  const url = new URL('/pagefind/pagefind.js', window.location.origin).href;
  pagefind ??= import(/* @vite-ignore */ url)
    .then(async (pf: Pagefind) => {
      await pf.options({ excerptLength: 22 });
      return pf;
    })
    .catch(() => null);
  return pagefind;
}

// Pagefind reports file paths (/docs/concepts/memory.html); the site serves clean URLs.
export const clean = (url: string) => url.replace(/\.html(?=#|$)/, '').replace(/\/index(?=#|$)/, '') || '/';
const kind = (url: string) => (url.startsWith('/blog') ? 'Blog' : url.startsWith('/docs') ? 'Docs' : 'Page');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function render(r: ResultData) {
  const url = clean(r.url);
  const subs = r.sub_results
    .filter((s) => clean(s.url) !== url)
    .slice(0, 3)
    .map((s) => `<li><a class="sr-sub" href="${esc(clean(s.url))}"><span class="sr-sub-title">${esc(s.title)}</span><span class="sr-excerpt">${s.excerpt}</span></a></li>`)
    .join('');
  return `<li class="sr-item">
    <a class="sr-main" href="${esc(url)}"><span class="sr-kind">${kind(url)}</span><span class="sr-title">${esc(r.meta.title ?? url)}</span><span class="sr-excerpt">${r.excerpt}</span></a>
    ${subs ? `<ul class="sr-subs">${subs}</ul>` : ''}
  </li>`;
}

export function mountSearch(root: HTMLElement) {
  const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  const list = root.querySelector<HTMLElement>('.sr-list')!;
  const status = root.querySelector<HTMLElement>('.sr-status')!;
  let timer: number | undefined;
  let seq = 0;

  const links = () => [...list.querySelectorAll<HTMLAnchorElement>('a')];
  const setActive = (a?: HTMLAnchorElement) => {
    links().forEach((l) => l.classList.toggle('is-active', l === a));
    a?.scrollIntoView({ block: 'nearest' });
  };

  async function run(q: string) {
    const mine = ++seq;
    if (!q.trim()) {
      list.innerHTML = '';
      status.textContent = 'Search the docs and the blog. Try "checkpointer", "jwt" or "docker".';
      return;
    }
    const pf = await loadPagefind();
    if (!pf) {
      status.textContent = 'The search index is missing. Run npm run dev or npm run build to generate it.';
      return;
    }
    const { results } = await pf.search(q);
    const data = await Promise.all(results.slice(0, 8).map((r) => r.data()));
    if (mine !== seq) return;
    list.innerHTML = data.map(render).join('');
    status.textContent = results.length ? `${results.length} result${results.length === 1 ? '' : 's'} for "${q}"` : `No results for "${q}".`;
    setActive(links()[0]);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => run(input.value), 120);
  });
  input.addEventListener('keydown', (e) => {
    const all = links();
    const i = all.findIndex((l) => l.classList.contains('is-active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]);
    } else if (e.key === 'Enter' && all[i]) {
      e.preventDefault();
      all[i].click();
    }
  });
  input.addEventListener('focus', () => loadPagefind(), { once: true });
  return { input, run };
}
