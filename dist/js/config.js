// «Гараж услуг»: работы, категории, наборы и правила расчёта.
// Цены и названия — только из assets/meatwash-content.json: data.js генерирует
// npm run catalog. Здесь — ссылки на позиции каталога, а не числа.
import { PROGRAMS, PRICES, CATEGORIES } from './data.js';

const item = name => { if (!(name in PRICES)) throw new Error('Нет цены в каталоге: ' + name); return PRICES[name]; };

// Вкладки — восемь категорий каталога (meatwash-content.json → groups) в том же
// порядке и с теми же короткими названиями. booking: yclients — мойка (запись
// в филиал), request — остальные работы (заявка с фото).
export const ZONE_GROUPS = CATEGORIES.map(c => ({ id: c.id, title: c.short, full: c.title, booking: c.booking }));

// price  — позиция каталога: { program: i } — программа или пакет мойки (цена
//          зависит от кузова), { item: "название" } — работа из прайса (цена
//          null — после осмотра). Название в гараже — то же, что в каталоге
//          (title ниже подставляется из него).
// caption — что делает работа, одной фразой; у программ и пакетов — описание
//          из каталога.
// Ракурс камеры для каждой работы — src/porsche3d/views.js (SERVICE_VIEWS).
export const ZONES = [
  { id: 'three-phase', group: 'wash', price: { program: 0 } },
  { id: 'complex', group: 'wash', price: { program: 1 } },
  { id: 'reagents', group: 'wash', price: { program: 2 } },
  { id: 'exterior', group: 'wash', price: { program: 3 } },
  { id: 'premium', group: 'wash', price: { program: 4 } },
  // Химчистка в гараже — салон целиком, а не набор сидений и деталей:
  // отдельные элементы остаются в подробном прайсе.
  { id: 'interior', group: 'interior', price: { item: 'Детейлинг-химчистка салона' },
    caption: 'Салон целиком за один визит: ткань, алькантара и кожа.' },
  { id: 'leather', group: 'leather', price: { item: 'Кондиционер кожи сидений' },
    caption: 'Питание и защита кожи сидений после чистки.' },
  { id: 'polish', group: 'polish', price: { item: 'Полировка кузова + 2 слоя керамики' },
    caption: 'Снимаем паутинку — отражение становится ровным.' },
  { id: 'ceramic', group: 'polish', price: { item: 'Керамическое покрытие кузова' },
    caption: 'Вода собирается в каплю и уходит, не оставляя следов.' },
  { id: 'headlights', group: 'polish', price: { item: 'Полировка фар' },
    caption: 'Мутный поликарбонат снова даёт чёткий пучок света.' },
  { id: 'film', group: 'film', price: { item: 'Оклейка зон риска' },
    caption: 'Защитная плёнка на участки кузова, которые первыми принимают удары камней.' },
  { id: 'film-full', group: 'film', price: { item: 'Полная оклейка' },
    caption: 'Защитная плёнка на весь кузов. Стоимость — после осмотра автомобиля.' },
  { id: 'film-lights', group: 'film', price: { item: 'Оклейка фар плёнкой' },
    caption: 'Защитная плёнка на фары.' },
  { id: 'glass-repair', group: 'glass', price: { item: 'Ремонт автомобильных стёкол' },
    caption: 'Стоимость — после осмотра повреждения: приложите фото к заявке.' },
  { id: 'armor', group: 'glass', price: { item: 'Бронирование лобового стекла' },
    caption: 'Защитная плёнка на лобовое стекло.' },
  { id: 'rain', group: 'glass', price: { item: 'Антидождь передней полусферы' },
    caption: 'Лобовое и передние боковые стёкла: на скорости вода срывается сама.' },
  { id: 'rain-all', group: 'glass', price: { item: 'Антидождь всех стёкол автомобиля' },
    caption: 'Гидрофобная защита всех стёкол автомобиля.' },
  { id: 'wheels', group: 'components', price: { item: 'Детейлинг дисков' },
    caption: 'Уход за колёсными дисками.' },
  { id: 'chips', group: 'bodywork', price: { item: 'Удаление сколов и подкраска' },
    caption: 'Точечно по месту, без перекраса всего элемента.' },
];
for (const zone of ZONES) {
  const program = zone.price.program != null ? PROGRAMS[zone.price.program] : null;
  zone.title = program ? program.name : zone.price.item;
  zone.package = Boolean(program && /^Пакет/.test(program.name));
  if (program) zone.caption = program.description;
  else item(zone.price.item);
}

// Взаимоисключающие работы — вторая заменяет первую:
// - программы и пакеты мойки вложены друг в друга («каждая следующая включает
//   предыдущую»), две сразу посчитали бы мойку дважды;
// - «Полировка кузова + 2 слоя керамики» уже с керамикой — вместе с «Керамическим
//   покрытием» керамика считалась бы дважды;
// - полная оклейка включает зоны риска, антидождь всех стёкол — передние.
export const EXCLUSIVE = [
  ['three-phase', 'complex', 'reagents', 'exterior', 'premium'],
  ['polish', 'ceramic'],
  ['film', 'film-full'],
  ['rain', 'rain-all'],
];

// Состав программы или пакета i позициями каталога — с составом всех предыдущих
// (они вложены): programItems в JSON.
const programItems = i => PROGRAMS.slice(0, i + 1).flatMap(p => p.items || []);
// Программа из выбранных, в которую уже входит работа: «Пакет «Экстерьер»»
// включает «Антидождь передней полусферы». Такая работа отдельно не выбирается
// и в сумму второй раз не попадает.
export function includedIn(zone, ids) {
  if (!zone.price.item) return null;
  for (const id of ids) {
    const other = ZONES.find(z => z.id === id);
    if (other?.price.program != null && programItems(other.price.program).includes(zone.price.item)) return other;
  }
  return null;
}

// Цена работы для типа кузова (индекс BODY_TYPES): число или null (после осмотра).
// Работы прайса от кузова не зависят.
export const zonePrice = (zone, body = 0) => zone.price.program != null
  ? PROGRAMS[zone.price.program].prices[body] ?? PROGRAMS[zone.price.program].prices[0]
  : item(zone.price.item);
// «от» — минимальная цена работы (для программ — по всем кузовам); null — после осмотра.
for (const zone of ZONES) zone.from = zone.price.program != null ? Math.min(...PROGRAMS[zone.price.program].prices) : zonePrice(zone);

// Сумма «от» по выбранным работам для кузова body: программа мойки одна
// (EXCLUSIVE), работа, входящая в выбранную программу, не считается, работы
// с ценой после осмотра в сумму не входят (garageOpen их называет).
export const garageSum = (ids, body = 0) => ids.reduce((sum, id) => {
  const zone = ZONES.find(z => z.id === id);
  return zone && !includedIn(zone, ids) ? sum + (zonePrice(zone, body) ?? 0) : sum;
}, 0);
// Выбранные работы, цену которых назовут после осмотра.
export const garageOpen = ids => ids.map(id => ZONES.find(z => z.id === id)).filter(z => z && !includedIn(z, ids) && zonePrice(z) == null);
// Мойка (запись в YCLIENTS) и остальные работы (заявка с фото) — отдельно.
export const isWash = zone => ZONE_GROUPS.find(g => g.id === zone.group)?.booking === 'yclients';
