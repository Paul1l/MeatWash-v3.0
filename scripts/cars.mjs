// Машины: данные — src/data/cars.json (перенос один к одному из прежнего auto.html,
// поправка критика 29: файл нужен только сборке), вывод — подстановки страниц:
//   {{cars:sale}}  карточки «Сейчас в продаже» (P18, §4.6 плана): article.car-card#<id>
//   {{cars:sold}}  «Уже продали»: li.sold-card × N (обёртку ul пишет страница)
//   {{cars:date}}  дата цен: «22 сентября 2026 года»
//   {{count:sale}}, {{count:sold}}, {{count:sold:машина}} — считает scripts/pages.mjs по этим данным.
// Владелец: WP0 (заготовка по контракту §4.6) → WP4.
import {readFile} from 'node:fs/promises';
import {content, escape, money} from './catalog.mjs';

const root = new URL('../', import.meta.url);
export const cars = JSON.parse(await readFile(new URL('src/data/cars.json', root), 'utf8'));

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y} года`; };
const tel = () => content.locations.find((l) => l.id === 'myasnitskaya').tel;

const photo = (p, eager = false) => `<li><img src="${escape(p.src)}" width="${p.w}" height="${p.h}" alt="${escape(p.alt)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"></li>`;

export function renderSale() {
  return cars.forSale.map((car) => `<article class="car-card" id="${escape(car.id)}" aria-labelledby="car-${escape(car.id)}-title">
  <ul class="strip${car.tall ? ' strip--tall' : ''}" tabindex="0" aria-label="Фотографии ${escape(car.title)}">${car.photos.map((p) => photo(p)).join('')}</ul>
  <div class="car-card__body">
    <h3 class="car-card__title" id="car-${escape(car.id)}-title">${escape(car.title)}, ${car.year}</h3>
    <p class="car-card__facts">${car.facts.map(escape).join(' · ')}</p>
    <p class="car-card__price">${money(car.price)}${car.priceVat ? ` <span>с НДС — ${money(car.priceVat)}</span>` : ''}</p>
    <p class="car-card__lead">${escape(car.lead)}</p>
    <ul class="car-card__specs">${car.specs.map((s) => `<li>${escape(s)}</li>`).join('')}</ul>
${car.prepared ? `    <p class="car-card__prep">Подготовили в Meat Auto: ${escape(car.prepared)}.</p>\n` : ''}    <div class="car-card__actions">
      <a class="btn btn--primary" href="${escape(cars.contact)}" target="_blank" rel="noopener">Спросить о машине<span class="sr"> в Telegram</span></a>
      <a class="btn btn--secondary" href="tel:${escape(tel())}">Позвонить</a>
    </div>
  </div>
</article>`).join('\n');
}

export function renderSold() {
  return cars.sold.map((car) => `<li class="sold-card"><img src="${escape(car.src)}" width="${car.w}" height="${car.h}" alt="${escape(car.alt)}" loading="lazy" decoding="async"><h3 class="sold-card__name">${escape(car.title)}</h3><span class="chip">Продан</span></li>`).join('\n');
}

export const renderCarsDate = () => longDate(cars.pricesDate);
