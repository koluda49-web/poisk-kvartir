// «Выходные от этого жилья»: /vyhodnye собирает петлю по лучшим местам в 30 км.
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9634, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

const { закрыть } = запуститьChrome(PORT, 'wknd');
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
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 80) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };

function км(a1, o1, a2, o2) {
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const РАЗРЯД = { 'Храмы': 0, 'Дворцы и усадьбы': 0, 'Укрепления': 0, 'Строения': 1, 'Военные': 1, 'Ландшафтные': 1, 'Разное': 1, 'Культурные': 2 };
const разряд = p => РАЗРЯД[p.group] ?? (/костёл|костел|церк|храм|часовн|собор|кирха|синагог|монастыр|дворец|усадьб|замок|крепост/i.test(p.cat || '') ? 0
  : /скульптур|арт-объект|памятник|музей|скамейк|мурал|граффити/i.test(p.cat || '') ? 2 : 1);
// Ожидаемый выбор — по тем же правилам, из /api/places (у него есть group и rating)
async function ожидаем(lat, lng) {
  const все = (await getJSON(SITE + `/api/places?lat=${lat}&lng=${lng}&r=30`)).items;
  const канд = все.map(p => ({ p, д: км(lat, lng, p.lat, p.lng) })).filter(x => x.д <= 30 && разряд(x.p) <= 1)
    .sort((a, b) => разряд(a.p) - разряд(b.p) || (b.p.rating || 0) - (a.p.rating || 0) || a.д - b.д);
  const взято = [];
  for (const { p } of канд) { if (взято.some(q => км(q.lat, q.lng, p.lat, p.lng) < 1)) continue; взято.push(p); if (взято.length === 5) break; }
  let лучший = null, лучшая = Infinity;
  const перебор = (путь, ост) => {
    if (!ост.length) { let д = 0, пр = { lat, lng }; путь.concat([{ lat, lng }]).forEach(т => { д += км(пр.lat, пр.lng, т.lat, т.lng); пр = т; });
      if (д < лучшая - 1e-9) { лучшая = д; лучший = путь; } return; }
    ост.forEach((т, i) => перебор(путь.concat([т]), ост.slice(0, i).concat(ост.slice(i + 1))));
  };
  перебор([], взято);
  return (лучший || []).map(p => String(p.id));
}
// ── сервер ──
const [lat, lng] = [53.45140, 26.47200];   // Мир
const r = await fetch(SITE + `/vyhodnye?lat=${lat}&lng=${lng}`, { redirect: 'manual' });
const куда = r.headers.get('location') || '';
check('302 на /marshrut с o=1', r.status === 302 && куда.startsWith('/marshrut?p=') && куда.endsWith('&o=1'), r.status + ' ' + куда);
const точки = decodeURIComponent(куда.slice('/marshrut?p='.length, куда.length - 4)).split(',');
check('старт и финиш — «Жильё» у тех же координат', точки[0] === 'm53.45140_26.47200~Жильё' && точки[точки.length - 1] === 'm53.45141_26.47201~Жильё', точки[0] + ' … ' + точки[точки.length - 1]);
const места = точки.slice(1, -1);
check('от 3 до 5 мест, все номера справочника, без повторов', места.length >= 3 && места.length <= 5 && места.every(x => /^\d+$/.test(x)) && new Set(места).size === места.length, места.join(','));
check('выбор и порядок — по правилам (разряд, рейтинг, близость; кратчайшая петля)', JSON.stringify(места) === JSON.stringify(await ожидаем(lat, lng)), места.join(','));
const заГраницей = await fetch(SITE + '/vyhodnye?lat=59.9&lng=30.3', { redirect: 'manual' });
check('вне Беларуси — на вкладку мест', заГраницей.status === 302 && заГраницей.headers.get('location') === '/?country=places');
const мусор = await fetch(SITE + '/vyhodnye?lat=abc', { redirect: 'manual' });
check('мусор в координатах — на вкладку мест', мусор.status === 302 && мусор.headers.get('location') === '/?country=places');
check('noindex', /noindex/.test(r.headers.get('x-robots-tag') || ''));
const р = await getJSON(SITE + `/api/places/ryadom?p=${lat},${lng}`);
check('/api/places/ryadom у Мира: w = true', р.ok && р.items[0].w === true);

// ── страница маршрута открывается с этими точками ──
await send('Page.navigate', { url: SITE + куда });
await ждать(`typeof Т !== 'undefined' && Т.length === ${точки.length}`, 80);
check('на /marshrut столько же точек и порядок ручной', await js(`Т.length === ${точки.length} && ПОРЯДОК === 'manual'`));
check('первая и последняя строки — «Жильё»', await js(`Т[0].name === 'Жильё' && Т[Т.length - 1].name === 'Жильё'`));
check('план дня виден', await ждать(`!!document.getElementById('rPlan') && !document.getElementById('rPlan').hidden`, 40));

// ── ссылка в карточке ──
await send('Page.navigate', { url: SITE + '/?region=minsk-obl&city=' + encodeURIComponent('Несвиж') + '&type=any' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
const есть = await ждать(`!!document.querySelector('#grid .nb .nb-wk')`, 60);
check('у жилья под Несвижем есть «Маршрут на выходные…»', есть);
if (есть) check('ссылка ведёт на /vyhodnye с координатами карточки и nofollow', await js(`(function(){
  var a = document.querySelector('#grid .nb .nb-wk'), card = a.closest('.card'), i = [...document.querySelectorAll('#grid .card')].indexOf(card);
  var x = window.__items[(window.__page - 1) * 24 + i];
  return a.getAttribute('rel') === 'nofollow' && a.getAttribute('href') === '/vyhodnye?lat=' + (+x.lat).toFixed(5) + '&lng=' + (+x.lng).toFixed(5); })()`));
check('на 400 px без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
await js(`localStorage.clear(); 1`);

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
