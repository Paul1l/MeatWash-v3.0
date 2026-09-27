// «Оживить Porsche»: кнопка и ракурсы первого экрана, переключатель «Показать
// в 3D» в «Гараже услуг». Сама сцена (three, модель) — в porsche3d.bundle.js и
// грузится только import() по нажатию: до этого ни движок, ни модель, ни
// декодеры не запрашиваются (это проверяет npm run check).
//
// Состояния ряда .p3d (data-state): idle → loading → on, либо error.
// #scene[data-p3d]: off | loading | on | error — «on», только когда 3D на экране.
// Включённый 3D остаётся фоном всей сцены: камера и эффекты глав ведутся
// прокруткой (как в v1.0), фото-кадры под canvas не меняются. В статичном
// режиме и при «уменьшить движение» 3D — только на первом экране (как в фазе 2).
// 3D видно, когда модель готова и: гараж открыт — включён его переключатель
// (и у работы есть ракурс), гараж закрыт — ряд первого экрана в режиме on.
// Отрисовка стоит, когда 3D не видно (ушли к главам, фото в гараже, диалог);
// «Обычный вид» и закрытие гаража освобождают видеопамять (dispose).

const GUARD_MS = 400;       // защита от двойного клика после смены состояния
const FADE_OUT_MS = 600;    // выход в обычный вид (как в porsche3d.css)
const TOUR_DELAY_MS = 1200; // проявление 900 мс + 300 мс паузы
const HINT_MS = 4000;
const HINT_KEY = 'p3d-hint-shown';

const smooth = (v, a, b) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

