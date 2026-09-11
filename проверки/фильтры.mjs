// Все фильтры поиска жилья — в настоящем браузере, как их нажимает человек.
//
// Зачем. Каждый фильтр по отдельности проверялся на сервере, но человек
// видит не ответ сервера, а карточки на странице, собранные из пяти ответов.
// Здесь выставляем фильтр в самом интерфейсе, жмём поиск и сверяем каждую
// карточку, которая попала на экран, с тем, что выбрано.
//
// Сервер должен быть запущен, и каталоги досок уже собраны (~3 минуты).
//   node проверки/фильтры.mjs
//   node проверки/фильтры.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9511, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-flt-' + process.pid,
  'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const ошибкиСтраницы = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown')
    ошибкиСтраницы.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (n, ok, d) => ok
  ? (passed++, console.log('  OK   ' + n))
  : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// Дождаться конца поиска: сводка перестала говорить «ищу ещё…»
async function дождаться() {
  await sleep(400);
  for (let i = 0; i < 150; i++) {
    const с = await js(`(document.querySelector('#stat')||{}).textContent||''`);
    if (с && !/ищу ещё|Загрузка|ищу/i.test(с)) return с;
    await sleep(200);
  }
  return await js(`(document.querySelector('#stat')||{}).textContent||''`);
}

// Выставить фильтры в интерфейсе и нажать поиск так, как это сделал бы человек
async function искать(ф) {
  await js(`(function(ф){
    function поставить(id, v){ var e=document.getElementById(id); if(!e) return;
      if(e.type==='checkbox') e.checked=!!v; else e.value=v;
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
    var по={region:'minsk',city:'',type:'any',rooms:'',guests:'',source:'both',sort:'price_asc',min:'',max:'',qname:'',from:'',to:''};
    Object.keys(ф).forEach(function(k){ по[k]=ф[k]; });
    поставить('region', по.region);
    поставить('city', по.city);
    ['type','rooms','guests','source','sort','min','max','qname','from','to'].forEach(function(k){ поставить(k, по[k]); });
    document.querySelectorAll('.rb-amen-cb').forEach(function(c){ c.checked = (по.amen||[]).indexOf(c.value)>=0; });
    window.__page=1;
    if(typeof run==='function') run();
  })(${JSON.stringify(ф)}); 1`);
  const стат = await дождаться();
  const всё = JSON.parse(await js(`JSON.stringify((window.__items||[]).map(function(x){
    return {src:x.src, price:+x.price, rooms:+x.rooms||0, cap:+x.capacity||0, area:x.area||'', title:x.title||'',
            region:x.region||'', link:x.link||'', photos:(x.photos||[]).length, lat:x.lat, phone:!!x.phone};
  }))`) || '[]');
  const карточек = await js(`document.querySelectorAll('#grid .card').length`);
  return { стат, всё, карточек };
}

await send('Page.navigate', { url: SITE + '/' });
for (let i = 0; i < 60; i++) { if (await js(`typeof run === 'function' && !!document.getElementById('region')`)) break; await sleep(500); }
await дождаться();

