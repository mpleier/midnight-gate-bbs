'use strict';

/* ============================================================================
   SYSOP CONSOLE — app.js

   Vanilla ES2020 admin console for the BBS REST API (docs/ADMIN_API.md).
   No frameworks, no build step, no external requests.

   Section map:
     0.  constants & state
     1.  DOM / formatting helpers
     2.  API client + toasts
     3.  auth & boot (login gate, logout, clock, connection dot)
     4.  shell: nav, router, dialog machinery, form builder
     5.  Overview        GET /overview (+ poll 4s), POST /pages/:id/handled
     6.  Users           /users, PATCH, password, delete
     7.  Boards          /boards CRUD, /messages moderation
     8.  Files           /fileareas CRUD, /files list/upload/delete
     9.  Doors           /doors, scan, upload, PATCH, delete
     10. ANSI Art        /art, previews, upload, delete, slot assignment
     11. Chat Bots       /bots CRUD
     12. Bulletins       /bulletins CRUD
     13. Config          GET/PUT /config, POST /password

   All API data is rendered with createElement/textContent — never innerHTML.
   ========================================================================== */

/* ------------------------------------------------------------------ 0. state */

const API = '/api/admin';

const SECTIONS = [
  { id: 'overview', label: 'Overview', sub: 'Live nodes, board stats, sysop pages · refreshes every 4s' },
  { id: 'users', label: 'Users', sub: 'Search accounts; edit level, credits, flags and notes' },
  { id: 'boards', label: 'Boards', sub: 'Create and edit boards; moderate the message base' },
  { id: 'files', label: 'Files', sub: 'File areas, uploads and the file index' },
  { id: 'doors', label: 'Doors', sub: 'Installed doors, the install folder and the door log' },
  { id: 'art', label: 'ANSI Art', sub: 'Art library, rendered previews and screen slot assignments' },
  { id: 'bots', label: 'Chat Bots', sub: 'Synthetic callers that keep the chat channel warm' },
  { id: 'bulletins', label: 'Bulletins', sub: 'Bulletins shown to callers at login' },
  { id: 'config', label: 'Config', sub: 'Board configuration and admin credentials' },
];

const ART_SLOTS = [
  ['welcomeArt', 'Welcome', 'W'],
  ['mainArt', 'Main menu', 'M'],
  ['loginArt', 'Login', 'L'],
  ['goodbyeArt', 'Logoff', 'G'],
  ['newUserArt', 'New user', 'N'],
];

const DOOR_CATEGORIES = ['RPG', 'Strategy', 'Casino', 'Trivia', 'Arcade', 'Utility', 'Other'];

const CONFIG_GROUPS = [
  ['bbs', 'Board identity & defaults'],
  ['network', 'Network & ports'],
  ['web', 'Web terminal'],
  ['ansi', 'ANSI art slots'],
  ['llm', 'LLM / chatbot backend'],
  ['doors', 'Door manager'],
];

const state = {
  me: null,
  section: '',
  overview: null,
  overviewTimer: null,
  clockTimer: null,
  users: [],
  boards: [],
  boardId: '',
  areas: [],
  areaId: '',
  art: [],
  artDir: 'art',
  artPreviews: new Map(), // name -> preview text
  bots: [],
  bulletins: [],
  config: null,
};

const ui = {}; // per-section element references, cleared on every route change

/* --------------------------------------------------------------- 1. helpers */

function $(sel) {
  return document.querySelector(sel);
}

/**
 * h(tag, props, ...children) — element factory.
 * Strings become text nodes, so API values can never be parsed as markup.
 */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'value') node.value = value;
      else if (key in node && typeof value !== 'string') {
        try {
          node[key] = value;
        } catch {
          node.setAttribute(key, String(value));
        }
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.append(child);
    else node.append(document.createTextNode(String(child)));
  }
}

function td(content, cls) {
  const cell = h('td', { class: cls });
  if (content instanceof Node) cell.append(content);
  else if (content === null || content === undefined || content === '') cell.textContent = '—';
  else cell.textContent = String(content);
  return cell;
}

function actionTd(...buttons) {
  return h('td', { class: 'act' }, h('div', { class: 'act-group' }, ...buttons));
}

function btn(label, onClick, cls = '', title = '') {
  return h('button', {
    class: `btn ${cls}`.trim(),
    type: 'button',
    title: title || null,
    onclick: onClick,
  }, label);
}

function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}`.trim() }, text);
}

function dataTable(headers, rows, emptyText = 'No records.') {
  if (!rows || !rows.length) return h('div', { class: 'empty solo' }, emptyText);
  const head = h('thead', {}, h('tr', {},
    ...headers.map((col) => (typeof col === 'string'
      ? h('th', { scope: 'col' }, col)
      : h('th', { scope: 'col', class: col.cls || '' }, col.label)))));
  return h('div', { class: 'tbl-wrap' },
    h('table', { class: 'tbl' }, head, h('tbody', {}, ...rows)));
}

function humanKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

const pad2 = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtWhen(value) {
  const d = toDate(value);
  if (!d) return '—';
  const now = new Date();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return time;
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${time}`;
}

function fmtDate(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtBytes(n) {
  const size = Number(n);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = size;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function fmtUptime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const d = Math.floor(total / 86400);
  const hrs = Math.floor((total % 86400) / 3600);
  const min = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d}d ${pad2(hrs)}h`;
  if (hrs > 0) return `${hrs}h ${pad2(min)}m`;
  return `${min}m`;
}

function fmtAgo(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m < 1) return 'just now';
  if (m === 1) return '1 min';
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function parseList(text) {
  return String(text || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function readFileSize(file) {
  if (!file) return 0;
  if (file.size) return file.size;
  return 0;
}

/* ----------------------------------------------------------- 2. API & toasts */

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api(method, path, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(API + path, init);
  } catch (err) {
    console.warn('[admin] network failure', method, path, err);
    throw new ApiError(0, 'Network error — is the BBS server running?');
  }

  let payload = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await res.text();
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && path !== '/login') showLogin('Session expired. Log in again.');
    const message = (payload && typeof payload === 'object' && payload.error)
      || (typeof payload === 'string' && payload.trim())
      || `Request failed (HTTP ${res.status}).`;
    console.warn('[admin] api error', method, path, res.status, message);
    throw new ApiError(res.status, message);
  }
  return payload;
}

async function apiText(path) {
  let res;
  try {
    res = await fetch(API + path, { credentials: 'same-origin' });
  } catch (err) {
    console.warn('[admin] network failure', path, err);
    throw new ApiError(0, 'Network error while loading preview.');
  }
  if (!res.ok) {
    if (res.status === 401) showLogin('Session expired. Log in again.');
    console.warn('[admin] api text error', path, res.status);
    throw new ApiError(res.status, `Preview failed (HTTP ${res.status}).`);
  }
  return res.text();
}

function toast(message, kind = '') {
  const wrap = $('#toasts');
  if (!wrap) return;
  const node = h('div', { class: `toast ${kind}`.trim(), role: 'status' }, message);
  wrap.append(node);
  setTimeout(() => {
    node.classList.add('out');
    setTimeout(() => node.remove(), 220);
  }, 4200);
}

/* --------------------------------------------------------------- 3. auth --- */

function setConn(kind) {
  const dot = $('#conn-dot');
  if (!dot) return;
  dot.className = `dot ${kind}`.trim();
  dot.classList.toggle('pulse', kind === 'ok');
}

function setBoardName(bbs) {
  if (!bbs) return;
  const name = bbs.name || bbs.shortName || 'BBS';
  const brand = $('#brand-name');
  const footer = $('#footer-board');
  if (brand) brand.textContent = name;
  if (footer) {
    const bits = [name];
    if (bbs.software) bits.push(bbs.software);
    if (bbs.sysop) bits.push(`sysop ${bbs.sysop}`);
    footer.textContent = bits.join(' · ');
  }
  document.title = `${name} — SYSOP CONSOLE`;
}

function showLogin(message) {
  stopOverviewPolling();
  state.me = null;
  const boot = $('#boot');
  if (boot) boot.classList.add('hidden');
  const app = $('#app');
  if (app) app.classList.add('hidden');
  const view = $('#login-view');
  if (view) view.classList.remove('hidden');
  const err = $('#login-error');
  if (err) err.textContent = message || '';
  const pw = $('#login-password');
  if (pw) pw.value = '';
  setConn('bad');
  setTimeout(() => {
    const user = $('#login-user');
    if (user && !user.value) user.focus();
    else if (pw) pw.focus();
  }, 40);
}

function startClock() {
  const node = $('#clock');
  if (!node) return;
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const tick = () => {
    const d = new Date();
    node.textContent = `${days[d.getDay()]} ${pad2(d.getDate())} ${months[d.getMonth()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };
  tick();
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tick, 1000);
}