export function setupLive3d({section, reduced, getTarget, onCoverChange}) {
  const root = document.getElementById('p3d');
  const stage = document.getElementById('p3d-stage');
  const live = document.getElementById('p3d-live');
  if (!root || !stage) return null;
  const $ = s => root.querySelector(s);
  const start = $('[data-p3d="start"]'), label = $('.p3d__label'), pct = $('.p3d__pct'), bar = $('.p3d__bar');
  const cancelBtn = $('[data-p3d="cancel"]'), retry = $('[data-p3d="retry"]'), msg = $('.p3d__msg');
  const tourBtn = $('[data-p3d="tour"]'), tourTxt = tourBtn.querySelector('.p3d__txt'), exit = $('[data-p3d="exit"]');
  const views = [...root.querySelectorAll('[data-p3d-view]')], hint = $('.p3d__hint');
  // «Обычный вид» в главах: ряд первого экрана там скрыт вместе с .hero-bar.
  const float = document.querySelector('[data-p3d-float]');
  const skipLink = document.querySelector('.scene__skip');
  const listeners = new AbortController(), on = {signal: listeners.signal};

  let mode = 'idle';            // ряд первого экрана
  let scene = null;             // handle из mount(), когда первый кадр нарисован
  let job = null;               // {controller, owner} — идёт загрузка
  let toured = false;           // показ — один раз за загрузку страницы
  let tourTimer = 0, hintTimer = 0, disposeTimer = 0;
  let guardUntil = 0;
  let progress = 0, away = false, staticMode = false, covering = false;
  // «Обычный вид» встаёт под курсор на место «Оживить Porsche»: первую секунду
  // клик по нему засчитываем, только если курсор успел уйти с кнопки.
  let exitArmedAt = 0;
  exit.addEventListener('pointerleave', () => { exitArmedAt = 0; });
  const cfg = {open: false, want: false, error: false, disabled: false, photo: false, button: null, msg: null, panel: null, refresh: null};
  // Гараж пересчитывает свою работу (кадр, шторка, камера): configurator.retarget.
  const refreshGarage = () => { if (cfg.refresh) cfg.refresh(); else target(getTarget?.()); };

  // ── Поддержка WebGL ───────────────────────────────────────────────────────
  // Кнопку показываем, если браузер знает WebGL 2; настоящую проверку контекста
  // делаем в простое после загрузки — движок и модель при этом не грузятся.
  // Модуль грузится после страницы (main.js). До нажатия проверяем WebGL 2
  // только по наличию API (класс p3d-capable из <head>): пробный контекст стоил
  // до 0,7 с на свежем браузере. Настоящая проверка — в mount() по нажатию.
  if (!('WebGL2RenderingContext' in window)) {
    document.documentElement.classList.remove('p3d-capable');
    return null;
  }
  // Стили кнопки, ракурсов и слоя сцены — с той же версией (?v=), что и модуль.
  const version = new URL(import.meta.url).searchParams.get('v');
  const css = new URL('../css/porsche3d.css', import.meta.url);
  if (version) css.searchParams.set('v', version);
  if (!document.querySelector('link[data-p3d-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = css.href; link.dataset.p3dCss = '';
    link.addEventListener('load', () => { root.hidden = false; }, {once: true});
    document.head.appendChild(link);
  } else root.hidden = false;

  const say = text => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = text; }); };
  const reducedNow = () => reduced() || staticMode;
  // Камера по главам — только в живой витрине и без «уменьшить движение».
  const chapters = () => !reducedNow();
  const visible = () => !!scene && (cfg.open ? cfg.want && !cfg.photo : mode === 'on');

  // ── Отображение ───────────────────────────────────────────────────────────
  function setMode(next) {
    mode = next;
    root.dataset.state = next;
    guardUntil = performance.now() + GUARD_MS;
    root.toggleAttribute('aria-busy', next === 'loading');
    if (next === 'loading') start.setAttribute('aria-disabled', 'true'); else start.removeAttribute('aria-disabled');
    if (next !== 'loading') { label.textContent = 'Оживить Porsche'; pct.textContent = ''; setBar(null, false); }
    render();
  }
  function setBar(ratio, indeterminate) {
    for (const host of [start, cfg.button]) {
      if (!host) continue;
      host.style.setProperty('--p3d-progress', ratio == null ? '0' : ratio.toFixed(3));
      host.querySelector('.p3d__bar')?.classList.toggle('is-indeterminate', indeterminate);
    }
  }
  function render() {
    const shown = visible();
    section.dataset.p3d = shown ? 'on' : job ? 'loading' : mode === 'error' ? 'error' : 'off';
    stage.classList.toggle('is-live', shown);
    applyOpacity();
    if (scene) scene.setSuspended('hidden', !shown);
    renderGarage();
    layout();
    renderFloat();
    // 3D закрывает фото-витрину: main.js перестаёт менять её кадры, а когда 3D
    // уходит — сразу ставит кадр текущего места прокрутки.
    const next = shown && chapters() && !cfg.open;
    if (next !== covering) { covering = next; onCoverChange?.(covering); }
  }
  function renderFloat() {
    if (!float) return;
    float.hidden = !(mode === 'on' && scene && chapters() && !cfg.open && progress >= .09);
  }
  function applyOpacity() {
    const canvas = scene?.canvas;
    if (!canvas) return;
    // Гараж открыт или камера идёт по главам — 3D целиком; в статичном режиме
    // и при «уменьшить движение» уходит вместе с первым экраном.
    const amount = cfg.open || staticMode || chapters() ? 1 : 1 - smooth(progress, .02, .09);
    canvas.style.opacity = amount.toFixed(3);
    scene.setSuspended('away', amount <= 0.001);
  }
  function renderGarage() {
    const button = cfg.button;
    if (!button) return;
    const busy = !!job && cfg.want;
    button.setAttribute('aria-pressed', String(cfg.want));
    button.toggleAttribute('aria-busy', busy);
    if (busy) button.setAttribute('aria-busy', 'true');
    if (cfg.disabled) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    button.classList.toggle('is-error', cfg.error);
    if (cfg.msg) cfg.msg.hidden = !cfg.error;
  }
  function pressViews(name) {
    for (const button of views) button.setAttribute('aria-pressed', String(button.dataset.p3dView === name));
  }
  function setTouring(playing) {
    tourBtn.toggleAttribute('data-playing', playing);
    tourTxt.textContent = playing ? 'Остановить показ' : 'Повторить показ';
  }
  root.toggleAttribute('data-reduced', reducedNow());

  // Свободная часть кадра для камеры. На компьютере первый экран — весь кадр
  // (общий вид совпадает с фото); на телефоне — полоса между шапкой и текстом
  // первого экрана; в гараже — место рядом с панелью (или над ней).
  function layout() {
    if (!scene) return;
    const box = stage.getBoundingClientRect();
    const header = document.getElementById('header')?.getBoundingClientRect();
    let top = header ? Math.max(0, header.bottom - box.top) : 0;
    // Телефон: верх свободной зоны — под кнопкой «Гараж услуг», иначе крыша уходит под неё.
    const cfgButton = document.querySelector('.scene__cfg');
    if (matchMedia('(max-width: 900px) and (orientation: portrait)').matches && cfgButton?.offsetParent) {
      top = Math.max(top, cfgButton.getBoundingClientRect().bottom - box.top + 12);
    }
    const area = {};
    if (cfg.open && cfg.panel && !cfg.panel.hidden) {
      area.top = top;
      const panel = cfg.panel.getBoundingClientRect();
      if (panel.left > box.left + box.width * 0.4) area.right = Math.max(0, box.right - panel.left + 16);
      else area.bottom = Math.max(0, box.bottom - panel.top);
    } else if (!cfg.open && chapters() && progress >= .02) {
      // Главы: текст слева (компьютер, альбом) или внизу (телефон в портрете).
      const text = document.querySelector('.chapter[data-chapter="body"]')?.getBoundingClientRect();
      area.top = top;
      if (text && matchMedia('(max-width: 900px) and (orientation: portrait)').matches) area.bottom = Math.max(0, box.bottom - text.top + 8);
      else if (text) area.left = Math.max(0, Math.min(box.width * 0.45, text.right - box.left + 16));
    } else if (!cfg.open && matchMedia('(max-width: 900px) and (orientation: portrait)').matches) {
      // Верх текста, а не блока: в статичном режиме у .hero большой верхний отступ.
      const hero = (document.querySelector('.hero__eyebrow') || document.querySelector('.hero'))?.getBoundingClientRect();
      if (hero) { area.top = top; area.bottom = Math.max(0, box.bottom - hero.top + 8); }
    }
    scene.setSafeArea(area);
  }

  // ── Загрузка ──────────────────────────────────────────────────────────────
  // Адрес — строкой: так его видит npm run check, а stamp-assets ставит ?v=.
  // Неудачный import() браузер запоминает, поэтому повтор после сбоя идёт по
  // адресу с ?retry=N (и той же версией ?v=).
  let importFailures = 0;
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
      throw error;
    }
  }
  async function load(owner) {
    if (job) return;
    // Сцена ещё гаснет после «Обычного вида» — просто возвращаем её.
    if (scene) {
      clearTimeout(disposeTimer);
      if (owner === 'hero' && mode !== 'on') { setMode('loading'); ready(owner); }
      return;
    }
    clearTimeout(disposeTimer);
    const controller = new AbortController();
    const mine = job = {controller, owner};
    // Из гаража ряд первого экрана не меняется: включили только там — после
    // закрытия гаража снова фото.
    if (owner === 'hero' && mode !== 'loading') setMode('loading');
    if (mode === 'loading') label.textContent = 'Загружаем 3D';
    setBar(null, true);
    cfg.error = false;
    render();
    say('Загружаем 3D-модель Porsche.');
    try {
      const {mount} = await importBundle();
      if (controller.signal.aborted) throw new DOMException('Загрузка 3D отменена', 'AbortError');
      const handle = await mount({
        container: stage,
        signal: controller.signal,
        reducedMotion: reducedNow(),
        fadeIn: false,
        startView: reducedNow() || toured ? 'overview' : 'hero',
        onProgress({ratio}) {
          const known = ratio != null;
          if (mode === 'loading') pct.textContent = known ? Math.round(ratio * 100) + '%' : '';
          setBar(known ? ratio : null, !known);
        },
        onPhase(phase) {
          if (phase !== 'prepare') return;
          if (mode === 'loading') { label.textContent = 'Готовим сцену'; pct.textContent = ''; }
          setBar(null, true);
        },
        onViewChange(name) {
          pressViews(name);
          if (name !== 'tour') setTouring(false);
        },
        onTourEnd() {
          setTouring(false);
          say('Показ закончен. Поворачивайте машину или выбирайте ракурс.');
          showHint();
        },
        onInteract() { clearTimeout(tourTimer); },
        onError(error) { fail(error); },
      });
      // Загрузку успели отменить или начать заново — эта сцена не нужна.
      if (job !== mine || controller.signal.aborted) { handle.dispose(); return; }
      scene = handle;
      job = null;
      ready(owner);
    } catch (error) {
      // Отменённая загрузка не трогает новую, начатую после неё.
      if (job !== mine) return;
      job = null;
      if (error?.name === 'AbortError') {
        if (mode === 'loading') setMode('idle'); else render();
        return;
      }
      console.warn('3D-режим не запустился, остаётся фото.', error);
      fail(error);
    }
  }

  function ready(owner) {
    const heroWanted = mode === 'loading';
    // Сцена могла загрузиться, когда человек уже в главах или в гараже.
    scene.setProgress(progress, {camera: chapters() && !cfg.open});
    if (heroWanted) {
      const focus = document.activeElement;
      setMode('on');
      exitArmedAt = performance.now() + 1000;
      if (focus === start || focus === document.body || !focus) exit.focus({preventScroll: true});
    } else render();
    if (cfg.open && heroWanted && !cfg.disabled) cfg.want = true;
    if (cfg.open && cfg.want) {
      // Включили из гаража: камера к детали выбранной работы, без показа.
      refreshGarage();
      say('Porsche в 3D. Камера показывает выбранную работу.');
      return;
    }
    if (!heroWanted) return;
    if (reducedNow() || toured) {
      pressViews('overview');
      say('Porsche в 3D. Выберите ракурс или поверните машину.');
      showHint();
      return;
    }
    say('Porsche в 3D. Идёт показ, около 7 секунд.');
    scheduleTour();
  }

  // Показ — через 300 мс после проявления; если человек уже ниже первого
  // экрана, — при первом появлении 3D.
  function scheduleTour() {
    clearTimeout(tourTimer);
    if (toured || reducedNow()) return;
    setTouring(true);
    tourTimer = setTimeout(() => {
      if (!scene || mode !== 'on' || cfg.open) { setTouring(false); return; }
      if (away || progress > .02) { tourTimer = 0; setTouring(false); return; }
      toured = true;
      if (!scene.tour()) setTouring(false);
    }, TOUR_DELAY_MS);
  }

  function showHint() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (matchMedia('(orientation: landscape) and (max-height: 500px)').matches) return;
    try { if (sessionStorage.getItem(HINT_KEY)) return; sessionStorage.setItem(HINT_KEY, '1'); } catch { /* приватный режим */ }
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.classList.add('is-shown');
      hintTimer = setTimeout(() => hint.classList.remove('is-shown'), HINT_MS);
    }, 300);
  }

  function fail(error) {
    const lostContext = error?.code === 'context-lost';
    clearTimeout(tourTimer); setTouring(false);
    if (scene) { scene.dispose(); scene = null; }
    job = null;
    // Браузер знает WebGL 2, но контекст не создаётся (видеокарта в чёрном
    // списке и т. п.): повторять бесполезно.
    const noWebgl = error?.code === 'webgl';
    const text = lostContext ? '3D остановилось' : noWebgl ? '3D недоступно на этом устройстве' : 'Не удалось загрузить 3D';
    msg.textContent = text;
    retry.hidden = noWebgl;
    const focus = document.activeElement;
    if (cfg.want) { cfg.want = false; cfg.error = true; }
    if (cfg.msg) cfg.msg.textContent = lostContext ? '3D остановилось. Нажмите ещё раз.' : 'Не удалось загрузить 3D. Нажмите ещё раз.';
    if (mode === 'loading' || mode === 'on') {
      setMode('error');
      if (focus === start || focus === exit || root.contains(focus) || focus === document.body) retry.focus({preventScroll: true});
    } else render();
    say(lostContext ? '3D остановилось, показываем фото.' : noWebgl ? '3D недоступно на этом устройстве. Остаётся фото.' : 'Не удалось загрузить 3D. Остаётся фото.');
  }

  function cancel() {
    if (!job) return;
    job.controller.abort();
    job = null;
    cfg.want = false;
    if (mode === 'loading') setMode('idle'); else render();
    say('Загрузка отменена.');
  }

  // «Обычный вид» и закрытие гаража: 3D гаснет за 600 мс, затем сцена
  // освобождает видеопамять. Прокрутку не трогаем.
  function release() {
    clearTimeout(tourTimer); clearTimeout(disposeTimer);
    setTouring(false);
    if (!scene || visible()) return;
    const handle = scene;
    disposeTimer = setTimeout(() => {
      if (scene !== handle || visible()) return;
      handle.dispose(); scene = null; render();
    }, FADE_OUT_MS + 50);
  }

  function goIdle() {
    const inChapters = progress >= .09 && chapters();
    setMode('idle');
    release();
    // В главах кнопка первого экрана скрыта (inert): фокус — на «Все услуги ↓».
    (inChapters ? skipLink : start)?.focus({preventScroll: true});
  }

  // Работа гаража → камера. false — показываем фото (у модели нет детали).
  function target(id) {
    if (!scene || !cfg.want) return false;
    const shown = id ? scene.showService(id) : (scene.view('overview'), true);
    cfg.photo = !shown;
    render();
    return shown;
  }

  // ── События ряда ──────────────────────────────────────────────────────────
  root.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.p3d, view = button.dataset.p3dView;
    // Второй щелчок двойного клика не должен сразу отменить только что начатое.
    if (performance.now() < guardUntil && action !== 'tour' && !view) return;
    if (action === 'start') { if (mode === 'idle') load('hero'); return; }
    if (action === 'cancel') { cancel(); start.focus({preventScroll: true}); return; }
    if (action === 'retry') { setMode('idle'); load('hero'); return; }
    if (action === 'dismiss') { goIdle(); return; }
    if (action === 'exit') {
      if (performance.now() < exitArmedAt && e.detail > 0) return;
      goIdle(); say('Обычный вид.'); return;
    }
    if (action === 'tour' && scene) {
      clearTimeout(tourTimer);
      if (scene.touring || tourBtn.hasAttribute('data-playing')) { scene.stopTour(); setTouring(false); }
      else if (!reducedNow()) { toured = true; setTouring(scene.tour()); }
      return;
    }
    if (view && scene) { clearTimeout(tourTimer); setTouring(false); scene.view(view); }
  }, on);
  float?.addEventListener('click', () => {
    if (performance.now() < guardUntil) return;
    goIdle(); say('Обычный вид.');
  }, on);
  root.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (job) { e.preventDefault(); cancel(); start.focus({preventScroll: true}); }
    else if (scene?.touring || tourBtn.hasAttribute('data-playing')) { e.preventDefault(); clearTimeout(tourTimer); scene?.stopTour(); setTouring(false); }
    else if (mode === 'on') { e.preventDefault(); goIdle(); say('Обычный вид.'); }
  }, on);

  // Диалог (запись, услуга) поверх: сцена стоит, показ останавливается.
  const dialogs = [...document.querySelectorAll('dialog')];
  const dialogWatch = new MutationObserver(() => {
    const open = dialogs.some(d => d.open);
    if (open && scene?.touring) { scene.stopTour(); setTouring(false); }
    if (open) clearTimeout(tourTimer);
    scene?.setSuspended('dialog', open);
  });
  for (const dialog of dialogs) dialogWatch.observe(dialog, {attributes: true, attributeFilter: ['open']});
  addEventListener('resize', () => layout(), {...on, passive: true});

  // ── Для main.js и configurator.js ─────────────────────────────────────────
  return {
    // Прогресс сцены (apply в main.js): 3D уходит на 0.02–0.09 вместе с рядом.
    progress(p) {
      const crossed = (p >= .02) !== (progress >= .02);
      progress = p;
      const wasAway = away;
      away = !cfg.open && !staticMode && !chapters() && p >= .09;
      if (scene) scene.setProgress(p, {camera: chapters() && !cfg.open});
      if (crossed) layout();
      renderFloat();
      if (chapters() && p > .02 && scene?.touring) setTouring(false);
      if (chapters() && p <= .02 && scene && mode === 'on' && !toured && !tourTimer) scheduleTour();
      section.toggleAttribute('data-p3d-away', away);
      if (away && !wasAway && scene?.touring) { scene.stopTour(); setTouring(false); }
      if (!away && wasAway && scene && mode === 'on' && !toured && !reducedNow()) scheduleTour();
      applyOpacity();
    },
    // Статичный режим: 3D остаётся, но без показа и параллакса.
    setStatic() {
      staticMode = true; away = false; progress = 0;
      section.removeAttribute('data-p3d-away');
      root.toggleAttribute('data-reduced', true);
      clearTimeout(tourTimer); setTouring(false);
      scene?.setReducedMotion(true);
      applyOpacity();
    },
    // Гараж услуг.
    garage: {
      bind({button, message, panel, refresh}) {
        cfg.button = button; cfg.msg = message; cfg.panel = panel; cfg.refresh = refresh;
        if (root.hidden && !('WebGL2RenderingContext' in window)) button.hidden = true;
        button.addEventListener('click', () => {
          if (cfg.disabled || performance.now() < guardUntil) return;
          guardUntil = performance.now() + GUARD_MS;
          if (job && cfg.want) { cancel(); return; }
          cfg.error = false;
          if (cfg.want) { cfg.want = false; cfg.photo = false; render(); refreshGarage(); if (mode !== 'on') release(); return; }
          cfg.want = true; cfg.photo = false;
          if (scene) { clearTimeout(disposeTimer); refreshGarage(); }
          else { render(); load('cfg'); }
        }, on);
        renderGarage();
      },
      open() {
        cfg.open = true; cfg.error = false; cfg.photo = false;
        cfg.want = !!scene && mode === 'on';
        clearTimeout(tourTimer);
        if (scene?.touring) { scene.stopTour(); setTouring(false); }
        // В гараже камеру ведёт работа, а не прокрутка глав.
        scene?.setProgress(progress, {camera: false});
        render();
      },
      close() {
        cfg.open = false; cfg.photo = false;
        scene?.setProgress(progress, {camera: chapters()});
        const had = cfg.want; cfg.want = false; cfg.error = false;
        if (job && job.owner === 'cfg' && mode !== 'loading') cancel();
        if (scene && mode === 'on') { scene.view('overview'); render(); }
        else { render(); if (had || scene) release(); }
      },
      // Работа выбрана или показ перешёл к ней. true — её показывает 3D.
      target(id) { return cfg.open ? target(id) : false; },
      // Показ и ролик гаража — на фото с парами «до/после».
      showing(active) {
        cfg.disabled = active;
        if (active && cfg.want) { cfg.want = false; cfg.photo = false; if (job) cancel(); }
        render();
      },
      get active() { return cfg.open && cfg.want && !!scene && !cfg.photo; },
    },
    get covering() { return covering; },
    destroy() {
      clearTimeout(tourTimer); clearTimeout(hintTimer); clearTimeout(disposeTimer);
      job?.controller.abort(); scene?.dispose(); scene = null;
      dialogWatch.disconnect(); listeners.abort();
    },
  };
}
