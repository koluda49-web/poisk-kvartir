// Журнал входов и клики «к объявлению» на всех страницах.
//
// Зачем. Своя статистика видела только главную: события слал её скрипт, а
// закрепы ведут на /gomel, /ceny…, /gde-ostanovitsya-…, места и маршруты.
// Теперь:
//   1) сервер сам пишет каждый заход на HTML-страницу (без JavaScript):
//      путь, метку ?from=, «из приложения TikTok», робот или нет, 200/404;
//      служебные адреса, API и файлы в журнал не идут; свои проверки
//      (poisk-check в User-Agent) считаются роботами;
//   2) на каждой HTML-странице один раз стоит скрипт кликов (id="pkc"),
//      а на личных страницах владельца его нет;
//   3) клик по внешней ссылке в новой вкладке — событие open с площадкой,
//      страницей и её типом, tel: — call; метка поста живёт в sessionStorage
//      и доходит до клика на другой странице; на главной клик не задваивается;
//      со счётчиком — ещё цель Метрики open_ad / call;
//   4) /stats?json=1 отдаёт сводку: метка → входы → сессий с open → площадки.
// Проверка сама поднимает сервер со счётчиком (порт 8248, площадки выключены,
// временная папка данных), запросы к mc.yandex.ru в браузере заблокированы,
// и гасит сервер по своему процессу.
//   node проверки/журнал-входов.mjs

import { spawn } from 'node:child_process';
import { запуститьChrome, временнаяПапка, удалитьПапкуЖдя } from './_браузер.mjs';

const ПОРТ = 8248, SITE = 'http://127.0.0.1:' + ПОРТ;
const CDP = 9440 + (process.pid % 100), sleep = ms => new Promise(r => setTimeout(r, ms));
const КЛЮЧ = process.env.STATS_KEY || 'poisk2026';
// «Человек» — обычный браузер; иначе сервер (правильно) примет нас за робота
const ЧЕЛОВЕК = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ТИКТОК = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

