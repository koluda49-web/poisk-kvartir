// Замеры скорости сайта: сервер, API и настоящий браузер (стационарный и «мобильный»).
// Ничего не проверяет и не падает — печатает таблицу и пишет её в файл, чтобы сравнивать
// от замера к замеру (первый — 01.10.2026).
//
//   node проверки/замеры-скорости.mjs https://nochy.by "путь/к/отчёту.txt"
//
// Что считаем:
//  — сервер: время до первого байта (TTFB) и до конца ответа, 4 захода подряд на страницу
//    (первый — «холодный» для кэша сервера, остальные — тёплые). Сеть до сервера из этого
//    замера не вычитаем, поэтому дан ещё /ping — это «чистая» сеть без работы сервера;
//  — API: те же времена и вес ответа (со сжатием);
//  — браузер: время до первого кадра (FCP), до самого большого элемента (LCP), загрузка,
//    «карточки на экране» (главная) и вес страницы, на быстрой сети и на «медленном 4G»
//    с замедленным процессором ×4 (так открывает телефон).
import { запуститьChrome } from './_браузер.mjs';
import { writeFileSync } from 'node:fs';

const SITE = (process.argv[2] || 'https://nochy.by').replace(/\/$/, '');
const ОТЧЁТ = process.argv[3] || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const строки = [];
const вывод = (...а) => { const s = а.join(' '); console.log(s); строки.push(s); };
const медиана = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const мс = x => Math.round(x) + ' мс';
const кб = x => Math.round(x / 1024) + ' КБ';

async function замерСервера(путь, заходов = 4) {
  const р = [];
  let статус = 0, вес = 0, сжатие = '';
  for (let i = 0; i < заходов; i++) {
    const t0 = performance.now();
    try {
      const r = await fetch(SITE + путь, { headers: { 'Accept-Encoding': 'gzip, br', 'User-Agent': 'Mozilla/5.0 speed-check' } });
      const t1 = performance.now();
      const b = await r.arrayBuffer();
      const t2 = performance.now();
      статус = r.status; сжатие = r.headers.get('content-encoding') || '-';
      вес = +(r.headers.get('content-length') || 0) || b.byteLength;
      р.push({ ttfb: t1 - t0, всего: t2 - t0, байт: b.byteLength });
    } catch (e) { р.push({ ttfb: 0, всего: 0, байт: 0, ошибка: e.message }); }
    await sleep(250);
  }
  return { путь, статус, сжатие, первый: р[0], тёплые: р.slice(1), медианаTTFB: медиана(р.slice(1).map(x => x.ttfb)), байт: р[0].байт };
}

