// Онлайн-запись в окне: форма yclients открывается прямо на сайте.
//
// Форма отдаётся без X-Frame-Options и без frame-ancestors — проверено на обоих
// филиалах, весь путь (состав заказа → дата и время) внутри рамки проходит.
// Но окно — это улучшение, а не обязанность: если рамка не поднялась за 12 с
// или запрос к форме не дошёл, показываем ссылку «открыть отдельной страницей»,
// а сама ссылка филиала остаётся рабочей и без этого модуля.

let dialog, box, status, fail, frame = null, timer = 0, probe = null;

function el(root) {
  dialog = root.querySelector('#book-frame');
  if (!dialog) return false;
  box = dialog.querySelector('[data-bookframe-box]');
  status = dialog.querySelector('[data-bookframe-status]');
  fail = dialog.querySelector('[data-bookframe-fail]');
  return true;
}

function setState(state) {
  box.dataset.state = state;
  fail.hidden = state !== 'error';
  status.textContent = state === 'loading' ? 'Открываем запись…' : '';
}

function stop() {
  clearTimeout(timer);
  probe?.abort();
  probe = null;
}

export function setup(root = document) {
  if (!el(root)) return null;

  dialog.addEventListener('close', () => {
    stop();
    // Рамку убираем: иначе форма продолжает жить и при следующем открытии
    // показывает прошлый заказ.
    frame?.remove();
    frame = null;
    setState('idle');
  });

  return {
    open(url, title) {
      if (!url) return false;
      stop();
      dialog.querySelectorAll('[data-bookframe-out]').forEach((a) => { a.href = url; });
      if (title) dialog.querySelector('#book-frame-title').textContent = title;
      frame?.remove();
      frame = document.createElement('iframe');
      frame.className = 'book-frame__frame';
      frame.title = 'Онлайн-запись MEATWASH';
      frame.loading = 'eager';
      frame.referrerPolicy = 'origin';
      frame.src = url;
      frame.addEventListener('load', () => { stop(); setState('ready'); }, { once: true });
      box.append(frame);
      setState('loading');
      // Если форма не ответила — не держим человека в пустом окне.
      timer = setTimeout(() => setState('error'), 12000);
      probe = new AbortController();
      fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: probe.signal })
        .catch(() => { if (box.dataset.state === 'loading') setState('error'); });
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('#book-frame-title').focus({ preventScroll: true });
      return true;
    },
    close() { dialog.close(); },
  };
}
