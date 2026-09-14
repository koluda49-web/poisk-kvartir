// Рекомендуемые маршруты, SEO маршрутов и точек, карточка точки на странице
// маршрута и «Вернуть мой порядок».
//
// Зачем. Ссылку /m/lida-voronovo дают в ТикТоке — по ней человек с телефона
// должен увидеть ровно маршрут владельца (12 точек, своя точка «Вкусный кофе…»),
// а нажатие на точку — открыть её снимки и описание прямо на странице, как
// окошко на карте во вкладке «Что посетить», а не уводить на другую страницу.
// Поисковику нужны описание, текст и список точек в HTML сразу. Двухдневный
// маршрут по Браславщине — 25 точек: больше старого предела в 20 точек
// и 12 точек маршрутизатора, поэтому дорога считается частями. И отдельно —
// «Вернуть мой порядок»: владелец нажал «Упорядочить автоматически»
// и потерял расставленный руками порядок.
//
// Сервер должен быть запущен (второй экземпляр с поддельным OSRM проверка
// поднимает сама на порту 8196).
//   node проверки/рекомендуемые-маршруты.mjs
//   node проверки/рекомендуемые-маршруты.mjs http://127.0.0.1:8095
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { запуститьChrome, временнаяПапка, удалитьПапку } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9610, sleep = ms => new Promise(r => setTimeout(r, ms));
const корень = join(dirname(fileURLToPath(import.meta.url)), '..');
// снимки экрана — в SHOTS_DIR (например, папку отчёта), по умолчанию во временную папку
const ОТЧЁТ = process.env.SHOTS_DIR || tmpdir();
const МАРШРУТЫ = JSON.parse(readFileSync(join(корень, 'маршруты-из-видео.json'), 'utf8'));
const лв = МАРШРУТЫ.find(м => м.slug === 'lida-voronovo');
const бр = МАРШРУТЫ.find(м => м.slug === 'braslavshchina-2-dnya');

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));
const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const getText = async u => (await fetch(SITE + u)).text();
const idТочки = t => String(t).split('~')[0];

// ── без браузера: данные ─────────────────────────────────────────────────
check('в файле первым идёт lida-voronovo', МАРШРУТЫ[0] && МАРШРУТЫ[0].slug === 'lida-voronovo');
check('lida-voronovo: 12 точек в порядке ссылки владельца', JSON.stringify(лв.points.map(idТочки)) === JSON.stringify(
  ['910032', '5069', '910031', '910026', '910030', '910027', '910033', 'm54.15020_25.31685', '910029', '5099', '5068', '285']));
check('braslavshchina-2-dnya: 25 точек, два дня, ночёвка после 11-й', бр && бр.points.length === 25 && бр.days === 2 && бр.overnightAfter === 11);

// ── главная: лента «Рекомендуемые маршруты» ──────────────────────────────
const главная = await getText('/?country=places');
const лента = (главная.match(/<section class="pl-rec" id="plRec"[\s\S]*?<\/section>/) || [''])[0];
check('на главной есть лента #plRec', !!лента);
check('лента стоит между #plLinks и #plPop', главная.indexOf('id="plLinks"') < главная.indexOf('id="plRec"') && главная.indexOf('id="plRec"') < главная.indexOf('id="plPop"'));
const ссылкиЛенты = [...лента.matchAll(/<a class="rec-c" href="([^"]+)"/g)].map(m => m[1]);
check('в ленте карточки обоих маршрутов, lida-voronovo первой', JSON.stringify(ссылкиЛенты) === JSON.stringify(МАРШРУТЫ.map(м => '/m/' + м.slug)), ссылкиЛенты.join(' '));
check('в ленте название, note и «12 мест»', лента.includes(escHtml(лв.title)) && лента.includes(escHtml(лв.note)) && лента.includes('12 мест'));
check('у двухдневного в ленте «2 дня · 25 мест»', лента.includes('2 дня · 25 мест'));
check('ссылка «Все маршруты →», «Маршруты из видео» больше нет', главная.includes('>Все маршруты →</a>') && !главная.includes('Маршруты из видео'));

