// «Поделиться подборкой»: коды ссылок, страница /izbrannoe, кнопка в избранном.
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9633, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

const { закрыть } = запуститьChrome(PORT, 'favshare');
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

// ── коды ссылок: туда и обратно (через страницу, где функция вставлена) ──
await send('Page.navigate', { url: SITE + '/' });
await ждать(`typeof кодСсылки === 'function'`, 80);
const примеры = ['https://www.kufar.by/item/1054421624', 'https://realt.by/grodno-region/rent-flat-for-day/object/3939207/',
  'https://check-in.by/kvartira/kvartira-ryadom-s-tsentrom-volkovysk', 'https://kvartirka.by/lida/kvartiry/posutochno/id4879',
  'https://flatbook.by/kvartira-yl-surganova-5/', 'https://grodno.flatbook.by/kvartira-yl-popovicha-33/'];
const коды = await js(`${JSON.stringify(примеры)}.map(кодСсылки)`);
check('коды короткие и с буквой площадки', коды.every((к, i) => 'krcvfg'.includes(к[0]) && к.length < примеры[i].length), коды.join(' '));
check('чужие ссылки не кодируются', (await js(`[кодСсылки('https://evil.example/x'), кодСсылки('https://www.kufar.by/item/12ab'), кодСсылки('javascript:alert(1)')].join('|')`)) === '||');

// ── страница по ссылке: три живых объявления и одно выдуманное ──
const выдача = (await getJSON(SITE + '/api/search?region=grodno&city=&type=any&rooms=&guests=&max=&source=both')).items;
const взять = src => выдача.find(x => x.src === src);
const живые = ['Kufar', 'CheckIn', 'Kvartirka'].map(взять).filter(Boolean);
check('в выдаче есть Kufar, Check-in и Kvartirka', живые.length === 3);
const живыеКоды = await js(`${JSON.stringify(живые.map(x => x.link))}.map(кодСсылки)`);
const s = живыеКоды.concat(['k1', 'x..', 'r../../etc']).join('~');
const r = await fetch(SITE + '/izbrannoe?s=' + encodeURIComponent(s));
const html = await r.text();
check('/izbrannoe: 200 и noindex заголовком и метатегом', r.status === 200 && /noindex/.test(r.headers.get('x-robots-tag') || '') && /<meta name="robots" content="noindex/.test(html));
check('/izbrannoe: три карточки в порядке ссылки', (() => { const ссылки = [...html.matchAll(/<article class="c"><a href="([^"]+)"/g)].map(м => м[1].replace(/&amp;/g, '&'));
  return JSON.stringify(ссылки) === JSON.stringify(живые.map(x => x.link)); })());
check('/izbrannoe: про ненайденное — одно и со ссылкой на Kufar', /Сейчас не нашли: 1/.test(html) && html.includes('https://www.kufar.by/item/1'));
check('/izbrannoe: плохие коды молча пропущены', !/etc|x\.\./.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
check('/izbrannoe: в sitemap нет', !(await (await fetch(SITE + '/sitemap.xml')).text()).includes('/izbrannoe'));
const пусто = await fetch(SITE + '/izbrannoe');
check('/izbrannoe без s: 200 и понятный текст', пусто.status === 200 && /Подборка пустая/.test(await пусто.text()));

// ── кнопка в избранном ──
await js(`localStorage.setItem('pk_favs', ${JSON.stringify(JSON.stringify(живые))}); 1`);
await send('Page.navigate', { url: SITE + '/' });
await ждать(`typeof setView === 'function' && FAVS.length === 3`, 80);
await js(`delete navigator.share; navigator.share = undefined; window.__скопировано = null;
  navigator.clipboard.writeText = function(t){ window.__скопировано = t; return Promise.resolve(); }; setView('fav'); 1`);
check('в избранном видна кнопка «Поделиться подборкой»', await ждать(`(function(){ var b = document.getElementById('favShare'); return b && b.offsetParent !== null && b.textContent.indexOf('Поделиться подборкой') >= 0; })()`, 20));
await js(`document.getElementById('favShare').click(); 1`);
await ждать(`!!window.__скопировано`, 20);
const ссылка = await js(`window.__скопировано`);
check('скопирована ссылка /izbrannoe с кодами в порядке избранного', ссылка === SITE + '/izbrannoe?s=' + живыеКоды.join('~'), ссылка);
await js(`setView('list'); 1`);
check('в обычном списке кнопки нет', await js(`!document.getElementById('favShare') || document.getElementById('favShare').offsetParent === null`));

// ── открыть ссылку в чистом браузере и сохранить к себе ──
await js(`localStorage.removeItem('pk_favs'); 1`);
await send('Page.navigate', { url: ссылка });
await ждать(`document.querySelectorAll('article.c').length === 3`, 40);
await js(`document.getElementById('izSave').click(); 1`);
check('«Сохранить к себе» кладёт три объявления в избранное', await js(`JSON.parse(localStorage.getItem('pk_favs')||'[]').length === 3`));
await js(`document.getElementById('izSave').click(); 1`);
check('повторное сохранение не дублирует', await js(`JSON.parse(localStorage.getItem('pk_favs')||'[]').length === 3`));
check('на 400 px без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
await js(`localStorage.clear(); 1`);

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
