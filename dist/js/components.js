// Поведение компонентов (план §2.8). Владелец: WP1.
//   - вкладки-якоря [data-anchor-tabs]: какая секция на экране → aria-current="true";
//     у любой ленты .anchor-tabs (и у вкладок каталога) — затухание у края и кнопка «›»;
//   - панель страницы [data-page-bar]: въезжает после героя, красная полоса прогресса;
//   - аккордеон details.accordion: плавное раскрытие (.4s) и сворачивание (.25s);
//   - карусель [data-carousel]: кнопки «назад/вперёд», точки страниц;
//   - мозаика .mosaic--zoom: масштаб 1,15 → 1 и подъём фото по прокрутке (от 1024 px).
// Без скрипта всё остаётся обычной разметкой: якоря, details, прокручиваемые ленты.
// При «уменьшить движение» — конечные состояния, без анимаций.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Вызов fn не чаще раза за кадр.
function perFrame(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

// ── Вкладки-якоря (P08) ─────────────────────────────────────────────────────
function setupTabStrip(nav) {
  const track = nav.querySelector('.anchor-tabs__track');
  if (!track) return;
  let more = nav.querySelector('.anchor-tabs__more');
  if (!more) {
    more = document.createElement('button');
    more.type = 'button';
    more.className = 'anchor-tabs__more';
    more.tabIndex = -1;
    more.setAttribute('aria-hidden', 'true');
    more.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    nav.append(more);
  }
  more.addEventListener('click', () => track.scrollBy({ left: track.clientWidth * .7, behavior: reduced() ? 'auto' : 'smooth' }));
  const sync = perFrame(() => {
    const max = track.scrollWidth - track.clientWidth;
    const state = [];
    if (track.scrollLeft > 2) state.push('start');
    if (max - track.scrollLeft > 2) state.push('end');
    if (state.length) nav.dataset.overflow = state.join(' '); else delete nav.dataset.overflow;
  });
  track.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(track);
  sync();
}

function setupAnchorTabs(nav) {
  const track = nav.querySelector('.anchor-tabs__track');
  const tabs = [...nav.querySelectorAll('a[href^="#"]')]
    .map((tab) => ({ tab, target: document.getElementById(decodeURIComponent(tab.getAttribute('href').slice(1))) }))
    .filter((t) => t.target);
  if (!tabs.length) return;
  let active = null;
  const show = (entry) => {
    if (entry === active) return;
    active = entry;
    tabs.forEach(({ tab }) => { if (tab === entry?.tab) tab.setAttribute('aria-current', 'true'); else tab.removeAttribute('aria-current'); });
    // Активная вкладка не уезжает за край ленты на телефоне (прокручиваем только ленту).
    if (entry && track && track.scrollWidth > track.clientWidth) {
      const t = entry.tab, left = t.offsetLeft - track.clientWidth / 2 + t.offsetWidth / 2;
      track.scrollTo({ left: Math.max(0, left), behavior: reduced() ? 'auto' : 'smooth' });
    }
  };
  // Активна последняя секция, верх которой выше линии на четверти экрана под панелью.
  const update = perFrame(() => {
    const line = nav.getBoundingClientRect().bottom + innerHeight * .25;
    let current = tabs[0];
    for (const t of tabs) if (t.target.getBoundingClientRect().top <= line) current = t;
    // Долистали до конца страницы — последняя вкладка, даже если секция короткая.
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) {
      const last = tabs[tabs.length - 1];
      if (last.target.getBoundingClientRect().top < innerHeight) current = last;
    }
    show(current);
  });
  // Пересчёт — когда секции входят в экран или выходят из него и при прокрутке.
  const io = new IntersectionObserver(update, { rootMargin: '0px 0px -50% 0px' });
  tabs.forEach(({ target }) => io.observe(target));
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update, { passive: true });
  update();
}

// ── Панель страницы с прогрессом (P06) ──────────────────────────────────────
function setupPageBar(bar) {
  const after = document.querySelector('[data-page-bar-after]') || document.querySelector('main > :first-child');
  const progress = bar.querySelector('.page-bar__progress');
  const update = perFrame(() => {
    const shown = after ? after.getBoundingClientRect().bottom < 0 : scrollY > innerHeight * .6;
    bar.classList.toggle('is-shown', shown);
    if (progress) {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty('--progress', max > 0 ? Math.min(1, Math.max(0, scrollY / max)).toFixed(4) : '0');
    }
  });
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update, { passive: true });
  update();
}