console.log('Замеры скорости ' + SITE + ' — ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
строки.push('Замеры скорости ' + SITE + ' — ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC');

if (!process.env.ONLY) {   // ONLY=главная — мерить только браузер на страницах с этими именами (без замеров сервера и API)
// ── сеть без работы сервера ─────────────────────────────────────────
const пинг = await замерСервера('/ping', 6);
вывод('\n=== Чистая сеть до сайта (/ping, без работы сервера) ===');
вывод('  первый байт, медиана: ' + мс(пинг.медианаTTFB) + ' · первый заход: ' + мс(пинг.первый.ttfb));
const сеть = пинг.медианаTTFB;

// ── страницы ───────────────────────────────────────────────────────
const СТРАНИЦЫ = [
  ['главная', '/'], ['что посетить', '/?country=places'], ['город (Минск)', '/minsk'],
  ['город + тип (дома Минской обл.)', '/minsk-obl-kottedzhi'], ['«что посмотреть» Минск', '/chto-posmotret-minsk'],
  ['маршруты', '/m'], ['маршрут из видео', '/m/lida-voronovo'], ['подборка «с детьми»', '/podborka/s-detmi'],
  ['место (Минская ратуша)', '/mesto/910089-minskaya-ratusha'], ['место (Мирский замок)', '/mesto/2416-mirskij-zamok'],
  ['место (дворец, Гомель)', '/mesto/1196'], ['место (новая точка, Радзивилки)', '/mesto/910105'],
  ['дома для корпоратива', '/doma-dlya-korporativa'], ['маршрут по точкам', '/marshrut?p=2416,244'],
];
вывод('\n=== Страницы: сервер (4 захода: 1-й «холодный», остальные тёплые) ===');
вывод('  ' + 'страница'.padEnd(36) + 'холодный'.padStart(10) + 'тёплый'.padStart(9) + 'вес'.padStart(9) + '  сжатие');
const таблицаСтраниц = [];
for (const [имя, путь] of СТРАНИЦЫ) {
  const з = await замерСервера(путь);
  таблицаСтраниц.push({ имя, ...з });
  вывод('  ' + имя.padEnd(36) + (з.первый.ошибка ? ' ОШИБКА' : мс(з.первый.ttfb)).padStart(10) + мс(з.медианаTTFB).padStart(9)
        + кб(з.байт).padStart(9) + '  ' + з.сжатие + (з.статус !== 200 ? ' (код ' + з.статус + ')' : ''));
}

// ── первое открытие случайных мест (страница в кэше сервера ещё не лежит) ─────
{
  let ид = [];
  try { ид = (await (await fetch(SITE + '/api/places?light=1')).json()).items.map(p => p.id); } catch {}
  const мешок = ид.sort(() => Math.random() - 0.5).slice(0, 12);
  const р = [];
  for (const i of мешок) { const з = await замерСервера('/mesto/' + i, 1); if (!з.первый.ошибка) р.push(з.первый.ttfb); }
  вывод('\n=== Первое открытие случайных мест (' + р.length + ' шт.; страницы не в кэше сервера) ===');
  if (р.length) вывод('  лучшее ' + мс(Math.min(...р)) + ' · медиана ' + мс(медиана(р)) + ' · худшее ' + мс(Math.max(...р))
                      + ' · без сети до сервера (медиана − ' + мс(сеть) + ') ≈ ' + мс(Math.max(0, медиана(р) - сеть)));
}

// ── API ───────────────────────────────────────────────────────────
const API = [
  ['поиск: Минск, все площадки', '/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=both'],
  ['поиск: Брест, дома', '/api/search?region=brest&city=&type=cottage&rooms=&guests=&max=&source=both'],
  ['поиск: Гродно, Kufar', '/api/search?region=grodno&city=&type=flat&rooms=&guests=&max=&source=kufar'],
  ['список мест (карта)', '/api/places?light=1'], ['места: рядом с Минском', '/api/places?lat=53.9023&lng=27.5619&r=50'],
  ['жильё рядом с точкой', '/api/places/stay?lat=53.9023&lng=27.5619&r=30'],
  ['одно место', '/api/place?id=2416'], ['отели России (Москва)', '/api/rf/search?city=moskva&sort=price_asc'],
];
вывод('\n=== API ===');
вывод('  ' + 'запрос'.padEnd(36) + 'холодный'.padStart(10) + 'тёплый'.padStart(9) + 'вес'.padStart(9));
for (const [имя, путь] of API) {
  const з = await замерСервера(путь);
  вывод('  ' + имя.padEnd(36) + (з.первый.ошибка ? ' ОШИБКА' : мс(з.первый.ttfb)).padStart(10) + мс(з.медианаTTFB).padStart(9) + кб(з.байт).padStart(9));
}

// ── паузы сервера ─────────────────────────────────────────────────
try {
  const д = await (await fetch(SITE + '/ping?diag=1')).text();
  const паузы = [...д.matchAll(/^\d\d:\d\d:\d\d (\d+) мс/gm)].map(m => +m[1]);
  вывод('\n=== Паузы сервера (цикл событий, окна по 10 с за последние минуты) ===');
  вывод('  ' + д.split('\n').slice(0, 2).join(' · '));
  if (паузы.length) вывод('  окон: ' + паузы.length + ' · медиана ' + медиана(паузы) + ' мс · худшее ' + Math.max(...паузы) + ' мс · дольше 500 мс: ' + паузы.filter(x => x > 500).length);
} catch {}

}

// ── браузер ───────────────────────────────────────────────────────
const PORT = 9581;
const { закрыть } = запуститьChrome(PORT, 'speed');
let ws, id = 0; const pend = new Map(); const ловим = { байт: 0, запросов: 0, чужие: 0, главныйЗапрос: null };
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
const запросы = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent') { запросы.set(m.params.requestId, m.params.request.url); ловим.запросов++; if (!/^https?:\/\/(nochy\.by|localhost|127\.0\.0\.1)/.test(m.params.request.url) && /^https?:/.test(m.params.request.url)) ловим.чужие++; }
  if (m.method === 'Network.loadingFinished') ловим.байт += m.params.encodedDataLength || 0;
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Performance.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
// Сервис-воркер сайта пропускает запросы насквозь, но для замера он мешает: байты через него
// считаются нулём, а эмуляция сети его запросы не замедляет. Обходим его — меряем сеть.
await send('Network.setBypassServiceWorker', { bypass: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__m = { fcp: 0, lcp: 0 };
  try { new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ if(e.name==='first-contentful-paint') window.__m.fcp = e.startTime; }); }).observe({ type:'paint', buffered:true }); } catch(e){}
  try { new PerformanceObserver(function(l){ l.getEntries().forEach(function(e){ window.__m.lcp = e.startTime; }); }).observe({ type:'largest-contentful-paint', buffered:true }); } catch(e){}