// ── /m ───────────────────────────────────────────────────────────────────
const спис = await getText('/m');
check('/m: h1 «Рекомендуемые маршруты»', спис.includes('<h1>Рекомендуемые маршруты</h1>'));
check('/m: title и og:title про рекомендуемые маршруты', /<title>Рекомендуемые маршруты[^<]*<\/title>/.test(спис) && /<meta property="og:title" content="Рекомендуемые маршруты/.test(спис));
check('/m: карточки со ссылками на оба маршрута', спис.includes('<a class="c" href="/m/lida-voronovo">') && спис.includes('<a class="c" href="/m/braslavshchina-2-dnya">'));
check('/m: note на карточке', спис.includes('<p class="note">' + escHtml(лв.note) + '</p>'));
check('/m: «12 мест», «25 мест», «2 дня» и километры', спис.includes('>12 мест<') && спис.includes('>25 мест<') && спис.includes('>2 дня<') && /км( по дорогам)?<\/span>/.test(спис));

// ── /m/lida-voronovo: SEO ────────────────────────────────────────────────
const лвHtml = await getText('/m/lida-voronovo');
const desc = (лвHtml.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '';
const descText = desc.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
check('description из файла, 120–160 знаков', descText === лв.description && descText.length >= 120 && descText.length <= 160, descText.length + ': ' + descText);
check('og:description тот же', лвHtml.includes('<meta property="og:description" content="' + desc + '">'));
check('h1 — новое название', лвHtml.includes('<h1>' + escHtml(лв.title) + '</h1>'));
const строкиСервера = [...лвHtml.matchAll(/<button class="x" type="button" title="убрать" data-id="([^"]+)">/g)].map(m => m[1]);
check('в HTML 12 строк в порядке ссылки', JSON.stringify(строкиСервера) === JSON.stringify(лв.points.map(idТочки)), строкиСервера.join(','));
check('своя точка «Вкусный кофе можно взять по дороге»', лвHtml.includes('📍 Вкусный кофе можно взять по дороге</b>'));
const абзацы = (лвHtml.match(/<section class="about" id="rAbout">([\s\S]*?)<\/section>/) || ['', ''])[1];
check('абзацы текста под маршрутом — все из файла', лв.text.every(а => абзацы.includes('<p>' + escHtml(а) + '</p>')), абзацы.slice(0, 120));
check('в тексте про кофе в Вороново и километры от Минска', /Вороново можно взять кофе/.test(абзацы) && /от Минска/i.test(абзацы) && /около \d+ км/.test(абзацы));
const ld = [...лвHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } });
const список = ld.find(x => x && x['@type'] === 'ItemList');
check('JSON-LD разбирается и в нём ItemList из 12 точек', !!список && ld.every(Boolean) && список.itemListElement.length === 12);
const э2 = список && список.itemListElement[1].item;
check('у точки справочника в ItemList name, description, url /mesto/…, geo', !!э2 && э2.name && э2.description && /\/mesto\/5069-/.test(э2.url) && э2.geo && typeof э2.geo.latitude === 'number', JSON.stringify(э2));
const э8 = список && список.itemListElement[7].item;
check('у своей точки в ItemList без url, но с geo', !!э8 && !э8.url && э8.geo, JSON.stringify(э8));
const кратко = [...лвHtml.matchAll(/<span class="ds">([^<]*)<\/span>/g)].map(m => m[1]);
check('короткие описания точек в HTML сразу (не меньше 5)', кратко.length >= 5, кратко.length);
check('короткие описания не длиннее 160 знаков', кратко.every(т => т.replace(/&[a-z]+;/g, '_').length <= 160));
check('названия — ссылки на /mesto/<id>-<slug>', /<a class="nm" href="\/mesto\/5069-[a-z0-9-]+"/.test(лвHtml));

