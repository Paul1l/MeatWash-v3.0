// npm run check — проверка сайта без браузера, для всех страниц dist:
// ресурсы и якоря (в том числе межстраничные services.html#…), общие фрагменты
// (src/partials) и сгенерированный каталог совпадают с источниками, цены (каталог,
// гараж — названия как в каталоге, суммы по каждому кузову, без повторного
// начисления работ из программы мойки), первый экран без закреплённой сцены,
// 3D только по нажатию и только в гараже главной, ссылки записи обоих филиалов,
// встроенные карты филиалов в карточках локаций, мета.
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {PAGES,renderPartial,readPartial,sharedBlock,wrap} from './pages.mjs';
import {renderCatalog,renderPreview,renderData,between} from './catalog.mjs';
import {renderContent,renderSitemap,renderYandexVerification,missingOperator} from './content.mjs';
import {CONTENT} from '../src/content/pages.mjs';
import {renderPage} from './pages.mjs';
import {importDist} from './dist-module.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const SITE='https://meatwash.ru/';
const failures=[];
const fail=message=>failures.push(message);
const exists=async path=>{try{return (await stat(path)).isFile();}catch{return false;}};

// ── Страницы ─────────────────────────────────────────────────────────────────
const MAIN_PAGES=Object.keys(PAGES);                      // index, services, about
const ALL_PAGES=[...MAIN_PAGES];
const html={},ids={};
for(const page of ALL_PAGES){
 html[page]=await readFile(resolve(dist,page),'utf8');
 ids[page]=new Set([...html[page].matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
}
// Адрес страницы из ссылки: './' и '' — главная.
const pageOf=path=>path===''||path==='./'||path==='.'?'index.html':path.replace(/^\.\//,'');

for(const page of ALL_PAGES){
 const text=html[page];
 const urls=[...text.matchAll(/(?:src|href|data-static-src)="([^"]+)"/g)].map(m=>m[1]);
 for(const [,set] of text.matchAll(/srcset="([^"]+)"/g))urls.push(...set.split(',').map(part=>part.trim().split(/\s+/)[0]));
 for(const url of urls){
  if(/^(https?:|tel:|mailto:|data:)/.test(url))continue;
  const [path,hash]=url.split('#');
  if(path===''&&hash!==undefined){if(!ids[page].has(hash))fail(`${page}: нет якоря #${hash}`);continue;}
  const target=pageOf(path.split('?')[0]);
  if(target.endsWith('.html')){
   if(!ALL_PAGES.includes(target)){fail(`${page}: ссылка на несуществующую страницу ${url}`);continue;}
   // #garage на главной — команда открыть гараж (main.js), а не блок страницы.
   if(hash&&!ids[target].has(hash)&&!(target==='index.html'&&hash==='garage'))fail(`${page}: в ${target} нет якоря #${hash} (${url})`);
   continue;
  }
  if(!await exists(resolve(dist,target)))fail(`${page}: нет файла ${url}`);
 }
 // url() в таблицах стилей страницы.
 for(const [,name] of text.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="css\/([^"]+)"/g)){
  const css=await readFile(resolve(dist,'css',name),'utf8');
  for(const [,url] of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)){
   if(url.startsWith('data:'))continue;
   if(!await exists(resolve(dist,'css',url)))fail(`${page}: ${name}: нет ${url}`);
  }
 }
}

// ── Мета: свой title, description, один h1, canonical и og:url ────────────────
const titles=new Set(),descriptions=new Set();
for(const page of MAIN_PAGES){
 const text=html[page],url=SITE+(page==='index.html'?'':page);
 const title=text.match(/<title>([^<]+)<\/title>/)?.[1],description=text.match(/<meta name="description" content="([^"]+)"/)?.[1];
 assert(title&&description,`${page}: нет title или description`);
 assert(!titles.has(title)&&!descriptions.has(description),`${page}: title или description повторяет другую страницу`);
 titles.add(title);descriptions.add(description);
 assert(description.length<=160,`${page}: description длиннее 160 символов (${description.length})`);
 assert.equal([...text.matchAll(/<h1\b/g)].length,1,`${page}: на странице должен быть ровно один h1`);
 assert(text.includes(`<link rel="canonical" href="${url}">`),`${page}: canonical должен быть ${url}`);
 assert(text.includes(`<meta property="og:url" content="${url}">`),`${page}: og:url должен быть ${url}`);
 for(const [,json] of text.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g))JSON.parse(json);
}
const sitemap=await readFile(resolve(dist,'sitemap.xml'),'utf8');
for(const page of MAIN_PAGES)assert(sitemap.includes(`<loc>${SITE}${page==='index.html'?'':page}</loc>`),'sitemap.xml: нет '+page);

