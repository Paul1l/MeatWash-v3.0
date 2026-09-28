// npm run check — проверка сайта без браузера, для всех страниц dist:
// ресурсы и якоря (в том числе межстраничные services.html#…), общие фрагменты
// (src/partials) и сгенерированный каталог совпадают с источниками, цены (каталог,
// окно услуги, гараж — суммы по каждому кузову), кадры витрины, 3D только по
// нажатию и только на главной, ссылки записи обоих филиалов, окно карты, мета.
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {PAGES,renderPartial,readPartial,sharedBlock,wrap} from './pages.mjs';
import {renderCatalog,renderPreview,renderData,between} from './catalog.mjs';
import {importDist} from './dist-module.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=resolve(root,'dist');
const SITE='https://paul1l.github.io/MeatWash-v3.0/';
const failures=[];
const fail=message=>failures.push(message);
const exists=async path=>{try{return (await stat(path)).isFile();}catch{return false;}};

// ── Страницы ─────────────────────────────────────────────────────────────────
const MAIN_PAGES=Object.keys(PAGES);                      // index, services, about
const ALL_PAGES=[...MAIN_PAGES,'credits.html'];
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

// ── Данные и цены ────────────────────────────────────────────────────────────
const content=JSON.parse(await readFile(resolve(dist,'assets/meatwash-content.json')));
assert.equal(content.programs.length,5);
assert.equal(content.bodyTypes.length,4);
assert.equal(content.groups.flatMap(group=>group.items).length,39);
assert.deepEqual(content.programPrices,[[2150,2250,2450,2650],[2850,3150,3450,4250],[4950,5450,5950,6450],[6450,7450,8450,9450],[13950,14950,15950,16950]]);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const services=html['services.html'];
for(const group of content.groups){
 assert(ids['services.html'].has('price-'+group.id),'Нет группы прайса '+group.id);
 for(const [name,price] of group.items)assert(services.includes(`<dt>${escape(name)}</dt><dd>${price.toLocaleString('ru-RU')} ₽</dd>`),'Нет или устарела услуга '+name);
}
for(const prices of content.programPrices)assert(services.includes(`data-prices="${prices.join(',')}"`),'Устарели цены по кузову');
assert.equal([...services.matchAll(/data-price-item/g)].length,39);
const sourcePrices=new Set([...content.programPrices.flat(),...content.groups.flatMap(g=>g.items.map(x=>x[1]))]);

const config=await importDist(resolve(dist,'js/config.js'));
assert.deepEqual(Object.values(config.STOPS),[0,.2,.4,.6,.8,1]);
assert.equal(Object.keys(config.SERVICES).length,4);
for(const service of Object.values(config.SERVICES))for(const [,price] of service.prices)assert(sourcePrices.has(price),'Цены нет в каталоге: '+price);
// Кадры витрины: LADDER_AT — возрастающие границы с нуля, по одной на кадр.
assert.equal(config.LADDER.length,6);
assert.equal(config.LADDER_AT.length,config.LADDER.length,'LADDER_AT: по границе на каждый кадр LADDER');
assert(config.LADDER_AT[0]===0&&config.LADDER_AT.every((v,i,a)=>!i||v>a[i-1]),'LADDER_AT должен возрастать от 0');

// Гараж: каждая работа ссылается на цену каталога; сумма по каждому кузову = JSON.
const {garageSum}=await importDist(resolve(dist,'js/configurator.js'));
const itemPrice=Object.fromEntries(content.groups.flatMap(g=>g.items));
const expected=(zone,body)=>zone.price.program!=null?content.programPrices[zone.price.program][body]:itemPrice[zone.price.item];
for(const zone of config.ZONES){
 assert(zone.price&&(zone.price.program!=null?content.programPrices[zone.price.program]:zone.price.item in itemPrice),`Гараж: у работы ${zone.id} нет цены в каталоге`);
 assert.equal(zone.from,Math.min(...content.bodyTypes.map((_,b)=>expected(zone,b))),`Гараж: «от» у ${zone.id} не минимальная цена каталога`);
 for(let body=0;body<content.bodyTypes.length;body++)assert.equal(config.zonePrice(zone,body),expected(zone,body),`Гараж: цена ${zone.id} для кузова ${content.bodyTypes[body]}`);
}
// Программы мойки вложены друг в друга: в гараже они взаимоисключающие, и ни один набор не берёт две.
const programZones=config.ZONES.filter(z=>z.price.program!=null).map(z=>z.id);
assert(config.EXCLUSIVE.some(group=>programZones.every(id=>group.includes(id))),'Гараж: программы мойки должны быть в одной группе EXCLUSIVE');
for(const preset of config.ZONE_PRESETS){
 for(const group of config.EXCLUSIVE)assert(preset.zones.filter(id=>group.includes(id)).length<=1,`Набор «${preset.title}» берёт две программы мойки`);
 for(let body=0;body<content.bodyTypes.length;body++){
  const sum=preset.zones.reduce((s,id)=>s+expected(config.ZONES.find(z=>z.id===id),body),0);
  assert.equal(garageSum(preset.zones,body),sum,`Набор «${preset.title}»: сумма для кузова ${content.bodyTypes[body]}`);
 }
}

