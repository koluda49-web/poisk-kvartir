// «Описание ▾» в карточке жилья у всех пяти площадок Беларуси: /api/desc и раскрытие в браузере.
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9636, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

// ── API ──
// Выдача с усадьбами и квартирами: в Гродненской области есть все пять площадок.
let выдача = [];
for (let i = 0; i < 40; i++) {
  выдача = (await getJSON(SITE + '/api/search?region=grodno&city=&type=any&rooms=&guests=&max=&source=both')).items || [];
  // Check-in и Kvartirka — доски в памяти, собираются через минуту-две после запуска сервера
  if (выдача.some(x => x.src === 'CheckIn') && выдача.some(x => x.src === 'Kvartirka')) break;
  await sleep(10000);
}
const запрос = x => '/api/desc?' + new URLSearchParams(x.src === 'Kufar' ? { src: x.src, id: x.descId } : { src: x.src, url: x.link });
for (const src of ['Kufar', 'Realt', 'Flatbook', 'CheckIn', 'Kvartirka']) {
  const первые = выдача.filter(x => x.src === src).slice(0, 5);
  if (!первые.length) { check(src + ': есть в выдаче', false, 'нет объявлений'); continue; }
  let текст = '', откуда = '';
  for (const x of первые) {
    const r = await getJSON(SITE + запрос(x));
    if (r.text && r.text.length > 10) { текст = r.text; откуда = x.link; break; }
  }
  check(src + ': /api/desc отдаёт текст описания', !!текст, первые.map(x => x.link).join(' '));
  if (текст) {
    console.log('       ' + откуда + ' → ' + текст.slice(0, 90));
    check(src + ': без разметки и HTML-сущностей', !/<[a-z\/][^>]*>|&(nbsp|quot|amp|lt|gt|#\d+);/i.test(текст), текст.slice(0, 120));
  }
}
const чужие = [
  ['Flatbook', 'https://example.com/kvartira/'], ['Flatbook', 'https://flatbook.by.example.com/x/'], ['Flatbook', 'http://flatbook.by/kvartira-yl-chkalova-29/'],
  ['CheckIn', 'https://example.com/?check-in.by'], ['CheckIn', 'https://evilcheck-in.by/kvartira/x'],
  ['Kvartirka', 'https://127.0.0.1:8241/'], ['Kvartirka', 'https://kvartirka.by@example.com/'], ['Realt', 'https://example.com/realt.by'],
  ['Flatbook', ''], ['Нечто', 'https://flatbook.by/'],
];
for (const [src, u] of чужие) {
  const r = await getJSON(SITE + '/api/desc?' + new URLSearchParams({ src, url: u }));
  check('чужая ссылка → пустой текст (' + src + ' ' + (u || 'пусто') + ')', r.text === '', JSON.stringify(r).slice(0, 100));
}

// не страница объявления — пустой текст сразу, без похода на площадку
for (const [src, u] of [['Flatbook', 'https://flatbook.by/?n=1'], ['Flatbook', 'https://flatbook.by/'], ['CheckIn', 'https://check-in.by/search?city=grodno'],
                        ['Kvartirka', 'https://kvartirka.by/lida/kvartiry/posutochno/'], ['CheckIn', 'https://check-in.by//example.com/kvartira/x']]) {
  const t0 = Date.now();
  const r = await getJSON(SITE + '/api/desc?' + new URLSearchParams({ src, url: u }));
  check('не объявление → пустой текст быстро (' + src + ' ' + u + ')', r.text === '' && Date.now() - t0 < 500, (Date.now() - t0) + ' мс ' + JSON.stringify(r).slice(0, 80));
}
// запрос и якорь отбрасываются: это то же объявление и та же запись кэша
const fb = выдача.filter(x => x.src === 'Flatbook').slice(0, 5);
let образец = null;
for (const x of fb) { const r = await getJSON(SITE + '/api/desc?' + new URLSearchParams({ src: 'Flatbook', url: x.link })); if (r.text) { образец = { x, text: r.text }; break; } }
if (образец) {
  const t0 = Date.now(); let все = true;
  for (let n = 1; n <= 40; n++) {
    const r = await getJSON(SITE + '/api/desc?' + new URLSearchParams({ src: 'Flatbook', url: образец.x.link + '?n=' + n + '#h' + n }));
    if (r.text !== образец.text) все = false;
  }
  check('ссылка с ?n=…#… даёт тот же текст из кэша (40 вариантов быстро)', все && Date.now() - t0 < 3000, (Date.now() - t0) + ' мс');
} else check('нашёлся Flatbook с описанием для проверки кэша', false);

// ── браузер ──
const { закрыть } = запуститьChrome(PORT, 'desc');
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
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 80) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };

