// «Чаще всего добавляют в маршрут».
//
// Зачем. Лента на вкладке мест показывает, что люди чаще кладут в маршрут,
// а таблица на /stats подсказывает владельцу темы роликов. Счёт должен быть
// честным: один посетитель — один голос за место, роботы не считаются, чужие
// номера в файл не попадают. И счёт должен переживать перезапуск: файл
// данные/популярное.json уходит в GitHub, а новый экземпляр берёт его оттуда
// и прибавляет то, что успел насчитать сам до загрузки.
//
// Голоса нельзя «разминусовать», поэтому проверка поднимает свои экземпляры
// сервера на 8098 (временные папки данных, источники жилья выключены) и
// подделку GitHub на 9614. Рабочий сервер на 8080 не трогается.
//   node проверки/популярное.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { запуститьChrome, временнаяПапка, удалитьПапку } from './_браузер.mjs';

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const САЙТ = 'http://127.0.0.1:8098', МОК_ПОРТ = 9614, CDP_ПОРТ = 9608;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const ЧЕЛОВЕК = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const РОБОТ = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36';

// ── подделка GitHub: один файл популярного ───────────────────────────────
// Пока ворота закрыты, чтение файла ждёт: так видно, что голос, поданный
// до загрузки, не уходит в GitHub раньше неё и не теряется при слиянии.
const ПУТЬ = '/repos/koluda49-web/poisk-kvartir/contents/' + encodeURIComponent('данные') + '/' + encodeURIComponent('популярное.json');
const запросы = [];
let вGitHub = null, shaN = 0, ворота = null;
const мок = http.createServer((req, res) => {
  let тело = '';
  req.on('data', c => тело += c);
  req.on('end', async () => {
    const путь = req.url.split('?')[0];
    запросы.push({ method: req.method, путь, тело });
    if (путь !== ПУТЬ) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); return; }
    if (req.method === 'GET') {
      if (ворота) await ворота;
      if (!вGitHub) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sha: вGitHub.sha, encoding: 'base64', content: Buffer.from(вGitHub.текст).toString('base64').replace(/.{60}/g, '$&\n') }));
    } else if (req.method === 'PUT') {
      try {
        const т = JSON.parse(тело);
        вGitHub = { sha: 's' + (++shaN), текст: Buffer.from(т.content, 'base64').toString('utf8') };
        res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ content: { sha: вGitHub.sha } }));
      } catch { res.writeHead(400); res.end('{}'); }
    } else { res.writeHead(405); res.end(); }
  });
});
await new Promise(r => мок.listen(МОК_ПОРТ, '127.0.0.1', r));
const PUTы = () => запросы.filter(q => q.method === 'PUT' && q.путь === ПУТЬ);
const изPUT = q => { try { const т = JSON.parse(q.тело); return { message: т.message, объект: JSON.parse(Buffer.from(т.content, 'base64').toString('utf8')) }; } catch { return {}; } };

// ── экземпляры сервера ───────────────────────────────────────────────────
const процессы = [], папки = [];
let браузер = null;   // { chrome, закрыть } из _браузер.mjs
function запустить(папка) {
  const п = spawn(process.execPath, ['kvartiry-server.js'], {
    cwd: КОРЕНЬ,
    env: { ...process.env, PORT: '8098', DATA_DIR: папка, STATS_FILE: path.join(папка, 'stats.json'),
           GH_TOKEN: 'test', GH_API: 'http://127.0.0.1:' + МОК_ПОРТ, GH_SYNC_MS: '500', POPULAR_SAVE_MS: '400',
           KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' },
    stdio: 'ignore',
  });
  процессы.push(п);
  return п;
}
async function остановить(п) {
  try { if (п.exitCode === null) п.kill(); } catch {}   // kill() бьёт ровно по child.pid
  await new Promise(r => { if (п.exitCode !== null) r(); else { п.once('exit', r); setTimeout(r, 3000); } });
}
async function готов() {
  for (let i = 0; i < 150; i++) {
    try { if (((await (await fetch(САЙТ + '/api/places?light=1', { signal: AbortSignal.timeout(5000) })).json()).items || []).length > 100) return true; } catch {}
    await sleep(700);
  }
  return false;
}
async function завершить(код) {
  if (браузер) await браузер.закрыть();
  for (const п of процессы) await остановить(п);
  await new Promise(r => мок.close(r));
  for (const п of папки) удалитьПапку(п);
  process.exit(код);
}
process.on('unhandledRejection', e => { console.log('ОШИБКА ПРОВЕРКИ: ' + (e && e.message || e)); завершить(1); });

// Сервер считает один голос на адрес и место, а адрес берёт из x-forwarded-for
// (за прокси Render). Все запросы проверки идут с 127.0.0.1, поэтому каждому
// посетителю даём свой адрес — как у настоящих людей.
const адресаПосетителей = new Map();
const адресДля = v => { if (!адресаПосетителей.has(v)) адресаПосетителей.set(v, '198.51.100.' + (адресаПосетителей.size + 1)); return адресаПосетителей.get(v); };
const голос = (v, id, ua = ЧЕЛОВЕК, ip = адресДля(v)) => fetch(САЙТ + '/api/t', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': ua, 'X-Forwarded-For': ip },
  body: JSON.stringify({ e: 'route_add', v, s: 'проверка', id }) });
