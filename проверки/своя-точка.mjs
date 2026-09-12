// Своя точка в маршруте.
//
// Зачем. Места, куда едут, может не быть в справочнике (так было с
// «Вольным мельником»). Проверяем, что точку можно поставить самому: на
// карте мест и на странице маршрута, по нажатию на карту и по координатам;
// что она попадает в ссылку вместе с именем, переживает переход между
// страницами, её можно передвинуть и убрать, а на карте жилья кнопки нет.
//
// Сервер должен быть запущен.
//   node проверки/своя-точка.mjs
//   node проверки/своя-точка.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9563, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-own-' + process.pid,
  'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const ошибки = [];
let имяДляОкна = 'Вольный мельник', оконСпросили = 0;
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  // окошко «Как назвать точку?» — отвечаем заданным именем
  if (m.method === 'Page.javascriptDialogOpening') {
    оконСпросили++;
    send('Page.handleJavaScriptDialog', { accept: true, promptText: имяДляОкна });
  }
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// ── новые места есть в справочнике ───────────────────────────────────────
const найти = async q => (await (await fetch(SITE + '/api/places?q=' + encodeURIComponent(q))).json()).items || [];
check('«Вольный мельник» находится поиском', (await найти('мельник')).some(p => p.name === 'Вольный мельник'));
check('костёл в Вороново находится поиском', (await найти('Вороново')).some(p => /Милосердия/.test(p.name)));
check('костёл в Старых Василишках находится поиском', (await найти('Василишки')).some(p => /Петра и Павла/.test(p.name)));
check('костёл в Оссово находится поиском', (await найти('Оссово')).some(p => /Святого Юрия/.test(p.name)));
check('Мурованка называется по-человечески', (await найти('Мурованка')).some(p => /Рождества Богородицы/.test(p.name)));
const мурованка = await (await fetch(SITE + '/api/place?id=286')).json();
check('у Мурованки своё описание', /храм-крепость/i.test(мурованка.text || ''));
const мельник = await fetch(SITE + '/mesto/910026');
check('страница «Вольного мельника» открывается без фото', мельник.ok && /Вольный мельник/.test(await мельник.text()));

// ── главная, карта мест ──────────────────────────────────────────────────
await send('Page.navigate', { url: SITE + '/?country=places' });
for (let i = 0; i < 60; i++) { if (await js(`typeof setView === 'function' && (window.__places||[]).length > 0`)) break; await sleep(500); }
await js(`localStorage.removeItem('route'); window.__route = []; setView('map'); 1`);
for (let i = 0; i < 60; i++) { if (await js(`!!window.__plMarkers && Object.keys(window.__plMarkers).length > 100`)) break; await sleep(500); }
await sleep(300);
check('на карте мест есть кнопка «Своя точка»', await js(`(function(b){ return !!b && b.offsetParent !== null && /Своя точка/.test(b.textContent); })(document.getElementById('ownPin'))`));

await js(`document.getElementById('ownPin').click(); 1`);
check('после нажатия карта ждёт точку', await js(`document.getElementById('map').classList.contains('placing') && window.__placing === true`));
await js(`window.__map.fire('click', { latlng: L.latLng(53.997489, 25.385834) }); 1`);
await sleep(400);
const маршрут = JSON.parse(await js(`JSON.stringify(window.__route)`));
check('спросили имя точки', оконСпросили === 1, 'окон: ' + оконСпросили);
check('точка встала в маршрут с именем', маршрут.length === 1 && маршрут[0].name === 'Вольный мельник' && маршрут[0].id === 'm53.99749_25.38583', JSON.stringify(маршрут));
check('режим после нажатия выключился', await js(`!window.__placing && !document.getElementById('map').classList.contains('placing')`));
check('на карте метка своей точки', (await js(`document.querySelectorAll('.rt-pin').length`)) === 1);

// добавим точку справочника рядом
const точка = JSON.parse(await js(`JSON.stringify((function(){ var p = window.__places.find(function(x){ return x.id === 286; }) || window.__places[0]; return {id:p.id,name:p.name,lat:p.lat,lng:p.lng}; })())`));
await js(`routeToggle(${JSON.stringify(точка)}); 1`); await sleep(300);
check('рядом со своей точкой — точка справочника', (await js(`document.querySelectorAll('.rt-pin').length`)) === 2);
const ссылка = await js(`document.getElementById('routeGo').getAttribute('href')`);
check('в ссылке на маршрут своя точка с именем', /m53\.99749_25\.38583~/.test(ссылка) && decodeURIComponent(ссылка).includes('Вольный мельник'), ссылка);
check('в списке маршрута своя точка отмечена', await js(`/📍 Вольный мельник/.test(document.getElementById('rtList').textContent)`));

