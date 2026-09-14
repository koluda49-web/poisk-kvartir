// Шапка главной — про жильё и маршруты.
//
// Зачем. На сайте давно есть маршруты по Беларуси, а заголовок говорил только
// про жильё. Проверяем, что в h1 есть «маршруты по Беларуси», цветом выделено
// по-прежнему «без лишних вкладок», переключение вкладок не возвращает старый
// текст, а на телефоне (375 px) заголовок не вылезает за край экрана.
// И что фон шапки — новый снимок (hero-2.jpg / hero-mob-2.jpg) нужного размера,
// а preload в <head> указывает на те же файлы. Кэш браузера эта проверка не
// ловит (Chrome у неё с чистым профилем): от недельного кэша /фото-точек/
// защищает только новое имя файла при каждой замене снимка.
//
// Сервер должен быть запущен.
//   node проверки/шапка.mjs
//   node проверки/шапка.mjs https://poisk-kvartir.onrender.com
// Снимки шапки (375 и 1200 px) пишутся, если задан префикс пути:
//   SNIMKI=C:/папка/шапка- node проверки/шапка.mjs   → шапка-375.png, шапка-1200.png
import { writeFileSync } from 'node:fs';
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9609, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

const { закрыть } = запуститьChrome(PORT, 'hero', { ловитьОшибки: false });
// Упала проверка — Chrome не должен остаться висеть
process.on('unhandledRejection', async e => { console.log('Ошибка: ' + (e && e.message || e)); await закрыть(); process.exit(1); });

let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
if (!url) { console.log('Не удалось запустить Chrome — проверка пропущена'); await закрыть(); process.exit(0); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 80) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };
// Неразрывный пробел («без&nbsp;лишних») сводим к обычному, чтобы сравнивать текст
const заголовок = () => js(`JSON.stringify({ t: ((document.querySelector('h1')||{}).textContent || '').replace(/\\s+/g, ' ').trim(),
  a: ((document.querySelector('h1 .accent')||{}).textContent || '').replace(/\\s+/g, ' ').trim() })`).then(JSON.parse);
// «без» не остаётся одно в конце строки: оно на той же строке, что «лишних»
const безНеОдно = () => js(`(function(){ var n = document.querySelector('h1 .accent').firstChild, s = n.textContent, r = document.createRange();
  var i = s.indexOf('лишних'); r.setStart(n, 0); r.setEnd(n, 3); var a = r.getClientRects()[0];
  r.setStart(n, i); r.setEnd(n, i + 6); var b = r.getClientRects()[0];
  return !!(a && b) && Math.abs(a.top - b.top) < 4; })()`);

async function открыть(ширина) {
  await send('Emulation.setDeviceMetricsOverride', { width: ширина, height: 900, deviceScaleFactor: 1, mobile: ширина < 700 });
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(300);
  await ждать(`document.readyState === 'complete' && !!document.querySelector('#cbBY')`);
  await sleep(800);
}
// Фон шапки: какой снимок стоит в ::before, какого он размера на самом деле
// и что preload с подходящим media зовёт тот же файл (иначе снимок качается дважды).
// Снимок шапки — костёл с двумя башнями (14.09): широкий 1500×700 — в пропорциях
// самой полосы на 1200 px, узкий 900×860.
const фон = () => js(`(async function(){
  var s = getComputedStyle(document.querySelector('.wrap'), '::before').backgroundImage;
  // без обратной косой черты: шаблонная строка её съела бы
  var к = s.lastIndexOf('url('); if (к < 0) return JSON.stringify({ s: s });
  var u = s.slice(к + 4, s.indexOf(')', к)).split('"').join('');
  var i = new Image(); i.src = u;
  await new Promise(function(r){ i.onload = r; i.onerror = r; });
  var п = [].slice.call(document.querySelectorAll('link[rel=preload][as=image]'))
    .filter(function(l){ return matchMedia(l.media || 'all').matches; })
    .map(function(l){ return decodeURIComponent(new URL(l.href).pathname); });
  return JSON.stringify({ u: decodeURIComponent(u), w: i.naturalWidth, h: i.naturalHeight, preload: п });
})()`).then(JSON.parse);
async function снимок(ширина) {
  if (!process.env.SNIMKI) return;
  const r = JSON.parse(await js(`JSON.stringify((function(){ var b = document.querySelector('.hero-ink').getBoundingClientRect();
    return { x: 0, y: 0, width: innerWidth, height: Math.ceil(b.bottom + scrollY + 16) }; })())`));
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } });
  writeFileSync(process.env.SNIMKI + ширина + '.png', Buffer.from(data, 'base64'));
  console.log('  снимок: ' + process.env.SNIMKI + ширина + '.png');
}

