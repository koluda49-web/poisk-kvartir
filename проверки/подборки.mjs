// Сезонные подборки: /podborka/<slug> и чипы «Подборки:» на главной.
//
// Зачем. Подборки — готовые идеи поездок и темы для роликов, ссылку на них
// будут открывать с телефона. Проверяем, что в каждой подборке 10–16 карточек
// и все точки есть в справочнике (номер, пропавший из kudin.by, тихо съел бы
// карточку); что «+ в маршрут» пишет в localStorage.route ровно тот формат,
// что и главная, и не дублирует точки; что «Собрать маршрут из подборки» ведёт
// на /marshrut с первыми восемью точками; что на главной первым идёт чип
// текущего сезона по дате посетителя, а «С детьми» — последним.
//
// Сервер должен быть запущен.
//   node проверки/подборки.mjs
//   node проверки/подборки.mjs http://127.0.0.1:8095
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
  check(п.slug + ': «Собрать маршрут» — первые 8 точек', собрать === '/marshrut?p=' + карточки.slice(0, 8).join(','), собрать);
}

for (const slug of ['net', 'constructor', '__proto__', 'toString']) {
  const r = await fetch(SITE + '/podborka/' + slug);
  const t = await r.text();
  check('/podborka/' + slug + ' — 404', r.status === 404, String(r.status));
  if (slug === 'net') check('на странице 404 ссылки на подборки', t.includes('href="/podborka/osen"'));
}
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
check('все подборки в sitemap.xml', ПОДБОРКИ.every(п => карта.includes('<loc>' + ОСНОВА + '/podborka/' + п.slug + '</loc>')));

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
const точка = (await (await fetch(SITE + '/api/places?light=1')).json()).items.find(p => String(p.id) === первый);

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
const ждёмP = [...(await js(`JSON.stringify([].map.call(document.querySelectorAll('button.add'), function(b){ return b.dataset.id; }))`).then(JSON.parse))].slice(0, 8);
await js(`document.querySelector('a.build').click(); 1`);
await ждать(`location.pathname === '/marshrut'`);
check('«Собрать маршрут» открыл /marshrut?p= с 8 точками подборки', (await js(`location.pathname + location.search`)) === '/marshrut?p=' + ждёмP.join(','), await js(`location.pathname + location.search`));
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
