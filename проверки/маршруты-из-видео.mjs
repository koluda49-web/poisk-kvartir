// Готовые маршруты из видео: /m/<slug> и /m.
//
// Зачем. В ролике в ТикТоке ссылка /m/lida-voronovo, и открывают её чаще
// всего во встроенном браузере ТикТока на телефоне — с пустым хранилищем.
// Проверяем, что страница показывает ровно точки из видео и в том же
// порядке, даже если у человека сохранён свой маршрут; что до первой правки
// в хранилище ничего не пишется, а после неё маршрут сохраняется и адрес
// становится обычной ссылкой /marshrut?p=…&o=1. И отдельно — старую беду:
// в чистом профиле страница по ссылке пустела, стоило переключиться
// на другое приложение и вернуться.
//
// Сервер должен быть запущен.
//   node проверки/маршруты-из-видео.mjs
//   node проверки/маршруты-из-видео.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9602, sleep = ms => new Promise(r => setTimeout(r, ms));
const ВИДЕО = JSON.parse(readFileSync(new URL('../маршруты-из-видео.json', import.meta.url), 'utf8'));
const м = ВИДЕО.find(x => x.slug === 'lida-voronovo');

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// ── без браузера: разметка, 404, карта сайта ─────────────────────────────
check('в файле есть маршрут lida-voronovo', !!м);
const ответ = await fetch(SITE + '/m/lida-voronovo');
const html = await ответ.text();
check('/m/lida-voronovo — 200', ответ.status === 200, String(ответ.status));
check('кэш public, max-age=600', ответ.headers.get('cache-control') === 'public, max-age=600', ответ.headers.get('cache-control'));
check('заголовок h1 из файла', html.includes('<h1>' + м.title + '</h1>'));
const escHtml = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
check('вступление под заголовком', html.includes('<p class="intro">' + escHtml(м.intro) + '</p>'));
check('индексируется', /<meta name="robots" content="index,follow">/.test(html));
check('canonical', html.includes('<link rel="canonical" href="https://poisk-kvartir.onrender.com/m/lida-voronovo">'));
check('og:title и og:description', html.includes('<meta property="og:title" content="' + escHtml(м.title) + '">')
  && html.includes('<meta property="og:description" content="' + escHtml(м.intro) + '">'));
const ogImage = (html.match(/<meta property="og:image" content="([^"]+)">/) || [])[1] || '';
check('og:image — полный адрес', /^https:\/\/[^/]+\//.test(ogImage), ogImage);
if (ogImage) {
  const r = await fetch(ogImage.replace('https://poisk-kvartir.onrender.com', SITE), { method: 'GET' }).catch(() => null);
  check('og:image открывается', !!r && r.ok, r ? String(r.status) : 'нет ответа');
}

const имена = [];
for (const id of м.points) {
  const p = await (await fetch(SITE + '/api/place?id=' + id)).json();
  имена.push(p.name);
}

const список = await fetch(SITE + '/m');
const спHtml = await список.text();
check('/m — 200', список.status === 200, String(список.status));
check('/m — карточка со ссылкой на /m/lida-voronovo', /<a class="c" href="\/m\/lida-voronovo">/.test(спHtml));
check('/m — дата «14 сентября»', спHtml.includes('>14 сентября<'));
check('/m — «7 точек»', спHtml.includes('>7 точек<'));
check('/m — подпись про ролики', спHtml.includes('Маршруты из роликов @poisk.kvartir в ТикТоке'));
check('/m — ссылка «← Ко всем местам»', спHtml.includes('>← Ко всем местам</a>'));
check('/m — индексируется', /<meta name="robots" content="index,follow">/.test(спHtml));
const нет = await fetch(SITE + '/m/net-takogo');
const нетHtml = await нет.text();
check('/m/net-takogo — 404', нет.status === 404, String(нет.status));
check('на странице 404 ссылка на /m', нетHtml.includes('href="/m"'));
// имена свойств обычного объекта не должны «находить» маршрут и ронять сервер
for (const slug of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
  const st = (await fetch(SITE + '/m/' + slug)).status;
  check('/m/' + slug + ' — 404', st === 404, String(st));
}
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
check('в sitemap.xml есть /m', карта.includes('<loc>https://poisk-kvartir.onrender.com/m</loc>'));
check('в sitemap.xml есть /m/lida-voronovo', карта.includes('<loc>https://poisk-kvartir.onrender.com/m/lida-voronovo</loc>'));

// ── в браузере ───────────────────────────────────────────────────────────
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-video-' + process.pid,
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
// телефон: так ссылку откроют из ТикТока
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 40) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };
const строки = () => js(`JSON.stringify([...document.querySelectorAll('#rlist .it .t')].map(function(e){ return (e.querySelector('a,b')||e).textContent.replace(/^📍\\s*/, '').trim(); }))`).then(JSON.parse);
const хранилище = () => js(`JSON.stringify({ route: localStorage.getItem('route'), order: localStorage.getItem('routeOrder') })`).then(JSON.parse);