// ── Аккордеон (P21): .4s --ease-out на раскрытие, .25s --ease-color на сворачивание ──
function setupAccordion(details) {
  const summary = details.querySelector(':scope > summary');
  const body = details.querySelector(':scope > .accordion__body');
  if (!summary || !body || typeof body.animate !== 'function') return;
  let anim = null;
  const finish = (open) => { anim = null; details.open = open; body.style.height = ''; body.style.overflow = ''; };
  summary.addEventListener('click', (e) => {
    if (reduced()) return;
    e.preventDefault();
    const opening = anim ? anim.closing : !details.open;
    const from = body.getBoundingClientRect().height;
    anim?.cancel();
    if (opening) details.open = true;
    const to = opening ? body.scrollHeight : 0;
    body.style.overflow = 'hidden';
    const a = body.animate({ height: [`${opening && !anim ? 0 : from}px`, `${to}px`] },
      { duration: opening ? 400 : 250, easing: opening ? 'cubic-bezier(0, 0, .2, 1)' : 'cubic-bezier(.4, 0, .5, 1)' });
    a.closing = !opening;
    anim = a;
    a.onfinish = () => finish(opening);
    a.oncancel = () => { if (anim === a) anim = null; };
  });
}

// ── Карусель (P15) ──────────────────────────────────────────────────────────
function setupCarousel(root) {
  const track = root.querySelector('.carousel__track');
  if (!track) return;
  const prev = root.querySelector('[data-carousel-prev]');
  const next = root.querySelector('[data-carousel-next]');
  const behavior = () => (reduced() ? 'auto' : 'smooth');
  // Шаг — ширина видимой части ленты, выровненная по слайдам.
  const step = () => {
    const slide = track.querySelector('.carousel__slide');
    if (!slide) return track.clientWidth;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const per = Math.max(1, Math.round((track.clientWidth + gap) / (slide.offsetWidth + gap)));
    return per * (slide.offsetWidth + gap);
  };
  prev?.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: behavior() }));
  next?.addEventListener('click', () => track.scrollBy({ left: step(), behavior: behavior() }));

  let dots = root.querySelector('.carousel__dots');
  if (!dots) {
    dots = document.createElement('div');
    dots.className = 'carousel__dots';
    dots.setAttribute('role', 'group');
    dots.setAttribute('aria-label', 'Страницы');
    track.after(dots);
  }
  let pages = 0;
  const build = () => {
    const s = step();
    const n = s > 0 ? Math.max(1, Math.ceil((track.scrollWidth - track.clientWidth) / s - .05) + 1) : 1;
    if (n === pages) return;
    pages = n;
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'carousel__dot';
      b.setAttribute('aria-label', `Страница ${i + 1} из ${n}`);
      b.addEventListener('click', () => track.scrollTo({ left: i * step(), behavior: behavior() }));
      return b;
    }));
    dots.hidden = n < 2;
  };
  const sync = perFrame(() => {
    build();
    const max = track.scrollWidth - track.clientWidth;
    if (prev) prev.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = track.scrollLeft >= max - 2;
    const s = step();
    const page = track.scrollLeft >= max - 2 ? pages - 1 : Math.round(track.scrollLeft / (s || 1));
    [...dots.children].forEach((d, i) => { if (i === page) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
  });
  track.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(track);
  sync();
}

// ── Мозаика с зумом (P16): только от 1024 px и без «уменьшить движение» ───────
function setupMosaicZoom(list) {
  const mq = matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)');
  const visible = new Set();
  const update = perFrame(() => {
    for (const el of visible) {
      const r = el.getBoundingClientRect();
      // 1 — блок только показался снизу, 0 — верх блока поднялся на четверть экрана.
      const k = Math.min(1, Math.max(0, (r.top - innerHeight * .25) / (innerHeight * .75)));
      el.style.setProperty('--zoom', k.toFixed(4));
    }
  });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
    update();
  });
  const apply = () => {
    list.forEach((el) => {
      el.classList.toggle('is-live', mq.matches);
      if (mq.matches) io.observe(el); else { io.unobserve(el); visible.delete(el); el.style.removeProperty('--zoom'); }
    });
    update();
  };
  mq.addEventListener('change', apply);
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update, { passive: true });
  apply();
}

export function setupComponents() {
  document.querySelectorAll('.anchor-tabs').forEach(setupTabStrip);
  document.querySelectorAll('[data-anchor-tabs]').forEach(setupAnchorTabs);
  document.querySelectorAll('[data-page-bar]').forEach(setupPageBar);
  document.querySelectorAll('details.accordion').forEach(setupAccordion);
  document.querySelectorAll('[data-carousel]').forEach(setupCarousel);
  const zoom = [...document.querySelectorAll('.mosaic--zoom')];
  if (zoom.length) setupMosaicZoom(zoom);
}