// ── Общие фрагменты и сгенерированное ────────────────────────────────────────
for(const page of MAIN_PAGES)for(const name of PAGES[page].shared){
 const block=sharedBlock(html[page],name);
 if(block===null){fail(`${page}: нет маркеров SHARED:${name}`);continue;}
 if(block!==wrap(renderPartial(await readPartial(name),page)))fail(`${page}: фрагмент ${name} отличается от src/partials/${name}.html — выполните npm run pages`);
}
if(between(html['services.html'],'CATALOG')!==renderCatalog())fail('services.html: каталог отстал от meatwash-content.json — выполните npm run catalog');
if(between(html['index.html'],'PREVIEW')!==renderPreview())fail('index.html: превью услуг отстало от meatwash-content.json — выполните npm run catalog');
if(await readFile(resolve(dist,'js/data.js'),'utf8')!==renderData())fail('js/data.js отстал от meatwash-content.json — выполните npm run catalog');
// Статьи, Политика, Согласие и карта сайта собираются из src/content и JSON.
for(const page of CONTENT)if(html[page.file]!==await renderPage(page.file,await renderContent(page)))fail(`${page.file} отстал от src/content или meatwash-content.json — выполните npm run build`);
if(sitemap!==renderSitemap())fail('sitemap.xml отстал от src/content/pages.mjs — выполните npm run content');