` });

async function браузер(имя, путь, мобильный, медленно) {
  await send('Emulation.setDeviceMetricsOverride', мобильный
    ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Network.emulateNetworkConditions', медленно
    ? { offline: false, latency: 150, downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8), uploadThroughput: Math.round(750 * 1024 / 8) }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await send('Emulation.setCPUThrottlingRate', { rate: медленно ? 4 : 1 });
  ловим.байт = 0; ловим.запросов = 0; ловим.чужие = 0; запросы.clear();
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
  const t0 = Date.now();
  await send('Page.navigate', { url: SITE + путь });
  let карточек = null, цель = путь === '/' || путь.startsWith('/?region') ? '#grid .card' : путь.startsWith('/?country=places') ? '#grid .plc, #grid .pl-card, #grid > *' : '';
  let кадры = null;
  for (let i = 0; i < 400; i++) {
    await sleep(100);
    const состояние = await js(`document.readyState`);
    if (цель && карточек === null) { const n = await js(`document.querySelectorAll(${JSON.stringify(цель)}).length`); if (n > 0) карточек = Date.now() - t0; }
    if (состояние === 'complete' && (!цель || карточек !== null)) break;
    if (Date.now() - t0 > 40000) break;
  }
  await sleep(1500);
  const н = JSON.parse(await js(`JSON.stringify((function(){ var n=performance.getEntriesByType('navigation')[0]||{}; return { ttfb:n.responseStart, dcl:n.domContentLoadedEventEnd, load:n.loadEventEnd, fcp:(window.__m||{}).fcp, lcp:(window.__m||{}).lcp }; })())`) || '{}');
  const м = await send('Performance.getMetrics');
  const задача = (м.metrics.find(x => x.name === 'TaskDuration') || {}).value || 0;
  return { имя, путь, мобильный, медленно, ...н, карточек, байт: ловим.байт, запросов: ловим.запросов, чужие: ловим.чужие, задача };
}

const БРАУЗЕР = [['главная', '/'], ['что посетить', '/?country=places'], ['место (ратуша)', '/mesto/910089-minskaya-ratusha'], ['город (Минск)', '/minsk']]
  .filter(([и]) => !process.env.ONLY || process.env.ONLY.split(',').includes(и));
// BLOCK=unpkg.com,mc.yandex.ru — заблокировать эти адреса, чтобы увидеть, сколько они стоят
if (process.env.BLOCK) await send('Network.setBlockedURLs', { urls: process.env.BLOCK.split(',').map(x => '*' + x + '*') });
const результаты = [];
for (const [медленно, мобильный, подпись] of [[false, false, 'КОМПЬЮТЕР, быстрая сеть'], [true, true, 'ТЕЛЕФОН, медленный 4G (1,6 Мбит/с, 150 мс, процессор ×4)']]) {
  вывод('\n=== Браузер: ' + подпись + ' ===');
  вывод('  ' + 'страница'.padEnd(18) + 'байт'.padStart(8) + 'первый кадр'.padStart(13) + 'главный элемент'.padStart(17) + 'карточки'.padStart(10) + 'загрузка'.padStart(10) + 'запросов'.padStart(10) + 'чужих'.padStart(7));
  for (const [имя, путь] of БРАУЗЕР) {
    let р;
    try { р = await браузер(имя, путь, мобильный, медленно); } catch (e) { вывод('  ' + имя.padEnd(18) + ' ОШИБКА ' + e.message); continue; }
    результаты.push(р);
    вывод('  ' + имя.padEnd(18) + кб(р.байт).padStart(8) + (р.fcp ? мс(р.fcp) : '—').padStart(13) + (р.lcp ? мс(р.lcp) : '—').padStart(17)
          + (р.карточек != null ? мс(р.карточек) : '—').padStart(10) + (р.load ? мс(р.load) : '—').padStart(10) + String(р.запросов).padStart(10) + String(р.чужие).padStart(7));
  }
}
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
ws.close(); await закрыть();

if (ОТЧЁТ) { writeFileSync(ОТЧЁТ, строки.join('\n') + '\n', 'utf-8'); console.log('\nОтчёт записан: ' + ОТЧЁТ); }
