// Страницы из src/content: раздел «Статьи» (articles.html), статьи, Политика
// обработки персональных данных (privacy.html), Согласие (consent.html) и карта
// сайта (sitemap.xml). Цены в статьях и реквизиты оператора в документах берутся
// из dist/assets/meatwash-content.json; общие части (шапка, подвал, окна, запись,
// аналитика) вставляет scripts/pages.mjs.
// Запуск: npm run content (входит в npm run build). npm run check сверяет результат.
import {readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {content as d,escape,money} from './catalog.mjs';
import {CONTENT,ARTICLES,SITEMAP} from '../src/content/pages.mjs';
import {renderPartial,renderPage} from './pages.mjs';

const root=new URL('../',import.meta.url);
export const SITE='https://meatwash.ru/';
const MONTHS=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
export const humanDate=iso=>{const [y,m,day]=iso.split('-').map(Number);return `${day} ${MONTHS[m-1]} ${y} г.`;};

// Реквизиты оператора: пока владелец их не передал, на месте поля — заметная
// пометка, а npm run check предупреждает (site.operator в JSON).
const OPERATOR_HINT={name:'полное наименование оператора — ООО или ИП',inn:'ИНН',ogrn:'ОГРН или ОГРНИП',address:'юридический или почтовый адрес',email:'адрес электронной почты для обращений'};
export const missingOperator=()=>Object.keys(OPERATOR_HINT).filter(key=>!d.site?.operator?.[key]);
const itemPrice=Object.fromEntries(d.groups.flatMap(g=>g.items));

function substitute(text){
 return text.replace(/\{\{(price|program|program-from|program-includes|op|site):([^}]+)\}\}/g,(token,kind,arg)=>{
  switch(kind){
   case 'price':{
    if(!(arg in itemPrice))throw new Error(`Нет работы в каталоге: ${token}`);
    return itemPrice[arg]==null?'стоимость после осмотра':'от '+money(itemPrice[arg]);
   }
   case 'program':case 'program-from':case 'program-includes':{
    const i=Number(arg),program=d.programs[i];
    if(!program)throw new Error(`Нет программы: ${token}`);
    if(kind==='program')return `«${escape(program[0])}»`;
    if(kind==='program-from')return 'от '+money(Math.min(...d.programPrices[i]));
    return `<ul class="article-includes">\n${d.programIncludes[i].map(line=>`  <li>${escape(line)}</li>`).join('\n')}\n</ul>`;
   }
   case 'op':{
    if(!(arg in OPERATOR_HINT))throw new Error(`Нет поля оператора: ${token}`);
    const value=d.site?.operator?.[arg];
    if(!value)return `<span class="doc-todo">[${OPERATOR_HINT[arg]}]</span>`;
    if(arg==='ogrn'){
     // ОГРН юрлица — 13 цифр, ОГРНИП предпринимателя — 15.
     if(!/^(\d{13}|\d{15})$/.test(value))throw new Error(`site.operator.ogrn: нужно 13 (ОГРН) или 15 (ОГРНИП) цифр — ${value}`);
     return `${value.length===15?'ОГРНИП':'ОГРН'} ${value}`;
    }
    if(arg==='email')return `<a href="mailto:${escape(value)}">${escape(value)}</a>`;
    return escape(value);
   }
   case 'site':{
    if(arg==='url')return SITE;
    if(arg==='date')return humanDate(d.site.documentsDate);
    throw new Error(`Неизвестная подстановка ${token}`);
   }
  }
 });
}

const readBody=async name=>substitute(await readFile(new URL(`src/content/${name}`,root),'utf8'));
// Время чтения — по числу слов (≈180 слов в минуту), без разметки.
const readingMinutes=html=>Math.max(1,Math.round(html.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length/180));
const shot=(id,size)=>`assets/shots/${id}${size==='s'?'-s':''}.webp`;
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');

