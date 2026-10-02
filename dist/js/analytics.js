// Яндекс Метрика — только с согласия посетителя (152-ФЗ: идентификаторы cookie
// и IP-адрес — персональные данные). Номер счётчика страница получает из
// <meta name="mw-metrika"> (site.analytics.metrika в meatwash-content.json,
// вставляет npm run pages). Нет номера — нет ни баннера, ни Метрики, goal() молчит.
//
// Решение посетителя — в localStorage (mw:consent): «Принять» загружает Метрику
// сейчас и на следующих страницах, «Отказаться» — нет. «Настройки cookie» в подвале
// открывают уведомление снова; отказ удаляет cookie и записи Метрики в localStorage,
// а после согласия ещё и перезагружает страницу, чтобы счётчик перестал работать сразу.
//
// Параметры init — как в коде счётчика из интерфейса Метрики, в том числе Вебвизор
// (запись действий на странице). Он упомянут в уведомлении, Политике и Согласии:
// выключая его, поправь и тексты (npm run check сверяет).
//
// Цели (Метрика → Цели → «JavaScript-событие», идентификаторы — как здесь):
//   booking_open, booking_branch, phone_click, map_open,
//   garage_open, garage_ready, garage_book, garage_request, club_card,
//   request_open, request_sent (заявка с фото — только при подтверждённой доставке),
//   route_click («Построить маршрут» в окне карты), membership_open («Обсудить условия»).

const KEY = 'mw:consent';
const VERSION = 1;
const counter = Number(document.querySelector('meta[name="mw-metrika"]')?.content) || 0;
const SRC = `https://mc.yandex.ru/metrika/tag.js?id=${counter}`;
let loaded = false;
let banner = null;
let returnFocus = null;

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
  window.ym(counter, 'init', {
    ssr: true, webvisor: true, clickmap: true, ecommerce: 'dataLayer',
    referrer: document.referrer, url: location.href, accurateTrackBounce: true, trackLinks: true,
  });
}

// Цель Метрики; без согласия или без счётчика — ничего.
export function goal(name, params) {
  if (!loaded) return;
  try { window.ym(counter, 'reachGoal', name, params); } catch { /* счётчик не загрузился — сайт работает */ }
}

// Идентификатор посетителя Метрика хранит и в cookie, и в localStorage (_ym_uid и др.):
// отказ удаляет и то и другое, иначе при новом согласии вернулся бы прежний идентификатор.
function forgetMetrika() {
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n.startsWith('_ym'))) {
    for (const domain of ['', location.hostname, '.' + location.hostname.split('.').slice(-2).join('.')]) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? '; domain=' + domain : ''}`;
    }
  }
  try {
    for (const key of Object.keys(localStorage).filter((k) => k.startsWith('_ym'))) localStorage.removeItem(key);
  } catch { /* хранилище недоступно — удалять нечего */ }
}

// Решение принято с клавиатуры — фокус возвращается туда, откуда открыли уведомление
// («Настройки cookie» в подвале), а не падает на body.
function hide() {
  const inside = banner?.contains(document.activeElement);
  if (banner) banner.hidden = true;
  document.body.classList.remove('has-consent');
  if (inside && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  returnFocus = null;
}
function decide(analytics) {
  const was = loaded;
  save(analytics);
  hide();
  if (analytics) { loadMetrika(); return; }
  forgetMetrika();
  // Счётчик уже работает на этой странице — остановить его можно только перезагрузкой.
  if (was) location.reload();
}

function showBanner(focus) {
  if (!banner) {
    banner = document.createElement('section');
    banner.className = 'consent';
    banner.setAttribute('aria-label', 'Согласие на cookie');
    banner.innerHTML = `
      <p class="consent__text">Мы используем cookie и Яндекс Метрику с Вебвизором, чтобы считать посещения и улучшать сайт. Нажимая «Принять», вы даёте <a href="consent.html">согласие на обработку персональных данных</a>. Подробнее — в <a href="privacy.html">Политике</a>. Без согласия сайт работает полностью.</p>
      <div class="consent__actions">
        <button class="btn btn--light consent__accept" type="button" data-consent="1">Принять</button>
        <button class="btn btn--ghost consent__decline" type="button" data-consent="0">Отказаться</button>
      </div>`;
    banner.addEventListener('click', (e) => {
      const button = e.target.closest('[data-consent]');
      if (button) decide(button.dataset.consent === '1');
    });
    // Сразу после ссылки «к содержанию»: с клавиатуры уведомление — в первых шагах Tab,
    // а не после всей страницы (на экране оно всё равно внизу, position: fixed).
    const skip = document.querySelector('.skip-link');
    if (skip) skip.after(banner); else document.body.prepend(banner);
  }
  banner.hidden = false;
  document.body.classList.add('has-consent');
  if (focus) {
    returnFocus = document.activeElement;
    banner.querySelector('.consent__accept').focus({ preventScroll: true });
  }
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
    // Решение могли принять раньше («Настройки cookie» в подвале) — тогда не показываем.
    const later = () => (window.requestIdleCallback || ((fn) => setTimeout(fn, 400)))(() => { if (!read()) showBanner(false); }, { timeout: 2000 });
    if (document.readyState === 'complete') later(); else addEventListener('load', later, { once: true });
  }
}
