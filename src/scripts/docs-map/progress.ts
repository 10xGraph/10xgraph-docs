// Progress marks for the static route lists (small screens and no-JS fallback): read the same
// localStorage the map writes, and mark steps as read.
import { loadSeen } from './store';

export function markProgress() {
  const seen = loadSeen();
  document.querySelectorAll<HTMLElement>('[data-dm-path]').forEach((path) => {
    const steps = [...path.querySelectorAll<HTMLElement>('[data-step]')];
    let done = 0;
    for (const s of steps) {
      const on = seen.has(s.dataset.step!);
      s.classList.toggle('is-read', on);
      if (on) done++;
    }
    const count = path.querySelector<HTMLElement>('[data-dm-count]');
    if (count) count.textContent = `${done} of ${steps.length} read`;
  });
}
