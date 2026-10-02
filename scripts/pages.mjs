// Общие части страниц (шапка с меню, подвал, окна записи и карты, карточки локаций,
// блок записи, клубный блок «Больше, чем сервис», аналитика в <head>) живут
// в src/partials/*.html и вставляются во все страницы между
// маркерами <!-- SHARED:<имя>:START --> и <!-- SHARED:<имя>:END -->.
// Руками внутри маркеров не править: npm run pages перезапишет, npm run check
// сверяет каждую страницу с результатом этого скрипта.
//
// Подстановки в фрагментах:
//   {{home}}             '' на главной, './' на остальных: href="{{home}}#locations"
//   {{top}}              логотип: '#top' на главной, './' на остальных
//   {{current:<page>}}   aria-current="page" на своей странице
//   {{header-class}}     ' is-solid' на внутренних страницах
//   {{nav-next}}         стрелка «следующий раздел» — только на главной
//   {{loc:<id>:<поле>}}  данные филиала из meatwash-content.json (экранируются)
//   {{analytics:<webmaster|metrika>}}  мета-теги Яндекс Вебмастера и номер счётчика
//                        Метрики из site.analytics в JSON; пусто — ничего (Метрику
//                        загружает js/analytics.js только после согласия посетителя)
//   {{ld:locations}}     JSON-LD студий (AutoWash) из locations в JSON: адрес, телефон,
//                        часы, координаты — те же, что в карточках локаций
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {content,escape} from './catalog.mjs';
import {CONTENT} from '../src/content/pages.mjs';

const root=new URL('../',import.meta.url);
// Адрес сайта для canonical, JSON-LD, sitemap и документов (content.mjs берёт его отсюда;
// в check.mjs — своя копия). Ссылки внутри сайта — только относительные.
export const SITE='https://meatwash.ru/';
// Какие общие части есть на какой странице.
// Страницы из src/content (статьи, Политика, Согласие) собирает scripts/content.mjs.
export const PAGES={
 'index.html':{id:'home',shared:['analytics','jsonld','header','locations','membership','footer','dialogs']},
 'services.html':{id:'services',shared:['analytics','header','book','footer','dialogs']},
 'about.html':{id:'about',shared:['analytics','header','membership','locations','book','footer','dialogs']},
 ...Object.fromEntries(CONTENT.map(page=>[page.file,{id:page.id,shared:page.shared}])),
};
// Код Вебмастера — латиница и цифры, счётчик Метрики — только цифры: иначе в разметку не пишем.
const analytics=content.site?.analytics||{};
const ANALYTICS={
 webmaster:()=>analytics.webmaster?(/^[\w-]+$/.test(analytics.webmaster)?`<meta name="yandex-verification" content="${escape(analytics.webmaster)}">`:fail('site.analytics.webmaster')):'',
 metrika:()=>analytics.metrika?(/^\d+$/.test(String(analytics.metrika))?`<meta name="mw-metrika" content="${escape(analytics.metrika)}">`:fail('site.analytics.metrika')):'',
};
function fail(field){throw new Error(`Неверное значение ${field} в meatwash-content.json`);}

// Часы работы — в том виде, в каком их показывает сайт («Пн–Пт 08:00–22:00», «Ежедневно
// 08:00–22:00»). Другой формат — ошибка сборки, а не молча неверная разметка.
const DAYS={Пн:'Monday',Вт:'Tuesday',Ср:'Wednesday',Чт:'Thursday',Пт:'Friday',Сб:'Saturday',Вс:'Sunday'};
const DAY_ORDER=Object.keys(DAYS);
function openingHours(line,id){
 const m=/^(?:(Ежедневно)|(Пн|Вт|Ср|Чт|Пт|Сб|Вс)(?:–(Пн|Вт|Ср|Чт|Пт|Сб|Вс))?) (\d\d:\d\d)–(\d\d:\d\d)$/.exec(line);
 const days=!m?[]:m[1]?DAY_ORDER:DAY_ORDER.slice(DAY_ORDER.indexOf(m[2]),DAY_ORDER.indexOf(m[3]||m[2])+1);
 if(!days.length)throw new Error(`locations.${id}.hours: не разобрать «${line}» для JSON-LD`);
 return {'@type':'OpeningHoursSpecification',dayOfWeek:days.map(d=>DAYS[d]),opens:m[4],closes:m[5]};
}
// Студии для поиска (schema.org AutoWash). '<' экранируется, чтобы текст из JSON не закрыл <script>.
const LD={
 locations:()=>JSON.stringify(content.locations.map(l=>({
  '@context':'https://schema.org','@type':'AutoWash','@id':`${SITE}#${l.id}`,
  name:`MEATWASH Car Care Club — ${l.name}`,url:`${SITE}#locations`,image:SITE+l.image,telephone:l.tel,
  address:{'@type':'PostalAddress',streetAddress:l.address,addressLocality:'Москва',addressCountry:'RU'},
  geo:{'@type':'GeoCoordinates',latitude:l.lat,longitude:l.lon},hasMap:l.map,
  openingHoursSpecification:l.hours.map(line=>openingHours(line,l.id)),sameAs:[l.map],
 }))).replace(/</g,'\\u003c'),
};
const NAV_NEXT='\n    <button class="nav__next" type="button" data-scroll-next aria-label="Следующий раздел"><span class="nav__line"></span><span aria-hidden="true">→</span></button>';

