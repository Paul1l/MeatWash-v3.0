// Ролики студии (Влад 27.10, видео с Яндекс Диска): фон героя главной и «живые» карточки
// по наведению. Рядом с каждым <video> стоит обычная картинка-постер — она же LCP и то, что
// видно при «меньше движения», экономии трафика и на сенсорных экранах (карточки).
// Сеть до вызова не тратится: preload="none", адрес ролика — в data-src*.
//  data-video="hero"  — играет сам после load; ролик по ширине окна: data-src-m до 699 px,
//                       data-src-hd от 1600 px (или от 2200 физических пикселей), иначе data-src.
//                       Кнопка [data-video-toggle] останавливает и запускает (WCAG 2.2.2);
//                       пока ролик не играет, кнопка скрыта. Вне экрана — пауза.
//  data-video="hover" — с мышью играет, пока указатель над [data-video-host]. На сенсорных
//                       экранах (Роман 28.10: «ролик к каждому блоку» — смотрят с телефона)
//                       играет сам, пока карточка видна на 60 % и больше: в карусели главной это
//                       только слайд по центру. Ушла с экрана — пауза; ролик грузится при первом показе.
// Подключает site.js, когда на странице есть [data-video].
export function setupVideo() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  if (reduce.matches || navigator.connection?.saveData) return;

  const play = (video) => video.play().catch(() => {});   // автозапуск запрещён — остаётся постер
  const mark = (video) => {
    video.addEventListener('playing', () => video.classList.add('is-playing'));
    video.addEventListener('pause', () => video.classList.remove('is-playing'));
  };

  document.querySelectorAll('video[data-video="hero"]').forEach((video) => {
    const { srcM, src, srcHd } = video.dataset;
    const wide = innerWidth >= 1600 || innerWidth * (devicePixelRatio || 1) >= 2200;
    const url = innerWidth < 700 && srcM ? srcM : wide && srcHd ? srcHd : src;
    const toggle = video.parentElement.querySelector('[data-video-toggle]');
    let stopped = false, visible = true;
    video.muted = true;
    mark(video);
    if (toggle) {
      video.addEventListener('playing', () => { toggle.hidden = false; }, { once: true });
      toggle.addEventListener('click', () => {
        stopped = !stopped;
        toggle.setAttribute('aria-pressed', String(stopped));
        toggle.setAttribute('aria-label', stopped ? 'Включить видео' : 'Остановить видео');
        if (stopped) video.pause(); else play(video);
      });
    }
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!video.src) return;
      if (!visible) video.pause(); else if (!stopped) play(video);
    }).observe(video);
    const start = () => { video.src = url; if (visible && !stopped) play(video); };
    if (document.readyState === 'complete') start(); else addEventListener('load', start, { once: true });
  });

  const load = (video) => { if (!video.src) { video.muted = true; video.src = video.dataset.src; } };
  const inView = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      const video = target.__video;
      target.__in = isIntersecting;
      if (fine.matches) return;
      if (isIntersecting && !document.hidden) { load(video); play(video); } else video.pause();
    });
  }, { threshold: 0.6 });

  document.querySelectorAll('video[data-video="hover"]').forEach((video) => {
    const host = video.closest('[data-video-host]') || video.parentElement;
    mark(video);
    host.addEventListener('pointerenter', () => {
      if (!fine.matches) return;
      load(video);
      play(video);
    });
    host.addEventListener('pointerleave', () => { if (fine.matches) video.pause(); });
    host.__video = video;
    inView.observe(host);
  });
  // Вкладка в фоне — все ролики карточек на паузе; вернулись — на сенсорных снова играет видимый.
  document.addEventListener('visibilitychange', () => {
    document.querySelectorAll('video[data-video="hover"]').forEach((video) => {
      const host = video.closest('[data-video-host]') || video.parentElement;
      if (document.hidden) video.pause();
      else if (!fine.matches && host.__in) { load(video); play(video); }
    });
  });
}
