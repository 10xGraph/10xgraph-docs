// localStorage helpers for the docs map. Every access is wrapped: private mode and blocked
// storage must never break the page.
const EXPLORED = 'docs:map:explored'; // nodes selected on the map
const READ = 'docs:visited'; // pages opened as pages (written by scripts/docs-reader.ts too)
const CARD = 'docs:map:card'; // 'dismissed' once the Find your path card was closed
const ROUTE = 'docs:map:route'; // '<route id>:<step index>' of the active route

const read = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string | null) => {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* lasts for this page only */ }
};
const readList = (key: string): string[] => {
  try {
    const v = JSON.parse(read(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
};

/** Ids the visitor has seen: selected on the map or opened as a page. */
export const loadSeen = () => new Set([...readList(EXPLORED), ...readList(READ)]);
export const saveExplored = (ids: Set<string>) => write(EXPLORED, JSON.stringify([...ids]));
export const clearSeen = () => { write(EXPLORED, null); write(READ, null); };
export const markRead = (id: string) => {
  const list = readList(READ);
  if (!list.includes(id)) write(READ, JSON.stringify([...list, id]));
};

export const cardDismissed = () => read(CARD) === 'dismissed';
export const setCardDismissed = (v: boolean) => write(CARD, v ? 'dismissed' : null);

export function loadRoute(): { id: string; idx: number } | null {
  const [id, idx] = (read(ROUTE) ?? '').split(':');
  return id ? { id, idx: Number(idx) || 0 } : null;
}
export const saveRoute = (id: string | null, idx = 0) => write(ROUTE, id ? `${id}:${idx}` : null);