// ── /m/braslavshchina-2-dnya ─────────────────────────────────────────────
const брHtml = await getText('/m/braslavshchina-2-dnya');
check('/m/braslavshchina-2-dnya: 25 строк в HTML', (брHtml.match(/<div class="it">/g) || []).length === 25);
check('ссылка «Подробный рассказ о маршруте →»', брHtml.includes('<a href="/marshrut-braslavshchina">Подробный рассказ о маршруте →</a>'));
check('ночёвка после 11-й передана странице', брHtml.includes('var НОЧЁВКА_МАРШРУТА = 11;'));
const брD = ((брHtml.match(/<meta name="description" content="([^"]*)">/) || [])[1] || '').replace(/&quot;/g, '"');
check('description 120–160 знаков', брD.length >= 120 && брD.length <= 160, брD.length);
check('/marshrut-braslavshchina открывается', (await fetch(SITE + '/marshrut-braslavshchina')).status === 200);

// ── страницы мест и мелочи ───────────────────────────────────────────────
const место = await getText('/mesto/5069');
check('страница места: «Входит в маршрут: …» со ссылкой на /m/lida-voronovo', место.includes('Входит в маршрут: <a href="/m/lida-voronovo">' + escHtml(лв.title) + ' →</a>'));
const маяк = await getText('/mesto/4324');
check('Гора Маяк входит в маршрут по Браславщине', маяк.includes('<a href="/m/braslavshchina-2-dnya">'));
const карта = await getText('/sitemap.xml');
check('в sitemap.xml есть /m/braslavshchina-2-dnya', карта.includes('/m/braslavshchina-2-dnya</loc>'));
const поиск = await (await fetch(SITE + '/api/places?q=' + encodeURIComponent('Оссово'))).json();
check('/api/places: поиск по другому написанию работает', (поиск.items || []).some(p => String(p.id) === '910029'));
check('/api/places: служебного alt в ответе нет', (поиск.items || []).length > 0 && поиск.items.every(p => !('alt' in p)));

// ── дорога частями: второй экземпляр с поддельным OSRM ───────────────────
{
  const запросы = [];
  const osrm = createServer((req, res) => {
    const m = req.url.match(/\/route\/v1\/driving\/([^?]+)/);
    const coords = m ? decodeURIComponent(m[1]).split(';').map(x => x.split(',').map(Number)) : [];
    запросы.push(coords.length);
    const legs = coords.slice(1).map(() => ({ distance: 10000, duration: 600 }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 10000 * legs.length, duration: 600 * legs.length, legs, geometry: { coordinates: coords } }] }));
  });
  await new Promise(r => osrm.listen(9625, '127.0.0.1', r));
  // «kudin.by лежит»: описания точек спрашиваются у сервера, который принимает
  // соединение и молчит. Страница маршрута должна заплатить ожиданием один раз.
  const висят = [];
  const мёртвый = createServer((req, res) => { висят.push(res); });
  await new Promise(r => мёртвый.listen(9627, '127.0.0.1', r));
  let вМёртвый = 0;
  мёртвый.on('request', () => { вМёртвый++; });

  const папка = временнаяПапка('rec-routes-');   // раньше оставалась в %TEMP% после каждого прогона
  const сервер = spawn(process.execPath, ['kvartiry-server.js'], { cwd: корень, stdio: 'ignore', env: Object.assign({}, process.env, {
    PORT: '8196', OSRM_URL: 'http://127.0.0.1:9625', KUDIN_DETAIL_URL: 'http://127.0.0.1:9627', DATA_DIR: папка, STATS_FILE: join(папка, 'stats.json'),
    KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off', GH_TOKEN: '', RENDER_EXTERNAL_URL: '' }) });
  const гасить2 = () => { try { сервер.kill(); } catch {} };
  process.on('exit', гасить2);
  let готов = false;
  for (let i = 0; i < 60 && !готов && сервер.exitCode === null; i++) {
    try { готов = (await fetch('http://127.0.0.1:8196/ping')).ok; } catch {}
    if (!готов) await sleep(500);
  }
  check('второй экземпляр с поддельным OSRM поднялся', готов);
  if (готов) {
    const пары = Array.from({ length: 25 }, (_, i) => (54 + i * 0.05).toFixed(5) + ',' + (27 + i * 0.03).toFixed(5)).join(';');
    const r = await (await fetch('http://127.0.0.1:8196/api/route?p=' + encodeURIComponent(пары))).json();
    check('25 точек: /api/route ok, 24 перегона, минуты перегонов', r.ok === true && r.legs.length === 24 && r.legMinutes.length === 24, JSON.stringify(r).slice(0, 120));
    check('25 точек: km и minutes — сумма частей', r.km === 240 && r.minutes === 240, r.km + ' / ' + r.minutes);
    check('25 точек: линия целиком, без повторов на стыках', Array.isArray(r.line) && r.line.length === 25, r.line && r.line.length);
    check('маршрутизатор спрошен частями не больше 12 точек', запросы.length === 3 && запросы.every(n => n <= 12), JSON.stringify(запросы));
    const до = запросы.length;
    await fetch('http://127.0.0.1:8196/api/route?p=' + encodeURIComponent(пары));
    check('повтор — из кэша, в маршрутизатор не ходит', запросы.length === до);
    const r12 = await (await fetch('http://127.0.0.1:8196/api/route?p=' + encodeURIComponent(пары.split(';').slice(1, 13).join(';')))).json();
    // другие 12 точек: первые 12 уже лежат в кэше как первая часть
    check('12 точек — одним запросом, как раньше', r12.ok && r12.legs.length === 11 && запросы.length === до + 1, JSON.stringify(запросы));
    // описания при мёртвом kudin.by: справочник мест сперва загружаем, чтобы мерить только описания
    for (let i = 0; i < 60; i++) { try { if (((await (await fetch('http://127.0.0.1:8196/api/places?light=1')).json()).items || []).length) break; } catch {} await sleep(1000); }
    const мерить = async () => { const t = Date.now(); const о = await fetch('http://127.0.0.1:8196/m/braslavshchina-2-dnya'); const h = await о.text(); return { мс: Date.now() - t, код: о.status, строк: (h.match(/<div class="it">/g) || []).length }; };
    const п1 = await мерить();
    const запросовПосле1 = вМёртвый;
    const п2 = await мерить();
    check('kudin.by молчит: первый показ /m/… — 200 и все 25 точек, ждём описания не дольше ~3,5 с', п1.код === 200 && п1.строк === 25 && п1.мс < 6000, JSON.stringify(п1));
    check('kudin.by молчит: повторный показ быстрый (описания не ждём снова)', п2.код === 200 && п2.мс < 1500, JSON.stringify(п2));
    check('kudin.by молчит: повторный показ не шлёт новых запросов описаний', вМёртвый === запросовПосле1 && запросовПосле1 > 0, запросовПосле1 + ' → ' + вМёртвый);
  }
  гасить2(); osrm.close(); висят.forEach(r => { try { r.destroy(); } catch {} }); мёртвый.close();
  await new Promise(r => { if (сервер.exitCode !== null) r(); else { сервер.once('exit', r); setTimeout(r, 3000); } });
  удалитьПапку(папка);
}

// ── в браузере ───────────────────────────────────────────────────────────
const { закрыть } = запуститьChrome(PORT, 'rec', { ловитьОшибки: false });
// что бы ни случилось — свой Chrome не оставляем висеть
const гасить = async (e) => { console.error(e); await закрыть(); process.exit(1); };
process.on('unhandledRejection', гасить);
process.on('uncaughtException', гасить);

let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 40) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };
const телефон = () => send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const компьютер = () => send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
async function снимок(имя) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  try { writeFileSync(join(ОТЧЁТ, имя), Buffer.from(data, 'base64')); } catch (e) { console.log('  (снимок ' + имя + ' не сохранился: ' + e.message + ')'); }
}
// настоящее нажатие мышью в середину элемента
async function нажать(выбор) {
  // рамка снимка меняет высоту плавно (0,25 с): прокручиваем, ждём, пока строки встанут, и только потом меряем
  const есть = await js(`(function(){ var э = document.querySelector(${JSON.stringify(выбор)}); if(!э) return false; э.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
  if (!есть) return false;
  await sleep(450);
  const к = JSON.parse(await js(`(function(){ var r = document.querySelector(${JSON.stringify(выбор)}).getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: к.x, y: к.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: к.x, y: к.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: к.x, y: к.y, button: 'left', buttons: 0, clickCount: 1 });
  return true;
}
const иды = () => js(`JSON.stringify([...document.querySelectorAll('#rlist .it .x')].map(function(e){ return e.getAttribute('data-id'); }))`).then(JSON.parse);
const запросовМеста = idМеста => js(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/place?id=' + ${JSON.stringify(idМеста)}) >= 0 && /id=[^&]*$/.test(e.name) && e.name.split('id=')[1] === ${JSON.stringify(idМеста)}; }).length`);

// чистый профиль
await компьютер();
await send('Page.navigate', { url: SITE + '/marshrut' });
await sleep(800);
await js(`localStorage.clear(); 1`);

// ── вкладка «Что посетить»: лента ────────────────────────────────────────
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`!!document.getElementById('plRec') && !document.getElementById('plRec').hidden`, 60);
check('вкладка мест: лента видна', await js(`!document.getElementById('plRec').hidden && document.getElementById('plRec').offsetParent !== null`));
check('вкладка мест: у карточек снимки получили адрес', await js(`[...document.querySelectorAll('#plRec img')].length > 0 && [...document.querySelectorAll('#plRec img')].every(function(i){ return !!i.getAttribute('src'); })`));
check('вкладка мест: карточка ведёт на /m/lida-voronovo', await js(`document.querySelector('#plRec a.rec-c').getAttribute('href') === '/m/lida-voronovo'`));
await js(`document.getElementById('plRec').scrollIntoView({ block: 'center', behavior: 'instant' }); 1`);
await sleep(1500);
await снимок('task-13-strip.png');
await send('Page.navigate', { url: SITE + '/' });
await sleep(1500);
check('вкладка жилья: ленты не видно', await js(`!document.getElementById('plRec') || document.getElementById('plRec').hidden`));

// ── снимки целиком, без обрезки (просьба владельца 14.09) ────────────────
// Видимый кадр: object-fit contain, а рамка — в пропорциях самого снимка
// (или упёрлась в предел по высоте — тогда contain всё равно показывает кадр целиком).
const безОбрезки = выбор => js(`(function(){ var im = document.querySelector(${JSON.stringify(выбор)}); if(!im || !im.naturalWidth) return JSON.stringify({ нет: 1 });
  var r = im.getBoundingClientRect(), fit = getComputedStyle(im).objectFit, рамка = im.closest('[data-fit]');
  var предел = рамка ? (+рамка.getAttribute('data-fit') || Math.round(innerHeight * (innerWidth < 640 ? 0.7 : 0.8))) : 0;
  return JSON.stringify({ fit: fit, рамка: r.height / r.width, кадр: im.naturalHeight / im.naturalWidth, высота: Math.round(r.height), предел: предел }); })()`).then(JSON.parse);
const цел = к => !к.нет && к.fit === 'contain' && (Math.abs(к.рамка - к.кадр) / к.кадр < 0.04 || Math.abs(к.высота - к.предел) <= 1);
await телефон();
await send('Page.navigate', { url: SITE + '/mesto/910032' });
await ждать(`!!document.querySelector('.ph img.hero.on') && document.querySelector('.ph img.hero.on').naturalWidth > 0`, 60);
await sleep(700);
let кадр = await безОбрезки('.ph img.hero.on');
check('/mesto/910032: вертикальный снимок не обрезан (contain, рамка в пропорциях кадра)', цел(кадр) && кадр.кадр > 1, JSON.stringify(кадр));
await send('Page.navigate', { url: SITE + '/mesto/5069' });
await ждать(`!!document.querySelector('#ph img.hero.on') && document.querySelector('#ph img.hero.on').naturalWidth > 0`, 60);
await sleep(700);
кадр = await безОбрезки('#ph img.hero.on');
check('/mesto/5069: первый кадр слайдера не обрезан', цел(кадр), JSON.stringify(кадр));
await js(`document.querySelector('.ph-r').click(); 1`);
await ждать(`document.querySelector('#ph img.hero.on').naturalWidth > 0`, 40);
await sleep(700);
кадр = await безОбрезки('#ph img.hero.on');
check('/mesto/5069: после листания кадр тоже целиком', цел(кадр), JSON.stringify(кадр));

// ── главная на телефоне: окошко места после загрузки снимка (ревью задачи 13) ──
// Снимок догружается, рамка растёт вверх — высокое окошко на телефоне теряло
// верх. Карту сдвигаем только тогда, когда окошко вылезло за край, а если
// оно и так видно целиком, карта стоит на месте.
await телефон();
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`(window.__places || []).length > 100`, 80);
await js(`setView('map'); 1`);
await ждать(`!!window.__plMarkers && !!window.__plMarkers['910032'] && !!window.__map`, 80);
await js(`window.__map.getContainer().scrollIntoView({ block: 'start', behavior: 'instant' }); 1`);
// карта ещё может перерисовать метки после загрузки списка и закрыть окошко — открываем, пока не откроется
for (let i = 0; i < 12; i++) {
  // без анимаций: приближаем карту к метке, чтобы кружок-кластер распался, и открываем её окошко
  await js(`(function(){ var mk = window.__plMarkers['910032']; window.__map.setView(mk.getLatLng(), 17, { animate: false }); setTimeout(function(){ if(mk._map) mk.openPopup(); else открытьТочкуНаКарте(910032); }, 400); return 1; })()`);
  if (await ждать(`!!document.querySelector('.leaflet-popup .mp-pl')`, 8)) break;
}
const окноСнимок = `(function(){ var i = document.querySelector('.leaflet-popup .mp-pic'); return !!i && i.naturalWidth > 0 && !!i.closest('[data-fit]').style.height; })()`;
const видноОкно = `(function(){ var э = document.querySelector('.leaflet-popup'); if(!э) return JSON.stringify({ нет: 1, окошко: !!window.__окошко, вид: window.__view, режим: window.__mode });
  var r = э.getBoundingClientRect(), к = window.__map.getContainer().getBoundingClientRect();
  return JSON.stringify({ верх: Math.round(r.top - к.top), низ: Math.round(к.bottom - r.bottom), высота: Math.round(r.height) }); })()`;
