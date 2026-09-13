// «Поделиться» и «Сохранить картинкой» на странице маршрута.
//
// Зачем. На /m/<slug> и /marshrut приходят из ТикТока с телефона, и маршрут
// хочется переслать спутникам или сохранить в галерею. Во встроенных
// браузерах системного «Поделиться» часто нет — тогда должно открыться своё
// меню со ссылками в мессенджеры, в которых зашит адрес именно этой страницы.
// Картинка обязана собираться всегда: и когда подложка карты не пришла
// (плитки недоступны или висят), и когда дорога ещё не посчитана.
//
// Сервер должен быть запущен; для подложки нужен доступ к tile.openstreetmap.org.
//   node проверки/поделиться-и-картинка.mjs
//   node проверки/поделиться-и-картинка.mjs http://127.0.0.1:8095 [файл.png]
// Вторым аргументом можно дать путь — туда сохранится картинка /m/lida-voronovo.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import http from 'node:http';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const ОБРАЗЕЦ = process.argv[3] || '';
const PORT = 9603, sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// сервер плиток, который принимает запрос и молчит: подложка «висит»
const висящие = [];
const молчун = http.createServer((req, res) => { висящие.push(res); });
await new Promise(r => молчун.listen(0, '127.0.0.1', r));
const МОЛЧУН = 'http://127.0.0.1:' + молчун.address().port + '/{z}/{x}/{y}.png';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-share-' + process.pid,
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
// телефон: так страницу откроют из ТикТока
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const js = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const ждать = async (усл, раз = 40) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };

// размеры и сведения о картинке — прямо в странице
const СОБРАТЬ = `(async function(){
  var t0 = Date.now(), blob = await window.собратьКартинку(), мс = Date.now() - t0;
  var bm = await createImageBitmap(blob);
  return JSON.stringify({ type: blob.type, size: blob.size, w: bm.width, h: bm.height, мс: мс, п: window.__последняяКартинка });
})()`;

await send('Page.navigate', { url: SITE + '/marshrut' });
await sleep(800);
await js(`localStorage.clear(); 1`);

// ── /marshrut?p=5069,286: своё меню, когда системного «Поделиться» нет ──
await send('Page.navigate', { url: SITE + '/marshrut?p=5069,286' });
check('страница с двумя точками открылась', await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 2`));
check('кнопки «Поделиться» и «Сохранить картинкой» есть и видны',
  await js(`(function(){ var a = document.getElementById('rShare'), b = document.getElementById('rPng');
    return !!a && !!b && a.offsetParent !== null && b.offsetParent !== null && a.textContent === 'Поделиться' && b.textContent === 'Сохранить картинкой'
      && a.classList.contains('go2') && b.classList.contains('go2'); })()`));
check('на телефоне кнопки во всю ширину, как «Открыть в Яндекс.Картах»',
  await js(`(function(){ var g = document.getElementById('rGo').getBoundingClientRect(), a = document.getElementById('rShare').getBoundingClientRect(), b = document.getElementById('rPng').getBoundingClientRect();
    return Math.abs(g.width - a.width) < 2 && Math.abs(g.width - b.width) < 2 && a.top > g.top && b.top > a.top; })()`));

await js(`(function(){
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: function(t){ window.__буфер = t; return Promise.resolve(); } }, configurable: true });
})(); 1`);
await js(`document.getElementById('rShare').click(); 1`);
check('без navigator.share открывается меню', await js(`!document.getElementById('rShareMenu').hidden && document.getElementById('rShareMenu').offsetParent !== null`));
const адрес = await js(`location.href`);
const закод = encodeURIComponent(адрес);
const ссылки = JSON.parse(await js(`JSON.stringify(['rTg','rVb','rWa'].map(function(id){ var a = document.getElementById(id); return { href: a.getAttribute('href'), target: a.target, rel: a.rel }; }))`));
check('Telegram: t.me/share/url с закодированным адресом и текстом', ссылки[0].href === 'https://t.me/share/url?url=' + закод + '&text=' + encodeURIComponent('Маршрут на день: 2 точки'), ссылки[0].href);
check('Viber: viber://forward с закодированным адресом', ссылки[1].href === 'viber://forward?text=' + encodeURIComponent('Маршрут на день: 2 точки') + '%20' + закод, ссылки[1].href);
check('WhatsApp: wa.me с закодированным адресом', ссылки[2].href === 'https://wa.me/?text=' + encodeURIComponent('Маршрут на день: 2 точки') + '%20' + закод, ссылки[2].href);
check('ссылки открываются в новой вкладке, rel=noopener', ссылки.every(s => s.target === '_blank' && s.rel === 'noopener'));

await js(`document.querySelector('h1').click(); 1`);
check('клик мимо меню закрывает его', await js(`document.getElementById('rShareMenu').hidden`));
await js(`document.getElementById('rShare').click(); 1`);
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);
check('Escape закрывает меню', await js(`document.getElementById('rShareMenu').hidden`));

await js(`document.getElementById('rShare').click(); 1`);
await js(`document.getElementById('rCopy').click(); 1`);
await sleep(150);
check('«Скопировать ссылку» кладёт в буфер адрес страницы', (await js(`window.__буфер`)) === адрес, await js(`String(window.__буфер)`));
check('после копирования — «✓ Ссылка скопирована», меню закрыто', await js(`document.getElementById('rShare').textContent === '✓ Ссылка скопирована' && document.getElementById('rShareMenu').hidden`));
await sleep(1800);
check('через 1,6 с надпись снова «Поделиться»', (await js(`document.getElementById('rShare').textContent`)) === 'Поделиться');

// буфер не дали — ссылка появляется выделенной в поле
await js(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: function(){ return Promise.reject(new Error('нельзя')); } }, configurable: true });
  document.execCommand = function(){ return false; }; 1`);