// ── 1200 px: текст и вкладки ──────────────────────────────────────────────
console.log('\n=== заголовок на 1200 px ===');
await открыть(1200);
const h = await заголовок();
check('в h1 есть «маршруты по Беларуси»', /маршруты по Беларуси/.test(h.t), h.t);
check('h1 целиком новый', h.t === 'Жильё на сутки и маршруты по Беларуси, без лишних вкладок', h.t);
check('выделена цветом «без лишних вкладок»', h.a === 'без лишних вкладок', h.a);
check('на 1200 px h1 не шире экрана', await js(`(function(){ var e = document.querySelector('h1');
  return e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth; })()`));
check('на 1200 px «без» не висит одно в конце строки', await безНеОдно());
const ф1200 = await фон();
check('на 1200 px фон шапки — hero-2.jpg 1500×700', String(ф1200.u).endsWith('/фото-точек/hero-2.jpg') && ф1200.w === 1500 && ф1200.h === 700, JSON.stringify(ф1200));
check('на 1200 px preload — тот же hero-2.jpg', ф1200.preload.length === 1 && ф1200.preload[0] === '/фото-точек/hero-2.jpg', JSON.stringify(ф1200.preload));
await снимок(1200);

for (const [кнопка, режим] of [['#cbRU', 'ru'], ['#cbPL', 'places'], ['#cbBY', 'by']]) {
  await js(`document.querySelector('${кнопка}').click(); 1`);
  await sleep(1500);
  const x = await заголовок();
  check('после вкладки ' + режим + ' заголовок новый', /маршруты по Беларуси/.test(x.t) && x.a === 'без лишних вкладок', x.t);
}

// ── 375 px: ничего не вылезает ────────────────────────────────────────────
console.log('\n=== заголовок на 375 px ===');
await открыть(375);
const м = JSON.parse(await js(`JSON.stringify((function(){ var e = document.querySelector('h1'), b = e.getBoundingClientRect();
  return { w: b.width, left: b.left, right: b.right, sw: e.scrollWidth, cw: e.clientWidth, vw: innerWidth,
    fs: getComputedStyle(e).fontSize, t: e.textContent }; })())`));
check('на 375 px в h1 есть «маршруты по Беларуси»', /маршруты по Беларуси/.test(м.t), м.t);
check('на 375 px ширина h1 не больше экрана', м.w <= м.vw && м.left >= 0 && м.right <= м.vw, JSON.stringify(м));
check('на 375 px текст внутри h1 не вылезает', м.sw <= м.cw + 1, JSON.stringify(м));
// Каждое слово целиком помещается в строку — значит, переносы только между словами
check('на 375 px слова не рвутся посередине', await js(`(function(){ var e = document.querySelector('h1'), r = document.createRange(), ok = true;
  var узлы = [], w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); while (w.nextNode()) узлы.push(w.currentNode);
  узлы.forEach(function(n){ var s = n.textContent, re = /[^ ,]+/g, m;
    while ((m = re.exec(s))) { r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); if (r.getClientRects().length > 1) ok = false; } });
  return ok; })()`));
check('на 375 px «без» не висит одно в конце строки', await безНеОдно());
const ф375 = await фон();
check('на 375 px фон шапки — hero-mob-2.jpg 900×860', String(ф375.u).endsWith('/фото-точек/hero-mob-2.jpg') && ф375.w === 900 && ф375.h === 860, JSON.stringify(ф375));
check('на 375 px preload — тот же hero-mob-2.jpg', ф375.preload.length === 1 && ф375.preload[0] === '/фото-точек/hero-mob-2.jpg', JSON.stringify(ф375.preload));
await снимок(375);

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