const окноОткрылось = await ждать(окноСнимок, 80);
check('телефон, главная: окошко места со снимком открылось', окноОткрылось, окноОткрылось ? '' : await js(`JSON.stringify({ меток: Object.keys(window.__plMarkers || {}).length, вид: window.__view, окошко: !!document.querySelector('.leaflet-popup'), снимок: !!document.querySelector('.leaflet-popup .mp-pic'), ширина: (document.querySelector('.leaflet-popup .mp-pic') || {}).naturalWidth, рамка: (document.querySelector('.leaflet-popup [data-fit]') || { style: {} }).style.height, карта: window.__map && window.__map.getContainer().offsetHeight })`));
if (окноОткрылось) {
  await sleep(900);   // рамка меняет высоту плавно, сдвиг карты — тоже
  let в = JSON.parse(await js(видноОкно));
  check('телефон, главная: после загрузки снимка окошко целиком в карте', в.верх >= -1 && в.низ >= -1, JSON.stringify(в));
  const центр = () => js(`JSON.stringify(window.__map.getCenter())`);
  const былЦентр = await центр();
  await js(`window.__послеСнимка(); 1`);
  await sleep(500);
  check('телефон, главная: окошко видно целиком — повторный пересчёт карту не двигает', (await центр()) === былЦентр);
  // сдвигаем карту так, чтобы верх окошка ушёл за край, и снова «догрузился снимок»
  await js(`window.__map.panBy([0, ${Math.max(0, в.верх) + 60}], { animate: false }); 1`);
  await sleep(300);
  const срезано = JSON.parse(await js(видноОкно));
  await js(`window.__послеСнимка(); 1`);
  await sleep(900);
  в = JSON.parse(await js(видноОкно));
  check('телефон, главная: верх окошка за краем — карта сдвигается и окошко снова видно целиком', срезано.верх < 0 && в.верх >= -1 && в.низ >= -1, JSON.stringify({ срезано, после: в }));
}

