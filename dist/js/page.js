// Вход внутренних страниц (services.html, about.html): только общее — меню, окна
// записи и карты, каталог (если он есть на странице) и шторки «до/после» (если есть).
// Гаража и 3D здесь нет.
import { setupUI } from './ui.js';
import { setupCatalog } from './catalog.js';

setupUI();
setupCatalog();
if (document.querySelector('[data-ba]')) {
  import('./proof.js').then(({ setupProof }) => setupProof())
    .catch((error) => console.warn('Шторки «до/после» не подключились.', error));
}