await send('Page.navigate', { url: SITE + '/?region=grodno&type=any' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
await sleep(1500);
const первые = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#grid .card')].slice(0, 8).map(function(c){
  var t = c.querySelector('.desc-t'); return { src: (c.querySelector('.tag') || {}).className, t: t ? t.textContent : '' }; }))`));
check('у первых восьми карточек есть «Описание ▾»', первые.length === 8 && первые.every(к => к.t === 'Описание ▾'), JSON.stringify(первые));
console.log('       площадки сверху: ' + первые.map(к => к.src.replace('tag ', '')).join(', '));
check('среди первых карточек есть Flatbook, Check-in или Kvartirka', первые.some(к => /Flatbook|CheckIn|Kvartirka/.test(к.src)));

// раскрываем по очереди, пока не встретится настоящее описание
let раскрыто = false, настоящее = false;
for (let i = 0; i < 5 && !настоящее; i++) {
  if (!await js(`(function(){ var c = document.querySelectorAll('#grid .card')[${i}]; return !!(c && c.querySelector('.desc-t')); })()`)) break;
  await js(`document.querySelectorAll('#grid .card')[${i}].querySelector('.desc-t').click(); 1`);
  const готово = await ждать(`(function(){ var c = document.querySelectorAll('#grid .card')[${i}], d = c.querySelector('.desc');
    return d.style.display === 'block' && d.textContent && d.textContent !== 'Загружаю…'; })()`, 120);
  const с = JSON.parse(await js(`(function(){ var c = document.querySelectorAll('#grid .card')[${i}];
    return JSON.stringify({ t: c.querySelector('.desc-t').textContent, d: c.querySelector('.desc').textContent }); })()`));
  if (i === 0) { раскрыто = готово && с.t === 'Описание ▲'; }
  настоящее = готово && с.d.length > 10 && !/^Описание не указано|^Не удалось/.test(с.d);
  if (настоящее) console.log('       карточка ' + (i + 1) + ': ' + с.d.slice(0, 80));
}
check('по нажатию блок раскрывается и кнопка становится «Описание ▲»', раскрыто);
check('хотя бы у одной из первых пяти карточек появился текст описания', настоящее);
if (раскрыто) await js(`document.querySelectorAll('#grid .card')[0].querySelector('.desc-t').click(); 1`);
check('повторное нажатие сворачивает', раскрыто && await js(`(function(){ var c = document.querySelectorAll('#grid .card')[0];
  return c.querySelector('.desc').style.display === 'none' && c.querySelector('.desc-t').textContent === 'Описание ▾'; })()`));

check('строки «Рядом:» в карточках нет', await js(`!document.querySelector('#grid .nb') && !/Рядом:/.test(document.getElementById('grid').textContent)`));
check('ссылка «Маршрут по местам рядом» есть', await ждать(`[...document.querySelectorAll('#grid a')].some(function(a){ return /Маршрут по местам рядом/.test(a.textContent); })`, 20));
check('на 400 px без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));

// ── избранное: описание берётся у объявления из избранного, а не из выдачи ──
const избр = ['Kvartirka', 'Flatbook'].map(s => выдача.find(x => x.src === s)).filter(Boolean);
await js(`localStorage.setItem('pk_favs', ${JSON.stringify(JSON.stringify(избр))}); 1`);
await send('Page.navigate', { url: SITE + '/?region=grodno&type=any' });
await ждать(`typeof setView === 'function' && FAVS.length === ${избр.length} && (window.__items||[]).length > 0`, 240);
await js(`window.__descUrls = []; var f0 = window.fetch; window.fetch = function(u){ if(/\\/api\\/desc/.test(String(u))) window.__descUrls.push(String(u)); return f0.apply(this, arguments); };
  setView('fav'); 1`);
await ждать(`document.querySelectorAll('#grid .card .desc-t').length === ${избр.length}`, 20);
await js(`document.querySelectorAll('#grid .card')[1].querySelector('.desc-t').click(); 1`);
await ждать(`window.__descUrls.length > 0`, 40);
const ушло = await js(`window.__descUrls[0] || ''`);
check('в избранном запрос описания — по второму объявлению избранного', избр.length === 2 && new URLSearchParams(ушло.split('?')[1] || '').get('url') === избр[1].link, ушло);
await ждать(`(function(){ var d = document.querySelectorAll('#grid .card')[1].querySelector('.desc'); return d.textContent && d.textContent !== 'Загружаю…'; })()`, 120);
await js(`localStorage.clear(); 1`);

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