// ── /m/lida-voronovo на телефоне: карточка точки ─────────────────────────
await телефон();
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/lida-voronovo' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 12`, 60);
check('/m/lida-voronovo: 12 строк в порядке ссылки', JSON.stringify(await иды()) === JSON.stringify(лв.points.map(idТочки)));
check('/m/lida-voronovo: два дня не включены (маршрут на день)', await js(`!document.getElementById('rTwo').checked`));
await js(`window.__маяки = 0; navigator.sendBeacon = function(){ window.__маяки++; return true; }; 1`);
await нажать('#rlist .it:nth-child(2) .nm');
check('нажатие на название раскрыло карточку под строкой', await ждать(`!!document.querySelector('#rlist .it:nth-child(2) .pc')`, 20));
check('адрес страницы не сменился (название не уводит)', (await js(`location.pathname`)) === '/m/lida-voronovo');
check('в карточке появились снимки', await ждать(`!!document.querySelector('#rlist .it:nth-child(2) .pc .pc-ph img.pc-im.on')`, 40));
check('в карточке описание', await js(`(document.querySelector('#rlist .it:nth-child(2) .pc .pc-t')||{}).textContent.length > 20`));
check('в карточке «Подробнее →» на /mesto/5069-…', await js(`/^\\/mesto\\/5069-/.test(document.querySelector('#rlist .it:nth-child(2) .pc a.pc-more').getAttribute('href'))`));
check('в карточке «Жильё рядом» и «Убрать из маршрута»', await js(`!!document.querySelector('#rlist .it:nth-child(2) .pc .pc-stay') && !!document.querySelector('#rlist .it:nth-child(2) .pc .pc-drop')`));
check('на карте открылось окошко с той же точкой', await ждать(`!!document.querySelector('#rmap .leaflet-popup .pp') && document.querySelector('#rmap .leaflet-popup .pp b').textContent === Т[1].name`, 20));
check('у названия aria-expanded="true"', await js(`document.querySelector('#rlist .it:nth-child(2) .nm').getAttribute('aria-expanded') === 'true'`));
await sleep(600);
кадр = await безОбрезки('#rlist .it:nth-child(2) .pc img.pc-im.on');
check('карточка точки: снимок целиком, без обрезки', цел(кадр), JSON.stringify(кадр));
await ждать(`!!document.querySelector('#rmap .leaflet-popup .pp img.pp-im') && document.querySelector('#rmap .leaflet-popup .pp img.pp-im').naturalWidth > 0`, 40);
await sleep(300);
кадр = await безОбрезки('#rmap .leaflet-popup .pp img.pp-im');
check('окошко на карте: снимок есть и показан целиком', цел(кадр), JSON.stringify(кадр));
check('листание снимков: второй кадр получил адрес', await js(`(function(){ var b = document.querySelector('#rlist .it:nth-child(2) .pc .pc-r'); if(!b) return true; b.click(); var on = document.querySelector('#rlist .it:nth-child(2) .pc img.pc-im.on'); return !!on.getAttribute('src') && document.querySelector('#rlist .it:nth-child(2) .pc .pc-n').textContent.indexOf('2/') === 0; })()`));
check('открытие ничего не пишет в хранилище', (await js(`localStorage.getItem('route')`)) === null);
await js(`document.querySelector('#rlist .it:nth-child(2)').scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy(0, -10); 1`);
await sleep(1200);
check('на телефоне карточка не шире списка', await js(`(function(){ var l = document.getElementById('rlist').getBoundingClientRect(), к = document.querySelector('#rlist .pc').getBoundingClientRect(); return к.right <= l.right + 1 && к.left >= l.left - 1 && document.documentElement.scrollWidth <= window.innerWidth; })()`));
check('на телефоне в строке с карточкой номер, название и крестик на одной линии', await js(`(function(){ var r = document.querySelector('#rlist .it:nth-child(2)'); var n = r.querySelector('.n').getBoundingClientRect(), x = r.querySelector('.x').getBoundingClientRect(); return Math.abs((n.top + n.bottom) / 2 - (x.top + x.bottom) / 2) < 20; })()`));
await снимок('task-13-card.png');
await нажать('#rlist .it:nth-child(2) .nm');
check('повторное нажатие закрывает карточку', await ждать(`!document.querySelector('#rlist .pc')`, 10));
check('и окошко на карте', await ждать(`!document.querySelector('#rmap .leaflet-popup')`, 10));
await нажать('#rlist .it:nth-child(2) .nm');
await ждать(`!!document.querySelector('#rlist .it:nth-child(2) .pc img.pc-im')`, 20);
check('описание места кэшируется: повторное раскрытие без запроса', (await запросовМеста('5069')) === 1, await запросовМеста('5069'));
await нажать('#rlist .it:nth-child(3) .nm');
check('аккордеон: открыта одна карточка', await ждать(`document.querySelectorAll('#rlist .pc').length === 1 && !!document.querySelector('#rlist .it:nth-child(3) .pc')`, 10));
// своя точка
await нажать('#rlist .it:nth-child(8) .nm');
check('своя точка: карточка с координатами и «Убрать»', await ждать(`!!document.querySelector('#rlist .it:nth-child(8) .pc') && /Своя точка · 54\\.15020, 25\\.31685/.test(document.querySelector('#rlist .it:nth-child(8) .pc').textContent) && !!document.querySelector('#rlist .it:nth-child(8) .pc .pc-drop')`, 10));
await sleep(500);
check('своя точка: описание не запрашивалось', await js(`window.__карточкаТочки.запрошено().every(function(id){ return id.charAt(0) !== 'm'; }) && performance.getEntriesByType('resource').every(function(e){ return e.name.indexOf('/api/place?id=m') < 0; })`));
await нажать('#rlist .it:nth-child(8) .nm');
// метка на карте
await js(`document.getElementById('rmap').scrollIntoView({ block: 'center', behavior: 'instant' }); 1`);
await sleep(400);
const номерМетки = 5;
const меткаВыбор = `#rmap .leaflet-marker-icon:nth-of-type(${номерМетки})`;
const текстМетки = await js(`(document.querySelector(${JSON.stringify(меткаВыбор)})||{}).textContent`);
await js(`(function(){ var э = document.querySelector(${JSON.stringify(меткаВыбор)}); карта.setView(Т[+э.textContent - 1] ? [Т[+э.textContent - 1].lat, Т[+э.textContent - 1].lng] : карта.getCenter(), 13, { animate: false }); })(); 1`);
await sleep(600);
await нажать(меткаВыбор);
const н = +текстМетки;
check('нажатие на метку открывает окошко на карте', await ждать(`!!document.querySelector('#rmap .leaflet-popup .pp') && document.querySelector('#rmap .leaflet-popup .pp b').textContent === Т[${н - 1}].name`, 20), текстМетки);
check('и карточку в списке у той же точки', await js(`!!document.querySelector('#rlist .it:nth-child(${н}) .pc')`));
check('в окошке появляется описание или снимок', await ждать(`!!document.querySelector('#rmap .leaflet-popup .pp img, #rmap .leaflet-popup .pp p')`, 40));
// перетаскивание за ручку при открытой карточке — стрелкой с клавиатуры
const доПерестановки = await иды();
await js(`(function(){ var р = document.querySelector('#rlist .it:nth-child(${н}) .drag'); р.focus(); р.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); })(); 1`);
await sleep(400);
const послеПерестановки = await иды();
check('ручка ⋮⋮ работает и с открытой карточкой', JSON.stringify(послеПерестановки) === JSON.stringify(доПерестановки.slice(0, н - 2).concat([доПерестановки[н - 1], доПерестановки[н - 2]], доПерестановки.slice(н))), послеПерестановки.join(','));
check('после перестановки карточка осталась у своей точки', await js(`!!document.querySelector('#rlist .it:nth-child(${н - 1}) .pc') && document.querySelector('#rlist .it:nth-child(${н - 1}) .pc').getAttribute('data-id') === ${JSON.stringify(доПерестановки[н - 1])}`));
// «Убрать из маршрута» из карточки — без маяка «добавили в маршрут»
await нажать(`#rlist .it:nth-child(${н - 1}) .pc .pc-drop`);
check('«Убрать из маршрута» убирает точку', await ждать(`document.querySelectorAll('#rlist .it').length === 11`, 10));
check('и закрывает карточку и окошко', await ждать(`!document.querySelector('#rlist .pc') && !document.querySelector('#rmap .leaflet-popup')`, 10));
check('«Убрать» не шлёт маяк добавления', (await js(`window.__маяки`)) === 0, await js(`window.__маяки`));

