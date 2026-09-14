// «Предложить место» и страница проверки.
//
// Зачем. Новые места должны появляться на сайте без разработчика: посетитель
// предлагает, владелец одобряет на закрытой странице — и место уже в поиске
// и со своей страницей. Проверяем форму на главной (ошибки, мини-карта,
// письмо, ловушка для роботов, рамка Беларуси), страницу /predlozheniya
// (ключ, «Добавить на сайт», «Отклонить», «Убрать с сайта»), ограничение
// «пять в час с адреса» и то, что всё это переживает перезапуск: одобренное
// уходит в GitHub, а новый экземпляр берёт места оттуда и сливает
// предложения, пришедшие до загрузки.
//
// Свой сервер поднимается сам (порт 8096, временная папка данных, источники
// жилья выключены, подделка GitHub на 9626) — рабочий на 8080 не трогается.
//   node проверки/предложить-место.mjs
// Снимки для отчёта (форма на телефоне, страница проверки):
//   SNIMKI=<папка> node проверки/предложить-место.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { запуститьChrome, временнаяПапка, удалитьПапку } from './_браузер.mjs';

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'http://127.0.0.1:8096', PORT = 9606, МОК_ПОРТ = 9626, КЛЮЧ = 'poisk2026';
const СНИМКИ = process.env.SNIMKI || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const дождаться = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 150) { try { if (await fn()) return true; } catch {} await sleep(150); } return false; };

// ── подделка GitHub: хранит файлы, помнит запросы ───────────────────────
const запросы = [];
const путьК = имя => '/repos/koluda49-web/poisk-kvartir/contents/' + encodeURIComponent('данные') + '/' + encodeURIComponent(имя + '.json');
let ФАЙЛЫ = new Map();     // путь → { sha, текст }
let ВОРОТА = new Map();    // путь → Promise: ответ на GET ждёт, пока не откроют
let номерSha = 0;
const мок = http.createServer((req, res) => {
  let тело = '';
  req.on('data', c => тело += c);
  req.on('end', async () => {
    запросы.push({ method: req.method, url: req.url, тело });
    const путь = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (ВОРОТА.has(путь)) await ВОРОТА.get(путь);
      const ф = ФАЙЛЫ.get(путь);
      if (!ф) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sha: ф.sha, encoding: 'base64', content: Buffer.from(ф.текст).toString('base64') }));
    } else if (req.method === 'PUT') {
      let д = {};
      try { д = JSON.parse(тело); } catch {}
      const sha = 'm' + (++номерSha);
      ФАЙЛЫ.set(путь, { sha, текст: Buffer.from(д.content || '', 'base64').toString('utf8') });
      res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ content: { sha } }));
    } else { res.writeHead(405); res.end(); }
  });
});
await new Promise(r => мок.listen(МОК_ПОРТ, '127.0.0.1', r));
const последнийPUT = имя => {
  const п = запросы.filter(q => q.method === 'PUT' && q.url.split('?')[0] === путьК(имя)).pop();
  if (!п) return null;
  try { return JSON.parse(Buffer.from(JSON.parse(п.тело).content, 'base64').toString('utf8')); } catch { return null; }
};

// ── свой экземпляр сервера ───────────────────────────────────────────────
const папки = [];
let сервер = null, браузер = null;   // браузер — { chrome, закрыть } из _браузер.mjs
function запуститьСервер(папка) {
  const лог = [];
  const п = spawn(process.execPath, ['kvartiry-server.js'], {
    cwd: КОРЕНЬ,
    env: { ...process.env, PORT: '8096', DATA_DIR: папка, STATS_FILE: path.join(папка, 'stats.json'), STATS_KEY: КЛЮЧ,
           GH_TOKEN: 'test', GH_API: 'http://127.0.0.1:' + МОК_ПОРТ, GH_SYNC_MS: '500', RENDER_EXTERNAL_URL: '',
           KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  п.stdout.on('data', d => лог.push(String(d)));
  п.stderr.on('data', d => лог.push(String(d)));
  п.лог = лог;
  return п;
}
async function остановитьСервер(п) {
  if (!п) return;
  try { if (п.exitCode === null) п.kill(); } catch {}   // kill() бьёт ровно по child.pid
  await new Promise(r => { if (п.exitCode !== null) r(); else { п.once('exit', r); setTimeout(r, 3000); } });
}
async function ждатьПинг() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(SITE + '/ping', { signal: AbortSignal.timeout(2000) })).ok) return true; } catch {}
    await sleep(500);
  }
  return false;
}
let завершаемся = false;
async function завершить(код) {
  if (завершаемся) return;
  завершаемся = true;
  if (браузер) await браузер.закрыть();
  await остановитьСервер(сервер);
  try { мок.closeAllConnections(); } catch {}
  await new Promise(r => мок.close(r));
  for (const п of папки) удалитьПапку(п);
  process.exit(код);
}
// Что бы ни случилось — свой Chrome и свой сервер гасим (только их, по pid).
process.on('unhandledRejection', e => { console.log('Необработанный отказ:', e && e.message); failed++; завершить(1); });
process.on('uncaughtException', e => { console.log('Непойманная ошибка:', e && e.message); failed++; завершить(1); });

