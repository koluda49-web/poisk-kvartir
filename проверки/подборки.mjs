// Сезонные подборки: /podborka/<slug> и чипы «Подборки:» на главной.
//
// Зачем. Подборки — готовые идеи поездок и темы для роликов, ссылку на них
// будут открывать с телефона. Проверяем, что в каждой подборке 10–16 карточек
// и все точки есть в справочнике (номер, пропавший из kudin.by, тихо съел бы
// карточку); что «+ в маршрут» пишет в localStorage.route ровно тот формат,
// что и главная, и не дублирует точки; что «Собрать маршрут из подборки» ведёт
// на /marshrut с первыми восемью точками; что на главной первым идёт чип
// текущего сезона по дате посетителя, а «С детьми» — последним. «Собрать
// маршрут» должен брать самую тесную восьмёрку мест, а не первые восемь:
// иначе выходит поездка через всю страну. Отдельный экземпляр сервера
// на 8099 со своим файлом подборок проверяет, что пропавший из справочника
// номер просто пропускается, а месяцы вне 1..12 отбрасываются.
//
// Сервер должен быть запущен.
//   node проверки/подборки.mjs
//   node проверки/подборки.mjs http://127.0.0.1:8095
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9607, sleep = ms => new Promise(r => setTimeout(r, ms));
const ПОДБОРКИ = JSON.parse(readFileSync(new URL('../подборки.json', import.meta.url), 'utf8'));
const ОСНОВА = 'https://poisk-kvartir.onrender.com';

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// ── без браузера ─────────────────────────────────────────────────────────
const справочник = await (await fetch(SITE + '/api/places?light=1')).json();
const номера = new Set((справочник.items || []).map(p => String(p.id)));
check('справочник мест загружен', номера.size > 100, String(номера.size));
const поНомеру = new Map((справочник.items || []).map(p => [String(p.id), p]));