const популярное = async () => (await (await fetch(САЙТ + '/api/places/popular')).json());
// Таблица на /stats: { всего, счёт: {id: n} }
async function таблица() {
  const html = await (await fetch(САЙТ + '/stats?key=poisk2026')).text();
  const кусок = html.split('<h2>Популярное в маршрутах</h2>')[1]?.split('<h2>')[0] || '';
  const счёт = {};
  for (const m of кусок.matchAll(/href="\/mesto\/(\d+)">[\s\S]*?<td class="n">(\d+)<\/td><\/tr>/g)) счёт[m[1]] = +m[2];
  return { есть: !!кусок, всего: +((кусок.match(/Всего голосов: (\d+)/) || [])[1] ?? -1), счёт };
}
const дождаться = async (fn, раз = 40, шаг = 250) => { for (let i = 0; i < раз; i++) { if (await fn()) return true; await sleep(шаг); } return false; };

try {
  // ═══ первый экземпляр: в GitHub файла ещё нет ═══
  const папка1 = временнаяПапка('популярное-1-'); папки.push(папка1);
  const сервер1 = запустить(папка1);
  check('первый экземпляр запустился и знает места', await готов());

  const места = (await (await fetch(САЙТ + '/api/places')).json()).items.filter(p => typeof p.id === 'number');
  const [A, B, C, D, E] = места.slice(0, 5).map(p => p.id);
  const четыре = [A, B, C, D];

  // три посетителя — по голосу за четыре места
  for (const v of ['посетитель-1', 'посетитель-2', 'посетитель-3']) for (const id of четыре) await голос(v, id);
  // повтор того же посетителя — и числом, и строкой
  await голос('посетитель-1', A); await голос('посетитель-1', String(A));
  // робот, своя точка, номер, которого нет, пустой посетитель
  for (const v of ['робот-1', 'робот-2', 'робот-3']) { await голос(v, A, РОБОТ); await голос(v, E, РОБОТ); }
  await голос('посетитель-1', 'm'); await голос('посетитель-2', 'm53.1_27.1');
  await голос('посетитель-1', 999999999); await голос('посетитель-2', 999999999);
  await голос('', B);
  // одно место с одним голосом — в ленту не попадает, в таблицу попадает
  await голос('посетитель-1', E);
  // Другое событие с id: номер в журнал статистики не пишется (он нужен только route_add).
  await fetch(САЙТ + '/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': ЧЕЛОВЕК },
    body: JSON.stringify({ e: 'places', v: 'журнал-1', s: 'проверка', id: A, total: 5 }) });
  await sleep(600);

  const поп = await популярное();
  const items = поп.items || [];
  check('/api/places/popular отдаёт ровно эти четыре места', items.length === 4 && четыре.every(id => items.some(p => p.id === id)), JSON.stringify(items.map(p => [p.id, p.count])));
  check('у каждого count 3: повтор, робот и пустой посетитель не считаются', items.every(p => p.count === 3), JSON.stringify(items.map(p => p.count)));
  check('в карточке есть id, name, addr, pic, count', items.every(p => 'id' in p && p.name && 'addr' in p && 'pic' in p && 'count' in p));
  check('место с одним голосом в ленту не попало', !items.some(p => p.id === E));

  const т1 = await таблица();
  check('/stats: таблица «Популярное в маршрутах»', т1.есть);
  check('/stats: всего голосов 13 (12 + одно место с одним голосом)', т1.всего === 13, 'всего ' + т1.всего);
  check('/stats: место с одним голосом тоже в таблице', т1.счёт[E] === 1 && четыре.every(id => т1.счёт[id] === 3), JSON.stringify(т1.счёт));
  check('/stats: номера, которого нет в справочнике, в таблице нет', !('999999999' in т1.счёт));

  check('счётчики ушли в GitHub (PUT данные/популярное.json)', await дождаться(() => PUTы().length >= 1, 40));
  // Голоса шли не мгновенно, и первая отправка могла взять часть — ждём ту, где все.
  const ждём1 = { [A]: 3, [B]: 3, [C]: 3, [D]: 3, [E]: 1 };
  const совпало = (o, ж) => !!o && Object.keys(o).length === Object.keys(ж).length && Object.entries(ж).every(([к, ч]) => o[к] === ч);
  check('в GitHub ушли верные числа', await дождаться(() => PUTы().some(q => совпало(изPUT(q).объект, ждём1)), 40),
    PUTы().map(q => JSON.stringify(изPUT(q).объект)).join(' | '));
  const первыйPUT = изPUT(PUTы()[0] || {});
  check('коммит помечен [skip render]', /\[skip render\]/.test(первыйPUT.message || ''), первыйPUT.message);
  let местный1 = null; try { местный1 = JSON.parse(fs.readFileSync(path.join(папка1, 'популярное.json'), 'utf8')); } catch {}
  check('счётчики лежат и в местном файле', !!местный1 && местный1[A] === 3 && местный1[E] === 1, JSON.stringify(местный1));

  // ═══ браузер: лента на вкладке мест и голоса со всех страниц ═══
  // Обычный браузер, а не HeadlessChrome (--user-agent): иначе сервер примет голоса
  // за автоматику. Подмена через CDP слетает после перезагрузки страницы.
  браузер = запуститьChrome(CDP_ПОРТ, 'popular', { доп: ['--user-agent=' + ЧЕЛОВЕК], ловитьОшибки: false });
  let ws, n = 0; const pend = new Map(); const ошибки = []; const адреса = [];
  const send = (m, p = {}) => new Promise((res, rej) => { const k = ++n; pend.set(k, { res, rej }); ws.send(JSON.stringify({ id: k, method: m, params: p })); });
  let url;
  for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP_ПОРТ}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
  ws = new WebSocket(url);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Network.requestWillBeSent') адреса.push(m.params.request.url);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  const ждать = (усл, раз = 60) => дождаться(() => js(усл), раз, 250);

  await send('Page.navigate', { url: САЙТ + '/?country=places' });
  await ждать(`document.readyState === 'complete'`);
  await js(`localStorage.clear(); 1`);
  await send('Page.reload');
  await ждать(`(window.__places||[]).length > 0`);
  check('лента появилась на вкладке мест', await ждать(`(function(s){ return !!s && !s.hidden && s.offsetParent !== null && document.querySelectorAll('#plPopList .pop-c').length === 4; })(document.getElementById('plPop'))`));
  check('заголовок «Чаще всего добавляют в маршрут»', await js(`document.querySelector('#plPop h2').textContent === 'Чаще всего добавляют в маршрут'`));
  const iСписка = адреса.findIndex(a => /\/api\/places\?/.test(a)), iЛенты = адреса.findIndex(a => /\/api\/places\/popular/.test(a));
  check('лента запрошена после списка мест', iСписка >= 0 && iЛенты > iСписка, iСписка + ' / ' + iЛенты);
  // между ссылками и лентой — «Рекомендуемые маршруты» (задача 13)
  check('лента стоит под ссылками и рекомендуемыми маршрутами, над списком', await js(`(function(){ var n = document.getElementById('plLinks').nextElementSibling; if(n && n.id === 'plRec') n = n.nextElementSibling; return n === document.getElementById('plPop'); })()`));

  // «+ в маршрут» в ленте
  const номерВЛенте = await js(`window.__pop[0].id`);
  await js(`document.querySelector('#plPopList .pop-b').click(); 1`);
  await sleep(300);
  check('«+ в маршрут» кладёт место в маршрут', await js(`JSON.parse(localStorage.getItem('route')||'[]').some(function(p){ return p.id === ${номерВЛенте} && p.lat && p.lng; })`));
  check('кнопка стала «✓ в маршруте»', await js(`(function(b){ return b.classList.contains('on') && b.textContent === '✓ в маршруте'; })(document.querySelector('#plPopList .pop-b'))`));
  check('маршрут показан в блоке маршрута', await js(`document.getElementById('routeBox').style.display !== 'none' && document.querySelectorAll('#rtList .rt-item').length === 1`));
  await js(`dropRoute(${номерВЛенте}); 1`);
  check('убрали крестиком — кнопка в ленте снова «+ в маршрут»', await js(`document.querySelector('#plPopList .pop-b').textContent === '+ в маршрут'`));
  await js(`document.querySelector('#plPopList .pop-b').click(); 1`);   // повторное добавление — голос не удвоится
  await js(`setCountry('by', true); 1`);
  check('на вкладке жилья ленты нет', await js(`document.getElementById('plPop').hidden`));
  await js(`setCountry('places', true); 1`);
  check('вернулись на вкладку мест — лента снова видна', await js(`!document.getElementById('plPop').hidden`));
  // своя точка на главной: событие уходит, но не считается
  await js(`window.prompt = function(){ return 'Проба'; }; поставитьСвоюТочку(53.5, 27.5); 1`);

  const голосовДо = (await таблица()).всего;
  const использованы = new Set([A, B, C, D, E, номерВЛенте].map(String));
  // подборка
  await send('Page.navigate', { url: САЙТ + '/podborka/osen' });
  await ждать(`document.readyState === 'complete' && !!document.querySelector('button.add[data-id]')`);
  const F = await js(`(function(u){ var b = [].slice.call(document.querySelectorAll('button.add[data-id]')).find(function(b){ return u.indexOf(b.dataset.id) < 0 && !b.classList.contains('on'); }); return b ? b.dataset.id : ''; })(${JSON.stringify([...использованы])})`);
  await js(`document.querySelector('button.add[data-id="${F}"]').click(); 1`);
  await sleep(200);
  await js(`document.querySelector('button.add[data-id="${F}"]').click(); 1`);   // убрали — голоса не прибавляется
  await sleep(200);
  check('в подборке место добавилось и убралось', !!F && await js(`!JSON.parse(localStorage.getItem('route')||'[]').some(function(p){ return String(p.id) === '${F}'; })`));
  использованы.add(String(F));

  // страница маршрута: добавить(p), «По пути» и своя точка
  const G = места.find(p => !использованы.has(String(p.id)));
  использованы.add(String(G.id));
  const H = места.find(p => !использованы.has(String(p.id)));
  await send('Page.navigate', { url: САЙТ + '/marshrut' });
  await ждать(`document.readyState === 'complete' && typeof добавить === 'function'`);
  await js(`добавить(${JSON.stringify({ id: G.id, name: G.name, addr: G.addr, lat: G.lat, lng: G.lng })}); 1`);
  await js(`добавить({id:"m53.00000_27.00000",name:"Своя",addr:"",lat:53,lng:27}); 1`);
  await js(`поставитьПорядок("manual"); вставитьПоПути(${JSON.stringify({ id: H.id, name: H.name, addr: H.addr, lat: H.lat, lng: H.lng })}); 1`);
  check('на странице маршрута добавились место, своя точка и место «По пути»', await js(`[${G.id}, "m53.00000_27.00000", ${H.id}].every(function(id){ return Т.some(function(p){ return p.id === id; }); })`));

  const ждёмПосле = { [F]: 1, [G.id]: 1, [H.id]: 1 };
  check('голоса со страниц засчитаны: подборка, «добавить», «По пути» — по одному; своя точка и повтор — нет',
    await дождаться(async () => { const т = await таблица(); return т.всего === голосовДо + 3 && Object.entries(ждёмПосле).every(([к, ч]) => т.счёт[к] === ч); }, 40),
    JSON.stringify({ до: голосовДо, после: (await таблица()).всего }));
  const тПосле = await таблица();
  check('лента с главной дала один голос, повторное добавление — не дало', тПосле.счёт[номерВЛенте] === 4 && голосовДо === 14, 'место ' + тПосле.счёт[номерВЛенте] + ', до ' + голосовДо);
  check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
  ws.close(); await браузер.закрыть(); браузер = null;

  // что сейчас в GitHub — после всех голосов
  const итог1 = await (async () => { const т = await таблица(); return т; })();
  check('последние голоса тоже ушли в GitHub', await дождаться(() => { try { const o = JSON.parse(вGitHub.текст); return Object.values(o).reduce((a, b) => a + b, 0) === итог1.всего; } catch { return false; } }, 40));
  const вGitHubПосле = JSON.parse(вGitHub.текст);
  // Журнал пишется в файл раз в 30 с (а kill на Windows не даёт серверу дописать его при выходе).
  const журнал = () => { try { return JSON.parse(fs.readFileSync(path.join(папка1, 'stats.json'), 'utf8')); } catch { return null; } };
  await дождаться(() => (журнал() || []).some(e => e.e === 'places' && e.v === 'журнал-1'), 150, 250);
  const события = журнал() || [];
  const безНомера = события.find(e => e.e === 'places' && e.v === 'журнал-1');
  check('в журнале у события places номера нет, остальные поля на месте', !!безНомера && !('id' in (безНомера.p || {})) && безНомера.p.total === 5, JSON.stringify(безНомера));
  check('у route_add номер в журнале есть', события.some(e => e.e === 'route_add' && e.v === 'посетитель-1' && String(e.p && e.p.id) === String(A)));
  await остановить(сервер1);

  // ═══ второй экземпляр: устаревшая местная копия, GitHub отвечает не сразу ═══
  const папка2 = временнаяПапка('популярное-2-'); папки.push(папка2);
  // как файл, пришедший с кодом развёртывания: старый и меньше, чем в GitHub
  fs.writeFileSync(path.join(папка2, 'популярное.json'), JSON.stringify({ [A]: 5, [B]: 5, [C]: 5 }));
  let открыть; ворота = new Promise(r => открыть = r);
  const putДо = PUTы().length;
  запустить(папка2);
  check('второй экземпляр запустился', await готов());
  check('до загрузки из GitHub — местная копия: мест с ≥2 голосами три, лента пустая', ((await популярное()).items || []).length === 0);
  await голос('посетитель-4', A);
  await sleep(1500);
  check('голос до загрузки записан в местный файл', (() => { try { return JSON.parse(fs.readFileSync(path.join(папка2, 'популярное.json'), 'utf8'))[A] === 6; } catch { return false; } })());
  check('голос до загрузки в GitHub не ушёл', PUTы().length === putДо, 'PUT: ' + (PUTы().length - putДо));
  открыть(); ворота = null;
  check('после загрузки слитые счётчики ушли в GitHub', await дождаться(() => PUTы().length > putДо, 40));
  const слитое = изPUT(PUTы()[PUTы().length - 1]).объект || {};
  const ждём2 = { ...вGitHubПосле, [A]: вGitHubПосле[A] + 1 };
  check('слияние: копия из GitHub плюс свой голос, старые числа местной копии не прибавились',
    Object.keys(ждём2).length === Object.keys(слитое).length && Object.entries(ждём2).every(([к, ч]) => слитое[к] === ч),
    'ждали ' + JSON.stringify(ждём2) + ', ушло ' + JSON.stringify(слитое));
  const т2 = await таблица();
  check('перезапущенный экземпляр показывает счёт из GitHub на /stats', т2.счёт[A] === ждём2[A] && т2.счёт[B] === ждём2[B] && т2.всего === итог1.всего + 1, JSON.stringify(т2));

  // ═══ один адрес — один голос за место ═══
  // v придумывает сам браузер: цикл запросов с новым v на каждый раз вытолкнул
  // бы любое место наверх. Адрес так не подменить. Последним блоком — чтобы
  // эти голоса не сдвинули числа, которые проверялись выше.
  const свободные = места.filter(p => !использованы.has(String(p.id)) && !(String(p.id) in т2.счёт));
  const [I, J] = свободные.slice(0, 2).map(p => p.id);
  for (let k = 0; k < 5; k++) await голос('цикл-' + k, I, ЧЕЛОВЕК, '203.0.113.7');
  await голос('сосед-1', J, ЧЕЛОВЕК, '203.0.113.8');
  await голос('сосед-2', J, ЧЕЛОВЕК, '203.0.113.9');
  await голос('сосед-1', J, ЧЕЛОВЕК, '203.0.113.10');   // тот же посетитель с другого адреса — повтор
  await голос('сосед-3', I, ЧЕЛОВЕК, '203.0.113.8');    // адрес уже голосовал, но за другое место — считается
  let тIP = null;
  await дождаться(async () => { тIP = await таблица(); return т2.всего + 4 <= тIP.всего; }, 20);
  check('один адрес с пятью разными v — один голос', !!I && тIP.счёт[I] === 2, 'голосов ' + тIP.счёт[I] + ' (ждали 2: цикл и сосед-3)');
  check('разные адреса — разные голоса; тот же v с нового адреса — нет', !!J && тIP.счёт[J] === 2, 'голосов ' + тIP.счёт[J]);
  check('всего прибавилось ровно 4 голоса', тIP.всего === т2.всего + 4, т2.всего + ' → ' + тIP.всего);
} catch (e) {
  failed++; console.log('  ПАДАЕТ проверка оборвалась — ' + (e && e.stack || e));
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
await завершить(failed ? 1 : 0);