const папка1 = временнаяПапка('предложения-проверка-');
папки.push(папка1);
сервер = запуститьСервер(папка1);
const поднялся = await ждатьПинг();
check('сервер на 8096 отвечает', поднялся, сервер.лог.join('').slice(-300));
if (!поднялся) await завершить(1);
// Одобрять можно только после сверки с GitHub — ждём, пока сервер спросит оба файла.
await дождаться(() => ['предложения', 'места-от-людей'].every(и => запросы.some(q => q.method === 'GET' && q.url.split('?')[0] === путьК(и))));
await sleep(300);

// ── браузер ──────────────────────────────────────────────────────────────
браузер = запуститьChrome(PORT, 'suggest', { ловитьОшибки: false });
let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
let диалогов = 0;
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') ошибки.push((m.params.args || []).map(a => a.value || a.description).join(' '));
  if (m.method === 'Page.javascriptDialogOpening') { диалогов++; send('Page.handleJavaScriptDialog', { accept: true }); }
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const снимок = async (имя, селектор) => {
  if (!СНИМКИ) return;
  const r = JSON.parse(await js(`JSON.stringify((function(){ var b = document.querySelector(${JSON.stringify(селектор)}).getBoundingClientRect(); return {x:b.left+scrollX, y:b.top+scrollY, w:b.width, h:b.height}; })())`));
  const пад = 12;
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: Math.max(0, r.x - пад), y: Math.max(0, r.y - пад), width: r.w + 2 * пад, height: r.h + 2 * пад, scale: 1 } });
  fs.writeFileSync(path.join(СНИМКИ, имя), Buffer.from(data, 'base64'));
};
const предложения = () => { try { return JSON.parse(fs.readFileSync(path.join(папка1, 'предложения.json'), 'utf8')); } catch { return []; } };
const найти = async q => (await (await fetch(SITE + '/api/places?q=' + encodeURIComponent(q))).json()).items || [];

