// Карта подгружается после первого кадра, а не в шапке главной (01.10.2026).
//
// Зачем. unpkg.com стоял в <head> как блокирующий скрипт: на телефоне главная ждала внешний
// сервер, прежде чем показать хоть что-то. Теперь Leaflet и скопления меток грузятся
// по требованию: когда человек открыл карту или потянулся к кнопке «Карта».
//
//   node проверки/карта-позже.mjs http://127.0.0.1:8241
import { запуститьChrome } from './_браузер.mjs';
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9572, sleep = ms => new Promise(r => setTimeout(r, ms));
const { закрыть } = запуститьChrome(PORT, 'kmp');
let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const открыть = async путь => { await send('Page.navigate', { url: SITE + путь }); await sleep(2500); };
const ждать = async (условие, сек = 25) => { for (let i = 0; i < сек * 4; i++) { if (await js(условие)) return true; await sleep(250); } return false; };

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

console.log('=== шапка главной не держит внешних скриптов карты ===');
const html = await (await fetch(SITE + '/')).text();
const шапка = html.slice(0, html.indexOf('</head>'));
check('в <head> нет скриптов и стилей unpkg.com', !/unpkg\.com/.test(шапка));

console.log('\n=== первый кадр без карты, грузится по требованию ===');
await send('Page.navigate', { url: SITE + '/' });
await ждать(`document.readyState !== 'loading' && !!document.getElementById('grid')`, 15);
check('в начале Leaflet ещё не подключён', await js(`typeof L === 'undefined'`));
await sleep(4000);
check('сама по себе, без обращения к карте, она не грузится', await js(`typeof L === 'undefined'`));
await js(`document.getElementById('viewMap').dispatchEvent(new Event('pointerenter')); 1`);
check('рука потянулась к кнопке «Карта» — начинается загрузка', await ждать(`typeof L !== 'undefined' && typeof L.markerClusterGroup === 'function'`, 20));
check('таблицы стилей карты добавлены', await js(`!!document.querySelector('link[href*="leaflet.css"]') && !!document.querySelector('link[href*="MarkerCluster.css"]')`));

console.log('\n=== карта открывается сразу, не дожидаясь подгрузки ===');
await send('Page.navigate', { url: SITE + '/?country=places&view=map' });
check('места на карте', await ждать(`window.__view === 'map' && window.__mode === 'places' && !!window.__map && !!window.__plMarkers && Object.keys(window.__plMarkers).length > 50`, 30),
      await js(`'view=' + window.__view + ' mode=' + window.__mode + ' map=' + !!window.__map`));
check('заглушки «Загружаю карту» не осталось', await js(`!document.getElementById('mapWait')`));
await send('Page.navigate', { url: SITE + '/' });
await ждать(`!!document.getElementById('viewMap')`, 20);
await js(`document.getElementById('viewMap').click(); 1`);
check('жильё на карте', await ждать(`window.__view === 'map' && !!window.__map && document.querySelectorAll('.price-pin').length > 0`, 60),
      await js(`'view=' + window.__view + ' map=' + !!window.__map`));

console.log('\n=== точка со страницы места не пропадает, когда список мест дозагрузился ===');
// на настоящем сервере ответ списка приходит позже первой отрисовки карты и перерисовывает её
await send('Page.navigate', { url: SITE + '/?country=places&view=map&place=910089&cb=' + Date.now() });
check('окошко точки открылось', await ждать(`!!document.querySelector('.leaflet-popup .mp-pl') && /ратуша/i.test(document.querySelector('.leaflet-popup').textContent)`, 40));
const до = JSON.parse(await js(`JSON.stringify([window.__map.getCenter().lat, window.__map.getCenter().lng, window.__map.getZoom()])`));
await js(`runPlaces(); 1`);
await sleep(4000);
check('после дозагрузки списка окошко на месте', await js(`!!document.querySelector('.leaflet-popup .mp-pl') && /ратуша/i.test(document.querySelector('.leaflet-popup').textContent)`));
const после = JSON.parse(await js(`JSON.stringify([window.__map.getCenter().lat, window.__map.getCenter().lng, window.__map.getZoom()])`));
check('и карта не уехала', Math.abs(до[0] - после[0]) < 0.005 && Math.abs(до[1] - после[1]) < 0.005 && до[2] === после[2], JSON.stringify(до) + ' → ' + JSON.stringify(после));
await js(`document.querySelector('.leaflet-popup-close-button').click(); 1`);
await sleep(300);
await js(`runPlaces(); 1`);
await sleep(3000);
check('закрытое человеком окошко само не открывается', await js(`!document.querySelector('.leaflet-popup .mp-pl')`));

console.log('\n=== форма «Предложить место» строит карту ===');
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`!!document.getElementById('plBtn')`, 20);
await js(`document.getElementById('plBtn').click(); 1`);
check('карта формы построена', await ждать(`!!window.__plMap && document.querySelectorAll('#plMap .leaflet-tile').length > 0`, 20));

console.log('\n=== нет связи с картографическим сервисом ===');
await send('Network.setBlockedURLs', { urls: ['*://unpkg.com/*'] });
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: SITE + '/?cb=' + Date.now() });
await ждать(`!!document.getElementById('viewMap')`, 20);
await js(`document.getElementById('viewMap').click(); 1`);
check('понятное сообщение вместо пустоты', await ждать(`/Карта не загрузилась/.test((document.getElementById('map')||{}).textContent||'')`, 25),
      await js(`(document.getElementById('map')||{}).textContent`));
check('страница при этом жива: переключение на список работает', await js(`(document.getElementById('viewList').click(), true)`) && await ждать(`document.getElementById('grid').style.display !== 'none'`, 10));
await send('Network.setBlockedURLs', { urls: [] });

check('исключений на странице нет', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
await закрыть();
process.exit(failed ? 1 : 0);