const LOC_FIELDS={
 name:l=>escape(l.name),type:l=>escape(l.type),address:l=>escape(l.address),
 hours:l=>l.hours.map(escape).join('<br>'),
 phone:l=>escape(l.phone),tel:l=>escape(l.tel),booking:l=>escape(l.booking),
 map:l=>escape(l.map),gallery:l=>escape(l.gallery),route:l=>escape(l.route),
 card:l=>l.card.map(escape).join('<br>'),
 'entry-label':l=>escape(l.entry.label),'entry-text':l=>escape(l.entry.text),
 'on-site':l=>l.onSite.map(escape).join(' · '),
};

export async function readPartial(name){return readFile(new URL(`src/partials/${name}.html`,root),'utf8');}

export function renderPartial(template,page){
 const {id}=PAGES[page];const home=id==='home';
 return template.replace(/\{\{([a-z-]+)(?::([a-z-]+))?(?::([a-z-]+))?\}\}/g,(token,name,a,b)=>{
  switch(name){
   case 'home':return home?'':'./';
   case 'top':return home?'#top':'./';
   case 'current':return a===id?' aria-current="page"':'';
   case 'header-class':return home?'':' is-solid';
   case 'nav-next':return home?NAV_NEXT:'';
   case 'analytics':{
    if(!ANALYTICS[a])throw new Error(`Нет поля аналитики ${a} (${token})`);
    return ANALYTICS[a]();
   }
   case 'ld':{
    if(!LD[a])throw new Error(`Нет разметки ${a} (${token})`);
    return LD[a]();
   }
   case 'loc':{
    const location=content.locations.find(l=>l.id===a);
    if(!location)throw new Error(`Нет филиала ${a} (${token})`);
    if(!LOC_FIELDS[b])throw new Error(`Нет поля ${b} (${token})`);
    return LOC_FIELDS[b](location);
   }
   default:throw new Error(`Неизвестная подстановка ${token}`);
  }
 });
}

const marker=(name,edge)=>`<!-- SHARED:${name}:${edge} -->`;
export function sharedBlock(html,name){
 const a=html.indexOf(marker(name,'START')),b=html.indexOf(marker(name,'END'));
 return a<0||b<0?null:html.slice(a+marker(name,'START').length,b);
}
// Фрагмент между маркерами — с переводами строк вокруг, чтобы разметка читалась.
export const wrap=body=>'\n'+body.replace(/\s+$/,'')+'\n';

export async function renderPage(page,html){
 for(const name of PAGES[page].shared){
  const a=html.indexOf(marker(name,'START')),b=html.indexOf(marker(name,'END'));
  if(a<0||b<0)throw new Error(`${page}: нет маркеров SHARED:${name}`);
  html=html.slice(0,a+marker(name,'START').length)+wrap(renderPartial(await readPartial(name),page))+html.slice(b);
 }
 return html;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 for(const page of Object.keys(PAGES)){
  const file=new URL(`dist/${page}`,root);
  await writeFile(file,await renderPage(page,await readFile(file,'utf8')));
  console.log(`${page}: ${PAGES[page].shared.join(', ')}`);
 }
}