// Переключились на другое приложение и вернулись: браузер прячет страницу
// и показывает снова. Подменяем document.visibilityState и шлём событие.
async function скрытьИПоказать() {
  await js(`(function(){
    window.__вид = 'hidden';
    try { Object.defineProperty(document, 'visibilityState', { configurable: true, get: function(){ return window.__вид; } }); } catch (e) {}
    document.dispatchEvent(new Event('visibilitychange'));
    window.__вид = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  })(); 1`);
  await sleep(400);
}

// чистый профиль
await send('Page.navigate', { url: SITE + '/marshrut' });
await sleep(1000);
await js(`localStorage.clear(); 1`);

// ── /m/lida-voronovo в чистом профиле ────────────────────────────────────
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === ${м.points.length}`);
let r = await строки();
check('в чистом профиле 7 точек в порядке файла', JSON.stringify(r) === JSON.stringify(имена), r.join(' | ') + '  ждали: ' + имена.join(' | '));
check('номера меток на карте 1..7', await js(`JSON.stringify([...document.querySelectorAll('#rmap .pin')].map(function(e){return +e.textContent;}).sort(function(a,b){return a-b;})) === '[1,2,3,4,5,6,7]'`));
check('заголовок и вступление на странице', await js(`document.querySelector('h1').textContent === ${JSON.stringify(м.title)} && document.querySelector('.intro').textContent === ${JSON.stringify(м.intro)}`));
let х = await хранилище();
check('до правки в хранилище ничего не записано', х.route === null && х.order === null, JSON.stringify(х));
check('адрес остался /m/lida-voronovo', (await js(`location.pathname`)) === '/m/lida-voronovo', await js(`location.href`));
check('кнопки «Упорядочить автоматически» видно (порядок ручной)', await js(`document.getElementById('rAuto').offsetParent !== null`));

await скрытьИПоказать();
r = await строки();
check('/m: после ухода со страницы и возврата — все 7 точек', r.length === 7 && JSON.stringify(r) === JSON.stringify(имена), r.join(' | '));
х = await хранилище();
check('/m: возврат на страницу ничего не пишет в хранилище', х.route === null && х.order === null, JSON.stringify(х));

// ── /marshrut?p=… в чистом профиле: та же беда ───────────────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=5069,286,910026' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 3`);
check('/marshrut по ссылке: три точки', (await строки()).length === 3);
await скрытьИПоказать();
check('/marshrut по ссылке: после возврата на страницу три точки', (await строки()).length === 3, (await строки()).join(' | '));
await скрытьИПоказать();
check('/marshrut по ссылке: и после второго возврата три точки', (await строки()).length === 3);
// а если маршрут правда поменяли в другой вкладке, пока страница была скрыта, — подхватываем
await js(`localStorage.setItem('route', JSON.stringify([{id:285,name:'Лидский замок',addr:'г. Лида',lat:53.887131,lng:25.302564},{id:2416,name:'Мирский замок',addr:'г. Мир',lat:53.451232,lng:26.473042}])); 1`);
await скрытьИПоказать();
check('/marshrut по ссылке: изменённый в другой вкладке маршрут подхватывается при возврате', (await строки()).length === 2, (await строки()).join(' | '));
// связанная страница по-прежнему видит правки из другой вкладки
await js(`(function(){ var v = JSON.parse(localStorage.getItem('route')); v.push({id:286,name:'Точка',addr:'',lat:53.6,lng:25.8}); localStorage.setItem('route', JSON.stringify(v)); })(); 1`);
await скрытьИПоказать();
check('после этого новые точки из другой вкладки тоже подхватываются', (await строки()).length === 3, (await строки()).join(' | '));