function enterApp() {
  const boot = $('#boot');
  if (boot) boot.classList.add('hidden');
  const view = $('#login-view');
  if (view) view.classList.add('hidden');
  const app = $('#app');
  if (app) app.classList.remove('hidden');

  const meLine = $('#me-line');
  if (meLine) meLine.textContent = `${(state.me && state.me.user) || 'sysop'} · online`;

  setConn('ok');
  buildNav();
  startClock();
  startOverviewPolling();

  // one-shot: board identity for the footer, whatever section we land on
  api('GET', '/overview')
    .then((data) => { if (data && data.bbs) setBoardName(data.bbs); })
    .catch((err) => console.warn('[admin] boot overview failed', err));

  const fromHash = (location.hash || '').replace(/^#/, '');
  setSection(SECTIONS.some((s) => s.id === fromHash) ? fromHash : 'overview');
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = $('#login-error');
  const submit = $('#login-submit');
  const user = form.elements.user.value.trim();
  const password = form.elements.password.value;

  if (errorNode) errorNode.textContent = '';
  if (!user || !password) {
    if (errorNode) errorNode.textContent = 'Operator and password are both required.';
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Connecting…';
  }
  try {
    const data = await api('POST', '/login', { user, password });
    state.me = { user: (data && data.user) || user };
    toast('Carrier established.');
    enterApp();
  } catch (err) {
    if (errorNode) errorNode.textContent = err.status === 401 ? 'Access denied. Check operator and password.' : err.message;
    const pw = $('#login-password');
    if (pw) {
      pw.value = '';
      pw.focus();
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Connect';
    }
  }
}

async function handleLogout() {
  try {
    await api('POST', '/logout');
  } catch (err) {
    console.warn('[admin] logout failed', err);
  }
  toast('Carrier dropped.');
  showLogin('');
}

/* --------------------------------------------------------------- 4. shell -- */

function buildNav() {
  const nav = $('#nav');
  if (!nav) return;
  nav.replaceChildren(...SECTIONS.map((section, index) => h('button', {
    class: 'nav-item',
    type: 'button',
    dataset: { section: section.id },
    onclick: () => {
      if (location.hash === `#${section.id}`) setSection(section.id);
      else location.hash = `#${section.id}`;
    },
  },
  h('span', { class: 'idx', 'aria-hidden': 'true' }, String(index + 1).padStart(2, '0')),
  section.label)));
}

function setSection(id) {
  const meta = SECTIONS.find((s) => s.id === id) || SECTIONS[0];
  state.section = meta.id;

  for (const node of document.querySelectorAll('.nav-item')) {
    if (node.dataset.section === meta.id) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }

  const title = $('#section-title');
  const sub = $('#section-sub');
  if (title) title.textContent = meta.label;
  if (sub) sub.textContent = meta.sub;

  for (const key of Object.keys(ui)) delete ui[key];

  const panel = $('#panel');
  if (!panel) return;
  panel.replaceChildren();
  panel.setAttribute('aria-busy', 'true');

  const render = RENDERERS[meta.id];
  if (typeof render !== 'function') {
    renderError(panel, new ApiError(0, `No renderer for section "${meta.id}".`));
    panel.setAttribute('aria-busy', 'false');
    return;
  }

  Promise.resolve()
    .then(() => render(panel))
    .then(() => setConn('ok'))
    .catch((err) => {
      console.warn('[admin] section failed', meta.id, err);
      setConn(err && err.status ? 'warn' : 'bad');
      renderError(panel, err);
    })
    .finally(() => panel.setAttribute('aria-busy', 'false'));

  panel.focus({ preventScroll: true });
}

function renderError(panel, err) {
  const status = err && err.status ? err.status : 0;
  setConn(status === 0 ? 'bad' : 'warn');
  const heading = status === 404
    ? 'Endpoint not found (404)'
    : status >= 500
      ? 'Server error — the console could not load this section'
      : status === 0
        ? 'Connection lost'
        : `Request failed (HTTP ${status})`;

  panel.replaceChildren(h('div', { class: 'panel-error', role: 'alert' },
    h('h3', {}, heading),
    h('p', {}, (err && err.message) || 'Unknown error.'),
    h('p', { class: 'hint' }, 'The API may not be mounted yet, or the session may have expired. Check the server console for details.'),
    h('div', { class: 'row' },
      btn('Retry', () => setSection(state.section), 'primary'),
      btn('Re-authenticate', () => showLogin(''), ''))));
}

/* -- dialogs --------------------------------------------------------------- */

function openDialog({ title, subtitle, content, buttons = [] }) {
  const modal = $('#modal');
  if (!modal) throw new Error('Modal element missing.');
  if (modal.open) modal.close();
  modal.replaceChildren();

  const close = () => {
    if (modal.open) modal.close();
  };

  const ctx = {
    dialog: modal,
    close,
    root: modal,
    setBusy(busy) {
      for (const button of modal.querySelectorAll('.modal-foot .btn')) button.disabled = !!busy;
    },
    setError(message) {
      let node = modal.querySelector('.modal-body .form-error');
      if (!node) {
        node = h('p', { class: 'form-error', role: 'alert' });
        const body = modal.querySelector('.modal-body');
        if (body) body.append(node);
      }
      if (node) node.textContent = message || '';
    },
  };

  const head = h('div', { class: 'modal-head' },
    h('div', {},
      h('h3', { id: 'modal-title' }, title),
      subtitle ? h('p', {}, subtitle) : null),
    h('button', { class: 'modal-x', type: 'button', 'aria-label': 'Close dialog', onclick: close }, '×'));

  const body = h('div', { class: 'modal-body' }, content);
  const foot = h('div', { class: 'modal-foot' });

  for (const spec of buttons) {
    const kind = spec.kind === 'primary' ? 'btn primary' : spec.kind === 'danger' ? 'btn danger' : 'btn';
    const button = h('button', { class: kind, type: 'button' }, spec.label);
    button.addEventListener('click', () => spec.onClick(ctx, button));
    foot.append(button);
  }

  modal.setAttribute('aria-labelledby', 'modal-title');
  modal.append(head, body, foot);
  modal.showModal();
  return ctx;
}

function buildField(f) {
  const id = `fld_${f.name.replace(/[^a-z0-9_]/gi, '_')}_${Math.random().toString(36).slice(2, 7)}`;

  if (f.type === 'checkbox') {
    const input = h('input', { type: 'checkbox', id, checked: !!f.value });
    const wrap = h('label', { class: `check${f.wide ? ' wide' : ''}`, for: id },
      input, h('span', {}, f.label));
    return { wrap, input, f };
  }

  let input;
  if (f.type === 'textarea') {
    input = h('textarea', { id, rows: f.rows || 4, placeholder: f.placeholder || '' });
  } else if (f.type === 'select') {
    input = h('select', { id });
    for (const opt of f.options || []) {
      const value = typeof opt === 'string' ? opt : opt.value;
      const label = typeof opt === 'string' ? opt : opt.label;
      input.append(h('option', { value }, label));
    }
  } else if (f.type === 'file') {
    input = h('input', { type: 'file', id, accept: f.accept || '' });
  } else {
    input = h('input', { type: f.type || 'text', id, placeholder: f.placeholder || '' });
  }

  if (f.type !== 'file' && f.type !== 'select') input.value = f.value === null || f.value === undefined ? '' : String(f.value);
  if (f.type === 'select') input.value = f.value === null || f.value === undefined ? '' : String(f.value);
  if (f.type === 'number') {
    if (f.min !== undefined) input.min = f.min;
    if (f.max !== undefined) input.max = f.max;
  }
  if (f.required) input.required = true;

  const wrap = h('label', { class: `field${f.wide ? ' wide' : ''}`, for: id },
    h('span', { class: 'lbl' }, f.label),
    input,
    f.help ? h('span', { class: 'hint' }, f.help) : null);

  return { wrap, input, f };
}

function readField(record) {
  const { input, f } = record;
  if (f.type === 'checkbox') return input.checked;
  if (f.type === 'file') return input.files && input.files[0] ? input.files[0] : null;
  if (f.type === 'number') return input.value === '' ? 0 : Number(input.value);
  return input.value;
}

/**
 * formModal — labelled form inside the shared dialog.
 * `onSubmit(values, ctx)` may throw to keep the dialog open and show the error.
 */
function formModal({ title, subtitle, fields, submitLabel = 'Save', danger = false, onSubmit }) {
  const form = h('form', { class: 'form-grid', autocomplete: 'off' });
  const records = {};
  for (const field of fields) {
    const record = buildField(field);
    records[field.name] = record;
    form.append(record.wrap);
  }

  for (const field of fields) {
    if (typeof field.after === 'function') {
      try {
        field.after(records, form);
      } catch (err) {
        console.warn('[admin] field hook failed', field.name, err);
      }
    }
  }

  const errorNode = h('p', { class: 'form-error', role: 'alert' });
  form.append(errorNode);

  let ctx = null;
  const submit = async (button) => {
    if (button) button.disabled = true;
    errorNode.textContent = '';
    try {
      if (!form.reportValidity()) return;
      const values = {};
      for (const field of fields) values[field.name] = readField(records[field.name]);
      await onSubmit(values, ctx);
      if (ctx) ctx.close();
    } catch (err) {
      console.warn('[admin] save failed', err);
      errorNode.textContent = (err && err.message) || 'Save failed.';
      if (ctx) ctx.setBusy(false);
    } finally {
      if (button) button.disabled = false;
    }
  };

  ctx = openDialog({
    title,
    subtitle,
    content: form,
    buttons: [
      { label: 'Cancel', onClick: (c) => c.close() },
      { label: submitLabel, kind: danger ? 'danger' : 'primary', onClick: (c, button) => submit(button) },
    ],
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  // Enter submits from any single-line field; Ctrl/Cmd+Enter submits from textareas.
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const inTextarea = event.target && event.target.tagName === 'TEXTAREA';
    if (inTextarea && !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    submit();
  });

  return ctx;
}

function confirmModal(message, { title = 'Confirm action', confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const ctx = openDialog({
      title,
      content: h('p', { class: 'confirm-text' }, message),
      buttons: [
        { label: 'Cancel', onClick: (c) => { finish(false); c.close(); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: (c) => { finish(true); c.close(); } },
      ],
    });
    const modal = $('#modal');
    modal.addEventListener('close', () => finish(false), { once: true });
    // focus the safe choice
    const cancel = ctx.dialog.querySelector('.modal-foot .btn');
    if (cancel) cancel.focus();
  });
}

/* ------------------------------------------------------------ 5. overview -- */

function startOverviewPolling() {
  stopOverviewPolling();
  state.overviewTimer = setInterval(async () => {
    if (state.section !== 'overview' || document.hidden) return;
    try {
      const data = await api('GET', '/overview');
      paintOverview(data);
    } catch (err) {
      console.warn('[admin] overview poll failed', err);
      setConn(err.status === 401 ? 'bad' : 'warn');
    }
  }, 4000);
}

function stopOverviewPolling() {
  if (state.overviewTimer) {
    clearInterval(state.overviewTimer);
    state.overviewTimer = null;
  }
}

async function renderOverview(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/overview');
  state.overview = data;
  if (data && data.bbs) setBoardName(data.bbs);

  const tiles = h('div', { class: 'tiles' });
  const nodesBody = h('tbody');
  const pagesBox = h('div', { class: 'card-body flush' });
  const logBox = h('div', { class: 'card-body flush' });

  ui.overview = { tiles, nodesBody, pagesBox, logBox };

  const fragment = document.createDocumentFragment();
  fragment.append(
    tiles,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Live nodes ', h('b', {}, `/ max ${(data.bbs && data.bbs.maxNodes) || '—'}`)),
        h('div', { class: 'card-tools' },
          h('span', { class: 'small muted' }, 'polling /api/admin/overview · 4s'))),
      h('div', { class: 'card-body flush' },
        h('div', { class: 'tbl-wrap' },
          h('table', { class: 'tbl' },
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Node'),
              h('th', { scope: 'col' }, 'Caller'),
              h('th', { scope: 'col' }, 'Activity'),
              h('th', { scope: 'col' }, 'Kind'),
              h('th', { scope: 'col' }, 'Online'))),
            nodesBody)))),
    h('div', { class: 'split' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Sysop pages'), h('span', { class: 'small muted' }, 'caller requests')),
        pagesBox),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h3', {}, 'Door manager log'), h('span', { class: 'small muted' }, 'latest first')),
        logBox)),
  );

  panel.replaceChildren(fragment);
  paintOverview(data);
}

