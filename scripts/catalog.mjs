// Всё, что зависит от цен и услуг, собирается из dist/assets/meatwash-content.json:
// - каталог на services.html (между <!-- CATALOG:START --> и <!-- CATALOG:END -->);
// - превью услуг на главной: четыре карточки — четыре категории (<!-- PREVIEW:START --> … <!-- PREVIEW:END -->);
// - dist/js/data.js — те же цены и филиалы для скриптов («Гараж услуг», окно услуги, карта).
// Запуск: npm run catalog. npm run check сверяет все три результата с этим файлом.
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
export const content=JSON.parse(await readFile(new URL('dist/assets/meatwash-content.json',root),'utf8'));
const d=content;
export const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=n=>n.toLocaleString('ru-RU')+' ₽';
const number=n=>String(n+1).padStart(2,'0');
// Цена позиции: число — «от N ₽», null — «После оценки» (что оценивают — в пояснении, третьим полем).
export const priceText=price=>price==null?'После оценки':'от '+money(price);
const priced=items=>items.map(([,price])=>price).filter(price=>price!=null);
export const groupMin=id=>Math.min(...priced(d.groups.find(g=>g.id===id).items));
// Контекст записи программы: название, кузов и цена для этого кузова. Тот же
// формат собирает js/catalog.js при смене кузова.
export const programContext=(i,body)=>`${d.programs[i][0]} — ${d.bodyTypes[body]}, ${money(d.programPrices[i][body])}`;
export const serviceCount=()=>d.groups.reduce((sum,group)=>sum+group.items.length,0);
const isPackage=name=>/^Пакет/.test(name);
const shot=(id,size)=>`assets/shots/${id}${size==='s'?'-s':''}.webp`;
// Подпись кнопки для экранного диктора: «Записаться: Очистка битума кузова».
const forName=name=>`<span class="visually-hidden">: ${escape(name)}</span> <span aria-hidden="true">→</span>`;
// Одно действие на позицию. Мойка (booking: yclients) — окно филиалов с этой работой
// в корзине (ui.js → yclients.js; если онлайн её не продают, окно скажет «На месте
// добавите»); остальное — «Заявка с фото» с этой работой (ui.js → request.js).
const action=(group,name)=>group.booking==='yclients'
 ?`<button class="catalog__action" type="button" data-book data-book-context="${escape(name)}" data-yc-items="${escape(name)}">Записаться${forName(name)}</button>`
 :`<button class="catalog__action" type="button" data-request data-request-category="${escape(group.id)}" data-request-services="${escape(name)}">Заявка с фото${forName(name)}</button>`;
const itemRow=(group,[name,price,note])=>`<li class="catalog__item" data-price-item="${escape(name)}"><div class="catalog__item-text"><p class="catalog__item-name">${escape(name)}</p>${note?`<p class="catalog__item-note">${escape(note)}</p>`:''}</div><p class="catalog__item-price${price==null?' catalog__item-price--estimate':''}">${priceText(price)}</p>${action(group,name)}</li>`;
const itemOf=(group,name)=>group.items.find(([n])=>n===name)??(()=>{throw new Error(`Подраздел ${group.id}: нет позиции «${name}» в items`);})();
// Программы и пакеты мойки: в строке (summary) — название, короткое пояснение, время
// и цена для выбранного кузова (js/catalog.js меняет её по data-prices); полный
// состав — по «Подробнее» в <details id="program-i"> (на него ведут ссылки).
const programRows=()=>`<fieldset class="body-types"><legend>Тип кузова</legend>${d.bodyTypes.map((type,i)=>`<label><input type="radio" name="body-type" value="${i}"${i===0?' checked':''}><span>${escape(type)}</span></label>`).join('')}</fieldset>
    <p class="catalog__selection" id="body-price-label" aria-live="polite">Цены для типа кузова: ${escape(d.bodyTypes[0])}</p>
    <ul class="catalog__programs" role="list">
    ${d.programs.map(([name,,time,description],i)=>`<li class="program"><details class="program__details" id="program-${i}"><summary class="program__summary"><span class="program__name">${escape(name)}${isPackage(name)?' <span class="catalog__tag">пакет</span>':''}</span><span class="program__note">${escape(description)}</span><span class="program__time">${escape(time)}</span><span class="program__price" data-program-price data-prices="${d.programPrices[i].join(',')}">${money(d.programPrices[i][0])}</span><span class="program__toggle">Подробнее <span aria-hidden="true">+</span></span></summary><div class="program__body"><ul class="program-includes">${d.programIncludes[i].map(item=>`<li>${escape(item)}</li>`).join('')}</ul></div></details><button class="catalog__action" type="button" data-book data-program="${i}" data-book-context="${escape(programContext(i,0))}">Записаться${forName(name)}</button></li>`).join('\n    ')}
    </ul>`;
