// Ручной порядок точек маршрута.
//
// Зачем. Порядок объезда считается сам — от первой точки к ближайшей, — но
// ближайшая не всегда та, куда хотят ехать следующей. Проверяем, что точку
// можно перетащить за ручку ⋮⋮ (мышью — настоящими событиями указателя)
// и стрелками с клавиатуры, что новый порядок переживает перезагрузку,
// уходит в ссылку (o=1) и не пересортировывается сервером, что кнопка
// «Упорядочить автоматически» возвращает расчёт, а новая точка в ручном
// режиме встаёт в конец. И то же на главной, в блоке «Маршрут на день».
//
// Сервер должен быть запущен.
//   node проверки/порядок-маршрута.mjs
//   node проверки/порядок-маршрута.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9601, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-order-' + process.pid,
  'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// Перетащить строку за ручку настоящими событиями мыши: браузер сам
// превращает их в pointerdown/pointermove/pointerup.
async function тащить(строки, откуда, куда) {
  // прокрутка на странице плавная — ждём, пока доедет, иначе координаты устареют
  await js(`document.querySelectorAll(${JSON.stringify(строки)})[${откуда}].scrollIntoView({block:'center'}); 1`);
  await sleep(1200);
  const к = JSON.parse(await js(`(function(){
    var r = document.querySelectorAll(${JSON.stringify(строки)});
    var h = r[${откуда}].querySelector('.drag').getBoundingClientRect();
    var t = r[${куда}].getBoundingClientRect();
    var вверх = ${куда} < ${откуда};
    return JSON.stringify({ x: h.left + h.width / 2, y: h.top + h.height / 2,
                            y2: вверх ? t.top + 3 : t.bottom - 3 });
  })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: к.x, y: к.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: к.x, y: к.y, button: 'left', buttons: 1, clickCount: 1 });
  const шагов = 8;
  let заместитель = false, едет = false;
  for (let i = 1; i <= шагов; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: к.x, y: к.y + (к.y2 - к.y) * i / шагов, button: 'left', buttons: 1 });
    await sleep(30);
    if (i === 4) {
      заместитель = await js(`!!document.querySelector('.drag-ph')`);
      едет = await js(`!!document.querySelector('.dragging') && document.querySelector('.dragging').style.position === 'fixed'`);
    }
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: к.x, y: к.y2, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
  return { заместитель, едет };
}

const имена = sel => js(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(function(e){ return e.textContent.trim(); }))`).then(JSON.parse);
const иды = () => js(`JSON.stringify([...document.querySelectorAll("#rlist .it .x")].map(function(e){ return e.getAttribute("data-id"); }))`).then(JSON.parse);
const ждать = async (усл, раз = 40) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };

// ── /marshrut: перетаскивание мышью ──────────────────────────────────────
await send('Page.navigate', { url: SITE + '/marshrut' });
await sleep(1200);
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=5069,286,910026' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 3`);
const было = await иды();
check('на странице три точки', было.length === 3, было.join(' | '));
check('у каждой строки есть ручка', (await js(`document.querySelectorAll('#rlist .it button.drag[type=button][aria-label="Перетащить"]').length`)) === 3);
check('ручка не даёт прокручивать страницу пальцем', (await js(`getComputedStyle(document.querySelector('#rlist .drag')).touchAction`)) === 'none');
check('в автоматическом режиме кнопки «Упорядочить автоматически» не видно', await js(`document.getElementById('rAuto').offsetParent === null`));

const ход = await тащить('#rlist .it', 2, 0);
check('пока тянем — на месте строки пустая полоска', ход.заместитель);
check('пока тянем — строка едет за указателем', ход.едет);
const стало = await иды();
const ждём = [было[2], было[0], было[1]];
check('третья точка встала первой', JSON.stringify(стало) === JSON.stringify(ждём), стало.join(' | '));
check('заместитель убран', (await js(`document.querySelectorAll('.drag-ph, .dragging').length`)) === 0);
check('номера в списке 1..3', JSON.stringify(await имена('#rlist .it .n')) === '["1","2","3"]');
await sleep(300);
const метки = await js(`JSON.stringify(Т.map(function(p){ return String(p.id); }))`).then(JSON.parse);
const пины = await js(`(function(){ var out = []; карта.eachLayer(function(l){ if(l.getLatLng && l.options && l.options.icon && l.options.icon.options.html && l.getTooltip && l.getTooltip()) out.push([l.options.icon.options.html.replace(/<[^>]+>/g, ''), l.getLatLng().lat]); }); return JSON.stringify(out); })()`).then(JSON.parse);
const широты = await js(`JSON.stringify(Т.map(function(p){ return p.lat; }))`).then(JSON.parse);
const пиныПоНомеру = пины.slice().sort((a, b) => +a[0] - +b[0]).map(p => p[1]);
check('метки на карте пронумерованы в новом порядке', пины.length === 3 && JSON.stringify(пиныПоНомеру) === JSON.stringify(широты), JSON.stringify(пины));
check('Т в новом порядке', JSON.stringify(метки) === JSON.stringify(ждём), метки.join(' | '));
const адрес = await js(`location.search`);
check('в адресе o=1', /[?&]o=1\b/.test(адрес), адрес);
check('в адресе точки в новом порядке', decodeURIComponent(адрес).replace(/~[^,&]*/g, '').startsWith('?p=' + ждём.join(',')), адрес);
check('routeOrder = manual', (await js(`localStorage.getItem('routeOrder')`)) === 'manual');
check('маршрут сохранён в новом порядке', JSON.stringify(await js(`JSON.stringify(JSON.parse(localStorage.getItem('route')).map(function(p){ return String(p.id); }))`).then(JSON.parse)) === JSON.stringify(ждём));
check('кнопка «Упорядочить автоматически» видна', await js(`document.getElementById('rAuto').offsetParent !== null && /Упорядочить автоматически/.test(document.getElementById('rAuto').textContent)`));

// перегоны по дорогам пересчитаны под новый порядок
await ждать(`!!ДОРОГА && ДОРОГА.к === ключДороги()`, 60);
check('перегоны по дорогам посчитаны для нового порядка', await js(`!!ДОРОГА && ДОРОГА.к === ключДороги() && /по дорогам/.test(document.getElementById('rsub').textContent)`), await js(`document.getElementById('rsub').textContent`));

// ── перезагрузка ─────────────────────────────────────────────────────────
await send('Page.reload');
await sleep(800);
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 3`);
check('после перезагрузки порядок сохранён', JSON.stringify(await иды()) === JSON.stringify(ждём), (await иды()).join(' | '));

// ── «Упорядочить автоматически» ──────────────────────────────────────────
await js(`window.__доАвто = Т.slice(); document.getElementById('rAuto').click(); 1`);
await sleep(300);
check('после «Упорядочить автоматически» кнопка исчезла', await js(`document.getElementById('rAuto').offsetParent === null`));
check('routeOrder = auto', (await js(`localStorage.getItem('routeOrder')`)) === 'auto');
const поПорядку = await js(`(function(){ var был = Т; Т = window.__доАвто.slice(); порядок(); var r = Т.map(function(p){ return String(p.id); }); Т = был; return JSON.stringify(r); })()`).then(JSON.parse);
check('порядок как у порядок()', JSON.stringify(await иды()) === JSON.stringify(поПорядку), (await иды()).join(' | '));
check('в адресе нет o=1', !/[?&]o=1/.test(await js(`location.search`)), await js(`location.search`));

// ── стрелка вниз на ручке первой строки ──────────────────────────────────
const доСтрелки = await иды();
await js(`document.querySelector('#rlist .it .drag').focus(); 1`);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
await sleep(300);
const послеСтрелки = await иды();
check('стрелка вниз меняет первые две точки местами', JSON.stringify(послеСтрелки) === JSON.stringify([доСтрелки[1], доСтрелки[0], доСтрелки[2]]), послеСтрелки.join(' | '));
check('после стрелки — ручной режим', (await js(`localStorage.getItem('routeOrder')`)) === 'manual' && /[?&]o=1/.test(await js(`location.search`)));
check('фокус остался на ручке переставленной точки', await js(`document.activeElement === document.querySelectorAll('#rlist .it .drag')[1]`));

// ── новая точка в ручном режиме — в конец ────────────────────────────────
const лида = (await (await fetch(SITE + '/api/places?q=' + encodeURIComponent('Лидский замок'))).json()).items?.[0];
if (лида) {
  await js(`добавить(${JSON.stringify({ id: лида.id, name: лида.name, addr: лида.addr, lat: лида.lat, lng: лида.lng })}); 1`);
  await sleep(300);
  const сНовой = await иды();
  check('на /marshrut новая точка в ручном режиме встала в конец', сНовой.length === 4 && сНовой[3] === String(лида.id) && JSON.stringify(сНовой.slice(0, 3)) === JSON.stringify(послеСтрелки), сНовой.join(' | '));
} else check('нашёлся Лидский замок для проверки новой точки', false);

// ── ссылка с o=1 в чистом профиле ────────────────────────────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=286,5069,910026&o=1' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 3`);
const поСсылке = await js(`JSON.stringify(Т.map(function(p){ return String(p.id); }))`).then(JSON.parse);
check('ссылка с o=1 — порядок ровно как в ссылке', JSON.stringify(поСсылке) === '["286","5069","910026"]', поСсылке.join(','));
check('ссылка с o=1 ставит ручной режим', (await js(`localStorage.getItem('routeOrder')`)) === 'manual');
const сервер = await (await fetch(SITE + '/marshrut?p=286,5069,910026&o=1')).text();
const поз = ['/mesto/286-', '/mesto/5069-', '/mesto/910026-'].map(s => сервер.indexOf(s));
check('сервер при o=1 не пересортировывает', поз.every(x => x > 0) && поз[0] < поз[1] && поз[1] < поз[2], поз.join(','));
// без o те же точки идут в порядке объезда — иначе проверка выше ничего не доказывает
const безО = await (await fetch(SITE + '/marshrut?p=286,5069,910026')).text();
const позБезО = ['/mesto/286-', '/mesto/5069-', '/mesto/910026-'].map(s => безО.indexOf(s));
check('без o сервер по-прежнему считает порядок объезда', !(позБезО[0] < позБезО[1] && позБезО[1] < позБезО[2]), позБезО.join(','));

