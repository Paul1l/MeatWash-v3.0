// Всё, что зависит от цен и услуг, собирается из dist/assets/meatwash-content.json:
// - каталог на services.html (между <!-- CATALOG:START --> и <!-- CATALOG:END -->);
// - превью услуг на главной: четыре карточки и восемь категорий (<!-- PREVIEW:START --> … <!-- PREVIEW:END -->);
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
// Цена позиции: число — «от N ₽», null — стоимость после осмотра (пояснение — третьим полем).
export const priceText=price=>price==null?'после осмотра':money(price);
const priced=items=>items.map(([,price])=>price).filter(price=>price!=null);
export const groupMin=id=>Math.min(...priced(d.groups.find(g=>g.id===id).items));
// Контекст записи программы: название, кузов и цена для этого кузова. Тот же
// формат собирает js/catalog.js при смене кузова.
export const programContext=(i,body)=>`${d.programs[i][0]} — ${d.bodyTypes[body]}, ${money(d.programPrices[i][body])}`;
export const serviceCount=()=>d.groups.reduce((sum,group)=>sum+group.items.length,0);
const isPackage=name=>/^Пакет/.test(name);
const shot=(id,size)=>`assets/shots/${id}${size==='s'?'-s':''}.webp`;
// Кнопка действия категории: мойка — запись в YCLIENTS (окно выбора филиала),
// остальные работы — заявка с фото (окно заявки, js/request.js).
const action=(group,label)=>group.booking==='yclients'
 ?`<button class="btn btn--ghost" type="button" data-book data-book-context="${escape(group.title)}">${label||'Записаться на мойку'} <span aria-hidden="true">→</span></button>`
 :`<button class="btn btn--ghost" type="button" data-request data-request-category="${escape(group.id)}">${label||'Оставить заявку с фото'} <span aria-hidden="true">→</span></button>`;
const priceRows=items=>`<dl class="catalog__prices">${items.map(([name,price,note])=>`<div data-price-item><dt>${escape(name)}${note?`<small>${escape(note)}</small>`:''}</dt><dd${price==null?' class="catalog__on-request"':''}>${priceText(price)}</dd></div>`).join('')}</dl>`;