// Подраздел категории: заголовок h3 и позиции; accent — спокойно выделенный
// (оклейка, ремонт стёкол). id подраздела — на обёртке: якорь встаёт на её край.
const block=(group,section)=>`<div class="catalog__block${section.accent?' catalog__block--accent':''}" id="${escape(section.id)}">
   <h3 class="catalog__subhead">${escape(section.title)}${section.programs?' <small>каждая следующая включает предыдущую</small>':''}</h3>
   <div class="catalog__block-body">
    ${section.programs?programRows():`<ul class="catalog__items" role="list">${section.items.map(name=>itemRow(group,itemOf(group,name))).join('')}</ul>`}
   </div>
  </div>`;
const LEAD={yclients:'Запись онлайн — в выбранную студию.',request:'Пришлите заявку с фото — мастер оценит объём работ и назовёт стоимость.'};

// Полный каталог — services.html: четыре категории. Без JS переключатели — ссылки
// на категории, панели идут подряд; js/catalog.js делает из них вкладки (WAI-ARIA tabs)
// и показывает одну. Заголовок страницы (h1) стоит выше, в .page-head, поэтому
// категории начинаются с h2, подразделы — h3.
export function renderCatalog(){
 return `
<div class="catalog catalog--page" id="catalog">
 <div class="catalog__list" id="price-list">
  <nav class="catalog__tabs" aria-label="Категории услуг" data-catalog-tabs>${d.groups.map(group=>`<a class="catalog__tab" id="catalog-tab-${escape(group.id)}" href="#price-${escape(group.id)}">${escape(group.title)}</a>`).join('')}</nav>
${d.groups.map(group=>` <section class="catalog__panel" id="price-${escape(group.id)}" data-category="${escape(group.id)}" aria-labelledby="price-${escape(group.id)}-title">
  <div class="catalog__panel-head"><h2 class="catalog__panel-title" id="price-${escape(group.id)}-title">${escape(group.title)}</h2><p class="catalog__panel-lead">${escape(group.desc)} ${LEAD[group.booking]}</p></div>
  ${group.sections.map(section=>block(group,section)).join('\n  ')}
 </section>`).join('\n')}
  <p class="catalog__note">Стоимость зависит от типа кузова и состояния автомобиля. Итоговый объём и цену согласуем перед работой. Не является публичной офертой.</p>
 </div>
</div>
<!-- Кремовая полоса: гараж и индивидуальный уход — не прайс, их видно отдельно. -->
<div class="services-extra">
 <section class="catalog__concierge cfg-teaser" id="garage-teaser" aria-labelledby="garage-teaser-title">
  <div><p class="eyebrow">Гараж услуг · 3D</p><h2 id="garage-teaser-title">Соберите уход на одной машине</h2><p>Выберите услуги и рассмотрите автомобиль в 3D: камера покажет деталь каждой работы, итог «от» посчитается по ценам этого каталога и вашему кузову.</p></div>
  <a class="btn btn--ghost btn--ink" href="./#garage">Открыть 3D-гараж <span aria-hidden="true">→</span></a>
 </section>
 <section class="catalog__concierge" aria-labelledby="concierge-title"><div><p class="eyebrow" lang="en">INDIVIDUAL CARE</p><h2 id="concierge-title">Под вашу задачу.</h2><p>Комплекс перед продажей, защита нового автомобиля или регулярный уход за автопарком. Для корпоративных клиентов — индивидуальный расчёт, консьерж-сервис и единый счёт.</p></div><button class="btn btn--fill" type="button" data-membership="Индивидуальный уход">Обсудить уход <span aria-hidden="true">→</span></button></section>
</div>
`}

// Превью на главной: четыре карточки — четыре категории в порядке каталога, ссылка
// ведёт на вкладку категории. Подпись — название и короткое описание, цена «от» —
// минимальная в категории (у мойки — минимальная цена программ), всё из JSON.
// Кадры assets/shots — 1600×894, уменьшенные (-s) — 900 px.
const PREVIEW={
 wash:{shot:'cf-foam-crop',alt:'Спорткупе в активной пене на тёмном полу студии'},
 detailing:{shot:'cf-interior-seat',alt:'Салон классического купе: руль и кожаные сиденья с тканевыми вставками'},
 protection:{shot:'cf-front-corner',alt:'Фара и переднее крыло бордового автомобиля крупным планом'},
 help:{shot:'cf-chip-macro',alt:'Скол на тёмно-бордовом лаке крупным планом'},
};
const previewFrom=group=>{
 const prices=group.sections.some(section=>section.programs)?d.programPrices.flat():priced(group.items);
 return prices.length?`от ${money(Math.min(...prices))}`:'После оценки';
};
export function renderPreview(){
 return `
  <div class="strip strip--4">
${d.groups.map((group,i)=>{
 const card=PREVIEW[group.id];
 if(!card)throw new Error(`Превью: нет кадра для категории ${group.id}`);
 return `   <a class="card card--${escape(group.id)}" href="services.html#price-${escape(group.id)}"><img src="${shot(card.shot)}" srcset="${shot(card.shot,'s')} 900w, ${shot(card.shot)} 1600w" sizes="(max-width: 900px) 50vw, 25vw" alt="${escape(card.alt)}" width="1600" height="894" loading="lazy" decoding="async"><span class="card__label"><span>${number(i)}</span><span>${escape(group.title)}</span></span><span class="card__caption">${escape(group.desc)}<b class="card__price">${previewFrom(group)}</b></span></a>`;}).join('\n')}
  </div>
  `;
}

