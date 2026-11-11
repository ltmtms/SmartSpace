import './styles.css';
import { api } from './api.js';
import { STATIC, BASE, currentPath, setPath } from './env.js';
import { h, clear, toast } from './ui/dom.js';
import { loginPage } from './pages/login.js';
import { dashboardPage } from './pages/dashboard.js';

const app = document.getElementById('app');
const state = { user: null, config: null, page: null };
if (import.meta.env.DEV) window.__smartspace = state; // handy in the browser console while developing

/** Client-side routes:  /  (my worlds)   /world/:id  (editor / player) */
export async function navigate(path, { replace = false } = {}) {
  if (path !== currentPath()) setPath(path, replace);
  await render();
}
window.addEventListener('popstate', () => render());

async function render() {
  // leaving a page (e.g. the editor) lets it save and release the WebGL context first
  const leaving = state.page;
  state.page = null;
  if (leaving?.close) await leaving.close();

  const path = currentPath();
  if (!state.user) {
    clear(app).append(loginPage(state.config, async (user) => { state.user = user; await render(); }));
    return;
  }
  const m = path.match(/^\/world\/([a-z0-9]+)$/);
  if (m) {
    clear(app).append(h('div.loading', null, 'Opening world…'));
    try {
      const [{ world }, { Editor }] = await Promise.all([api.world(m[1]), import('./editor/Editor.js')]);
      const editor = new Editor(app, { meta: world, user: state.user, navigate });
      state.page = editor;
      await editor.init();
    } catch (e) {
      state.page?.destroy?.();
      state.page = null;
      toast(e.message || 'Could not open that world.', 'error');
      if (e.status === 401) { state.user = null; return render(); }
      setPath('/', true);
      return render();
    }
    return;
  }
  if (path !== '/') setPath('/', true);
  clear(app).append(dashboardPage(state.user, navigate, STATIC ? null : async () => { await api.logout(); state.user = null; await render(); }));
}

(async function start() {
  try {
    const [config, me] = await Promise.all([api.config(), api.me()]);
    state.config = config;
    state.user = me.user;
  } catch (e) {
    clear(app).append(h('div.loading', null, STATIC ? e.message : 'SmartSpace could not reach its server. Please reload.'));
    return;
  }
  await render();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register(`${BASE}sw.js`).catch(() => {});
})();