// ── /marshrut?p=… тоже раскрывает ────────────────────────────────────────
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=5069,286,910026' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 3`, 60);
await нажать('#rlist .it:nth-child(1) .nm');
check('/marshrut: нажатие на название раскрывает карточку', await ждать(`!!document.querySelector('#rlist .it:nth-child(1) .pc')`, 10));
check('/marshrut: снимки и описание загрузились', await ждать(`!!document.querySelector('#rlist .it:nth-child(1) .pc img.pc-im.on') && (document.querySelector('#rlist .it:nth-child(1) .pc .pc-t')||{textContent:''}).textContent.length > 10 && !/Загружаю/.test(document.querySelector('#rlist .it:nth-child(1) .pc').textContent)`, 40));
check('/marshrut: окошко на карте', await ждать(`!!document.querySelector('#rmap .leaflet-popup .pp')`, 10));
check('/marshrut: адрес не сменился', (await js(`location.pathname`)) === '/marshrut');
// «Жильё рядом» в карточке: список рядом и ссылка на поиск жилья в области
await нажать('#rlist .it:nth-child(1) .pc .pc-stay');
check('«Жильё рядом» раскрывает блок жилья в карточке', await ждать(`(function(){ var б = document.querySelector('#rlist .it:nth-child(1) .pc .pc-st'); return !!б && !б.hidden && !/Ищу жильё/.test(б.textContent); })()`, 80));
const жильёАПИ = await (await fetch(SITE + '/api/places/stay?lat=' + (await js(`Т[0].lat`)) + '&lng=' + (await js(`Т[0].lng`)) + '&r=30')).json();
const всёЖильё = await js(`(document.querySelector('#rlist .it:nth-child(1) .pc .pc-all')||{getAttribute:function(){return '';}}).getAttribute('href')`);
check('«Всё жильё рядом →» ведёт в поиск по области точки', !!жильёАПИ.region && всёЖильё === '/?region=' + encodeURIComponent(жильёАПИ.region) + '&type=flat&source=both', всёЖильё + ' / область ' + жильёАПИ.region);
if (всёЖильё) {
  await send('Page.navigate', { url: SITE + всёЖильё });
  await ждать(`!!document.getElementById('region') && document.getElementById('region').value === ${JSON.stringify(жильёАПИ.region || '')}`, 60);
  check('главная открылась на жилье этой области: регион, квартиры, все источники', await js(`window.__mode === 'by' && document.getElementById('region').value === ${JSON.stringify(жильёАПИ.region || '')} && document.getElementById('type').value === 'flat' && document.getElementById('source').value === 'both'`),
    await js(`window.__mode + ' ' + document.getElementById('region').value + ' ' + document.getElementById('type').value + ' ' + document.getElementById('source').value`));
}