console.log('\n=== без фильтров, Минск ===');
let р = await искать({});
check('карточки есть', р.всё.length > 100 && р.карточек > 0, р.стат);
check('все пять площадок в выдаче', new Set(р.всё.map(x => x.src)).size === 5, [...new Set(р.всё.map(x => x.src))].join(','));
check('на странице не больше 24 карточек', р.карточек <= 24, 'карточек ' + р.карточек);
check('сводка сходится с выдачей', (р.стат.match(/Найдено (\d+)/) || [])[1] == р.всё.length, р.стат);
check('всё с ценой', р.всё.every(x => x.price > 0));
check('все ссылки ведут на площадки', р.всё.every(x => /^https:\/\/([a-z0-9-]+\.)?(kufar\.by|realt\.by|flatbook\.by|check-in\.by|kvartirka\.by)\//.test(x.link)),
  (р.всё.find(x => !/kufar|realt|flatbook|check-in|kvartirka/.test(x.link)) || {}).link);
const поЦене = р.всё.map(x => x.price);
check('сортировка «дешёвые сверху»', поЦене.every((v, i) => !i || v >= поЦене[i - 1]));
check('ни одной продажи в выдаче', !р.всё.some(x => /продаж|продам|продаётся/i.test(x.title)),
  (р.всё.find(x => /продаж|продам/i.test(x.title)) || {}).title);
check('нет цен вроде продажи (больше 3000 в сутки)', !р.всё.some(x => x.price > 3000),
  (р.всё.find(x => x.price > 3000) || {}).title);

console.log('\n=== сортировка ===');
р = await искать({ sort: 'price_desc' });
const вниз = р.всё.map(x => x.price);
check('«дорогие сверху»', вниз.length > 10 && вниз.every((v, i) => !i || v <= вниз[i - 1]));

console.log('\n=== цена ===');
р = await искать({ min: '80', max: '120' });
check('от 80 до 120 — всё в коридоре', р.всё.length > 0 && р.всё.every(x => x.price >= 80 && x.price <= 120),
  'вне: ' + р.всё.filter(x => x.price < 80 || x.price > 120).slice(0, 3).map(x => x.src + ' ' + x.price).join(', '));
check('и площадок в коридоре больше одной', new Set(р.всё.map(x => x.src)).size >= 3, [...new Set(р.всё.map(x => x.src))].join(','));

console.log('\n=== комнаты ===');
// Сколько комнат на самом деле: у Flatbook числа нет, он отбирает у себя,
// поэтому для него судим по заголовку — если комнатность в нём названа.
const комнатИз = x => x.rooms || +((x.title.match(/(\d)\s*-?\s*(?:х\s*)?(?:комн|к\.|ком\b)/i) || [])[1] || 0);
const годится = (x, к) => {
  const n = комнатИз(x);
  if (!n) return x.src === 'Flatbook';          // неизвестно — допустимо только у Flatbook
  return к >= 3 ? n >= 3 : n === к;
};
for (const к of [1, 2, 3]) {
  р = await искать({ rooms: String(к) });
  const чужие = р.всё.filter(x => !годится(x, к));
  check((к === 3 ? '«3+»' : к + '-комнатные') + ' — без чужой комнатности', р.всё.length > 0 && чужие.length === 0,
    'чужие: ' + чужие.slice(0, 3).map(x => x.src + ' ' + (комнатИз(x) || '?') + 'к ' + x.title.slice(0, 30)).join(' | '));
}

console.log('\n=== гости ===');
for (const g of ['4', '8']) {
  р = await искать({ guests: g, region: 'any' });
  check('на ' + g + '+ гостей — все вмещают столько', р.всё.length > 0 && р.всё.every(x => x.cap >= +g),
    'меньше: ' + р.всё.filter(x => x.cap < +g).slice(0, 3).map(x => x.src + ' до ' + x.cap).join(', '));
  check('на ' + g + '+ Flatbook не участвует (вместимости не отдаёт)', !р.всё.some(x => x.src === 'Flatbook'));
}

console.log('\n=== тип жилья ===');
р = await искать({ type: 'flat' });
const квартиры = р.всё.length;
check('квартиры есть', квартиры > 0);
check('среди квартир нет усадеб kvartirka', !р.всё.some(x => x.src === 'Kvartirka' && /usadby/.test(x.link)));
check('среди квартир нет домов check-in', !р.всё.some(x => x.src === 'CheckIn' && /\/dom\//.test(x.link)));
р = await искать({ type: 'usadba', region: 'minsk-obl' });
check('усадьбы в Минской области есть', р.всё.length > 0, р.стат);
check('среди усадеб нет квартир check-in', !р.всё.some(x => x.src === 'CheckIn' && /\/kvartira\//.test(x.link)));
check('среди усадеб нет квартир kvartirka', !р.всё.some(x => x.src === 'Kvartirka' && /kvartiry/.test(x.link)));
р = await искать({ type: 'any' });
check('«любой» — не меньше, чем одни квартиры', р.всё.length >= квартиры, р.всё.length + ' против ' + квартиры);

console.log('\n=== области ===');
const ОБЛ = { brest: 'Брест', gomel: 'Гомел', grodno: 'Гродн', vitebsk: 'Витеб', mogilev: 'Могил' };
for (const [обл, корень] of Object.entries(ОБЛ)) {
  р = await искать({ region: обл });
  const чужие = р.всё.filter(x => x.region && !new RegExp(корень, 'i').test(x.region)
    && !new RegExp(корень, 'i').test(x.area) && !/обл/i.test(x.area) && x.src !== 'Flatbook');
  check(обл + ': выдача есть и без чужих областей', р.всё.length > 0 && чужие.length === 0,
    р.всё.length + ' шт; чужие: ' + чужие.slice(0, 2).map(x => x.src + ' ' + x.region + '/' + x.area).join(', '));
}
р = await искать({ region: 'any' });
check('«любая область» больше Минска', р.всё.length > 3000, 'всего ' + р.всё.length);

console.log('\n=== город ===');
р = await искать({ region: 'brest', city: 'Пинск' });
check('Пинск: только Пинск', р.всё.length > 0 && р.всё.every(x => /пинск/i.test(x.area + ' ' + x.title)),
  'чужие: ' + р.всё.filter(x => !/пинск/i.test(x.area + ' ' + x.title)).slice(0, 3).map(x => x.src + ' ' + x.area).join(', '));

console.log('\n=== источник ===');
for (const [ключ, метка] of [['kufar', 'Kufar'], ['realt', 'Realt'], ['flatbook', 'Flatbook'], ['checkin', 'CheckIn'], ['kvartirka', 'Kvartirka']]) {
  р = await искать({ source: ключ });
  check('только ' + метка, р.всё.length > 0 && р.всё.every(x => x.src === метка), р.всё.length + ' шт');
}

console.log('\n=== удобства ===');
р = await искать({ amen: ['wifi'] });
check('Wi-Fi: выдача есть', р.всё.length > 0, р.стат);
check('Wi-Fi: только площадки с данными об удобствах', р.всё.every(x => x.src === 'Kufar' || x.src === 'Flatbook'),
  [...new Set(р.всё.map(x => x.src))].join(','));

console.log('\n=== поиск по названию ===');
р = await искать({ qname: 'Браслав', region: 'any' });
check('«Браслав»: выдача есть', р.всё.length > 0, р.стат);
check('«Браслав»: всё про Браслав', р.всё.every(x => /браслав/i.test(x.title + ' ' + x.area)),
  р.всё.filter(x => !/браслав/i.test(x.title + ' ' + x.area)).slice(0, 2).map(x => x.src + ' ' + x.title).join(' | '));
р = await искать({ qname: 'Нарочь', region: 'any' });
check('«Нарочь»: ни одной продажи', !р.всё.some(x => /продаж/i.test(x.title) || x.price > 3000),
  (р.всё.find(x => /продаж/i.test(x.title) || x.price > 3000) || {}).title);
р = await искать({ qname: 'Брест', region: 'any' });
check('«Брест»: доски тоже ищутся по названию', р.всё.some(x => x.src === 'CheckIn' || x.src === 'Kvartirka'),
  [...new Set(р.всё.map(x => x.src))].join(','));
await искать({ qname: '' });

console.log('\n=== повторы ===');
р = await искать({ region: 'any' });
const ссылки = new Set(); let двойных = 0;
р.всё.forEach(x => { if (ссылки.has(x.link)) двойных++; ссылки.add(x.link); });
check('одна ссылка — одна карточка', двойных === 0, 'повторов ' + двойных);

console.log('\n=== отображение ===');
await искать({});
const вид = JSON.parse(await js(`JSON.stringify((function(){
  const к=[...document.querySelectorAll('#grid .card')];
  return {
    всего:к.length,
    безЦены:к.filter(c=>!/\\d/.test((c.querySelector('.pr')||{}).textContent||'')).length,
    безМетки:к.filter(c=>!c.querySelector('.tag')).length,
    безКнопкиОткрыть:к.filter(c=>![...c.querySelectorAll('.act a')].some(a=>/Открыть/.test(a.textContent))).length,
    безФото:к.filter(c=>!c.querySelector('img.im')).length,
    открытыхНомеровСкрытых:к.filter(c=>{const t=(c.querySelector('.tag')||{}).textContent||'';
      return /Realt|Check-in|Kvartirka/.test(t) && c.querySelector('a.call');}).length,
    вылезают:к.filter(c=>c.scrollWidth>c.clientWidth+2).length,
    ширинаСтраницы: document.documentElement.scrollWidth, окно: window.innerWidth
  };
})())`));
check('у каждой карточки цена', вид.безЦены === 0, вид.безЦены + ' без цены');
check('у каждой карточки метка площадки', вид.безМетки === 0);
check('у каждой карточки кнопка «Открыть»', вид.безКнопкиОткрыть === 0, вид.безКнопкиОткрыть + ' без неё');
check('у каждой карточки фотография', вид.безФото === 0, вид.безФото + ' без фото');
check('номера Realt/Check-in/Kvartirka закрыты кнопкой', вид.открытыхНомеровСкрытых === 0);
check('ничего не вылезает из карточек', вид.вылезают === 0, вид.вылезают + ' карточек');
check('страница не шире окна', вид.ширинаСтраницы <= вид.окно + 1, вид.ширинаСтраницы + ' > ' + вид.окно);

// Листание
await js(`gotoPage(2); 1`); await sleep(500);
const вторая = await js(`document.querySelectorAll('#grid .card').length`);
check('вторая страница листается', вторая > 0, 'карточек ' + вторая);

// Карта
await js(`setView('map'); 1`); await sleep(2500);
const меток = await js(`document.querySelectorAll('.leaflet-marker-icon').length`);
check('карта рисует метки', меток > 0, 'меток ' + меток);
await js(`setView('list'); 1`); await sleep(500);

// Телефон
await await js(`(function(){ var b=document.querySelector('#grid button.call'); if(b) b.click(); return 1; })()`);
await sleep(300);
const послеНажатия = await js(`!!document.querySelector('#grid a.call[href^="tel:"]')`);
check('«Показать телефон» открывает номер со ссылкой tel:', послеНажатия);

console.log('\n=== на телефоне ===');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.reload'); await sleep(1500);
await дождаться();
const моб = JSON.parse(await js(`JSON.stringify({ ш: document.documentElement.scrollWidth, о: window.innerWidth,
  карточек: document.querySelectorAll('#grid .card').length })`));
check('на телефоне карточки есть', моб.карточек > 0);
check('на телефоне страница не шире экрана', моб.ш <= моб.о + 1, моб.ш + ' > ' + моб.о);

check('в консоли страницы нет ошибок', ошибкиСтраницы.length === 0, ошибкиСтраницы.slice(0, 2).join(' | '));

console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
