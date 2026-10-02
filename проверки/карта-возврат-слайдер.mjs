// Страница места и карточки жилья в настоящем браузере (01.10.2026, пять просьб владельца):
//  1. на странице места есть кнопка «Посмотреть на карте»: главная открывается сразу
//     на карте мест, эта точка в центре, окошко открыто;
//  2. «Ко всем местам» с подборки («с детьми») возвращает на подборку, а не в общий список;
//  3. «Где переночевать рядом» — обычные варианты по типичной цене, как на главной,
//     а не самые дешёвые;
//  4. в карусели карточек жилья следующий снимок подгружается заранее, а при медленной
//     сети остаётся прежний кадр с крутилкой;
//  5. страница места открывается быстро, когда кэш тёплый.
//
// Сервер должен быть запущен, каталоги досок собраны.
//   node проверки/карта-возврат-слайдер.mjs http://127.0.0.1:8241
import { запуститьChrome } from './_браузер.mjs';
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9571, sleep = ms => new Promise(r => setTimeout(r, ms));
const { закрыть } = запуститьChrome(PORT, 'kvs');
let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const открыть = async путь => { await send('Page.navigate', { url: SITE + путь }); await sleep(2500); };
const ждать = async (условие, сек = 25) => { for (let i = 0; i < сек * 4; i++) { if (await js(условие)) return true; await sleep(250); } return false; };

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

const МЕСТО = '910089';   // Минская ратуша — в центре Минска, жильё рядом есть всегда

console.log('=== кнопка «Посмотреть на карте» ===');
const html = await (await fetch(SITE + '/mesto/' + МЕСТО + '-minskaya-ratusha')).text();
check('на странице места есть кнопка со ссылкой на карту этой точки',
      html.includes('href="/?country=places&amp;view=map&amp;place=' + МЕСТО + '"') && html.includes('Посмотреть на карте'));
check('«Ко всем местам» осталась', html.includes('id="back"') && html.includes('Ко всем местам'));

await открыть('/?country=places&view=map&place=' + МЕСТО);
check('главная открылась на карте мест', await ждать(`window.__view === 'map' && window.__mode === 'places' && !!window.__plMarkers && !!window.__plMarkers[${МЕСТО}]`));
check('окошко точки открыто', await ждать(`!!document.querySelector('.leaflet-popup .mp-pl') && /ратуша/i.test(document.querySelector('.leaflet-popup').textContent)`),
      await js(`(document.querySelector('.leaflet-popup')||{}).textContent`));
const центр = JSON.parse(await js(`JSON.stringify(window.__map ? [window.__map.getCenter().lat, window.__map.getCenter().lng, window.__map.getZoom()] : null)`) || 'null');
check('карта приближена к точке', !!центр && Math.abs(центр[0] - 53.9) < 0.1 && Math.abs(центр[1] - 27.56) < 0.15 && центр[2] >= 12, JSON.stringify(центр));
check('карта на экране, список скрыт', await js(`document.getElementById('map').style.display !== 'none' && document.getElementById('grid').style.display === 'none'`));

console.log('\n=== «Ко всем местам» с подборки возвращает на подборку ===');
await открыть('/podborka/s-detmi');
const ссылка = await js(`(document.querySelector('a[href^="/mesto/"]')||{}).getAttribute && document.querySelector('a[href^="/mesto/"]').getAttribute('href')`);
check('на подборке есть ссылки на места', !!ссылка, 'не нашли ссылку /mesto/');
if (ссылка) {
  await js(`document.querySelector('a[href^="/mesto/"]').click(); 1`);
  await ждать(`location.pathname.indexOf('/mesto/') === 0 && !!document.getElementById('back')`);
  await sleep(500);
  const назад = await js(`document.getElementById('back').href`);
  check('ссылка «Ко всем местам» ведёт на подборку', /\/podborka\/s-detmi$/.test(назад || ''), назад);
  await js(`document.getElementById('back').click(); 1`);
  await ждать(`location.pathname.indexOf('/podborka/') === 0`, 10);
  check('после нажатия — снова подборка «с детьми»', (await js('location.pathname')) === '/podborka/s-detmi', await js('location.pathname'));
}

console.log('\n=== жильё рядом: обычные варианты, а не самые дешёвые ===');
{
  const стр = await (await fetch(SITE + '/mesto/' + МЕСТО + '-minskaya-ratusha')).text();
  const дешевле = (стр.match(/самый дешёвый — (\d+) BYN/) || [])[1];
  const цены = [...стр.matchAll(/<div class="p">(?:от )?(\d+) BYN/g)].map(m => +m[1]);
  check('на странице есть карточки жилья (' + цены.length + ')', цены.length >= 4, 'карточек ' + цены.length);
  check('первая карточка не самая дешёвая (' + цены[0] + ' BYN при минимуме ' + дешевле + ')', !!дешевле && цены[0] > +дешевле);
  const км = [...стр.matchAll(/<div class="m"><span>([\d.]+) км<\/span>/g)].map(m => +m[1]);
  // С 02.10 площадки внутри одной цены идут по очереди, а ближайшее жильё всегда среди карточек —
  // поэтому проверяем не порядок по расстоянию, а что «ближайшее в N км» правда есть в блоке.
  const ближайшее = +((стр.match(/ближайшее в ([\d.]+) км/) || [])[1] || NaN);
  check('«ближайшее в N км» — среди карточек и правда ближе всех', км.length < 2 || (isFinite(ближайшее) && км.includes(ближайшее) && Math.min(...км) === ближайшее), 'фраза ' + ближайшее + ', карточки ' + км.join(', '));
  const stay = await (await fetch(SITE + '/api/places/stay?lat=53.9023&lng=27.5619&r=30')).json();
  const ц2 = (stay.items || []).map(x => x.price);
  check('то же в блоке «жильё рядом» на карте (' + ц2.slice(0, 6).join(', ') + ')', ц2.length >= 6 && ц2[0] > +дешевле);
}

