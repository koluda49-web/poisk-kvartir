// «По пути» — места не дальше 5 км от дороги маршрута.
//
// Зачем. Человек из ролика открывает готовый маршрут и не знает, что в паре
// километров от дороги стоит ещё замок или мельница. Проверяем API
// (/api/route/near: не дальше 5 км, по порядку, без самих точек маршрута,
// без OSRM — по прямым), а на странице маршрута — ленту карточек, кнопку
// «+ в маршрут» (в ручном порядке место встаёт туда, где крюк меньше),
// что лента не спрашивает сервер лишний раз и что на /m/<slug> добавление —
// обычная правка (адрес становится /marshrut).
//
// Сервер должен быть запущен.
//   node проверки/по-пути.mjs
//   node проверки/по-пути.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9604, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

function км(a1, o1, a2, o2) {
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// ── API ──────────────────────────────────────────────────────────────────
const все = (await getJSON(SITE + '/api/places?light=1')).items || [];
const точка = id => все.find(p => String(p.id) === String(id));
const [липнишки, вороново, мурованка] = [5069, 910027, 286].map(точка);
check('в справочнике есть Липнишки, Вороново и Мурованка', !!(липнишки && вороново && мурованка));
const пара = (...p) => p.map(x => x.lat + ',' + x.lng).join(';');

function проверитьОтвет(имя, d, путь, skip) {
  check(имя + ': ok', d && d.ok === true && Array.isArray(d.items), JSON.stringify(d).slice(0, 120));
  const it = (d && d.items) || [];
  check(имя + ': не больше 12', it.length <= 12, it.length);
  check(имя + ': все не дальше 5 км', it.every(p => typeof p.km === 'number' && p.km <= 5), it.map(p => p.km).join(','));
  check(имя + ': км с одним знаком', it.every(p => Math.round(p.km * 10) / 10 === p.km));
  check(имя + ': по возрастанию расстояния', it.every((p, i) => !i || it[i - 1].km <= p.km));
  check(имя + ': нет id из skip', it.every(p => !skip.includes(String(p.id))));
  check(имя + ': нет самих точек маршрута', it.every(p => путь.every(т => км(т.lat, т.lng, p.lat, p.lng) >= 0.3)));
  check(имя + ': у мест все поля', it.every(p => ['id', 'name', 'addr', 'lat', 'lng', 'pic', 'cat', 'km'].every(k => k in p)));
  return it;
}

// Пара из задачи: между Липнишками и Вороново мест в справочнике может и не быть
const d1 = await getJSON(SITE + '/api/route/near?p=' + пара(липнишки, вороново) + '&skip=5069,910027');
проверитьОтвет('Липнишки—Вороново', d1, [липнишки, вороново], ['5069', '910027']);
const d2 = await getJSON(SITE + '/api/route/near?p=' + пара(вороново, мурованка) + '&skip=910027,286');
const поПути = проверитьОтвет('Вороново—Мурованка', d2, [вороново, мурованка], ['910027', '286']);
check('Вороново—Мурованка: места по пути нашлись', поПути.length > 0);
if (поПути.length) {
  const d3 = await getJSON(SITE + '/api/route/near?p=' + пара(вороново, мурованка) + '&skip=910027,286,' + поПути[0].id);
  check('skip убирает место из ответа', d3.ok && d3.items.every(p => String(p.id) !== String(поПути[0].id)));
}
for (const плохой of ['', 'abc', '54.1,25.3', '1,2;3,4', '54.1,25.3;x']) {
  const d = await getJSON(SITE + '/api/route/near?p=' + encodeURIComponent(плохой));
  check('неправильный p=«' + плохой + '» → ok:false', d && d.ok === false, JSON.stringify(d));
}
const дорога = await getJSON(SITE + '/api/route?p=' + пара(липнишки, вороново, мурованка));
if (дорога.ok) check('/api/route отдаёт минуты перегонов', Array.isArray(дорога.legMinutes) && дорога.legMinutes.length === 2
  && дорога.legMinutes.every(m => Number.isInteger(m) && m > 0), JSON.stringify(дорога.legMinutes));
else console.log('  (OSRM не ответил — legMinutes не проверены)');

// ── кэш и отказ OSRM: второй экземпляр сервера с поддельным маршрутизатором ──
// Подделка отвечает как публичный OSRM под нагрузкой: 200 и «TooManyRequests».
// Только для маршрута от Липнишек отдаёт настоящий ответ (прямую) — чтобы
// проверить кэш ответа по дорогам с пустым списком мест.
{
  const корень = join(dirname(fileURLToPath(import.meta.url)), '..');
  const папка = mkdtempSync(join(tmpdir(), 'po-puti-'));
  const порт = 8193, портOSRM = 9623;
  const запросыOSRM = [];
  const osrm = createServer((req, res) => {
    запросыOSRM.push(req.url);
    const m = req.url.match(/\/route\/v1\/driving\/([^?]+)/);
    const coords = m ? decodeURIComponent(m[1]).split(';').map(x => x.split(',').map(Number)) : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (coords.length > 1 && coords[0][1] === липнишки.lat) {
      const legs = coords.slice(1).map((c, i) => ({ distance: 1000 * км(coords[i][1], coords[i][0], c[1], c[0]), duration: 60 * км(coords[i][1], coords[i][0], c[1], c[0]) }));
      res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: legs.reduce((x, l) => x + l.distance, 0), duration: legs.reduce((x, l) => x + l.duration, 0), legs, geometry: { coordinates: coords } }] }));
    } else res.end('{"code":"TooManyRequests","message":"Too Many Requests"}');
  });
  await new Promise(r => osrm.listen(портOSRM, '127.0.0.1', r));
  const сервер = spawn(process.execPath, ['kvartiry-server.js'], { cwd: корень, stdio: 'ignore', env: Object.assign({}, process.env, {
    PORT: String(порт), OSRM_URL: 'http://127.0.0.1:' + портOSRM, DATA_TEST: '1', DATA_TEST_NAMES: '',
    DATA_DIR: папка, STATS_FILE: join(папка, 'stats.json'),
    KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off', GH_TOKEN: '', RENDER_EXTERNAL_URL: '' }) });
  const второй = 'http://127.0.0.1:' + порт;
  let готов = false;
  for (let i = 0; i < 90 && !готов && сервер.exitCode === null; i++) {
    try { готов = ((await getJSON(второй + '/api/places?light=1')).items || []).length > 0; } catch {}
    if (!готов) await sleep(1000);
  }
  const служебный = async () => { try { return await getJSON(второй + '/api/_route-test'); } catch { return null; } };
  const с0 = готов ? await служебный() : null;
  check('второй экземпляр сервера поднялся и работает', готов && сервер.exitCode === null);
  check('на порту ' + порт + ' отвечает именно он (pid совпадает)', !!с0 && с0.pid === сервер.pid, с0 && (с0.pid + ' / ' + сервер.pid));
  if (готов && с0 && с0.pid === сервер.pid) {
    const pVM = пара(вороново, мурованка), pЛВ = пара(липнишки, вороново);
    const ключOSRM = pp => 'osrm|' + pp.split(';').map(x => x.split(',').map(Number).map(n => n.toFixed(5)).join(',')).join(';');
    const ключРядом = pp => 'near|' + pp.split(';').map(x => x.split(',').map(Number).map(n => n.toFixed(4)).join(',')).join(';') + '|';

    // отказ OSRM не попадает в кэш
    const доРоут = запросыOSRM.length;
    const р1 = await getJSON(второй + '/api/route?p=' + pVM);
    const р2 = await getJSON(второй + '/api/route?p=' + pVM);
    check('OSRM «TooManyRequests» → /api/route ok:false', р1.ok === false && р2.ok === false);
    check('отказ OSRM не кэшируется: второй запрос снова идёт в OSRM', запросыOSRM.length - доРоут === 2, (запросыOSRM.length - доРоут) + ' запросов');
    check('отказа OSRM нет в кэше', !(await служебный()).osrmКлючи.includes(ключOSRM(pVM)));

    // без дороги — по прямым, кэш 10 мин, повтор из кэша
    const сДо = (await служебный()).счёт.поПути;
    const d = await getJSON(второй + '/api/route/near?p=' + pVM + '&skip=910027,286');
    const it = проверитьОтвет('без OSRM', d, [вороново, мурованка], ['910027', '286']);
    check('без OSRM места по прямой всё равно есть', it.length > 0);
    const доПовтора = запросыOSRM.length;
    const d2 = await getJSON(второй + '/api/route/near?p=' + pVM + '&skip=286,910027');
    const с1 = await служебный();
    check('без OSRM повтор (skip в другом порядке) — из кэша', с1.счёт.поПути - сДо === 1 && JSON.stringify(d2) === JSON.stringify(d), 'посчитали ' + (с1.счёт.поПути - сДо));
    check('без OSRM повтор не ходит в OSRM', запросыOSRM.length === доПовтора);
    const запПрямые = с1.записи.find(z => z.ключ.startsWith(ключРядом(pVM)));
    check('ответ по прямым живёт 10 мин', !!запПрямые && запПрямые.ttl === 10 * 60 * 1000, JSON.stringify(запПрямые));

    // по дорогам и пусто — кэш 6 ч, повтор из кэша
    const р3 = await getJSON(второй + '/api/route?p=' + pЛВ);
    check('поддельный OSRM с маршрутом → legMinutes', р3.ok === true && Array.isArray(р3.legMinutes) && р3.legMinutes.length === 1, JSON.stringify(р3).slice(0, 120));
    const сДо2 = (await служебный()).счёт.поПути;
    const e1 = await getJSON(второй + '/api/route/near?p=' + pЛВ + '&skip=5069,910027');
    const e2 = await getJSON(второй + '/api/route/near?p=' + pЛВ + '&skip=5069,910027');
    const с2 = await служебный();
    check('пустой список по дорогам: ok и пусто', e1.ok === true && e1.items.length === 0 && e2.ok === true && e2.items.length === 0, JSON.stringify(e1).slice(0, 100));
    check('пустой список: второй запрос из кэша', с2.счёт.поПути - сДо2 === 1, 'посчитали ' + (с2.счёт.поПути - сДо2));
    const запПусто = с2.записи.find(z => z.ключ.startsWith(ключРядом(pЛВ)));
    check('пустой список по дорогам живёт 6 ч', !!запПусто && запПусто.ttl === 6 * 60 * 60 * 1000 && запПусто.мест === 0, JSON.stringify(запПусто));
  }
  сервер.kill();
  osrm.close();
  await sleep(500);
  try { rmSync(папка, { recursive: true, force: true }); } catch {}
}

// ── страница ─────────────────────────────────────────────────────────────
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-near-' + process.pid,
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') ошибки.push((m.params.args || []).map(a => a.value || a.description).join(' '));
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 60) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };
const иды = () => js(`JSON.stringify(Т.map(function(p){ return String(p.id); }))`).then(JSON.parse);
const карточки = () => js(`JSON.stringify([...document.querySelectorAll('#rNearList .nc')].map(function(e){ return e.getAttribute('data-id'); }))`).then(JSON.parse);
const запросов = () => js(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/route/near') >= 0; }).length`);

await send('Page.navigate', { url: SITE + '/marshrut' });
await sleep(1000);
await js(`localStorage.clear(); 1`);

// одна точка — секции нет и запроса нет
await send('Page.navigate', { url: SITE + '/marshrut?p=5069' });
// ждём именно новую страницу: старая тоже бывает «complete», пока грузится следующая
await ждать(`location.search === '?p=5069' && document.readyState === 'complete' && typeof Т !== 'undefined' && Т.length === 1`);
await sleep(1200);
check('одна точка: секции «По пути» нет', await js(`document.getElementById('rNear').hidden && document.getElementById('rNear').offsetParent === null`));
check('одна точка: к /api/route/near не ходили', (await запросов()) === 0);

// две точки — лента
await send('Page.navigate', { url: SITE + '/marshrut?p=910027,286' });
const видна = await ждать(`!document.getElementById('rNear').hidden && document.querySelectorAll('#rNearList .nc').length > 0`, 80);
check('две точки: секция «По пути» видна', видна);
check('заголовок «По пути — до 5 км от дороги»', (await js(`document.querySelector('#rNear h2').textContent`)) === 'По пути — до 5 км от дороги');
// между «По пути» и поиском стоят «План дня» и «Сколько стоит дорога» (Task 6)
check('секция под списком и над поиском', await js(`(function(){ var n = document.getElementById('rNear'), д = n.nextElementSibling;
  while(д && (д.id === 'rPlan' || д.id === 'rFuel')) д = д.nextElementSibling;
  return document.getElementById('rlist').nextElementSibling === n && !!д && д.classList.contains('add'); })()`));
const подписи = await js(`JSON.stringify([...document.querySelectorAll('#rNearList .nc .d')].map(function(e){ return e.textContent; }))`).then(JSON.parse);
check('у карточек «N км от дороги»', подписи.length > 0 && подписи.every(t => /^(меньше 0,1|\d+(,\d)?) км от дороги$/.test(t)), подписи.join(' | '));
check('у каждой карточки кнопка «+ в маршрут»', await js(`[...document.querySelectorAll('#rNearList .nc')].every(function(c){ var b = c.querySelector('button.na'); return b && b.textContent === '+ в маршрут'; })`));
check('снимки грузятся лениво, без снимка — заглушка', await js(`[...document.querySelectorAll('#rNearList .nc')].every(function(c){ var i = c.querySelector('img'); return i ? i.getAttribute('loading') === 'lazy' : !!c.querySelector('.ni'); })`));
// ленивые снимки, вставленные в скрытую секцию, не грузились вовсе
const первыйСнимок = await ждать(`(function(){ var i = document.querySelector('#rNearList .nc img'); return !i || (i.complete && i.naturalWidth > 0); })()`, 120);
check('снимки в ленте правда загрузились', первыйСнимок);
check('карточка на телефоне 150–170 px', await js(`(function(){ var w = document.querySelector('#rNearList .nc').getBoundingClientRect().width; return w >= 150 && w <= 170; })()`));
check('лента прокручивается вбок, страница — нет', await js(`getComputedStyle(document.getElementById('rNearList')).overflowX === 'auto' && document.documentElement.scrollWidth <= innerWidth`));

// перерисовка без изменений — сервер второй раз не спрашиваем
const было = await запросов();
await js(`нарисовать(); нарисовать(); нарисовать(); 1`);
await sleep(1200);
check('тот же маршрут повторно не запрашивается', (await запросов()) === было, было + ' → ' + (await запросов()));

// Быстрый возврат: точку добавили и сразу убрали, пока шёл запрос ленты для
// промежуточного маршрута. Опоздавший ответ не должен заменить ленту на экране.
{
  const лида = точка(285);
  const ключБыл = await js(`ПО_ПУТИ.к`), лентаБыла = await карточки();
  await js(`window.__f = window.fetch; window.fetch = function(u){ var p = window.__f.apply(this, arguments);
    return String(u).indexOf('/api/route/near') >= 0 ? p.then(function(r){ return new Promise(function(ok){ setTimeout(function(){ ok(r); }, 2500); }); }) : p; }; 1`);
  await js(`добавить(${JSON.stringify({ id: лида.id, name: лида.name, addr: лида.addr, lat: лида.lat, lng: лида.lng })}); 1`);
  await sleep(1000);
  const вПути = await js(`поПутиЗапрос === ключПоПути() && ключПоПути() !== ${JSON.stringify(ключБыл)}`);
  await js(`убрать('285'); 1`);
  await sleep(1000);
  const вернули = await js(`ключПоПути() === ${JSON.stringify(ключБыл)}`);
  await sleep(3000);
  check('быстрый возврат: запрос для промежуточного маршрута правда шёл', вПути && вернули);
  check('быстрый возврат: опоздавший ответ не подменил ленту', (await js(`ПО_ПУТИ.к === ключПоПути()`))
    && JSON.stringify(await карточки()) === JSON.stringify(лентаБыла), JSON.stringify(await карточки()));
  await js(`window.fetch = window.__f; 1`);
}

// «+ в маршрут» в автоматическом порядке
const доКнопки = await запросов();
const доДобавления = await карточки();
const первая = доДобавления[0];
await js(`document.querySelector('#rNearList .nc[data-id="${первая}"] .na').click(); 1`);
await sleep(100);
check('«+ в маршрут» добавляет точку', (await иды()).includes(String(первая)), (await иды()).join(','));
check('добавленная сразу пропала из ленты', !(await карточки()).includes(String(первая)));
await ждать(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/route/near') >= 0; }).length > ${доКнопки}`, 40);
await sleep(1500);
check('после добавления лента перезапрошена', (await запросов()) > доКнопки);
check('после перезапроса добавленной в ленте нет', !(await карточки()).includes(String(первая)));
check('маршрут сохранён с новой точкой', await js(`JSON.parse(localStorage.getItem('route')||'[]').some(function(p){ return String(p.id) === '${первая}'; })`));

// ручной порядок: место по пути встаёт между точками, а не в конец
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=910027,286&o=1' });
await ждать(`!document.getElementById('rNear').hidden && document.querySelectorAll('#rNearList .nc').length > 0`, 80);
check('o=1: ручной порядок', (await js(`ПОРЯДОК`)) === 'manual');
// берём карточку, для которой крюк через середину правда меньше, чем в концы
const выбор = await js(`(function(){ var a = Т[0], b = Т[1], лучш = null, запас = -1;
  [...document.querySelectorAll('#rNearList .nc .na')].forEach(function(k){ var p = JSON.parse(k.getAttribute('data-p'));
    var с = км(a, p) + км(p, b) - км(a, b), з = Math.min(км(p, a), км(b, p)) - с;
    if(з > запас){ запас = з; лучш = String(p.id); } });
  return лучш; })()`);
check('есть место, которому место между точками', !!выбор);
if (выбор) {
  await js(`document.querySelector('#rNearList .nc[data-id="${выбор}"] .na').click(); 1`);
  await sleep(200);
  const стало = await иды();
  check('o=1: точка встала между первой и последней', JSON.stringify(стало) === JSON.stringify(['910027', выбор, '286']), стало.join(','));
  check('o=1: в адресе порядок со вставкой и o=1', decodeURIComponent(await js(`location.search`)) === '?p=910027,' + выбор + ',286&o=1', await js(`location.search`));
}

// готовый маршрут из видео: до правки ничего не пишем, добавление — обычная правка
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
const естьВидео = await ждать(`typeof Т !== 'undefined' && Т.length > 1 && !document.getElementById('rNear').hidden`, 80);
if (естьВидео) {
  check('/m/lida-voronovo: лента есть, в хранилище пусто', (await js(`localStorage.getItem('route')`)) === null);
  const к = (await карточки())[0], n = (await иды()).length;
  await js(`document.querySelector('#rNearList .nc .na').click(); 1`);
  await sleep(300);
  check('/m/…: «+ в маршрут» добавил точку', (await иды()).length === n + 1 && (await иды()).includes(String(к)));
  check('/m/…: адрес стал /marshrut', (await js(`location.pathname`)) === '/marshrut', await js(`location.pathname`));
  check('/m/…: маршрут записан в хранилище', await js(`JSON.parse(localStorage.getItem('route')||'[]').length === ${n + 1}`));
} else console.log('  (на /m/lida-voronovo мест по пути нет — пропускаю)');

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
