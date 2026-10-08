// Общие части страниц (шапка с меню, подвал, окна записи и заявки, карточки локаций с картами,
// блок записи, клубный блок «Больше, чем сервис», аналитика в <head>) живут
// в src/partials/*.html и вставляются во все страницы между
// маркерами <!-- SHARED:<имя>:START --> и <!-- SHARED:<имя>:END -->.
// Руками внутри маркеров не править: npm run pages перезапишет, npm run check
// сверяет каждую страницу с результатом этого скрипта.
//
// Подстановки в фрагментах:
//   {{home}}             '' на главной, './' на остальных: href="{{home}}#locations"
//   {{top}}              логотип: '#top' на главной, './' на остальных
//   {{locations}}        '' на страницах с блоком локаций (главная, «О нас»), 'about.html' на остальных:
//                        href="{{locations}}#map-technopark" — к карте студии на этой же странице или на «О нас»
//                        (v2, план юзабилити 08.10: контакты живут на «О нас», а не на главной)
//   {{current:<page>}}   aria-current="page" на своей странице
//   {{header-class}}     ' is-solid' на внутренних страницах
//   {{mobile-cta}}       нижняя кнопка на телефоне — по полю cta страницы (MOBILE_CTA ниже)
//   {{loc:<id>:<поле>}}  данные филиала из meatwash-content.json (экранируются)
//   {{analytics:<webmaster|metrika>}}  мета-теги Яндекс Вебмастера и номер счётчика
//                        Метрики из site.analytics в JSON; пусто — ничего (Метрику
//                        загружает js/analytics.js только после согласия посетителя)
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {content,escape} from './catalog.mjs';
import {CONTENT} from '../src/content/pages.mjs';

const root=new URL('../',import.meta.url);
// Какие общие части есть на какой странице.
// Страницы из src/content (статьи, Политика, Согласие) собирает scripts/content.mjs.
// v2 (план юзабилити 08.10): на «О нас» блока записи нет — контакты на самой странице.
export const PAGES={
 'index.html':{id:'home',cta:'book',shared:['analytics','header','locations','membership','footer','dialogs']},
 'services.html':{id:'services',cta:'book',shared:['analytics','header','book','footer','dialogs']},
 'about.html':{id:'about',cta:'book',shared:['analytics','header','membership','locations','footer','dialogs']},
 ...Object.fromEntries(CONTENT.map(page=>[page.file,{id:page.id,cta:page.cta,shared:page.shared}])),
};
// Код Вебмастера — латиница и цифры, счётчик Метрики — только цифры: иначе в разметку не пишем.
const analytics=content.site?.analytics||{};
const ANALYTICS={
 webmaster:()=>analytics.webmaster?(/^[\w-]+$/.test(analytics.webmaster)?`<meta name="yandex-verification" content="${escape(analytics.webmaster)}">`:fail('site.analytics.webmaster')):'',
 metrika:()=>analytics.metrika?(/^\d+$/.test(String(analytics.metrika))?`<meta name="mw-metrika" content="${escape(analytics.metrika)}">`:fail('site.analytics.metrika')):'',
};
function fail(field){throw new Error(`Неверное значение ${field} в meatwash-content.json`);}
// Нижняя кнопка на телефоне (.mobile-cta, src/partials/dialogs.html) — главное действие страницы.
// Класс один у кнопки и у ссылки: ui.js делает её inert под меню, CSS прячет при открытом окне.
const loc=id=>content.locations.find(l=>l.id===id);
const MOBILE_CTA={
 book:()=>'<button class="btn btn--fill mobile-cta" type="button" data-book>Записаться</button>',
 technopark:()=>`<a class="btn btn--fill mobile-cta" href="tel:${escape(loc('technopark').tel)}">Позвонить в Технопарк</a>`,
 auto:()=>'<a class="btn btn--fill mobile-cta" href="https://t.me/otec_roman" target="_blank" rel="noopener">Спросить о машине<span class="visually-hidden"> в Telegram</span></a>',
};

const LOC_FIELDS={
 name:l=>escape(l.name),type:l=>escape(l.type),address:l=>escape(l.address),
 hours:l=>l.hours.map(escape).join('<br>'),floor:l=>escape(l.floor),
 phone:l=>escape(l.phone),tel:l=>escape(l.tel),booking:l=>escape(l.booking),
 map:l=>escape(l.map),
 card:l=>l.card.map(escape).join('<br>'),
};

export async function readPartial(name){return readFile(new URL(`src/partials/${name}.html`,root),'utf8');}

export function renderPartial(template,page){
 const {id}=PAGES[page];const home=id==='home';
 return template.replace(/\{\{([a-z-]+)(?::([a-z-]+))?(?::([a-z-]+))?\}\}/g,(token,name,a,b)=>{
  switch(name){
   case 'home':return home?'':'./';
   case 'top':return home?'#top':'./';
   case 'locations':return PAGES[page].shared.includes('locations')?'':'about.html';
   case 'current':return a===id?' aria-current="page"':'';
   case 'header-class':return home?'':' is-solid';
   case 'mobile-cta':{
    const cta=PAGES[page].cta;
    if(!MOBILE_CTA[cta])throw new Error(`${page}: нет нижней кнопки cta «${cta}» (${token})`);
    return MOBILE_CTA[cta]();
   }
   case 'analytics':{
    if(!ANALYTICS[a])throw new Error(`Нет поля аналитики ${a} (${token})`);
    return ANALYTICS[a]();
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
