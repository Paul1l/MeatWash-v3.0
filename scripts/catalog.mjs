// Всё, что зависит от цен и услуг, собирается из dist/assets/meatwash-content.json:
// - каталог на services.html (между <!-- CATALOG:START --> и <!-- CATALOG:END -->);
// - превью четырёх направлений на главной (<!-- PREVIEW:START --> … <!-- PREVIEW:END -->);
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
// Счётчики в подводках берутся из данных, а не пишутся руками: после правки
// программ или услуг в JSON текст обновляется сам.
const PREPOSITIONAL=['нуле','одном','двух','трёх','четырёх','пяти','шести','семи','восьми','девяти','десяти'];
const plural=(n,one,few,many)=>{const rest=Math.abs(n)%100,last=rest%10;return rest>10&&rest<20?many:last===1?one:last>1&&last<5?few:many;};
const word=(list,n)=>list[n]??String(n);
export const groupMin=id=>Math.min(...d.groups.find(g=>g.id===id).items.map(([,price])=>price));
// Контекст записи программы: название, кузов и цена для этого кузова. Тот же
// формат собирает js/catalog.js при смене кузова.
export const programContext=(i,body)=>`${d.programs[i][0]} — ${d.bodyTypes[body]}, ${money(d.programPrices[i][body])}`;
export const serviceCount=()=>d.groups.reduce((sum,group)=>sum+group.items.length,0);

