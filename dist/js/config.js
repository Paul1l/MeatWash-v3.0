// Цены — только из assets/meatwash-content.json: data.js генерирует npm run catalog.
import { PROGRAMS, PRICES } from './data.js';

export const STOPS = { hero:0, body:.20, interior:.40, polish:.60, ceramic:.80, final:1 };
// Кадр витрины по месту прокрутки: LADDER[i] держится с LADDER_AT[i] до LADDER_AT[i+1].
// Границы стоят между главами (центры .2/.4/.6/.8, окна видимости в main.js),
// поэтому кадр меняется, когда текст прошлой главы уже ушёл, а «Готова» совпадает с финалом.
export const LADDER_AT = [0, .12, .30, .50, .70, .90];
const program = (i, withTime = true) => [withTime ? `${PROGRAMS[i].name} · ${PROGRAMS[i].time}` : PROGRAMS[i].name, Math.min(...PROGRAMS[i].prices)];
const item = name => { if (!(name in PRICES)) throw new Error('Нет цены в каталоге: ' + name); return [name, PRICES[name]]; };
export const SERVICES = {
 body: { label:'01 / THE BODY', title:'Мойка кузова', description:'Трёхфазная мойка: предварительная очистка, ручная проработка и финишный уход.', prices:[program(0),program(1),program(2,false)] },
 interior: { label:'02 / THE INTERIOR', title:'Химчистка салона', description:'Уход за кожей, тканью и алькантарой: от отдельной детали до полной химчистки.', prices:[item('Химчистка руля'),item('Химчистка сиденья'),item('Детейлинг-химчистка салона')] },
 polish: { label:'03 / THE REFLECTION', title:'Полировка кузова', description:'Восстановление глубины цвета и чистоты отражения. Состав работ подбирается после осмотра автомобиля.', prices:[item('Полировка кузова + 2 слоя керамики')] },
 ceramic: { label:'04 / THE PROTECTION', title:'Керамическая защита', description:'Защитное покрытие для лакокрасочной поверхности. Состав и количество слоёв подбираются под автомобиль.', prices:[item('Керамическое покрытие кузова')] }
};
export const clamp = (v,a=0,b=1) => Math.min(b,Math.max(a,v));
export const smooth = (v,a,b) => { const x=clamp((v-a)/(b-a)); return x*x*(3-2*x); };

// ─────────────────────────────────────────────────────────────────────────────
// Гараж услуг: все работы показываются на одной машине.
//
// SERVICES выше — четыре главы сайта, их количество проверяет check.mjs.
// Здесь список шире: каждая зона — это работа со своим кадром витрины
// (ZONE_SHOTS ниже).
//
// hold   — сколько секунд держать кадр в режиме показа
// price  — ссылка на цену каталога: { program: i } — программа мойки (цена зависит
//          от кузова), { item: "название" } — работа из прайса. Числа здесь не пишем:
//          они приходят из data.js (npm run catalog), npm run check сверяет суммы.
export const ZONE_GROUPS = [
  { id: 'wash',    title: 'Мойка' },
  { id: 'paint',   title: 'Кузов и лак' },
  { id: 'cabin',   title: 'Салон' },
  { id: 'protect', title: 'Защита' },
];

export const ZONES = [
  {
    id: 'three-phase', group: 'wash', title: 'Трёхфазная мойка', price: { program: 0 },
    caption: 'Пена, выдержка, ручная проработка — без кругов на лаке.',
    hold: 3.2,
  },
  {
    id: 'complex', group: 'wash', title: 'Комплексная с воском', price: { program: 1 },
    caption: 'Кузов, диски и салон за один визит. Финиш горячим воском.',
    hold: 3.2,
  },
  {
    id: 'reagents', group: 'wash', title: 'Детейлинг от реагентов', price: { program: 2 },
    caption: 'Соль уходит из порогов и арок — туда, куда пена не достаёт.',
    hold: 3.6,
  },
  {
    id: 'wheels', group: 'wash', title: 'Диски и шины', price: { item: 'Чернение шин' },
    caption: 'Диск чистится с внутренней стороны, резина — в чернение.',
    hold: 3.4,
  },
  {
    id: 'polish', group: 'paint', title: 'Полировка кузова', price: { item: 'Полировка кузова + 2 слоя керамики' },
    caption: 'Снимаем паутинку — отражение становится ровным.',
    hold: 4.2,
  },
  {
    id: 'chips', group: 'paint', title: 'Сколы и подкраска', price: { item: 'Удаление сколов и подкраска' },
    caption: 'Точечно по месту, без перекраса всего элемента.',
    hold: 3.2,
  },
  {
    id: 'headlights', group: 'paint', title: 'Полировка фар', price: { item: 'Полировка фар' },
    caption: 'Мутный поликарбонат снова даёт чёткий пучок света.',
    hold: 3.4,
  },
  {
    id: 'interior', group: 'cabin', title: 'Химчистка салона', price: { item: 'Химчистка отдельного элемента' },
    caption: 'Ткань, алькантара и кожа — от детали до полной химчистки.',
    hold: 4.0,
  },
  {
    id: 'leather', group: 'cabin', title: 'Кожа и пластик', price: { item: 'Кондиционер кожи сидений' },
    caption: 'Чистка и питание кожи, восстановление выгоревшего пластика.',
    hold: 3.6,
  },
  {
    id: 'ceramic', group: 'protect', title: 'Керамическое покрытие', price: { item: 'Керамическое покрытие кузова' },
    caption: 'Вода собирается в каплю и уходит, не оставляя следов.',
    hold: 4.4,
  },
  {
    id: 'rain', group: 'protect', title: 'Антидождь на стёкла', price: { item: 'Антидождь передней полусферы' },
    caption: 'На скорости вода срывается со стекла сама.',
    hold: 3.4,
  },
  {
    id: 'film', group: 'protect', title: 'Оклейка зон риска', price: { item: 'Оклейка зон риска кузова' },
    caption: 'Плёнка туда, где кузов страдает первым: капот, фары, пороги.',
    hold: 3.8,
  },
];

