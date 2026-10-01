// Каталог на services.html (разметку собирает scripts/catalog.mjs):
// - четыре категории — вкладки WAI-ARIA (tablist/tab/tabpanel, стрелки, Home/End,
//   roving tabindex). Без JS переключатели — ссылки, панели идут подряд: прячет их
//   только этот модуль. Якоря (#price-film, #program-2, #price-help…) открывают
//   вкладку, в которой лежит цель;
// - переключатель кузова меняет цены программ, подпись и контекст кнопок записи
//   («Трёхфазная — Кроссовер, 2 250 ₽»). Выбор кузова общий с «Гаражом услуг» (body.js);
// - работы мойки, которых нет в онлайн-записи, помечены «на месте».
import { PROGRAMS } from './data.js';
import { getBody, setBody, bodyName } from './body.js';

const money = (n) => n.toLocaleString('ru-RU') + ' ₽';
const byHash = (hash) => {
  try { return hash && hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; } catch { return null; }
};

// Работы мойки, которые не продаются в онлайн-записи, помечаются прямо в прайсе:
// человек видит это там же, где смотрит цену, а не после нажатия «Записаться».
// Остальные категории идут по заявке с фото — там YCLIENTS не участвует.
function markOnSite() {
  const rows = [...document.querySelectorAll('#price-wash [data-price-item]')];
  if (!rows.length) return;
  import('./yclients.js').then((yc) => yc.loadMap().then(() => {
    for (const row of rows) {
      const name = row.dataset.priceItem;
      if (!name || row.dataset.onsite) continue;
      const online = ['myasnitskaya', 'technopark']
        .some((b) => yc.resolve(b, { programs: [], items: [name] }, 0).ids.length);
      if (online) continue;
      row.dataset.onsite = '1';
      const tag = document.createElement('span');
      tag.className = 'catalog__onsite';
      tag.textContent = 'на месте';
      tag.title = 'Приобретается на месте: мастер добавит работу при приёмке автомобиля';
      row.querySelector('.catalog__item-name')?.append(' ', tag);
    }
  })).catch(() => {});
}

// Вкладки категорий. ui.js (setupUI вызывается раньше) уже раскрывает <details>
// по якорю и прокручивает к нему в requestAnimationFrame — к этому времени панель
// здесь уже открыта. Отступ под шапку — scroll-padding-top у html; у панели ещё
// scroll-margin-top на высоту вкладок (catalog.css), чтобы они оставались видны.
function setupTabs(signal) {
  const root = document.getElementById('catalog');
  const list = root?.querySelector('[data-catalog-tabs]');
  if (!list) return;
  const tabs = [...list.querySelectorAll('a[href^="#"]')];
  const panels = tabs.map((tab) => byHash(tab.getAttribute('href')));
  if (!tabs.length || panels.some((panel) => !panel || !root.contains(panel))) return;

  list.setAttribute('role', 'tablist');
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panels[i].id);
    // Без href вкладка — не переход по якорю: ui.js не прокручивает к панели и не
    // уводит фокус с вкладки.
    tab.removeAttribute('href');
    panels[i].setAttribute('role', 'tabpanel');
    panels[i].setAttribute('aria-labelledby', tab.id);
    // Панель не фокусируемая: в ней есть кнопки, Tab с вкладки ведёт к первой (APG
    // это допускает). С tabindex Chromium фокусировал панель при заходе по якорю
    // (#price-protection) и рисовал рамку фокуса вокруг всей панели.
  });
  root.classList.add('is-tabs');

  const select = (i, focus = false) => {
    if (!(i >= 0 && i < tabs.length)) return;
    tabs.forEach((tab, j) => {
      tab.setAttribute('aria-selected', String(j === i));
      tab.tabIndex = j === i ? 0 : -1;
      panels[j].hidden = j !== i;
    });
    if (focus) tabs[i].focus();
  };
  // Цель якоря в каталоге: открыть её вкладку и <details> программы.
  const reveal = (target) => {
    if (!target || !root.contains(target)) return false;
    const panel = target.closest('[role="tabpanel"]');
    if (panel) select(panels.indexOf(panel));
    if (target.tagName === 'DETAILS') target.open = true;
    return true;
  };

  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tabs.indexOf(tab));
  }, { signal });
  list.addEventListener('keydown', (event) => {
    const i = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (i < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const last = tabs.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[event.key];
    if (next != null) { event.preventDefault(); select(next, true); }
    // У ссылки без href Enter и пробел ничего не делают; пробел ещё и листал бы страницу.
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(i); }
  }, { signal });

  // Открыта «Мойка», если адрес не ведёт в другую категорию. Браузер уже прокрутил
  // к цели, пока панели шли подряд, — встаём к ней ещё раз после скрытия остальных
  // и после шрифтов (они меняют высоту строк), если человек не прокрутил сам.
  select(0);
  const arrival = byHash(location.hash);
  if (reveal(arrival)) {
    let placed = -1;
    const settle = () => {
      if (placed >= 0 && Math.abs(scrollY - placed) > 2) return;
      arrival.scrollIntoView({ behavior: 'instant' });
      placed = scrollY;
    };
    requestAnimationFrame(settle);
    document.fonts?.ready.then(() => requestAnimationFrame(settle));
  }
  // Хеш сменили на открытой странице (адресная строка, «назад»).
  addEventListener('hashchange', () => {
    const target = byHash(location.hash);
    if (reveal(target)) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'instant' }));
  }, { signal });
  // Ссылка на якорь этой страницы: ui.js перехватывает её и сам прокручивает к цели
  // (hashchange не будет). Перехват при всплытии, поэтому вкладку открываем раньше —
  // на погружении.
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="#"]');
    if (link) reveal(byHash(link.getAttribute('href')));
  }, { capture: true, signal });
}

// Тип кузова: цены программ, подпись и контекст кнопок записи.
function setupBody(signal) {
  const types = document.querySelector('.body-types');
  if (!types) return;
  const label = document.getElementById('body-price-label');

  function render(i) {
    const input = types.querySelector(`input[value="${i}"]`);
    if (input) input.checked = true;
    document.querySelectorAll('[data-program-price]').forEach((price) => {
      price.textContent = money(Number(price.dataset.prices.split(',')[i]));
    });
    if (label) label.textContent = 'Цены для типа кузова: ' + bodyName(i);
    // Формат тот же, что в scripts/catalog.mjs (programContext).
    document.querySelectorAll('[data-book][data-program]').forEach((button) => {
      const program = PROGRAMS[Number(button.dataset.program)];
      if (program) button.dataset.bookContext = `${program.name} — ${bodyName(i)}, ${money(program.prices[i])}`;
    });
  }

  types.addEventListener('change', (event) => {
    if (event.target.name === 'body-type') setBody(Number(event.target.value));
  }, { signal });
  addEventListener('mw:body', (event) => render(event.detail), { signal });
  // Кузов, выбранный раньше в этом визите (здесь или в гараже на главной).
  const saved = getBody();
  if (saved) render(saved);
}

export function setupCatalog() {
  const abort = new AbortController();
  setupTabs(abort.signal);
  setupBody(abort.signal);
  markOnSite();
  return () => abort.abort();
}
