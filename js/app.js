import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, CATEGORIES as DEFAULT_CATEGORIES, FAMILY_SIZE, PALETTE } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/* =====================================================================
   Estado y utilidades
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = () => $('#view');

const state = {
  session: null,
  me: null,
  members: [],
  months: [],
  expenses: [],
  contributions: [],
  allowed: [],
  categories: [],
  month: monthOf(todayStr()),
  filters: { member: 'all', category: 'all' },
  charts: [],
  deferredPrompt: null,
  receiptUrls: {},
};

const KIND = { cuota: 'Cuota mensual', ajuste: 'Ajuste fin de mes', inicial: 'Saldo inicial / ingreso' };
const KIND_ICON = { cuota: '💵', ajuste: '⚖️', inicial: '🏦' };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthOf(dateStr) { return dateStr.slice(0, 7); }
function shiftMonth(m, delta) {
  let [y, mo] = m.split('-').map(Number);
  mo += delta;
  while (mo > 12) { mo -= 12; y++; }
  while (mo < 1) { mo += 12; y--; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}
function monthLabel(m, opts = { month: 'long', year: 'numeric' }) {
  const [y, mo] = m.split('-').map(Number);
  const s = new Date(y, mo - 1, 1).toLocaleDateString('es-UY', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function daysInMonth(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); }
function fmtDate(s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-UY', opts);
}

const fmtUYU = new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtUSD = new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'USD' });
const money = (v) => fmtUYU.format(Number(v) || 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const round2 = (n) => Math.round(n * 100) / 100;
// Categorías: vienen de la tabla "categories"; si todavía no existe, se usan las de config.js
const allCats = () => (state.categories.length ? state.categories
  : DEFAULT_CATEGORIES.map((c, i) => ({ ...c, active: true, sort: (i + 1) * 10 })));
const activeCats = () => allCats().filter((c) => c.active);
const cat = (id) => allCats().find((c) => c.id === id) || { id, icon: '📦', color: '#9A8C98', active: false };
const CAT_ICONS = ['🏠', '💧', '💡', '🔥', '🛒', '🥩', '🥬', '📦', '🌐', '📱', '💊', '🏥', '🚌', '⛽', '🚗', '🎓',
  '📚', '👕', '🐶', '🎉', '🍽️', '☕', '🍞', '🥛', '🍎', '🧴', '🧹', '🔧', '💳', '🎁', '✈️', '🎬'];
const CAT_COLORS = ['#3D405B', '#4EA8DE', '#E9B949', '#E76F51', '#81B29A', '#B5394B', '#6A994E', '#9A8C98',
  '#9B5DE5', '#F15BB5', '#2A9D8F', '#174E5A'];

// Gastos comunes vs. personales
const isCommon = (e) => (e.scope || 'comun') === 'comun';
/** Lo que el gasto suma a la caja común ($UY). Personal o "No imputa" = 0. */
const sharedUyu = (e) => Number(e.shared_uyu ?? e.amount_uyu) || 0;
/** La parte personal del gasto ($UY): todo si es personal o "No imputa", o lo descontado del ticket. */
const personalUyu = (e) => round2((Number(e.amount_uyu) || 0) - sharedUyu(e));
// Pagado de bolsillo y reintegros
const paidPocket = (e) => isCommon(e) && e.paid_from === 'bolsillo';
/** Lo que se le acredita a quien pagó de su bolsillo (la parte común). */
const pocketCredit = (e) => (paidPocket(e) ? sharedUyu(e) : 0);
/** Lo que ya se le devolvió desde la caja. */
const reimbUyu = (e) => Number(e.reimbursed_uyu) || 0;
const isPendingReimb = (e) => paidPocket(e) && e.reimburse === 'reintegro' && !e.reimbursed_month && sharedUyu(e) > 0;
const member = (id) => state.members.find((m) => m.id === id) || { name: '¿?', color: '#999999' };
const initials = (name) => (name || '?').trim().charAt(0).toUpperCase();
const isOpen = (m) => !state.months.find((x) => x.id === m)?.closed;
const byDateDesc = (a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at);
function groupSum(arr, keyF, valF) {
  const out = {};
  arr.forEach((x) => { const k = keyF(x); out[k] = (out[k] || 0) + (Number(valF(x)) || 0); });
  return out;
}
const emptyMsg = (t) => `<p class="empty">${t}</p>`;

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

function friendlyError(err) {
  const m = err?.message || String(err);
  if (/Invalid login/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/Database error saving new user|no está autorizado/i.test(m)) return 'Este email no está autorizado. Pedile a la administradora que lo agregue en "Familia".';
  if (/Email not confirmed/i.test(m)) return 'Tenés que confirmar tu email (revisá tu correo).';
  if (/already registered/i.test(m)) return 'Ese email ya tiene cuenta. Usá "Entrar".';
  if (/Password should be|at least 6/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/rate limit/i.test(m)) return 'Demasiados intentos. Esperá unos minutos.';
  if (/row-level security|violates|permission/i.test(m)) return 'No tenés permiso para hacer eso (o el mes está cerrado).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión. Probá de nuevo.';
  return m;
}

function openModal(html) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="sheet" role="dialog"><button class="x close" aria-label="Cerrar">×</button>${html}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  const close = () => { wrap.classList.remove('show'); setTimeout(() => wrap.remove(), 220); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.close')) close(); });
  return close;
}

/* =====================================================================
   Datos
   ===================================================================== */
async function fetchAll(table, order) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await sb.from(table).select('*').order(order, { ascending: true }).range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

async function loadData() {
  const [members, months, expenses, contributions] = await Promise.all([
    fetchAll('members', 'created_at'),
    fetchAll('months', 'id'),
    fetchAll('expenses', 'spent_on'),
    fetchAll('contributions', 'created_at'),
  ]);
  Object.assign(state, { members, months, expenses, contributions });
  state.me = members.find((m) => m.id === state.session?.user?.id) || null;
  // Si la tabla de categorías no existe todavía, allCats() usa las de config.js
  const { data: cats, error: catErr } = await sb.from('categories').select('*')
    .order('sort', { ascending: true }).order('name', { ascending: true });
  state.categories = catErr ? [] : (cats || []).map((c) => ({ id: c.name, icon: c.icon, color: c.color, sort: c.sort, active: c.active }));
  if (state.filters.category !== 'all' && !allCats().some((c) => c.id === state.filters.category)) state.filters.category = 'all';
  if (state.me?.is_admin) {
    const { data } = await sb.from('allowed_emails').select('*').order('name');
    state.allowed = data || [];
  }
}

async function refresh() {
  try { await loadData(); } catch (e) { toast(friendlyError(e), 'err'); }
  render();
}

/** Cálculos de la caja común para un mes (solo gastos comunes; usa lo imputado a la caja). */
function monthStats(m) {
  const common = state.expenses.filter(isCommon);
  const exps = common.filter((e) => monthOf(e.spent_on) === m);
  const conts = state.contributions.filter((c) => c.month_id === m);
  const opening = sum(state.contributions.filter((c) => c.month_id < m), (c) => c.amount)
                + sum(common.filter((e) => monthOf(e.spent_on) < m), pocketCredit)
                - sum(common.filter((e) => monthOf(e.spent_on) < m), sharedUyu)
                - sum(common.filter((e) => e.reimbursed_month && e.reimbursed_month < m), reimbUyu);
  const spent = sum(exps, sharedUyu);
  const contributed = sum(conts, (c) => c.amount);
  const pocket = sum(exps, pocketCredit);                                           // gastos comunes pagados de bolsillo
  const reimbList = common.filter((e) => e.reimbursed_month === m);
  const reimbs = sum(reimbList, reimbUyu);                                          // reintegros pagados este mes
  const pendingList = common.filter((e) => isPendingReimb(e) && monthOf(e.spent_on) <= m);
  const pending = sum(pendingList, sharedUyu);
  const balance = opening + contributed + pocket - spent - reimbs;
  const adjTotal = sum(conts.filter((c) => c.kind === 'ajuste'), (c) => c.amount);
  const preAdj = balance - adjTotal;                         // saldo antes de los ajustes de fin de mes
  const share = preAdj < 0 ? round2(-preAdj / FAMILY_SIZE) : 0; // lo que debe poner cada uno si falta
  const row = state.months.find((x) => x.id === m) || null;
  return { m, exps, conts, opening, spent, contributed, balance, adjTotal, preAdj, share, row,
           pocket, reimbs, reimbList, pending, pendingList,
           quota: Number(row?.quota || 0), closed: !!row?.closed };
}

/**
 * Balance individual (acumulado desde el inicio hasta el mes m).
 * Cada integrante paga 1/FAMILY_SIZE de los gastos comunes. Lo que aportó de más queda a su favor
 * y lo que aportó de menos lo debe reponer. Los "Saldo inicial / otro ingreso" se reparten entre todos.
 * La suma de los saldos individuales es igual al saldo de la caja.
 */
function memberStats(s) {
  const m = s.m;
  const common = state.expenses.filter(isCommon);
  const prevFair = sum(common.filter((e) => monthOf(e.spent_on) < m), sharedUyu) / FAMILY_SIZE;
  const incomeOf = (f) => sum(state.contributions.filter((c) => c.kind === 'inicial' && f(c.month_id)), (c) => c.amount) / FAMILY_SIZE;
  const prevInc = incomeOf((x) => x < m);
  const inc = incomeOf((x) => x === m);
  const fair = s.spent / FAMILY_SIZE;
  return state.members.map((mb) => {
    const own = state.contributions.filter((c) => c.member_id === mb.id && c.kind !== 'inicial');
    const mine = common.filter((e) => e.created_by === mb.id);
    const prev = sum(own.filter((c) => c.month_id < m), (c) => c.amount) + prevInc - prevFair
               + sum(mine.filter((e) => monthOf(e.spent_on) < m), pocketCredit)
               - sum(mine.filter((e) => e.reimbursed_month && e.reimbursed_month < m), reimbUyu);
    const cur = own.filter((c) => c.month_id === m);
    const cuota = sum(cur.filter((c) => c.kind === 'cuota'), (c) => c.amount);
    const ajuste = sum(cur.filter((c) => c.kind === 'ajuste'), (c) => c.amount);
    const pocket = sum(mine.filter((e) => monthOf(e.spent_on) === m), pocketCredit);
    const reimb = sum(mine.filter((e) => e.reimbursed_month === m), reimbUyu);
    const pendingR = sum(mine.filter((e) => isPendingReimb(e) && monthOf(e.spent_on) <= m), sharedUyu);
    const saldo = round2(prev + cuota + ajuste + pocket - reimb + inc - fair);
    const personal = sum(state.expenses.filter((e) => e.created_by === mb.id && monthOf(e.spent_on) === m), personalUyu);
    return { mb, prev: round2(prev), cuota, ajuste, pocket, reimb, pendingR, inc: round2(inc), fair: round2(fair), saldo, personal };
  });
}
const signed = (v) => (v >= 0 ? '+' : '−') + money(Math.abs(v));

async function receiptUrl(path) {
  if (state.receiptUrls[path]) return state.receiptUrls[path];
  const { data, error } = await sb.storage.from('tickets').createSignedUrl(path, 3600);
  if (error) return null;
  state.receiptUrls[path] = data.signedUrl;
  return data.signedUrl;
}

