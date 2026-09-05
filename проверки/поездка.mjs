// Проверка сборов в поездку: даты в разделе «Что посетить» и маршрут на день.
//
// Ловит:
//   1) даты поездки не влияют на подбор жилья рядом — человек видит цену
//      за сутки там, где ему нужна цена за две ночи;
//   2) даты не переносятся при переходе к жилью области, и их приходится
//      вводить заново;
//   3) маршрут на день: точки не набираются, порядок объезда не считается,
//      ссылка в Яндекс.Карты собирается неправильно.
//
// Нужен Chrome. Сервер должен быть уже запущен.
//   npm run проверка-поездки
//   npm run проверка-поездки https://poisk-kvartir.onrender.com

import { spawn } from 'node:child_process';

// Порт отладки и профиль — свои на каждый прогон: иначе вторая проверка
// подряд не запускается, прежний Chrome ещё держит и то и другое.
const PORT = 9355 + (process.pid % 400), sleep = ms => new Promise(r => setTimeout(r, ms));
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check',
  // Свой профиль на каждый прогон: общий держал бы прошлый Chrome,
  // и вторая проверка подряд не запускалась бы вовсе.
  '--user-data-dir=' + process.env.TEMP + '/cdp-trip-' + process.pid, 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!url) await sleep(500);
}
if (!url) { console.log('Chrome не запустился — проверка НЕ выполнена'); process.exit(1); }

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

const открыть = async (path) => {
  await send('Page.navigate', { url: SITE + path });
  for (let i = 0; i < 120; i++) { if (await js('document.querySelectorAll("#grid .plc").length >= 3')) break; await sleep(600); }
  await sleep(2500);
};

