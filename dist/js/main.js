// Главная: первый экран — статичная фотография, дальше обычная прокрутка.
// Здесь — шапка после первого экрана, «Гараж услуг» (garage.js: окно открывается
// сразу, 3D грузится только по нажатию), шторки «до/после» и общее всех страниц.
import { setupUI } from './ui.js';
import { setupGarage } from './garage.js';
import { setupProof } from './proof.js';

const header = document.getElementById('header');
const hero = document.getElementById('hero');
const controller = new AbortController();

const cleanupUI = setupUI();
// Шторки «до/после» живут отдельно от гаража.
const cleanupProof = setupProof();
const garage = setupGarage();

// Кнопки входа в гараж: на первом экране и в промоблоке — одно и то же окно.
document.querySelectorAll('[data-garage-open]').forEach((button) => button.setAttribute('aria-haspopup', 'dialog'));
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-garage-open]');
  if (!button) return;
  e.preventDefault();
  garage.open(button);
}, { signal: controller.signal });

// ./#garage (тизер на services.html) открывает гараж сразу. Хеш убираем:
// обновление страницы не открывает окно снова.
if (location.hash === '#garage') {
  history.replaceState(null, '', location.pathname + location.search);
  garage.open(document.querySelector('[data-garage-open]'), 'link');
}

// Шапка: после первого экрана — плотный фон и кнопка записи в шапке
// (на первом экране главная кнопка одна — в hero).
function updateChrome() {
  const past = hero ? hero.getBoundingClientRect().bottom < innerHeight * 0.3 : scrollY > innerHeight * 0.7;
  header.classList.toggle('is-solid', past);
  document.body.classList.toggle('is-past-hero', past);
}
addEventListener('scroll', updateChrome, { passive: true, signal: controller.signal });
addEventListener('resize', updateChrome, { passive: true, signal: controller.signal });
updateChrome();

addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  garage.destroy(); cleanupUI(); cleanupProof(); controller.abort();
}, { once: true });