// Полный каталог — services.html: две заметные карточки (оклейка, стёкла),
// навигация по восьми категориям и сами категории. Заголовок страницы (h1)
// стоит выше, в .page-head, поэтому здесь разделы начинаются с h2.
export function renderCatalog(){
 const groupCount=d.groups.length,count=serviceCount()+d.programs.length;
 const featured=d.groups.filter(group=>group.featured);
 const wash=group=>`<div class="catalog__programs" id="programs"><fieldset class="body-types"><legend>Тип кузова</legend>${d.bodyTypes.map((type,i)=>`<label><input type="radio" name="body-type" value="${i}"${i===0?' checked':''}><span>${escape(type)}</span></label>`).join('')}</fieldset>
    <p class="catalog__selection" id="body-price-label" aria-live="polite">Цены для типа кузова: ${escape(d.bodyTypes[0])}</p>
    <h3 class="catalog__subhead">Программы и пакеты <small>каждая следующая включает предыдущую</small></h3>
    ${d.programs.map(([name,,time,description],i)=>`<details class="catalog__entry program-entry" id="program-${i}"><summary><span class="catalog__number">${number(i)}</span><span class="catalog__name">${escape(name)}${isPackage(name)?' <span class="catalog__tag">пакет</span>':''}</span><span class="catalog__time">${escape(time)}</span><span class="catalog__price" data-program-price data-prices="${d.programPrices[i].join(',')}">${money(d.programPrices[i][0])}</span><span class="catalog__toggle" aria-hidden="true">+</span></summary><div class="catalog__expanded"><p>${escape(description)}</p><ul class="program-includes">${d.programIncludes[i].map(item=>`<li>${escape(item)}</li>`).join('')}</ul><button class="btn btn--ghost" type="button" data-book data-program="${i}" data-book-context="${escape(programContext(i,0))}">Записаться <span aria-hidden="true">→</span></button></div></details>`).join('\n    ')}
   </div>
   <h3 class="catalog__subhead">Дополнительно на мойке</h3>
   ${priceRows(group.items)}`;
 const extra=group=>group.id==='bodywork'?d.extraWork.map(work=>`<div class="catalog__extra"><span>${escape(work.name)}<small>Только ${escape(work.location)} · стоимость — после осмотра</small></span></div>`).join(''):'';
 return `
<div class="catalog catalog--page" id="catalog">
 <section class="featured" aria-label="Оклейка и ремонт стёкол">
${featured.map(group=>{
 const from=priced(group.items).length?`от ${money(groupMin(group.id))}`:'после осмотра';
 return `  <article class="featured__card" aria-labelledby="featured-${group.id}-title">
   <img class="featured__img" src="${shot(group.image)}" srcset="${shot(group.image,'s')} 900w, ${shot(group.image)} 1600w" sizes="(max-width: 900px) 100vw, 50vw" width="1600" height="894" alt="" loading="lazy" decoding="async">
   <div class="featured__body">
    <p class="eyebrow">${number(d.groups.indexOf(group))} / ${String(groupCount).padStart(2,'0')} · ${escape(group.short)}</p>
    <h2 id="featured-${group.id}-title">${escape(group.title)}</h2>
    <p>${escape(group.desc)} Пришлите фото — мастер оценит объём работ и назовёт стоимость.</p>
    <ul class="featured__list">${group.items.map(([name,price])=>`<li><span>${escape(name)}</span><b>${price==null?'после осмотра':'от '+money(price)}</b></li>`).join('')}</ul>
    <div class="featured__actions">${action(group)}<a class="link-arrow" href="#price-${group.id}">Подробнее <span aria-hidden="true">↓</span></a></div>
   </div>
  </article>`;}).join('\n')}
 </section>
 <nav class="categories" aria-label="Категории услуг">${d.groups.map((group,i)=>`<a href="#price-${escape(group.id)}"><span>${number(i)}</span>${escape(group.title)}</a>`).join('')}</nav>
 <section class="catalog__section" id="price-list" aria-labelledby="price-list-title">
  <div class="catalog__aside"><span class="eyebrow" lang="en">${String(groupCount).padStart(2,'0')} / CATEGORIES</span><h2 id="price-list-title">Все услуги</h2><p>${count} ${plural(count,'позиция','позиции','позиций')} в ${word(PREPOSITIONAL,groupCount)} ${groupCount===1?'категории':'категориях'}. Мойку запишем онлайн в выбранную студию, по остальным работам пришлите заявку с фото.</p><a class="link-arrow" href="#book">Выбрать студию <span aria-hidden="true">↓</span></a></div>
  <div class="catalog__content">${d.groups.map((group,i)=>`<details class="catalog__entry service-group" id="price-${escape(group.id)}"><summary><span class="catalog__number">${number(i)}</span><span class="catalog__name">${escape(group.title)}</span><span class="catalog__count">${group.booking==='yclients'?`${d.programs.length} прогр. · `:''}${group.items.length} поз.</span><span class="catalog__toggle" aria-hidden="true">+</span></summary><div class="catalog__expanded"><p>${escape(group.desc)}</p>${group.booking==='yclients'?wash(group):priceRows(group.items)}${extra(group)}${action(group)}</div></details>`).join('\n')}
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

// Превью на главной: четыре карточки — мойка и три направления, которые сайт
// выделяет (оклейка, стёкла, полировка и керамика); ниже — все восемь категорий.
// Подпись — название категории, цена — минимальная в ней (из JSON).
const PREVIEW=[
 {cls:'card--wash',n:'01',group:'wash',from:()=>Math.min(...d.programPrices.flat()),
  img:'assets/shots/cf-foam-crop.webp',srcset:'assets/shots/cf-foam-crop-s.webp 900w, assets/shots/cf-foam-crop.webp 1600w',w:1600,h:900,alt:'Автомобиль в активной пене на ручной мойке'},
 {cls:'card--film',group:'film',
  img:'assets/shots/cf-front-corner.webp',srcset:'assets/shots/cf-front-corner-s.webp 900w, assets/shots/cf-front-corner.webp 1600w',w:1600,h:894,alt:'Передняя часть кузова и фара бордового автомобиля'},
 {cls:'card--glass',group:'glass',
  img:'assets/shots/cf-windscreen.webp',srcset:'assets/shots/cf-windscreen-s.webp 900w, assets/shots/cf-windscreen.webp 1600w',w:1600,h:894,alt:'Лобовое стекло автомобиля в студии'},
 {cls:'card--polish',group:'polish',
  img:'assets/img/service-polish-1280.webp',srcset:'assets/img/service-polish-640.webp 640w, assets/img/service-polish-1280.webp 1280w',w:1280,h:852,alt:'Мастер Meatwash полирует кузов машинкой при направленном свете'},
];
export function renderPreview(){
 return `
  <div class="strip strip--4">
${PREVIEW.map(c=>{
 const group=d.groups.find(g=>g.id===c.group),i=d.groups.indexOf(group);
 const title=group.id==='wash'?'Программы и пакеты мойки':group.title;
 const from=c.from?c.from():groupMin(group.id);
 return `   <a class="card ${c.cls}" href="services.html#price-${group.id}"><img src="${c.img}" srcset="${c.srcset}" sizes="(max-width: 900px) 50vw, 25vw" alt="${escape(c.alt)}" width="${c.w}" height="${c.h}" loading="lazy" decoding="async"><span class="card__label"><span>${number(i)}</span><span>${escape(group.short)}</span></span><span class="card__caption">${escape(title)}<b class="card__price">от ${money(from)}</b></span></a>`;}).join('\n')}
  </div>
  <nav class="preview-categories" aria-label="Все категории услуг">${d.groups.map((group,i)=>`<a href="services.html#price-${escape(group.id)}"><span>${number(i)}</span>${escape(group.title)}</a>`).join('')}</nav>
  `;
}

// Модуль данных для скриптов страницы. Только то, что им нужно: цены программ по
// кузову и их состав (гараж не берёт повторно работу, уже входящую в мойку:
// items — позиции каталога), цены работ по названию (null — после осмотра),
// категории, настройка заявок и филиалы (окно карты).
export function renderData(){
 const prices=Object.fromEntries(d.groups.flatMap(g=>g.items));
 const locations=d.locations.map(l=>({id:l.id,name:l.name,type:l.type,address:l.address,hours:l.hours,phone:l.phone,tel:l.tel,booking:l.booking,map:l.map,mapWidget:l.mapWidget,route:l.route,entry:l.entry,onSite:l.onSite}));
 return `// Сгенерировано scripts/catalog.mjs из assets/meatwash-content.json — руками не править:
// после правки JSON выполните npm run catalog (npm run check сверяет этот файл).
export const BODY_TYPES = ${JSON.stringify(d.bodyTypes)};
export const PROGRAMS = ${JSON.stringify(d.programs.map(([name,,time,description],i)=>({name,time,description,prices:d.programPrices[i],includes:d.programIncludes[i],items:d.programItems[i]})),null,1)};
export const PRICES = ${JSON.stringify(prices,null,1)};
// Категории услуг: booking yclients — запись в филиал, request — заявка с фото.
export const CATEGORIES = ${JSON.stringify(d.groups.map(g=>({id:g.id,title:g.title,short:g.short,booking:g.booking,items:g.items.map(([name])=>name)})),null,1)};
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
 console.log(`Rendered ${d.programs.length} wash programs, ${d.programs.length*d.bodyTypes.length} body prices, ${serviceCount()} services, home preview and js/data.js.`);
}
