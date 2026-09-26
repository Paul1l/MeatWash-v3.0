# porsche3d — 3D-режим «Оживить Porsche»

Исходник модуля. На сайт попадает только бандл `dist/js/porsche3d.bundle.js`
(`npm run bundle-3d`): three r180, GLTFLoader и декодер Meshopt внутри, importmap не нужен.
Страница грузит его **только** `import('./porsche3d.bundle.js')` по нажатию кнопки —
`npm run check` падает на статическом импорте, `<script>`, preload/prefetch или ссылке на `.glb`.

- `index.js` — `mount()`: загрузка модели с прогрессом и отменой, материалы, камера, отрисовка по требованию, `dispose()`.
- `views.js` — ракурсы, показ, соответствие работ «Гаража услуг» ракурсам.
- `room.js` — помещение, свет и окружение для отражений (всё рисуется на canvas, без загрузок).

Модели — `dist/assets/3d/porsche-930-{desktop,mobile}.glb`, собираются `npm run optimize-3d`
из `source/3d/porsche-930.glb` (исходник v1, в `dist` не публикуется). Отчёт с размерами
и sha256 — `source/3d/optimize-report.json`. `npm run check:3d` сверяет бандл и модели.

## API

```js
const {mount} = await import('./porsche3d.bundle.js');
const scene = await mount({
  container,            // элемент с position: relative/absolute; canvas добавится последним ребёнком
  signal,               // AbortSignal: отмена загрузки → промис отклоняется с AbortError
  quality: 'auto',      // 'high' | 'low' | 'auto' (телефон, сенсор без мыши, ≤4 ГБ, Save-Data → low)
  reducedMotion,        // по умолчанию из prefers-reduced-motion
  model,                // необязательно: свой URL или Promise<Response> (можно начать fetch заранее)
  onProgress({loaded, total, ratio}),  // ratio = null, если размер неизвестен или ответ сжат
  onFirstFrame(),       // первый кадр нарисован, canvas начинает проявляться
  onError(error),       // после запуска: потеря контекста WebGL (сцена уже закрыта)
  onViewChange(name),   // 'hero' | 'overview' | 'body' | 'wheel' | … | 'tour'
  onTourEnd(),
});
scene.tour();                 // показ 7,5 с; false при reduced motion (сразу общий вид)
scene.stopTour();
scene.view('overview' | 'body' | 'wheel' | 'hood' | 'reflection' | 'headlight' | 'sill' | 'windscreen' | 'hero');
scene.showService(zoneId);    // id из config.js ZONES; false — ракурса нет (салон), показывайте фото
scene.setReducedMotion(bool);
scene.stats();                // кадры, вызовы отрисовки, треугольники, память, timings этапов
scene.dispose();              // освобождает всё и удаляет canvas; повторный вызов безопасен
```

Ошибки `mount()` — `Porsche3DError` с `code`: `webgl` (нет WebGL 2), `load` (сеть, HTTP),
`compile` (шейдеры); отмена — `DOMException` `AbortError`. Во всех случаях canvas уже удалён,
страница показывает обычный фон. Повторный `mount()` закрывает предыдущую сцену.

## Поведение

- Canvas с `pointer-events: none`: колесо, касания и прокрутка страницы идут мимо сцены.
  Камера двигается только программно; параллакс — за мышью по `window` (только мышь,
  не при reduced motion).
- Кадр рисуется только при изменении; неподвижная камера — ноль кадров. Вне экрана
  (IntersectionObserver) и на скрытой вкладке цикл стоит, показ ставится на паузу.
- Начальный ракурс `hero` совпадает с кадром `cf-hero-dirty.webp` при `background-size: cover`
  на любом соотношении сторон: canvas можно проявлять поверх фото без скачка.
