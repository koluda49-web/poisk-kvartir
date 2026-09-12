// Точки маршрута видны на карте мест.
//
// Зачем. Выбранная в маршрут точка раньше ничем не отличалась от остальных
// восьмисот и при отдалении пряталась в скопление. Проверяем, что после
// добавления на карте появляется своя метка с номером, номера идут по порядку,
// метка не исчезает при отдалении, а после очистки маршрута пропадает.
//
// Сервер должен быть запущен.
//   node проверки/маршрут-на-карте.mjs
//   node проверки/маршрут-на-карте.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9561, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-rtm-' + process.pid,
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

// чистый маршрут, вкладка мест, вид «карта»
await send('Page.navigate', { url: SITE + '/?country=places' });
for (let i = 0; i < 60; i++) { if (await js(`typeof setView === 'function' && (window.__places||[]).length > 0`)) break; await sleep(500); }
await js(`localStorage.removeItem('route'); window.__route = []; setView('map'); 1`);
for (let i = 0; i < 60; i++) { if (await js(`!!window.__plMarkers && Object.keys(window.__plMarkers).length > 100`)) break; await sleep(500); }
check('карта мест нарисована', await js(`Object.keys(window.__plMarkers||{}).length > 100`));
check('без маршрута выделенных меток нет', (await js(`document.querySelectorAll('.rt-pin').length`)) === 0);

// добавляем три точки подряд
const точки = JSON.parse(await js(`JSON.stringify((window.__plMap||window.__places).slice(0,3).map(function(p){ return {id:p.id,name:p.name,lat:p.lat,lng:p.lng}; }))`));
for (const т of точки) await js(`routeToggle(${JSON.stringify(т)}); 1`);
await sleep(500);
const номера = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.rt-pin')].map(function(e){ return e.textContent; }))`));
check('на карте три выделенные метки', номера.length === 3, 'нашлось ' + номера.length);
check('номера по порядку: 1, 2, 3', номера.slice().sort().join(',') === '1,2,3', номера.join(','));
check('между точками нарисована линия', await js(`document.querySelectorAll('.leaflet-overlay-pane path').length > 0`));

// под названием в списке маршрута — где точка находится
const подписи = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#rtList .rt-item')].map(function(e){ var s = e.querySelector('.t small'); return s ? s.textContent : ''; }))`));
const адреса = JSON.parse(await js(`JSON.stringify(orderRoute(window.__route).map(function(p){ return (window.__places.concat(window.__plMap||[]).find(function(x){ return x.id === p.id; })||{}).addr || ''; }))`));
check('под каждой точкой в списке маршрута — где она', подписи.length === 3 && подписи.every(Boolean) && подписи.join('|') === адреса.join('|'), подписи.join(' | '));

// при отдалении выделенные не прячутся в скопления
await js(`window.__map.setZoom(6); 1`); await sleep(900);
check('при отдалении карты метки маршрута остаются видны',
  (await js(`document.querySelectorAll('.rt-pin').length`)) === 3);

// убираем одну — номеров становится два
await js(`dropRoute(${точки[1].id}); 1`); await sleep(400);
check('после удаления одной точки меток две', (await js(`document.querySelectorAll('.rt-pin').length`)) === 2);

// нажатие на метку маршрута открывает окошко точки
await js(`document.querySelector('.rt-pin').dispatchEvent(new MouseEvent('click', {bubbles:true})); 1`);
await sleep(2500);
check('нажатие на метку открывает окошко точки', await js(`!!document.querySelector('.leaflet-popup .mp-pl')`));

// очистка — метки пропадают
await js(`clearRoute(); 1`); await sleep(400);
check('после очистки маршрута выделенных меток нет', (await js(`document.querySelectorAll('.rt-pin').length`)) === 0);

// на карте жилья меток маршрута быть не должно
await js(`routeToggle(${JSON.stringify(точки[0])}); setCountry('by'); 1`);
await sleep(1500);
await js(`setView('map'); 1`); await sleep(2000);
check('на карте жилья меток маршрута нет', (await js(`document.querySelectorAll('.rt-pin').length`)) === 0);
await js(`clearRoute(); 1`);

// маршрут, собранный раньше, без адресов: адрес дотягивается сам
await js(`localStorage.setItem('route', JSON.stringify([{id:5069,name:'Костёл святого Казимира',lat:54.0,lng:25.6}])); 1`);
await send('Page.navigate', { url: SITE + '/?country=places' });
for (let i = 0; i < 60; i++) { if (await js(`!!document.querySelector('#rtList .rt-item .t small')`)) break; await sleep(500); }
check('у старого маршрута адрес подписался сам', /Липнишки/.test(await js(`(document.querySelector('#rtList .rt-item .t small')||{}).textContent || ''`)));
check('адрес запомнился в маршруте', /Липнишки/.test(await js(`localStorage.getItem('route')`)));
await js(`clearRoute(); 1`);

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
