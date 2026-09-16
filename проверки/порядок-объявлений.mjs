// «Рекомендуемые»: порядок объявлений по умолчанию — обычное жильё по типичной цене сверху, хостелы в конце.
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9635, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

const { закрыть } = запуститьChrome(PORT, 'recsort');
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

// ── функция на синтетике ──
await send('Page.navigate', { url: SITE + '/' });
await ждать(`typeof рекомендуемыйПорядок === 'function'`, 80);
const синт = await js(`рекомендуемыйПорядок([
  {price:35, title:'Место в номере на сутки для 9-ти человек', link:'a'},
  {price:130, title:'1-комн квартира', link:'b'},
  {price:60, title:'Студия у метро', link:'c'},
  {price:500, title:'Коттедж', link:'d'},
  {price:140, title:'2-комн', link:'e'}]).map(function(x){ return x.price; }).join(',')`);
check('синтетика: 140,130,60,500,35 (медиана 140, хостел в конце)', синт === '140,130,60,500,35', синт);
check('похожеНаМесто: хостел, койко-место, /чел; квартира — нет', await js(`[похожеНаМесто({title:'Хостел Центр'}), похожеНаМесто({title:'Койко-место у вокзала'}),
  похожеНаМесто({title:'Домик', chips:['30 р./чел']}), !похожеНаМесто({title:'Квартира на Немиге'})].every(Boolean)`));
check('медиана без хостелов', (await js(`медианаЦены([{price:35,title:'хостел'},{price:100},{price:120},{price:200}])`)) === 120);

// ── главная без параметров ──
await send('Page.navigate', { url: SITE + '/' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
await sleep(1500);
check('в «Сортировке» выбрано «Рекомендуемые»', await js(`$('#sort').value === 'recommended' && $('#sort').selectedOptions[0].textContent === 'Рекомендуемые'`));
check('«Рекомендуемые» — первый пункт', await js(`$('#sort').options[0].value === 'recommended'`));
const первые = JSON.parse(await js(`(function(){ var м = медианаЦены(window.__all); return JSON.stringify({ м: м,
  стр: window.__items.slice(0, 24).map(function(x){ return { price: x.price, место: похожеНаМесто(x) }; }),
  есть: window.__items.some(похожеНаМесто) }); })()`));
check('первые 24 — не хостелы', первые.стр.every(x => !x.место), JSON.stringify(первые.стр.filter(x => x.место)));
check('первая карточка — у медианы (±25%)', первые.стр[0].price >= 0.75 * первые.м && первые.стр[0].price <= 1.35 * первые.м, первые.стр[0].price + ' при медиане ' + первые.м);
if (первые.есть) check('похожие на место — в самом конце выдачи', await js(`(function(){ var i = window.__items, п = i.findIndex(похожеНаМесто);
  return п >= 0 && i.slice(п).every(похожеНаМесто); })()`));
check('в адресе нет sort', await js(`!/sort=/.test(location.search)`));

// ── выбор человека ──
await js(`$('#sort').value = 'price_asc'; $('#sort').dispatchEvent(new Event('change', {bubbles:true})); 1`);
await sleep(500);
check('«Дешёвые сверху» — по возрастанию цены, как раньше', await js(`window.__items.every(function(x, i, a){ return !i || a[i-1].price <= x.price; })`));
check('выбор записан в адрес', await js(`/sort=price_asc/.test(location.search)`));
await send('Page.navigate', { url: SITE + '/?sort=price_asc' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
check('ссылка с sort=price_asc открывается дешёвыми сверху', await js(`$('#sort').value === 'price_asc' && window.__items.every(function(x, i, a){ return !i || a[i-1].price <= x.price; })`));
await js(`$('#rooms').value = '2'; $('#rooms').dispatchEvent(new Event('change', {bubbles:true})); 1`);
await ждать(`!/Ищу/.test(document.getElementById('stat').textContent)`, 240);
check('фильтр не сбрасывает выбранный порядок', await js(`$('#sort').value === 'price_asc'`));
await js(`$('#sort').value = 'recommended'; $('#sort').dispatchEvent(new Event('change', {bubbles:true})); 1`);
await sleep(500);
check('вернули «Рекомендуемые» — sort пропал из адреса', await js(`!/sort=/.test(location.search)`));

// ── серверные страницы ──
const медиана = xs => { const ц = xs.filter(x => x > 0).sort((a, b) => a - b); return ц[Math.floor(ц.length / 2)]; };
const выдача = (await getJSON(SITE + '/api/search?region=grodno&city=&type=flat&rooms=&guests=&max=&source=both')).items;
const htmlГродно = await (await fetch(SITE + '/grodno')).text();
const ценыГродно = [...htmlГродно.matchAll(/<div class="p">(?:от )?(\d+) BYN/g)].map(м => +м[1]);
const мГ = медиана(выдача.filter(x => !/хостел|hostel|койк|мест[оа] в (номере|комнате|хостеле)/i.test(x.title || '')).map(x => x.price));
check('/grodno: первая карточка у медианы (±25%)', ценыГродно.length > 0 && ценыГродно[0] >= 0.75 * мГ && ценыГродно[0] <= 1.35 * мГ, ценыГродно.slice(0, 5).join(',') + ' медиана ' + мГ);
const htmlДёшево = await (await fetch(SITE + '/grodno-nedorogo')).text();
const ценыД = [...htmlДёшево.matchAll(/<div class="p">(?:от )?(\d+) BYN/g)].map(м => +м[1]);
check('/grodno-nedorogo: по-прежнему дешёвые сверху', ценыД.every((ц, i) => !i || ценыД[i - 1] <= ц), ценыД.slice(0, 8).join(','));
const home = await (await fetch(SITE + '/')).text();
const пред = JSON.parse((home.match(/__PRELOAD\s*=\s*(\{[\s\S]*?\});/) || [])[1] || '{}');
check('предзагрузка главной: есть med и первая — у медианы', пред.med > 0 && пред.items[0].price >= 0.75 * пред.med && пред.items[0].price <= 1.35 * пред.med, пред.med + ' / ' + (пред.items || [])[0]?.price);

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
