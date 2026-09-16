// Городские страницы: жильё + что посмотреть рядом.
// Проверяем, что на страницах города есть блок мест из нашего справочника
// (названия и расстояния сходятся со справочником — ничего не придумано),
// ссылка на готовый или собранный маршрут, новые Новогрудок и Несвиж
// в sitemap, заголовки и описания в рамках SEO-правил.
// Сервер должен быть запущен, каталоги досок собраны.
//   node проверки/города-и-места.mjs http://127.0.0.1:8241
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9632, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const раскрыть = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function км(a1, o1, a2, o2) {
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const справочник = (await (await fetch(SITE + '/api/places?light=1')).json()).items;
const место = id => справочник.find(p => String(p.id) === String(id));

// центр — как у сервера: точка курорта, центр из записи или TOWN_CENTERS
const СТРАНИЦЫ = [
  ['/grodno', [53.6690, 23.8130], null],
  ['/minsk', [53.9020, 27.5615], null],
  ['/braslav', [55.6333, 27.05], '/m/braslavshchina-2-dnya'],
  ['/novogrudok', [53.6000, 25.8280], null],
  ['/nesvizh', [53.2226, 26.6739], null],
  ['/lida', [53.8880, 25.2990], '/m/lida-voronovo'],
];
for (const [путь, центр, маршрут] of СТРАНИЦЫ) {
  const r = await fetch(SITE + путь);
  const html = await r.text();
  check(путь + ': 200', r.status === 200, r.status);
  if (r.status !== 200) continue;
  check(путь + ': блок «Что посмотреть рядом»', html.includes('<h2>Что посмотреть рядом</h2>'));
  const карточки = [...html.matchAll(/<a class="pc" href="\/mesto\/(\d+)-[a-z0-9-]+">[\s\S]*?<b>([^<]*)<\/b>[\s\S]*?<span class="pk">([\d,]+) км от центра<\/span>/g)];
  check(путь + ': от 3 до 8 мест', карточки.length >= 3 && карточки.length <= 8, карточки.length);
  check(путь + ': названия — из справочника', карточки.every(к => место(к[1]) && место(к[1]).name === раскрыть(к[2])),
    карточки.filter(к => !место(к[1]) || место(к[1]).name !== раскрыть(к[2])).map(к => к[1]).join(','));
  check(путь + ': расстояния сходятся (± 0,1 км) и ≤ 30 км', карточки.every(к => { const p = место(к[1]); const д = +к[3].replace(',', '.');
    return p && д <= 30 && Math.abs(км(центр[0], центр[1], p.lat, p.lng) - д) <= 0.1; }));
  check(путь + ': у снимков непустой alt', [...html.matchAll(/<a class="pc"[\s\S]*?<\/a>/g)].every(м => !/<img/.test(м[0]) || /<img[^>]+alt="[^"]+"/.test(м[0])));
  const ссылка = (html.match(/<a class="pr-route" href="([^"]+)"/) || [])[1];
  if (маршрут) check(путь + ': ссылка на готовый маршрут ' + маршрут, ссылка === маршрут, ссылка);
  else check(путь + ': ссылка на маршрут из мест этого блока', !!ссылка && (/^\/m\/[a-z0-9-]+$/.test(ссылка)
    || (ссылка.startsWith('/marshrut?p=') && ссылка.slice(12).split(',').every(id => карточки.some(к => к[1] === id)))), ссылка);
  const title = раскрыть((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const desc = раскрыть((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  // у /braslav основа заголовка длинная (48 знаков), хвост «и что посмотреть рядом» не влезает в 60
  check(путь + ': title ≤ 60' + (путь === '/braslav' ? '' : ' и про места'), title.length <= 60 && (путь === '/braslav' || /посмотреть/.test(title)), title);
  check(путь + ': description 120–160 и называет число мест', desc.length >= 120 && desc.length <= 160 && /\d+ мест/.test(desc), desc.length + ' ' + desc);
}
// уточняющие страницы остаются про цену/тип, блок мест только на основной
const недорого = await (await fetch(SITE + '/grodno-nedorogo')).text();
check('/grodno-nedorogo: заголовок прежний', /<title>Недорогие квартиры на сутки в Гродно до 70 рублей/.test(недорого));
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
check('sitemap: /novogrudok и /nesvizh', карта.includes('/novogrudok</loc>') && карта.includes('/nesvizh</loc>'));

// телефон: блок мест не распирает страницу
const { закрыть } = запуститьChrome(PORT, 'city');
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.navigate', { url: SITE + '/braslav' });
await sleep(2500);
check('/braslav на 400 px: без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
check('/braslav на 400 px: карточки мест в ленту вбок', await js(`getComputedStyle(document.querySelector('.places')).overflowX === 'auto'`));

console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
