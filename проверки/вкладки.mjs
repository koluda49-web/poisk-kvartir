// Проверка переключения вкладок.
//
// Ловит ту ошибку, из-за которой при переходе на «Что посетить» в ленте
// оставались квартиры: ответ поиска жилья приходил уже после того, как
// нарисовались места, и затирал их своими карточками. На быстром ответе это
// незаметно, поэтому проверка идёт через настоящий браузер и переключает
// вкладку в разные моменты загрузки.
//
// Нужен Chrome. Сервер должен быть уже запущен.
//   npm run проверка-вкладок
//   npm run проверка-вкладок https://poisk-kvartir.onrender.com
//
// Чтобы увидеть ошибку своими глазами, запустите сервер с задержкой в
// /api/search — тогда старый код падает на всех четырёх переключениях.

import { spawn } from 'node:child_process';

const PORT = 9351, sleep = ms => new Promise(r => setTimeout(r, ms));
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-race', 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!url) await sleep(500);
}
if (!url) { console.log('Не удалось запустить Chrome — проверка пропущена'); process.exit(0); }

ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  OK   ' + name); }
  else { failed++; console.log('  ПАДАЕТ ' + name + (detail ? ('  — ' + detail) : '')); }
};

// ── жильё → места ─────────────────────────────────────────────────────────
console.log('\n=== переход на «Что посетить» ===');
for (const [name, delay] of [['сразу', 0], ['через 300 мс', 300], ['через 1200 мс', 1200], ['через 3000 мс', 3000]]) {
  await send('Page.navigate', { url: SITE + '/' });
  for (let i = 0; i < 90; i++) { if (await js('!!document.querySelector("#cbPL")')) break; await sleep(300); }
  if (delay) await sleep(delay);
  await js(`document.querySelector('#cbPL').click(); 1`);
  await sleep(9000);
  const r = JSON.parse(await js(`JSON.stringify({mode: window.__mode,
    flats: document.querySelectorAll('#grid .card').length,
    places: document.querySelectorAll('#grid .plc').length})`));
  check('переключение ' + name, r.mode === 'places' && r.flats === 0 && r.places > 0,
        'в ленте мест осталось карточек жилья: ' + r.flats + ', мест: ' + r.places);
}

// ── места → жильё ─────────────────────────────────────────────────────────
console.log('\n=== возврат к жилью ===');
await send('Page.navigate', { url: SITE + '/?country=places' });
for (let i = 0; i < 90; i++) { if (await js('!!document.querySelector("#cbBY")')) break; await sleep(300); }
await sleep(600);
await js(`document.querySelector('#cbBY').click(); 1`);
await sleep(9000);
const back = JSON.parse(await js(`JSON.stringify({mode: window.__mode,
  flats: document.querySelectorAll('#grid .card').length,
  places: document.querySelectorAll('#grid .plc').length})`));
check('в ленте жилья нет точек', back.mode === 'by' && back.places === 0 && back.flats > 0,
      'жилья: ' + back.flats + ', мест: ' + back.places);

// ── открытие по прямой ссылке ─────────────────────────────────────────────
console.log('\n=== прямая ссылка на «Что посетить» ===');
await send('Page.navigate', { url: SITE + '/?country=places&city=%D0%9C%D0%B8%D0%BD%D1%81%D0%BA' });
for (let i = 0; i < 90; i++) { if (await js('document.querySelectorAll("#grid .plc").length > 0')) break; await sleep(500); }
await sleep(6000);
const direct = JSON.parse(await js(`JSON.stringify({mode: window.__mode,
  flats: document.querySelectorAll('#grid .card').length,
  places: document.querySelectorAll('#grid .plc').length,
  stat: (document.querySelector('#stat')||{}).textContent})`));
check('по ссылке сразу открываются места', direct.mode === 'places' && direct.flats === 0 && direct.places > 0,
      'жилья: ' + direct.flats + ', мест: ' + direct.places);
check('сводка про места, а не про квартиры', /Найдено мест/.test(direct.stat || ''), direct.stat);

// ── заглушки под лентой ───────────────────────────
// «Следить за новыми вариантами» относится к жилью, «Предложить точку» —
// к местам. Перепутать их местами легко, а заметить трудно.
console.log('\n=== заглушки под лентой ===');
const boxes = async () => JSON.parse(await js(`JSON.stringify({
  sub: !!(document.querySelector('#subBox') && document.querySelector('#subBox').offsetParent),
  pl:  !!(document.querySelector('#plBox')  && document.querySelector('#plBox').offsetParent)})`));

await send('Page.navigate', { url: SITE + '/' });
for (let i = 0; i < 90; i++) { if (await js("!!document.querySelector('#subBox')")) break; await sleep(300); }
await sleep(2000);
const onFlats = await boxes();
check('во вкладке жилья видна только заглушка уведомлений', onFlats.sub && !onFlats.pl,
      'уведомления: ' + onFlats.sub + ', предложить точку: ' + onFlats.pl);

await js("document.querySelector('#cbPL').click(); 1");
await sleep(5000);
const onPlaces = await boxes();
check('во вкладке мест видна только заглушка «предложить точку»', onPlaces.pl && !onPlaces.sub,
      'уведомления: ' + onPlaces.sub + ', предложить точку: ' + onPlaces.pl);

const after = await js("(function(){ document.querySelector('#plBtn').click();"
  + " return document.querySelector('#plBtn').textContent; })()");
check('кнопка отвечает на нажатие', /Записали/.test(after || ''), 'на кнопке: ' + after);

// ── кнопка «Показать все варианты в области» ────────
// Кнопка обещает все варианты. Если оставить прежние фильтры человека —
// «1 комната», «только Flatbook» — он увидит узкий список и решит, что
// вариантов мало. Блок «жильё рядом» показывает всё подряд, и переход
// с него должен вести туда же.
console.log('\n=== кнопка «показать все варианты» ===');
{
  await send('Page.navigate', { url: SITE + '/?region=minsk-obl&rooms=1&source=flatbook' });
  for (let i = 0; i < 90; i++) { if (await js("!!document.querySelector('#cbPL')")) break; await sleep(300); }
  await sleep(4000);
  await js("document.querySelector('#cbPL').click(); 1");
  await sleep(6000);
  await js('stayNear(0); 1');
  for (let i = 0; i < 60; i++) { if (await js("!!document.querySelector('.allstay')")) break; await sleep(700); }
  const есть = await js("!!document.querySelector('.allstay')");
  check('кнопка появилась', есть, 'без неё проверять нечего');
  if (есть) {
    await js("document.querySelector('.allstay').click(); 1");
    await sleep(9000);
    const r = JSON.parse(await js(`JSON.stringify({
      rooms: document.querySelector('#rooms').value,
      source: document.querySelector('#source').value,
      max: document.querySelector('#max').value,
      preset: !!document.querySelector('.preset.on'),
      url: location.search,
      stat: (document.querySelector('#stat')||{}).textContent})`));
    check('число комнат сброшено', r.rooms === '', 'осталось «' + r.rooms + '»');
    check('источник сброшен на все', r.source === 'both', 'остался «' + r.source + '»');
    check('цена сброшена', r.max === '', 'осталось «' + r.max + '»');
    check('быстрый набор погашен', !r.preset, 'подсвечен набор, который уже не применён');
    check('в адресе нет старых фильтров', !/rooms=|source=/.test(r.url), r.url);
  }
}

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
