// Каталог на services.html: переключатель кузова меняет цены программ, подпись
// и контекст кнопок записи («Трёхфазная — Кроссовер, 2 250 ₽»). Раскрытие —
// нативные <details>. Выбор кузова общий с «Гаражом услуг» (body.js).
import { PROGRAMS } from './data.js';
import { getBody, setBody, bodyName } from './body.js';

const money = (n) => n.toLocaleString('ru-RU') + ' ₽';

// Работы мойки, которые не продаются в онлайн-записи, помечаются прямо в прайсе:
// человек видит это там же, где смотрит цену, а не после нажатия «Записаться».
// Остальные категории идут по заявке с фото — там YCLIENTS не участвует.
function markOnSite() {
  const rows = [...document.querySelectorAll('#price-wash [data-price-item]')];
  if (!rows.length) return;
  import('./yclients.js').then((yc) => yc.loadMap().then(() => {
    for (const row of rows) {
      const name = row.querySelector('dt')?.firstChild?.textContent?.trim();
      if (!name) continue;
      const online = ['myasnitskaya', 'technopark']
        .some((b) => yc.resolve(b, { programs: [], items: [name] }, 0).ids.length);
      if (online || row.dataset.onsite) continue;
      row.dataset.onsite = '1';
      const tag = document.createElement('span');
      tag.className = 'catalog__onsite';
      tag.textContent = 'на месте';
      tag.title = 'Приобретается на месте: мастер добавит работу при приёмке автомобиля';
      row.querySelector('dt').append(' ', tag);
    }
  })).catch(() => {});
}

export function setupCatalog() {
  markOnSite();
  const types = document.querySelector('.body-types');
  if (!types) return () => {};
  const abort = new AbortController();
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
  }, { signal: abort.signal });
  addEventListener('mw:body', (event) => render(event.detail), { signal: abort.signal });
  // Кузов, выбранный раньше в этом визите (здесь или в гараже на главной).
  const saved = getBody();
  if (saved) render(saved);
  return () => abort.abort();
}