// ── Данные и цены ────────────────────────────────────────────────────────────
const content=JSON.parse(await readFile(resolve(dist,'assets/meatwash-content.json')));
assert.equal(content.programs.length,5);
assert.equal(content.bodyTypes.length,4);
assert.deepEqual(content.programPrices,[[2150,2250,2450,2650],[2850,3150,3450,4250],[4950,5450,5950,6450],[6450,7450,8450,9450],[13950,14950,15950,16950]]);
// Четыре категории в порядке показа (каталог, превью на главной, вкладки гаража);
// мойка — единственная с записью в YCLIENTS, остальное — заявка с фото.
const CATEGORY_SPEC=[
 ['wash','Мойка','Регулярный уход и программы мойки.','yclients'],
 ['detailing','Детейлинг','Глубокая очистка и уход за салоном.','request'],
 ['protection','Защита','Полировка, покрытия и оклейка кузова.','request'],
 ['help','Помощь','Устранение повреждений и подготовка к продаже.','request'],
];
assert.deepEqual(content.groups.map(g=>[g.id,g.title,g.desc,g.booking]),CATEGORY_SPEC,'Категории: ровно четыре — Мойка, Детейлинг, Защита, Помощь — с этими подписями и сценарием записи');
for(const group of content.groups)assert(group.short&&!('featured' in group),'Категория без короткого названия или со старым флагом featured: '+group.id);
assert(!('extraWork' in content),'extraWork больше не используется: позиции — только в groups');
const itemPrice=Object.fromEntries(content.groups.flatMap(g=>g.items.map(([name,price])=>[name,price])));
const itemCount=content.groups.flatMap(group=>group.items).length;
// Перенос из восьми категорий без потерь: каждая прежняя позиция — ровно в одной категории.
const MIGRATED=['Заправка омывающей жидкости','Обезжиривание кузова и удаление реагента','Очистка битума кузова','Обработка резинок и уплотнителей силиконом','Удаление металлических вкраплений','Пылесос салона','Чистка багажника','Химчистка отдельного элемента','Химчистка руля','Химчистка сиденья','Озонация салона','Сухой туман','Детейлинг-химчистка салона','Очистка кондиционера','Кондиционер кожи сидений','Восстановление пластика салона','Химчистка и защита кожи кремом LeTech','Керамика кожи салона','Локальная полировка элемента','Восстановление хрома','Полировка фар','Полировка кузова + 2 слоя керамики','Защитное кварцевое покрытие кузова','Керамическое покрытие кузова','Керамика дисков','Оклейка зон риска','Полная оклейка','Оклейка фар плёнкой','Ремонт автомобильных стёкол','Бронирование лобового стекла','Антидождь передней полусферы','Антидождь всех стёкол автомобиля','Химчистка радиаторов','Детейлинг моторного отсека','Детейлинг дисков','Детейлинг подвески','Удаление сколов и подкраска','Удаление вмятин PDR','Локальный окрас элемента','Предпродажная подготовка','Порошковая покраска дисков'];
const allNames=content.groups.flatMap(g=>g.items.map(([name])=>name));
assert.equal(new Set(allNames).size,allNames.length,'Позиция каталога повторяется в двух категориях');
for(const name of MIGRATED)assert(name in itemPrice,'Потеряна позиция каталога: '+name);
// Подразделы: каждая позиция категории — ровно в одном подразделе своей категории;
// программы мойки — только в «Мойке».
const sectionOf={};
for(const group of content.groups){
 const names=group.items.map(([name])=>name),inSections=group.sections.flatMap(s=>s.items||[]);
 assert.deepEqual([...inSections].sort(),[...names].sort(),`Категория ${group.id}: подразделы не совпадают с позициями`);
 for(const section of group.sections){
  assert(/^(programs|price-[a-z-]+)$/.test(section.id)&&section.title,`Подраздел без id или названия в ${group.id}`);
  assert(Boolean(section.programs)===(section.id==='programs')&&(!section.programs||group.id==='wash'),`Подраздел программ — только «programs» в «Мойке»`);
  for(const name of section.items||[])sectionOf[name]=[group.id,section.id];
 }
}
const sectionIds=content.groups.flatMap(g=>g.sections.map(s=>s.id));
assert.equal(new Set(sectionIds).size,sectionIds.length,'id подразделов повторяются');
// Решения владельца по местам: антидождь — защита, ремонт стёкол — помощь,
// оклейка зон риска и полная — отдельные позиции в выделенном подразделе.
assert.deepEqual(sectionOf['Ремонт автомобильных стёкол'],['help','price-glass-repair'],'Ремонт стёкол — в «Помощи», отдельным подразделом');
for(const name of ['Антидождь передней полусферы','Антидождь всех стёкол автомобиля'])assert.equal(sectionOf[name]?.[0],'protection',`«${name}» — в «Защите»`);
for(const name of ['Оклейка зон риска','Полная оклейка'])assert.deepEqual(sectionOf[name],['protection','price-film'],`«${name}» — в «Защите», подраздел оклейки`);
assert.equal(sectionOf['Предпродажная подготовка']?.[0],'help','Предпродажная подготовка — в «Помощи»');
assert.deepEqual(content.groups.flatMap(g=>g.sections.filter(s=>s.accent).map(s=>s.id)),['price-film','price-glass-repair'],'Выделены подразделы оклейки и ремонта стёкол');
assert(!('Чернение шин' in itemPrice),'Чернение шин — не отдельная платная позиция (оно в составе программы)');
assert(content.programIncludes[2].includes('Чернение шин'),'Чернение шин должно остаться в составе «Детейлинг-мойки от реагентов»');
for(const [name,price,about] of content.groups.flatMap(g=>g.items)){
 assert(price==null||Number.isInteger(price)&&price>0,`«${name}»: цена — целое число или null (после оценки)`);
 assert(typeof about==='string'&&about.length>5&&about.length<=120,`«${name}»: нужно короткое пояснение (до 120 знаков)`);
}
// Состав программ и пакетов позициями каталога: по нему гараж не берёт работу второй раз.
assert.equal(content.programItems.length,content.programs.length,'programItems — по одному списку на программу');
for(const name of content.programItems.flat())assert(name in itemPrice,'programItems: нет позиции каталога «'+name+'»');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const services=html['services.html'];
// Каталог: четыре переключателя и четыре панели в порядке JSON; в панели — подразделы
// с якорями из sections, у каждой позиции — пояснение, цена или «После оценки» и одно
// действие: мойка — запись (data-book с работой для корзины YCLIENTS), остальное — заявка с фото.
const tabs=[...services.matchAll(/<a class="catalog__tab" id="catalog-tab-([a-z]+)" href="#price-\1">([^<]+)<\/a>/g)].map(m=>[m[1],m[2]]);
assert.deepEqual(tabs,content.groups.map(g=>[g.id,escape(g.title)]),'services.html: переключатели категорий не совпадают с четырьмя категориями JSON');
const panelAt=[...services.matchAll(/<section class="catalog__panel" id="price-([a-z]+)" data-category="\1"/g)];
assert.deepEqual(panelAt.map(m=>m[1]),content.groups.map(g=>g.id),'services.html: панели категорий не совпадают с JSON');
const priceLabel=price=>price==null?'После оценки':'от '+price.toLocaleString('ru-RU')+' ₽';
content.groups.forEach((group,gi)=>{
 const panel=services.slice(panelAt[gi].index,gi+1<panelAt.length?panelAt[gi+1].index:services.indexOf('class="catalog__note"'));
 assert(panel.includes(`<h2 class="catalog__panel-title" id="price-${group.id}-title">${escape(group.title)}</h2>`)&&panel.includes(escape(group.desc)),`Категория ${group.id}: нет заголовка или подписи`);
 const blocks=[...panel.matchAll(/<div class="catalog__block( catalog__block--accent)?" id="([a-z0-9-]+)">/g)];
 assert.deepEqual(blocks.map(m=>[m[2],Boolean(m[1])]),group.sections.map(s=>[s.id,Boolean(s.accent)]),`Категория ${group.id}: подразделы не совпадают с JSON (порядок, якоря, выделение)`);
 group.sections.forEach((section,si)=>{
  const block=panel.slice(blocks[si].index,si+1<blocks.length?blocks[si+1].index:panel.length);
  assert(block.includes(`<h3 class="catalog__subhead">${escape(section.title)}`),`Подраздел ${section.id}: нет заголовка`);
  for(const name of section.items||[]){
   const [,price,about]=group.items.find(([n])=>n===name),n=escape(name);
   const action=group.booking==='yclients'?`data-book data-book-context="${n}" data-yc-items="${n}">Записаться`:`data-request data-request-category="${group.id}" data-request-services="${n}">Заявка с фото`;
   assert(block.includes(`<li class="catalog__item" data-price-item="${n}"><div class="catalog__item-text"><p class="catalog__item-name">${n}</p><p class="catalog__item-note">${escape(about)}</p></div><p class="catalog__item-price${price==null?' catalog__item-price--estimate':''}">${priceLabel(price)}</p><button class="catalog__action" type="button" ${action}`),`Нет или устарела услуга «${name}» в подразделе ${section.id}`);
  }
 });
 // Сценарий записи в категории: мойка — окно филиалов (data-book), остальное — заявка (data-request).
 if(group.booking==='yclients')assert(/data-book/.test(panel)&&!/data-request/.test(panel),`Категория ${group.id}: нужна запись в YCLIENTS, без заявки`);
 else assert(/data-request/.test(panel)&&!/data-book/.test(panel),`Категория ${group.id}: нужна заявка с фото, без записи в YCLIENTS`);
});
// Программы и пакеты мойки — в подразделе programs: цена по кузову, состав — по «Подробнее».
const programsBlock=services.slice(services.indexOf('<div class="catalog__block" id="programs">'),services.indexOf('id="price-wash-extras"'));
content.programs.forEach(([name],i)=>{
 assert(new RegExp(`<details class="program__details" id="program-${i}">[\\s\\S]*?${escape(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[\\s\\S]*?data-prices="${content.programPrices[i].join(',')}"[\\s\\S]*?<ul class="program-includes">${content.programIncludes[i].map(x=>`<li>${escape(x)}</li>`).join('')}</ul>`).test(programsBlock),`Программа ${i} «${name}»: нет строки с ценами по кузову и составом`);
 assert(programsBlock.includes(`data-book data-program="${i}"`),`Программа ${i}: нет записи`);
});
assert.equal([...services.matchAll(/data-price-item=/g)].length,itemCount,'services.html: число позиций не совпадает с JSON');
assert(!/featured__card|class="categories"|>после осмотра</.test(services),'services.html: остатки прежнего каталога (карточки featured, полоса категорий, «после осмотра»)');
// Прежние якоря (ссылки из статей, закладки, поиск) ведут в существующие места каталога.
for(const id of ['price-list','price-wash','programs','program-0','program-4','price-interior','price-leather','price-components','price-film','price-polish','price-glass','price-bodywork'])assert(ids['services.html'].has(id),'services.html: пропал якорь #'+id);
// Превью на главной: четыре карточки — по одной на категорию, в том же порядке.
const cards=[...html['index.html'].matchAll(/<a class="card card--([a-z]+)" href="services\.html#price-\1">/g)].map(m=>m[1]);
assert.deepEqual(cards,content.groups.map(g=>g.id),'index.html: карточки превью не совпадают с четырьмя категориями');