// ── главная: блок «Маршрут на день» ──────────────────────────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`typeof routeToggle === 'function' && (window.__places||[]).length > 0`, 120);
const точки = [];
for (const q of ['5069', '286', '910026']) {
  const p = await (await fetch(SITE + '/api/place?id=' + q)).json();
  точки.push({ id: +q, name: p.name, addr: p.addr || '', lat: p.lat, lng: p.lng });
}
await js(`localStorage.removeItem('route'); localStorage.removeItem('routeOrder'); window.__routeOrder = 'auto'; window.__route = []; drawRoute(); 1`);
for (const т of точки) await js(`routeToggle(${JSON.stringify(т)}); 1`);
await sleep(400);
check('на главной в блоке три точки', (await js(`document.querySelectorAll('#rtList .rt-item').length`)) === 3);
check('на главной у строк есть ручки', (await js(`document.querySelectorAll('#rtList .rt-item button.drag').length`)) === 3);
check('на главной в автоматическом режиме кнопки не видно', await js(`document.getElementById('rtAuto').offsetParent === null`));
const доГлавная = await js(`JSON.stringify(window.__route.map(function(p){ return p.id; }))`).then(JSON.parse);
const ходГл = await тащить('#rtList .rt-item', 2, 0);
check('на главной пока тянем — пустая полоска', ходГл.заместитель);
const послеГлавная = await js(`JSON.stringify(window.__route.map(function(p){ return p.id; }))`).then(JSON.parse);
check('на главной порядок в window.__route изменился', JSON.stringify(послеГлавная) === JSON.stringify([доГлавная[2], доГлавная[0], доГлавная[1]]), послеГлавная.join(','));
const го = await js(`document.getElementById('routeGo').getAttribute('href')`);
check('на главной #routeGo в новом порядке и с o=1', го === '/marshrut?p=' + послеГлавная.join(',') + '&o=1', го);
check('на главной #routeBar с o=1', /&o=1$/.test(await js(`document.getElementById('routeBar').getAttribute('href')`)));
check('на главной routeOrder = manual', (await js(`localStorage.getItem('routeOrder')`)) === 'manual');
check('на главной кнопка «Упорядочить автоматически» видна', await js(`document.getElementById('rtAuto').offsetParent !== null`));

