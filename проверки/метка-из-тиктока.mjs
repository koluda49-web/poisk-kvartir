// Метка ссылки из ТикТока: /?from=tiktok-0110.
//
// Зачем. Под постами ссылки с меткой from=tiktok-ДДММ — по ней видно, какой
// пост привёл людей. Но «from» на сайте — это ещё и дата заезда в адресе
// поиска (/?from=2026-12-30&to=2027-01-02). Главная клала «tiktok-0110» в поля
// дат (#from, #plFrom), а в своей статистике дата из общей ссылки считалась
// меткой. Теперь даты берутся только вида ГГГГ-ММ-ДД, метка — как метка:
//   1) метка не попадает в поля дат (поля на время проверки делаем текстовыми:
//      в Chrome поле даты само выбрасывает неверное значение и ошибку прячет,
//      а там, где поле даты — обычное текстовое, «tiktok-0110» было видно);
//   2) настоящие даты из адреса по-прежнему встают в поля;
//   3) метка уходит в /api/t вместе с событием view — даже когда адрес
//      к этому времени уже переписан (history.replaceState);
//   4) дата заезда в адресе меткой не считается, utm_source — считается;
//   5) метка уходит в Яндекс.Метрику параметром визита
//      ym(112722670,"params",{from:…}) на всех страницах со счётчиком,
//      а с METRIKA_OFF=1 ни счётчика, ни вызова нет.
// Для пятого проверка сама поднимает сервер со счётчиком (порт 8247,
// площадки выключены, временная папка данных) и гасит его по своему процессу.
// Запросы к mc.yandex.ru в браузере заблокированы: визиты не уходят, вызовы
// остаются в очереди ym.a, её и смотрим.
//
// Нужен Chrome. Основной сервер (с METRIKA_OFF=1) должен быть уже запущен.
//   node проверки/метка-из-тиктока.mjs http://127.0.0.1:9670

import { spawn } from 'node:child_process';
import { запуститьChrome, временнаяПапка, удалитьПапкуЖдя } from './_браузер.mjs';

const SITE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const PORT = 9760 + (process.pid % 200), sleep = ms => new Promise(r => setTimeout(r, ms));
const ПОРТ_СЧЁТЧИКА = 8247, СО_СЧЁТЧИКОМ = 'http://127.0.0.1:' + ПОРТ_СЧЁТЧИКА;

let failed = 0, passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  OK   ' + name); }
  else { failed++; console.log('  ПАДАЕТ ' + name + (detail ? ('  — ' + detail) : '')); }
};