// ── /marshrut?p=…&o=1 в чистом профиле: порядок пишется при загрузке ─────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=286,5069,910026&o=1' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 3`);
const иды = () => js(`JSON.stringify(Т.map(function(p){ return String(p.id); }))`).then(JSON.parse);
check('/marshrut с o=1: три точки в порядке ссылки', JSON.stringify(await иды()) === '["286","5069","910026"]');
await скрытьИПоказать();
check('/marshrut с o=1: после возврата на страницу те же три точки в том же порядке', JSON.stringify(await иды()) === '["286","5069","910026"]', (await иды()).join(','));
check('/marshrut с o=1: адрес не сменился', (await js(`location.search`)) === '?p=286,5069,910026&o=1', await js(`location.search`));

// ── маршрут из видео заменили из другой вкладки — заголовок становится обычным ─
const чужой = JSON.stringify([{id:285,name:'Лидский замок',addr:'г. Лида',lat:53.887131,lng:25.302564},
  {id:2416,name:'Мирский замок',addr:'г. Мир',lat:53.451232,lng:26.473042}]);
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === ${м.points.length}`);
await js(`localStorage.setItem('route', ${JSON.stringify(чужой)}); window.dispatchEvent(new StorageEvent('storage', { key: 'route', newValue: ${JSON.stringify(чужой)} })); 1`);
await sleep(400);
check('storage: точки из другой вкладки показаны', (await строки()).length === 2, (await строки()).join(' | '));
check('storage: заголовок стал «Маршрут на день»', (await js(`document.querySelector('h1').textContent`)) === 'Маршрут на день', await js(`document.querySelector('h1').textContent`));
check('storage: вступление скрыто', await js(`!document.querySelector('.intro') || document.querySelector('.intro').offsetParent === null`));
check('storage: title страницы — обычный маршрут', /^Маршрут на день/.test(await js(`document.title`)) && !(await js(`document.title`)).includes(м.title), await js(`document.title`));
check('storage: текст про порядок из видео убран', !(await js(`document.querySelector('.how').textContent`)).includes('как в видео'));
check('storage: адрес стал /marshrut', (await js(`location.pathname`)) === '/marshrut', await js(`location.pathname`));

// то же через возврат на страницу
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === ${м.points.length}`);
await js(`localStorage.setItem('route', ${JSON.stringify(чужой)}); 1`);
await скрытьИПоказать();
check('возврат: точки из другой вкладки показаны', (await строки()).length === 2, (await строки()).join(' | '));
check('возврат: заголовок «Маршрут на день», вступление скрыто, title обычный',
  (await js(`document.querySelector('h1').textContent`)) === 'Маршрут на день'
  && await js(`document.querySelector('.intro').offsetParent === null`)
  && /^Маршрут на день/.test(await js(`document.title`)), await js(`document.title`));

// ── сохранён другой маршрут — страница из видео всё равно показывает свои 7 ─
await js(`localStorage.clear(); localStorage.setItem('route', JSON.stringify([
  {id:2416,name:'Мирский замок',addr:'г. Мир',lat:53.451232,lng:26.473042},
  {id:244,name:'Несвижский замок',addr:'г. Несвиж',lat:53.222816,lng:26.691436},
  {id:5069,name:'Костёл',addr:'',lat:53.9,lng:25.4},
  {id:285,name:'Лидский замок',addr:'г. Лида',lat:53.887131,lng:25.302564},
  {id:1,name:'a',addr:'',lat:53.1,lng:27.1},{id:2,name:'b',addr:'',lat:53.2,lng:27.2},
  {id:3,name:'c',addr:'',lat:53.3,lng:27.3},{id:4,name:'d',addr:'',lat:53.4,lng:27.4},
  {id:5,name:'e',addr:'',lat:53.5,lng:27.5}])); localStorage.setItem('routeOrder', 'auto'); 1`);