// Самая тесная группа до 8 мест — считаем здесь сами, не глядя на сервер:
// для каждого места — оно и 7 ближайших по прямой, берём наименьшую сумму.
function км(a, b) {
  const t = Math.PI / 180, x = (b.lat - a.lat) * t, y = (b.lng - a.lng) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function теснаяГруппа(места) {
  if (места.length <= 8) return места.map(p => String(p.id));
  let лучшая = null, сумма = Infinity;
  for (const p of места) {
    const ближние = места.filter(q => q !== p).map(q => ({ q, d: км(p, q) })).sort((a, b) => a.d - b.d).slice(0, 7);
    const с = ближние.reduce((x, b) => x + b.d, 0);
    if (с < сумма) { сумма = с; лучшая = [p, ...ближние.map(b => b.q)]; }
  }
  return лучшая.map(p => String(p.id));
}
const какМножество = a => [...a].sort().join(',');
check('парк-отеля «Версаль» (910025) нет ни в одной подборке', ПОДБОРКИ.every(п => !п.ids.includes(910025)));

const slugs = ['osen', 'zima', 'vesna', 'leto-u-vody', 's-detmi'];
for (const s of slugs) check('в файле есть подборка ' + s, ПОДБОРКИ.some(п => п.slug === s));
check('«С детьми» — на весь год (months: null)', (ПОДБОРКИ.find(п => п.slug === 's-detmi') || {}).months === null);
check('в осенней подборке есть корпус ГрГУ (910022)', (ПОДБОРКИ.find(п => п.slug === 'osen') || { ids: [] }).ids.includes(910022));
check('в летней подборке есть шлюз «Немново» (910023)', (ПОДБОРКИ.find(п => п.slug === 'leto-u-vody') || { ids: [] }).ids.includes(910023));

for (const п of ПОДБОРКИ) {
  const нет = п.ids.filter(id => !номера.has(String(id)));
  check(п.slug + ': все номера из файла есть в справочнике', !нет.length, нет.join(','));
  check(п.slug + ': номера без повторов', new Set(п.ids).size === п.ids.length);
  const ответ = await fetch(SITE + '/podborka/' + п.slug);
  const html = await ответ.text();
  check('/podborka/' + п.slug + ' — 200', ответ.status === 200, String(ответ.status));
  check(п.slug + ': кэш public, max-age=600', ответ.headers.get('cache-control') === 'public, max-age=600', ответ.headers.get('cache-control'));
  const карточки = [...html.matchAll(/<button class="add"[^>]*data-id="(\d+)"/g)].map(m => m[1]);
  check(п.slug + ': карточек 10..16', карточки.length >= 10 && карточки.length <= 16, String(карточки.length));
  check(п.slug + ': все карточки — места справочника', карточки.every(id => номера.has(id)));
  check(п.slug + ': индексируется, canonical', /<meta name="robots" content="index,follow">/.test(html)
    && html.includes('<link rel="canonical" href="' + ОСНОВА + '/podborka/' + п.slug + '">'));
  check(п.slug + ': og:title и og:image', html.includes('<meta property="og:title"')
    && /<meta property="og:image" content="https?:\/\/[^"]+">/.test(html));
  check(п.slug + ': ссылки «Подробнее» на страницы мест', (html.match(/<a class="more" href="\/mesto\/\d+-[a-z0-9-]+">Подробнее<\/a>/g) || []).length === карточки.length);
  check(п.slug + ': «← Ко всем местам» и ссылки на другие подборки', html.includes('href="/?country=places">← Ко всем местам</a>')
    && ПОДБОРКИ.filter(д => д.slug !== п.slug).every(д => html.includes('href="/podborka/' + д.slug + '"')));
  const собрать = (html.match(/<a class="build" href="([^"]+)">Собрать маршрут из подборки<\/a>/) || [])[1] || '';
  const вСсылке = собрать.replace(/^\/marshrut\?p=/, '').split(',');
  const ждём = теснаяГруппа(п.ids.map(id => поНомеру.get(String(id))).filter(Boolean));
  check(п.slug + ': «Собрать маршрут» — самые близкие друг к другу 8 мест', /^\/marshrut\?p=[0-9,]+$/.test(собрать)
    && вСсылке.length === 8 && какМножество(вСсылке) === какМножество(ждём), собрать + '  ждали: ' + ждём.join(','));
  check(п.slug + ': подпись под кнопкой', html.includes('<span class="bnote">8 мест, которые ближе всего друг к другу</span>'));
}

{
  const r = await fetch(SITE + '/podborka/osen/');
  const t = await r.text();
  check('/podborka/osen/ со слешем — 200, та же подборка', r.status === 200 && t.includes('<link rel="canonical" href="' + ОСНОВА + '/podborka/osen">'), String(r.status));
}
for (const slug of ['net', 'constructor', '__proto__', 'toString']) {
  const r = await fetch(SITE + '/podborka/' + slug);
  const t = await r.text();
  check('/podborka/' + slug + ' — 404', r.status === 404, String(r.status));
  if (slug === 'net') check('на странице 404 ссылки на подборки', t.includes('href="/podborka/osen"'));
}
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
check('все подборки в sitemap.xml', ПОДБОРКИ.every(п => карта.includes('<loc>' + ОСНОВА + '/podborka/' + п.slug + '</loc>')));

// ── свой файл подборок: пропавший номер и неверные месяцы ────────────────
{
  const ПОРТ2 = 8099, САЙТ2 = 'http://127.0.0.1:' + ПОРТ2;
  const папка = process.env.TEMP + '/podborki-test-' + process.pid;
  const настоящие = ПОДБОРКИ.find(п => п.slug === 'osen').ids.slice(0, 10);
  const файл = папка + '-podborki.json';
  writeFileSync(файл, JSON.stringify([
    { slug: 'proba', chip: 'Проба', title: 'Проба', months: [0, 13, 9, 'x'], intro: 'Проба.', ids: [...настоящие.slice(0, 5), 999999999, ...настоящие.slice(5)] },
    { slug: 'kruglyj-god', chip: 'Круглый год', title: 'Круглый год', months: [0, 13], intro: 'Проба.', ids: настоящие },
  ]));
  const второй = spawn(process.execPath, ['kvartiry-server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(ПОРТ2), PODBORKI_FILE: файл, DATA_DIR: папка, STATS_FILE: папка + '/stats.json',
           KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' },
    stdio: 'ignore',
  });
  try {
    let готов = false;
    for (let i = 0; i < 120 && !готов; i++) {
      try { готов = ((await (await fetch(САЙТ2 + '/api/places?light=1', { signal: AbortSignal.timeout(5000) })).json()).items || []).length > 100; } catch {}
      if (!готов) await sleep(1000);
    }
    check('второй сервер с PODBORKI_FILE запустился', готов);
    const r = await fetch(САЙТ2 + '/podborka/proba');
    const t = await r.text();
    const ид = [...t.matchAll(/<button class="add"[^>]*data-id="(\d+)"/g)].map(m => m[1]);
    check('номер, которого нет в справочнике, пропущен: 200 и 10 карточек', r.status === 200 && ид.length === 10 && !ид.includes('999999999'), r.status + ' / ' + ид.length);
    check('в «Собрать маршрут» нет пропавшего номера', !/999999999/.test(t));
    const главная = await (await fetch(САЙТ2 + '/?country=places')).text();
    check('месяцы вне 1..12 отброшены: data-m="9"', главная.includes('<a class="pl-chip" href="/podborka/proba" data-m="9">'));
    check('не осталось ни одного месяца — подборка на весь год, в конце',
      /href="\/podborka\/proba"[^>]*>Проба<\/a><a class="pl-chip" href="\/podborka\/kruglyj-god" data-m="">/.test(главная));
  } finally {
    второй.kill();   // ровно наш процесс, по его pid
    await new Promise(r => { if (второй.exitCode !== null) r(); else { второй.once('exit', r); setTimeout(r, 3000); } });
    try { rmSync(файл, { force: true }); rmSync(папка, { recursive: true, force: true }); } catch {}
  }
}

// ── в браузере ───────────────────────────────────────────────────────────
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-podborki-' + process.pid,
  'about:blank'], { stdio: 'ignore' });