function paintOverview(data) {
  if (!data) return;
  state.overview = data;
  if (data.bbs) setBoardName(data.bbs);
  const refs = ui.overview;
  if (!refs) return;

  const stats = data.stats || {};
  const tiles = [
    ['Users', stats.users, ''],
    ['Calls', stats.calls, ''],
    ['Posts', stats.posts, ''],
    ['Files', stats.files, ''],
    ['Doors', stats.doors, ''],
    ['Uptime', fmtUptime(stats.uptimeSec), ''],
  ];
  refs.tiles.replaceChildren(...tiles.map(([label, value]) => h('div', { class: 'tile' },
    h('span', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value === undefined || value === null ? '—' : String(value)))));

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  if (!nodes.length) {
    refs.nodesBody.replaceChildren(h('tr', {}, h('td', { colspan: '5' },
      h('div', { class: 'empty' }, 'No callers online. The board is quiet.'))));
  } else {
    refs.nodesBody.replaceChildren(...nodes.map((node) => h('tr', {},
      td(`#${node.node}`, 'nowrap'),
      td(node.handle || '—', node.handle ? 'node-live' : 'dim'),
      td(node.activity || 'idle'),
      td(badge(node.kind || 'web', node.kind === 'web' ? 'blue' : 'amber')),
      td(fmtAgo(node.minutes), 'nowrap dim'))));
  }

  const pages = Array.isArray(data.pages) ? data.pages : [];
  if (!pages.length) {
    refs.pagesBox.replaceChildren(h('div', { class: 'empty' }, 'No paging. Nobody needs you right now.'));
  } else {
    refs.pagesBox.replaceChildren(h('ul', { class: 'list-plain' }, ...pages.map((page) => h('li', {},
      h('b', {}, `@${page.handle || 'unknown'}`),
      h('span', { class: 'dim small' }, `node ${page.node}`),
      h('span', {}, page.msg || '(paged you)'),
      h('span', { class: 'meta' }, fmtWhen(page.when)),
      h('button', {
        class: 'btn mini',
        type: 'button',
        onclick: (event) => markPageHandled(page, event.currentTarget),
      }, 'Handled')))));
  }

  const log = Array.isArray(data.log) ? data.log.slice() : [];
  // newest first, whatever order the API hands us
  log.sort((a, b) => ((b && b.when) || 0) - ((a && a.when) || 0));
  if (!log.length) {
    refs.logBox.replaceChildren(h('div', { class: 'empty' }, 'Door log is empty.'));
  } else {
    refs.logBox.replaceChildren(h('div', { class: 'log-list' }, ...log.slice(0, 14).map((line) => {
      const msg = typeof line === 'string' ? line : line.msg;
      const when = typeof line === 'string' ? null : line.when;
      const isErr = /error|fail|could not|denied/i.test(String(msg || ''));
      return h('div', { class: `log-line${isErr ? ' err' : ''}` },
        h('time', {}, when ? fmtWhen(when) : '—'),
        h('span', {}, msg || ''));
    })));
  }

  const sub = $('#section-sub');
  if (sub && state.section === 'overview') {
    sub.textContent = `Live · ${nodes.length} caller${nodes.length === 1 ? '' : 's'} online · updated ${new Date().toLocaleTimeString()}`;
  }
}

async function markPageHandled(page, button) {
  if (!page || !page.id) return;
  button.disabled = true;
  try {
    await api('POST', `/pages/${encodeURIComponent(page.id)}/handled`);
    if (state.overview && Array.isArray(state.overview.pages)) {
      state.overview.pages = state.overview.pages.filter((p) => p.id !== page.id);
      paintOverview(state.overview);
    }
    toast(`Page from ${page.handle || 'caller'} marked handled.`);
  } catch (err) {
    button.disabled = false;
    toast(err.message, 'err');
  }
}

/* --------------------------------------------------------------- 6. users -- */