try {
  // ── даты поездки ────────────────────────────────────────────────────────
  console.log('\n=== даты поездки в разделе «Что посетить» ===');
  await открыть('/?country=places');

  const естьПоля = await js(`!!document.querySelector('#plFrom') && !!document.querySelector('#plTo')`);
  check('в разделе есть поля заезда и выезда', естьПоля,
        'без них человек не может сказать, когда едет');

  if (естьПоля) {
    await js(`(function(){
      const d = new Date(); d.setDate(d.getDate() + 7);
      const b = new Date(d); b.setDate(b.getDate() + 2);
      const f = x => x.toISOString().slice(0, 10);
      const a = document.querySelector('#plFrom'), c = document.querySelector('#plTo');
      a.value = f(d); c.value = f(b);
      a.dispatchEvent(new Event('change')); c.dispatchEvent(new Event('change'));
    })(); 1`);
    await sleep(1200);

    const перенос = await js(`JSON.stringify({
      from: document.querySelector('#from').value,
      to: document.querySelector('#to').value,
      plFrom: document.querySelector('#plFrom').value })`);
    const п = JSON.parse(перенос);
    check('даты попадают и в поиск жилья', п.from === п.plFrom && !!п.to,
          'в поиске жилья: «' + п.from + '»');

    // жильё рядом должно показать стоимость за весь срок
    await js('stayNear(0); 1');
    for (let i = 0; i < 50; i++) { if (await js(`document.querySelectorAll('#near0 .near-list a').length > 0`)) break; await sleep(700); }
    await sleep(1200);
    const текст = await js(`(document.querySelector('#near0') || {}).textContent || ''`);
    check('в жилье рядом видна цена за весь срок', /за 2 ноч/.test(текст),
          'показана только цена за сутки');

    const адрес = await js('location.search');
    check('даты запоминаются в адресе страницы', /from=\d{4}-\d{2}-\d{2}/.test(адрес), адрес);
  }

  // ── маршрут на день ─────────────────────────────────────────────────────
  console.log('\n=== маршрут на день ===');
  await открыть('/?country=places');
  // Маршрут хранится в браузере. Не очистив его, проверка проверяет
  // остатки прошлого прогона: клик по уже отмеченной точке её снимает.
  await js(`(function(){ try{ localStorage.removeItem('route'); }catch(e){}
    window.__route = []; if(typeof drawRoute === 'function') drawRoute();
    document.querySelectorAll('.plc .toroute').forEach(function(b){
      b.classList.remove('on'); b.textContent = '+ в маршрут'; });
  })(); 1`);
  await sleep(500);

  const естьКнопка = await js(`!!document.querySelector('.plc .toroute')`);
  check('у места есть кнопка «в маршрут»', естьКнопка, 'набрать маршрут не из чего');

  if (естьКнопка) {
    await js(`(function(){
      const b = document.querySelectorAll('.plc .toroute');
      b[0].click(); b[1].click(); b[2].click();
    })(); 1`);
    await sleep(1200);

    const панель = await js(`JSON.stringify({
      видна: !!(document.querySelector('#routeBox') && document.querySelector('#routeBox').offsetParent),
      точек: document.querySelectorAll('#routeBox .rt-item').length,
      текст: (document.querySelector('#routeBox') || {}).textContent || '',
      ссылка: (document.querySelector('#routeGo') || {}).href || '' })`);
    const р = JSON.parse(панель);

    check('панель маршрута появилась', р.видна, 'её не видно');
    check('в маршруте три точки (' + р.точек + ')', р.точек === 3);
    check('показан километраж', /\d+\s*км/.test(р.текст), 'километража нет: ' + р.текст.slice(0, 60));

    // Кнопка ведёт на свою страницу маршрута, а не сразу в Яндекс: там его
    // видно на карте и можно доложить точку. В ссылке должны быть все три.
    const номера = ((р.ссылка.match(/[?&]p=([0-9,]+)/) || [])[1] || '').split(',').filter(Boolean);
    check('в ссылке на маршрут все три точки (' + номера.length + ')', номера.length === 3,
          р.ссылка.slice(0, 120));
    check('ведёт на страницу маршрута', /\/marshrut\?p=/.test(р.ссылка), р.ссылка.slice(0, 80));

    // порядок объезда: каждый следующий должен быть ближайшим из оставшихся
    const порядок = await js(`JSON.stringify((window.__route || []).map(function(p){ return [p.lat, p.lng]; }))`);
    const т = JSON.parse(порядок || '[]');
    const км = (a, b) => {
      const t = Math.PI / 180, x = (b[0] - a[0]) * t, y = (b[1] - a[1]) * t;
      const h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(y / 2) ** 2;
      return 6371 * 2 * Math.asin(Math.sqrt(h));
    };
    let разумный = т.length === 3;
    if (разумный) {
      // от первой точки вторая должна быть ближе третьей
      разумный = км(т[0], т[1]) <= км(т[0], т[2]) + 0.001;
    }
    check('точки идут в порядке объезда', разумный,
          'порядок не оптимизирован: ' + JSON.stringify(т));

    // снять точку
    await js(`document.querySelectorAll('.plc .toroute')[0].click(); 1`);
    await sleep(900);
    const после = await js(`document.querySelectorAll('#routeBox .rt-item').length`);
    check('точку можно убрать из маршрута (' + после + ')', после === 2);
  }

  // ── переход к странице маршрута ────────────────────────
  console.log('\n=== переход к странице маршрута ===');
  {
    const ссылка = await js(`(document.querySelector('#routeGo') || {}).getAttribute('href') || ''`);
    check('панель ведёт на свою страницу маршрута', /^\/marshrut\?p=/.test(ссылка),
          'ведёт сразу наружу: ' + ссылка.slice(0, 60));
    const залипшая = await js(`!!(document.querySelector('#routeBar') && document.querySelector('#routeBar').offsetHeight)`);
    check('внизу видна кнопка перехода к маршруту', залипшая,
          'до маршрута надо докручивать страницу вручную');
  }
} finally {
  console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
  try { ws.close(); } catch {}
  chrome.kill();
}
process.exit(failed ? 1 : 0);