// Программы мойки вложены друг в друга («каждая следующая включает предыдущую»),
// поэтому в гараже выбирается одна: две сразу посчитали бы мойку дважды.
export const EXCLUSIVE = [['three-phase', 'complex', 'reagents']];

// Цена работы для типа кузова (индекс BODY_TYPES). Работы прайса от кузова не зависят.
export const zonePrice = (zone, body = 0) => zone.price.program != null
  ? PROGRAMS[zone.price.program].prices[body] ?? PROGRAMS[zone.price.program].prices[0]
  : item(zone.price.item)[1];
// «от» — минимальная цена работы (для программ — по всем кузовам).
for (const zone of ZONES) zone.from = zone.price.program != null ? Math.min(...PROGRAMS[zone.price.program].prices) : zonePrice(zone);

// Готовые наборы — как ступени тюнинга: собраны из зон выше.
export const ZONE_PRESETS = [
  { id: 'base',    title: 'База',     note: 'Мойка и диски',            zones: ['complex', 'wheels'] },
  { id: 'winter',  title: 'Зима',     note: 'Реагенты и защита стёкол', zones: ['reagents', 'wheels', 'rain'] },
  { id: 'full',    title: 'Полный',   note: 'Кузов, салон, керамика',   zones: ['complex', 'polish', 'interior', 'ceramic'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Витрина на фотографиях. 3D-модель заменена съёмкой: одна и та же машина
// в четырёх состояниях плюс детальный кадр под каждую работу.
//
// shot  — кадр, который показывается при выборе услуги
// pair  — если у работы есть честная пара «до/после», её можно показать
//         шторкой; before — состояние до работы, after — после
// Файлы лежат в assets/shots/<id>.webp (широкий) и <id>-s.webp (мобильный).

// Лестница состояний: по одному кадру на экран прокрутки.
// Порядок совпадает с главами прокрутки: приехала → мойка → салон → полировка →
// керамика → выдача. Кадры перекрёстно проявляются, поэтому переход плавный.
export const LADDER = [
  { id: 'arrive',   shot: 'cf-hero-dirty',     title: 'Как приехала', note: 'Зимняя плёнка, соль по порогам, диски в пыли.' },
  { id: 'body',     shot: 'cf-foam-crop',      title: 'Мойка',        note: 'Пена работает, грязь сходит вместе с ней.' },
  { id: 'interior', shot: 'cf-interior-seat',  title: 'Салон',        note: 'Кожа и ткань вычищены до запаха нового.' },
  { id: 'polish',   shot: 'cf-rq-bay',         title: 'Полировка',    note: 'Лак снова держит отражение целиком.' },
  { id: 'ceramic',  shot: 'cf-bead-macro',     title: 'Керамика',     note: 'Вода собирается каплей и уходит сама.' },
  { id: 'final',    shot: 'cf-hero-rear-wide', title: 'Готова',       note: 'Забирайте. Машина собрана.' },
];

// Кадр, с которого начинается ролик: машина ещё грязная.
export const FILM_OPEN = 'cf-hero-dirty';

export const ZONE_SHOTS = {
  'three-phase': { shot: 'cf-foam-crop' },
  'complex':     { shot: 'cf-rq-wet' },
  'reagents':    { shot: 'cf-sill-low' },
  'wheels':      { shot: 'cf-wheel-macro' },
  'polish':      { shot: 'cf-rq-bay' },
  'chips':       { shot: 'cf-chip-macro-healed', pair: { before: 'cf-chip-macro',   after: 'cf-chip-macro-healed' } },
  'headlights':  { shot: 'cf-front-corner',    pair: { before: 'cf-headlight-hazy', after: 'cf-front-corner' } },
  'interior':    { shot: 'cf-interior-seat' },
  'leather':     { shot: 'cf-dash-macro' },
  'ceramic':     { shot: 'cf-bead-macro' },
  'rain':        { shot: 'cf-windscreen' },
  'film':        { shot: 'cf-hood-crop' },
};

// Кадр по умолчанию, когда в гараже ничего не выбрано.
export const SHOT_BASE = 'cf-hero-clean';

// Куда смотреть, когда кадр обрезается по высоте (телефон в портрете).
// Без этого у макро-кадров главное уезжает за край: фара сидит слева,
// арка — правее центра. Значение по умолчанию — центр.
export const SHOT_FOCUS = {
  'cf-front-corner':   '30% 56%',
  'cf-headlight-hazy': '32% 58%',
  'cf-rq-bay':         '56% 56%',
  'cf-rq-wet':         '56% 56%',
  'cf-rq-swirl':       '56% 56%',
  'cf-rear-quarter':   '56% 56%',
  'cf-wheel-macro':    '54% 56%',
  'cf-sill-low':       '50% 62%',
  'cf-bead-macro':     '50% 46%',
  'cf-interior-seat':  '56% 50%',
  'cf-dash-macro':     '38% 52%',
};