async function renderUsers(panel) {
  panel.replaceChildren();
  const search = h('input', {
    type: 'search',
    placeholder: 'handle or name…',
    'aria-label': 'Search users',
  });
  const form = h('form', { class: 'search-form', role: 'search' }, search,
    h('button', { class: 'btn', type: 'submit' }, 'Search'));

  const tbody = h('tbody');
  ui.users = { tbody, search };

  const table = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, 'User accounts ', h('b', {}, '')),
      form),
    h('div', { class: 'card-body flush' },
      h('div', { class: 'tbl-wrap' },
        h('table', { class: 'tbl' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Handle'),
            h('th', { scope: 'col', class: 'hide-sm' }, 'Name'),
            h('th', { scope: 'col', class: 'num' }, 'Level'),
            h('th', { scope: 'col', class: 'num hide-sm' }, 'Calls'),
            h('th', { scope: 'col', class: 'num hide-sm' }, 'Posts'),
            h('th', { scope: 'col', class: 'num' }, 'Credits'),
            h('th', { scope: 'col', class: 'hide-sm' }, 'Last call'),
            h('th', { scope: 'col' }, 'Status'),
            h('th', { scope: 'col', 'aria-label': 'Actions' }, ''))),
          tbody))));

  panel.append(table);

  const load = async (query) => {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: '9' }, h('div', { class: 'empty' }, 'Loading users…'))));
    try {
      const data = await api('GET', `/users${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      state.users = data.users || [];
      paintUsers();
      const count = table.querySelector('.card-head h3 b');
      if (count) count.textContent = `${state.users.length} shown`;
    } catch (err) {
      tbody.replaceChildren(h('tr', {}, h('td', { colspan: '9' },
        h('div', { class: 'empty' }, `Could not load users: ${err.message}`))));
      throw err;
    }
  };

  let timer = null;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    load(search.value.trim());
  });
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(search.value.trim()), 320);
  });

  await load(search.value.trim());
}

function paintUsers() {
  const tbody = ui.users && ui.users.tbody;
  if (!tbody) return;
  if (!state.users.length) {
    tbody.replaceChildren(h('tr', {}, h('td', { colspan: '9' },
      h('div', { class: 'empty' }, 'No users match that search.'))));
    return;
  }

  tbody.replaceChildren(...state.users.map((user) => {
    const isSysop = user.id === 'user_sysop' || user.level >= 100;
    const status = user.banned ? badge('banned', 'red') : (isSysop ? badge('sysop', 'amber') : badge('active', 'green'));
    return h('tr', {},
      td(user.handle || '—'),
      td(user.name || '—', 'hide-sm'),
      td(user.level, 'num'),
      td(user.calls == null ? 0 : user.calls, 'num hide-sm'),
      td(user.posts == null ? 0 : user.posts, 'num hide-sm'),
      td(user.credits == null ? 0 : user.credits, 'num'),
      td(fmtWhen(user.lastCall), 'nowrap hide-sm'),
      td(status),
      h('td', { class: 'act' }, userActions(user)));
  }));
}

/* the Del button must be disabled for the sysop account, so build actions here */
function userActions(user) {
  const isSysop = user.id === 'user_sysop' || user.level >= 100;
  const del = h('button', {
    class: 'btn mini danger',
    type: 'button',
    disabled: isSysop,
    title: isSysop ? 'The sysop account cannot be deleted.' : 'Delete this account',
    onclick: () => deleteUser(user),
  }, 'Del');
  return h('div', { class: 'act-group' },
    btn('Edit', () => editUser(user), 'mini', `Edit ${user.handle}`),
    btn('PW', () => resetUserPassword(user), 'mini', `Reset password for ${user.handle}`),
    del);
}

function editUser(user) {
  formModal({
    title: `Edit ${user.handle}`,
    subtitle: `${user.id} · last call ${fmtDate(user.lastCall)}`,
    fields: [
      { name: 'name', label: 'Real name', value: user.name || '' },
      { name: 'level', label: 'Security level', type: 'number', min: 0, max: 100, value: user.level == null ? 10 : user.level },
      { name: 'credits', label: 'Credits', type: 'number', min: 0, value: user.credits == null ? 0 : user.credits },
      { name: 'timeBank', label: 'Time bank (minutes)', type: 'number', min: 0, value: user.timeBank == null ? 0 : user.timeBank },
      { name: 'banned', label: 'Banned from the board', type: 'checkbox', value: !!user.banned, wide: true },
      { name: 'city', label: 'City', value: user.city || '' },
      { name: 'state', label: 'State', value: user.state || '' },
      { name: 'email', label: 'Email', type: 'email', value: user.email || '' },
      { name: 'notes', label: 'Sysop notes', type: 'textarea', rows: 4, wide: true, value: user.notes || '' },
    ],
    onSubmit: async (values) => {
      const payload = {
        name: values.name,
        level: values.level,
        credits: values.credits,
        timeBank: values.timeBank,
        banned: values.banned,
        city: values.city,
        state: values.state,
        email: values.email,
        notes: values.notes,
      };
      const data = await api('PATCH', `/users/${encodeURIComponent(user.id)}`, payload);
      const next = (data && data.user) || { ...user, ...payload };
      const index = state.users.findIndex((u) => u.id === user.id);
      if (index >= 0) state.users[index] = { ...state.users[index], ...next };
      paintUsers();
      toast(`${user.handle} updated.`);
    },
  });
}

function resetUserPassword(user) {
  formModal({
    title: `Reset password — ${user.handle}`,
    subtitle: 'The caller will have to log in again with the new password.',
    submitLabel: 'Reset password',
    fields: [
      { name: 'password', label: 'New password', type: 'password', required: true, wide: true, help: 'Give this to the caller over a channel you trust.' },
      { name: 'confirm', label: 'Repeat password', type: 'password', required: true, wide: true },
    ],
    onSubmit: async (values) => {
      if (values.password !== values.confirm) throw new Error('The two passwords do not match.');
      if (String(values.password).length < 4) throw new Error('Use at least 4 characters.');
      await api('POST', `/users/${encodeURIComponent(user.id)}/password`, { password: values.password });
      toast(`Password reset for ${user.handle}.`);
    },
  });
}

async function deleteUser(user) {
  const ok = await confirmModal(
    h('span', {}, 'Delete account ', h('strong', {}, user.handle), '? This removes the user record and cannot be undone.'),
    { title: 'Delete user', confirmLabel: 'Delete account' });
  if (!ok) return;
  try {
    await api('DELETE', `/users/${encodeURIComponent(user.id)}`);
    state.users = state.users.filter((u) => u.id !== user.id);
    paintUsers();
    toast(`${user.handle} deleted.`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* -------------------------------------------------------------- 7. boards -- */

async function renderBoards(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/boards');
  state.boards = data.boards || [];

  const boardRows = state.boards.map((board) => h('tr', {},
    td(board.name || '—'),
    td(board.desc || '—', 'dim'),
    td(board.level == null ? '—' : board.level, 'num'),
    td(board.messages == null ? 0 : board.messages, 'num hide-sm'),
    td(board.order == null ? '—' : board.order, 'num hide-sm'),
    actionTd(
      btn('Edit', () => boardModal(board, panel), 'mini'),
      btn('Del', () => deleteBoard(board, panel), 'mini danger'))));

  const msgBody = h('div', { class: 'card-body flush' });
  const select = h('select', { 'aria-label': 'Board to moderate' });
  for (const board of state.boards) {
    select.append(h('option', { value: board.id }, `${board.name} (${board.messages == null ? 0 : board.messages})`));
  }
  const chosen = state.boards.some((b) => b.id === state.boardId) ? state.boardId : (state.boards[0] ? state.boards[0].id : '');
  if (chosen) select.value = chosen;
  state.boardId = chosen;
  select.disabled = !state.boards.length;
  select.addEventListener('change', () => {
    state.boardId = select.value;
    loadMessages(msgBody, select.value);
  });

  panel.append(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Boards ', h('b', {}, `${state.boards.length}`)),
        h('div', { class: 'card-tools' },
          btn('New board', () => boardModal(null, panel), 'primary'))),
      h('div', { class: 'card-body flush' },
        dataTable(
          ['Name', 'Description', { label: 'Level', cls: 'num' }, { label: 'Msgs', cls: 'num hide-sm' }, { label: 'Order', cls: 'num hide-sm' }, ''],
          boardRows,
          'No boards yet. Create the first one.'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Message moderation'),
        h('div', { class: 'card-tools' }, select,
          btn('Reload', () => loadMessages(msgBody, select.value), 'small'))),
      msgBody),
  );

  if (chosen) await loadMessages(msgBody, chosen);
  else msgBody.replaceChildren(h('div', { class: 'empty' }, 'No boards to moderate.'));
}

async function loadMessages(container, boardId) {
  if (!boardId) {
    container.replaceChildren(h('div', { class: 'empty' }, 'Pick a board.'));
    return;
  }
  container.replaceChildren(h('div', { class: 'empty' }, 'Loading messages…'));
  try {
    const data = await api('GET', `/messages?boardId=${encodeURIComponent(boardId)}`);
    const messages = data.messages || [];
    if (!messages.length) {
      container.replaceChildren(h('div', { class: 'empty' }, 'No messages on this board yet.'));
      return;
    }
    const rows = messages.map((msg) => h('tr', {},
      td(msg.subject || '(no subject)'),
      td(msg.from || '—'),
      td(msg.to || 'All', 'dim hide-sm'),
      td(fmtWhen(msg.date || msg.when), 'nowrap hide-sm'),
      actionTd(
        btn('Edit', () => messageModal(msg, () => loadMessages(container, boardId)), 'mini'),
        btn('Del', () => deleteMessage(msg, () => loadMessages(container, boardId)), 'mini danger'))));
    container.replaceChildren(dataTable(
      ['Subject', 'From', { label: 'To', cls: 'hide-sm' }, { label: 'Date', cls: 'hide-sm' }, ''],
      rows,
      'No messages.'));
  } catch (err) {
    container.replaceChildren(h('div', { class: 'empty' }, `Could not load messages: ${err.message}`));
    console.warn('[admin] messages failed', err);
  }
}

function boardModal(board, panel) {
  const editing = !!board;
  formModal({
    title: editing ? `Edit board — ${board.name}` : 'New board',
    fields: [
      { name: 'name', label: 'Board name', value: board ? board.name || '' : '', required: true, wide: true },
      { name: 'desc', label: 'Description', type: 'textarea', rows: 2, value: board ? board.desc || '' : '', wide: true },
      { name: 'level', label: 'Minimum level', type: 'number', min: 0, max: 100, value: board && board.level != null ? board.level : 10 },
    ],
    submitLabel: editing ? 'Save board' : 'Create board',
    onSubmit: async (values) => {
      const payload = { name: values.name.trim(), desc: values.desc, level: values.level };
      if (editing) await api('PATCH', `/boards/${encodeURIComponent(board.id)}`, payload);
      else await api('POST', '/boards', payload);
      toast(editing ? 'Board updated.' : 'Board created.');
      await renderBoards(panel);
    },
  });
}

async function deleteBoard(board, panel) {
  const ok = await confirmModal(
    h('span', {}, 'Delete board ', h('strong', {}, board.name), '? Messages on it may be orphaned.'),
    { title: 'Delete board', confirmLabel: 'Delete board' });
  if (!ok) return;
  try {
    await api('DELETE', `/boards/${encodeURIComponent(board.id)}`);
    toast('Board deleted.');
    await renderBoards(panel);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function messageModal(message, onDone) {
  formModal({
    title: 'Edit message',
    subtitle: `${message.from || 'unknown'} · ${fmtDate(message.date || message.when)}`,
    fields: [
      { name: 'subject', label: 'Subject', value: message.subject || '', required: true, wide: true },
      { name: 'to', label: 'To', value: message.to || '' },
      { name: 'body', label: 'Body', type: 'textarea', rows: 10, value: message.body || '', wide: true },
    ],
    onSubmit: async (values) => {
      await api('PATCH', `/messages/${encodeURIComponent(message.id)}`, values);
      toast('Message updated.');
      onDone();
    },
  });
}

async function deleteMessage(message, onDone) {
  const ok = await confirmModal(
    h('span', {}, 'Delete message ', h('strong', {}, message.subject || '(no subject)'), '? This cannot be undone.'),
    { title: 'Delete message', confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await api('DELETE', `/messages/${encodeURIComponent(message.id)}`);
    toast('Message deleted.');
    onDone();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* --------------------------------------------------------------- 8. files -- */

async function renderFiles(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/fileareas');
  state.areas = data.areas || [];

  const areaRows = state.areas.map((area) => h('tr', {},
    td(area.name || '—'),
    td(area.desc || '—', 'dim'),
    td(area.level == null ? '—' : area.level, 'num'),
    td(area.files == null ? 0 : area.files, 'num hide-sm'),
    actionTd(
      btn('Edit', () => areaModal(area, panel), 'mini'),
      btn('Del', () => deleteArea(area, panel), 'mini danger'))));

  const filesBody = h('div', { class: 'card-body flush' });
  const select = h('select', { 'aria-label': 'File area' });
  for (const area of state.areas) {
    select.append(h('option', { value: area.id }, `${area.name} (${area.files == null ? 0 : area.files})`));
  }
  const chosen = state.areas.some((a) => a.id === state.areaId) ? state.areaId : (state.areas[0] ? state.areas[0].id : '');
  if (chosen) select.value = chosen;
  state.areaId = chosen;
  select.disabled = !state.areas.length;
  select.addEventListener('change', () => {
    state.areaId = select.value;
    loadFiles(filesBody, select.value);
  });

  const uploadBtn = h('button', {
    class: 'btn primary',
    type: 'button',
    disabled: !state.areas.length,
    onclick: () => uploadFileModal(panel),
  }, 'Upload file');

  panel.append(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'File areas ', h('b', {}, `${state.areas.length}`)),
        h('div', { class: 'card-tools' },
          btn('New area', () => areaModal(null, panel), 'primary'))),
      h('div', { class: 'card-body flush' },
        dataTable(['Name', 'Description', 'Level', { label: 'Files', cls: 'hide-sm' }, ''],
          areaRows, 'No file areas yet.'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Files'),
        h('div', { class: 'card-tools' }, select, uploadBtn,
          btn('Reload', () => loadFiles(filesBody, select.value), 'small'))),
      filesBody),
  );

  if (chosen) await loadFiles(filesBody, chosen);
  else filesBody.replaceChildren(h('div', { class: 'empty' }, 'Create a file area first.'));
}

async function loadFiles(container, areaId) {
  if (!areaId) {
    container.replaceChildren(h('div', { class: 'empty' }, 'Pick a file area.'));
    return;
  }
  container.replaceChildren(h('div', { class: 'empty' }, 'Loading files…'));
  try {
    const data = await api('GET', `/files?areaId=${encodeURIComponent(areaId)}`);
    const files = data.files || [];
    if (!files.length) {
      container.replaceChildren(h('div', { class: 'empty' }, 'This area is empty. Upload something.'));
      return;
    }
    const rows = files.map((file) => h('tr', {},
      td(file.name || '—'),
      td(file.desc || '—', 'dim hide-sm'),
      td(fmtBytes(file.size), 'num nowrap'),
      td(fmtWhen(file.date), 'nowrap hide-sm'),
      td(file.downloads == null ? 0 : file.downloads, 'num hide-sm'),
      actionTd(btn('Del', () => deleteFile(file, () => loadFiles(container, areaId)), 'mini danger'))));
    container.replaceChildren(dataTable(
      ['Name', { label: 'Description', cls: 'hide-sm' }, { label: 'Size', cls: 'num' }, { label: 'Uploaded', cls: 'hide-sm' }, { label: 'DL', cls: 'num hide-sm' }, ''],
      rows, 'No files.'));
  } catch (err) {
    container.replaceChildren(h('div', { class: 'empty' }, `Could not load files: ${err.message}`));
    console.warn('[admin] files failed', err);
  }
}

function areaModal(area, panel) {
  const editing = !!area;
  formModal({
    title: editing ? `Edit area — ${area.name}` : 'New file area',
    fields: [
      { name: 'name', label: 'Area name', value: area ? area.name || '' : '', required: true, wide: true },
      { name: 'desc', label: 'Description', type: 'textarea', rows: 2, value: area ? area.desc || '' : '', wide: true },
      { name: 'level', label: 'Minimum level', type: 'number', min: 0, max: 100, value: area && area.level != null ? area.level : 10 },
    ],
    submitLabel: editing ? 'Save area' : 'Create area',
    onSubmit: async (values) => {
      const payload = { name: values.name.trim(), desc: values.desc, level: values.level };
      if (editing) await api('PATCH', `/fileareas/${encodeURIComponent(area.id)}`, payload);
      else await api('POST', '/fileareas', payload);
      toast(editing ? 'File area updated.' : 'File area created.');
      await renderFiles(panel);
    },
  });
}

async function deleteArea(area, panel) {
  const ok = await confirmModal(
    h('span', {}, 'Delete file area ', h('strong', {}, area.name), '? Files inside it are not deleted, but become orphaned.'),
    { title: 'Delete file area', confirmLabel: 'Delete area' });
  if (!ok) return;
  try {
    await api('DELETE', `/fileareas/${encodeURIComponent(area.id)}`);
    toast('File area deleted.');
    await renderFiles(panel);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function uploadFileModal(panel) {
  formModal({
    title: 'Upload file',
    subtitle: 'Read in the browser and posted as base64. Keep it under 32 MB.',
    submitLabel: 'Upload',
    fields: [
      { name: 'areaId', label: 'File area', type: 'select', required: true, wide: true,
        value: state.areaId,
        options: state.areas.map((a) => ({ value: a.id, label: a.name })) },
      { name: 'name', label: 'File name', value: '', required: true, wide: true, help: 'Shown in the file list.' },
      { name: 'desc', label: 'Description', type: 'textarea', rows: 2, wide: true },
      { name: 'file', label: 'File', type: 'file', required: true, wide: true,
        after: (records) => {
          const input = records.file.input;
          input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            const nameInput = records.name.input;
            if (file && !nameInput.value) nameInput.value = file.name;
          });
        } },
    ],
    onSubmit: async (values) => {
      if (!values.file) throw new Error('Choose a file to upload.');
      if (readFileSize(values.file) > 32 * 1024 * 1024) throw new Error('That file is larger than 32 MB.');
      const contentBase64 = await fileToBase64(values.file);
      await api('POST', '/files', {
        areaId: values.areaId,
        name: values.name.trim() || values.file.name,
        desc: values.desc,
        contentBase64,
      });
      toast(`Uploaded ${values.name.trim() || values.file.name}.`);
      await renderFiles(panel);
    },
  });
}

async function deleteFile(file, onDone) {
  const ok = await confirmModal(
    h('span', {}, 'Delete file ', h('strong', {}, file.name), '? The stored file is removed.'),
    { title: 'Delete file', confirmLabel: 'Delete file' });
  if (!ok) return;
  try {
    await api('DELETE', `/files/${encodeURIComponent(file.id)}`);
    toast('File deleted.');
    onDone();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* --------------------------------------------------------------- 9. doors -- */

async function renderDoors(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/doors');
  const doors = data.doors || [];
  const installDir = data.installDir || 'doors/install';

  const scanBtn = h('button', { class: 'btn primary', type: 'button' }, 'Scan install folder');
  scanBtn.addEventListener('click', async () => {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';
    try {
      const result = await api('POST', '/doors/scan');
      const installed = (result && result.installed) || [];
      toast(installed.length ? `Installed ${installed.length} door${installed.length === 1 ? '' : 's'}.` : 'Scan complete — nothing new.');
      await renderDoors(panel);
    } catch (err) {
      toast(err.message, 'err');
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan install folder';
    }
  });

  const uploadBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: () => uploadDoorZip(panel),
  }, 'Upload door zip');

  const rows = doors.map((door) => {
    const enabled = door.enabled !== false;
    const toggle = h('input', {
      type: 'checkbox',
      checked: enabled,
      'aria-label': `Enable ${door.name}`,
      onchange: async (event) => {
        const checked = event.target.checked;
        event.target.disabled = true;
        try {
          const result = await api('PATCH', `/doors/${encodeURIComponent(door.id)}`, { enabled: checked });
          const next = result && result.door ? result.door.enabled !== false : checked;
          door.enabled = next;
          toast(`${door.name} ${next ? 'enabled' : 'disabled'}.`);
        } catch (err) {
          event.target.checked = !checked;
          toast(err.message, 'err');
        } finally {
          event.target.disabled = false;
        }
      },
    });

    const typeKind = door.type === 'native' ? 'green' : door.type === 'dos' ? 'amber' : 'blue';
    const del = h('button', {
      class: 'btn mini danger',
      type: 'button',
      disabled: !!door.builtin,
      title: door.builtin ? 'Built-in doors ship with the board and cannot be deleted.' : 'Delete the door folder',
      onclick: () => deleteDoor(door, panel),
    }, 'Del');

    return h('tr', {},
      td(door.name || door.id || '—'),
      td(badge(door.type || 'door', typeKind)),
      td(door.category || 'Other', 'dim hide-sm'),
      td(door.author || '—', 'dim hide-sm'),
      td(door.minLevel == null ? 10 : door.minLevel, 'num'),
      td(toggle),
      actionTd(btn('Edit', () => doorModal(door, panel), 'mini'), del));
  });

  const log = (Array.isArray(data.log) ? data.log.slice() : [])
    .sort((a, b) => ((b && b.when) || 0) - ((a && a.when) || 0));

  panel.append(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Door manager ', h('b', {}, `${doors.length} installed`)),
        h('div', { class: 'card-tools' }, scanBtn, uploadBtn)),
      h('div', { class: 'card-body' },
        h('p', { class: 'pathline' }, 'Install folder', h('code', {}, installDir),
          h('span', { class: 'muted small' }, 'drop a .zip here (or upload it) and the manager installs it automatically')),
        h('p', { class: 'stat-note' }, 'DOOR.SYS / DORINFO drop files and DOSBox launching are handled by the door manager. Toggle a door to hide it from callers without uninstalling.'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Installed doors')),
      h('div', { class: 'card-body flush' },
        dataTable(
          ['Name', 'Type', { label: 'Category', cls: 'hide-sm' }, { label: 'Author', cls: 'hide-sm' }, { label: 'Min lvl', cls: 'num' }, 'On', ''],
          rows, 'No doors found. Drop a zip in the install folder and scan.'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Door log'), h('span', { class: 'small muted' }, `${log.length} entries`)),
      h('div', { class: 'card-body flush' },
        log.length
          ? h('div', { class: 'log-list' }, ...log.slice(0, 40).map((entry) => {
            const msg = typeof entry === 'string' ? entry : entry.msg;
            const when = typeof entry === 'string' ? null : entry.when;
            const isErr = /error|fail|could not|denied/i.test(String(msg || ''));
            return h('div', { class: `log-line${isErr ? ' err' : ''}` },
              h('time', {}, when ? fmtWhen(when) : '—'),
              h('span', {}, msg || ''));
          }))
          : h('div', { class: 'empty' }, 'No door activity logged yet.'))),
  );
}

function doorModal(door, panel) {
  formModal({
    title: `Edit door — ${door.name || door.id}`,
    subtitle: `${door.id} · ${door.type || 'door'}${door.builtin ? ' · built-in' : ''}`,
    fields: [
      { name: 'name', label: 'Display name', value: door.name || '', required: true, wide: true },
      { name: 'description', label: 'Description', type: 'textarea', rows: 3, value: door.description || '', wide: true },
      { name: 'category', label: 'Category', type: 'select', value: door.category || 'Other',
        options: DOOR_CATEGORIES },
      { name: 'minLevel', label: 'Minimum level', type: 'number', min: 0, max: 100,
        value: door.minLevel == null ? 10 : door.minLevel },
      { name: 'cmd', label: 'Launch command', value: door.cmd || '', wide: true,
        help: 'Optional shell command. Leave blank to let the manager launch it.' },
      { name: 'enabled', label: 'Enabled for callers', type: 'checkbox', value: door.enabled !== false, wide: true },
    ],
    onSubmit: async (values) => {
      await api('PATCH', `/doors/${encodeURIComponent(door.id)}`, {
        name: values.name.trim(),
        description: values.description,
        category: values.category,
        minLevel: values.minLevel,
        cmd: values.cmd,
        enabled: values.enabled,
      });
      toast('Door updated.');
      await renderDoors(panel);
    },
  });
}

function uploadDoorZip(panel) {
  formModal({
    title: 'Upload door zip',
    subtitle: 'The archive is installed into the doors folder and scanned for a manifest.',
    submitLabel: 'Install',
    fields: [
      { name: 'file', label: 'Door archive (.zip)', type: 'file', accept: '.zip,application/zip', required: true, wide: true },
      { name: 'filename', label: 'Save archive as', value: '', wide: true,
        help: 'Optional. Defaults to the original file name.' },
    ],
    onSubmit: async (values) => {
      if (!values.file) throw new Error('Choose a .zip archive.');
      if (!/\.zip$/i.test(values.file.name)) throw new Error('The door archive must be a .zip file.');
      const zipBase64 = await fileToBase64(values.file);
      const result = await api('POST', '/doors/upload', {
        filename: values.filename.trim() || values.file.name,
        zipBase64,
      });
      const installed = result && result.installed;
      toast(installed ? `Installed ${installed.name || installed.id || 'door'}.` : 'Door installed.');
      await renderDoors(panel);
    },
  });
}

async function deleteDoor(door, panel) {
  const ok = await confirmModal(
    h('span', {}, 'Delete door ', h('strong', {}, door.name || door.id), '? Its folder and manifest are removed from disk.'),
    { title: 'Delete door', confirmLabel: 'Delete door' });
  if (!ok) return;
  try {
    await api('DELETE', `/doors/${encodeURIComponent(door.id)}`);
    toast('Door deleted.');
    await renderDoors(panel);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ----------------------------------------------------------------- 10. art -- */

async function renderArt(panel) {
  panel.replaceChildren();
  const artData = await api('GET', '/art');

  if (!state.config) {
    try {
      const cfg = await api('GET', '/config');
      if (cfg && cfg.config) {
        state.config = cfg.config;
        if (cfg.config.bbs) setBoardName(cfg.config.bbs);
      }
    } catch (err) {
      console.warn('[admin] could not load config for art slots', err);
    }
  }

  state.art = artData.art || [];
  state.artDir = artData.dir || 'art';

  const slotBox = h('div', { class: 'slots' });
  ui.artSlotBox = slotBox;
  paintSlotRows(slotBox, panel);

  const uploadBtn = btn('Upload art', () => uploadArtModal(panel), 'primary');

  const grid = h('div', { class: 'art-grid' });
  const previewMap = new Map();

  if (!state.art.length) {
    grid.append(h('div', { class: 'empty solo' }, `No art in ${state.artDir}. Upload a .ans, .asc or .txt file.`));
  }

  for (const item of state.art) {
    const pre = h('pre', {
      class: 'art-preview loading expandable',
      title: 'Click for the full-size preview',
      onclick: () => previewArt(item),
    }, 'loading preview…');
    previewMap.set(item.name, pre);

    const tools = h('div', { class: 'art-tools' });
    tools.append(h('span', { class: 'slotkey' }, 'assign to:'));
    const ansi = (state.config && state.config.ansi) || {};
    for (const [slot, label, short] of ART_SLOTS) {
      const active = ansi[slot] === item.name;
      tools.append(h('button', {
        class: `btn mini${active ? ' on' : ''}`,
        type: 'button',
        'aria-label': active ? `${item.name} is assigned to the ${label} slot` : `Assign ${item.name} to the ${label} slot`,
        'aria-pressed': active ? 'true' : 'false',
        title: active ? `${label}: currently assigned` : `Assign to ${label} (${slot})`,
        onclick: () => assignArt(slot, item.name, panel),
      }, short));
    }
    tools.append(
      h('span', { class: 'tools-sep', 'aria-hidden': 'true' }),
      btn('Expand', () => previewArt(item), 'mini', 'Open the full preview'),
      btn('Del', () => deleteArt(item, panel), 'mini danger', `Delete ${item.name}`));

    grid.append(h('article', { class: 'art-card' },
      h('header', {},
        h('b', { title: item.name }, item.name),
        h('span', {}, fmtBytes(item.size))),
      pre,
      tools));
  }

  panel.append(
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Screen slots ', h('b', {}, `/${state.artDir}`)),
        h('div', { class: 'card-tools' }, uploadBtn,
          btn('Reload', () => renderArt(panel).catch((err) => renderError(panel, err)), 'small'))),
      slotBox),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', {}, 'Art library ', h('b', {}, `${state.art.length} files`)),
        h('span', { class: 'small muted' }, 'previews decoded server-side')),
      h('div', { class: 'card-body' }, grid)),
  );

  // previews: 4 at a time so a big library doesn't flood the server
  const items = state.art.slice();
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      const pre = previewMap.get(item.name);
      if (!pre) continue;
      try {
        let text = state.artPreviews.get(item.name);
        if (text === undefined) {
          text = await apiText(`/art/${encodeURIComponent(item.name)}/preview`);
          state.artPreviews.set(item.name, text);
        }
        paintAnsi(pre, text, 18);
        pre.classList.remove('loading');
        fitArtPreview(pre);
      } catch (err) {
        console.warn('[admin] art preview failed', item.name, err);
        pre.textContent = '[preview unavailable]';
        pre.classList.remove('loading');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
}

function paintSlotRows(container, panel) {
  const ansi = (state.config && state.config.ansi) || {};
  const names = new Set(state.art.map((item) => item.name));

  const head = h('div', { class: 'slot-row head' },
    h('span', { class: 'slot-name' }, 'Slot'),
    h('span', { class: 'slot-cur' }, 'Current art'),
    h('span', {}, 'Replace with'),
    h('span', {}, ''));

  const rows = ART_SLOTS.map(([slot, label]) => {
    const current = ansi[slot] || '';
    const missing = !!current && !names.has(current);
    const select = h('select', { 'aria-label': `${label} art file` });
    select.append(h('option', { value: '' }, missing ? '— choose replacement —' : '— choose —'));
    for (const item of state.art) select.append(h('option', { value: item.name }, item.name));
    if (current && !missing) select.value = current;
    if (missing) select.options[0].disabled = true;

    const setBtn = btn('Set', () => assignArt(slot, select.value, panel), 'mini');
    setBtn.disabled = missing;

    return h('div', { class: 'slot-row' },
      h('span', { class: 'slot-name' }, label),
      h('span', {
        class: `slot-cur${missing ? ' missing' : ''}`,
        title: missing ? `${current} is assigned but not present in the art folder` : (current || 'unassigned'),
      }, current ? (missing ? `${current} — missing` : current) : '(unassigned)'),
      select,
      setBtn);
  });
  container.replaceChildren(head, ...rows);
}

async function assignArt(slot, name, panel) {
  if (!name) {
    toast('Pick an art file for that slot first.', 'warn');
    return;
  }
  try {
    await api('POST', '/art/assign', { slot, name });
    if (state.config && state.config.ansi) state.config.ansi[slot] = name;
    if (ui.artSlotBox) paintSlotRows(ui.artSlotBox, panel);
    toast(`${slot} → ${name}`);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/** Scale a thumbnail so an 80-column screen fits the card width. */
function fitArtPreview(pre) {
  const width = pre.clientWidth - 16;
  if (!width || width < 40) return;
  const size = Math.max(4.2, Math.min(9, width / 80 / 0.6));
  pre.style.fontSize = `${size.toFixed(2)}px`;
  pre.style.lineHeight = '1.02';
}

const ANSI_PALETTE = [
  '#000000', '#aa0000', '#00aa00', '#aa5500', '#0000aa', '#aa00aa', '#00aaaa', '#aaaaaa',
  '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff',
];

// Renders decoded ANSI (SGR colour codes + CP437 box art) into a <pre> with real colours.
function paintAnsi(pre, text, maxLines = 18) {
  pre.textContent = '';
  let fg = null;
  let bg = null;
  let bold = false;
  const lines = String(text || '').replace(/\r/g, '').split('\n').slice(0, maxLines);
  if (!lines.some((l) => l.trim())) {
    pre.textContent = '(empty art file)';
    return;
  }
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'ansi-line';
    for (const part of line.split(/(\x1b\[[0-9;]*m)/g)) {
      if (!part) continue;
      if (part.startsWith('\x1b[')) {
        const codes = part.slice(2, -1).split(';').map(Number).filter((n) => !Number.isNaN(n));
        if (!codes.length) codes.push(0);
        for (const c of codes) {
          if (c === 0) { fg = null; bg = null; bold = false; }
          else if (c === 1) bold = true;
          else if (c === 22) bold = false;
          else if (c >= 30 && c <= 37) fg = c - 30;
          else if (c >= 90 && c <= 97) fg = c - 90 + 8;
          else if (c >= 40 && c <= 47) bg = c - 40;
          else if (c >= 100 && c <= 107) bg = c - 100 + 8;
          else if (c === 39) fg = null;
          else if (c === 49) bg = null;
        }
        continue;
      }
      const span = document.createElement('span');
      span.textContent = part;
      if (fg != null) {
        span.style.color = ANSI_PALETTE[fg];
        if (bold && fg < 8) span.style.fontWeight = '700';
      }
      if (bg != null) span.style.backgroundColor = ANSI_PALETTE[bg];
      row.appendChild(span);
    }
    if (!row.childNodes.length) row.textContent = '\u00a0';
    pre.appendChild(row);
  }
}

async function previewArt(item) {
  const modal = $('#modal');
  if (!modal) return;
  const pre = h('pre', { class: 'art-preview', style: 'max-height:none;min-height:200px;font-size:10px;line-height:1.1' }, 'loading…');
  const ctx = openDialog({
    title: item.name,
    subtitle: `${fmtBytes(item.size)} · rendered at 80 columns`,
    content: h('div', {}, pre),
    buttons: [{ label: 'Close', onClick: (c) => c.close() }],
  });
  try {
    let text = state.artPreviews.get(item.name);
    if (text === undefined) {
      text = await apiText(`/art/${encodeURIComponent(item.name)}/preview`);
      state.artPreviews.set(item.name, text);
    }
    paintAnsi(pre, text, 40);
  } catch (err) {
    pre.textContent = `Preview unavailable: ${err.message}`;
  }
  ctx.setBusy(false);
}

function uploadArtModal(panel) {
  formModal({
    title: 'Upload ANSI art',
    subtitle: `Stored in ${state.artDir}. Name must end in .ans, .asc or .txt.`,
    submitLabel: 'Upload',
    fields: [
      { name: 'name', label: 'File name', value: '', required: true, wide: true,
        help: 'e.g. MAIN.ANS' },
      { name: 'file', label: 'Art file', type: 'file', accept: '.ans,.asc,.txt', required: true, wide: true,
        after: (records) => {
          const input = records.file.input;
          input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            const nameInput = records.name.input;
            if (file && !nameInput.value) nameInput.value = file.name;
          });
        } },
    ],
    onSubmit: async (values) => {
      if (!values.file) throw new Error('Choose an art file.');
      const name = values.name.trim() || values.file.name;
      if (!/\.(ans|asc|txt)$/i.test(name)) throw new Error('Art file names must end in .ans, .asc or .txt.');
      const contentBase64 = await fileToBase64(values.file);
      await api('POST', '/art/upload', { name, contentBase64 });
      state.artPreviews.delete(name);
      toast(`Uploaded ${name}.`);
      await renderArt(panel);
    },
  });
}

async function deleteArt(item, panel) {
  const ok = await confirmModal(
    h('span', {}, 'Delete art file ', h('strong', {}, item.name), '? Any slot using it will fall back to plain text.'),
    { title: 'Delete art', confirmLabel: 'Delete file' });
  if (!ok) return;
  try {
    await api('DELETE', `/art/${encodeURIComponent(item.name)}`);
    state.artPreviews.delete(item.name);
    toast('Art file deleted.');
    await renderArt(panel);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------------------------------------------------------------- 11. bots -- */

async function renderBots(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/bots');
  state.bots = data.bots || [];

  const rows = state.bots.map((bot) => h('tr', {},
    td(bot.handle || '—'),
    td(bot.name || '—'),
    td(bot.style || '—', 'dim hide-sm'),
    td(bot.level == null ? '—' : bot.level, 'num hide-sm'),
    td(`${bot.chatter == null ? 0 : bot.chatter}%`, 'num'),
    td(bot.active ? badge('active', 'green') : badge('off', '')),
    actionTd(
      btn('Edit', () => botModal(bot, panel), 'mini'),
      btn('Del', () => deleteBot(bot, panel), 'mini danger'))));

  panel.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, 'Chat bots ', h('b', {}, `${state.bots.length}`)),
      h('div', { class: 'card-tools' },
        btn('New bot', () => botModal(null, panel), 'primary'))),
    h('div', { class: 'card-body flush' },
      dataTable(
        ['Handle', 'Name', { label: 'Style', cls: 'hide-sm' }, { label: 'Level', cls: 'num hide-sm' }, { label: 'Chatter', cls: 'num' }, 'State', ''],
        rows, 'No bots. The channel is all humans, allegedly.'))));
}

function botModal(bot, panel) {
  const editing = !!bot;
  formModal({
    title: editing ? `Edit bot — ${bot.handle}` : 'New chat bot',
    subtitle: 'Bots appear as ordinary callers in chat.',
    fields: [
      { name: 'handle', label: 'Handle', value: bot ? bot.handle || '' : '', required: true, help: 'Unique in chat, e.g. NeonRider' },
      { name: 'name', label: 'Display name', value: bot ? bot.name || '' : '' },
      { name: 'style', label: 'Style', value: bot ? bot.style || '' : '', wide: true,
        help: 'Short tag: laconic, cyberpunk, paranoid sysop…' },
      { name: 'level', label: 'Security level', type: 'number', min: 0, max: 100, value: bot && bot.level != null ? bot.level : 10 },
      { name: 'chatter', label: 'Chatter (0–100)', type: 'number', min: 0, max: 100, value: bot && bot.chatter != null ? bot.chatter : 30,
        help: 'How often it speaks when idle.' },
      { name: 'active', label: 'Active in chat', type: 'checkbox', value: bot ? bot.active !== false : true, wide: true },
      { name: 'persona', label: 'Persona', type: 'textarea', rows: 4, wide: true, value: bot ? bot.persona || '' : '' },
      { name: 'topics', label: 'Topics', type: 'textarea', rows: 3, wide: true,
        value: Array.isArray(bot && bot.topics) ? bot.topics.join(', ') : '',
        help: 'Comma or newline separated.' },
    ],
    submitLabel: editing ? 'Save bot' : 'Create bot',
    onSubmit: async (values) => {
      const payload = {
        handle: values.handle.trim(),
        name: values.name,
        style: values.style,
        level: values.level,
        chatter: values.chatter,
        active: values.active,
        persona: values.persona,
        topics: parseList(values.topics),
      };
      const result = editing
        ? await api('PATCH', `/bots/${encodeURIComponent(bot.id)}`, payload)
        : await api('POST', '/bots', payload);
      const saved = result && result.bot;
      if (editing) {
        const index = state.bots.findIndex((b) => b.id === bot.id);
        if (index >= 0) state.bots[index] = saved || { ...bot, ...payload };
      } else if (saved) {
        state.bots.push(saved);
      }
      toast(editing ? 'Bot updated.' : 'Bot created.');
      await renderBots(panel);
    },
  });
}

async function deleteBot(bot, panel) {
  const ok = await confirmModal(
    h('span', {}, 'Delete bot ', h('strong', {}, bot.handle), '? It stops appearing in chat immediately.'),
    { title: 'Delete bot', confirmLabel: 'Delete bot' });
  if (!ok) return;
  try {
    await api('DELETE', `/bots/${encodeURIComponent(bot.id)}`);
    toast('Bot deleted.');
    await renderBots(panel);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ----------------------------------------------------------- 12. bulletins -- */

async function renderBulletins(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/bulletins');
  state.bulletins = data.bulletins || [];

  const rows = state.bulletins.map((bulletin) => h('tr', {},
    td(bulletin.title || '—'),
    td(fmtWhen(bulletin.date), 'nowrap hide-sm'),
    td(String(bulletin.body || '').replace(/\s+/g, ' ').slice(0, 90) || '—', 'dim'),
    actionTd(
      btn('Edit', () => bulletinModal(bulletin, panel), 'mini'),
      btn('Del', () => deleteBulletin(bulletin, panel), 'mini danger'))));

  panel.append(h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, 'Bulletins ', h('b', {}, `${state.bulletins.length}`)),
      h('div', { class: 'card-tools' },
        btn('New bulletin', () => bulletinModal(null, panel), 'primary'))),
    h('div', { class: 'card-body flush' },
      dataTable(['Title', { label: 'Posted', cls: 'hide-sm' }, 'Body', ''],
        rows, 'No bulletins posted.'))));
}

function bulletinModal(bulletin, panel) {
  const editing = !!bulletin;
  formModal({
    title: editing ? 'Edit bulletin' : 'New bulletin',
    fields: [
      { name: 'title', label: 'Title', value: bulletin ? bulletin.title || '' : '', required: true, wide: true },
      { name: 'body', label: 'Body', type: 'textarea', rows: 12, value: bulletin ? bulletin.body || '' : '', wide: true,
        help: 'Plain text. Blank lines separate paragraphs.' },
    ],
    submitLabel: editing ? 'Save bulletin' : 'Post bulletin',
    onSubmit: async (values) => {
      const payload = { title: values.title.trim(), body: values.body };
      if (editing) await api('PATCH', `/bulletins/${encodeURIComponent(bulletin.id)}`, payload);
      else await api('POST', '/bulletins', payload);
      toast(editing ? 'Bulletin updated.' : 'Bulletin posted.');
      await renderBulletins(panel);
    },
  });
}

async function deleteBulletin(bulletin, panel) {
  const ok = await confirmModal(
    h('span', {}, 'Delete bulletin ', h('strong', {}, bulletin.title), '?'),
    { title: 'Delete bulletin', confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await api('DELETE', `/bulletins/${encodeURIComponent(bulletin.id)}`);
    toast('Bulletin deleted.');
    await renderBulletins(panel);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* --------------------------------------------------------------- 13. config -- */

async function renderConfig(panel) {
  panel.replaceChildren();
  const data = await api('GET', '/config');
  const config = (data && data.config) || {};
  state.config = config;
  if (config.bbs) setBoardName(config.bbs);

  const form = h('form', { class: 'config-form', autocomplete: 'off' });
  const inputs = [];

  for (const [groupKey, groupLabel] of CONFIG_GROUPS) {
    const group = config[groupKey];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;

    const grid = h('div', { class: 'cfg-grid' });
    for (const [key, value] of Object.entries(group)) {
      const path = `${groupKey}.${key}`;
      const label = humanKey(key);
      if (typeof value === 'boolean') {
        const input = h('input', { type: 'checkbox', id: `cfg_${groupKey}_${key}`, checked: value, title: path });
        input.dataset.path = path;
        grid.append(h('label', { class: 'check', for: `cfg_${groupKey}_${key}` }, input, h('span', { class: 'lbl' }, label)));
        inputs.push({ path, kind: 'bool', input, initial: value });
        continue;
      }
      const isNumber = typeof value === 'number';
      const input = h('input', {
        type: isNumber ? 'number' : 'text',
        id: `cfg_${groupKey}_${key}`,
        value: value === null || value === undefined ? '' : String(value),
        step: isNumber && !Number.isInteger(value) ? 'any' : null,
        min: isNumber && value >= 0 ? 0 : null,
        title: path,
      });
      input.dataset.path = path;
      grid.append(h('label', { class: 'field', for: `cfg_${groupKey}_${key}` },
        h('span', { class: 'lbl' }, label), input));
      inputs.push({ path, kind: isNumber ? 'num' : 'str', input, initial: value });
    }

    if (!grid.childElementCount) continue;
    form.append(h('section', { class: 'card cfg-group' },
      h('div', { class: 'card-head' },
        h('h3', {}, groupLabel),
        h('code', { class: 'small muted' }, groupKey)),
      h('div', { class: 'card-body' }, grid)));
  }

  const status = h('p', { class: 'form-error', role: 'alert' });
  const dirty = h('span', { class: 'small dirty-note', role: 'status' }, '');
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Save changes');
  const bar = h('div', { class: 'card save-bar' },
    h('div', { class: 'card-head' },
      h('h3', {}, 'Apply configuration'),
      h('div', { class: 'card-tools' },
        dirty,
        h('span', { class: 'small muted' }, 'only changed keys are sent as dotted paths'),
        saveBtn)),
    h('div', { class: 'card-body' }, status));

  form.append(bar);

  form.addEventListener('input', () => {
    dirty.textContent = 'unsaved changes';
  });
  form.addEventListener('change', () => {
    dirty.textContent = 'unsaved changes';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    const patch = {};
    for (const record of inputs) {
      let value;
      if (record.kind === 'bool') value = record.input.checked;
      else if (record.kind === 'num') value = record.input.value === '' ? 0 : Number(record.input.value);
      else value = record.input.value;
      if (value !== record.initial) patch[record.path] = value;
    }
    const keys = Object.keys(patch);
    if (!keys.length) {
      toast('No changes to save.', 'warn');
      return;
    }
    saveBtn.disabled = true;
    try {
      const result = await api('PUT', '/config', { patch });
      if (result && result.config) state.config = result.config;
      for (const record of inputs) {
        record.initial = record.kind === 'bool' ? record.input.checked
          : record.kind === 'num' ? Number(record.input.value)
            : record.input.value;
      }
      dirty.textContent = '';
      toast(`Saved ${keys.length} setting${keys.length === 1 ? '' : 's'}.`);
      if (state.config && state.config.bbs) setBoardName(state.config.bbs);
    } catch (err) {
      status.textContent = err.message;
      toast(err.message, 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });

  panel.append(form, passwordCard());
}

function passwordCard() {
  const current = h('input', { type: 'password', id: 'pw-current', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', id: 'pw-next', autocomplete: 'new-password', required: true, minlength: '4' });
  const again = h('input', { type: 'password', id: 'pw-again', autocomplete: 'new-password', required: true, minlength: '4' });
  const errorNode = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Change password');

  const form = h('form', { class: 'form-grid' },
    h('label', { class: 'field', for: 'pw-current' },
      h('span', { class: 'lbl' }, 'Current password'), current),
    h('label', { class: 'field', for: 'pw-next' },
      h('span', { class: 'lbl' }, 'New password'), next),
    h('label', { class: 'field', for: 'pw-again' },
      h('span', { class: 'lbl' }, 'Repeat new password'), again),
    h('div', { class: 'wide row end' }, submit),
    h('div', { class: 'wide' }, errorNode));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    if (next.value !== again.value) {
      errorNode.textContent = 'The new passwords do not match.';
      return;
    }
    if (next.value.length < 4) {
      errorNode.textContent = 'Use at least 4 characters.';
      return;
    }
    submit.disabled = true;
    try {
      await api('POST', '/password', { current: current.value, next: next.value });
      form.reset();
      toast('Admin password changed.');
    } catch (err) {
      errorNode.textContent = err.message;
      toast(err.message, 'err');
    } finally {
      submit.disabled = false;
    }
  });

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', {}, 'Admin credentials'),
      h('span', { class: 'small muted' }, 'logout elsewhere before rotating on a shared machine')),
    h('div', { class: 'card-body' }, form));
}

/* ------------------------------------------------------------- 14. renderers */

const RENDERERS = {
  overview: renderOverview,
  users: renderUsers,
  boards: renderBoards,
  files: renderFiles,
  doors: renderDoors,
  art: renderArt,
  bots: renderBots,
  bulletins: renderBulletins,
  config: renderConfig,
};

/* --------------------------------------------------------------- 15. boot --- */

function wireStatic() {
  const loginForm = $('#login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);
  const logout = $('#logout');
  if (logout) logout.addEventListener('click', handleLogout);
  window.addEventListener('hashchange', () => {
    const id = (location.hash || '').replace(/^#/, '');
    const meta = SECTIONS.find((s) => s.id === id);
    if (meta) setSection(meta.id);
  });
  window.addEventListener('resize', () => {
    if (state.section !== 'art') return;
    for (const pre of document.querySelectorAll('#panel .art-preview')) fitArtPreview(pre);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.section === 'overview') {
      api('GET', '/overview').then(paintOverview).catch((err) => console.warn('[admin] refresh failed', err));
    }
  });
}

async function boot() {
  wireStatic();
  try {
    const me = await api('GET', '/me');
    state.me = me && me.user ? me : { user: 'sysop' };
    enterApp();
  } catch (err) {
    if (err.status === 401) showLogin('');
    else {
      showLogin(err.status ? `Console API error: ${err.message}` : 'Cannot reach the BBS server.');
      console.warn('[admin] boot failed', err);
    }
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
