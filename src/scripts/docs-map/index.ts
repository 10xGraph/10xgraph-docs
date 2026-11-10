// Entry point of /docs/map. The 3D map (three.js from a CDN, about a megabyte) is loaded only
// when the viewport is desktop width; phones get the static route lists and download none of it.
const DESKTOP = matchMedia('(min-width: 1024px)');
let started = false;

async function start() {
  if (started || !DESKTOP.matches) return;
  started = true;
  const root = document.querySelector('.docs-map')!;
  try {
    const { startMap } = await import('./app');
    await startMap();
    root.classList.add('dm-ready');
  } catch (err) {
    console.error(err);
    root.classList.add('dm-fallback'); // shows the plain route lists instead
    const el = document.getElementById('dm-fallback-note');
    if (el) { el.hidden = false; el.textContent = `The map could not load (${(err as Error).message}). The routes are listed here instead.`; }
  }
}

export function initMap() {
  start();
  DESKTOP.addEventListener('change', start);
}
