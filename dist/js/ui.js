// Общее для всех страниц: меню, окна записи и заявки, карты студий, переходы по якорям,
// появление блоков. «Следующий раздел» — первый блок страницы ниже текущего места.
// Любого элемента может не быть на странице — всё проверяется перед использованием.
// Здесь же — уведомление о cookie и цели Метрики (analytics.js: только с согласия).
import { setupAnalytics, goal } from './analytics.js';
import { LOCATIONS } from './data.js';
import { getBody } from './body.js';

export function setupUI() {
 const abort=new AbortController(), options={signal:abort.signal};
 const $=s=>document.querySelector(s);
 const root=document.documentElement;
 const menu=$('#mobile-menu'), burger=$('#burger'), booking=$('#booking'), requestDialog=$('#request');
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 // Прокрутка фона выключена, пока открыто меню или окно. Класс на <html>: iOS
 // не считается с overflow у одного body. Место полосы прокрутки держит
 // scrollbar-gutter (style.css), поэтому страница не прыгает вбок.
 const syncLock=()=>{
  const dialogOpen=Boolean(document.querySelector('dialog[open]'));
  document.body.classList.toggle('dialog-open',dialogOpen);
  root.classList.toggle('is-locked',dialogOpen||Boolean(menu&&!menu.hidden));
 };
 // Открытое меню держит фокус: всё, что под ним (страница, подвал, нижняя кнопка,
 // ссылка «к содержанию»), на это время inert — Tab после последнего пункта не уходит
 // под меню, а чтение с экрана не видит закрытое им содержимое.
 const behindMenu=()=>document.querySelectorAll('.skip-link, main, body > footer, .mobile-cta');
 const setMenu=open=>{
   if(!menu||!burger)return;
   menu.hidden=!open; burger.setAttribute('aria-expanded',String(open)); burger.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
   document.body.classList.toggle('menu-open',open);
   behindMenu().forEach(el=>{el.inert=open;});
   syncLock();
 };
 const closeMenu=()=>{ if(!menu||menu.hidden) return; const inside=menu.contains(document.activeElement); setMenu(false); if(inside) burger.focus({preventScroll:true}); };
 // Окно открыто только что: второй клик двойного клика (или двойного тапа)
 // приходится в ту же точку — по фону он закрывал окно, по ссылке филиала
 // сам открывал запись. Такие клики по окну игнорируем.
 let openedAt=0;
 const show=dialog=>{
  if(!dialog||dialog.open) return;
  // Длинное окно открывается с начала, а не с места, где его закрыли в прошлый раз.
  dialog.scrollTop=0;
  dialog.showModal(); openedAt=performance.now(); syncLock();
 };
 const settling=e=>e.detail>1||performance.now()-openedAt<400;
 const closeDialogs=()=>{ booking?.close(); requestDialog?.close(); };
 const context=$('#booking-context'), lead=$('#booking-lead'), hint=$('#booking-hint'), branches=booking?.querySelector('.dialog__branches');
 // Что именно выбрал человек — только текстом, без разметки.
 const setContext=note=>{ if(!context)return; context.textContent=note?'Вы выбрали: '+note:''; context.hidden=!note; };
 // Запись: филиал выбирается здесь, потому что у площадок разные компании в yclients.
 // Ссылки филиалов ведут в YCLIENTS с уже набранными услугами. Карта
 // соответствий подгружается один раз; пока её нет, ссылки остаются такими,
 // как в разметке — обычный выбор услуги, запись всё равно работает.
 const noteEl=$('#booking-yc-note');
 let yc=null, bookingJob=0;
 const loadYc=()=>yc?Promise.resolve(yc):import('./yclients.js').then(m=>m.loadMap().then(()=>(yc=m)));
 // Каждое открытие окна начинает с ссылок из разметки: иначе общая «Записаться»
 // унесла бы в yclients корзину прошлого выбора.
 branches?.querySelectorAll('[data-branch]').forEach(link=>{link.dataset.href=link.getAttribute('href');});
 const resetLinks=()=>branches?.querySelectorAll('[data-branch]').forEach(link=>{if(link.dataset.href)link.setAttribute('href',link.dataset.href);});
 const applyLinks=spec=>{
   if(!yc||!branches)return;
   const body=getBody();
   // rest — сколько работ этого же филиала уже попало в корзину: если ни одной,
   // «Остальное уже в заказе» не пишем (выбрана только работа, которую добавляют на месте).
   let unmatched=[],rest=0;
   branches.querySelectorAll('[data-branch]').forEach(link=>{
     const branch=link.dataset.branch;
     const {ids,missing}=yc.resolve(branch,spec,body);
     const url=yc.bookingUrl(branch,ids);
     if(url)link.href=url;
     if(missing.length>unmatched.length){unmatched=missing;rest=ids.length;}
   });
   if(noteEl){
     noteEl.textContent=unmatched.length
       ? 'На месте добавите: '+unmatched.join(', ')+'. Эти работы мастер примет при приёмке — в онлайн-записи они не продаются.'+(rest?' Остальное уже в заказе.':'')
       : '';
     noteEl.hidden=!unmatched.length;
   }
 };
 // Мойка и другие работы выбраны вместе (гараж): запись — только мойка, а окно
 // напоминает про заявку с фото по остальным; общая подсказка тогда не нужна.
 const requestNote=$('#booking-request'), otherNote=$('#booking-other');
 const setRequestNote=list=>{
   if(!requestNote)return;
   requestNote.hidden=!list.length;
   if(otherNote)otherNote.hidden=Boolean(list.length);
   if(!list.length)return;
   requestNote.querySelector('[data-booking-request-text]').textContent=`По остальным работам — заявка с фото: ${list.join(', ')}.`;
   requestNote.querySelector('[data-booking-request]').dataset.requestServices=list.join('|');
 };
 const openBooking=(note='',spec=null,requestList=[])=>{
   if(!booking)return;
   closeMenu(); requestDialog?.close();
   setRequestNote(requestList);
   $('#booking-title').textContent='Записаться';
   setContext(note); lead.hidden=true; hint.hidden=false; branches.hidden=false;
   if(noteEl){noteEl.textContent='';noteEl.hidden=true;}
   resetLinks();
   // Ответ карты yclients может прийти после следующего открытия окна — тогда он уже не нужен.
   const job=++bookingJob;
   if(spec&&(spec.programs.length||spec.items.length))loadYc().then(()=>{if(job===bookingJob&&booking.open)applyLinks(spec);});
   show(booking);
   goal('booking_open',{context:note||'—'});
   // Фокус на заголовке, а не на Мясницкой: иначе она выглядела выбранной по умолчанию.
   $('#booking-title').focus({preventScroll:true});
 };
 // Разговор с администратором: телефоны без онлайн-записи.
 const openMembership=(title='')=>{
   if(!booking)return;
   bookingJob++;
   closeMenu(); requestDialog?.close();
   if(requestNote)requestNote.hidden=true;
   if(otherNote)otherNote.hidden=true;
   $('#booking-title').textContent=title||'Meatwash Car Care Club';
   setContext(''); lead.hidden=false; hint.hidden=true; branches.hidden=true;
   show(booking);
 };

 // Окно заявки (js/request.js): модуль — по первому нажатию «Оставить заявку».
 let requestLoading=null;
 const loadRequest=()=>{
  if(!requestDialog)return null;
  requestLoading??=import('./request.js').then(module=>module.setupRequest(requestDialog,{show}))
   .catch(error=>{requestLoading=null;console.warn('Окно заявки не подключилось.',error);return null;});
  return requestLoading;
 };
 document.querySelectorAll('[data-request]').forEach(button=>button.setAttribute('aria-haspopup','dialog'));

 // Карты студий в карточках локаций (js/maps.js): модуль и iframe виджета — только
 // когда область карты подходит к экрану (запас 600 px). До этого, без скриптов
 // и при ошибке в области — заглушка со ссылкой на карточку в Яндекс Картах.
 const mapBoxes=document.querySelectorAll('[data-map-embed]');
 let mapsLoading=null;
 const loadMaps=()=>mapsLoading??=import('./maps.js').catch(error=>{mapsLoading=null;console.warn('Карты студий не подключились: остаётся ссылка на Яндекс Карты.',error);return null;});
 const mapWatch=mapBoxes.length&&'IntersectionObserver' in window?new IntersectionObserver(entries=>{
  for(const entry of entries){
   if(!entry.isIntersecting)continue;
   mapWatch.unobserve(entry.target);
   loadMaps().then(module=>module?.showMap(entry.target));
  }
 },{rootMargin:'600px 0px'}):null;
 mapBoxes.forEach(box=>mapWatch?.observe(box));

 burger?.addEventListener('click',()=>{ if(menu.hidden) setMenu(true); else closeMenu(); },options);
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();},options);
 // Бургер есть только до 900px. Меню открыли на планшете и повернули его —
 // шапка стала десктопной, а меню и блокировка прокрутки остались.
 const narrow=matchMedia('(max-width: 900px)');
 narrow.addEventListener('change',()=>{ if(!narrow.matches&&menu&&!menu.hidden) closeMenu(); },options);
 // Меню на весь экран под шапкой: «снаружи» — только шапка (логотип).
 document.addEventListener('pointerdown',e=>{ if(!menu||menu.hidden) return; if(menu.contains(e.target)||burger.contains(e.target)) return; closeMenu(); },options);

 // Прыжок к блоку этой же страницы: раскрыть <details>, закрыть меню и окна,
 // фокус — на цель (без второй прокрутки).
 const jump=(target,hash)=>{
  if(target.tagName==='DETAILS')target.open=true;
  target.scrollIntoView({behavior:reduced()?'instant':'smooth'});
  if(!target.matches('a[href],button,input,select,textarea,summary,[tabindex]'))target.setAttribute('tabindex','-1');
  target.focus({preventScroll:true});
  if(hash)history.replaceState(null,'',hash);
 };
 // «Следующий раздел»: первый блок, который начинается ниже текущего места.
 const nextBlock=()=>{
  const pad=parseFloat(getComputedStyle(root).scrollPaddingTop)||0;
  const next=[...document.querySelectorAll('main > section, main > header, main > div, body > footer')].find(el=>el.offsetHeight&&el.getBoundingClientRect().top-pad>8);
  if(next)next.scrollIntoView({behavior:reduced()?'instant':'smooth'});
 };

 document.addEventListener('click',e=>{
  const control=e.target.closest('a,button'); if(!control)return;
  // Цели Метрики: звонок и переход в онлайн-запись филиала (yclients) — ссылки уходят сами.
  // Ссылка филиала бывает с уже набранными услугами (yclients.js), поэтому сверяем
  // по компании в yclients, а не по ссылке целиком.
  const href=control.getAttribute('href')||'';
  if(href.startsWith('tel:'))goal('phone_click',{tel:href.slice(4)});
  else if(control.hasAttribute('data-club-card'))goal('club_card');
  else{const branch=LOCATIONS.find(l=>href&&l.booking&&href.startsWith(l.booking.replace(/\/personal\/.*$/,'/')));if(branch)goal('booking_branch',{branch:branch.id,preset:/[?&]o=m-1s/.test(href)});}
  if(control.hasAttribute('data-book')){
   const d=control.dataset;
   const programs=[d.program,...(d.ycPrograms||'').split(',')].filter(v=>v!=='' &&v!=null).map(Number).filter(Number.isInteger);
   const items=(d.ycItems||'').split('|').filter(Boolean);
   return openBooking(d.bookContext||'',{programs,items},(d.requestServices||'').split('|').filter(Boolean));
  }
  // Заявка с фото — всё, кроме мойки: модуль окна грузится по первому нажатию.
  if(control.hasAttribute('data-request')){
   const d=control.dataset;
   closeMenu(); booking?.close();
   loadRequest()?.then(open=>open?.({services:(d.requestServices||'').split('|').filter(Boolean),category:d.requestCategory||'',washContext:d.washContext||'',washPrograms:d.washPrograms||''}));
   return;
  }
  if(control.hasAttribute('data-membership')) return openMembership(control.dataset.membership);
  // «На карте» в подвале — переход к карте студии: якорь на этой странице или на главной.
  // Уходя на главную, запрос Метрики со старой страницы может не успеть — тогда цель
  // отправит главная по прибытии (отметка в sessionStorage, см. ниже setupAnalytics).
  if(control.dataset.mapLink){
   const branch=control.dataset.mapLink;
   if(href.startsWith('#'))goal('map_open',{branch,source:'footer'});else try{sessionStorage.setItem('mw:map-goal',branch);}catch{}
  }
  if(control.hasAttribute('data-scroll-next')){ nextBlock(); return; }
  const hash=control.getAttribute('href');
  if(hash?.startsWith('#')&&hash.length>1){const target=document.getElementById(hash.slice(1));if(target){e.preventDefault();closeMenu();closeDialogs();jump(target,hash);}}
 },options);

 const outside=(dialog,e)=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
 for(const dialog of document.querySelectorAll('dialog.dialog')){
  // Закрываем по фону, только если и нажатие, и отпускание были вне окна:
  // выделение текста, отпущенное за краем окна, его больше не закрывает.
  let downOutside=false;
  dialog.addEventListener('pointerdown',e=>{downOutside=e.target===dialog&&outside(dialog,e);},options);
  dialog.addEventListener('click',e=>{
   if(settling(e)){ if(e.target.closest('a[href]')) e.preventDefault(); return; }
   if(e.target===dialog&&downOutside&&outside(dialog,e)) dialog.close();
  },options);
  dialog.addEventListener('close',syncLock,options);
 }

 // Прямой заход по адресу с якорем (services.html#price-polish, #programs внутри
 // «Мойки»): раскрыть <details> цели и все, в которые она вложена, и встать к ней
 // под шапкой. Браузер сам прокрутил к закрытому блоку до раскрытия; повторяем
 // после шрифтов — они меняют высоту строк.
 const hashTarget=()=>{try{return location.hash.length>1?document.getElementById(decodeURIComponent(location.hash.slice(1))):null;}catch{return null;}};
 const reveal=target=>{let opened=false;for(let box=target.tagName==='DETAILS'?target:target.parentElement?.closest('details');box;box=box.parentElement?.closest('details'))if(!box.open){box.open=true;opened=true;}return opened;};
 const arrival=hashTarget();
 if(arrival&&(arrival.tagName==='DETAILS'||arrival.closest('details'))){
  reveal(arrival);
  // Второе выравнивание — только если человек ещё не прокрутил страницу сам.
  let placed=-1;
  const settle=()=>{if(placed>=0&&Math.abs(scrollY-placed)>2)return;arrival.scrollIntoView({behavior:'instant'});placed=scrollY;};
  requestAnimationFrame(settle);
  document.fonts?.ready.then(()=>requestAnimationFrame(settle));
 }
 // Хеш сменили на открытой странице (адресная строка, «назад»): тоже раскрыть группу.
 addEventListener('hashchange',()=>{
  const target=hashTarget();
  if(!target||!(target.tagName==='DETAILS'||target.closest('details')))return;
  reveal(target);
  requestAnimationFrame(()=>target.scrollIntoView({behavior:'instant'}));
 },options);
 // Ссылка на тот же якорь второй раз hashchange не даёт: раскрываем по клику.
 document.addEventListener('click',e=>{
  const link=e.target.closest('a[href^="#"]');if(!link||link.getAttribute('href').length<2)return;
  let target=null;try{target=document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));}catch{}
  if(target&&reveal(target)&&location.hash===link.getAttribute('href')){e.preventDefault();target.scrollIntoView({behavior:'instant'});}
 },options);

 const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('is-in');observer.unobserve(entry.target);}},{threshold:.1});
 document.querySelectorAll('[data-reveal]').forEach(el=>observer.observe(el));
 setupAnalytics();
 // Пришли по «На карте» из подвала другой страницы: цель map_open — здесь, рядом с картой.
 try{const branch=sessionStorage.getItem('mw:map-goal');if(branch){sessionStorage.removeItem('mw:map-goal');if(location.hash==='#map-'+branch)goal('map_open',{branch,source:'footer'});}}catch{}
 return ()=>{abort.abort();observer.disconnect();mapWatch?.disconnect();};
}
