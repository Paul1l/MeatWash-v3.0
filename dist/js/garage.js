// «Гараж услуг» — единый 3D-сценарий главной.
//
// Кнопки [data-garage-open] открывают одно модальное окно (<dialog id="garage">).
// Оболочка — название, закрытие, состояние загрузки — появляется сразу; движок и
// модель (porsche3d.bundle.js) запрашиваются только после нажатия и только
// import() строкой: npm run check падает на любой другой ссылке на 3D.
//
// Состояния окна (data-state): loading → ready, либо error (сеть, тайм-аут,
// шейдеры, потеря контекста — с «Повторить») или nogl (нет WebGL 2 — без повтора).
// Панель услуг видна только в ready: фотография 3D-гаражом не притворяется.
//
// Закрытие — крестик, Esc, фон окна (на компьютере) — работает в любом
// состоянии: загрузка отменяется (AbortSignal), сцена освобождает видеопамять
// (dispose), прокрутка и фокус возвращаются. Поздно закончившаяся загрузка
// видит, что её отменили, и закрывает свою сцену — окно сама не открывает.
// Выбор работ живёт в sessionStorage отдельно от сцены: повторное открытие его
// не сбрасывает, для этого есть «Сбросить выбор».

import { ZONES, ZONE_GROUPS, ZONE_PRESETS, EXCLUSIVE, zonePrice, garageSum, includedIn } from './config.js';
import { BODY_TYPES, PROGRAMS } from './data.js';
import { getBody, setBody, bodyName } from './body.js';
import { goal } from './analytics.js';

const money = (n) => n.toLocaleString('ru-RU') + ' ₽';
const byId = (id) => ZONES.find((z) => z.id === id);
const isProgram = (id) => byId(id)?.price.program != null;
const PICKED_KEY = 'mw:garage';
const WEBGL_KEY = 'mw:webgl2';
const GUARD_MS = 400;   // второй щелчок двойного клика по кнопке входа не закрывает окно
const CATALOG = 'services.html#programs';
const TABS = [...ZONE_GROUPS, { id: 'presets', title: 'Наборы' }];

// Выбор на время визита: только известные работы, одна программа мойки,
// без работ, уже входящих в выбранную программу.
function readPicked() {
  let ids = [];
  try { ids = JSON.parse(sessionStorage.getItem(PICKED_KEY) || '[]'); } catch { /* приватный режим */ }
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!byId(id) || out.includes(id)) continue;
    for (const group of EXCLUSIVE) if (group.includes(id)) for (let i = out.length - 1; i >= 0; i--) if (group.includes(out[i])) out.splice(i, 1);
    out.push(id);
  }
  return out.filter((id) => !includedIn(byId(id), out));
}
function savePicked(ids) {
  try { sessionStorage.setItem(PICKED_KEY, JSON.stringify(ids)); } catch { /* приватный режим: выбор живёт до перезагрузки */ }
}

// Настоящая проба WebGL 2 — по нажатию, до загрузки бандла: API может быть, а
// контекст не создаться (видеокарта в чёрном списке). Результат — на визит.
function probeWebGL2() {
  try { const known = sessionStorage.getItem(WEBGL_KEY); if (known) return known === '1'; } catch { /* приватный режим */ }
  let ok = false;
  if ('WebGL2RenderingContext' in window) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      ok = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { ok = false; }
  }
  try { sessionStorage.setItem(WEBGL_KEY, ok ? '1' : '0'); } catch { /* приватный режим */ }
  return ok;
}

