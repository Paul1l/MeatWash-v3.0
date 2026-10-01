// Страницы, которые собирает scripts/content.mjs: раздел «Статьи», статьи,
// Политика обработки персональных данных и Согласие (152-ФЗ). Тела страниц —
// HTML-файлы рядом; общие части (шапка, подвал, окна, запись, аналитика)
// вставляет scripts/pages.mjs по списку shared.
//
// В телах работают подстановки (scripts/content.mjs):
//   {{price:<название работы из каталога>}}  → «от 1 000 ₽»
//   {{program:<i>}} / {{program-from:<i>}} / {{program-includes:<i>}}
//   {{op:<name|inn|ogrn|address|email>}}      → реквизиты оператора (site.operator в JSON)
//   {{site:url}}, {{site:date}}               → адрес сайта, дата редакции документов
// и подстановки общих частей: {{loc:<id>:<поле>}}, {{home}}.

export const ARTICLES = [
  {
    file: 'article-avto-k-zime.html',
    body: 'articles/avto-k-zime.html',
    title: 'Автомобиль к зиме: что сделать до реагентов — MEATWASH',
    description: 'Как подготовить автомобиль к зиме в Москве: защита кузова, сколы, стёкла, уплотнители и салон, уход в сезон реагентов. Цены — из каталога MEATWASH.',
    headline: 'Автомобиль к зиме: что сделать до первых реагентов',
    lead: 'Реагенты, соль и мокрая грязь каждый день работают против лака, порогов, стёкол и уплотнителей. Что стоит сделать заранее и как ухаживать за машиной в сезон — по порядку и без лишних процедур.',
    date: '2026-10-01',
    image: 'cf-sill-low',
    imageAlt: 'Порог и колесо Porsche в зимней грязи: с кузова стекает вода с реагентами',
  },
];

export const CONTENT = [
  {
    file: 'articles.html', id: 'articles', kind: 'list',
    title: 'Статьи об уходе за автомобилем — MEATWASH Car Care Club',
    description: 'Статьи MEATWASH об уходе за автомобилем: мойка, защита кузова, стёкла и салон. Практичные советы и цены из каталога студий на Мясницкой и в Технопарке.',
    ogTitle: 'Статьи — MEATWASH Car Care Club',
    shared: ['analytics', 'header', 'book', 'footer', 'dialogs'],
    sitemap: { changefreq: 'weekly', priority: '0.6' },
  },
  ...ARTICLES.map((a) => ({
    ...a, id: 'articles', kind: 'article', ogTitle: a.headline,
    shared: ['analytics', 'header', 'book', 'footer', 'dialogs'],
    sitemap: { changefreq: 'monthly', priority: '0.6' },
  })),
  {
    file: 'privacy.html', id: 'privacy', kind: 'doc', body: 'privacy.html',
    title: 'Политика обработки персональных данных — MEATWASH',
    description: 'Политика обработки персональных данных посетителей сайта MEATWASH Car Care Club: какие данные, цели, cookie и Яндекс Метрика, права и отзыв согласия.',
    headline: 'Политика обработки персональных данных',
    shared: ['analytics', 'header', 'footer', 'dialogs'],
    sitemap: { changefreq: 'yearly', priority: '0.2' },
  },
  {
    file: 'consent.html', id: 'consent', kind: 'doc', body: 'consent.html',
    title: 'Согласие на обработку персональных данных — MEATWASH',
    description: 'Согласие посетителя сайта MEATWASH на обработку персональных данных с помощью cookie и сервиса Яндекс Метрика: данные, цель, срок и отзыв.',
    headline: 'Согласие на обработку персональных данных',
    shared: ['analytics', 'header', 'footer', 'dialogs'],
    sitemap: { changefreq: 'yearly', priority: '0.2' },
  },
];

// Карта сайта: страницы ручной вёрстки и собранные здесь.
export const SITEMAP = [
  { file: 'index.html', lastmod: '2026-10-01', changefreq: 'monthly', priority: '1.0' },
  { file: 'services.html', lastmod: '2026-10-01', changefreq: 'monthly', priority: '0.9' },
  { file: 'about.html', lastmod: '2026-10-01', changefreq: 'monthly', priority: '0.7' },
];