try {
  // ── форма на главной (телефон) ─────────────────────────────────────────
  console.log('\n=== форма ===');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: SITE + '/?country=places' });
  await дождаться(() => js(`!!document.getElementById('plBox') && document.getElementById('plBox').offsetParent !== null`), 30000);
  check('во вкладке мест виден блок «Знаете место…»', await js(`document.getElementById('plBox').offsetParent !== null`));
  check('форма сначала закрыта', await js(`document.getElementById('plForm').offsetParent === null`));
  await js(`document.getElementById('plBtn').click(); 1`);
  await sleep(600);
  check('«Предложить точку» открывает форму', await js(`document.getElementById('plForm').offsetParent !== null && !!window.__plMap`));
  check('в форме все поля', await js(`['plName','plText','plMap','plCoord','plContact','plSite','plSend'].every(function(i){ return !!document.getElementById(i); })`));
  check('ловушка site не видна человеку', await js(`(function(e){ var r = e.getBoundingClientRect(); return r.right < 0 || r.width <= 1; })(document.getElementById('plSite'))`));

  // FormSubmit не зовём по-настоящему: подменяем fetch для его адреса
  await js(`window.__письма = []; (function(f){ window.fetch = function(u, o){
    if(String(u).indexOf('formsubmit.co') >= 0){ window.__письма.push({ url: String(u), body: o && o.body }); return Promise.resolve(new Response('{"success":"true"}', { headers: { 'Content-Type': 'application/json' } })); }
    return f.apply(this, arguments); }; })(window.fetch); 1`);

  await js(`document.getElementById('plText').value = 'Большой валун у лесной дороги, рядом родник.'; document.getElementById('plSend').click(); 1`);
  await sleep(300);
  check('без названия — ошибка под формой', await js(`(function(s){ return s.classList.contains('err') && /название/i.test(s.textContent); })(document.getElementById('plStatus'))`), await js(`document.getElementById('plStatus').textContent`));

  await js(`window.__plMap.fire('click', { latlng: L.latLng(53.997489, 25.385834) }); 1`);
  await sleep(200);
  check('нажатие на мини-карту заполняет координаты', (await js(`document.getElementById('plCoord').value`)) === '53.99749, 25.38583', await js(`document.getElementById('plCoord').value`));
  check('на мини-карте метка', await js(`!!window.__plPin && window.__plMap.hasLayer(window.__plPin)`));
  await js(`var c = document.getElementById('plCoord'); c.value = '53,762080 24,826755'; c.dispatchEvent(new Event('input')); 1`);
  check('координаты с запятой двигают метку', await js(`(function(p){ return Math.abs(p.lat - 53.76208) < 1e-6 && Math.abs(p.lng - 24.826755) < 1e-6; })(window.__plPin.getLatLng())`));
  // та же точка вписанными координатами: карта встаёт на неё
  await js(`var c = document.getElementById('plCoord'); c.value = '53.99749, 25.38583'; c.dispatchEvent(new Event('input', { bubbles: true })); 1`);
  check('вписанные координаты ставят метку и карту на точку', await js(`(function(p, m){ return Math.abs(p.lat - 53.99749) < 1e-6 && m.getBounds().contains(p); })(window.__plPin.getLatLng(), window.__plMap)`));

  await js(`var n = document.getElementById('plName'); n.value = 'Проверочный валун у дороги'; n.dispatchEvent(new Event('input', { bubbles: true }));
            document.getElementById('plContact').value = 't.me/proverka'; 1`);
  check('начал исправлять — ошибка под формой пропала', (await js(`document.getElementById('plStatus').textContent`)) === '');
  await sleep(1500);
  await снимок('task-7-form.png', '#plBox');
  await js(`document.getElementById('plSend').click(); 1`);
  check('отправка → «Спасибо! Посмотрим и добавим»', await дождаться(() => js(`/Спасибо! Посмотрим и добавим/.test(document.getElementById('plStatus').textContent)`)), await js(`document.getElementById('plStatus').textContent`));
  await sleep(300);
  const письма = JSON.parse(await js(`JSON.stringify(window.__письма)`));
  let письмо = {};
  try { письмо = JSON.parse(письма[0].body); } catch {}
  check('письмо через FormSubmit ушло на тот же адрес, что пожелание', письма.length === 1 && письма[0].url === 'https://formsubmit.co/ajax/' + Buffer.from('a29sdWRhNDlAZ21haWwuY29t', 'base64').toString(), JSON.stringify(письма).slice(0, 200));
  check('в письме тема, название, текст, координаты, контакт', письмо._subject === 'Поиск жилья — предложено место'
    && письмо.Название === 'Проверочный валун у дороги' && /родник/.test(письмо.Описание) && письмо.Координаты === '53.99749, 25.38583' && письмо.Контакт === 't.me/proverka', JSON.stringify(письмо));
  const сохранено = предложения();
  check('предложение сохранено со статусом «новое»', сохранено.length === 1 && сохранено[0].name === 'Проверочный валун у дороги'
    && /^s[0-9a-z]+$/.test(сохранено[0].id) && сохранено[0].status === 'новое' && сохранено[0].lat === 53.99749 && сохранено[0].contact === 't.me/proverka' && typeof сохранено[0].t === 'number', JSON.stringify(сохранено));
  check('форма очистилась', await js(`document.getElementById('plName').value === '' && document.getElementById('plCoord').value === ''`));

  // ловушка
  await js(`document.getElementById('plName').value = 'Робот-ловушка'; document.getElementById('plText').value = 'Купите наши замечательные окна недорого';
            document.getElementById('plCoord').value = '53.9, 27.5'; document.getElementById('plSite').value = 'http://spam.example';
            document.getElementById('plSend').click(); 1`);
  check('ловушка site: ответ как обычно', await дождаться(() => js(`/Спасибо/.test(document.getElementById('plStatus').textContent)`)));
  await sleep(300);
  check('ловушка site: письмо не ушло', (await js(`window.__письма.length`)) === 1);
  await js(`document.getElementById('plSite').value = ''; 1`);
  const поАPI = await (await fetch(SITE + '/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Робот 2', text: 'Ещё одна реклама окон', lat: 53.9, lng: 27.5, site: 'x' }) })).json();
  check('ловушка site через API: {ok:true}, но не сохранено', поАPI.ok === true && предложения().length === 1, JSON.stringify(поАPI) + ' записей ' + предложения().length);

  // вне Беларуси
  await js(`document.getElementById('plName').value = 'Бранденбургские ворота'; document.getElementById('plText').value = 'Это точно не в Беларуси, проверка рамки';
            document.getElementById('plCoord').value = '52.5163, 13.3777'; document.getElementById('plSend').click(); 1`);
  check('координаты вне Беларуси → ошибка', await дождаться(() => js(`(function(s){ return s.classList.contains('err') && /Беларус/.test(s.textContent); })(document.getElementById('plStatus'))`)), await js(`document.getElementById('plStatus').textContent`));
  check('вне Беларуси не сохранено', предложения().length === 1);
  const длинное = await (await fetch(SITE + '/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(81), text: 'нормальный текст', lat: 53.9, lng: 27.5 }) })).json();
  check('название длиннее 80 → ошибка', длинное.ok === false && /80/.test(длинное.error), JSON.stringify(длинное));

  // ── страница проверки ──────────────────────────────────────────────────
  console.log('\n=== страница проверки ===');
  const безКлюча = await fetch(SITE + '/predlozheniya');
  check('/predlozheniya без ключа — 403', безКлюча.status === 403);
  const сКлючом = await fetch(SITE + '/predlozheniya?key=' + КЛЮЧ);
  const html = await сКлючом.text();
  check('с ключом — 200, noindex и no-store', сКлючом.status === 200 && /noindex/.test(html) && сКлючом.headers.get('cache-control') === 'no-store');
  check('предложение видно, ловушки нет', html.includes('Проверочный валун у дороги') && !html.includes('Робот'));
  check('на /stats ссылка на страницу проверки', /href="\/predlozheniya\?key=poisk2026"/.test(await (await fetch(SITE + '/stats?key=' + КЛЮЧ)).text()));
  const безКлючаPOST = await fetch(SITE + '/api/suggest/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: сохранено[0].id }) });
  check('«добавить» без ключа — 403', безКлючаPOST.status === 403);

  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: SITE + '/predlozheniya?key=' + КЛЮЧ });
  await дождаться(() => js(`document.readyState === 'complete' && !!document.querySelector('.card[data-id]')`));
  check('у предложения: карта Яндекса, контакт, дата', await js(`(function(c){ return !!c.querySelector('a[href*="yandex.by/maps/?pt=25.38583,53.99749"]') && /t\\.me\\/proverka/.test(c.textContent) && /\\d{2}\\.\\d{2}\\.\\d{4}/.test(c.textContent); })(document.querySelector('.card[data-id]'))`));
  check('форма предзаполнена: название, категория «место», текст', await js(`(function(c){ return c.querySelector('[name=n]').value === 'Проверочный валун у дороги' && c.querySelector('[name=cat]').value === 'место' && /родник/.test(c.querySelector('[name=text]').value) && !!c.querySelector('[name=addr]'); })(document.querySelector('.card[data-id]'))`));
  await js(`document.querySelector('.card button[data-act=approve]').click(); 1`);
  check('без адреса не добавляется — ошибка на карточке', await дождаться(() => js(`(function(s){ return s.classList.contains('err') && /адрес/i.test(s.textContent); })(document.querySelector('.card .st'))`)), await js(`document.querySelector('.card .st').textContent`));
  check('без адреса место не появилось', (await найти('Проверочный валун')).length === 0);
  await js(`document.querySelector('.card .st').textContent = ''; document.querySelector('.card .st').className = 'st'; document.querySelector('.card [name=addr]').value = 'у д. Проверочной, Минский р-н'; 1`);
  await снимок('task-7-moder.png', '.wrap');
  await js(`document.querySelector('.card button[data-act=approve]').click(); 1`);
  const появилось = await дождаться(async () => (await найти('Проверочный валун')).length > 0);
  check('«Добавить на сайт» → место находится /api/places?q=', появилось);
  const место = (await найти('Проверочный валун'))[0] || {};
  check('место: номер 920001, группа «От читателей», адрес, координаты', место.id === 920001 && место.group === 'От читателей' && место.cat === 'место'
    && место.addr === 'у д. Проверочной, Минский р-н' && место.lat === 53.99749 && место.pic === '', JSON.stringify(место));
  const стр = await fetch(SITE + '/mesto/920001');
  const стрТекст = await стр.text();
  check('страница /mesto/920001 открывается', стр.ok && стрТекст.includes('Проверочный валун у дороги') && /родник/.test(стрТекст));
  const деталь = await (await fetch(SITE + '/api/place?id=920001')).json();
  check('/api/place отдаёт своё описание', /родник/.test(деталь.text || ''), JSON.stringify(деталь));
  check('статус предложения — «добавлено»', предложения()[0].status === 'добавлено', предложения()[0].status);
  check('одобренное место ушло в GitHub (данные/места-от-людей.json)', await дождаться(() => (последнийPUT('места-от-людей') || []).some(p => p.id === 920001 && p.name === 'Проверочный валун у дороги')));
  await дождаться(() => js(`document.readyState === 'complete' && /Уже на сайте/.test(document.body.textContent)`));
  await sleep(300);
  check('после добавления страница показывает место в «Уже на сайте»', await js(`!!document.querySelector('.card[data-id="920001"] button[data-act=remove]')`));
  check('новых предложений не осталось', await js(`!document.querySelector('.card button[data-act=approve]')`));

  // ограничение: пять в час с адреса
  console.log('\n=== пять в час ===');
  const предложить = (n, адрес) => fetch(SITE + '/api/suggest', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': адрес },
    body: JSON.stringify({ name: 'Проверка лимита ' + n, text: 'Текст предложения номер ' + n, lat: 53 + n / 10, lng: 27.5, contact: '' }) }).then(r => r.json());
  const пять = [];
  for (let n = 1; n <= 5; n++) пять.push(await предложить(n, '203.0.113.9, 10.0.0.1'));
  check('пять предложений с одного адреса приняты', пять.every(r => r.ok), JSON.stringify(пять));
  const шестое = await предложить(6, '203.0.113.9, 10.0.0.2');
  check('шестое за час с того же адреса → ошибка', шестое.ok === false && /пяти/.test(шестое.error || ''), JSON.stringify(шестое));
  check('с другого адреса можно', (await предложить(7, '198.51.100.4')).ok === true);

  // отклонить
  await send('Page.reload');
  await дождаться(() => js(`document.readyState === 'complete' && document.querySelectorAll('.card button[data-act=reject]').length === 6`));
  const отклоняем = await js(`(function(){ var c = [...document.querySelectorAll('.card[data-id]')].find(function(x){ return /Проверка лимита 3/.test(x.textContent) && x.querySelector('[data-act=reject]'); }); c.querySelector('[data-act=reject]').click(); return c.dataset.id; })()`);
  check('«Отклонить» → статус «отклонено»', await дождаться(() => (предложения().find(x => x.id === отклоняем) || {}).status === 'отклонено'));
  await дождаться(() => js(`document.readyState === 'complete' && document.querySelectorAll('.card button[data-act=reject]').length === 5`));
  check('отклонённое ушло в «Разобранные»', await js(`/Разобранные/.test(document.body.textContent) && [...document.querySelectorAll('.tag')].some(function(t){ return t.textContent === 'отклонено'; })`));
  check('отклонённое место на сайт не попало', (await найти('Проверка лимита 3')).length === 0);

  // убрать с сайта
  диалогов = 0;
  await js(`document.querySelector('.card[data-id="920001"] button[data-act=remove]').click(); 1`);
  check('«Убрать с сайта» спрашивает подтверждение', await дождаться(() => диалогов === 1, 3000));
  check('«Убрать с сайта» → место больше не находится', await дождаться(async () => (await найти('Проверочный валун')).length === 0));
  check('страница убранного места — 404', (await fetch(SITE + '/mesto/920001')).status === 404);
  check('убранное ушло в GitHub', await дождаться(() => { const м = последнийPUT('места-от-людей'); return Array.isArray(м) && !м.some(p => p.id === 920001); }));
  check('убрать без ключа — 403', (await fetch(SITE + '/api/suggest/remove', { method: 'POST', body: '{"placeId":920001}' })).status === 403);

  check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));

  // ── перезапуск: новый экземпляр берёт данные из GitHub ─────────────────
  console.log('\n=== перезапуск ===');
  await остановитьСервер(сервер);
  const папка2 = временнаяПапка('предложения-проверка-');
  папки.push(папка2);
  // местные файлы — как пришедшие с кодом развёртывания: старые
  fs.writeFileSync(path.join(папка2, 'места-от-людей.json'), '[]');
  fs.writeFileSync(path.join(папка2, 'предложения.json'), '[]');
  const изGitHubМесто = { id: 920007, name: 'Проверочная мельница из хранилища', lat: 53.5, lng: 27.1, addr: '', cat: 'место',
                         group: 'От читателей', pic: '', text: 'Запись для проверки перезапуска.' };
  const изGitHubПредложение = { id: 'sgh1', t: Date.now() - 3600000, name: 'Предложение из хранилища', text: 'Пришло до перезапуска сервера',
                               lat: 54.1, lng: 26.2, contact: '', status: 'новое' };
  ФАЙЛЫ = new Map([[путьК('места-от-людей'), { sha: 'g1', текст: JSON.stringify([изGitHubМесто]) }],
                   [путьК('предложения'), { sha: 'g2', текст: JSON.stringify([изGitHubПредложение]) }]]);
  let открыть; ВОРОТА = new Map([[путьК('предложения'), new Promise(r => открыть = r)]]);
  const запросовДо = запросы.length;
  сервер = запуститьСервер(папка2);
  check('новый экземпляр поднялся', await ждатьПинг());
  check('место из GitHub находится /api/places?q=', await дождаться(async () => (await найти('Проверочная мельница')).some(p => p.id === 920007)));
  check('страница места из GitHub открывается', (await fetch(SITE + '/mesto/920007')).ok);
  const доЗагрузки = await (await fetch(SITE + '/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.5' },
    body: JSON.stringify({ name: 'Предложено до загрузки', text: 'Пока GitHub ещё не ответил', lat: 53.2, lng: 28.4 }) })).json();
  check('предложение до загрузки принято', доЗагрузки.ok === true, JSON.stringify(доЗагрузки));
  await sleep(1200);
  const putПредложений = () => запросы.slice(запросовДо).filter(q => q.method === 'PUT' && q.url.split('?')[0] === путьК('предложения'));
  check('до загрузки предложения в GitHub не ушли', putПредложений().length === 0);
  открыть();
  check('после загрузки в GitHub ушли оба предложения', await дождаться(() => { const с = последнийPUT('предложения') || [];
    return putПредложений().length > 0 && с.some(x => x.id === 'sgh1') && с.some(x => x.name === 'Предложено до загрузки'); }), JSON.stringify(последнийPUT('предложения')));
  const html2 = await (await fetch(SITE + '/predlozheniya?key=' + КЛЮЧ)).text();
  check('на странице проверки оба предложения и место из GitHub', html2.includes('Предложение из хранилища') && html2.includes('Предложено до загрузки') && html2.includes('Проверочная мельница из хранилища'));
  const ошибкиЛога = сервер.лог.join('').split('\n').filter(с => /Хранилище:/.test(с) && !/в GitHub ещё нет/.test(с));
  check('в логе нового экземпляра нет ошибок хранилища', ошибкиЛога.length === 0, ошибкиЛога[0]);
} catch (e) {
  check('проверка дошла до конца', false, e.message);
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
try { ws.close(); } catch {}
await завершить(failed ? 1 : 0);