async function getUsdRate() {
  const key = 'usd-rate-' + todayStr();
  const cached = localStorage.getItem(key);
  if (cached) return Number(cached);
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    const v = j?.rates?.UYU;
    if (v) {
      const val = round2(v);
      localStorage.setItem(key, val);
      localStorage.setItem('usd-rate-last', val);
      return val;
    }
  } catch { /* sin conexión: usar la última conocida */ }
  return Number(localStorage.getItem('usd-rate-last') || 40);
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

/** Achica la foto del ticket para ahorrar espacio (máx. 1400 px, JPEG). */
async function compressImage(file, max = 1400, quality = 0.72) {
  const img = await loadImage(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
}

/* =====================================================================
   Tiempo real
   ===================================================================== */
let channel = null;
let reloadTimer = null;
function subscribeRealtime() {
  if (channel) return;
  channel = sb.channel('familia-labaut');
  ['expenses', 'contributions', 'months', 'members', 'categories'].forEach((table) =>
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, queueReload));
  channel.subscribe();
}
function unsubscribeRealtime() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}
function queueReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try { await loadData(); } catch { return; }
    // No re-dibujar si alguien está completando un formulario
    if (route().path !== 'nuevo' && !$('.modal')) render();
  }, 600);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me) queueReload();
});

/* =====================================================================
   Notificaciones push
   ===================================================================== */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

async function currentPushSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function pushHelp() {
  if (isIOS() && !isStandalone()) {
    return `<h2>🔔 Notificaciones en iPhone</h2>
      <ol class="steps">
        <li>Primero instalá la app: en <b>Safari</b> tocá <b>Compartir</b> <span class="kbd">⬆️</span> → <b>"Agregar a inicio"</b>.</li>
        <li>Abrí la app <b>desde el ícono</b> de la pantalla de inicio.</li>
        <li>Entrá a <b>Familia</b> y tocá <b>"Activar notificaciones"</b>.</li>
      </ol>
      <p class="muted small">Necesita iOS 16.4 o más nuevo.</p>`;
  }
  return `<h2>🔔 Notificaciones</h2><p>Este navegador no permite notificaciones. En Android usá <b>Chrome</b>; en iPhone, la app instalada desde Safari.</p>`;
}

async function enablePush() {
  if (!pushSupported()) { openModal(pushHelp()); return false; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('No se dio permiso. Activalo en la configuración del celular (Notificaciones → Labaut).', 'err');
    return false;
  }
  try {
    const { data, error } = await sb.functions.invoke('notify', { body: { type: 'key' } });
    const key = data?.publicKey;
    if (error || !key) throw new Error('Las notificaciones todavía no están configuradas en Supabase.');
    const reg = await navigator.serviceWorker.ready;
    const opts = { userVisibleOnly: true, applicationServerKey: b64ToBytes(key) };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe(opts);
    }
    let j = sub.toJSON();
    let { error: e2 } = await sb.from('push_subscriptions').upsert({
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200),
    });
    if (e2) {
      // Suscripción vieja (otra clave u otra persona en este celular): se renueva
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe(opts);
      j = sub.toJSON();
      ({ error: e2 } = await sb.from('push_subscriptions').upsert({
        endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200),
      }));
      if (e2) throw e2;
    }
    toast('🔔 Notificaciones activadas');
    return true;
  } catch (err) {
    toast(friendlyError(err), 'err');
    return false;
  }
}

/** Quita este celular de la lista de avisos (opcionalmente también desuscribe el navegador). */
async function disablePush(unsubscribe = true) {
  try {
    const sub = await currentPushSub();
    if (!sub) return;
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    if (unsubscribe) await sub.unsubscribe();
  } catch { /* sin conexión: no importa */ }
}

/** Pide al servidor que avise a la familia. No bloquea ni muestra errores. */
function notify(type, id, extra = {}) {
  sb.functions.invoke('notify', { body: { type, id, ...extra } }).catch(() => {});
}

function pushBanner() {
  if (!pushSupported() || Notification.permission !== 'default' || localStorage.getItem('hidePush')) return '';
  return `<section class="card notice" id="pushBanner">
    <p>🔔 Activá las notificaciones para enterarte de cada gasto y aporte.</p>
    <button class="btn primary sm" id="pushBannerOn">Activar</button>
    <button class="x" id="pushBannerHide" aria-label="Ocultar">×</button>
  </section>`;
}
function bindPushBanner() {
  $('#pushBannerOn')?.addEventListener('click', async () => { if (await enablePush()) $('#pushBanner')?.remove(); });
  $('#pushBannerHide')?.addEventListener('click', () => { localStorage.setItem('hidePush', '1'); $('#pushBanner')?.remove(); });
}

/* =====================================================================
   Instalación (PWA)
   ===================================================================== */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredPrompt = e; });
window.addEventListener('appinstalled', () => { $$('.install-banner').forEach((b) => b.remove()); toast('¡App instalada! 🎉'); });

function installBanner() {
  if (isStandalone() || localStorage.getItem('hideInstall')) return '';
  return `<div class="install-banner">
    <img src="./icons/icon.svg" alt="">
    <div><b>Instalá la app</b><small>Tenela en la pantalla de inicio</small></div>
    <button class="btn primary sm" data-install>Instalar</button>
    <button class="x" data-hide-install aria-label="Ocultar">×</button>
  </div>`;
}

function installHelp() {
  if (isIOS()) {
    return `<h2>📲 Instalar en iPhone</h2>
      <ol class="steps">
        <li>Abrí este enlace en <b>Safari</b>.</li>
        <li>Tocá el botón <b>Compartir</b> <span class="kbd">⬆️</span> (abajo o arriba de la pantalla).</li>
        <li>Bajá y elegí <b>"Agregar a inicio"</b> / <b>"Agregar a pantalla de inicio"</b>.</li>
        <li>Tocá <b>"Agregar"</b>. ¡Listo! Aparece el ícono de Labaut 🏠❤️</li>
      </ol>`;
  }
  return `<h2>📲 Instalar en Android</h2>
    <ol class="steps">
      <li>Abrí este enlace en <b>Chrome</b>.</li>
      <li>Tocá el menú <span class="kbd">⋮</span> (arriba a la derecha).</li>
      <li>Elegí <b>"Instalar app"</b> o <b>"Agregar a pantalla principal"</b>.</li>
      <li>Confirmá con <b>"Instalar"</b>. ¡Listo! Aparece el ícono de Labaut 🏠❤️</li>
    </ol>`;
}

async function installApp() {
  if (state.deferredPrompt) {
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    return;
  }
  openModal(installHelp());
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-install]')) installApp();
  const hide = e.target.closest('[data-hide-install]');
  if (hide) { localStorage.setItem('hideInstall', '1'); hide.closest('.install-banner')?.remove(); }
});

/* =====================================================================
   Router
   ===================================================================== */
function route() {
  const h = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [path, qs] = h.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}
function go(path) { location.hash = '#/' + path; }
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }
function makeChart(id, config) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  state.charts.push(new window.Chart(el, config));
}

function render() {
  destroyCharts();
  if (!state.session) { renderAuth(); return; }
  if (!state.me) { renderNotMember(); return; }
  renderShell();
  const { path, params } = route();
  const views = { inicio: viewHome, nuevo: viewExpenseForm, movimientos: viewMovements,
                  analisis: viewAnalysis, balance: viewBalance, familia: viewFamily };
  (views[path] || viewHome)(params);
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.path === path));
}

function renderShell() {
  if (!$('#shell')) {
    $('#app').innerHTML = `
      <div id="shell">
        <header class="topbar">
          <a href="#/inicio" class="brand"><img src="./icons/icon.svg" alt=""><span>Labaut</span></a>
          <div class="month-switch" id="monthSwitch">
            <button data-shift="-1" aria-label="Mes anterior">‹</button>
            <span id="monthLabel"></span>
            <button data-shift="1" aria-label="Mes siguiente">›</button>
          </div>
          <a href="#/familia" class="avatar" id="meAvatar" aria-label="Familia y perfil"></a>
        </header>
        <main id="view"></main>
        <nav class="nav">
          <a href="#/inicio" data-path="inicio"><span>🏠</span>Inicio</a>
          <a href="#/movimientos" data-path="movimientos"><span>📋</span>Gastos</a>
          <a href="#/nuevo" data-path="nuevo" class="nav-add" aria-label="Nuevo gasto"><span>＋</span></a>
          <a href="#/analisis" data-path="analisis"><span>📊</span>Análisis</a>
          <a href="#/balance" data-path="balance"><span>⚖️</span>Balance</a>
        </nav>
      </div>`;
    $('#monthSwitch').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.month = shiftMonth(state.month, Number(b.dataset.shift));
      render();
    });
  }
  $('#monthLabel').textContent = monthLabel(state.month);
  const av = $('#meAvatar');
  av.textContent = initials(state.me.name);
  av.style.background = state.me.color;
  $('#monthSwitch').style.visibility = ['nuevo', 'familia'].includes(route().path) ? 'hidden' : 'visible';
}

/* =====================================================================
   Pantalla de acceso
   ===================================================================== */
function renderAuth(mode = 'login') {
  $('#app').innerHTML = `
    <div class="auth">
      <img class="auth-logo" src="./icons/logo.jpg" onerror="this.onerror=null;this.src='./icons/icon.svg'" alt="Familia Labaut">
      <p class="auth-sub">Los gastos de casa, juntos 💛</p>
      <div class="seg auth-tabs">
        <button data-mode="login" class="${mode === 'login' ? 'sel' : ''}">Entrar</button>
        <button data-mode="signup" class="${mode === 'signup' ? 'sel' : ''}">Crear cuenta</button>
      </div>
      <form id="authForm" class="form">
        <input id="email" type="email" placeholder="Tu email" autocomplete="email" required>
        <input id="password" type="password" placeholder="Contraseña${mode === 'signup' ? ' (mínimo 6)' : ''}"
               autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required>
        <button class="btn primary block" type="submit">${mode === 'login' ? 'Entrar' : 'Crear mi cuenta'}</button>
      </form>
      ${mode === 'login'
        ? '<button class="link" id="forgot">Olvidé mi contraseña</button>'
        : '<p class="muted small">Solo pueden registrarse los emails autorizados por la familia.</p>'}
      ${installBanner()}
    </div>`;

  $$('.auth-tabs button').forEach((b) => (b.onclick = () => renderAuth(b.dataset.mode)));

  $('#authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const email = $('#email').value.trim().toLowerCase();
    const password = $('#password').value;
    const btn = ev.submitter || $('#authForm button');
    btn.disabled = true;
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({
          email, password, options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        if (!data.session) {
          openModal(`<h2>📧 Revisá tu correo</h2><p>Te enviamos un email a <b>${esc(email)}</b>. Tocá el enlace para confirmar la cuenta y después entrá con tu contraseña.</p>`);
          renderAuth('login');
        }
      }
    } catch (e) {
      toast(friendlyError(e), 'err');
    } finally {
      btn.disabled = false;
    }
  };

  $('#forgot')?.addEventListener('click', async () => {
    const email = $('#email').value.trim().toLowerCase();
    if (!email) return toast('Escribí tu email arriba y volvé a tocar "Olvidé mi contraseña".', 'err');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) return toast(friendlyError(error), 'err');
    toast('Te enviamos un email para cambiar la contraseña.');
  });
}

function askNewPassword() {
  const close = openModal(`<h2>🔑 Nueva contraseña</h2>
    <form id="pwForm" class="form">
      <input id="newPw" type="password" minlength="6" placeholder="Nueva contraseña (mínimo 6)" autocomplete="new-password" required>
      <button class="btn primary block">Guardar</button>
    </form>`);
  $('#pwForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#newPw').value });
    if (error) return toast(friendlyError(error), 'err');
    close();
    toast('Contraseña actualizada ✅');
  };
}