// ── «Вернуть мой порядок» на /marshrut ───────────────────────────────────
// Мир → Лида → Несвиж → Новогрудок: жадный объезд от Мира переставит их.
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/marshrut?p=2416,285,244,286&o=1' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 4`, 60);
const мой = await иды();
check('порядок ручной, «Упорядочить автоматически» видна, «Вернуть» скрыта', await js(`document.getElementById('rAuto').offsetParent !== null && document.getElementById('rBackOrder').hidden`));
await нажать('#rAuto');
await sleep(400);
const авто = await иды();
check('«Упорядочить автоматически» поменяла порядок', JSON.stringify(авто) !== JSON.stringify(мой), авто.join(','));
check('рядом появилась «Вернуть мой порядок»', await js(`!document.getElementById('rBackOrder').hidden && document.getElementById('rBackOrder').offsetParent !== null`));
check('прежний порядок в localStorage.routePrevOrder', (await js(`localStorage.getItem('routePrevOrder')`)) === JSON.stringify(мой));
await нажать('#rBackOrder');
await sleep(400);
check('«Вернуть мой порядок» восстановил порядок', JSON.stringify(await иды()) === JSON.stringify(мой), (await иды()).join(','));
check('режим снова manual и в адресе o=1', (await js(`localStorage.getItem('routeOrder')`)) === 'manual' && /[?&]o=1/.test(await js(`location.search`)), await js(`location.search`));
check('кнопка «Вернуть» скрыта, routePrevOrder стёрт', await js(`document.getElementById('rBackOrder').hidden && localStorage.getItem('routePrevOrder') === null`));
await нажать('#rAuto');
await sleep(300);
check('после перезагрузки «Вернуть мой порядок» ещё доступна', await (async () => { await send('Page.navigate', { url: SITE + '/marshrut' }); await ждать(`document.querySelectorAll('#rlist .it').length === 4`, 40); await sleep(300); return js(`!document.getElementById('rBackOrder').hidden`); })());
await js(`убрать(Т[3].id); 1`);
await sleep(300);
check('любая следующая правка стирает прежний порядок', await js(`document.getElementById('rBackOrder').hidden && localStorage.getItem('routePrevOrder') === null`));