// упала проверка — Chrome за собой не оставляем
process.on('unhandledRejection', e => { console.log('ОШИБКА ПРОВЕРКИ: ' + (e && e.message || e)); chrome.kill(); process.exit(1); });
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 40) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };
const маршрут = () => js(`localStorage.getItem('route')`).then(t => JSON.parse(t || '[]'));

const осень = ПОДБОРКИ.find(п => п.slug === 'osen');
const [первый, второй] = осень.ids.map(String);
const точка = поНомеру.get(первый);

// в маршруте уже есть первая точка подборки — как будто её добавили на главной
await send('Page.navigate', { url: SITE + '/podborka/osen' });
await ждать(`document.readyState === 'complete'`);
await js(`localStorage.clear(); localStorage.setItem('route', JSON.stringify([${JSON.stringify({ id: точка.id, name: точка.name, addr: точка.addr || '', lat: точка.lat, lng: точка.lng })}])); 1`);
await send('Page.reload');
await ждать(`document.readyState === 'complete' && !!document.querySelector('button.add')`);
const кнопка = n => `document.querySelector('button.add[data-id="${n}"]')`;
check('уже добавленная точка показана «✓ в маршруте»', (await js(`${кнопка(первый)}.textContent`)) === '✓ в маршруте', await js(`${кнопка(первый)}.textContent`));
check('остальные — «+ в маршрут»', (await js(`${кнопка(второй)}.textContent`)) === '+ в маршрут');
check('полоска «Мой маршрут: 1 точка →» видна', await js(`(function(){ var b = document.getElementById('routeBar'); return !!b && !b.hidden && b.getBoundingClientRect().height > 0 && b.textContent === 'Мой маршрут: 1 точка →'; })()`), await js(`document.getElementById('routeBar').textContent`));

await js(`${кнопка(второй)}.click(); 1`);
let r = await маршрут();
check('«+ в маршрут» добавил точку в localStorage.route', r.length === 2 && String(r[1].id) === второй, JSON.stringify(r).slice(0, 160));
check('точка в формате главной {id,name,addr,lat,lng}, номер — числом', r.length === 2
  && JSON.stringify(Object.keys(r[1])) === '["id","name","addr","lat","lng"]'
  && typeof r[1].id === 'number' && typeof r[1].lat === 'number' && typeof r[1].lng === 'number' && r[1].name.length > 0,
  JSON.stringify(r[1]));
check('кнопка стала «✓ в маршруте»', (await js(`${кнопка(второй)}.textContent`)) === '✓ в маршруте');
check('первая точка не задвоилась', r.filter(p => String(p.id) === первый).length === 1);
check('routeOrder не тронут', (await js(`localStorage.getItem('routeOrder')`)) === null);
check('полоска показывает 2 точки', (await js(`document.getElementById('routeBar').textContent`)) === 'Мой маршрут: 2 точки →');
await js(`${кнопка(второй)}.click(); 1`);
r = await маршрут();
check('повторное нажатие убирает точку', r.length === 1 && String(r[0].id) === первый, JSON.stringify(r).slice(0, 120));
await js(`${кнопка(второй)}.click(); 1`);

