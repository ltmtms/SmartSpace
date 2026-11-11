// Minimal DOM helpers (no framework).
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { el.replaceChildren(); return el; }

let toastTimer = null;
export function toast(message, kind = 'info') {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div.toast', { role: 'status' }); document.body.append(el); }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 5000 : 2600);
}

/** Small modal dialog. Returns { el, close }. */
export function modal(title, body, { wide = false } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const back = h('div.modal-back', { onMousedown: (e) => { if (e.target === back) close(); } },
    h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-label': title },
      h('header', null, h('h2', null, title), h('button.icon-btn', { onClick: close, 'aria-label': 'Close', title: 'Close' }, '✕')),
      h('div.modal-body', null, body)));
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return { el: back, close };
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const initials = (name) => String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export function avatar(user, size = 28) {
  const style = { width: size + 'px', height: size + 'px', background: user.color || '#64748b', fontSize: size * 0.4 + 'px' };
  return user.picture
    ? h('img.avatar', { src: user.picture, alt: user.name, title: user.name, referrerPolicy: 'no-referrer', style })
    : h('span.avatar', { title: user.name, style }, initials(user.name));
}