const config=await importDist(resolve(dist,'js/config.js'));
// Гараж: вкладки — те же категории; каждая работа ссылается на цену каталога;
// название — как в каталоге services.html; сумма по каждому кузову = JSON.
const {garageSum}=config;
assert.deepEqual(config.ZONE_GROUPS.map(g=>[g.id,g.title]),content.groups.map(g=>[g.id,g.short]),'Гараж: вкладки не совпадают с четырьмя категориями каталога (порядок и названия)');
for(const group of content.groups)assert(config.ZONES.some(z=>z.group===group.id),`Гараж: во вкладке «${group.title}» нет работ`);
const expected=(zone,body)=>zone.price.program!=null?content.programPrices[zone.price.program][body]:itemPrice[zone.price.item];
for(const zone of config.ZONES){
 assert(zone.price&&(zone.price.program!=null?content.programPrices[zone.price.program]:zone.price.item in itemPrice),`Гараж: у работы ${zone.id} нет цены в каталоге`);
 assert.equal(zone.title,zone.price.program!=null?content.programs[zone.price.program][0]:zone.price.item,`Гараж: название ${zone.id} не совпадает с каталогом`);
 assert(services.includes(escape(zone.title)),`Гараж: «${zone.title}» нет в каталоге services.html`);
 // Категория работы в гараже — та же, что у позиции в каталоге (программы — мойка).
 assert.equal(zone.group,zone.price.program!=null?'wash':sectionOf[zone.price.item]?.[0],`Гараж: «${zone.title}» не в своей категории`);
 if(zone.price.program==null)assert.equal(zone.caption,content.groups.flatMap(g=>g.items).find(([name])=>name===zone.price.item)[2],`Гараж: пояснение «${zone.title}» — не из каталога`);
 const prices=content.bodyTypes.map((_,b)=>expected(zone,b));
 assert.equal(zone.from,prices.includes(null)?null:Math.min(...prices),`Гараж: «от» у ${zone.id} не минимальная цена каталога`);
 for(let body=0;body<content.bodyTypes.length;body++)assert.equal(config.zonePrice(zone,body),expected(zone,body),`Гараж: цена ${zone.id} для кузова ${content.bodyTypes[body]}`);
}
assert(!config.ZONES.some(z=>z.price.item==='Чернение шин'),'Гараж: чернение шин — не отдельная работа');
assert.equal(config.ZONES.find(z=>z.id==='interior')?.price.item,'Детейлинг-химчистка салона','Гараж: химчистка — салон целиком');
assert(!config.ZONES.some(z=>/^Химчистка (сиденья|руля|отдельного)/.test(z.title)),'Гараж: химчистка выбирается салоном целиком, без отдельных деталей');
assert(['Оклейка зон риска','Полная оклейка'].every(name=>config.ZONES.some(z=>z.price.item===name)),'Гараж: оклейка — зоны риска и полная');
// Все программы и пакеты мойки — в гараже и взаимоисключающие (каждая следующая включает предыдущую).
const programZones=config.ZONES.filter(z=>z.price.program!=null);
assert.deepEqual(programZones.map(z=>z.price.program).sort(),content.programs.map((_,i)=>i),'Гараж: нужны все программы и пакеты мойки из каталога');
assert(config.EXCLUSIVE.some(group=>programZones.every(z=>group.includes(z.id))),'Гараж: программы и пакеты мойки должны быть в одной группе EXCLUSIVE');
for(const group of config.EXCLUSIVE)for(const id of group)assert(config.ZONES.some(z=>z.id===id),'EXCLUSIVE: нет работы '+id);
// Работа, уже входящая в программу или пакет (programItems с составом предыдущих),
// при выборе вместе с ним в сумму не попадает — по каждому кузову.
const includes=i=>content.programItems.slice(0,i+1).flat();
let insideChecked=0;
for(const program of programZones)for(const zone of config.ZONES.filter(z=>includes(program.price.program).includes(z.price.item))){
 insideChecked++;
 for(let body=0;body<content.bodyTypes.length;body++)assert.equal(garageSum([program.id,zone.id],body),expected(program,body),`Гараж: «${zone.title}» входит в «${program.title}», но считается второй раз`);
}
assert(insideChecked>0,'Гараж: не найдено ни одной работы, входящей в программу или пакет (проверка состава не работает)');
// Пакет со всем, что в него входит: сумма — ровно цена пакета для кузова.
for(const program of programZones.filter(z=>z.package)){
 const inside=config.ZONES.filter(z=>includes(program.price.program).includes(z.price.item)).map(z=>z.id);
 for(let body=0;body<content.bodyTypes.length;body++)assert.equal(garageSum([program.id,...inside],body),expected(program,body),`Пакет «${program.title}»: сумма для кузова ${content.bodyTypes[body]}`);
}
assert.equal(typeof config.garageOpen,'function','Гараж: нет garageOpen — работы с ценой после осмотра');
// Мойка и заявка разделены: мойка — только программы и пакеты.
assert.deepEqual(config.ZONES.filter(z=>config.isWash(z)).map(z=>z.id),programZones.map(z=>z.id),'Гараж: в запись YCLIENTS уходит только мойка');

