// Шапка и меню-шторка (план §1.3, §1.5, §2.8, §4.1; поправка критика 21).
// Владелец: WP1. Ниже — минимальная заготовка WP0, чтобы каркас был проходим: открыть
// шторку, перейти в раздел и назад, закрыть. WP1 пишет файл заново (переходы, переход
// вглубь на телефоне, inert, возврат фокуса после окна из шторки).
// Контракт: html.is-locked ставит не этот модуль, а ui.js (syncLock на close всех dialog, WP6).
export function setupShell() {
  const drawer = document.getElementById('drawer');
  const opener = document.getElementById('drawer-open');
  if (!drawer || !opener || typeof drawer.showModal !== 'function') return;
  const panels = [...drawer.querySelectorAll('section.drawer__panel[id]')];
  const showPanel = (id) => {
    panels.forEach((panel) => { panel.hidden = panel.id !== id; });
    drawer.querySelectorAll('button[aria-controls^="drawer-p-"]').forEach((b) => b.setAttribute('aria-expanded', String(b.getAttribute('aria-controls') === id)));
  };
  const close = () => { if (drawer.open) drawer.close(); };
  opener.addEventListener('click', () => { showPanel(null); drawer.showModal(); opener.setAttribute('aria-expanded', 'true'); });
  drawer.addEventListener('close', () => { opener.setAttribute('aria-expanded', 'false'); opener.focus({ preventScroll: true }); });
  // Перед действием (ссылка, запись, «Узнать цену», клуб) шторка закрывается сразу, в фазе
  // capture: делегированный обработчик ui.js на document потом откроет своё окно.
  drawer.addEventListener('click', (e) => { if (e.target.closest('a, [data-book], [data-request], [data-membership]')) close(); }, true);
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) return close();
    const toPanel = e.target.closest('button[aria-controls^="drawer-p-"]');
    if (toPanel) return showPanel(toPanel.getAttribute('aria-controls'));
    if (e.target.closest('[data-drawer-back]')) return showPanel(null);
    if (e.target.closest('[data-drawer-close]')) return close();
  });
}
