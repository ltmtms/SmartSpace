// "My worlds": create, open, copy and delete worlds; see worlds shared with you.
import { h, clear, toast, avatar } from '../ui/dom.js';
import { api } from '../api.js';
import { STATIC, BASE } from '../env.js';

const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return new Date(t).toLocaleDateString();
};

export function dashboardPage(user, navigate, signOut) {
  const mine = h('div.world-grid'), shared = h('div.world-grid'), sharedWrap = h('section', { hidden: true }, h('h2', null, 'Shared with me'), shared);

  const card = (w) => h('article.world-card', null,
    h('a.thumb', { href: `${STATIC ? '#' : ''}/world/${w.id}`, 'aria-label': `Open ${w.title}`, onClick: (e) => { e.preventDefault(); navigate(`/world/${w.id}`); } },
      w.hasThumb ? h('img', { src: api.thumbUrl(w), alt: '', loading: 'lazy' }) : h('span.glyph', null, '🌍')),
    h('div.meta', null,
      h('div', null, h('h3', { title: w.title }, w.title),
        h('p', null, w.isOwner ? `Edited ${ago(w.updatedAt)}` : `By ${w.owner?.name || 'someone'} · ${w.access === 'edit' ? 'can edit' : 'view only'}`)),
      h('div.card-actions', null,
        h('button.icon-btn', { title: 'Make a copy', 'aria-label': `Make a copy of ${w.title}`, onClick: async () => { try { await api.copyWorld(w.id); toast('Copy created'); load(); } catch (e) { toast(e.message, 'error'); } } }, '⧉'),
        w.isOwner && h('button.icon-btn', { title: 'Delete', 'aria-label': `Delete ${w.title}`, onClick: async () => {
          if (!confirm(`Delete "${w.title}" for everyone? This cannot be undone.`)) return;
          try { await api.deleteWorld(w.id); load(); } catch (e) { toast(e.message, 'error'); }
        } }, '🗑'))));

  async function load() {
    try {
      const data = await api.worlds();
      clear(mine).append(
        h('button.world-card.new', { onClick: create }, h('span.glyph', null, '＋'), h('strong', null, 'New world')),
        ...data.mine.map(card));
      clear(shared).append(...data.shared.map(card));
      sharedWrap.hidden = !data.shared.length;
    } catch (e) { toast(e.message, 'error'); }
  }
  async function create() {
    try {
      const { world } = await api.createWorld('My world');
      navigate(`/world/${world.id}`);
    } catch (e) { toast(e.message, 'error'); }
  }
  load();

  return h('div.dashboard', null,
    h('header.topbar', null,
      h('div.brand', null, h('img', { src: `${BASE}icon.svg`, alt: '', width: 28, height: 28 }), h('strong', null, 'SmartSpace')),
      h('span.spacer'),
      signOut && [avatar(user, 30), h('span.user-name', null, user.name), h('button.btn', { onClick: signOut }, 'Sign out')]),
    h('main', null,
      STATIC && h('p.notice', null, 'Demo version: your worlds are saved only in this browser on this device. Sign-in, sharing and building together need the full SmartSpace server.'), h('section', null, h('h2', null, 'My worlds'), mine), sharedWrap));
}
