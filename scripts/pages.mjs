// Общие части страниц (шапка с меню, подвал, окна записи и карты, карточки локаций,
// блок записи) живут в src/partials/*.html и вставляются во все страницы между
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
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {content,escape} from './catalog.mjs';

const root=new URL('../',import.meta.url);
// Какие общие части есть на какой странице.
export const PAGES={
 'index.html':{id:'home',shared:['header','locations','footer','dialogs']},
 'services.html':{id:'services',shared:['header','book','footer','dialogs']},
 'about.html':{id:'about',shared:['header','locations','book','footer','dialogs']},
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
