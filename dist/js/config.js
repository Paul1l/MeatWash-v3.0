// «Гараж услуг»: работы, категории, наборы и правила расчёта.
// Цены и названия — только из assets/meatwash-content.json: data.js генерирует
// npm run catalog. Здесь — ссылки на позиции каталога, а не числа.
import { PROGRAMS, PRICES } from './data.js';

const item = name => { if (!(name in PRICES)) throw new Error('Нет цены в каталоге: ' + name); return PRICES[name]; };

export const ZONE_GROUPS = [
  { id: 'wash',    title: 'Мойка' },
  { id: 'paint',   title: 'Кузов и лак' },
  { id: 'cabin',   title: 'Салон' },
  { id: 'protect', title: 'Защита' },
];

// price  — позиция каталога: { program: i } — программа мойки (цена зависит от
//          кузова), { item: "название" } — работа из прайса. Название работы
//          в гараже — то же, что в каталоге (title ниже подставляется из него).
// caption — что делает работа, одной фразой.
// Ракурс камеры для каждой работы — src/porsche3d/views.js (SERVICE_VIEWS).
export const ZONES = [
  { id: 'three-phase', group: 'wash', price: { program: 0 },
    caption: 'Пена, выдержка, ручная проработка — без кругов на лаке.' },
  { id: 'complex', group: 'wash', price: { program: 1 },
    caption: 'Кузов, диски и салон за один визит. Финиш — покрытие воском.' },
  { id: 'reagents', group: 'wash', price: { program: 2 },
    caption: 'Соль уходит из порогов и арок — туда, куда пена не достаёт.' },
  { id: 'wheels', group: 'wash', price: { item: 'Чернение шин' },
    caption: 'После мойки резина получает ровный насыщенный чёрный цвет.' },
  { id: 'polish', group: 'paint', price: { item: 'Полировка кузова + 2 слоя керамики' },
    caption: 'Снимаем паутинку — отражение становится ровным.' },
  { id: 'chips', group: 'paint', price: { item: 'Удаление сколов и подкраска' },
    caption: 'Точечно по месту, без перекраса всего элемента.' },
  { id: 'headlights', group: 'paint', price: { item: 'Полировка фар' },
    caption: 'Мутный поликарбонат снова даёт чёткий пучок света.' },
  { id: 'interior', group: 'cabin', price: { item: 'Химчистка отдельного элемента' },
    caption: 'Ткань, алькантара или кожа — цена за одну деталь салона.' },
  { id: 'leather', group: 'cabin', price: { item: 'Кондиционер кожи сидений' },
    caption: 'Питание и защита кожи сидений после чистки.' },
  { id: 'ceramic', group: 'protect', price: { item: 'Керамическое покрытие кузова' },
    caption: 'Вода собирается в каплю и уходит, не оставляя следов.' },
  { id: 'rain', group: 'protect', price: { item: 'Антидождь передней полусферы' },
    caption: 'Лобовое и передние боковые стёкла: на скорости вода срывается сама.' },
  { id: 'film', group: 'protect', price: { item: 'Оклейка зон риска кузова' },
    caption: 'Плёнка туда, где кузов страдает первым: капот, фары, пороги.' },
];
for (const zone of ZONES) {
  zone.title = zone.price.program != null ? PROGRAMS[zone.price.program].name : zone.price.item;
  if (zone.price.item) item(zone.price.item);
}

// Программы мойки вложены друг в друга («каждая следующая включает предыдущую»),
// поэтому в гараже выбирается одна: две сразу посчитали бы мойку дважды.
export const EXCLUSIVE = [['three-phase', 'complex', 'reagents']];

// Состав программы мойки i — с составом всех предыдущих (они вложены).
const programIncludes = i => PROGRAMS.slice(0, i + 1).flatMap(p => p.includes || []);
// Программа из выбранных, в которую уже входит работа (по названию в каталоге):
// «Детейлинг-мойка от реагентов» включает «Чернение шин». Такая работа отдельно
// не выбирается и в сумму второй раз не попадает.
export function includedIn(zone, ids) {
  if (!zone.price.item) return null;
  for (const id of ids) {
    const other = ZONES.find(z => z.id === id);
    if (other?.price.program != null && programIncludes(other.price.program).includes(zone.price.item)) return other;
  }
  return null;
}

// Цена работы для типа кузова (индекс BODY_TYPES). Работы прайса от кузова не зависят.
export const zonePrice = (zone, body = 0) => zone.price.program != null
  ? PROGRAMS[zone.price.program].prices[body] ?? PROGRAMS[zone.price.program].prices[0]
  : item(zone.price.item);
// «от» — минимальная цена работы (для программ — по всем кузовам).
for (const zone of ZONES) zone.from = zone.price.program != null ? Math.min(...PROGRAMS[zone.price.program].prices) : zonePrice(zone);

// Сумма «от» по выбранным работам для кузова body: программа мойки одна
// (EXCLUSIVE), работа, входящая в выбранную программу, не считается.
export const garageSum = (ids, body = 0) => ids.reduce((sum, id) => {
  const zone = ZONES.find(z => z.id === id);
  return zone && !includedIn(zone, ids) ? sum + zonePrice(zone, body) : sum;
}, 0);

// Готовые наборы — собраны из работ выше. Работ, уже входящих в программу
// набора, здесь нет (это проверяет npm run check).
export const ZONE_PRESETS = [
  { id: 'base',    title: 'База',   note: 'Комплексная мойка и чернение шин', zones: ['complex', 'wheels'] },
  { id: 'winter',  title: 'Зима',   note: 'Мойка от реагентов и антидождь',   zones: ['reagents', 'rain'] },
  { id: 'full',    title: 'Полный', note: 'Кузов, салон, керамика',           zones: ['complex', 'polish', 'interior', 'ceramic'] },
];
