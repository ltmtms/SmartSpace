// Build flavour. The normal build talks to the SmartSpace server. The "static" build
// (VITE_STATIC=1, used for GitHub Pages) has no server at all: worlds live in this browser.
export const STATIC = import.meta.env.VITE_STATIC === '1';
export const BASE = import.meta.env.BASE_URL; // '/' or e.g. '/SmartSpace/'

// The static build uses #/world/abc links, because a static host cannot route /world/abc to the app.
export const currentPath = () => (STATIC ? location.hash.slice(1) || '/' : location.pathname);
export function setPath(path, replace) {
  history[replace ? 'replaceState' : 'pushState'](null, '', STATIC ? `#${path}` : path);
}