// передвинуть
await js(`передвинутьСвою('m53.99749_25.38583', 54.0, 25.4); 1`); await sleep(300);
check('после перетаскивания координаты и номер обновились', await js(`window.__route.some(function(p){ return p.id === 'm54.00000_25.40000' && p.lat === 54; })`));

// убрать крестиком в списке
await js(`[...document.querySelectorAll('#rtList .x')].find(function(b){ return b.dataset.id.charAt(0) === 'm'; }).click(); 1`); await sleep(300);
check('своя точка убирается крестиком', (await js(`window.__route.length`)) === 1 && (await js(`document.querySelectorAll('.rt-pin').length`)) === 1);

// отмена имени — точка не ставится
имяДляОкна = null;
await send('Runtime.evaluate', { expression: `window.prompt = function(){ return null; }; 1` });
await js(`document.getElementById('ownPin').click(); window.__map.fire('click', { latlng: L.latLng(53.9, 27.5) }); 1`);
check('если отменить имя — точка не ставится', (await js(`window.__route.length`)) === 1);
await js(`delete window.prompt; 1`);

// на карте жилья кнопки нет
await js(`setCountry('by'); 1`); await sleep(1500);
await js(`setView('map'); 1`); await sleep(1500);
check('на карте жилья кнопки «Своя точка» нет', await js(`(function(b){ return !b || b.offsetParent === null; })(document.getElementById('ownPin'))`));

// ── страница маршрута по ссылке со своей точкой ──────────────────────────
имяДляОкна = 'Вольный мельник';
await js(`localStorage.removeItem('route'); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=m53.99749_25.38583~' + encodeURIComponent('Вольный мельник') + ',286' });
for (let i = 0; i < 40; i++) { if (await js(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length > 0`)) break; await sleep(500); }
check('по ссылке своя точка в списке', await js(`/Вольный мельник/.test(document.getElementById('rlist').textContent) && !!document.querySelector('#rlist .ownn')`));
check('по ссылке на карте две метки, одна своя', (await js(`document.querySelectorAll('#rmap .pin').length`)) === 2 && (await js(`document.querySelectorAll('#rmap .pin.own').length`)) === 1);

// поставить по нажатию на карту
оконСпросили = 0; имяДляОкна = 'Костёл в Вороново <script>';
await js(`document.getElementById('rOwn').click(); 1`);
check('кнопка переводит карту в режим точки', await js(`document.getElementById('rmap').classList.contains('placing')`));
await js(`карта.fire('click', { latlng: L.latLng(54.150831, 25.311092) }); 1`); await sleep(500);
check('точка с карты добавилась', (await js(`document.querySelectorAll('#rlist .it').length`)) === 3);
check('угловые скобки из имени убраны', await js(`!document.getElementById('rlist').innerHTML.includes('<script') && /Костёл в Вороново/.test(document.getElementById('rlist').textContent)`));
check('адрес страницы обновился', await js(`location.search.includes('m54.15083_25.31109~')`));

// поставить по координатам из поиска
имяДляОкна = 'Старые Василишки';
await js(`document.getElementById('rAdd').value = '53.762080, 24.826755'; искать(); 1`); await sleep(300);
check('координаты в поиске предлагают поставить точку', await js(`!!document.querySelector('#rSug button[data-c]')`));
await js(`document.querySelector('#rSug button[data-c]').click(); 1`); await sleep(500);
check('точка по координатам добавилась', (await js(`document.querySelectorAll('#rlist .it').length`)) === 4);
await js(`document.getElementById('rAdd').value = '53,762080 24,826755'; искать(); 1`); await sleep(200);
check('координаты с запятой тоже понимаются', await js(`(document.querySelector('#rSug button[data-c]')||{}).getAttribute && document.querySelector('#rSug button[data-c]').getAttribute('data-c') === '53.76208,24.826755'`));

// перезагрузка: всё на месте
await send('Page.reload'); await sleep(2500);
check('после перезагрузки четыре точки', (await js(`document.querySelectorAll('#rlist .it').length`)) === 4);

// пустой маршрут: кнопка всё равно показывает карту
await send('Page.navigate', { url: SITE + '/marshrut' }); await sleep(1500);
await js(`localStorage.removeItem('route'); Т = []; нарисовать(); document.getElementById('rOwn').click(); 1`); await sleep(500);
check('на пустом маршруте карта открывается для своей точки', await js(`document.getElementById('rmap').style.display !== 'none' && !!карта`));
имяДляОкна = '';
await js(`карта.fire('click', { latlng: L.latLng(53.9, 27.56) }); 1`); await sleep(400);
check('без имени точка называется «Своя точка»', await js(`/Своя точка/.test(document.getElementById('rlist').textContent)`));

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