// Первый экран — статичная фотография: закреплённой сцены, глав и ScrollTrigger нет.
assert(!/class="scene\b|data-chapter|chapter-nav|ScrollTrigger|vendor\/gsap/.test(html['index.html']),'index.html: остатки закреплённой сцены или GSAP');
assert(/<section class="hero" id="hero"/.test(html['index.html'])&&/class="hero__photo" src="assets\/shots\//.test(html['index.html']),'index.html: первый экран без фотографии');
// Вход в гараж: на первом экране и в промоблоке, одинаковые кнопки.
const entries=[...html['index.html'].matchAll(/<button\b[^>]*data-garage-open[^>]*>([^<]+)</g)].map(m=>m[1].trim());
assert(entries.length>=2&&entries.every(t=>t==='Открыть 3D-гараж'),'index.html: нужны два входа «Открыть 3D-гараж» (первый экран и промоблок): '+entries.join(', '));
const cinematic=await readFile(resolve(dist,'css/cinematic.css'),'utf8'),style=await readFile(resolve(dist,'css/style.css'),'utf8');
for(const [name,css] of [['style.css',style],['cinematic.css',cinematic]])assert(!/\.scene\b|--scene-len|\.chapter\b|\.static-experience/.test(css),`${name}: правила удалённой сцены`);

// Цены в статьях — только подстановки из каталога ({{price:…}}): каждая «от N ₽» есть в JSON.
const catalogPrices=new Set([...content.programPrices.flat(),...content.groups.flatMap(g=>g.items.map(x=>x[1]))]);
for(const page of CONTENT.filter(p=>p.kind==='article'))for(const [,num] of html[page.file].matchAll(/от ([\d\s\u00a0\u202f]+) ₽/g)){
 const value=Number(num.replace(/\D/g,''));
 if(!catalogPrices.has(value))fail(`${page.file}: цена ${value} ₽ не из каталога`);
}

// ── Скрипты: синтаксис и граф модулей каждой страницы ────────────────────────
for(const filename of await readdir(resolve(dist,'js'))){
 if(!filename.endsWith('.js'))continue;
 const text=await readFile(resolve(dist,'js',filename),'utf8');
 const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:text,encoding:'utf8'});
 if(result.status!==0)fail(`${filename}: ${result.stderr}`);
 for(const [,url] of text.matchAll(/(?:from\s*|import\()['"](\.[^'"]+)['"]/g))if(!await exists(resolve(dist,'js',url)))fail(`${filename}: нет модуля ${url}`);
}
const is3d=name=>/porsche3d/.test(name);
const lazy3d=new Set(),pageCode={},graphs={};
for(const page of MAIN_PAGES){
 const text=html[page];
 const modules=new Set([...text.matchAll(/<script\b[^>]*\bsrc="js\/([^"]+)"/g)].map(m=>m[1]));
 for(const name of modules){
  assert(!is3d(name),`${page}: 3D-модуль подключён <script>: ${name}`);
  const code=await readFile(resolve(dist,'js',name),'utf8');
  for(const [,url] of code.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]\.\/([^'"]+)['"]/g))assert(!is3d(url),`${name} статически импортирует 3D: ${url}`);
  for(const [,url] of code.matchAll(/(?:from\s*|import\()['"]\.\/([^'"]+)['"]/g)){if(is3d(url))lazy3d.add(`${name} → ${url}`);else modules.add(url);}
 }
 graphs[page]=modules;
 pageCode[page]=[text,...await Promise.all([...modules].map(name=>readFile(resolve(dist,'js',name),'utf8')))].join('\n');
 // До нажатия 3D не запрашивается: ни three, ни модели, ни importmap, preload или prefetch на 3D.
 assert(!/porsche-930|\.glb\b|assets\/3d\/|importmap|vendor\/build|vendor\/examples/.test(pageCode[page]),`${page}: ссылка на 3D-ресурсы (модель, three, importmap)`);
 assert(!/porsche3d\.bundle|js\/porsche3d/.test(text),`${page}: страница ссылается на 3D-модуль (script, preload, prefetch)`);
 for(const [tag] of text.matchAll(/<link\b[^>]*>/g))assert(!(/modulepreload|prefetch|prerender/.test(tag)&&/js\/|\.glb|assets\/3d/.test(tag)),`${page}: preload/prefetch скриптов или 3D: ${tag}`);
 // Карты филиалов: iframe создаёт maps.js, когда карточка подходит к экрану, — в разметке его нет.
 assert(!/<iframe\b/i.test(text)&&!/map-widget/.test(text),`${page}: iframe карты в разметке — он должен создаваться скриптом при подходе к карточке`);
 // Окно карты убрано: встроенные карты в карточках его заменили.
 assert(!/map-dialog|data-map="/.test(text),`${page}: остатки окна карты (map-dialog, data-map)`);
}
for(const entry of lazy3d)assert(/→ porsche3d\.bundle\.js$/.test(entry),'Лениво можно грузить только porsche3d.bundle.js: '+entry);
// Яндекс Метрика — только после согласия (js/analytics.js): кода счётчика и пикселя в разметке нет,
// номер счётчика и код Вебмастера — из JSON, на всех страницах одинаковые.
const site=content.site?.analytics||{};
for(const page of MAIN_PAGES){
 assert(graphs[page].has('analytics.js'),`${page}: нет js/analytics.js (уведомление о cookie и цели)`);
 assert(!/mc\.yandex\.ru|metrika\/tag\.js/.test(html[page]),`${page}: код Метрики в разметке — он должен грузиться только после согласия`);
 assert(html[page].includes('<!-- SHARED:analytics:START -->'),`${page}: нет блока аналитики в <head>`);
 assert(!site.metrika===!html[page].includes(`<meta name="mw-metrika" content="${site.metrika}">`),`${page}: номер счётчика Метрики не совпадает с JSON`);
 assert(!site.webmaster===!html[page].includes(`<meta name="yandex-verification" content="${site.webmaster}">`),`${page}: код Вебмастера не совпадает с JSON`);
 assert(html[page].includes('href="privacy.html"'),`${page}: нет ссылки на Политику обработки персональных данных`);
}
// Клубная карта — ссылка на страницу оформления (wahelp), адрес — от владельца.
const CLUB_CARD='https://admin.wahelp.cards/lendings/019c6b46-a042-7121-8e8c-23717fd3195e';
for(const page of MAIN_PAGES.filter(p=>PAGES[p].shared.includes('membership')))
 assert(new RegExp(`<a class="membership__link" href="${CLUB_CARD.replace(/[.?]/g,'\\$&')}" target="_blank" rel="noopener noreferrer"`).test(html[page]),`${page}: клубная карта не ведёт на ${CLUB_CARD}`);
// Файл подтверждения Вебмастера — для кода из JSON и только он (старые коды не остаются).
{
 const verification=renderYandexVerification(),files=(await readdir(dist)).filter(name=>/^yandex_\w+\.html$/.test(name));
 assert.deepEqual(files,verification?[verification.file]:[],`файлы подтверждения Вебмастера в dist (${files.join(', ')||'нет'}) не совпадают с site.analytics.webmaster — выполните npm run content`);
 if(verification)assert.equal(await readFile(resolve(dist,verification.file),'utf8'),verification.text,`${verification.file} отстал от site.analytics.webmaster — выполните npm run content`);
}
// Вебвизор записывает действия на странице: включён — значит назван в уведомлении, Политике и Согласии.
{
 const code=await readFile(resolve(dist,'js/analytics.js'),'utf8');
 const webvisor=/\bwebvisor:\s*true\b/.test(code);
 assert(webvisor||/\bwebvisor:\s*false\b/.test(code),'js/analytics.js: webvisor в init счётчика должен быть явно true или false');
 for(const [name,text] of [['уведомление о cookie (js/analytics.js)',code.match(/consent__text">([^<]*)/)?.[1]||''],...await Promise.all(['privacy.html','consent.html'].map(async file=>[file,await readFile(resolve(dist,file),'utf8')])) ])
  assert(webvisor===text.includes('Вебвизор'),`${name}: ${webvisor?'не назван Вебвизор, а он включён':'упомянут Вебвизор, а он выключен'}`);
 // Политика обещает, что ввод в форме заявки Вебвизор не пишет: текстовые поля — ym-disable-keys, форма — ym-hide-content.
 if(webvisor){
  const dialogs=await readFile(resolve(root,'src/partials/dialogs.html'),'utf8');
  const form=dialogs.match(/<form class="request[^"]*"[\s\S]*?<\/form>/)?.[0]||'';
  assert(/<form class="request[^"]*\bym-hide-content\b/.test(form),'Заявка: у формы нет ym-hide-content — Вебвизор покажет введённый текст');
  for(const field of form.match(/<(?:input|textarea)\b[^>]*>/g)||[]){
   if(/type="(?:radio|checkbox|file)"|name="mw_extra"/.test(field))continue;
   assert(/\bym-disable-keys\b/.test(field),`Заявка: поле без ym-disable-keys — Вебвизор запишет ввод: ${field.slice(0,80)}`);
  }
 }
}
// Главная — гараж (оболочка сразу, 3D по кнопке); внутренние страницы без гаража, GSAP и 3D.
assert(graphs['index.html'].has('garage.js'),'Главная должна подключать гараж (garage.js)');
assert([...lazy3d].some(entry=>entry==='garage.js → porsche3d.bundle.js'),'3D грузит только garage.js по нажатию: '+[...lazy3d].join(', '));
for(const name of ['stage.js','live3d.js','configurator.js','interior.js'])assert(!graphs['index.html'].has(name),'Главная грузит удалённый или 3D-модуль: '+name);
for(const page of MAIN_PAGES.filter(p=>p!=='index.html')){
 for(const name of ['garage.js','main.js'])assert(!graphs[page].has(name),`${page}: грузит модуль главной ${name}`);
 assert(![...graphs[page]].some(is3d)&&!/vendor\/(gsap|ScrollTrigger)/.test(html[page]),`${page}: GSAP, ScrollTrigger или 3D на внутренней странице`);
}

// ── Запись и карта: у площадок разные компании в yclients и свои карточки ─────
const bookings=new Set();
for(const location of content.locations){
 assert(/^https:\/\/n\d+\.yclients\.com\/company\/\d+\//.test(location.booking||''),'Нет ссылки yclients у '+location.id);
 for(const page of MAIN_PAGES)assert(html[page].includes(`href="${location.booking}"`),`${page}: нет ссылки записи ${location.id}`);
 bookings.add(location.booking);
 assert(/^\d+$/.test(location.orgId)&&location.map.includes(`/${location.orgId}/`),`${location.id}: org id и ссылка на карточку не совпадают`);
 assert(new RegExp(`^https://yandex\\.ru/map-widget/v1/org/[a-z_]+/${location.orgId}/\\?ll=`).test(location.mapWidget),`${location.id}: mapWidget — не виджет карточки организации`);
 assert(location.mapWidget.includes(`ll=${location.lon}%2C${location.lat}`)&&location.route.includes(`rtext=~${location.lat}%2C${location.lon}`),`${location.id}: координаты виджета и маршрута расходятся с lat/lon`);
 // Карта филиала — в его карточке на страницах с блоком локаций; «На карте» в подвале ведёт к ней.
 for(const page of MAIN_PAGES){
  const withLocations=PAGES[page]?.shared?.includes('locations');
  if(withLocations){const block=html[page].slice(html[page].indexOf(`id="map-${location.id}"`));assert(ids[page].has(`map-${location.id}`)&&/^id="[^"]+"[^>]*data-map-embed="/.test(block)&&block.startsWith(`id="map-${location.id}"`)&&block.slice(0,block.indexOf('</article>')).includes(`location__external" href="${location.map}"`),`${page}: нет встроенной карты ${location.id} (область, якорь, резервная ссылка на карточку организации)`);}
  assert(new RegExp(`<a class="footer__map" href="${withLocations?'':'\\./'}#map-${location.id}"[^>]*data-map-link="${location.id}"`).test(html[page]),`${page}: «На карте» в подвале не ведёт к карте ${location.id}`);
 }
}
assert.equal(bookings.size,content.locations.length,'У филиалов должны быть разные ссылки записи');
// Любая другая ссылка на yclients (например, общая n975571.yclients.com) — ошибка.
for(const page of MAIN_PAGES)for(const [url] of pageCode[page].matchAll(/https?:\/\/[\w.-]*yclients\.com[^"'\s<)\\]*/g))assert(bookings.has(url),`${page}: неожиданная ссылка yclients ${url}`);

// ── Заявка с фото ───────────────────────────────────────────────────────────
// Окно на всех страницах с общими окнами; согласие обязательно и со ссылкой на
// отдельный документ; ни адресов ботов, ни токенов в коде страницы.
for(const page of MAIN_PAGES.filter(p=>PAGES[p].shared.includes('dialogs'))){
 assert(ids[page].has('request'),`${page}: нет окна заявки #request`);
 assert(/<input type="checkbox" name="consent" required/.test(html[page])&&html[page].includes('href="consent-request.html"'),`${page}: в заявке нет обязательного согласия со ссылкой на consent-request.html`);
 assert(!/api\.telegram\.org|bot\d{6,}:|[?&](token|apikey|api_key)=|Bearer\s/i.test(pageCode[page]),`${page}: в клиентском коде адрес бота или токен`);
}
const requestCode=await readFile(resolve(dist,'js/request.js'),'utf8');
assert(/result\?\.ok !== true/.test(requestCode)&&/!response\.ok/.test(requestCode),'js/request.js: «отправлено» — только после ответа сервера {ok:true}');
const endpoint=content.site?.requests?.endpoint,requestHosts=content.site?.requests?.hosts??[];
assert(endpoint==null||/^(https:\/\/[^\s]+|\/[^/\s][^\s]*|[\w-][\w./-]*)$/.test(endpoint),'site.requests.endpoint: https-адрес или путь на этом сайте (например api/request.php)');
assert(Array.isArray(requestHosts)&&requestHosts.every(host=>/^[a-z0-9.-]+$/.test(host)),'site.requests.hosts: список имён сайтов, например ["meatwash.ru"]');
// Обработчик на хостинге (dist/api/request.php) и форма говорят об одном: до N фото,
// поле photos[], ловушка mw_extra (в разметке — вне Tab и скринридера), согласие.
const requestPhp=await readFile(resolve(dist,'api/request.php'),'utf8');
const maxFiles=requestCode.match(/const MAX_FILES = (\d+);/)?.[1];
assert(maxFiles&&requestPhp.includes(`const MAX_FILES = ${maxFiles};`),'js/request.js и api/request.php: разное наибольшее число фото (MAX_FILES)');
assert(/const MAX_BYTES = 10 \* 1024 \* 1024;/.test(requestCode)&&/const MAX_FILE_BYTES = 10 \* 1024 \* 1024;/.test(requestPhp),'js/request.js и api/request.php: фото до 10 МБ');
assert(requestCode.includes("body.append('photos[]'")&&requestPhp.includes("$_FILES['photos']"),'Фото уходят полем photos[] — иначе PHP получит только последнее');
for(const page of MAIN_PAGES.filter(p=>PAGES[p].shared.includes('dialogs'))){
 assert(html[page].includes(`>До ${maxFiles} фото:`),`${page}: в окне заявки число фото не как в js/request.js (${maxFiles})`);
 assert(/<div class="visually-hidden" aria-hidden="true"><label>[^<]*<input name="mw_extra" tabindex="-1" autocomplete="off"><\/label><\/div>/.test(html[page]),`${page}: в заявке нет ловушки mw_extra (скрыта, вне Tab и скринридера)`);
}
assert(requestCode.includes("'mw_extra'")&&requestPhp.includes("$_POST['mw_extra']")&&requestPhp.includes("$_POST['consent'] ?? '') !== 'yes'"),'api/request.php: ловушка и обязательное согласие');
// Секреты — только в настройках на хостинге: ни токенов, ни паролей, ни адресов почты
// в публикуемых PHP (GitHub Pages отдаёт их как текст) и только заглушки в образце.
for(const name of (await readdir(resolve(dist,'api'))).filter(name=>name.endsWith('.php'))){
 const code=await readFile(resolve(dist,'api',name),'utf8');
 assert(!/\d{6,}:[\w-]{30,}/.test(code),`api/${name}: похоже на токен Telegram-бота`);
 assert(!/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}/i.test(code),`api/${name}: адрес почты — только в настройках вне сайта`);
 assert(!/['"](secret|password|passwd|pass|token|api_?key|chat_id)['"]\s*=>\s*['"][^'"]{6,}/i.test(code),`api/${name}: секрет в коде — только в настройках вне сайта`);
}
const requestExample=await readFile(resolve(root,'server/request-config.example.php'),'utf8');
assert(!/\d{6,}:[\w-]{30,}/.test(requestExample)&&[...requestExample.matchAll(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g)].every(m=>/^example\.(com|org|net)$/i.test(m[1]))&&/'secret' => 'ЗАМЕНИТЕ/.test(requestExample)&&/'file' => \[\s*'enabled' => false/.test(requestExample),'server/request-config.example.php: только заглушки (секрет, адреса example.com, без токена), канал file выключен');

assert.equal(failures.length,0,failures.join('\n'));
const notes=[];
if(missingOperator().length)notes.push(`реквизиты оператора в Политике и Согласии: ${missingOperator().join(', ')}`);
if(!site.metrika)notes.push('номер счётчика Яндекс Метрики (Метрика и уведомление о cookie выключены)');
if(!site.webmaster)notes.push('код подтверждения Яндекс Вебмастера');
if(notes.length)console.warn('ВНИМАНИЕ: не заполнено в site (meatwash-content.json) — '+notes.join('; ')+'.');
console.log(`PASS: ${ALL_PAGES.length} страниц — ресурсы, якоря и межстраничные ссылки; мета и sitemap; общие фрагменты и каталог совпадают с источниками; ${content.groups.length} категории (${itemCount} позиция, мойка — запись в YCLIENTS, остальное — заявка с фото); цены каталога и гаража (названия как в каталоге, по ${content.bodyTypes.length} кузовам, ${programZones.filter(z=>z.package).length} пакета мойки, ${insideChecked} работ из программ и пакетов без повторного начисления); заявка: согласие обязательно, без токенов в коде; первый экран без сцены и GSAP, два входа в гараж; 3D только по нажатию (${[...lazy3d].join(', ')}); внутренние страницы без гаража и 3D; запись и встроенная карта обоих филиалов (iframe — только скриптом, «На карте» в подвале ведёт к карте), окна карты нет.`);