const icon = {
  close: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  reset: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M10 2.2 16.8 6v8L10 17.8 3.2 14V6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M3.2 6 10 9.8 16.8 6M10 9.8v8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  fold: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

export function setupGarage() {
  const abort = new AbortController(), options = { signal: abort.signal };
  const coarse = () => matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const forceStatic = new URLSearchParams(location.search).get('motion') === 'reduce';
  const reduced = () => motion.matches || forceStatic;

  const dialog = document.createElement('dialog');
  dialog.className = 'garage';
  dialog.id = 'garage';
  dialog.setAttribute('aria-labelledby', 'garage-title');
  dialog.dataset.state = 'idle';
  dialog.innerHTML = `
    <header class="garage__bar">
      <h2 class="garage__title" id="garage-title" tabindex="-1">Гараж услуг</h2>
      <button class="garage__close" type="button" data-garage-close aria-label="Закрыть гараж услуг">${icon.close}</button>
    </header>
    <p class="visually-hidden" role="status" aria-live="polite" aria-atomic="true" data-garage-live></p>
    <div class="garage__main">
      <div class="garage__view" data-garage-view role="group" aria-label="3D-модель автомобиля" aria-describedby="garage-keys" tabindex="-1">
        <div class="garage__stage" data-garage-stage></div>
        <div class="garage__loader" data-garage-loader>
          <p class="garage__loadtext"><span data-garage-loadtext>Загружаем 3D-гараж</span><span class="garage__pct" data-garage-pct></span></p>
          <div class="garage__progress" data-garage-progress aria-hidden="true"><i></i></div>
          <p class="garage__loadnote">Закрыть можно в любой момент — выбор услуг сохранится.</p>
        </div>
        <div class="garage__fail" data-garage-fail>
          <p class="garage__failtitle" data-garage-failtitle></p>
          <p class="garage__failtext" data-garage-failtext></p>
          <div class="garage__failact">
            <button class="btn btn--light" type="button" data-garage-retry>Повторить</button>
            <a class="btn btn--ghost" href="${CATALOG}" data-garage-catalog>Открыть услуги</a>
            <button class="btn btn--ghost" type="button" data-garage-close>Закрыть</button>
          </div>
        </div>
        <div class="garage__tools">
          <button class="garage__tool" type="button" data-garage-reset>${icon.reset}<span>Общий вид</span></button>
          <div class="garage__zoom" role="group" aria-label="Приближение">
            <button class="garage__tool garage__tool--icon" type="button" data-garage-zoom="in" aria-label="Приблизить">+</button>
            <button class="garage__tool garage__tool--icon" type="button" data-garage-zoom="out" aria-label="Отдалить">−</button>
          </div>
        </div>
        <p class="garage__hint" data-garage-hint></p>
        <p class="visually-hidden" id="garage-keys">Стрелки — поворот, плюс и минус — приближение, Home — общий вид.</p>
        <p class="garage__caption" data-garage-caption><b></b><span></span></p>
      </div>
      <section class="garage__panel" aria-label="Выбор услуг">
        <div class="garage__panelhead">
          <div class="garage__tabs" role="tablist" aria-label="Категории услуг">
            ${TABS.map((tab, i) => `<button class="garage__tab" type="button" role="tab" id="garage-tab-${tab.id}" aria-controls="garage-group-${tab.id}" aria-selected="${i ? 'false' : 'true'}" tabindex="${i ? -1 : 0}" data-tab="${tab.id}">${tab.title}</button>`).join('')}
          </div>
          <button class="garage__fold" type="button" data-garage-fold aria-expanded="true" aria-controls="garage-list">${icon.fold}<span><span data-fold-text>Свернуть</span><span class="garage__foldmore"> услуги</span></span></button>
        </div>
        <div class="garage__list" id="garage-list">
          ${ZONE_GROUPS.map((group, i) => `
          <div class="garage__group" role="tabpanel" id="garage-group-${group.id}" aria-labelledby="garage-tab-${group.id}" data-group="${group.id}"${i ? ' hidden' : ''}>
            ${group.id === 'wash' ? `<label class="garage__bodytype"><span>Тип кузова</span><select data-garage-body>${BODY_TYPES.map((type, b) => `<option value="${b}">${type}</option>`).join('')}</select></label>` : ''}
            <ul class="garage__items">
              ${ZONES.filter((z) => z.group === group.id).map((z) => `
              <li><label class="garage__item" data-zone="${z.id}">
                <input type="checkbox" value="${z.id}">
                <span class="garage__box" aria-hidden="true"></span>
                <span class="garage__text"><b>${z.title}</b><i data-zone-note>${z.price.program != null ? `Программа мойки · ${PROGRAMS[z.price.program].time}. ` : ''}${z.caption}</i></span>
                <span class="garage__price" data-zone-price></span>
              </label></li>`).join('')}
            </ul>
          </div>`).join('')}
          <div class="garage__group" role="tabpanel" id="garage-group-presets" aria-labelledby="garage-tab-presets" data-group="presets" hidden>
            <p class="garage__groupnote">Набор заменяет текущий выбор.</p>
            <ul class="garage__items">
              ${ZONE_PRESETS.map((p) => `<li><button class="garage__preset" type="button" data-preset="${p.id}"><b>${p.title}</b><i>${p.note}</i><span class="garage__price" data-preset-price></span></button></li>`).join('')}
            </ul>
          </div>
        </div>
        <div class="garage__foot">
          <div class="garage__picked" data-garage-picked aria-label="Выбранные услуги" role="group"></div>
          <p class="garage__total"><span>Предварительно</span><b data-garage-total></b></p>
          <p class="garage__note">Минимальные цены каталога, мойка — для выбранного кузова. Точную стоимость назовёт мастер после осмотра.</p>
          <div class="garage__act">
            <button class="btn btn--fill garage__book" type="button" data-book data-garage-book>Записаться</button>
            <button class="garage__clear" type="button" data-garage-clear>Сбросить выбор</button>
          </div>
          <!-- Лицензия модели CC BY 4.0 требует указать автора и что модель изменена — рядом с ней. -->
          <p class="garage__credit">3D-модель: <a href="https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e" target="_blank" rel="noopener noreferrer">Karol Miklas</a>, <a href="https://creativecommons.org/licenses/by/4.0/deed.ru" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>, изменена</p>
        </div>
      </section>
    </div>`;
  document.body.append(dialog);

  const $ = (s) => dialog.querySelector(s);
  const stageEl = $('[data-garage-stage]'), viewEl = $('[data-garage-view]'), live = $('[data-garage-live]');
  const loadText = $('[data-garage-loadtext]'), pctEl = $('[data-garage-pct]'), progressEl = $('[data-garage-progress]');
  const failTitle = $('[data-garage-failtitle]'), failText = $('[data-garage-failtext]'), retryBtn = $('[data-garage-retry]');
  const hint = $('[data-garage-hint]'), caption = $('[data-garage-caption]');
  const totalEl = $('[data-garage-total]'), pickedEl = $('[data-garage-picked]'), bookBtn = $('[data-garage-book]'), clearBtn = $('[data-garage-clear]');
  const bodySelect = $('[data-garage-body]'), foldBtn = $('[data-garage-fold]'), title = $('#garage-title');
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];

  let active = false;       // окно открыто (и ещё не закрыто нами)
  let opener = null;        // кнопка, открывшая гараж: на неё возвращается фокус
  let savedY = 0;           // место главной страницы
  let openedAt = 0;
  let job = null;           // {controller} — идёт загрузка
  let scene = null;         // сцена из mount(), когда первый кадр нарисован
  let importFailures = 0;
  let hinted = false;
  const picked = readPicked();
  let lastTouched = picked.at(-1) ?? null;

  const say = (text) => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); };

  // ── Состояния ─────────────────────────────────────────────────────────────
  function setState(next) {
    dialog.dataset.state = next;
    dialog.toggleAttribute('aria-busy', next === 'loading');
  }
  // ratio — доля скачанной модели, только если известна точно (размер из
  // манифеста сборки); null — индикатор без процента.
  function setProgress(ratio, phase) {
    const known = ratio != null && phase === 'download';
    loadText.textContent = phase === 'prepare' ? 'Готовим 3D-гараж' : 'Загружаем 3D-гараж';
    pctEl.textContent = known ? ` · модель ${Math.round(ratio * 100)} %` : '';
    progressEl.classList.toggle('is-indeterminate', !known);
    progressEl.style.setProperty('--p', known ? ratio.toFixed(3) : '0');
  }
  function fail(error) {
    job = null;
    if (scene) { scene.dispose(); scene = null; }
    const noWebgl = error?.code === 'webgl';
    if (noWebgl) { try { sessionStorage.setItem(WEBGL_KEY, '0'); } catch { /* приватный режим */ } }
    else console.warn('3D-гараж не открылся.', error);
    if (!active) return;
    setState(noWebgl ? 'nogl' : 'error');
    retryBtn.hidden = noWebgl;
    failTitle.textContent = noWebgl ? '3D-гараж недоступен на этом устройстве' : 'Не удалось открыть 3D-гараж';
    failText.textContent = noWebgl
      ? 'Браузер не поддерживает WebGL 2, без него 3D-модель не показать. Услуги и цены — в каталоге.'
      : error?.code === 'context-lost'
        ? '3D-сцена остановилась. Вы можете повторить попытку или выбрать услуги в каталоге.'
        : 'Вы можете повторить попытку или выбрать услуги в каталоге.';
    say(failTitle.textContent + '. ' + failText.textContent);
    // Фокус был на заголовке или внутри исчезнувшей панели — ставим на первое действие.
    if (!dialog.contains(document.activeElement) || document.activeElement === title || document.activeElement === document.body) (noWebgl ? $('[data-garage-catalog]') : retryBtn).focus({ preventScroll: true });
  }

  // ── Загрузка ──────────────────────────────────────────────────────────────
  // Адрес — строкой: так его видит npm run check, а stamp-assets ставит ?v=.
  // Неудачный import() браузер запоминает, поэтому повтор после сбоя идёт по
  // адресу с ?retry=N (и той же версией ?v=).
  async function importBundle() {
    try {
      if (!importFailures) return await import('./porsche3d.bundle.js');
      const url = new URL('./porsche3d.bundle.js', import.meta.url);
      const v = new URL(import.meta.url).searchParams.get('v');
      if (v) url.searchParams.set('v', v);
      url.searchParams.set('retry', String(importFailures));
      return await import(url.href);
    } catch (error) {
      importFailures++;
      throw Object.assign(error, { code: error.code || 'load' });
    }
  }
  async function load() {
    if (job || scene) return;
    const controller = new AbortController();
    const mine = job = { controller };
    setState('loading');
    setProgress(null, 'bundle');
    say('Загружаем 3D-гараж.');
    // Кадр на отрисовку оболочки: проба WebGL может занять до полсекунды.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    if (job !== mine) return;
    if (!probeWebGL2()) { fail({ code: 'webgl' }); return; }
    try {
      const { mount } = await importBundle();
      if (job !== mine) return;
      const handle = await mount({
        container: stageEl,
        signal: controller.signal,
        reducedMotion: reduced(),
        startView: 'overview',
        onProgress: ({ ratio }) => { if (job === mine) setProgress(ratio, 'download'); },
        onPhase: (phase) => { if (job === mine && phase === 'prepare') setProgress(null, 'prepare'); },
        onInteract: () => hideHint(),
        onError: (error) => { if (scene === handle) { scene = null; fail(error); } },
      });
      // Окно закрыли или начали загрузку заново — эта сцена не нужна.
      if (job !== mine || controller.signal.aborted || !active) { handle.dispose(); return; }
      job = null;
      scene = handle;
      setState('ready');
      showHint();
      renderSelection();
      target(null);
      frameSafe();
      say('3D-гараж готов. Выберите услуги — камера покажет деталь автомобиля.');
      goal('garage_ready', { quality: handle.quality });
    } catch (error) {
      if (job !== mine) return;
      job = null;
      if (error?.name === 'AbortError') return;
      fail(error);
    }
  }

  // ── Камера и подписи ──────────────────────────────────────────────────────
  // Какая работа на экране: тронутая последней, иначе последняя выбранная.
  function current(id) {
    const key = id || lastTouched;
    if (key && picked.includes(key)) return key;
    return ZONES.slice().reverse().find((z) => picked.includes(z.id))?.id ?? null;
  }
  function target(id) {
    const key = current(id);
    const zone = key ? byId(key) : null;
    caption.querySelector('b').textContent = zone ? zone.title : 'Общий вид';
    caption.querySelector('span').textContent = zone ? zone.caption : 'Выберите работу — камера покажет нужную деталь.';
    if (!scene) return;
    if (zone) scene.showService(zone.id); else scene.showBase();
  }
  // Кнопки сверху и подпись снизу лежат поверх области 3D: камера кадрирует
  // машину в свободной части между ними — они не закрывают колёса и крышу.
  const toolsEl = $('.garage__tools');
  function frameSafe() {
    if (!scene) return;
    const view = viewEl.getBoundingClientRect(), tools = toolsEl.getBoundingClientRect(), cap = caption.getBoundingClientRect();
    scene.setSafeArea({
      top: tools.height ? Math.max(0, Math.round(tools.bottom - view.top)) : 0,
      bottom: cap.height ? Math.max(0, Math.round(view.bottom - cap.top)) : 0,
    });
  }
  // Вкладки не помещаются — край ряда затухает, пока его не долистали.
  const tabRow = $('.garage__tabs');
  const tabEdges = () => {
    tabRow.classList.toggle('is-overflowing', tabRow.scrollWidth > tabRow.clientWidth + 1);
    tabRow.classList.toggle('is-end', tabRow.scrollLeft + tabRow.clientWidth >= tabRow.scrollWidth - 2);
  };
  tabRow.addEventListener('scroll', tabEdges, { ...options, passive: true });
  const resizeWatch = new ResizeObserver(() => { frameSafe(); tabEdges(); });
  resizeWatch.observe(viewEl);
  resizeWatch.observe(caption);
  resizeWatch.observe(tabRow);
  function showHint() {
    if (hinted) return;
    hint.textContent = coarse() ? 'Проведите пальцем — повернуть, два пальца — приблизить' : 'Потяните мышью — повернуть, колесо — приблизить';
    hint.hidden = false;
  }
  function hideHint() { hinted = true; hint.hidden = true; }

  // ── Выбор услуг ───────────────────────────────────────────────────────────
  function renderSelection() {
    const body = getBody();
    bodySelect.value = String(body);
    for (const label of dialog.querySelectorAll('.garage__item')) {
      const zone = byId(label.dataset.zone), input = label.querySelector('input');
      const inside = includedIn(zone, picked);
      input.checked = picked.includes(zone.id) || Boolean(inside);
      input.disabled = Boolean(inside);
      label.classList.toggle('is-on', input.checked);
      label.classList.toggle('is-included', Boolean(inside));
      label.querySelector('[data-zone-price]').textContent = inside ? 'входит в программу' : 'от ' + money(zonePrice(zone, body));
      label.title = inside ? `Входит в мойку «${inside.title}»` : '';
    }
    for (const button of dialog.querySelectorAll('[data-preset]')) {
      const preset = ZONE_PRESETS.find((p) => p.id === button.dataset.preset);
      button.querySelector('[data-preset-price]').textContent = 'от ' + money(garageSum(preset.zones, body));
      button.setAttribute('aria-pressed', String(preset.zones.length === picked.length && preset.zones.every((id) => picked.includes(id))));
    }
    const sum = garageSum(picked, body);
    totalEl.textContent = picked.length ? 'от ' + money(sum) : 'Выберите работы';
    totalEl.classList.toggle('is-empty', !picked.length);
    clearBtn.disabled = !picked.length;
    pickedEl.replaceChildren(...picked.map((id) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'garage__chip'; chip.dataset.unpick = id;
      chip.setAttribute('aria-label', `Убрать: ${byId(id).title}`);
      chip.innerHTML = '<span></span><span aria-hidden="true">×</span>';
      chip.firstChild.textContent = byId(id).title;
      return chip;
    }));
    pickedEl.hidden = !picked.length;
    // Состав уходит в окно записи через data-book-context — так же, как у всех
    // кнопок записи на странице; окно пишет «Вы выбрали: …». Кузов — если в
    // составе есть мойка (только её цена от него зависит).
    const withBody = picked.some(isProgram) ? ' · ' + bodyName(body) : '';
    if (picked.length) bookBtn.dataset.bookContext = picked.map((id) => byId(id).title).join(', ') + withBody + ' · предварительно от ' + money(sum);
    else delete bookBtn.dataset.bookContext;
    // Состав для онлайн-записи: программы — индексом, работы прайса — названием.
    // ui.js переведёт их в идентификаторы YCLIENTS выбранного филиала.
    const programs = picked.map((id) => byId(id).price.program).filter((i) => i != null);
    const items = picked.map((id) => byId(id).price.item).filter(Boolean);
    bookBtn.dataset.ycPrograms = programs.join(',');
    bookBtn.dataset.ycItems = items.join('|');
  }
  // Часть работ в онлайн-записи не продаётся: их добавляет мастер при приёмке.
  // Помечаем это сразу в списке, чтобы человек видел до нажатия «Записаться»,
  // а не удивлялся, что в запись ушла половина выбранного.
  function markOffline() {
    import('./yclients.js').then((yc) => yc.loadMap().then(() => {
      let offline = 0;
      for (const label of dialog.querySelectorAll('.garage__item')) {
        const zone = byId(label.dataset.zone);
        if (!zone) continue;
        const spec = zone.price.program != null
          ? { programs: [zone.price.program], items: [] }
          : { programs: [], items: [zone.price.item] };
        // Работа доступна онлайн, если её удалось сопоставить хотя бы в одном филиале.
        const ok = ['myasnitskaya', 'technopark'].some((b) => yc.resolve(b, spec, 0).ids.length);
        label.classList.toggle('is-offline', !ok);
        if (!ok) {
          offline += 1;
          const note = label.querySelector('[data-zone-note]');
          if (note && !note.dataset.offline) {
            note.dataset.offline = '1';
            note.textContent = 'Приобретается на месте — мастер добавит при приёмке. ' + note.textContent;
          }
        }
      }
      if (offline) say(`${offline} работ приобретаются на месте.`);
    })).catch(() => {});
  }

  function setPicked(ids, touched) {
    picked.splice(0, picked.length, ...ids);
    lastTouched = touched ?? null;
    savePicked(picked);
    renderSelection();
    target(touched);
  }
  function toggle(id, on) {
    let next = picked.filter((x) => x !== id);
    if (on) {
      // Вторая программа мойки заменяет первую (они вложены друг в друга).
      for (const group of EXCLUSIVE) if (group.includes(id)) next = next.filter((x) => !group.includes(x));
      next.push(id);
      // Работы, которые теперь входят в выбранную программу, отдельно не считаются.
      next = next.filter((x) => !includedIn(byId(x), next));
    }
    setPicked(next, on ? id : null);
    const zone = byId(id);
    say(on ? `${zone.title}: выбрано. Предварительно ${totalEl.textContent}.` : `${zone.title}: убрано. ${picked.length ? 'Предварительно ' + totalEl.textContent : 'Ничего не выбрано'}.`);
  }
  function selectTab(id, focus) {
    for (const tab of tabs) {
      const on = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
      if (on) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    for (const group of dialog.querySelectorAll('.garage__group')) group.hidden = group.dataset.group !== id;
    $('.garage__list').scrollTop = 0;
  }
  function setFolded(on) {
    dialog.classList.toggle('is-folded', on);
    foldBtn.setAttribute('aria-expanded', String(!on));
    // На узком экране видно «Свернуть» / «Показать», «услуги» — для чтения с экрана.
    foldBtn.querySelector('[data-fold-text]').textContent = on ? 'Показать' : 'Свернуть';
  }

  // ── Открытие и закрытие ───────────────────────────────────────────────────
  // Прокрутка страницы за окном выключена тем же способом, что у остальных окон
  // (ui.js): класс на <html>, iOS не считается с overflow одного body.
  function lock(on) {
    const other = [...document.querySelectorAll('dialog[open]')].some((d) => d !== dialog);
    const menu = document.getElementById('mobile-menu');
    document.documentElement.classList.toggle('is-locked', on || other || Boolean(menu && !menu.hidden));
    document.body.classList.toggle('dialog-open', on || other);
  }
  function open(button) {
    if (active) return;
    active = true;
    opener = button || null;
    savedY = scrollY;
    openedAt = performance.now();
    setFolded(false);
    hinted = false; hint.hidden = true;
    picked.splice(0, picked.length, ...readPicked());
    renderSelection();
    markOffline();
    // Открываем на категории последней выбранной работы.
    const last = byId(current(null));
    selectTab(last ? last.group : ZONE_GROUPS[0].id, false);
    target(null);
    dialog.showModal();
    lock(true);
    title.focus({ preventScroll: true });
    goal('garage_open', { from: button?.closest('#garage-promo') ? 'promo' : button?.closest('.hero') ? 'hero' : 'link' });
    load();
  }
  function teardown() {
    job?.controller.abort();
    job = null;
    if (scene) { scene.dispose(); scene = null; }
    setState('idle');
    lock(false);
    // Страница не должна была сдвинуться, но iOS иногда прокручивает её под
    // окном: ставим точно на прежнее место.
    // Без behavior: у html scroll-behavior: auto (cinematic.css), а 'instant' старый Safari не знает.
    if (Math.abs(scrollY - savedY) > 1) scrollTo(0, savedY);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  // Сначала закрываем окно, потом teardown: dialog.close() сам возвращает фокус
  // туда, где он был до showModal (после ./#garage — на body), и перебил бы наш.
  function close() {
    if (!active) return;
    active = false;
    if (dialog.open) dialog.close();
    teardown();
  }

  // ── События ───────────────────────────────────────────────────────────────
  // Esc: своё закрытие вместо встроенного — с отменой загрузки и возвратом фокуса.
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); }, options);
  // Окно закрыли не через close() (браузер, второй Esc) — всё равно убираем сцену.
  dialog.addEventListener('close', () => { if (active) { active = false; teardown(); } }, options);
  let downOutside = false;
  const outside = (e) => { const r = dialog.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', (e) => { downOutside = e.target === dialog && outside(e); }, options);

  dialog.addEventListener('click', (e) => {
    const settling = e.detail > 1 || performance.now() - openedAt < GUARD_MS;
    // Фон окна (компьютер): закрываем, только если и нажатие, и отпускание были вне окна.
    if (e.target === dialog) { if (!settling && downOutside && outside(e)) close(); return; }
    const control = e.target.closest('button, a[href]');
    if (!control) return;
    if (control.matches('[data-garage-close]')) { if (!settling) close(); return; }
    if (control.matches('[data-garage-retry]')) { setState('loading'); title.focus({ preventScroll: true }); load(); return; }
    // «Открыть услуги» уводит со страницы: сцену закрываем сразу (новую вкладку — нет).
    if (control.matches('[data-garage-catalog]')) { if (!(e.ctrlKey || e.metaKey || e.shiftKey || e.button)) { active = false; teardown(); } return; }
    if (control.matches('[data-garage-reset]')) { scene?.reset(); return; }
    if (control.matches('[data-garage-zoom]')) { scene?.zoomBy(control.dataset.garageZoom === 'in' ? 0.87 : 1.15); hideHint(); return; }
    if (control.matches('[data-garage-fold]')) { setFolded(!dialog.classList.contains('is-folded')); return; }
    if (control.matches('[role="tab"]')) { selectTab(control.dataset.tab, false); return; }
    if (control.matches('[data-garage-clear]')) { setPicked([], null); say('Выбор сброшен.'); return; }
    if (control.matches('[data-unpick]')) {
      const id = control.dataset.unpick;
      const next = pickedEl.querySelector(`[data-unpick="${id}"]`)?.nextElementSibling || pickedEl.querySelector(`[data-unpick="${id}"]`)?.previousElementSibling;
      toggle(id, false);
      (pickedEl.querySelector(`[data-unpick="${next?.dataset.unpick}"]`) || bookBtn).focus({ preventScroll: true });
      return;
    }
    if (control.matches('[data-preset]')) {
      const preset = ZONE_PRESETS.find((p) => p.id === control.dataset.preset);
      setPicked([...preset.zones], preset.zones.at(-1));
      say(`Набор «${preset.title}» выбран. Предварительно ${totalEl.textContent}.`);
      return;
    }
    // «Записаться»: гараж закрывается, затем общий обработчик ui.js (data-book)
    // открывает выбор филиала с составом в «Вы выбрали: …» — окна не накладываются.
    if (control.matches('[data-garage-book]')) { goal('garage_book', { works: picked.length, sum: garageSum(picked, getBody()) }); close(); }
  }, options);

  dialog.addEventListener('change', (e) => {
    if (e.target === bodySelect) { setBody(Number(bodySelect.value)); return; }
    if (e.target.matches('.garage__item input')) toggle(e.target.value, e.target.checked);
  }, options);

  // Вкладки: стрелки, Home и End — по ARIA-шаблону tablist.
  $('.garage__tabs').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    selectTab(tabs[(to + tabs.length) % tabs.length].dataset.tab, true);
  }, options);

  // Клавиатура в области 3D: поворот, приближение, общий вид.
  viewEl.addEventListener('keydown', (e) => {
    if (!scene || e.target !== viewEl) return;
    const step = {
      ArrowLeft: () => scene.rotateBy(-12, 0), ArrowRight: () => scene.rotateBy(12, 0),
      ArrowUp: () => scene.rotateBy(0, -6), ArrowDown: () => scene.rotateBy(0, 6),
      '+': () => scene.zoomBy(0.87), '=': () => scene.zoomBy(0.87), '-': () => scene.zoomBy(1.15),
      Home: () => scene.reset(), 0: () => scene.reset(),
    }[e.key];
    if (!step) return;
    e.preventDefault(); step(); hideHint();
  }, options);
  // Область 3D в порядке Tab — только когда модель готова.
  const observer = new MutationObserver(() => { viewEl.tabIndex = dialog.dataset.state === 'ready' ? 0 : -1; });
  observer.observe(dialog, { attributes: true, attributeFilter: ['data-state'] });

  addEventListener('mw:body', renderSelection, options);
  motion.addEventListener('change', () => scene?.setReducedMotion(reduced()), options);
  // Вкладку скрыли — сцена стоит сама (visibilitychange внутри модуля).

  return {
    open,
    close,
    get isOpen() { return active; },
    get state() { return dialog.dataset.state; },
    destroy() { close(); observer.disconnect(); resizeWatch.disconnect(); abort.abort(); dialog.remove(); },
  };
}