console.log('\n=== карусель карточек: следующий снимок заранее ===');
await открыть('/?region=minsk&type=flat&source=kufar');
await ждать(`document.querySelectorAll('#grid .card').length > 3`, 40);
const карт = JSON.parse(await js(`JSON.stringify((function(){ var a=window.__items||[]; for(var i=0;i<Math.min(a.length,24);i++){ if((a[i].photos||[]).length>=3) return {i:i, ph:a[i].photos.slice(0,3)}; } return null; })())`) || 'null');
check('есть карточка с тремя снимками и крутилкой', !!карт);
if (карт) {
  await js(`document.getElementById('im${карт.i}').scrollIntoView({block:'center'}); 1`);
  await sleep(4000);
  check('второй снимок подгружен заранее, до нажатия', !!(await js(`window.__pre && window.__pre[${JSON.stringify(карт.ph[1])}]`)));
  await js(`document.querySelector('#im${карт.i}').parentNode.querySelector('.nav.next').click(); 1`);
  check('счётчик сразу показывает 2', (await js(`document.getElementById('cnt${карт.i}').textContent`)).startsWith('2/'));
  check('показан второй снимок', await ждать(`document.getElementById('im${карт.i}').src === ${JSON.stringify(карт.ph[1])}`, 8));
  check('третий снимок уже запрошен', !!(await js(`window.__pre && window.__pre[${JSON.stringify(карт.ph[2])}]`)));
  // медленная сеть: берём карточку внизу страницы — её снимки ещё не трогали, в кэше их нет
  const дальняя = JSON.parse(await js(`JSON.stringify((function(){ var a=window.__items||[]; for(var i=Math.min(a.length,24)-1;i>${карт.i};i--){ if((a[i].photos||[]).length>=3 && !(window.__pre||{})[a[i].photos[1]]) return {i:i, ph:a[i].photos.slice(0,3)}; } return null; })())`) || 'null');
  if (!дальняя) check('все снимки в зоне экрана уже подгружены заранее — крутилка не понадобилась', true);
  if (дальняя) {
    // уникальная метка в адресе — чтобы снимок шёл по сети, а не из кэша браузера
    дальняя.ph[1] = дальняя.ph[1] + '?cb=' + Date.now();
    await js(`window.__items[${дальняя.i}].photos[1] = ${JSON.stringify(дальняя.ph[1])}; 1`);
    await send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 20 * 1024, uploadThroughput: 20 * 1024 });
    // Эмуляция сети в тестовом Chrome действует не всегда (запросы через сервис-воркер
    // она не замедляет). Сперва убеждаемся, что свежий снимок правда идёт медленно.
    const замер = await js(`new Promise(function(r){ var t0=performance.now(), i=new Image(); i.onload=i.onerror=function(){ r(Math.round(performance.now()-t0)); }; i.src=${JSON.stringify(дальняя.ph[2])}+'?cb='+Date.now(); })`);
    const медленно = замер >= 1200;
    if (!медленно) { check('эмуляция медленной сети в этом Chrome не сработала (' + замер + ' мс) — проверка крутилки пропущена', true); }
    await js(`document.getElementById('im${дальняя.i}').parentNode.querySelector('.nav.next').click(); 1`);
    await sleep(300);
    if (медленно) check('при медленной сети: крутилка включена, кадр прежний',
          (await js(`document.getElementById('im${дальняя.i}').parentNode.classList.contains('ld')`)) === true
          && (await js(`document.getElementById('im${дальняя.i}').src`)) === дальняя.ph[0],
          await js(`JSON.stringify({ld: document.getElementById('im${дальняя.i}').parentNode.className, src: document.getElementById('im${дальняя.i}').src.slice(-30), ph0: ${JSON.stringify(дальняя.ph[0].slice(-30))}, pre1: (window.__pre||{})[${JSON.stringify(дальняя.ph[1])}], idx: (window.__idx||{})[${дальняя.i}]})`));
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    if (медленно) check('когда снимок загрузился — показан он, крутилка выключена',
          await ждать(`document.getElementById('im${дальняя.i}').src === ${JSON.stringify(дальняя.ph[1])} && !document.getElementById('im${дальняя.i}').parentNode.classList.contains('ld')`, 40));
  }
}

console.log('\n=== ошибки в скриптах страниц ===');
check('исключений на странице нет', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));

console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
