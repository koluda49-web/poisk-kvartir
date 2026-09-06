// Слайдер на странице места должен быть ленивым: при открытии в сети только
// первый снимок, остальные подтягиваются, когда до них долистали.
import { spawn } from 'node:child_process';
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9451, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--user-data-dir=' + process.env.TEMP + '/cdp-sl-' + process.pid, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
const снимки = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  // считаем только снимки самой точки: карточки жилья грузят свои,
  // и они к слайдеру отношения не имеют
  if (m.method === 'Network.requestWillBeSent' && /kudin\.by\/media\/.*\.(jpg|jpeg|png|webp)/i.test(m.params.request.url)) снимки.push(m.params.request.url);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 540, height: 960, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

await send('Page.navigate', { url: SITE + '/mesto/244-nesvizhskij-zamok' });
await sleep(6000);
const всего = await js('document.querySelectorAll("#ph .hero").length');
console.log('  снимков в слайдере:', всего, '· загружено браузером:', снимки.length);
check('слайдер собран (' + всего + ' снимков)', всего > 3, 'снимков мало: ' + всего);
check('при открытии загружен один снимок, а не все', снимки.length <= 2,
      'браузер потянул ' + снимки.length + ' — страница тяжёлая');
check('счётчик показывает первый', (await js('document.getElementById("phn").textContent')) === '1/' + всего);

await js('document.querySelector(".ph-r").click(); 1');
await sleep(2500);
check('листание переключает снимок',
      (await js('document.getElementById("phn").textContent')) === '2/' + всего);
check('видим ровно один снимок', (await js('document.querySelectorAll("#ph .hero.on").length')) === 1);
check('после листания снимок подгрузился', снимки.length >= 2,
      'браузер так и не запросил второй кадр');
console.log('  после листания загружено:', снимки.length);

await js('document.querySelector(".ph-l").click(); 1');
await sleep(800);
check('назад тоже работает', (await js('document.getElementById("phn").textContent')) === '1/' + всего);

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
