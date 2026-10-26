// Неразрывные пробелы при сборке (§2.2 плана, поправка критика 16): короткие предлоги,
// союзы и частицы не висят в конце строки, число не отрывается от единицы и знака ₽,
// перед тире — неразрывный пробел.
//
// Только текстовые узлы. Атрибуты не трогаем никогда: значения data-price-item,
// data-yc-items, data-request-services, data-book-context — ключи для yclients.json
// и окна записи, неразрывный пробел в них молча ломает корзину. Не трогаем и
// содержимое <script>, <style>, <svg>, <title>, <textarea>, <pre>, <code>, <option>,
// комментарии, а также любой элемент с атрибутом data-no-typo (и всё внутри него).
//
// Результат: все неразрывные пробелы в тексте — сущностью &nbsp; (видно в разметке).
// Функция идемпотентна: повторный прогон ничего не меняет.
// Владелец: WP0, после сдачи — WP7.

const SKIP = new Set(['script', 'style', 'svg', 'title', 'textarea', 'pre', 'code', 'option']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

// Слова, после которых пробел неразрывный: все из 1–2 букв и частые трёхбуквенные
// предлоги и союзы. Регистр не важен.
const SHORT = '[а-яёa-z]{1,2}|для|без|под|над|при|про|обо|изо|или|как|что|чем|где|его|её|все|это';
const NB = ' ';

function fixText(text) {
  if (!/[^\s]/.test(text)) return text;
  let t = text.replace(/&nbsp;|&#160;|&#xa0;/gi, NB);
  // Короткое слово + пробел → неразрывный (начало узла, после пробела, скобки, кавычки или тире).
  const short = new RegExp(`(^|[\\s${NB}(«„"—–-])(?!(?:же|ли|бы) )(${SHORT}) (?=[^\\s]|$)`, 'giu');
  // Два прохода: «и в Москве» — второе слово становится видно после первой замены.
  t = t.replace(short, `$1$2${NB}`).replace(short, `$1$2${NB}`);
  // Частицы же, ли, бы — к предыдущему слову.
  t = t.replace(/ (же|ли|бы)(?=[\s.,;:!?»)]|$)/giu, `${NB}$1`);
  // Перед тире.
  t = t.replace(/ (—|–)(?= )/g, `${NB}$1`);
  // Число и следующее слово, единица или ₽; разряды «2 150»; № 5.
  t = t.replace(/(\d) (?=[\dа-яёa-z₽%°×])/giu, `$1${NB}`);
  t = t.replace(/№ (?=\d)/g, `№${NB}`);
  return t.replace(/ /g, '&nbsp;');
}

// Разбор на теги и текст. Внутри тега кавычки атрибутов учитываются: «>» в значении
// атрибута тег не заканчивает.
export function typo(html) {
  let out = '';
  let i = 0;
  let skipTag = null, skipDepth = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const text = lt < 0 ? html.slice(i) : html.slice(i, lt);
    if (text) out += skipTag ? text : fixText(text);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end < 0 ? html.length : end + 3;
      out += html.slice(lt, stop); i = stop; continue;
    }
    // Конец тега с учётом кавычек.
    let j = lt + 1, quote = null;
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    const tag = html.slice(lt, j + 1);
    out += tag; i = j + 1;
    const m = tag.match(/^<(\/?)([a-zA-Z][\w-]*)/);
    if (!m) continue;
    const closing = m[1] === '/', name = m[2].toLowerCase();
    if (skipTag) {
      if (name === skipTag && !VOID.has(name) && !tag.endsWith('/>')) skipDepth += closing ? -1 : 1;
      if (skipDepth === 0) skipTag = null;
      continue;
    }
    if (closing || VOID.has(name) || tag.endsWith('/>')) continue;
    if (SKIP.has(name) || /\sdata-no-typo(?=[\s=>\/])/.test(tag)) { skipTag = name; skipDepth = 1; }
  }
  return out;
}

// title и description сюда не идут: в мета-тегах обычные пробелы.
