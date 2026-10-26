// Разметка страниц для чтения: список статей, статья, документ (план §3.8–3.9).
// Вынесено из content.mjs, чтобы вид (WP2) и каркас (WP0/WP7) не правили один файл
// (поправка критика 29). <head>, JSON-LD и общие части — scripts/content.mjs.
// Владелец: WP0 (заготовка) → WP2. Классы — контракт §2.8: hero-d, back-link, photo-card,
// col-narrow; стили — dist/css/reading.css (WP2).
import {escape} from './catalog.mjs';
import {pageUrl, humanDate, icon} from './pages.mjs';

export const shot = (id, size) => `assets/shots/${id}${size === 's' ? '-s' : ''}.webp`;
// Время чтения — по числу слов (≈180 слов в минуту), без разметки.
export const readingMinutes = (html) => Math.max(1, Math.round(html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length / 180));
// Содержание статьи: h2 с id, кроме data-toc="no".
export const toc = (html) => [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/g)]
  .map(([, attrs, inner]) => ({id: attrs.match(/\bid="([^"]+)"/)?.[1], skip: /\bdata-toc="no"/.test(attrs), text: inner.replace(/<[^>]+>/g, '').trim()}))
  .filter((h) => h.id && !h.skip);

const articleCard = (a, minutes, size) => `  <a class="photo-card photo-card--${size} article-card" href="${pageUrl(a.file)}">
    <img src="${shot(a.image)}" srcset="${shot(a.image, 's')} 900w, ${shot(a.image)} 1600w" sizes="(max-width: 759px) 100vw, 60vw" width="1600" height="894" alt="" loading="lazy" decoding="async">
    <span class="photo-card__body">
      <span class="article-card__meta"><time datetime="${a.date}">${humanDate(a.date)}</time> · ${minutes} мин чтения</span>
      <span class="photo-card__title">${escape(a.headline)}</span>
      <span class="article-card__lead">${escape(a.lead)}</span>
    </span>
  </a>`;

// Список: hero-d, первая статья крупно (photo-card--l), дальше сетка в 3 колонки.
export function renderList(page, articles) {
  const [first, ...rest] = articles;
  return `<section class="hero-d col-wide" aria-labelledby="page-title">
  <h1 id="page-title">${escape(page.headline)}</h1>
  <p class="hero-d__lead">Об уходе за автомобилем: что делать, когда и зачем. Цены в статьях — из каталога студий.</p>
</section>
<section class="section articles col-ext" aria-label="Список статей">
${first ? articleCard(first.article, first.minutes, 'l') : ''}
${rest.length ? `  <div class="articles__grid">\n${rest.map((a) => articleCard(a.article, a.minutes, 's')).join('\n')}\n  </div>` : ''}
</section>`;
}

// Статья (P28): «← Статьи», H1, лид, дата и минуты, фото; тело в колонке --narrow;
// справа от 1100 px липкий столбец: «Содержание» и «Записаться».
export function renderArticle(page, body, minutes) {
  const items = toc(body);
  return `<article class="article" aria-labelledby="page-title">
  <header class="article__head col-narrow">
    <a class="back-link" href="${pageUrl('articles.html')}">${icon('chevron-left')}Статьи</a>
    <h1 id="page-title">${escape(page.headline)}</h1>
    <p class="article__lead">${escape(page.lead)}</p>
    <p class="article__meta"><time datetime="${page.date}">${humanDate(page.date)}</time> · ${minutes} мин чтения</p>
  </header>
  <figure class="article__hero col-wide">
    <img src="${shot(page.image)}" srcset="${shot(page.image, 's')} 900w, ${shot(page.image)} 1600w" sizes="(max-width: 1100px) 100vw, 1040px" width="1600" height="894" alt="${escape(page.imageAlt)}" fetchpriority="high" decoding="async">
  </figure>
  <div class="article__layout">
    <div class="article__body col-narrow">
${body.trim()}
    </div>
    <aside class="article__aside" aria-label="Содержание статьи">
      <nav class="article__toc" aria-labelledby="toc-title">
        <p class="article__toc-title" id="toc-title">Содержание</p>
        <ol>${items.map((h) => `<li><a href="#${escape(h.id)}">${escape(h.text)}</a></li>`).join('')}</ol>
      </nav>
      <button class="btn btn--primary btn--block" type="button" data-book>Записаться</button>
    </aside>
  </div>
</article>`;
}

// Документ (P30): H1 по колонке --basic, текст по --narrow.
export function renderDoc(page, body) {
  return `<article class="doc" aria-labelledby="page-title">
  <header class="doc__head col-basic">
    <h1 id="page-title">${escape(page.headline)}</h1>
  </header>
  <div class="doc__body col-narrow">
${body.trim()}
  </div>
</article>`;
}
