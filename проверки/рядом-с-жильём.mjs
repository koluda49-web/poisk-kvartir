// «Рядом» в карточках жилья: API пачкой и строка в карточке.
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9631, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

const { закрыть } = запуститьChrome(PORT, 'nb');
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
// ── API ──
const мир = [53.4514, 26.4720], глушь = [52.2000, 30.9000];   // у Мира мест много; вторая — для проверки формы ответа
const d = await getJSON(SITE + '/api/places/ryadom?p=' + [мир, глушь].map(c => c.join(',')).join(';'));
check('ok и два ответа по порядку', d.ok === true && Array.isArray(d.items) && d.items.length === 2, JSON.stringify(d).slice(0, 200));
const а = d.items[0];
const места = (await getJSON(SITE + `/api/places?lat=${мир[0]}&lng=${мир[1]}&r=25`)).items;
check('Мир: n — число мест в 25 км', а.n === места.length, а.n + ' / ' + места.length);
check('Мир: первое место — первое из /api/places', а.top[0] && String(а.top[0].id) === String(места[0].id), JSON.stringify(а.top));
check('Мир: не больше двух мест, второе не ближе 1 км к первому', а.top.length <= 2 && (а.top.length < 2 || (() => {
  const x = места.find(p => String(p.id) === String(а.top[0].id)), y = места.find(p => String(p.id) === String(а.top[1].id));
  return км(x.lat, x.lng, y.lat, y.lng) >= 1; })()));
check('Мир: km с одним знаком и совпадает с расстоянием', а.top.every(t => { const p = места.find(q => String(q.id) === String(t.id));
  return Math.round(t.km * 10) / 10 === t.km && Math.abs(км(мир[0], мир[1], p.lat, p.lng) - t.km) <= 0.06; }));
check('Мир: ссылки на страницы мест', а.top.every(t => /^\/mesto\/\d+-[a-z0-9-]+$/.test(t.href)));
check('у ответа поле w — логическое', typeof а.w === 'boolean' && typeof d.items[1].w === 'boolean');
check('Мир: w = true (мест на выходные хватает)', а.w === true);
for (const плохой of ['', 'abc', Array(25).fill('53.9,27.5').join(';')])
  check('неправильный p → ok:false (' + плохой.slice(0, 12) + '…)', (await getJSON(SITE + '/api/places/ryadom?p=' + encodeURIComponent(плохой))).ok === false);
const t0 = Date.now();
await getJSON(SITE + '/api/places/ryadom?p=' + Array(24).fill(мир.join(',')).join(';'));
check('24 точки считаются быстро (< 300 мс)', Date.now() - t0 < 300, (Date.now() - t0) + ' мс');

// ── страница ──
await send('Page.navigate', { url: SITE + '/?region=grodno&type=any' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
await ждать(`document.querySelectorAll('#grid .nb a').length > 0`, 80);
const карточки = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#grid .card')].map(function(c, i){
  var x = window.__items[(window.__page - 1) * 24 + i]; var nb = c.querySelector('.nb');
  return { approx: !!x.approx, lat: x.lat, nb: !!nb, text: nb ? nb.textContent : '' }; }))`));
check('строка «Рядом» только у точных координат', карточки.every(к => к.nb === !к.approx), JSON.stringify(карточки.filter(к => к.nb === к.approx)).slice(0, 200));
check('хоть у одной карточки «Рядом: … км»', карточки.some(к => /^Рядом: .+ \d+(,\d)? км/.test(к.text)), карточки.map(к => к.text).join(' | ').slice(0, 300));
const запросов = () => js(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/places/ryadom') >= 0; }).length`);
const было = await запросов();
check('на страницу — один запрос', было === 1, было);
await js(`renderCards(); 1`); await sleep(800);
check('перерисовка той же страницы не спрашивает сервер', (await запросов()) === было);
const ещё = await js(`(function(){ var b = document.querySelector('#grid .nb .nb-more'); if(!b) return null; b.click(); return 1; })()`);
if (ещё) {
  await ждать(`window.__mode === 'places'`, 40);
  check('«ещё N» открывает места рядом с жильём', await js(`window.__mode === 'places' && !!window.__plCenter`));
}
check('на 400 px страница не ездит вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