await js(`document.getElementById('rShare').click(); 1`);
await js(`document.getElementById('rCopy').click(); 1`);
await sleep(150);
check('при отказе буфера — поле с выделенной ссылкой',
  await js(`(function(){ var f = document.getElementById('rCopyField'); return !f.hidden && f.value === location.href && f.selectionStart === 0 && f.selectionEnd === f.value.length && !document.getElementById('rShareMenu').hidden; })()`));
await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1`);

// ── системное «Поделиться» есть ──────────────────────────────────────────
await js(`Object.defineProperty(navigator, 'share', { value: function(d){ window.__поделились = d; return Promise.resolve(); }, configurable: true, writable: true }); 1`);
await js(`document.getElementById('rShare').click(); 1`);
await sleep(100);
const поделились = JSON.parse(await js(`JSON.stringify(window.__поделились || null)`));
check('navigator.share вызван с url === location.href', !!поделились && поделились.url === адрес, JSON.stringify(поделились));
check('…и с текстом «Маршрут на день: 2 точки» и заголовком', !!поделились && поделились.text === 'Маршрут на день: 2 точки' && /^Маршрут на день/.test(поделились.title || ''), JSON.stringify(поделились));
check('своё меню при этом не открывается', await js(`document.getElementById('rShareMenu').hidden`));

// ── картинка с подложкой ─────────────────────────────────────────────────
await ждать(`!!ДОРОГА && ДОРОГА.к === ключДороги()`, 80);
let к = JSON.parse(await js(СОБРАТЬ));
check('собратьКартинку() → image/png', к.type === 'image/png', к.type);
check('картинка больше 40 КБ', к.size > 40 * 1024, Math.round(к.size / 1024) + ' КБ');
check('картинка 1080×1920', к.w === 1080 && к.h === 1920, к.w + '×' + к.h);
check('подложка карты пришла', к.п && к.п.пришло > 0, JSON.stringify(к.п));
check('в списке на картинке 2 строки', к.п && к.п.строки.length === 2, JSON.stringify(к.п && к.п.строки));

// ── плитки недоступны: несуществующий порт ───────────────────────────────
await js(`window.__плиткиАдрес = 'http://127.0.0.1:9/{z}/{x}/{y}.png'; 1`);
к = JSON.parse(await js(СОБРАТЬ));
check('без плиток картинка всё равно 1080×1920 png', к.type === 'image/png' && к.w === 1080 && к.h === 1920, JSON.stringify(к).slice(0, 120));
check('без плиток — не дольше 9 с', к.мс <= 9000, к.мс + ' мс');
check('без плиток подложка не нарисована', к.п && к.п.пришло === 0, JSON.stringify(к.п));

// ── плитки висят: ждём не дольше 6 с ─────────────────────────────────────
await js(`window.__плиткиАдрес = ${JSON.stringify(МОЛЧУН)}; 1`);
к = JSON.parse(await js(СОБРАТЬ));
check('при висящих плитках картинка собирается не дольше 9 с', к.type === 'image/png' && к.мс <= 9000 && к.мс >= 5000, к.мс + ' мс');
висящие.splice(0).forEach(r => { try { r.destroy(); } catch {} });
await js(`window.__плиткиАдрес = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'; 1`);