// Модуль данных для скриптов страницы. Только то, что им нужно: цены программ по
// кузову и их состав (гараж не берёт повторно работу, уже входящую в мойку:
// items — позиции каталога), цены работ по названию (null — после оценки),
// позиции с пояснением, категорией и подразделом, четыре категории с подразделами,
// настройка заявок и филиалы (карты в карточках, цель записи).
export function renderData(){
 const prices=Object.fromEntries(d.groups.flatMap(g=>g.items.map(([name,price])=>[name,price])));
 const items=Object.fromEntries(d.groups.flatMap(g=>g.sections.filter(s=>s.items).flatMap(s=>s.items.map(name=>{
  const [,price,about]=g.items.find(([n])=>n===name);
  return [name,{price,about,category:g.id,section:s.id}];
 }))));
 const categories=d.groups.map(g=>({id:g.id,title:g.title,short:g.short,desc:g.desc,booking:g.booking,
  sections:g.sections.map(s=>({id:s.id,title:s.title,...(s.programs?{programs:true}:{}),...(s.accent?{accent:true}:{}),...(s.items?{items:s.items}:{})})),
  items:g.items.map(([name])=>name)}));
 // Филиалы для скриптов: цель Метрики по ссылке записи (ui.js) и карты в карточках (maps.js).
 const locations=d.locations.map(l=>({id:l.id,name:l.name,address:l.address,booking:l.booking,map:l.map,mapWidget:l.mapWidget}));
 return `// Сгенерировано scripts/catalog.mjs из assets/meatwash-content.json — руками не править:
// после правки JSON выполните npm run catalog (npm run check сверяет этот файл).
export const BODY_TYPES = ${JSON.stringify(d.bodyTypes)};
export const PROGRAMS = ${JSON.stringify(d.programs.map(([name,,time,description],i)=>({name,time,description,prices:d.programPrices[i],includes:d.programIncludes[i],items:d.programItems[i]})),null,1)};
export const PRICES = ${JSON.stringify(prices,null,1)};
// Позиции каталога: цена (null — после оценки), короткое пояснение, категория и подраздел.
export const ITEMS = ${JSON.stringify(items,null,1)};
// Четыре категории в порядке показа: booking yclients — запись в филиал, request —
// заявка с фото; sections — подразделы (programs: true — программы и пакеты мойки,
// accent: true — выделенный подраздел).
export const CATEGORIES = ${JSON.stringify(categories,null,1)};
// Заявка с фото: адрес приёма (null — отправка не подключена, форма предлагает позвонить).
export const REQUESTS = ${JSON.stringify({endpoint:d.site?.requests?.endpoint??null})};
export const LOCATIONS = ${JSON.stringify(locations,null,1)};
`;
}

export function replaceBetween(html,name,body,file){
 const start=`<!-- ${name}:START -->`,end=`<!-- ${name}:END -->`;
 if(!html.includes(start)||!html.includes(end))throw new Error(`${file}: нет маркеров ${name}`);
 return html.slice(0,html.indexOf(start)+start.length)+body+html.slice(html.indexOf(end));
}
export const between=(html,name)=>{const start=`<!-- ${name}:START -->`,end=`<!-- ${name}:END -->`;const a=html.indexOf(start),b=html.indexOf(end);return a<0||b<0?null:html.slice(a+start.length,b);};

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const services=new URL('dist/services.html',root),home=new URL('dist/index.html',root);
 await writeFile(services,replaceBetween(await readFile(services,'utf8'),'CATALOG',renderCatalog(),'services.html'));
 await writeFile(home,replaceBetween(await readFile(home,'utf8'),'PREVIEW',renderPreview(),'index.html'));
 await writeFile(new URL('dist/js/data.js',root),renderData());
 console.log(`Rendered ${d.groups.length} categories, ${d.programs.length} wash programs, ${d.programs.length*d.bodyTypes.length} body prices, ${serviceCount()} services, home preview and js/data.js.`);
}