// новая точка в ручном режиме — в конец
const новая = (await (await fetch(SITE + '/api/places?q=' + encodeURIComponent('Лидский замок'))).json()).items?.[0];
if (новая) {
  await js(`routeToggle(${JSON.stringify({ id: новая.id, name: новая.name, addr: новая.addr, lat: новая.lat, lng: новая.lng })}); 1`);
  await sleep(300);
  const сНовойГл = await js(`JSON.stringify(window.__route.map(function(p){ return p.id; }))`).then(JSON.parse);
  check('на главной новая точка в ручном режиме встала в конец', JSON.stringify(сНовойГл) === JSON.stringify(послеГлавная.concat([новая.id])), сНовойГл.join(','));
  check('на главной номера строк 1..4', JSON.stringify(await имена('#rtList .rt-item .n')) === '["1","2","3","4"]');
}

// «Упорядочить автоматически» на главной
await js(`window.__доАвто = window.__route.slice(); document.getElementById('rtAuto').click(); 1`);
await sleep(300);
check('на главной после «Упорядочить автоматически» режим auto и кнопка скрыта',
  (await js(`localStorage.getItem('routeOrder')`)) === 'auto' && await js(`document.getElementById('rtAuto').offsetParent === null`));
check('на главной ссылка без o=1', !/o=1/.test(await js(`document.getElementById('routeGo').getAttribute('href')`)));
const автоГл = await js(`JSON.stringify(window.__route.map(function(p){ return p.id; }))`).then(JSON.parse);
const расчётГл = await js(`(function(){ return JSON.stringify(orderRoute(window.__доАвто).map(function(p){ return p.id; })); })()`).then(JSON.parse);
check('на главной порядок как у orderRoute()', JSON.stringify(автоГл) === JSON.stringify(расчётГл), автоГл.join(','));

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