function layout(page,{main,jsonLd,ogType='website',ogImage=SITE+'assets/img/og-club.webp'}){
 const url=SITE+page.file;
 return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#080808">
<!-- SHARED:analytics:START -->
<!-- SHARED:analytics:END -->
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${escape(page.ogTitle||page.title)}">
<meta property="og:description" content="${escape(page.description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:locale" content="ru_RU">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="assets/fonts/arsenal-sc-bold.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="assets/fonts/arsenal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="assets/favicon-bull.png" sizes="512x512" type="image/png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/cinematic.css">
<link rel="stylesheet" href="css/pages.css">
<script type="application/ld+json">${json(jsonLd)}</script>
</head>
<body class="page-inner" data-page="${page.id}">
<a class="skip-link" href="#main">Перейти к содержанию</a>

<!-- SHARED:header:START -->
<!-- SHARED:header:END -->

<main id="main">
${main.trim()}
${page.shared.includes('book')?'\n<!-- SHARED:book:START -->\n<!-- SHARED:book:END -->\n':''}</main>

<!-- SHARED:footer:START -->
<!-- SHARED:footer:END -->

<!-- SHARED:dialogs:START -->
<!-- SHARED:dialogs:END -->
<script type="module" src="js/page.js"></script>
</body>
</html>
`;
}

const crumbs=(...items)=>({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{name:'MEATWASH',item:SITE},...items].map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:x.item}))});
const articleCard=(a,minutes)=>`  <article class="article-card">
    <a class="article-card__link" href="${a.file}">
      <img class="article-card__img" src="${shot(a.image,'s')}" width="900" height="503" alt="" loading="lazy" decoding="async">
      <span class="article-card__body">
        <span class="article-card__meta"><time datetime="${a.date}">${humanDate(a.date)}</time> · ${minutes} мин чтения</span>
        <span class="article-card__title">${escape(a.headline)}</span>
        <span class="article-card__lead">${escape(a.lead)}</span>
        <span class="article-card__more">Читать <span aria-hidden="true">→</span></span>
      </span>
    </a>
  </article>`;

// Тело страницы: после цен и реквизитов — подстановки общих частей ({{home}}, {{loc}}).
export async function renderContent(page){
 return renderPartial(await renderSkeleton(page),page.file);
}
async function renderSkeleton(page){
 if(page.kind==='list'){
  const cards=[];
  for(const a of ARTICLES)cards.push(articleCard(a,readingMinutes(await readBody(a.body))));
  return layout(page,{
   jsonLd:[crumbs({name:'Статьи',item:SITE+page.file}),{'@context':'https://schema.org','@type':'CollectionPage',name:'Статьи MEATWASH',url:SITE+page.file,hasPart:ARTICLES.map(a=>({'@type':'Article',headline:a.headline,url:SITE+a.file,datePublished:a.date}))}],
   main:`<section class="page-head articles-head" aria-labelledby="page-title">
  <p class="eyebrow" lang="en">MEATWASH / JOURNAL</p>
  <h1 id="page-title">Статьи</h1>
  <p class="page-head__lead">Об уходе за автомобилем: что делать, когда и зачем. Цены в статьях — из каталога студий.</p>
</section>
<section class="articles" aria-label="Список статей">
${cards.join('\n')}
</section>`,
  });
 }
 if(page.kind==='article'){
  const body=await readBody(page.body),minutes=readingMinutes(body);
  const image=SITE+shot(page.image);
  return layout(page,{
   ogType:'article',ogImage:image,
   jsonLd:[crumbs({name:'Статьи',item:SITE+'articles.html'},{name:page.headline,item:SITE+page.file}),{'@context':'https://schema.org','@type':'Article',headline:page.headline,description:page.description,image,datePublished:page.date,dateModified:page.date,inLanguage:'ru',mainEntityOfPage:SITE+page.file,author:{'@type':'Organization',name:'MEATWASH Car Care Club',url:SITE},publisher:{'@type':'Organization',name:'MEATWASH Car Care Club',url:SITE,logo:{'@type':'ImageObject',url:SITE+'assets/favicon-bull.png'}}}],
   main:`<article class="article" aria-labelledby="page-title">
  <header class="article__head">
    <nav class="article__crumbs" aria-label="Навигационная цепочка"><a href="articles.html">Статьи</a> <span aria-hidden="true">/</span></nav>
    <h1 id="page-title">${escape(page.headline)}</h1>
    <p class="article__lead">${escape(page.lead)}</p>
    <p class="article__meta"><time datetime="${page.date}">${humanDate(page.date)}</time> · ${minutes} мин чтения</p>
  </header>
  <figure class="article__hero">
    <img src="${shot(page.image)}" srcset="${shot(page.image,'s')} 900w, ${shot(page.image)} 1600w" sizes="(max-width: 1100px) 100vw, 1040px" width="1600" height="894" alt="${escape(page.imageAlt)}" fetchpriority="high" decoding="async">
  </figure>
  <div class="article__body">
${body.trim()}
  </div>
</article>`,
  });
 }
 const body=await readBody(page.body);
 return layout(page,{
  jsonLd:crumbs({name:page.headline,item:SITE+page.file}),
  main:`<article class="doc" aria-labelledby="page-title">
  <h1 id="page-title">${escape(page.headline)}</h1>
${body.trim()}
</article>`,
 });
}

// Подтверждение прав в Яндекс Вебмастере способом «HTML-файл»: тот же код, что в мета-теге
// yandex-verification (site.analytics.webmaster), файл — в корне сайта, текст — как выдаёт Вебмастер.
export function renderYandexVerification(){
 const code=d.site?.analytics?.webmaster;
 if(!code)return null;
 return {file:`yandex_${code}.html`,text:`<html>
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    </head>
    <body>Verification: ${code}</body>
</html>
`};
}

export function renderSitemap(){
 const today=d.site.documentsDate;
 const entries=[...SITEMAP,...CONTENT.map(p=>({file:p.file,lastmod:p.date||today,...p.sitemap}))];
 return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e=>`  <url>
    <loc>${SITE}${e.file==='index.html'?'':e.file}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 for(const page of CONTENT){
  await writeFile(new URL(`dist/${page.file}`,root),await renderPage(page.file,await renderContent(page)));
  console.log(page.file);
 }
 await writeFile(new URL('dist/sitemap.xml',root),renderSitemap());
 console.log('sitemap.xml');
 const verification=renderYandexVerification();
 for(const name of await readdir(new URL('dist/',root)))if(/^yandex_\w+\.html$/.test(name)&&name!==verification?.file)await rm(new URL(`dist/${name}`,root));
 if(verification){await writeFile(new URL(`dist/${verification.file}`,root),verification.text);console.log(verification.file);}
 const missing=missingOperator();
 if(missing.length)console.warn(`ВНИМАНИЕ: в Политике и Согласии не заполнены реквизиты оператора (site.operator в meatwash-content.json): ${missing.join(', ')}.`);
}