function renderNotMember() {
  $('#app').innerHTML = `
    <div class="auth">
      <img class="auth-logo" src="./icons/icon.svg" alt="">
      <h2>No encontramos tu perfil</h2>
      <p class="muted">Tu cuenta (${esc(state.session.user.email)}) no está vinculada a la familia. Pedile a la administradora que revise tu email.</p>
      <button class="btn ghost block" id="logout">Cerrar sesión</button>
    </div>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

/* =====================================================================
   Inicio
   ===================================================================== */
/**
 * Fila de un gasto.
 * mode 'comun': muestra lo que suma a la caja. mode 'mios': muestra el total y cuánto es personal.
 */
function expenseItem(e, mode = 'comun') {
  const c = cat(e.category);
  const m = member(e.created_by);
  const total = Number(e.amount_uyu) || 0;
  const tags = [];
  if (!isCommon(e)) tags.push('<span class="tag personal">👤 Personal</span>');
  if (e.excluded) tags.push('<span class="tag excl">🚫 No imputa</span>');
  if (isCommon(e) && !e.excluded && Number(e.personal_amount) > 0) tags.push(`<span class="tag">👤 ${money(personalUyu(e))} personal</span>`);
  if (paidPocket(e) && !e.excluded) {
    tags.push(e.reimbursed_month ? '<span class="tag ok">👛 ✅ Reintegrado</span>'
      : isPendingReimb(e) ? '<span class="tag warn">👛 🔁 Reintegro pendiente</span>'
      : '<span class="tag">👛 Bolsillo → fondo</span>');
  }

  let amt;
  if (mode === 'mios') {
    amt = `<b>${money(total)}</b>${isCommon(e) && sharedUyu(e) > 0 ? `<small>caja ${money(sharedUyu(e))}</small>` : ''}`;
  } else if (e.excluded) {
    amt = `<b class="strike">${money(total)}</b><small>no imputa</small>`;
  } else {
    const sub = Number(e.personal_amount) > 0 ? `ticket ${money(total)}` : (e.currency === 'USD' ? fmtUSD.format(e.amount) : '');
    amt = `<b>${money(sharedUyu(e))}</b>${sub ? `<small>${sub}</small>` : ''}`;
  }
  return `<li class="item tap ${mode === 'comun' && e.excluded ? 'excluded' : ''}" data-id="${e.id}">
    <div class="ico" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</div>
    <div class="info">
      <b>${esc(e.note || e.category)}</b>
      <small><span class="dot" style="background:${m.color}"></span>${esc(m.name)} · ${fmtDate(e.spent_on)}${e.receipt_path ? ' · 📎' : ''}</small>
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    </div>
    <div class="amt">${amt}</div>
  </li>`;
}
function bindExpenseItems() {
  $$('.item[data-id]').forEach((li) => (li.onclick = () => openExpense(li.dataset.id)));
}

function quotaCard(s) {
  const mine = sum(s.conts.filter((c) => c.member_id === state.me.id && c.kind === 'cuota'), (c) => c.amount);
  if (!s.row) {
    return state.me.is_admin
      ? `<section class="card notice"><p>📌 Todavía no definiste la cuota de ${monthLabel(s.m, { month: 'long' })}.</p><a class="btn primary sm" href="#/balance">Definir cuota</a></section>`
      : `<section class="card notice"><p>⏳ La cuota de ${monthLabel(s.m, { month: 'long' })} aún no fue definida.</p></section>`;
  }
  if (s.quota > 0 && mine >= s.quota) {
    return `<section class="card notice ok"><p>✅ Ya aportaste tu cuota de <b>${money(mine)}</b>. ¡Gracias!</p></section>`;
  }
  return `<section class="card notice">
    <p>💵 Tu cuota del mes: <b>${money(s.quota)}</b>${mine ? ` · pendiente <b>${money(s.quota - mine)}</b>` : ''}</p>
    ${s.closed ? '' : '<button class="btn primary sm" id="quickContrib">Registrar mi aporte</button>'}
  </section>`;
}

function viewHome() {
  const s = monthStats(state.month);
  const recent = [...s.exps].sort(byDateDesc).slice(0, 5);
  const byCat = Object.entries(groupSum(s.exps, (e) => e.category, sharedUyu)).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...byCat.map((x) => x[1]));
  const mineMonth = state.expenses.filter((e) => e.created_by === state.me.id && monthOf(e.spent_on) === s.m);
  const myPersonal = sum(mineMonth, personalUyu);
  view().innerHTML = `
    ${installBanner()}
    ${pushBanner()}
    <h1 class="hello">Hola, ${esc(state.me.name)} 👋</h1>
    <section class="card hero ${s.balance < 0 ? 'neg' : ''}">
      <div class="label">Caja común · ${monthLabel(s.m, { month: 'long' })}</div>
      <div class="big">${money(s.balance)}</div>
      <div class="row3">
        <div><small>Saldo anterior</small><b>${money(s.opening)}</b></div>
        <div><small>Aportes</small><b>${money(s.contributed + s.pocket - s.reimbs)}</b></div>
        <div><small>Gastos</small><b>${money(s.spent)}</b></div>
      </div>
      ${s.closed ? '<div class="pill">🔒 Mes cerrado</div>' : ''}
    </section>
    ${quotaCard(s)}
    <a class="card notice mine-link" href="#/movimientos?vista=mios">
      <p>👤 Mis gastos personales de ${monthLabel(s.m, { month: 'long' })}: <b>${money(myPersonal)}</b></p>
      <span>Ver ›</span>
    </a>
    <section class="card">
      <div class="card-title"><h2>Por categoría</h2><a href="#/analisis">Ver análisis ›</a></div>
      ${byCat.length
        ? byCat.map(([k, v]) => `<div class="bar-row"><span>${esc(cat(k).icon)} ${esc(k)}</span><div class="bar"><i style="width:${(v / maxCat) * 100}%;background:${cat(k).color}"></i></div><b>${money(v)}</b></div>`).join('')
        : emptyMsg('Todavía no hay gastos este mes.')}
    </section>
    <section class="card">
      <div class="card-title"><h2>Últimos gastos</h2><a href="#/movimientos">Ver todos ›</a></div>
      ${recent.length ? `<ul class="list">${recent.map((e) => expenseItem(e)).join('')}</ul>` : emptyMsg('Tocá ＋ para registrar el primero.')}
    </section>`;
  bindExpenseItems();
  bindPushBanner();
  $('#quickContrib')?.addEventListener('click', () => addContribution(s));
}

/* =====================================================================
   Detalle de un gasto
   ===================================================================== */
async function openExpense(id) {
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return;
  const c = cat(e.category);
  const m = member(e.created_by);
  const mine = e.created_by === state.me.id;
  const admin = state.me.is_admin;
  const open = isOpen(monthOf(e.spent_on));
  const common = isCommon(e);
  const canModify = (mine || admin) && (!common || open);   // los personales se pueden tocar aunque el mes esté cerrado
  const hasSplit = common && Number(e.personal_amount) > 0;
  const by = e.excluded_by ? member(e.excluded_by).name : '';
  const close = openModal(`
    <div class="detail-head">
      <div class="ico lg" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</div>
      <div><h2>${money(common && !e.excluded ? sharedUyu(e) : e.amount_uyu)}</h2>
        <small class="muted">${esc(e.category)} · ${common ? '🏠 Común' : '👤 Personal'}</small></div>
    </div>
    ${e.excluded ? `<div class="alert warn">🚫 <b>No imputa a la caja.</b>${e.excluded_reason ? ' Motivo: ' + esc(e.excluded_reason) + '.' : ''}
      ${by ? `<br><small>Marcado por ${esc(by)} el ${new Date(e.excluded_at).toLocaleDateString('es-UY')}. Cuenta como gasto personal de ${esc(m.name)}.</small>` : ''}</div>` : ''}
    <dl class="dl">
      ${e.currency === 'USD' ? `<dt>Monto original</dt><dd>${fmtUSD.format(e.amount)} × ${e.rate} $UY</dd>` : ''}
      ${hasSplit ? `<dt>Total del ticket</dt><dd>${money(e.amount_uyu)}</dd>
        <dt>Parte personal</dt><dd>${money(personalUyu(e))}${e.excluded ? '' : ` (de ${esc(m.name)})`}</dd>
        <dt>A la caja</dt><dd><b>${money(sharedUyu(e))}</b></dd>` : ''}
      <dt>Fecha</dt><dd>${fmtDate(e.spent_on, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd>
      ${common ? `<dt>Pagado con</dt><dd>${paidPocket(e)
        ? `👛 Bolsillo de ${esc(m.name)} · ${e.reimbursed_month ? `✅ reintegrado ${money(reimbUyu(e))}` : e.reimburse === 'reintegro' ? '🔁 pide reintegro' : '🎁 queda para el fondo'}`
        : '💰 Plata de la caja'}</dd>` : ''}
      <dt>Registrado por</dt><dd><span class="dot" style="background:${m.color}"></span>${esc(m.name)}</dd>
      ${e.note ? `<dt>Nota</dt><dd>${esc(e.note)}</dd>` : ''}
    </dl>
    ${e.receipt_path ? '<div class="receipt" id="receiptBox">Cargando ticket…</div>' : ''}
    ${canModify ? '<div class="actions"><button class="btn ghost" id="btnEdit">✏️ Editar</button><button class="btn danger" id="btnDel">🗑️ Borrar</button></div>' : ''}
    ${(mine || admin) && !canModify ? '<p class="muted">🔒 El mes está cerrado; no se puede modificar.</p>' : ''}
    ${!mine && !admin ? `<p class="muted small">Solo ${esc(m.name)} puede editar o borrar este gasto.</p>` : ''}
    ${!mine && admin && canModify ? `<p class="muted small">Como administradora podés editar o borrar este gasto de ${esc(m.name)}.</p>` : ''}
    ${admin && common && open ? (e.excluded
      ? '<button class="btn ghost block" id="btnInclude">↩️ Volver a imputar a la caja</button>'
      : '<button class="btn ghost block" id="btnExclude">🚫 Marcar "No imputa"</button>') : ''}
    ${admin && isPendingReimb(e) ? `<button class="btn primary block" id="btnReimb">💸 Reintegrar ${money(sharedUyu(e))} a ${esc(m.name)}</button>` : ''}`);

  $('#btnReimb')?.addEventListener('click', async () => { if (await setReimbursed(e.id, true)) close(); });

  $('#btnExclude')?.addEventListener('click', async () => {
    const reason = prompt('¿Por qué no imputa? (opcional)\nEj: "Es un gasto personal"', '');
    if (reason === null) return;
    const { error } = await sb.rpc('set_expense_excluded', { p_id: e.id, p_excluded: true, p_reason: reason });
    if (error) return toast(friendlyError(error), 'err');
    notify('excluded', e.id);
    close();
    toast('Marcado como "No imputa" 🚫');
    await refresh();
  });
  $('#btnInclude')?.addEventListener('click', async () => {
    const { error } = await sb.rpc('set_expense_excluded', { p_id: e.id, p_excluded: false, p_reason: null });
    if (error) return toast(friendlyError(error), 'err');
    close();
    toast('El gasto vuelve a imputar a la caja ✅');
    await refresh();
  });

  $('#btnEdit')?.addEventListener('click', () => { close(); go('nuevo?id=' + e.id); });
  $('#btnDel')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar este gasto?')) return;
    const { data, error } = await sb.from('expenses').delete().eq('id', e.id).select();
    if (error || !data?.length) return toast(friendlyError(error || 'permission'), 'err');
    if (e.receipt_path) await sb.storage.from('tickets').remove([e.receipt_path]);
    close();
    toast('Gasto borrado');
    await refresh();
  });

  if (e.receipt_path) {
    const url = await receiptUrl(e.receipt_path);
    const box = $('#receiptBox');
    if (box) box.innerHTML = url ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Ticket"></a>` : 'No se pudo cargar el ticket.';
  }
}

/* =====================================================================
   Nuevo / editar gasto
   ===================================================================== */
function defaultDate() {
  const t = todayStr();
  if (monthOf(t) === state.month) return t;
  return state.month < monthOf(t) ? `${state.month}-${String(daysInMonth(state.month)).padStart(2, '0')}` : `${state.month}-01`;
}

function viewExpenseForm(params) {
  const id = params.get('id');
  const e = id ? state.expenses.find((x) => x.id === id) : null;
  if (id && (!e || (e.created_by !== state.me.id && !state.me.is_admin))) { toast('No podés editar ese gasto', 'err'); go('movimientos'); return; }
  const othersExp = e && e.created_by !== state.me.id;

  const f = {
    amount: e?.amount ?? '', currency: e?.currency ?? 'UYU', rate: e && e.currency === 'USD' ? e.rate : '',
    category: e?.category ?? '', spent_on: e?.spent_on ?? defaultDate(), note: e?.note ?? '',
    scope: e?.scope ?? 'comun', personal: Number(e?.personal_amount) > 0 ? e.personal_amount : '',
    paid_from: e?.paid_from ?? 'caja', reimburse: e?.reimburse ?? 'reintegro',
  };
  let newPhoto = null;
  let removePhoto = false;
  // Categorías visibles; si se edita un gasto de una categoría oculta, se muestra igual
  const formCats = activeCats();
  if (f.category && !formCats.some((c) => c.id === f.category)) formCats.push(cat(f.category));

  view().innerHTML = `
    <form id="expForm" class="form">
      <h1>${e ? (othersExp ? `Editar gasto de ${esc(member(e.created_by).name)}` : 'Editar gasto') : 'Nuevo gasto'}</h1>
      <div class="amount-box">
        <div class="seg" id="curSeg">
          <button type="button" data-cur="UYU">$ UY</button>
          <button type="button" data-cur="USD">US$</button>
        </div>
        <input id="amount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0" required>
        <div id="usdBox" class="usd-box hidden">
          <label>1 US$ = <input id="rate" type="number" inputmode="decimal" step="0.01" min="0.01"> $UY</label>
          <small class="muted">Cotización del día (podés cambiarla)</small>
          <div id="uyuPreview" class="preview"></div>
        </div>
      </div>

      <label class="lbl">¿Es un gasto común o personal?</label>
      <div class="seg scope-seg" id="scopeSeg">
        <button type="button" data-scope="comun">🏠 Común</button>
        <button type="button" data-scope="personal">👤 Personal</button>
      </div>
      <small class="muted" id="scopeHelp"></small>
      ${e?.excluded ? `<div class="alert warn">🚫 La administradora marcó este gasto como <b>No imputa</b>${e.excluded_reason ? ': ' + esc(e.excluded_reason) : ''}.</div>` : ''}
      <div id="splitBox" class="split-box">
        <label class="check"><input type="checkbox" id="hasPersonal"> Hay algo personal en este ticket (ej: una cerveza)</label>
        <div id="personalRow" class="hidden">
          <input id="personal" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="¿Cuánto es lo personal?">
          <div id="splitPreview" class="split-preview"></div>
        </div>
      </div>
      <div id="paidBox" class="split-box">
        <label class="lbl">¿Con qué se pagó?</label>
        <div class="seg scope-seg" id="paidSeg">
          <button type="button" data-paid="caja">💰 Plata de la caja</button>
          <button type="button" data-paid="bolsillo">👛 ${othersExp ? 'Su' : 'Mi'} bolsillo</button>
        </div>
        <div id="reimbBox" class="hidden">
          <label class="lbl">¿Qué hacemos con esa plata?</label>
          <div class="seg scope-seg" id="reimbSeg">
            <button type="button" data-reimb="reintegro">🔁 Reintegrar</button>
            <button type="button" data-reimb="fondo">🎁 Queda para el fondo</button>
          </div>
          <small class="muted" id="reimbHelp"></small>
          ${e?.reimbursed_month ? `<div class="alert ok">✅ Ya se reintegraron ${money(reimbUyu(e))} el ${new Date(e.reimbursed_at).toLocaleDateString('es-UY')}.</div>` : ''}
        </div>
      </div>

      <label class="lbl">Categoría</label>
      <div class="cats" id="cats">
        ${formCats.map((c) => `<button type="button" class="cat ${f.category === c.id ? 'sel' : ''}" data-cat="${esc(c.id)}" style="--c:${c.color}"><span>${esc(c.icon)}</span>${esc(c.id)}</button>`).join('')}
      </div>

      <label class="lbl" for="spent_on">Fecha</label>
      <input id="spent_on" type="date" required>

      <label class="lbl" for="note">Detalle (opcional)</label>
      <input id="note" type="text" maxlength="120" placeholder="Ej: Supermercado, UTE, OSE…">

      <label class="lbl">Foto del ticket (opcional)</label>
      <div class="photo">
        <div class="photo-btns">
          <label class="btn ghost file-btn">📷 ${e?.receipt_path ? 'Nueva foto' : 'Sacar foto'}
            <input type="file" id="photoCam" accept="image/*" capture="environment" hidden>
          </label>
          <label class="btn ghost file-btn">🖼️ Galería
            <input type="file" id="photoGal" accept="image/*" hidden>
          </label>
        </div>
        ${e?.receipt_path ? '<button type="button" class="link danger" id="rmPhoto">Quitar foto actual</button>' : ''}
        <div id="photoPreview"></div>
      </div>

      <button class="btn primary block lg" id="saveBtn" type="submit">${e ? 'Guardar cambios' : 'Guardar gasto'}</button>
      <a class="btn ghost block" href="#/movimientos">Cancelar</a>
    </form>`;

  $('#amount').value = f.amount;
  $('#rate').value = f.rate;
  $('#spent_on').value = f.spent_on;
  $('#note').value = f.note;

  const updatePreview = () => {
    const a = Number($('#amount').value), r = Number($('#rate').value);
    $('#uyuPreview').textContent = f.currency === 'USD' && a > 0 && r > 0 ? `= ${money(round2(a * r))}` : '';
    updateSplit();
  };
  // Parte personal dentro de un ticket común
  const updateSplit = () => {
    const a = Number($('#amount').value), p = Number($('#personal').value);
    const r = f.currency === 'USD' ? Number($('#rate').value) || 0 : 1;
    const box = $('#splitPreview');
    if (!(a > 0) || !(p > 0)) { box.innerHTML = ''; return; }
    if (p >= a) { box.innerHTML = '<span class="neg">Lo personal tiene que ser menor que el total. Si es todo personal, elegí 👤 Personal.</span>'; return; }
    box.innerHTML = `🏠 A la caja: <b>${money(round2((a - p) * r))}</b> · 👤 Personal: <b>${money(round2(p * r))}</b>`;
  };
  const setScope = (sc) => {
    f.scope = sc;
    $$('#scopeSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.scope === sc));
    $('#splitBox').classList.toggle('hidden', sc !== 'comun');
    $('#paidBox').classList.toggle('hidden', sc !== 'comun');
    $('#scopeHelp').textContent = sc === 'comun'
      ? 'Entra en la caja común y lo ven todos.'
      : 'Solo para tu control: no toca la caja. Lo ven vos y la administradora.';
  };
  $('#scopeSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setScope(b.dataset.scope); };
  $('#hasPersonal').onchange = (ev) => {
    $('#personalRow').classList.toggle('hidden', !ev.target.checked);
    if (ev.target.checked) $('#personal').focus();
    updateSplit();
  };
  $('#personal').oninput = updateSplit;
  $('#personal').value = f.personal;
  $('#hasPersonal').checked = !!f.personal;
  $('#personalRow').classList.toggle('hidden', !f.personal);
  setScope(f.scope);
  const setPaid = (p) => {
    f.paid_from = p;
    $$('#paidSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.paid === p));
    $('#reimbBox').classList.toggle('hidden', p !== 'bolsillo');
  };
  const setReimb = (r) => {
    f.reimburse = r;
    $$('#reimbSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.reimb === r));
    $('#reimbHelp').textContent = r === 'reintegro'
      ? 'La administradora te lo devuelve desde la caja. Hasta entonces queda a tu favor en el balance.'
      : 'No se devuelve: cuenta como un aporte tuyo a la caja (queda a tu favor en el balance).';
  };
  $('#paidSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setPaid(b.dataset.paid); };
  $('#reimbSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setReimb(b.dataset.reimb); };
  setPaid(f.paid_from);
  setReimb(f.reimburse);
  const setCurrency = async (cur) => {
    f.currency = cur;
    $$('#curSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.cur === cur));
    $('#usdBox').classList.toggle('hidden', cur !== 'USD');
    if (cur === 'USD' && !$('#rate').value) { $('#rate').value = await getUsdRate(); }
    updatePreview();
  };
  $('#curSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setCurrency(b.dataset.cur); };
  setCurrency(f.currency);
  $('#amount').oninput = updatePreview;
  $('#rate').oninput = updatePreview;

  $('#cats').onclick = (ev) => {
    const b = ev.target.closest('.cat');
    if (!b) return;
    f.category = b.dataset.cat;
    $$('#cats .cat').forEach((x) => x.classList.toggle('sel', x === b));
  };

  const onPhoto = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      newPhoto = await compressImage(file);
      removePhoto = false;
      $('#photoPreview').innerHTML = `<img src="${URL.createObjectURL(newPhoto)}" alt="Ticket">`;
    } catch {
      toast('No se pudo leer la foto', 'err');
    }
    ev.target.value = ''; // permite volver a elegir la misma foto
  };
  $('#photoCam').onchange = onPhoto;
  $('#photoGal').onchange = onPhoto;
  $('#rmPhoto')?.addEventListener('click', (ev) => {
    removePhoto = true; newPhoto = null;
    $('#photoPreview').innerHTML = '<p class="muted small">La foto se quitará al guardar.</p>';
    ev.target.remove();
  });

  $('#expForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const amount = Number($('#amount').value);
    const rate = f.currency === 'USD' ? Number($('#rate').value) : 1;
    const spent_on = $('#spent_on').value;
    if (!(amount > 0)) return toast('Ingresá un monto válido', 'err');
    if (!(rate > 0)) return toast('Ingresá la cotización del dólar', 'err');
    if (!f.category) return toast('Elegí una categoría', 'err');
    if (!spent_on) return toast('Elegí la fecha', 'err');
    const personal_amount = f.scope === 'comun' && $('#hasPersonal').checked ? round2(Number($('#personal').value) || 0) : 0;
    if (personal_amount < 0) return toast('La parte personal no puede ser negativa', 'err');
    if (personal_amount >= amount) return toast('Lo personal tiene que ser menor que el total. Si es todo personal, elegí 👤 Personal.', 'err');
    if (f.scope === 'comun' && !isOpen(monthOf(spent_on))) return toast('Ese mes está cerrado 🔒 (podés cargarlo como 👤 Personal)', 'err');

    const btn = $('#saveBtn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    let uploaded = null;
    try {
      let receipt_path = e?.receipt_path || null;
      let oldToDelete = null;
      if (newPhoto) {
        uploaded = `${state.me.id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await sb.storage.from('tickets').upload(uploaded, newPhoto, { contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        if (receipt_path) oldToDelete = receipt_path;
        receipt_path = uploaded;
      } else if (removePhoto && receipt_path) {
        oldToDelete = receipt_path;
        receipt_path = null;
      }
      const payload = { amount, currency: f.currency, rate, category: f.category, spent_on,
                        note: $('#note').value.trim() || null, receipt_path, scope: f.scope, personal_amount,
                        paid_from: f.scope === 'comun' ? f.paid_from : 'caja',
                        reimburse: f.scope === 'comun' && f.paid_from === 'bolsillo' ? f.reimburse : 'fondo' };
      const q = e ? sb.from('expenses').update(payload).eq('id', e.id).select()
                  : sb.from('expenses').insert(payload).select();
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) throw new Error('permission');
      if (oldToDelete) await sb.storage.from('tickets').remove([oldToDelete]);
      if (!e && f.scope === 'comun') notify('expense', data[0].id);
      toast(e ? 'Gasto actualizado ✅' : 'Gasto guardado ✅');
      state.month = monthOf(spent_on);
      await loadData();
      go(f.scope === 'personal' ? 'movimientos?vista=mios' : 'movimientos');
    } catch (err) {
      if (uploaded) await sb.storage.from('tickets').remove([uploaded]);
      toast(friendlyError(err), 'err');
      btn.disabled = false;
      btn.textContent = e ? 'Guardar cambios' : 'Guardar gasto';
    }
  };
}

/* =====================================================================
   Movimientos
   ===================================================================== */
function movTabs(mine, label = 'Mis gastos') {
  return `<div class="seg tabs">
    <a href="#/movimientos" class="${mine ? '' : 'sel'}">🏠 Comunes</a>
    <a href="#/movimientos?vista=mios" class="${mine ? 'sel' : ''}">👤 ${label}</a>
  </div>`;
}

function viewMovements(params) {
  if (params?.get('vista') === 'mios') { viewMine(params); return; }
  const s = monthStats(state.month);
  const { member: fm, category: fc } = state.filters;
  const list = s.exps.filter((e) => (fm === 'all' || e.created_by === fm) && (fc === 'all' || e.category === fc)).sort(byDateDesc);
  const groups = {};
  list.forEach((e) => (groups[e.spent_on] ||= []).push(e));

  view().innerHTML = `
    <h1>Gastos de ${monthLabel(state.month, { month: 'long' })}</h1>
    ${movTabs(false)}
    <div class="filters">
      <div class="chips" id="fMember">
        <button data-v="all" class="${fm === 'all' ? 'sel' : ''}">Todos</button>
        ${state.members.map((m) => `<button data-v="${m.id}" class="${fm === m.id ? 'sel' : ''}" style="--c:${m.color}">${esc(m.name)}</button>`).join('')}
      </div>
      <select id="fCat">
        <option value="all">Todas las categorías</option>
        ${allCats().map((c) => `<option value="${esc(c.id)}" ${fc === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.id)}</option>`).join('')}
      </select>
    </div>
    <div class="total-line">${list.length} gasto${list.length === 1 ? '' : 's'} · a la caja <b>${money(sum(list, sharedUyu))}</b></div>
    ${list.length
      ? Object.entries(groups).map(([d, arr]) => `
          <div class="day">
            <div class="day-h"><span>${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>${money(sum(arr, sharedUyu))}</span></div>
            <ul class="list">${arr.map((e) => expenseItem(e)).join('')}</ul>
          </div>`).join('')
      : emptyMsg('No hay gastos con estos filtros.')}`;

  $('#fMember').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; state.filters.member = b.dataset.v; render(); };
  $('#fCat').onchange = (ev) => { state.filters.category = ev.target.value; render(); };
  bindExpenseItems();
}

/** Control personal: lo personal de cada uno + lo que cargó en comunes + lo que aportó. */
function viewMine(params) {
  const admin = state.me.is_admin;
  const who = admin && params.get('m') ? params.get('m') : state.me.id;
  const wm = member(who);
  const self = who === state.me.id;
  const list = state.expenses.filter((e) => e.created_by === who && monthOf(e.spent_on) === state.month).sort(byDateDesc);
  const personal = sum(list, personalUyu);
  const loadedCommon = sum(list, sharedUyu);
  const pocketNet = sum(list, pocketCredit)
    - sum(state.expenses.filter((e) => e.created_by === who && e.reimbursed_month === state.month), reimbUyu);
  const pendingMine = sum(state.expenses.filter((e) => e.created_by === who && isPendingReimb(e)), sharedUyu);
  const aportes = sum(state.contributions.filter((c) => c.member_id === who && c.month_id === state.month), (c) => c.amount);
  const byCat = Object.entries(groupSum(list, (e) => e.category, personalUyu)).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...byCat.map((x) => x[1]));

  view().innerHTML = `
    <h1>${self ? 'Mis gastos' : 'Gastos de ' + esc(wm.name)} · ${monthLabel(state.month, { month: 'long' })}</h1>
    ${movTabs(true)}
    ${admin ? `<div class="chips" id="fWho">
      ${state.members.map((m) => `<button data-v="${m.id}" class="${who === m.id ? 'sel' : ''}" style="--c:${m.color}">${esc(m.name)}</button>`).join('')}
    </div>` : ''}
    <div class="kpis">
      <div class="kpi"><small>👤 Gastos personales</small><b>${money(personal)}</b></div>
      <div class="kpi"><small>💵 ${self ? 'Aporté' : 'Aportó'} a la caja</small><b>${money(aportes)}</b></div>
      <div class="kpi"><small>👛 Comunes ${self ? 'pagados de mi' : 'pagados de su'} bolsillo</small><b>${money(pocketNet)}</b>${pendingMine ? `<small>🔁 pendiente ${money(pendingMine)}</small>` : ''}</div>
      <div class="kpi"><small>Total de ${self ? 'mi' : 'su'} bolsillo</small><b>${money(personal + aportes + pocketNet)}</b></div>
    </div>
    <p class="muted small">"Total de ${self ? 'mi' : 'su'} bolsillo" = gastos personales + aportes a la caja + gastos comunes pagados de bolsillo (menos lo reintegrado).
      ${loadedCommon ? `En total ${self ? 'cargaste' : 'cargó'} ${money(loadedCommon)} en gastos comunes.` : ''}</p>
    <section class="card">
      <h2>Personales por categoría</h2>
      ${byCat.length
        ? byCat.map(([k, v]) => `<div class="bar-row"><span>${esc(cat(k).icon)} ${esc(k)}</span><div class="bar"><i style="width:${(v / maxCat) * 100}%;background:${cat(k).color}"></i></div><b>${money(v)}</b></div>`).join('')
        : emptyMsg('Sin gastos personales este mes.')}
    </section>
    <section class="card">
      <h2>Todo lo que ${self ? 'cargaste' : 'cargó'}</h2>
      ${list.length ? `<ul class="list">${list.map((e) => expenseItem(e, 'mios')).join('')}</ul>` : emptyMsg(self ? 'Tocá ＋ y elegí 👤 Personal para controlar tus gastos.' : 'No cargó gastos este mes.')}
    </section>
    ${self ? '' : '<p class="muted small center">Los gastos personales solo los ven su dueño y la administradora.</p>'}`;

  $('#fWho')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) go('movimientos?vista=mios' + (b.dataset.v === state.me.id ? '' : '&m=' + b.dataset.v));
  });
  bindExpenseItems();
}

/* =====================================================================
   Balance y caja común
   ===================================================================== */
function viewBalance() {
  const s = monthStats(state.month);
  const admin = state.me.is_admin;
  const nextLabel = monthLabel(shiftMonth(s.m, 1), { month: 'long' });

  let status;
  const ms = memberStats(s);
  const debtors = ms.filter((x) => x.saldo < -0.5);
  if (s.balance < -0.5) {
    status = `<div class="alert warn">Faltan <b>${money(-s.balance)}</b> en la caja para cubrir los gastos.<br>
      Cada uno repone según su balance individual${debtors.length ? ': ' + debtors.map((x) => `<b>${esc(x.mb.name)} ${money(-x.saldo)}</b>`).join(', ') : ''}.
      <br><small>Se registra como <i>"Ajuste fin de mes"</i>.</small></div>`;
  } else if (s.balance > 0.5) {
    status = `<div class="alert ok">Sobran <b>${money(s.balance)}</b> → pasan a ${nextLabel}. 🎉
      ${debtors.length ? `<br><small>Igual hay quien quedó en contra: ${debtors.map((x) => `${esc(x.mb.name)} ${money(-x.saldo)}`).join(', ')}.</small>` : ''}</div>`;
  } else {
    status = '<div class="alert ok">La caja está exactamente en cero. ✅</div>';
  }

  const perMember = ms.map((x) => {
    const showPersonal = x.mb.id === state.me.id || admin;
    const quotaTxt = s.quota > 0 ? (x.cuota >= s.quota ? ' ✅' : ` · cuota ⏳ falta ${money(s.quota - x.cuota)}`) : '';
    const right = x.saldo < -0.5
      ? `<b class="neg">Debe ${money(-x.saldo)}</b><small>a reponer</small>`
      : x.saldo > 0.5 ? `<b class="pos">A favor ${money(x.saldo)}</b><small>pasa al mes siguiente</small>` : '<b class="pos">Al día ✅</b>';
    return `<li class="item">
      <div class="avatar sm" style="background:${x.mb.color}">${initials(x.mb.name)}</div>
      <div class="info"><b>${esc(x.mb.name)}</b>
        <small class="lines">
          <span>Aportó ${money(x.cuota + x.ajuste)}${x.ajuste ? ` (cuota ${money(x.cuota)} + ajuste ${money(x.ajuste)})` : ''}${quotaTxt}</span>
          <span>Su parte de los gastos comunes: ${money(x.fair)}</span>
          ${x.pocket ? `<span>👛 Pagó comunes de su bolsillo: +${money(x.pocket)}</span>` : ''}
          ${x.reimb ? `<span>💸 Se le reintegró: −${money(x.reimb)}</span>` : ''}
          ${x.pendingR ? `<span>🔁 Reintegro pendiente: ${money(x.pendingR)}</span>` : ''}
          ${Math.abs(x.prev) > 0.5 ? `<span>Saldo de meses anteriores: ${signed(x.prev)}</span>` : ''}
          ${x.inc ? `<span>Su parte de otros ingresos: +${money(x.inc)}</span>` : ''}
          ${showPersonal && x.personal ? `<span>👤 Gastos personales (aparte): ${money(x.personal)}</span>` : ''}
        </small></div>
      <div class="amt">${right}</div>
    </li>`;
  }).join('');

  view().innerHTML = `
    <h1>Balance de ${monthLabel(s.m, { month: 'long' })}</h1>

    <section class="card">
      <div class="card-title"><h2>Cuota por persona</h2>${admin && !s.closed ? `<button class="link" id="editQuota">${s.row ? 'Editar' : 'Definir'}</button>` : ''}</div>
      <div class="big">${s.row ? money(s.quota) : '<span class="muted">Sin definir</span>'}</div>
      <small class="muted">Total esperado: ${money(s.quota * FAMILY_SIZE)} entre ${FAMILY_SIZE} personas, partes iguales.</small>
    </section>

    <section class="card">
      <h2>Resumen de la caja</h2>
      <table class="tbl">
        <tr><td>Saldo del mes anterior</td><td>${money(s.opening)}</td></tr>
        <tr><td>+ Aportes del mes</td><td>${money(s.contributed)}</td></tr>
        ${s.pocket ? `<tr><td>+ Gastos comunes pagados de bolsillo</td><td>${money(s.pocket)}</td></tr>` : ''}
        <tr><td>− Gastos comunes del mes</td><td>${money(s.spent)}</td></tr>
        ${s.reimbs ? `<tr><td>− Reintegros pagados</td><td>${money(s.reimbs)}</td></tr>` : ''}
        <tr class="tot"><td>= Saldo actual</td><td class="${s.balance < 0 ? 'neg' : 'pos'}">${money(s.balance)}</td></tr>
      </table>
      ${s.pocket ? '<p class="muted small">Lo pagado de bolsillo cuenta como gasto común y, a la vez, como aporte de quien lo pagó.</p>' : ''}
      ${s.pending ? `<div class="alert info">🔁 De este saldo, <b>${money(s.pending)}</b> están pendientes de reintegrar.
        Disponible real: <b>${money(s.balance - s.pending)}</b>.</div>` : ''}
      ${status}
    </section>

    <section class="card">
      <h2>Balance por persona</h2>
      <p class="muted small">Cada uno paga 1/${FAMILY_SIZE} de los gastos comunes (${money(s.spent / FAMILY_SIZE)} este mes). Lo que aportó de más queda a su favor; lo que falta, lo repone.</p>
      <ul class="list">${perMember}</ul>
      ${state.members.length < FAMILY_SIZE ? `<p class="muted small">Faltan ${FAMILY_SIZE - state.members.length} integrante(s) por crear su cuenta.</p>` : ''}
      ${!s.closed && s.row ? '<button class="btn primary block" id="addContrib">💵 Registrar aporte</button>' : ''}
      ${!s.row ? '<p class="muted small">Para registrar aportes primero hay que definir la cuota del mes.</p>' : ''}
    </section>

    ${s.pendingList.length || s.reimbList.length ? `<section class="card">
      <h2>🔁 Reintegros</h2>
      <ul class="list">
        ${s.pendingList.map((e) => `<li class="item">
          <div class="ico">👛</div>
          <div class="info"><b>${esc(member(e.created_by).name)} · ${esc(e.note || e.category)}</b>
            <small>${fmtDate(e.spent_on)} · pendiente</small></div>
          <div class="amt"><b>${money(sharedUyu(e))}</b>
            ${admin ? `<button class="link" data-reimb="${e.id}">💸 Reintegrar</button>` : ''}</div>
        </li>`).join('')}
        ${s.reimbList.map((e) => `<li class="item">
          <div class="ico">✅</div>
          <div class="info"><b>${esc(member(e.created_by).name)} · ${esc(e.note || e.category)}</b>
            <small>Reintegrado el ${new Date(e.reimbursed_at).toLocaleDateString('es-UY')}</small></div>
          <div class="amt"><b>${money(reimbUyu(e))}</b>
            ${admin && !s.closed ? `<button class="link danger" data-unreimb="${e.id}">Deshacer</button>` : ''}</div>
        </li>`).join('')}
      </ul>
      ${admin && s.pendingList.length ? '<p class="muted small">Tocá "Reintegrar" cuando le devuelvas la plata desde la caja. Se registra en el mes actual.</p>' : ''}
    </section>` : ''}

    <section class="card">
      <h2>Movimientos de la caja</h2>
      ${s.conts.length
        ? `<ul class="list">${[...s.conts].reverse().map((c) => `
            <li class="item">
              <div class="ico">${KIND_ICON[c.kind]}</div>
              <div class="info"><b>${esc(member(c.member_id).name)} · ${KIND[c.kind]}</b>
                <small>${new Date(c.created_at).toLocaleDateString('es-UY')}${c.note ? ' · ' + esc(c.note) : ''}</small></div>
              <div class="amt"><b>${money(c.amount)}</b>
                ${admin && !s.closed ? `<button class="link" data-editc="${c.id}">Editar</button>` : ''}
                ${(c.created_by === state.me.id || admin) && !s.closed ? `<button class="link danger" data-delc="${c.id}">Borrar</button>` : ''}</div>
            </li>`).join('')}</ul>`
        : emptyMsg('Sin aportes todavía.')}
    </section>

    ${admin ? `<section class="card">
      <h2>Cierre del mes</h2>
      ${s.closed
        ? `<p>🔒 Cerrado el ${new Date(s.row.closed_at).toLocaleDateString('es-UY')}.</p><button class="btn ghost block" id="reopen">Reabrir mes</button>`
        : `<p class="muted small">Al cerrar, nadie podrá agregar, editar ni borrar gastos o aportes de este mes. El saldo pasa a ${nextLabel}.</p>
           <button class="btn primary block" id="closeMonth" ${s.row ? '' : 'disabled'}>🔒 Cerrar ${monthLabel(s.m, { month: 'long' })}</button>`}
    </section>` : ''}`;

  $('#editQuota')?.addEventListener('click', () => editQuota(s));
  $('#addContrib')?.addEventListener('click', () => addContribution(s));
  $$('[data-editc]').forEach((b) => (b.onclick = () => addContribution(s, s.conts.find((c) => c.id === b.dataset.editc))));
  $$('[data-reimb]').forEach((b) => (b.onclick = () => setReimbursed(b.dataset.reimb, true)));
  $$('[data-unreimb]').forEach((b) => (b.onclick = () => setReimbursed(b.dataset.unreimb, false)));
  $$('[data-delc]').forEach((b) => (b.onclick = async () => {
    if (!confirm('¿Borrar este aporte?')) return;
    const { data, error } = await sb.from('contributions').delete().eq('id', b.dataset.delc).select();
    if (error || !data?.length) return toast(friendlyError(error || 'permission'), 'err');
    toast('Aporte borrado');
    await refresh();
  }));
  $('#closeMonth')?.addEventListener('click', async () => {
    const msg = s.balance < 0
      ? `Todavía faltan ${money(-s.balance)}. Si cerrás igual, ese faltante pasa como saldo negativo a ${nextLabel}. ¿Cerrar?`
      : `¿Cerrar ${monthLabel(s.m)}? El saldo de ${money(s.balance)} pasa a ${nextLabel}.`;
    if (!confirm(msg)) return;
    const { error } = await sb.from('months').update({ closed: true, closed_at: new Date().toISOString() }).eq('id', s.m);
    if (error) return toast(friendlyError(error), 'err');
    notify('closed', s.m, { balance: round2(s.balance) });
    toast('Mes cerrado 🔒');
    await refresh();
  });
  $('#reopen')?.addEventListener('click', async () => {
    if (!confirm('¿Reabrir el mes para poder modificarlo?')) return;
    const { error } = await sb.from('months').update({ closed: false, closed_at: null }).eq('id', s.m);
    if (error) return toast(friendlyError(error), 'err');
    toast('Mes reabierto');
    await refresh();
  });
}

/** Registrar (o deshacer) que la administradora devolvió desde la caja un gasto pagado de bolsillo. */
async function setReimbursed(id, done) {
  const e = state.expenses.find((x) => x.id === id);
  if (!e) return false;
  const who = member(e.created_by).name;
  const ok = done
    ? confirm(`¿Le devolviste ${money(sharedUyu(e))} a ${who} desde la caja?\nSe registra como salida de la caja en ${monthLabel(monthOf(todayStr()))}.`)
    : confirm(`¿Deshacer el reintegro de ${money(reimbUyu(e))} a ${who}?`);
  if (!ok) return false;
  const { error } = await sb.rpc('set_expense_reimbursed', { p_id: id, p_done: done });
  if (error) { toast(friendlyError(error), 'err'); return false; }
  if (done) notify('reimbursed', id);
  toast(done ? 'Reintegro registrado 💸' : 'Reintegro deshecho');
  await refresh();
  return true;
}

function editQuota(s) {
  const suggestion = s.row ? s.quota : Number(state.months.filter((x) => x.id < s.m).slice(-1)[0]?.quota || 0);
  const close = openModal(`<h2>Cuota de ${monthLabel(s.m)}</h2>
    <p class="muted">Monto que aporta <b>cada uno</b> de los ${FAMILY_SIZE} a la caja común.</p>
    <form id="qForm" class="form">
      <input id="qAmount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Ej: 10000" required>
      <button class="btn primary block">Guardar</button>
    </form>`);
  $('#qAmount').value = suggestion || '';
  $('#qForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const quota = Number($('#qAmount').value);
    if (!(quota >= 0)) return toast('Monto inválido', 'err');
    const { error } = await sb.from('months').upsert({ id: s.m, quota });
    if (error) return toast(friendlyError(error), 'err');
    close();
    toast('Cuota guardada ✅');
    await refresh();
  };
}

/** Registrar un aporte nuevo, o editar uno existente (c) si sos la administradora. */
function addContribution(s, c = null) {
  if (!s.row) { toast('Primero hay que definir la cuota del mes', 'err'); return; }
  const admin = state.me.is_admin;
  if (c && !admin) return;
  const paid = (id, kind) => sum(s.conts.filter((x) => x.member_id === id && x.kind === kind && x.id !== c?.id), (x) => x.amount);
  const saldoOf = (id) => memberStats(s).find((x) => x.mb.id === id)?.saldo ?? 0;
  const who = admin ? state.members : [state.me];
  const sel = c?.member_id || state.me.id;
  const defKind = c?.kind || (s.balance < 0 && saldoOf(sel) < 0 ? 'ajuste' : 'cuota');
  const close = openModal(`<h2>${c ? '✏️ Editar aporte' : '💵 Registrar aporte'}</h2>
    <form id="cForm" class="form">
      <label class="lbl">¿Quién aporta?</label>
      <select id="cMember" ${admin ? '' : 'disabled'}>
        ${who.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select>
      <label class="lbl">Tipo</label>
      <select id="cKind">
        <option value="cuota" ${defKind === 'cuota' ? 'selected' : ''}>💵 Cuota mensual</option>
        <option value="ajuste" ${defKind === 'ajuste' ? 'selected' : ''}>⚖️ Ajuste fin de mes</option>
        ${admin ? `<option value="inicial" ${defKind === 'inicial' ? 'selected' : ''}>🏦 Saldo inicial / otro ingreso (se reparte entre todos)</option>` : ''}
      </select>
      <label class="lbl">Monto ($UY)</label>
      <input id="cAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required>
      <small class="muted" id="cHint"></small>
      <label class="lbl">Nota (opcional)</label>
      <input id="cNote" type="text" maxlength="80">
      <button class="btn primary block">${c ? 'Guardar cambios' : 'Guardar aporte'}</button>
    </form>`);
  const suggest = () => {
    const k = $('#cKind').value, id = $('#cMember').value;
    let v = '', hint = '';
    if (k === 'cuota') v = Math.max(s.quota - paid(id, 'cuota'), 0) || s.quota || '';
    if (k === 'ajuste') {
      const debe = Math.max(round2(-saldoOf(id)), 0);
      v = debe || '';
      hint = debe ? `Según su balance individual debe reponer ${money(debe)}.` : 'Según su balance individual no debe nada este mes.';
    }
    if (k === 'inicial') hint = `Cuenta como ingreso de todos: a cada uno le suma 1/${FAMILY_SIZE} en su balance.`;
    $('#cAmount').value = v;
    $('#cHint').textContent = hint;
  };
  $('#cKind').onchange = suggest;
  $('#cMember').onchange = suggest;
  if (c) {
    $('#cAmount').value = c.amount;
    $('#cNote').value = c.note || '';
  } else {
    suggest();
  }
  $('#cForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const amount = Number($('#cAmount').value);
    if (!(amount > 0)) return toast('Ingresá un monto válido', 'err');
    const row = { member_id: $('#cMember').value, kind: $('#cKind').value, amount, note: $('#cNote').value.trim() || null };
    if (c) {
      const { data, error } = await sb.from('contributions').update(row).eq('id', c.id).select();
      if (error) return toast(friendlyError(error), 'err');
      if (!data?.length) return toast('No se pudo editar (¿falta ejecutar v3_admin_edita.sql?)', 'err');
      close();
      toast('Aporte actualizado ✅');
    } else {
      const { data: newC, error } = await sb.from('contributions').insert({ month_id: s.m, ...row }).select();
      if (error) return toast(friendlyError(error), 'err');
      if (newC?.[0]) notify('contribution', newC[0].id);
      close();
      toast('Aporte registrado 💵');
    }
    await refresh();
  };
}

/* =====================================================================
   Análisis
   ===================================================================== */
function viewAnalysis() {
  const m = state.month;
  const s = monthStats(m);
  const prev = monthStats(shiftMonth(m, -1));
  // Solo gastos comunes y lo que realmente se imputa a la caja
  const commonExps = state.expenses.filter(isCommon);
  const monthTotal = (x, catId) => sum(commonExps.filter((e) => monthOf(e.spent_on) === x && (!catId || e.category === catId)), sharedUyu);

  const last6 = Array.from({ length: 6 }, (_, i) => shiftMonth(m, i - 5));
  const totals6 = last6.map((x) => monthTotal(x));
  const prev3 = [1, 2, 3].map((i) => shiftMonth(m, -i)).filter((x) => commonExps.some((e) => monthOf(e.spent_on) === x));
  const avg3 = (catId) => (prev3.length ? sum(prev3, (x) => monthTotal(x, catId)) / prev3.length : 0);

  const catNow = groupSum(s.exps, (e) => e.category, sharedUyu);
  const isCurrent = m === monthOf(todayStr());
  const dim = daysInMonth(m);
  const elapsed = isCurrent ? new Date().getDate() : dim;
  const perDay = s.spent / elapsed;
  const projection = isCurrent ? perDay * dim : s.spent;
  const diffPct = prev.spent > 0 ? ((s.spent - prev.spent) / prev.spent) * 100 : null;
  const byMember = groupSum(s.exps.filter((e) => sharedUyu(e) > 0), (e) => e.created_by, sharedUyu);
  const biggest = [...s.exps].filter((e) => sharedUyu(e) > 0).sort((a, b) => sharedUyu(b) - sharedUyu(a))[0];
  const usdTotal = round2(sum(s.exps.filter((e) => e.currency === 'USD'), (e) => sharedUyu(e) / Number(e.rate || 1)));

  // Alertas y observaciones
  const notes = [];
  allCats().forEach((c) => {
    const now = catNow[c.id] || 0, avg = avg3(c.id);
    if (avg > 0 && now > avg * 1.2) notes.push({ t: 'warn', h: `${esc(c.icon)} <b>${esc(c.id)}</b> está ${Math.round((now / avg - 1) * 100)}% por encima de su promedio (${money(avg)}).` });
    else if (!isCurrent && avg > 0 && now < avg * 0.8) notes.push({ t: 'ok', h: `👏 <b>${esc(c.id)}</b> bajó ${Math.round((1 - now / avg) * 100)}% respecto a su promedio.` });
  });
  const available = s.opening + s.quota * FAMILY_SIZE;
  if (isCurrent && s.quota > 0 && projection > available) {
    notes.push({ t: 'warn', h: `📈 A este ritmo el mes cerraría en <b>${money(projection)}</b> y la caja no alcanzaría: faltarían unos <b>${money(projection - available)}</b> (≈ ${money((projection - available) / FAMILY_SIZE)} c/u).` });
  } else if (isCurrent && s.quota > 0 && s.spent > 0) {
    notes.push({ t: 'ok', h: `👍 A este ritmo la caja alcanza: sobrarían unos <b>${money(available - projection)}</b>.` });
  }
  if (biggest) notes.push({ t: 'info', h: `💸 Gasto más grande: <b>${money(sharedUyu(biggest))}</b> en ${esc(biggest.category)}${biggest.note ? ` (${esc(biggest.note)})` : ''}.` });
  if (usdTotal) notes.push({ t: 'info', h: `💵 Este mes se gastaron <b>${fmtUSD.format(usdTotal)}</b> en dólares.` });
  const excl = s.exps.filter((e) => e.excluded);
  if (excl.length) notes.push({ t: 'info', h: `🚫 ${excl.length} gasto${excl.length === 1 ? '' : 's'} marcado${excl.length === 1 ? '' : 's'} como "No imputa" (${money(sum(excl, (e) => e.amount_uyu))}), no se cuenta${excl.length === 1 ? '' : 'n'}.` });

  const maxMember = Math.max(1, ...Object.values(byMember));

  view().innerHTML = `
    <h1>Análisis de ${monthLabel(m, { month: 'long' })}</h1>
    <div class="kpis">
      <div class="kpi"><small>Total del mes</small><b>${money(s.spent)}</b></div>
      <div class="kpi"><small>vs. mes anterior</small><b class="${diffPct == null ? '' : diffPct > 0 ? 'neg' : 'pos'}">${diffPct == null ? '—' : `${diffPct > 0 ? '▲' : '▼'} ${Math.abs(diffPct).toFixed(0)}%`}</b></div>
      <div class="kpi"><small>Promedio por día</small><b>${money(round2(perDay))}</b></div>
      <div class="kpi"><small>${isCurrent ? 'Proyección fin de mes' : 'Por persona'}</small><b>${money(round2(isCurrent ? projection : s.spent / FAMILY_SIZE))}</b></div>
    </div>

    ${notes.length ? `<section class="card"><h2>Observaciones</h2>${notes.map((n) => `<div class="alert ${n.t}">${n.h}</div>`).join('')}</section>` : ''}

    <section class="card">
      <h2>Gasto por categoría</h2>
      ${s.exps.length ? '<div class="chart-box"><canvas id="chCat"></canvas></div>' : emptyMsg('Sin gastos este mes.')}
    </section>

    <section class="card">
      <h2>Últimos 6 meses</h2>
      <div class="chart-box"><canvas id="chMonths"></canvas></div>
    </section>

    <section class="card">
      <h2>Comparación por categoría</h2>
      <table class="tbl cmp">
        <tr><th>Categoría</th><th>Este mes</th><th>Anterior</th><th>Prom. 3m</th></tr>
        ${allCats().map((c) => {
          const now = catNow[c.id] || 0, p = monthTotal(shiftMonth(m, -1), c.id), a = avg3(c.id);
          if (!now && !p && !a) return '';
          const arrow = p ? (now > p ? '<span class="neg">▲</span>' : now < p ? '<span class="pos">▼</span>' : '') : '';
          return `<tr><td>${esc(c.icon)} ${esc(c.id)}</td><td><b>${money(now)}</b> ${arrow}</td><td>${money(p)}</td><td>${money(round2(a))}</td></tr>`;
        }).join('')}
      </table>
    </section>

    <section class="card">
      <h2>¿Quién registró los gastos?</h2>
      ${Object.keys(byMember).length
        ? Object.entries(byMember).sort((a, b) => b[1] - a[1]).map(([id, v]) => {
            const mm = member(id);
            return `<div class="bar-row"><span><span class="dot" style="background:${mm.color}"></span>${esc(mm.name)}</span><div class="bar"><i style="width:${(v / maxMember) * 100}%;background:${mm.color}"></i></div><b>${money(v)}</b></div>`;
          }).join('')
        : emptyMsg('Sin datos.')}
    </section>`;

  const catEntries = Object.keys(catNow).filter((k) => catNow[k] > 0).map(cat);
  makeChart('chCat', {
    type: 'doughnut',
    data: { labels: catEntries.map((c) => `${c.icon} ${c.id}`),
            datasets: [{ data: catEntries.map((c) => round2(catNow[c.id])), backgroundColor: catEntries.map((c) => c.color), borderWidth: 2, borderColor: '#fff' }] },
    options: { maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
                 tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.raw)} (${Math.round((ctx.raw / s.spent) * 100)}%)` } } } },
  });
  makeChart('chMonths', {
    type: 'bar',
    data: { labels: last6.map((x) => monthLabel(x, { month: 'short' })),
            datasets: [{ data: totals6.map(round2), backgroundColor: last6.map((x) => (x === m ? '#E07A5F' : '#174E5A99')), borderRadius: 8 }] },
    options: { maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.raw)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => (v >= 1000 ? `${v / 1000}k` : v) } }, x: { grid: { display: false } } } },
  });
}

/* =====================================================================
   Familia y perfil
   ===================================================================== */
function viewFamily() {
  const me = state.me;
  const admin = me.is_admin;
  view().innerHTML = `
    <h1>Familia Labaut 🏠❤️</h1>

    <section class="card">
      <h2>Mi perfil</h2>
      <form id="profForm" class="form">
        <label class="lbl">Nombre</label>
        <input id="pName" type="text" maxlength="30" required>
        <label class="lbl">Mi color</label>
        <div class="palette" id="palette">
          ${PALETTE.map((c) => `<button type="button" data-color="${c}" class="${c === me.color ? 'sel' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}
        </div>
        <button class="btn primary block">Guardar perfil</button>
      </form>
      <p class="muted small">${esc(me.email)}${admin ? ' · Administradora' : ''}</p>
    </section>

    <section class="card">
      <h2>Integrantes</h2>
      <ul class="list">
        ${state.members.map((m) => `<li class="item"><div class="avatar sm" style="background:${m.color}">${initials(m.name)}</div>
          <div class="info"><b>${esc(m.name)}${m.id === me.id ? ' (vos)' : ''}</b><small>${esc(m.email)}${m.is_admin ? ' · Admin' : ''}</small></div></li>`).join('')}
      </ul>
    </section>

    ${admin ? `<section class="card">
      <div class="card-title"><h2>Categorías</h2><button class="link" id="addCat">➕ Nueva</button></div>
      <p class="muted small">Las ocultas no aparecen al cargar gastos, pero sus gastos viejos se mantienen.</p>
      <ul class="list">
        ${allCats().map((c, i, arr) => {
          const n = state.expenses.filter((e) => e.category === c.id).length;
          return `<li class="item">
            <div class="ico" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</div>
            <div class="info"><b>${esc(c.id)}</b><small>${n} gasto${n === 1 ? '' : 's'}${c.active ? '' : ' · 🙈 oculta'}</small></div>
            <div class="order">
              <button class="x" data-move-cat="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
              <button class="x" data-move-cat="${i}" data-dir="1" ${i === arr.length - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
            </div>
            <button class="link" data-edit-cat="${i}">Editar</button>
          </li>`;
        }).join('')}
      </ul>
    </section>` : ''}

    ${admin ? `<section class="card">
      <h2>Emails autorizados</h2>
      <p class="muted small">Solo estos emails pueden crear una cuenta en la app.</p>
      <ul class="list">
        ${state.allowed.map((a) => `<li class="item"><div class="avatar sm" style="background:${a.color}">${initials(a.name)}</div>
          <div class="info"><b>${esc(a.name)}</b><small>${esc(a.email)}${a.is_admin ? ' · Admin' : ''}${state.members.some((m) => m.email === a.email) ? ' · ✅ ya tiene cuenta' : ' · ⏳ sin cuenta aún'}</small></div>
          ${a.email !== me.email ? `<button class="link danger" data-rm-email="${esc(a.email)}">Quitar</button>` : ''}</li>`).join('')}
      </ul>
      <form id="allowForm" class="form">
        <input id="aName" type="text" placeholder="Nombre (ej: Camilo)" maxlength="30" required>
        <input id="aEmail" type="email" placeholder="Email" required>
        <label class="check"><input type="checkbox" id="aAdmin"> También es administrador/a</label>
        <button class="btn primary block">➕ Autorizar email</button>
      </form>
    </section>` : ''}

    <section class="card">
      <h2>🔔 Notificaciones</h2>
      <p class="muted small" id="pushStatus">Revisando…</p>
      <button class="btn primary block hidden" id="pushOn">Activar notificaciones en este celular</button>
      <button class="btn ghost block hidden" id="pushOff">Desactivar en este celular</button>
    </section>

    <section class="card">
      <h2>📲 Instalar la app</h2>
      ${isStandalone() ? '<p>✅ Ya estás usando la app instalada.</p>' : `<p class="muted small">Para tenerla como una app más en el celular.</p><button class="btn primary block" data-install>Instalar en este celular</button>`}
      <button class="btn ghost block" id="share">🔗 Compartir enlace con la familia</button>
    </section>

    <button class="btn ghost block" id="logout">Cerrar sesión</button>
    <p class="muted small center">Labaut · Juntos en casa · v2.2</p>`;

  $('#pName').value = me.name;
  let color = me.color;
  $('#palette').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    color = b.dataset.color;
    $$('#palette button').forEach((x) => x.classList.toggle('sel', x === b));
  };
  $('#profForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const { error } = await sb.from('members').update({ name: $('#pName').value.trim(), color }).eq('id', me.id);
    if (error) return toast(friendlyError(error), 'err');
    toast('Perfil guardado ✅');
    await refresh();
  };

  $('#allowForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const used = new Set(state.allowed.map((a) => a.color));
    const free = PALETTE.find((c) => !used.has(c)) || PALETTE[state.allowed.length % PALETTE.length];
    const { error } = await sb.from('allowed_emails').insert({
      email: $('#aEmail').value.trim().toLowerCase(), name: $('#aName').value.trim(),
      is_admin: $('#aAdmin').checked, color: free,
    });
    if (error) return toast(/duplicate/i.test(error.message) ? 'Ese email ya está autorizado' : friendlyError(error), 'err');
    toast('Email autorizado ✅ Ya puede crear su cuenta');
    await refresh();
  });
  $$('[data-rm-email]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`¿Quitar ${b.dataset.rmEmail}? (si ya tiene cuenta, la conserva)`)) return;
    const { error } = await sb.from('allowed_emails').delete().eq('email', b.dataset.rmEmail);
    if (error) return toast(friendlyError(error), 'err');
    await refresh();
  }));

  $('#addCat')?.addEventListener('click', () => editCategory(null));
  $$('[data-edit-cat]').forEach((b) => (b.onclick = () => editCategory(allCats()[Number(b.dataset.editCat)])));
  $$('[data-move-cat]').forEach((b) => (b.onclick = () => moveCategory(Number(b.dataset.moveCat), Number(b.dataset.dir))));

  $('#share').onclick = async () => {
    const url = location.origin + location.pathname;
    const text = '🏠❤️ App de gastos de la familia Labaut. Entrá, creá tu cuenta e instalala:';
    if (navigator.share) { try { await navigator.share({ title: 'Labaut', text, url }); } catch { /* cancelado */ } }
    else { await navigator.clipboard?.writeText(url); toast('Enlace copiado 📋'); }
  };
  $('#logout').onclick = async () => { await disablePush(false); await sb.auth.signOut(); };

  // Estado de las notificaciones en este celular
  (async () => {
    const st = $('#pushStatus');
    if (!st) return;
    const show = (txt, on, off) => {
      st.textContent = txt;
      $('#pushOn')?.classList.toggle('hidden', !on);
      $('#pushOff')?.classList.toggle('hidden', !off);
    };
    if (!pushSupported()) {
      show(isIOS() && !isStandalone()
        ? 'En iPhone primero instalá la app (Compartir → Agregar a inicio) y abrila desde el ícono.'
        : 'Este navegador no permite notificaciones.', true, false);
      return;
    }
    if (Notification.permission === 'denied') {
      show('Las notificaciones están bloqueadas. Activalas en la configuración del celular (Notificaciones → Labaut o Chrome).', false, false);
      return;
    }
    let active = false;
    try {
      const sub = await currentPushSub();
      if (sub && Notification.permission === 'granted') {
        const { data } = await sb.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint);
        active = !!data?.length;
      }
    } catch { /* sin datos */ }
    show(active
      ? '✅ Activadas: te avisamos cuando alguien carga un gasto común o un aporte, y cuando se cierra el mes.'
      : 'Recibí un aviso cuando alguien carga un gasto común o un aporte, y cuando se cierra el mes.', !active, active);
  })();
  $('#pushOn')?.addEventListener('click', async () => { if (await enablePush()) render(); });
  $('#pushOff')?.addEventListener('click', async () => { await disablePush(true); toast('Notificaciones desactivadas'); render(); });
}

/* =====================================================================
   Categorías (solo administradora)
   ===================================================================== */
function catsTableReady() {
  if (state.categories.length) return true;
  toast('Falta ejecutar supabase/categorias.sql en Supabase', 'err');
  return false;
}

function editCategory(c) {
  if (!catsTableReady()) return;
  const used = c ? state.expenses.filter((e) => e.category === c.id).length : 0;
  let icon = c?.icon || '📦';
  let color = c?.color || CAT_COLORS.find((x) => !allCats().some((k) => k.color === x)) || CAT_COLORS[0];
  const close = openModal(`<h2>${c ? 'Editar categoría' : 'Nueva categoría'}</h2>
    <form id="catForm" class="form">
      <label class="lbl" for="catName">Nombre</label>
      <input id="catName" type="text" maxlength="30" placeholder="Ej: Internet, Farmacia…" required>
      <label class="lbl" for="catIcon">Ícono</label>
      <div class="icon-row">
        <div class="ico lg" id="catPreview"></div>
        <input id="catIcon" type="text" maxlength="8" placeholder="Emoji">
      </div>
      <div class="emoji-grid" id="catIcons">
        ${CAT_ICONS.map((x) => `<button type="button" data-icon="${x}">${x}</button>`).join('')}
      </div>
      <label class="lbl">Color</label>
      <div class="palette" id="catColors">
        ${CAT_COLORS.map((x) => `<button type="button" data-color="${x}" style="background:${x}" aria-label="${x}"></button>`).join('')}
      </div>
      ${c ? `<label class="check"><input type="checkbox" id="catActive" ${c.active ? 'checked' : ''}> Visible al cargar gastos</label>` : ''}
      <button class="btn primary block">${c ? 'Guardar cambios' : '➕ Crear categoría'}</button>
    </form>
    ${c ? (used
      ? `<p class="muted small">Tiene ${used} gasto${used === 1 ? '' : 's'}: no se puede borrar, pero podés ocultarla. Si la renombrás, sus gastos se actualizan solos.</p>`
      : '<button class="btn danger block" id="catDel">🗑️ Borrar categoría</button>') : ''}`);

  const paint = () => {
    const p = $('#catPreview');
    p.textContent = icon;
    p.style.background = color + '22';
    p.style.color = color;
    $$('#catIcons button').forEach((b) => b.classList.toggle('sel', b.dataset.icon === icon));
    $$('#catColors button').forEach((b) => b.classList.toggle('sel', b.dataset.color === color));
  };
  $('#catName').value = c?.id || '';
  $('#catIcon').value = icon;
  $('#catIcon').oninput = (ev) => { icon = ev.target.value.trim() || '📦'; paint(); };
  $('#catIcons').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    icon = b.dataset.icon;
    $('#catIcon').value = icon;
    paint();
  };
  $('#catColors').onclick = (ev) => { const b = ev.target.closest('button'); if (b) { color = b.dataset.color; paint(); } };
  paint();

  $('#catForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $('#catName').value.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Escribí un nombre', 'err');
    const clash = allCats().find((k) => k.id.toLowerCase() === name.toLowerCase() && k.id !== c?.id);
    if (clash) return toast(`Ya existe la categoría "${clash.id}"`, 'err');
    let res;
    if (c) {
      res = await sb.from('categories').update({ name, icon, color, active: $('#catActive').checked }).eq('name', c.id).select();
    } else {
      const sort = Math.max(0, ...allCats().map((k) => k.sort || 0)) + 10;
      res = await sb.from('categories').insert({ name, icon, color, sort }).select();
    }
    if (res.error) return toast(res.error.code === '23505' ? 'Ya existe una categoría con ese nombre' : friendlyError(res.error), 'err');
    if (!res.data?.length) return toast('No tenés permiso para cambiar categorías', 'err');
    close();
    toast(c ? 'Categoría actualizada ✅' : 'Categoría creada ✅');
    await refresh();
  };

  $('#catDel')?.addEventListener('click', async () => {
    if (!confirm(`¿Borrar la categoría "${c.id}"?`)) return;
    const { data, error } = await sb.from('categories').delete().eq('name', c.id).select();
    if (error) return toast(error.code === '23503' ? 'Tiene gastos: no se puede borrar, ocultala.' : friendlyError(error), 'err');
    if (!data?.length) return toast('No tenés permiso para borrar categorías', 'err');
    close();
    toast('Categoría borrada');
    await refresh();
  });
}

async function moveCategory(i, dir) {
  if (!catsTableReady()) return;
  const list = [...allCats()];
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  // Renumerar (10, 20, 30…) y guardar solo las que cambiaron
  const changes = list.map((c, k) => ({ c, sort: (k + 1) * 10 })).filter((x) => x.c.sort !== x.sort);
  const results = await Promise.all(changes.map((x) => sb.from('categories').update({ sort: x.sort }).eq('name', x.c.id)));
  const err = results.find((r) => r.error)?.error;
  if (err) toast(friendlyError(err), 'err');
  await refresh();
}

/* =====================================================================
   Inicio de la app
   ===================================================================== */
async function setSession(session) {
  state.session = session;
  if (session) {
    try {
      await loadData();
      subscribeRealtime();
    } catch (e) {
      toast(friendlyError(e), 'err');
    }
  } else {
    unsubscribeRealtime();
    Object.assign(state, { me: null, members: [], months: [], expenses: [], contributions: [], allowed: [], categories: [] });
    $('#app').innerHTML = '';
  }
  render();
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  const { data: { session } } = await sb.auth.getSession();
  await setSession(session);
  sb.auth.onAuthStateChange((event, newSession) => {
    // setTimeout evita bloqueos al llamar a Supabase dentro de este callback
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') askNewPassword();
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { state.session = newSession; return; }
      if ((newSession?.user?.id || null) !== (state.session?.user?.id || null)) setSession(newSession);
    }, 0);
  });
}

init();
