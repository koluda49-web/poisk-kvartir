// Браузер проверок не шлёт визиты в Яндекс.Метрику живого сайта.
//
// Зачем. Замеры скорости и браузерные проверки по https://nochy.by открывали
// страницы со счётчиком, и в Метрике копились визиты «ПК/смартфон из Минска» —
// это были мы сами. Теперь _браузер.mjs для любого адреса проверки, кроме
// своего (localhost, 127.0.0.1, [::1]), блокирует в Chrome запросы к mc.yandex.ru
// (Network.setBlockedURLs в своей сессии на весь браузер). Проверяем:
//   1) какой адрес считается своим, какой нет, и откуда берётся адрес проверки;
//   2) для чужого адреса блокировка встаёт раньше, чем проверка находит вкладку
//      (проверка ищет её в /json/list, как все браузерные проверки), для своего —
//      её нет;
//   3) с блокировкой запрос к mc.yandex.ru правда не уходит
//      (заблокирован отладчиком) — и во вкладке, которую проверка открыла сама,
//      и во фрейме, — а свой сервер открывается как обычно.
// На живой сайт проверка не ходит: страницу со «счётчиком» отдаёт свой
// маленький сервер, и в Метрику ничего не уходит ни при каком исходе.
//
// Нужен Chrome, сервер сайта не нужен.
//   node проверки/без-метрики.mjs
import { createServer } from 'node:http';
import { запуститьChrome, адресПроверки, свойАдрес } from './_браузер.mjs';

const PORT = 9540 + (process.pid % 100), sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

console.log('\n=== свой адрес и адрес проверки ===');
for (const а of ['http://127.0.0.1:9682', 'http://localhost:8080/', 'http://[::1]:9000/minsk'])
  check(а + ' — свой', свойАдрес(а));
for (const а of ['https://nochy.by', 'https://kvartiry-poisk.onrender.com/minsk', 'http://192.168.1.5:8080', '', 'не адрес'])
  check((а || '(пусто)') + ' — не свой', !свойАдрес(а));
check('адрес проверки — первый аргумент вида http(s)://',
  адресПроверки(['node', 'x.mjs', 'https://nochy.by', 'отчёт.txt']) === 'https://nochy.by'
  && адресПроверки(['node', 'x.mjs', 'отчёт.txt', 'http://127.0.0.1:1']) === 'http://127.0.0.1:1'
  && адресПроверки(['node', 'x.mjs']) === '');

// Страница «со счётчиком» — со своего сервера; сам счётчик не нужен, хватит запроса к mc.yandex.ru
const сервер = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>t</title><p id="p">своя страница</p>');
});
await new Promise(r => сервер.listen(0, '127.0.0.1', r));
const СВОЙ = 'http://127.0.0.1:' + сервер.address().port;

async function браузер(адрес, порт, имя) {
  const б = запуститьChrome(порт, имя, { адрес, ловитьОшибки: false });
  let ws, id = 0; const pend = new Map(); const упали = [];
  const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
  let url;
  for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${порт}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
  if (!url) { await б.закрыть(); throw new Error('Chrome не запустился'); }
  ws = new WebSocket(url);
  await new Promise(r => ws.addEventListener('open', r));
  const запросы = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') запросы.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.loadingFailed') упали.push({ url: запросы.get(m.params.requestId) || '', ошибка: m.params.errorText, причина: m.params.blockedReason || '' });
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  });
  await send('Page.enable'); await send('Network.enable');
  const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  return { б, send, js, упали, закрыть: async () => { try { ws.close(); } catch {} await б.закрыть(); } };
}

console.log('\n=== Chrome для чужого адреса (https://nochy.by) ===');
const ч = await браузер('https://nochy.by', PORT, 'bezmetriki');
try {
  // вкладка уже найдена (как в любой проверке) — значит, блокировка к этому времени стоит
  const встала = await Promise.race([ч.б.безМетрики, sleep(0).then(() => 'ещё нет')]);
  check('блокировка mc.yandex.ru встала раньше, чем нашлась вкладка', встала === true, String(встала));
  await ч.send('Page.navigate', { url: СВОЙ + '/' });
  await sleep(800);
  check('своя страница открывается', (await ч.js(`(document.getElementById('p')||{}).textContent`)) === 'своя страница');
  // Тот же запрос, что делает счётчик (tag.js), и маяк визита (watch)
  const итог = await ч.js(`Promise.all(['https://mc.yandex.ru/metrika/tag.js', 'https://mc.yandex.ru/watch/112722670']
    .map(function(u){ return fetch(u, { mode: 'no-cors' }).then(function(){ return 'ушёл'; }, function(){ return 'не ушёл'; }); }))`);
  await sleep(500);
  check('запросы к mc.yandex.ru не уходят', Array.isArray(итог) && итог.every(x => x === 'не ушёл'), JSON.stringify(итог));
  const яндекс = ч.упали.filter(x => /mc\.yandex\.ru/.test(x.url));
  // в чужой сессии отладки Chrome пишет не текст ошибки, а причину: заблокировано отладчиком
  check('…потому что заблокированы отладчиком (blockedReason inspector), а не по другой причине',
    яндекс.length >= 2 && яндекс.every(x => x.причина === 'inspector'), JSON.stringify(яндекс));
  // Новая вкладка, открытая самой проверкой, и фрейм в ней — тоже без Метрики
  const { targetId } = await ч.send('Target.createTarget', { url: СВОЙ + '/' });
  await sleep(800);
  const вторая = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(t => t.id === targetId);
  const ws2 = new WebSocket(вторая.webSocketDebuggerUrl);
  await new Promise(r => ws2.addEventListener('open', r));
  let n2 = 0; const ждут2 = new Map();
  ws2.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && ждут2.has(m.id)) { ждут2.get(m.id)(m.result); ждут2.delete(m.id); } });
  const js2 = e => new Promise(r => { const n = ++n2; ждут2.set(n, r); ws2.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true } })); })
    .then(р => р && р.result && р.result.value);
  const вНовой = await js2(`fetch('https://mc.yandex.ru/metrika/tag.js', { mode: 'no-cors' }).then(function(){ return 'ушёл'; }, function(){ return 'не ушёл'; })`);
  check('во вкладке, открытой проверкой, запрос к mc.yandex.ru тоже не уходит', вНовой === 'не ушёл', String(вНовой));
  const воФрейме = await js2(`new Promise(function(r){ var f = document.createElement('iframe'); f.src = '/'; f.onload = function(){
      f.contentWindow.fetch('https://mc.yandex.ru/watch/112722670', { mode: 'no-cors' }).then(function(){ r('ушёл'); }, function(){ r('не ушёл'); }); };
    document.body.appendChild(f); })`);
  check('…и во фрейме', воФрейме === 'не ушёл', String(воФрейме));
  ws2.close();
} finally { await ч.закрыть(); }

console.log('\n=== Chrome для своего адреса ===');
const с = await браузер(СВОЙ, PORT + 1, 'smetrikoj');
try {
  check('блокировки нет (свой сервер — с METRIKA_OFF=1, а счётчик смотрят метрика.mjs и метка-из-тиктока.mjs)',
    (await с.б.безМетрики) === null && с.б.chrome.spawnargs.includes('about:blank'));
  await с.send('Page.navigate', { url: СВОЙ + '/' });
  await sleep(800);
  check('своя страница открывается', (await с.js(`(document.getElementById('p')||{}).textContent`)) === 'своя страница');
} finally { await с.закрыть(); }
сервер.close();

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
