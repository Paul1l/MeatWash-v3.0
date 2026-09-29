// Окно «На карте»: данные филиала и виджет Яндекс Карт.
//
// Виджет — официальный iframe карточки организации (Яндекс Карты → карточка →
// «Поделиться» → «Встроить»): map-widget/v1/org/<slug>/<id>/?ll=<lon,lat>&z=16,
// адрес лежит в meatwash-content.json (mapWidget). В нём метка организации,
// кнопки масштаба и атрибуция Яндекса — поверх углов iframe ничего не кладём.
//
// iframe создаётся только при открытии окна и только для выбранной студии;
// при переключении вкладки он заменяется, при закрытии удаляется. Ссылка
// «Открыть в Яндекс Картах» есть всегда, даже если виджет не загрузился.
import { LOCATIONS } from './data.js';

const LOAD_TIMEOUT_MS = 12000;
let dialog = null, api = null;

export function setupMaps({ dialog: element, onOpen }) {
  if (api) return api;
  dialog = element;
  const $ = (s) => dialog.querySelector(s);
  const tabs = [...dialog.querySelectorAll('[data-map-tab]')];
  const panel = $('#map-panel');
  const title = $('#map-title');
  const info = $('.map-dialog__info');
  const frameBox = $('.map-dialog__map');
  const status = $('.map-dialog__status');
  const fail = $('.map-dialog__fail');
  const placeholder = $('.map-dialog__placeholder');
  const slow = $('.map-dialog__slow');
  let current = null, opener = null, savedY = 0, frame = null, probe = null, probeTimer = 0, slowTimer = 0;

  // Состояния области карты: loading → loaded | error. Под iframe всегда лежит
  // заглушка (сетка, подпись): пока виджет не нарисовался, видна она. Ошибка
  // кладёт заглушку поверх iframe.
  //
  // По load iframe успех не определить: страница ошибки браузера (виджет
  // заблокирован, связь оборвалась) тоже присылает load, а бывает, что load не
  // приходит и через 12 с при уже нарисованной карте. Поэтому:
  // - нет сети при открытии или лёгкий запрос HEAD к виджету (no-cors: важно только,
  //   дошёл ли он) отклонён — ошибка поверх iframe с «Повторить»;
  // - 12 с без load — не ошибка (карта могла уже быть на экране), а подсказка в
  //   колонке информации: «Карта долго грузится — откройте в Яндекс Картах».
  const setState = (state) => {
    frameBox.dataset.state = state;
    fail.hidden = state !== 'error';
    status.textContent = state === 'loading' ? 'Загружаем карту…' : state === 'error' ? 'Карта не загрузилась.' : '';
    // Заглушка под iframe не должна ловить Tab: доступна, только когда она сверху.
    placeholder.inert = Boolean(frame) && state !== 'error';
    if (state !== 'loading') slow.hidden = true;
  };

  function unload() {
    clearTimeout(probeTimer);
    clearTimeout(slowTimer);
    probe?.abort();
    probe = null;
    frame?.remove();
    frame = null;
    slow.hidden = true;
    setState('idle');
  }

  function load(location) {
    unload();
    setState('loading');
    if (navigator.onLine === false) { setState('error'); return; }
    const iframe = document.createElement('iframe');
    iframe.src = location.mapWidget;
    iframe.title = `Яндекс Карты: MEATWASH ${location.name}, ${location.address}`;
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    // Итог проверки: 'ok', 'fail' — запрос отклонён (блокировка, обрыв, нет сети),
    // 'timeout' — 12 с без ответа, null — ещё идёт. Отказ — ошибка: load в этом
    // случае приходит от страницы ошибки браузера. Таймаут ошибкой не считается.
    let result = null, loaded = false;
    frame = iframe;
    const decide = () => {
      if (frame !== iframe) return;
      if (result === 'fail') setState('error');
      else if (loaded) setState('loaded');
    };
    iframe.addEventListener('load', () => {
      if (frame !== iframe) return;
      loaded = true;
      // Карта пришла после отказа (сеть ожила) — проверяем ещё раз, а не верим load.
      if (result === 'fail') verify(iframe).then((r) => { if (r) { result = r; decide(); } });
      else decide();
    });
    verify(iframe).then((r) => { if (r) { result = r; decide(); } });   // null — окно закрыли или сменили студию
    slowTimer = setTimeout(() => { if (frame === iframe && !loaded && frameBox.dataset.state === 'loading') slow.hidden = false; }, LOAD_TIMEOUT_MS);
    frameBox.append(iframe);
    setState(frameBox.dataset.state);
  }

  function verify(iframe) {
    probe?.abort();
    clearTimeout(probeTimer);
    const check = new AbortController();
    probe = check;
    let timedOut = false;
    probeTimer = setTimeout(() => { timedOut = true; check.abort(); }, LOAD_TIMEOUT_MS);
    return fetch(iframe.src, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: check.signal })
      .then(() => 'ok', () => (timedOut ? 'timeout' : check.signal.aborted ? null : 'fail'))
      .finally(() => { if (probe === check) { clearTimeout(probeTimer); probe = null; } });
  }

  const fields = {
    name: (l) => l.name,
    type: (l) => l.type,
    address: (l) => l.address,
    phone: (l) => l.phone,
    'entry-label': (l) => l.entry.label,
    'entry-text': (l) => l.entry.text,
    'on-site': (l) => l.onSite.join(' · '),
  };

  function fill(location) {
    for (const el of dialog.querySelectorAll('[data-map-field]')) {
      const key = el.dataset.mapField;
      if (key === 'hours') el.replaceChildren(...location.hours.flatMap((line, i) => i ? [document.createElement('br'), line] : [line]));
      else if (fields[key]) el.textContent = fields[key](location);
    }
    dialog.querySelectorAll('[data-map-call]').forEach((a) => { a.href = 'tel:' + location.tel; });
    dialog.querySelectorAll('[data-map-external]').forEach((a) => { a.href = location.map; });
    dialog.querySelectorAll('[data-map-route]').forEach((a) => { a.href = location.route; });
    dialog.querySelectorAll('[data-map-book]').forEach((a) => { a.href = location.booking; });
    for (const tab of tabs) {
      const on = tab.dataset.mapTab === location.id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute('aria-labelledby', tab.id);
    }
  }

  function select(id, { loadMap = true } = {}) {
    const location = LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
    if (current === location.id && frame) return;
    current = location.id;
    fill(location);
    info.scrollTop = 0;
    if (loadMap) load(location);
  }

  // Вкладки: щелчок, стрелки, Home/End. Филиалов два — вкладка активируется сразу.
  dialog.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-map-tab]');
    if (tab) { select(tab.dataset.mapTab); return; }
    if (e.target.closest('[data-map-retry]')) { const l = LOCATIONS.find((x) => x.id === current); if (l) load(l); }
  });
  dialog.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[data-map-tab]');
    if (!tab) return;
    const i = tabs.indexOf(tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    target.focus();
    select(target.dataset.mapTab);
  });

  dialog.addEventListener('close', () => {
    unload();
    current = null;
    // Страница остаётся, где была; фокус — на кнопку, которой открыли окно.
    if (Math.abs(scrollY - savedY) > 1) scrollTo({ top: savedY, behavior: 'instant' });
    opener?.focus({ preventScroll: true });
    opener = null;
  });

  api = {
    open(id, from) {
      opener = from || null;
      savedY = scrollY;
      select(id, { loadMap: false });
      if (!dialog.open) {
        dialog.scrollTop = 0;
        dialog.showModal();
        onOpen?.();
      }
      const location = LOCATIONS.find((l) => l.id === current);
      load(location);
      title.focus({ preventScroll: true });
    },
  };
  return api;
}

export function openMap(id, from) {
  if (!api) throw new Error('setupMaps() не вызван');
  api.open(id, from);
}