// Сервер со счётчиком: как в метрика.mjs, без площадок — страницы отдаются и так.
const папка = временнаяПапка('metka-test-');
const env = { ...process.env, PORT: String(ПОРТ_СЧЁТЧИКА), DATA_DIR: папка, STATS_FILE: папка + '/stats.json', GH_TOKEN: '',
              KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' };
delete env.METRIKA_OFF;
const сервер = spawn(process.execPath, ['kvartiry-server.js'], { cwd: new URL('..', import.meta.url), env, stdio: 'ignore' });
async function погаситьСервер() {
  try { if (сервер.exitCode === null) сервер.kill(); } catch {}   // ровно наш процесс
  await new Promise(r => { if (сервер.exitCode !== null) r(); else { сервер.once('exit', r); setTimeout(r, 3000); } });
}
process.on('exit', () => { try { if (сервер.exitCode === null) сервер.kill(); } catch {} });

const { закрыть } = запуститьChrome(PORT, 'metka');

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!url) await sleep(500);
}
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setBlockedURLs', { urls: ['*mc.yandex.ru*', '*yandex.ru/metrika*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
// До скриптов страницы: поля дат — текстовые (как там, где поля даты нет),
// маяки /api/t — копией в window.__маяки.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  (function(){
    window.__маяки = [];
    var родной = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
    navigator.sendBeacon = function(u, b){ if(String(u).indexOf('/api/t') >= 0) window.__маяки.push(b); return родной ? родной(u, b) : true; };
    var поля = { from:1, to:1, plFrom:1, plTo:1 };
    new MutationObserver(function(сп){
      сп.forEach(function(з){ з.addedNodes.forEach(function(у){
        if(у.tagName === 'INPUT' && поля[у.id]) у.type = 'text';
      }); });
    }).observe(document, { childList: true, subtree: true });
  })();` });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

async function открыть(адрес, готово = 'typeof applyUrl === "function"', сек = 60) {
  await send('Page.navigate', { url: адрес });
  for (let i = 0; i < сек * 2; i++) { if (await js(`document.readyState === 'complete' && (${готово})`)) break; await sleep(500); }
  await sleep(1000);
}
const поля = () => js(`JSON.stringify(['from','to','plFrom','plTo'].map(function(k){ var e=document.getElementById(k); return e ? e.value : null; }))`).then(JSON.parse);
const меткиView = () => js(`Promise.all((window.__маяки||[]).map(function(b){ return b && b.text ? b.text() : String(b); }))
  .then(function(сп){ return сп.map(function(т){ try{ return JSON.parse(т); }catch(e){ return {}; } })
  .filter(function(о){ return о.e === 'view'; }).map(function(о){ return о.from; }); })`);
async function ждатьView() {
  for (let i = 0; i < 30; i++) { if ((await меткиView()).length) break; await sleep(500); }
  return меткиView();
}

try {
  console.log('\n=== метка не попадает в поля дат ===');
  {
    await открыть(SITE + '/?from=tiktok-0110');
    const [from, to, plFrom] = await поля();
    check('главная: поле заезда пустое (' + JSON.stringify(from) + ')', from === '', 'в поле заезда: ' + from);
    check('главная: заезд в разделе мест пустой', plFrom === '', 'в поле: ' + plFrom);
    check('главная: поле выезда не тронуто', to === '', 'в поле выезда: ' + to);
    const метки = await ждатьView();
    check('метка ушла в /api/t (view, from=tiktok-0110)', метки.includes('tiktok-0110'), 'ушло: ' + JSON.stringify(метки));

    await открыть(SITE + '/?country=places&from=tiktok-0110');
    const [f2, , pf2] = await поля();
    check('«Что посетить»: метка не в датах', f2 === '' && pf2 === '', JSON.stringify([f2, pf2]));
    check('«Что посетить»: метка ушла в /api/t', (await ждатьView()).includes('tiktok-0110'));

    // Поиск переписывает адрес (history.replaceState) — метка уже прочитана
    await открыть(SITE + '/?region=brest&type=flat&from=tiktok-0210');
    const м3 = await ждатьView();
    check('адрес переписан поиском, а метка всё равно ушла', м3.includes('tiktok-0210'),
          'ушло: ' + JSON.stringify(м3) + ', адрес: ' + await js('location.search'));
  }

  console.log('\n=== настоящие даты по-прежнему встают в поля ===');
  {
    await открыть(SITE + '/?region=brest&from=2026-12-30&to=2027-01-02');
    const [from, to] = await поля();
    check('главная: заезд 2026-12-30', from === '2026-12-30', from);
    check('главная: выезд 2027-01-02', to === '2027-01-02', to);
    const м = await ждатьView();
    check('дата заезда меткой не считается', м.length > 0 && м.every(x => !x), 'ушло: ' + JSON.stringify(м));

    await открыть(SITE + '/?country=places&from=2026-12-30&to=2027-01-02');
    const [f2, t2, pf2, pt2] = await поля();
    check('«Что посетить»: даты в обоих полях', f2 === '2026-12-30' && pf2 === '2026-12-30' && t2 === '2027-01-02' && pt2 === '2027-01-02',
          JSON.stringify([f2, t2, pf2, pt2]));

    await открыть(SITE + '/?from=2026-12-30&utm_source=tiktok');
    const м2 = await ждатьView();
    check('utm_source при дате в from — меткой', м2.includes('tiktok'), 'ушло: ' + JSON.stringify(м2));
  }

  console.log('\n=== METRIKA_OFF=1: ни счётчика, ни параметров ===');
  {
    const т = await (await fetch(SITE + '/?from=tiktok-0110')).text();
    check('на основном сервере (METRIKA_OFF=1) вызова params нет', !т.includes('112722670'),
          'основной сервер запущен без METRIKA_OFF=1?');
  }

  console.log('\n=== метка уходит в Метрику параметром визита ===');
  {
    let жив = false;
    for (let i = 0; i < 120 && !жив; i++) {
      try { жив = (await fetch(СО_СЧЁТЧИКОМ + '/ping', { signal: AbortSignal.timeout(3000) })).ok; } catch {}
      if (!жив) await sleep(500);
    }
    check('сервер со счётчиком отвечает', жив);
    const ВЫЗОВ = 'ym(112722670,"params",{from:f})';
    for (const путь of ['/', '/mesto/286', '/marshrut?p=286,4198', '/chto-posmotret-minsk', '/grodno', '/podborka/osen', '/m']) {
      const т = await (await fetch(СО_СЧЁТЧИКОМ + путь, { signal: AbortSignal.timeout(60000) })).text();
      const иниц = т.indexOf('ym(112722670,"init"'), выз = т.indexOf(ВЫЗОВ), голова = т.indexOf('</head>');
      check(путь + ': вызов params в голове, после init (один раз)',
            иниц > 0 && выз > иниц && выз < голова && т.split(ВЫЗОВ).length === 2,
            'init ' + иниц + ', params ' + выз + ', </head> ' + голова);
    }
    // В браузере: что именно легло в очередь счётчика
    const очередь = `JSON.stringify(((window.ym && window.ym.a) || []).map(function(a){ return Array.prototype.slice.call(a); })
      .filter(function(a){ return a[1] === 'params'; }))`;
    for (const путь of ['/?from=tiktok-0110', '/mesto/286?from=tiktok-0110', '/chto-posmotret-minsk?from=tiktok-0110', '/grodno?utm_source=tiktok-0110']) {
      await открыть(СО_СЧЁТЧИКОМ + путь, 'true', 30);
      const п = JSON.parse(await js(очередь) || '[]');
      check(путь + ': ym(112722670,"params",{from:"tiktok-0110"})',
            п.length === 1 && п[0][0] === 112722670 && п[0][2] && п[0][2].from === 'tiktok-0110', JSON.stringify(п));
    }
    await открыть(СО_СЧЁТЧИКОМ + '/?from=2026-12-30&to=2027-01-02', 'true', 30);
    check('дата в from — без параметра визита', JSON.parse(await js(очередь) || '[]').length === 0, await js(очередь));
    await открыть(СО_СЧЁТЧИКОМ + '/mesto/286', 'true', 30);
    check('без метки — без параметра визита', JSON.parse(await js(очередь) || '[]').length === 0, await js(очередь));
  }
} catch (e) {
  check('проверка не сломалась', false, e.stack);
} finally {
  console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
  try { ws.close(); } catch {}
  await закрыть();
  await погаситьСервер();
  await удалитьПапкуЖдя(папка, { что: 'папка данных сервера не удалена' });
}
process.exit(failed ? 1 : 0);