const папка = временнаяПапка('zhurnal-test-');
const env = { ...process.env, PORT: String(ПОРТ), DATA_DIR: папка, STATS_FILE: папка + '/stats.json', GH_TOKEN: '',
              KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' };
delete env.METRIKA_OFF;
const сервер = spawn(process.execPath, ['kvartiry-server.js'], { cwd: new URL('..', import.meta.url), env, stdio: 'ignore' });
async function погаситьСервер() {
  try { if (сервер.exitCode === null) сервер.kill(); } catch {}   // ровно наш процесс
  await new Promise(r => { if (сервер.exitCode !== null) r(); else { сервер.once('exit', r); setTimeout(r, 3000); } });
}
process.on('exit', () => { try { if (сервер.exitCode === null) сервер.kill(); } catch {} });

const { закрыть } = запуститьChrome(CDP, 'zhurnal', { доп: ['--user-agent=' + ЧЕЛОВЕК] });

const взять = (путь, ua = ЧЕЛОВЕК) => fetch(SITE + путь, { headers: { 'User-Agent': ua }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
const сводка = async () => (await fetch(SITE + '/stats?key=' + КЛЮЧ + '&json=1', { headers: { 'User-Agent': 'poisk-check' } })).json();

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
async function открыть(адрес) {
  await send('Page.navigate', { url: адрес });
  for (let i = 0; i < 120; i++) { if (await js('document.readyState === "complete"')) break; await sleep(250); }
  await sleep(500);
}
// Ссылка на площадку / телефон — свою кладём в страницу, переход гасим уже
// после перехвата (наш слушатель стоит на фазе захвата и успевает раньше).
const кликнуть = (href, blank) => js(`(function(){ var a = document.createElement('a'); a.href = ${JSON.stringify(href)};
  ${blank ? 'a.target = "_blank";' : ''} a.textContent = 'x'; a.addEventListener('click', function(e){ e.preventDefault(); });
  document.body.appendChild(a); a.click(); return true; })()`);
const маякиOpen = () => js(`Promise.all((window.__маяки||[]).map(function(b){ return b && b.text ? b.text() : String(b); }))
  .then(function(сп){ return сп.map(function(т){ try{ return JSON.parse(т); }catch(e){ return {}; } })
  .filter(function(о){ return о.e === 'open' || о.e === 'call'; }); })`);
const цели = () => js(`JSON.stringify(((window.ym && window.ym.a) || []).map(function(a){ return Array.prototype.slice.call(a); })
  .filter(function(a){ return a[1] === 'reachGoal'; }))`).then(JSON.parse);

try {
  let жив = false;
  for (let i = 0; i < 120 && !жив; i++) {
    try { жив = (await fetch(SITE + '/ping', { signal: AbortSignal.timeout(3000) })).ok; } catch {}
    if (!жив) await sleep(500);
  }
  check('сервер отвечает', жив);

  console.log('\n=== журнал входов (сервер) ===');
  const до = await сводка();
  check('сводка /stats?json=1 отдаётся', Array.isArray(до.days) && Array.isArray(до.marks) && Array.isArray(до.notFound));
  check('/stats?json=1 без ключа — 403', (await взять('/stats?json=1')).status === 403);
  check('/grodno?from=jt-1410 — 200', (await взять('/grodno?from=jt-1410')).status === 200);
  await взять('/gomel?from=jt-1410');
  await взять('/grodno', ТИКТОК);
  check('/net-takoj-stranicy-777 — 404', (await взять('/net-takoj-stranicy-777')).status === 404);
  for (const п of ['/ping', '/robots.txt', '/sitemap.xml', '/api/places?light=1', '/sw.js', '/logo.svg', '/wp-login.php'])
    await взять(п);
  await взять('/grodno?from=jt-robot', 'Mozilla/5.0 poisk-check');
  await взять('/grodno?from=jt-node', 'node');
  const с = await сводка();
  const м = с.marks.find(x => x.from === 'jt-1410');
  check('метка jt-1410: 2 входа, 1 человек', м && м.hits === 2 && м.people === 1, JSON.stringify(м));
  check('poisk-check и «node» — роботы, в метки не попали', !с.marks.some(x => x.from === 'jt-robot' || x.from === 'jt-node'));
  check('TikTok без метки: /grodno', с.tiktokNoMark.some(x => x.path === '/grodno' && x.n >= 1), JSON.stringify(с.tiktokNoMark));
  check('404 по пути: /net-takoj-stranicy-777', с.notFound.some(x => x.path === '/net-takoj-stranicy-777' && x.people === 1), JSON.stringify(с.notFound));
  check('служебное и файлы — не в журнале',
    !с.notFound.concat(с.entryPages).some(x => /^\/(ping|robots|sitemap|api|sw\.js|logo|wp-login)/.test(x.path)),
    JSON.stringify(с.notFound.concat(с.entryPages)));
  check('по дням: входы и 404 сегодня', с.days.length >= 1 && с.days[с.days.length - 1].hits >= 3 && с.days[с.days.length - 1].notFound >= 1,
    JSON.stringify(с.days));
  const html = await (await взять('/stats?key=' + КЛЮЧ)).text();
  for (const блок of ['Входы по меткам (все страницы', 'Страницы входа (7 дней)', 'Из приложения TikTok без метки', '404 за 7 дней', 'Страница → переходы к объявлениям'])
    check('/stats: блок «' + блок + '»', html.includes(блок));

  console.log('\n=== скрипт кликов на страницах ===');
  for (const [путь, тип] of [['/', 'home'], ['/grodno', 'city'], ['/mesto/286', 'place'], ['/m', 'route'], ['/ceny-kvartir-na-sutki', 'prices'],
                             ['/goroda', 'hub'], ['/net-takoj-stranicy-777', 'other']]) {
    const т = await (await взять(путь)).text();
    const n = т.split('<script id="pkc">').length - 1, голова = т.indexOf('</head>'), где = т.indexOf('<script id="pkc">');
    check(путь + ': скрипт кликов один, в <head>, тип ' + тип, n === 1 && где > 0 && где < голова && т.includes('var t="' + тип + '"'),
      'штук ' + n + ', тип ' + (т.match(/var t="([a-z]+)"/) || [])[1]);
    check(путь + ': цели Метрики open_ad / call', т.includes('"reachGoal",e==="call"?"call":"open_ad"'));
    check(путь + ': цели связи contact_click / feedback_open / feedback_sent / place_sent',
      ['contact_click', 'feedback_open', 'feedback_sent', 'place_sent'].every(ц => т.includes('"' + ц + '"')));
  }
  for (const путь of ['/stats?key=' + КЛЮЧ, '/predlozheniya?key=' + КЛЮЧ])
    check(путь.split('?')[0] + ': без скрипта кликов', !(await (await взять(путь)).text()).includes('id="pkc"'));
  const скрипт = (await (await взять('/grodno')).text()).match(/<script id="pkc">[\s\S]*?<\/script>/)[0];
  check('скрипт кликов не больше 2 КБ (' + Buffer.byteLength(скрипт) + ' Б)', Buffer.byteLength(скрипт) <= 2048);

  console.log('\n=== клики в браузере ===');
  let url;
  for (let i = 0; i < 40 && !url; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!url) await sleep(500);
  }
  ws = new WebSocket(url);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*mc.yandex.ru*', '*yandex.ru/metrika*', '*formsubmit.co*'] });
  // Письма формы пожелания уходят через FormSubmit — в проверке вместо него ответ «отправлено»,
  // наружу ничего не уходит (адрес ещё и заблокирован выше).
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (function(){
      window.__маяки = [];
      var родной = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
      navigator.sendBeacon = function(u, b){ if(String(u).indexOf('/api/t') >= 0) window.__маяки.push(b); return родной ? родной(u, b) : true; };
      var родFetch = window.fetch;
      window.fetch = function(u, o){
        if(String(u).indexOf('formsubmit.co') >= 0) return Promise.resolve(new Response('{"success":"true"}', { headers: { 'Content-Type': 'application/json' } }));
        return родFetch.apply(this, arguments);
      };
    })();` });

  await открыть(SITE + '/gomel?from=jt-klik');
  await кликнуть('https://www.kufar.by/item/1', true);
  await sleep(300);
  const о1 = await маякиOpen();
  check('город: open с площадкой, страницей, типом и меткой',
    о1.length === 1 && о1[0].e === 'open' && о1[0].host === 'kufar.by' && о1[0].page === '/gomel' && о1[0].pt === 'city' && о1[0].from === 'jt-klik' && !!о1[0].s,
    JSON.stringify(о1));
  const ц1 = await цели();
  check('город: цель Метрики open_ad {host, page}', ц1.length === 1 && ц1[0][2] === 'open_ad' && ц1[0][3].host === 'kufar.by' && ц1[0][3].page === '/gomel',
    JSON.stringify(ц1));
  const сессия = о1[0] && о1[0].s;

  await открыть(SITE + '/mesto/286');
  await кликнуть('tel:+375291234567', false);
  await кликнуть('/grodno', true);                  // своя ссылка в новой вкладке — не переход к объявлению
  await sleep(300);
  const о2 = await маякиOpen();
  check('место без метки в адресе: звонок с меткой из sessionStorage, та же сессия',
    о2.length === 1 && о2[0].e === 'call' && о2[0].from === 'jt-klik' && о2[0].pt === 'place' && о2[0].s === сессия, JSON.stringify(о2));
  const ц2 = await цели();
  check('место: цель Метрики call', ц2.length === 1 && ц2[0][2] === 'call', JSON.stringify(ц2));

  await открыть(SITE + '/');
  await кликнуть('https://realt.by/x', true);
  await sleep(300);
  const о3 = await маякиOpen();
  check('главная: один open, не задвоен', о3.length === 1 && о3[0].host === 'realt.by' && о3[0].pt === 'home', JSON.stringify(о3));

  // Связь (19.10): кнопка «Сдаёте жильё? … Напишите нам ↓», «Оставить пожелание», отправка
  // пожелания и формы «Предложить место» — событие contact {what, page} в своей статистике
  // (тем же маяком, что open/call) и цели Метрики; на главной каждое — ровно один раз.
  const маякиСвязи = () => js(`Promise.all((window.__маяки||[]).map(function(b){ return b && b.text ? b.text() : String(b); }))
    .then(function(сп){ return сп.map(function(т){ try{ return JSON.parse(т); }catch(e){ return {}; } })
    .filter(function(о){ return о.e === 'contact'; }); })`);
  const цельСвязи = async имя => (await цели()).filter(ц => ц[2] === имя);
  await js('document.getElementById("knizu").click(), true');
  await sleep(300);
  let св = await маякиСвязи();
  check('«Сдаёте жильё? … Напишите нам ↓»: один contact what=knizu, страница /',
    св.length === 1 && св[0].what === 'knizu' && св[0].page === '/' && св[0].pt === 'home' && !!св[0].s, JSON.stringify(св));
  check('… и одна цель Метрики contact_click', (await цельСвязи('contact_click')).length === 1, JSON.stringify(await цели()));
  await js('document.getElementById("fbOpen").click(), true');
  await sleep(300);
  св = await маякиСвязи();
  check('«Оставить пожелание»: contact what=fb_open, без задвоения', св.length === 2 && св[1].what === 'fb_open', JSON.stringify(св));
  check('… и цель feedback_open', (await цельСвязи('feedback_open')).length === 1);
  await js('document.getElementById("fbMsg").value = "проверка связи", document.getElementById("fbSend").click(), true');
  for (let i = 0; i < 20 && (await маякиСвязи()).length < 3; i++) await sleep(200);
  св = await маякиСвязи();
  check('пожелание отправлено: contact what=fb_sent', св.length === 3 && св[2].what === 'fb_sent', JSON.stringify(св));
  check('… и цель feedback_sent', (await цельСвязи('feedback_sent')).length === 1);
  await js(`(function(){ var g = function(i){ return document.getElementById(i); };
    g('plName').value = 'Проверка связи'; g('plText').value = 'Проверочное место, не настоящее.';
    g('plCoord').value = '53.9, 27.56'; g('plForm').requestSubmit(); return true; })()`);
  for (let i = 0; i < 30 && (await маякиСвязи()).length < 4; i++) await sleep(200);
  св = await маякиСвязи();
  check('место предложено (успешно): contact what=place_sent', св.length === 4 && св[3].what === 'place_sent', JSON.stringify(св));
  check('… и цель place_sent', (await цельСвязи('place_sent')).length === 1);
  check('«Предложить место» с ошибкой не считается отправкой', await js(`(function(){ document.getElementById('plName').value = '';
    document.getElementById('plForm').requestSubmit(); return true; })()`) && (await маякиСвязи()).length === 4);

  await sleep(500);
  const с2 = await сводка();
  const м2 = с2.marks.find(x => x.from === 'jt-klik');
  check('сводка: метка jt-klik → 1 вход, 1 сессия с open, kufar.by 1, звонок 1',
    м2 && м2.hits === 1 && м2.openSessions === 1 && м2.call === 1 && м2.hosts['kufar.by'] === 1, JSON.stringify(м2));
  check('сводка: open по площадкам', с2.openByHost.some(x => x.host === 'kufar.by') && с2.openByHost.some(x => x.host === 'realt.by'), JSON.stringify(с2.openByHost));
  check('сводка: страница → open', с2.openByPage.some(x => x.page === '/gomel · город' && x.open === 1)
    && с2.openByPage.some(x => x.page === '/mesto/286 · место' && x.call === 1), JSON.stringify(с2.openByPage));
  const связь = Object.fromEntries((с2.contact || []).map(x => [x.what, x.n]));
  check('сводка: «связь» — по одному knizu, fb_open, fb_sent, place_sent',
    связь.knizu === 1 && связь.fb_open === 1 && связь.fb_sent === 1 && связь.place_sent === 1, JSON.stringify(с2.contact));
  const стат = await (await взять('/stats?key=' + КЛЮЧ)).text();
  check('/stats: блок «Связь: клики и отправки» с цифрами', стат.includes('Связь: клики и отправки') && /отправил пожелание/.test(стат));
} catch (e) {
  check('проверка не сломалась', false, e.stack);
} finally {
  console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
  try { ws && ws.close(); } catch {}
  await закрыть();
  await погаситьСервер();
  await удалитьПапкуЖдя(папка, { что: 'папка данных сервера не удалена' });
}
process.exit(failed ? 1 : 0);