// ── «Вернуть мой порядок» на главной ─────────────────────────────────────
await js(`localStorage.clear();
  localStorage.setItem('route', JSON.stringify([{id:2416,name:'Мирский замок',addr:'Мир',lat:53.451232,lng:26.473042},{id:285,name:'Лидский замок',addr:'Лида',lat:53.887131,lng:25.302564},{id:244,name:'Несвижский замок',addr:'Несвиж',lat:53.222868,lng:26.691841},{id:286,name:'Новогрудский замок',addr:'Новогрудок',lat:53.6010,lng:25.8233}]));
  localStorage.setItem('routeOrder', 'manual'); 1`);
await компьютер();
await send('Page.navigate', { url: SITE + '/?country=places' });
await ждать(`document.querySelectorAll('#rtList .rt-item').length === 4`, 60);
const мойГл = await js(`JSON.stringify(window.__route.map(function(p){ return String(p.id); }))`).then(JSON.parse);
await js(`document.getElementById('rtAuto').click(); 1`);
await sleep(300);
check('главная: после «Упорядочить автоматически» видна «Вернуть мой порядок»', await js(`!document.getElementById('rtBack').hidden`));
await js(`document.getElementById('rtBack').click(); 1`);
await sleep(300);
check('главная: «Вернуть мой порядок» восстановил порядок и режим manual', (await js(`JSON.stringify(window.__route.map(function(p){ return String(p.id); }))`)) === JSON.stringify(мойГл) && (await js(`localStorage.getItem('routeOrder')`)) === 'manual');
check('главная: ссылка на маршрут снова с o=1, кнопка скрыта', /o=1/.test(await js(`document.getElementById('routeGo').getAttribute('href')`)) && await js(`document.getElementById('rtBack').hidden`));
// любая следующая правка на главной стирает прежний порядок — и возврат точки его не вернёт
await js(`document.getElementById('rtAuto').click(); 1`);
await sleep(300);
check('главная: снова «Упорядочить автоматически» — «Вернуть» видна', await js(`!document.getElementById('rtBack').hidden && localStorage.getItem('routePrevOrder') !== null`));
const убранная = await js(`JSON.stringify(window.__route[3])`).then(JSON.parse);
await js(`dropRoute(${JSON.stringify(String(убранная.id))}); 1`);
await sleep(300);
check('главная: убрали точку — «Вернуть» скрыта, routePrevOrder стёрт', await js(`document.getElementById('rtBack').hidden && localStorage.getItem('routePrevOrder') === null`));
await js(`routeToggle(${JSON.stringify(убранная)}); 1`);
await sleep(300);
check('главная: вернули ту же точку — прежний порядок не вернулся', await js(`window.__route.length === 4 && document.getElementById('rtBack').hidden && localStorage.getItem('routePrevOrder') === null`));


// ── /m/braslavshchina-2-dnya на телефоне ─────────────────────────────────
await телефон();
await js(`localStorage.clear(); 1`);
await send('Page.navigate', { url: SITE + '/m/braslavshchina-2-dnya' });
await ждать(`typeof L !== 'undefined' && document.querySelectorAll('#rmap .pin').length === 25`, 60);
check('/m/braslavshchina-2-dnya: 25 точек', (await иды()).length === 25);
await ждать(`document.querySelectorAll('#rlist .dh').length === 2`, 20);
check('два дня включены сами', await js(`document.getElementById('rTwo').checked && ДВА_ДНЯ === true`));
check('ночёвка после «Гора Маяк»', await js(`НОЧЁВКА === 11 && /Гора Маяк/.test(Т[10].name) && document.getElementById('rNightN').value === '11'`), await js(`НОЧЁВКА + ' · ' + Т[10].name`));
check('«День 2» перед 12-й точкой', await js(`document.querySelectorAll('#rlist .dh')[1].nextElementSibling === document.querySelectorAll('#rlist .it')[11]`));
check('адрес остался /m/braslavshchina-2-dnya', (await js(`location.pathname + location.search`)) === '/m/braslavshchina-2-dnya');
check('текст «Поделиться»: «Маршрут на два дня: 25 точек»', (await js(`текстМаршрута()`)) === 'Маршрут на два дня: 25 точек');
check('ссылка на подробный рассказ видна', await js(`!!document.querySelector('#rAbout a[href="/marshrut-braslavshchina"]') && document.getElementById('rAbout').offsetParent !== null`));
await js(`window.scrollTo(0, 0); 1`);
await sleep(1500);
await снимок('task-13-braslav.png');
if (await ждать(`!!(ДОРОГА && ДОРОГА.d && ДОРОГА.d.legs)`, 60)) {
  check('дорога по 25 точкам: 24 перегона, линия нарисована', await js(`ДОРОГА.d.legs.length === 24 && ДОРОГА.d.line.length > 25`));
} else console.log('  (OSRM не ответил на 25 точек — дорога в браузере не проверена)');

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
