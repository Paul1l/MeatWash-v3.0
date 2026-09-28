// Выбранный тип кузова — общий для каталога (services.html) и «Гаража услуг» (главная):
// хранится на время визита (sessionStorage), о смене сообщает событие mw:body.
import { BODY_TYPES } from './data.js';

const KEY = 'mw:body';
const valid = (i) => Number.isInteger(i) && i >= 0 && i < BODY_TYPES.length;

export function getBody() {
  try { const i = Number(sessionStorage.getItem(KEY)); return valid(i) ? i : 0; } catch { return 0; }
}
export function setBody(i) {
  if (!valid(i)) return;
  try { sessionStorage.setItem(KEY, String(i)); } catch { /* приватный режим: выбор живёт до перезагрузки */ }
  dispatchEvent(new CustomEvent('mw:body', { detail: i }));
}
export const bodyName = (i) => BODY_TYPES[i] ?? BODY_TYPES[0];