// маршрут поменяли в другой вкладке — кнопки подхватывают
await js(`localStorage.setItem('route', '[]'); window.dispatchEvent(new StorageEvent('storage', { key: 'route', newValue: '[]' })); 1`);
check('после очистки в другой вкладке кнопки снова «+ в маршрут», полоски нет',
  (await js(`${кнопка(первый)}.textContent`)) === '+ в маршрут' && await js(`document.getElementById('routeBar').hidden`));
await js(`localStorage.setItem('route', JSON.stringify([${JSON.stringify({ id: точка.id, name: точка.name, addr: точка.addr || '', lat: точка.lat, lng: точка.lng })}])); 1`);
await js(`${кнопка(второй)}.click(); 1`);

check('на телефоне сетка в две колонки', (await js(`getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length`)) === 2,
  await js(`getComputedStyle(document.querySelector('.grid')).gridTemplateColumns`));
check('страница не шире экрана', await js(`document.documentElement.scrollWidth <= innerWidth`));

// главная видит точки, добавленные в подборке
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`typeof inRoute === 'function' && !!document.querySelector('#plSets')`, 60);
check('главная видит обе точки из подборки', await js(`inRoute(${первый}) && inRoute(${второй}) && window.__route.length === 2`), await js(`JSON.stringify(window.__route).slice(0,120)`));

// «Собрать маршрут из подборки»
await send('Page.navigate', { url: SITE + '/podborka/osen' });
await ждать(`document.readyState === 'complete' && !!document.querySelector('a.build')`);
const ждёмP = теснаяГруппа(осень.ids.map(id => поНомеру.get(String(id))).filter(Boolean));
await js(`document.querySelector('a.build').click(); 1`);
await ждать(`location.pathname === '/marshrut'`);
const открыт = await js(`location.pathname + location.search`);
check('«Собрать маршрут» открыл /marshrut?p= с самой тесной восьмёркой подборки', открыт.startsWith('/marshrut?p=')
  && какМножество(открыт.replace('/marshrut?p=', '').split(',')) === какМножество(ждёмP), открыт);
check('на /marshrut 8 точек', await ждать(`typeof Т !== 'undefined' && Т.length === 8`), await js(`typeof Т !== 'undefined' ? Т.length : 'нет Т'`));

// ── главная: порядок чипов по дате посетителя ────────────────────────────
async function чипыВДату(iso) {
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
    var R = Date, T = new R('${iso}T12:00:00').getTime();
    function D(){ if(!(this instanceof D)) return new R(T).toString();
      return arguments.length ? new (Function.prototype.bind.apply(R, [null].concat([].slice.call(arguments)))) : new R(T); }
    D.now = function(){ return T; }; D.UTC = R.UTC; D.parse = R.parse; D.prototype = R.prototype;
    Date = D;
  })();` });
  await send('Page.navigate', { url: SITE + '/?country=places' });
  await ждать(`!!document.querySelector('#plSets a.pl-chip') && document.querySelector('#plLinks').offsetParent !== null`, 60);
  const t = await js(`JSON.stringify([].map.call(document.querySelectorAll('#plSets a.pl-chip'), function(a){ return a.textContent; }))`).then(JSON.parse);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return t;
}
let чипы = await чипыВДату('2026-09-15');
check('15 сентября: первым чипом «Осенью»', чипы[0] === 'Осенью', чипы.join(' | '));
check('15 сентября: «С детьми» последним', чипы[чипы.length - 1] === 'С детьми', чипы.join(' | '));
check('чипы видны во вкладке мест, со ссылками на подборки', await js(`(function(){ var a = document.querySelector('#plSets a[href="/podborka/osen"]'); return !!a && a.offsetParent !== null && /Подборки/.test(document.querySelector('#plSets').textContent); })()`));
check('ссылка «Маршруты из видео →» осталась', await js(`!!document.querySelector('#plLinks a[href="/m"]')`));
await js(`setCountry('by', true); 1`);
check('на вкладке жилья чипов не видно', await js(`document.querySelector('#plSets').offsetParent === null`));
чипы = await чипыВДату('2026-04-10');
check('10 апреля: «Весной», «Летом у воды», «Осенью», «Зимой», «С детьми»', чипы.join('|') === 'Весной|Летом у воды|Осенью|Зимой|С детьми', чипы.join(' | '));
чипы = await чипыВДату('2027-01-20');
check('20 января: первым «Зимой», «С детьми» последним', чипы[0] === 'Зимой' && чипы[4] === 'С детьми', чипы.join(' | '));

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