// ── кнопка «Сохранить картинкой» ─────────────────────────────────────────
await js(`(function(){
  window.__отдали = null;
  Object.defineProperty(navigator, 'canShare', { value: function(d){ return !!(d && d.files && d.files.length); }, configurable: true, writable: true });
  Object.defineProperty(navigator, 'share', { value: function(d){ window.__отдали = { n: d.files.length, name: d.files[0].name, type: d.files[0].type, url: d.url || null }; return Promise.resolve(); }, configurable: true, writable: true });
})(); 1`);
await js(`document.getElementById('rPng').click(); 1`);
check('пока собирается — «Собираю…»', (await js(`document.getElementById('rPng').textContent`)) === 'Собираю…');
await ждать(`!!window.__отдали`, 60);
const отдали = JSON.parse(await js(`JSON.stringify(window.__отдали)`));
check('где можно делиться файлами — navigator.share({files}) с маршрут.png', !!отдали && отдали.n === 1 && отдали.name === 'маршрут.png' && отдали.type === 'image/png', JSON.stringify(отдали));
await ждать(`document.getElementById('rPng').textContent === 'Сохранить картинкой'`, 20);
check('после — снова «Сохранить картинкой»', (await js(`document.getElementById('rPng').textContent`)) === 'Сохранить картинкой');

await js(`(function(){
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true, writable: true });
  window.__скачали = null;
  HTMLAnchorElement.prototype.click = function(){ if (this.download) window.__скачали = { download: this.download, href: this.href }; };
})(); 1`);
await js(`document.getElementById('rPng').click(); 1`);
await ждать(`!!window.__скачали`, 60);
const скачали = JSON.parse(await js(`JSON.stringify(window.__скачали)`));
check('иначе — скачивание маршрут.png через <a download>', !!скачали && скачали.download === 'маршрут.png' && /^blob:/.test(скачали.href), JSON.stringify(скачали));

// ── /m/lida-voronovo: 7 строк на картинке ────────────────────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 7`);
await ждать(`!!ДОРОГА && ДОРОГА.к === ключДороги()`, 80);
к = JSON.parse(await js(СОБРАТЬ));
check('/m/lida-voronovo: в картинке-списке 7 строк', к.п && к.п.строки.length === 7, JSON.stringify(к.п && к.п.строки));
check('/m/lida-voronovo: строки «номер · название · адрес»', к.п && к.п.строки.every((s, i) => s.indexOf((i + 1) + ' · ') === 0), JSON.stringify(к.п && к.п.строки));
check('/m/lida-voronovo: 1080×1920, линия по дорогам', к.w === 1080 && к.h === 1920 && к.п.поДорогам, JSON.stringify(к.п).slice(0, 200));
check('/m/lida-voronovo: текст для «Поделиться» — «Маршрут на день: 7 точек»', (await js(`текстМаршрута()`)) === 'Маршрут на день: 7 точек');
if (ОБРАЗЕЦ) {
  const b64 = await js(`(async function(){ var b = await window.собратьКартинку(); return await new Promise(function(r){ var f = new FileReader(); f.onload = function(){ r(String(f.result).split(',')[1]); }; f.readAsDataURL(b); }); })()`);
  writeFileSync(ОБРАЗЕЦ, Buffer.from(b64, 'base64'));
  console.log('  образец сохранён: ' + ОБРАЗЕЦ);
}

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill(); молчун.close();
process.exit(failed ? 1 : 0);