// Полный каталог — services.html. Заголовок страницы (h1) стоит выше, в .page-head,
// поэтому здесь разделы начинаются с h2.
export function renderCatalog(){
 const groupCount=d.groups.length,count=serviceCount();
 const servicesLine=`${count} ${plural(count,'работа','работы','работ')} в ${word(PREPOSITIONAL,groupCount)} ${groupCount===1?'направлении':'направлениях'}`;
 return `
<div class="catalog catalog--page" id="catalog">
 <section class="catalog__section" id="programs" aria-labelledby="programs-title">
  <div class="catalog__aside"><span class="eyebrow" lang="en">01 / WASH</span><h2 id="programs-title">Программы<br> мойки</h2><p>Каждая следующая программа включает предыдущую.</p></div>
  <div class="catalog__content"><fieldset class="body-types"><legend>Тип кузова</legend>${d.bodyTypes.map((type,i)=>`<label><input type="radio" name="body-type" value="${i}"${i===0?' checked':''}><span>${escape(type)}</span></label>`).join('')}</fieldset>
   <p class="catalog__selection" id="body-price-label" aria-live="polite">Цены для типа кузова: ${escape(d.bodyTypes[0])}</p>
   ${d.programs.map(([name,,time,description],i)=>`<details class="catalog__entry program-entry" id="program-${i}"><summary><span class="catalog__number">${number(i)}</span><span class="catalog__name">${escape(name)}</span><span class="catalog__time">${escape(time)}</span><span class="catalog__price" data-program-price data-prices="${d.programPrices[i].join(',')}">${money(d.programPrices[i][0])}</span><span class="catalog__toggle" aria-hidden="true">+</span></summary><div class="catalog__expanded"><p>${escape(description)}</p><ul class="program-includes">${d.programIncludes[i].map(item=>`<li>${escape(item)}</li>`).join('')}</ul><button class="btn btn--ghost" type="button" data-book data-program="${i}" data-book-context="${escape(programContext(i,0))}">Записаться <span aria-hidden="true">→</span></button></div></details>`).join('\n')}
   <p class="catalog__note">Состав программы уточняется на приёмке с учётом состояния автомобиля и выбранной площадки.</p>
  </div>
 </section>
 <section class="catalog__section" id="price-list" aria-labelledby="price-list-title">
  <div class="catalog__aside"><span class="eyebrow" lang="en">02 / DETAILING</span><h2 id="price-list-title">Детейлинг</h2><p>${servicesLine}. Дополните программу мойки или запишитесь на отдельную услугу.</p><a class="link-arrow" href="#book">Выбрать студию <span aria-hidden="true">↓</span></a></div>
  <div class="catalog__content">${d.groups.map((group,i)=>`<details class="catalog__entry service-group" id="price-${escape(group.id)}"><summary><span class="catalog__number">${number(i)}</span><span class="catalog__name">${escape(group.title)}</span><span class="catalog__count">${group.items.length} поз.</span><span class="catalog__toggle" aria-hidden="true">+</span></summary><div class="catalog__expanded"><p>${escape(group.desc)}</p><dl class="catalog__prices">${group.items.map(([name,price])=>`<div data-price-item><dt>${escape(name)}</dt><dd>${money(price)}</dd></div>`).join('')}</dl><button class="btn btn--ghost" type="button" data-book data-book-context="${escape(group.title)}">Записаться <span aria-hidden="true">→</span></button></div></details>`).join('\n')}
   <div class="catalog__extra"><span>Порошковая покраска дисков<small>Детейлинг-центр Технопарк</small></span><button type="button" class="link-arrow" data-membership="Покраска дисков">Уточнить стоимость <span aria-hidden="true">→</span></button></div>
   <p class="catalog__note">Стоимость зависит от типа кузова и состояния автомобиля. Итоговый объём и цену согласуем перед работой. Не является публичной офертой.</p>
  </div>
 </section>
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

// Превью на главной: четыре направления, совпадающие с главами сцены. Подпись —
// название группы каталога, цена — минимальная в этой группе (из JSON).
const PREVIEW=[
 {cls:'card--wash',n:'01',short:'Мойка',title:()=>'Программы мойки',from:()=>Math.min(...d.programPrices.flat()),href:'services.html#programs',
  img:'assets/shots/cf-foam-crop.webp',srcset:'assets/shots/cf-foam-crop-s.webp 900w, assets/shots/cf-foam-crop.webp 1600w',w:1600,h:900,alt:'Автомобиль в активной пене на ручной мойке'},
 {cls:'card--interior',n:'02',short:'Салон',group:'interior',href:'services.html#price-interior',
  img:'assets/img/service-interior-1280.webp',srcset:'assets/img/service-interior-640.webp 640w, assets/img/service-interior-1280.webp 1280w',w:1280,h:852,alt:'Мастер Meatwash очищает кожаную дверную карту и салон автомобиля'},
 {cls:'card--polish',n:'03',short:'Полировка',group:'polish',href:'services.html#price-polish',
  img:'assets/img/service-polish-1280.webp',srcset:'assets/img/service-polish-640.webp 640w, assets/img/service-polish-1280.webp 1280w',w:1280,h:852,alt:'Мастер Meatwash полирует кузов машинкой при направленном свете'},
 {cls:'card--ceramic',n:'04',short:'Защита',group:'protection',href:'services.html#price-protection',
  img:'assets/img/service-protection-1280.webp',srcset:'assets/img/service-protection-640.webp 640w, assets/img/service-protection-1280.webp 1280w',w:1280,h:957,alt:'Иллюстрация гидрофобного эффекта: чёткие капли воды на лаке'},
];
export function renderPreview(){
 return `
  <div class="strip strip--4">
${PREVIEW.map(c=>{
 const title=c.group?d.groups.find(g=>g.id===c.group).title:c.title();
 const from=c.group?groupMin(c.group):c.from();
 return `   <a class="card ${c.cls}" href="${c.href}"><img src="${c.img}" srcset="${c.srcset}" sizes="(max-width: 900px) 50vw, 25vw" alt="${escape(c.alt)}" width="${c.w}" height="${c.h}" loading="lazy" decoding="async"><span class="card__label"><span>${c.n}</span><span>${escape(c.short)}</span></span><span class="card__caption">${escape(title)}<b class="card__price">от ${money(from)}</b></span></a>`;}).join('\n')}
  </div>
  `;
}

// Модуль данных для скриптов страницы. Только то, что им нужно: цены программ по
// кузову и их состав (гараж не берёт повторно работу, уже входящую в мойку),
// цены работ по названию и филиалы (окно карты).
export function renderData(){
 const prices=Object.fromEntries(d.groups.flatMap(g=>g.items));
 const locations=d.locations.map(l=>({id:l.id,name:l.name,type:l.type,address:l.address,hours:l.hours,phone:l.phone,tel:l.tel,booking:l.booking,map:l.map,mapWidget:l.mapWidget,route:l.route,entry:l.entry,onSite:l.onSite}));
 return `// Сгенерировано scripts/catalog.mjs из assets/meatwash-content.json — руками не править:
// после правки JSON выполните npm run catalog (npm run check сверяет этот файл).
export const BODY_TYPES = ${JSON.stringify(d.bodyTypes)};
export const PROGRAMS = ${JSON.stringify(d.programs.map(([name,,time],i)=>({name,time,prices:d.programPrices[i],includes:d.programIncludes[i]})),null,1)};
export const PRICES = ${JSON.stringify(prices,null,1)};
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
 console.log(`Rendered ${d.programs.length} wash programs, ${d.programs.length*d.bodyTypes.length} body prices, ${serviceCount()} services, home preview and js/data.js.`);
}