const сохранённый = (await хранилище()).route;
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === ${м.points.length}`);
r = await строки();
check('при сохранённом другом маршруте — 7 точек из видео по порядку', JSON.stringify(r) === JSON.stringify(имена), r.join(' | '));
await скрытьИПоказать();
r = await строки();
check('и после возврата на страницу — те же 7', JSON.stringify(r) === JSON.stringify(имена), r.join(' | '));
х = await хранилище();
check('сохранённый маршрут не тронут, пока ничего не меняли', х.route === сохранённый && х.order === 'auto', JSON.stringify(х).slice(0, 120));

// ── первая правка: убрать точку ──────────────────────────────────────────
const убираем = String(м.points[1]);
await js(`document.querySelector('#rlist .it .x[data-id="${убираем}"]').click(); 1`);
await sleep(400);
const адрес = await js(`location.pathname + location.search`);
check('после удаления адрес /marshrut?p=…&o=1', /^\/marshrut\?p=[^&]+&o=1$/.test(адрес), адрес);
const вАдресе = decodeURIComponent(адрес).replace(/^\/marshrut\?p=/, '').replace(/&o=1$/, '').split(',').map(t => t.replace(/~.*$/, ''));
const ждём = м.points.map(String).filter(t => t !== убираем);
check('в адресе 6 точек в порядке видео', JSON.stringify(вАдресе) === JSON.stringify(ждём), вАдресе.join(','));
х = await хранилище();
const вХранилище = JSON.parse(х.route || '[]').map(p => String(p.id));
check('в localStorage.route 6 точек в порядке видео', JSON.stringify(вХранилище) === JSON.stringify(ждём), вХранилище.join(','));
check('routeOrder = manual', х.order === 'manual', х.order);
check('заголовок и вступление остались', await js(`document.querySelector('h1').textContent === ${JSON.stringify(м.title)} && document.querySelector('.intro').offsetParent !== null && document.title === ${JSON.stringify(м.title)}`));
await скрытьИПоказать();
check('после правки и возврата на страницу — 6 точек', (await строки()).length === 6);

// перезагрузка по новому адресу — тот же маршрут
await send('Page.reload');
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 6`);
check('после перезагрузки 6 точек в том же порядке', JSON.stringify(await js(`JSON.stringify(Т.map(function(p){ return String(p.id); }))`).then(JSON.parse)) === JSON.stringify(ждём));

// ── «Упорядочить автоматически» на /m — это тоже правка ─────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === ${м.points.length}`);
await js(`document.getElementById('rAuto').click(); 1`);
await sleep(400);
х = await хранилище();
check('«Упорядочить автоматически» на /m: routeOrder = auto, маршрут сохранён', х.order === 'auto' && JSON.parse(х.route || '[]').length === 7, JSON.stringify(х).slice(0, 80));
check('«Упорядочить автоматически» на /m: адрес без o=1', /^\/marshrut\?p=[^&]+$/.test(await js(`location.pathname + location.search`)), await js(`location.pathname + location.search`));

// ── главная: ссылка на /m во вкладке «Что посетить» ──────────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`!!document.querySelector('#plLinks a[href="/m"]') && document.querySelector('#plLinks').offsetParent !== null`, 60);
check('на главной во вкладке мест видна ссылка «Маршруты из видео →»', await js(`(function(){ var a = document.querySelector('#plLinks a[href="/m"]'); return !!a && a.offsetParent !== null && /Маршруты из видео/.test(a.textContent); })()`));
await js(`setCountry('by', true); 1`);
check('на вкладке жилья ссылки не видно', await js(`document.querySelector('#plLinks').offsetParent === null`));

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
