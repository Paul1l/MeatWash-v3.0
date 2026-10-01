// Яндекс Метрика — только с согласия посетителя (152-ФЗ: идентификаторы cookie
// и IP-адрес — персональные данные). Номер счётчика страница получает из
// <meta name="mw-metrika"> (site.analytics.metrika в meatwash-content.json,
// вставляет npm run pages). Нет номера — нет ни баннера, ни Метрики, goal() молчит.
//
// Решение посетителя — в localStorage (mw:consent): «Принять» загружает Метрику
// сейчас и на следующих страницах, «Отказаться» — нет. «Настройки cookie» в подвале
// открывают уведомление снова; отказ после согласия удаляет cookie Метрики и
// перезагружает страницу, чтобы счётчик перестал работать сразу.
//
// Цели (Метрика → Цели → «JavaScript-событие», идентификаторы — как здесь):
//   booking_open, booking_branch, phone_click, map_open,
//   garage_open, garage_ready, garage_book.

const KEY = 'mw:consent';
const VERSION = 1;
const SRC = 'https://mc.yandex.ru/metrika/tag.js';
const counter = Number(document.querySelector('meta[name="mw-metrika"]')?.content) || 0;
let loaded = false;
let banner = null;

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return v && v.v === VERSION ? v : null; } catch { return null; }
}
function save(analytics) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, analytics, at: new Date().toISOString() })); } catch { /* приватный режим: спросим на следующей странице */ }
}

// Официальный код счётчика, без noscript-пикселя: он считал бы и без согласия.
function loadMetrika() {
  if (loaded || !counter) return;
  loaded = true;
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  if (![...document.scripts].some((s) => s.src === SRC)) {
    const script = document.createElement('script');
    script.async = true;
    script.src = SRC;
    document.head.append(script);
  }
  window.ym(counter, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
}

// Цель Метрики; без согласия или без счётчика — ничего.
export function goal(name, params) {
  if (!loaded) return;
  try { window.ym(counter, 'reachGoal', name, params); } catch { /* счётчик не загрузился — сайт работает */ }
}

function forgetMetrikaCookies() {
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n.startsWith('_ym'))) {
    for (const domain of ['', location.hostname, '.' + location.hostname.split('.').slice(-2).join('.')]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? '; domain=' + domain : ''}`;
    }
  }
}

function hide() { if (banner) banner.hidden = true; document.body.classList.remove('has-consent'); }
function decide(analytics) {
  const was = loaded;
  save(analytics);
  hide();
  if (analytics) { loadMetrika(); return; }
  forgetMetrikaCookies();
  // Счётчик уже работает на этой странице — остановить его можно только перезагрузкой.
  if (was) location.reload();
}

function showBanner(focus) {
  if (!banner) {
    banner = document.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('aria-label', 'Согласие на cookie');
    banner.innerHTML = `
      <p class="consent__text">Мы используем cookie и Яндекс Метрику, чтобы считать посещения и улучшать сайт. Нажимая «Принять», вы даёте <a href="consent.html">согласие на обработку персональных данных</a>. Подробнее — в <a href="privacy.html">Политике</a>. Без согласия сайт работает полностью.</p>
      <div class="consent__actions">
        <button class="btn btn--light consent__accept" type="button" data-consent="1">Принять</button>
        <button class="btn btn--ghost consent__decline" type="button" data-consent="0">Отказаться</button>
      </div>`;
    banner.addEventListener('click', (e) => {
      const button = e.target.closest('[data-consent]');
      if (button) decide(button.dataset.consent === '1');
    });
    document.body.append(banner);
  }
  banner.hidden = false;
  document.body.classList.add('has-consent');
  if (focus) banner.querySelector('.consent__accept').focus({ preventScroll: true });
}

export function setupAnalytics() {
  const settings = [...document.querySelectorAll('[data-consent-open]')];
  if (!counter) return;
  for (const button of settings) {
    button.hidden = false;
    button.addEventListener('click', () => showBanner(true));
  }
  const choice = read();
  if (choice?.analytics) loadMetrika();
  else if (!choice) {
    // Уведомление — после загрузки страницы: первый экран и LCP ему не уступают.
    const later = () => (window.requestIdleCallback || ((fn) => setTimeout(fn, 400)))(() => showBanner(false), { timeout: 2000 });
    if (document.readyState === 'complete') later(); else addEventListener('load', later, { once: true });
  }
}
