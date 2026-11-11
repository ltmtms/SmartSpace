// Sign-in page. Google Sign-In (Google Identity Services) is the only real sign-in method;
// the name-only form appears on local development servers, and on test deployments that set GUEST_LOGIN=true.
import { h, toast } from '../ui/dom.js';
import { api } from '../api.js';

function loadGoogle() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Google sign-in could not be loaded. Check your connection or ad blocker.'));
    document.head.append(s);
  });
}

export function loginPage(config, onSignedIn) {
  const googleBtn = h('div.google-btn');
  const note = h('p.hint');
  const box = h('div.signin', null, h('h2', null, 'Sign in to start building'), googleBtn, note);

  if (config.googleClientId) {
    loadGoogle().then(() => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async ({ credential }) => {
          try { onSignedIn((await api.googleLogin(credential)).user); } catch (e) { toast(e.message, 'error'); }
        },
      });
      window.google.accounts.id.renderButton(googleBtn, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
    }).catch((e) => { note.textContent = e.message; });
    note.textContent = 'Use your school Google account.';
  } else if (config.devLogin) {
    const name = h('input', { type: 'text', placeholder: 'Your name', 'aria-label': 'Your name', maxLength: 40, required: true });
    const code = config.guestCode && h('input', { type: 'text', placeholder: 'Access code', 'aria-label': 'Access code', autocomplete: 'off', required: true });
    box.append(h('form.guest', { onSubmit: async (e) => { e.preventDefault(); try { onSignedIn((await api.devLogin(name.value, code ? code.value : undefined)).user); } catch (err) { toast(err.message, 'error'); } } },
      name, code, h('button.btn.primary', { type: 'submit' }, 'Continue')));
    note.textContent = 'Test mode: Google sign-in is not set up yet, so you sign in with just a name. Use the same name next time to get your worlds back.';
  } else {
    note.textContent = 'Sign-in is not set up on this server yet. Ask your administrator to configure Google sign-in.';
  }

  const feature = (icon, title, text) => h('li', null, h('span.glyph', null, icon), h('div', null, h('strong', null, title), h('p', null, text)));
  return h('div.login', null,
    h('div.hero', null,
      h('div.brand', null, h('img', { src: '/icon.svg', alt: '', width: 44, height: 44 }), h('h1', null, 'SmartSpace')),
      h('p.tagline', null, 'Build your own 3D worlds, bring them to life with code, and step inside them in VR and AR.'),
      h('ul.features', null,
        feature('🧱', 'Build', 'Drag in shapes, characters, buildings and your own models. Sculpt hills and valleys.'),
        feature('🧩', 'Program', 'Start with blocks, then switch to JavaScript or Python when you are ready.'),
        feature('🥽', 'Explore', 'Walk through your world in first person, in a VR headset, or on your desk in AR.'),
        feature('👥', 'Together', 'Classmates can build in the same world at the same time.'))),
    box);
}