// Витрина на фотографиях: каждый кадр из config.js есть в двух размерах.
const shots=new Set([...config.LADDER.map(step=>step.shot),config.SHOT_BASE,config.FILM_OPEN,...Object.keys(config.SHOT_FOCUS)]);
for(const spec of Object.values(config.ZONE_SHOTS)){shots.add(spec.shot);if(spec.pair){shots.add(spec.pair.before);shots.add(spec.pair.after);}}
for(const id of shots)for(const file of [`assets/shots/${id}.webp`,`assets/shots/${id}-s.webp`])if(!await exists(resolve(dist,file)))fail('Нет кадра витрины: '+file);

// Длина сцены — одна переменная (--scene-len в cinematic.css), других высот у .scene нет
// (кроме статичного режима: .static-experience .scene { height:auto }).
const cinematic=await readFile(resolve(dist,'css/cinematic.css'),'utf8'),style=await readFile(resolve(dist,'css/style.css'),'utf8');
assert(/\.scene \{ height:var\(--scene-len\); \}/.test(cinematic),'cinematic.css: высота .scene должна быть var(--scene-len)');
for(const [name,css] of [['style.css',style],['cinematic.css',cinematic]])
 for(const [rule] of css.matchAll(/(?:^|[{}])\s*\.scene\s*\{[^}]*\bheight\s*:\s*[^;}]+/g))
  if(!/var\(--scene-len\)/.test(rule))fail(`${name}: у .scene своя высота (${rule.trim()}) — длина задаётся только --scene-len`);

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
 // Окно карты: iframe создаёт только maps.js при открытии — в разметке его нет.
 assert(!/<iframe\b/i.test(text)&&!/map-widget/.test(text),`${page}: iframe карты в разметке — он должен создаваться только при открытии окна`);
}
for(const entry of lazy3d)assert(/→ porsche3d\.bundle\.js$/.test(entry),'Лениво можно грузить только porsche3d.bundle.js: '+entry);
// Главная — витрина и 3D по кнопке; внутренние страницы без сцены, GSAP и 3D.
assert(graphs['index.html'].has('stage.js'),'Главная должна грузить фото-витрину (stage.js)');
for(const name of ['scene.bundle.js','scene.js','garage.js','interior.js','water.js'])assert(!graphs['index.html'].has(name),'Главная грузит 3D-модуль: '+name);
for(const page of MAIN_PAGES.filter(p=>p!=='index.html')){
 for(const name of ['stage.js','live3d.js','configurator.js','main.js'])assert(!graphs[page].has(name),`${page}: грузит модуль главной ${name}`);
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
 for(const page of MAIN_PAGES)assert(html[page].includes(`data-map="${location.id}"`)&&ids[page].has('map-dialog'),`${page}: нет «На карте» для ${location.id} или окна карты`);
}
assert.equal(bookings.size,content.locations.length,'У филиалов должны быть разные ссылки записи');
// Любая другая ссылка на yclients (например, общая n975571.yclients.com) — ошибка.
for(const page of MAIN_PAGES)for(const [url] of pageCode[page].matchAll(/https?:\/\/[\w.-]*yclients\.com[^"'\s<)\\]*/g))assert(bookings.has(url),`${page}: неожиданная ссылка yclients ${url}`);

assert.equal(failures.length,0,failures.join('\n'));
console.log(`PASS: ${ALL_PAGES.length} страницы — ресурсы, якоря и межстраничные ссылки; мета и sitemap; общие фрагменты и каталог совпадают с источниками; цены каталога, окна услуги и гаража (по ${content.bodyTypes.length} кузовам, ${config.ZONE_PRESETS.length} набора); ${shots.size} кадров витрины; длина сцены — --scene-len; 3D только по нажатию и только на главной (${[...lazy3d].join(', ')}); внутренние страницы без сцены и GSAP; запись и карта обоих филиалов, iframe карты не в разметке.`);
