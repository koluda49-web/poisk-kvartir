// План дня, «Сколько стоит дорога» и поездка на два дня на /marshrut и /m/<slug>.
//
// Зачем. Человек из ролика прикидывает поездку с телефона: к скольким успеет
// объехать точки, сколько уйдёт на бензин и где ночевать, если за день не
// успеть. Проверяем, что время считается от минут перегонов по дорогам
// (legMinutes), «пробыть» и расход переживают перезагрузку, расстояние в
// калькуляторе после правки руками больше не перетирается, а два дня делят
// список, план и кнопки Яндекса и попадают в ссылку (d=N).
//
// Сервер должен быть запущен.
//   node проверки/план-дня.mjs
//   node проверки/план-дня.mjs http://127.0.0.1:8095
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9605, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-plan-' + process.pid,
  'about:blank'], { stdio: 'ignore' });
// что бы ни случилось — свой Chrome не оставляем висеть
const гасить = (e) => { console.error(e); try { chrome.kill(); } catch {} process.exit(1); };
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') ошибки.push((m.params.args || []).map(a => a.value || a.description).join(' '));
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 60) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };
const открыть = async (адрес, усл) => {
  await send('Page.navigate', { url: адрес });
  // ждём именно новую страницу: старая тоже бывает «complete», пока грузится следующая
  await sleep(300);
  return ждать(`document.readyState === 'complete' && typeof Т !== 'undefined' && (${усл})`, 80);
};
const мин = t => { const m = /^(\d\d):(\d\d)/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
// времена приезда и отъезда в таблице дня: [[приезд, отъезд], …] в минутах
const времена = (где = '#rPlan1') => js(`JSON.stringify([...document.querySelectorAll('${где} tr.pp')].map(function(r){
  return [r.querySelector('.ar').textContent, r.querySelector('.dp').textContent]; }))`).then(JSON.parse);
const дорогаЕсть = () => js(`!!(ДОРОГА && ДОРОГА.к === ключДороги() && Array.isArray(ДОРОГА.d.legMinutes))`);
const ввести = (id, v) => js(`(function(){ var e = document.getElementById('${id}'); e.value = ${JSON.stringify(v)};
  e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const запросовЖилья = () => js(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/places/stay') >= 0; }).length`);

await send('Page.navigate', { url: SITE + '/marshrut' });
await sleep(800);
await js(`localStorage.clear(); 1`);

// ── одна точка: ни плана, ни топлива ──
await открыть(SITE + '/marshrut?p=5069', `location.search === '?p=5069' && Т.length === 1`);
await sleep(300);
check('одна точка: плана дня нет', await js(`document.getElementById('rPlan').hidden && document.getElementById('rPlan').offsetParent === null`));
check('одна точка: калькулятора топлива нет', await js(`document.getElementById('rFuel').hidden && document.getElementById('rFuel').offsetParent === null`));

// ── план дня на трёх точках ──
await открыть(SITE + '/marshrut?p=5069,910026,910027', `Т.length === 3 && !document.getElementById('rPlan').hidden`);
check('три точки: план дня виден', await js(`!document.getElementById('rPlan').hidden && document.getElementById('rPlan').offsetParent !== null`));
check('секции идут после «По пути» и перед поиском', await js(`(function(){ var n = document.getElementById('rNear'), p = document.getElementById('rPlan'), f = document.getElementById('rFuel');
  return n.nextElementSibling === p && p.nextElementSibling === f && f.nextElementSibling.classList.contains('add'); })()`));
check('заголовки «План дня» и «Сколько стоит дорога»', (await js(`document.getElementById('rPlanH').textContent + '|' + document.getElementById('rFuelH').textContent`)) === 'План дня|Сколько стоит дорога');
check('выезд по умолчанию 09:00', (await js(`document.getElementById('rStart').type + ' ' + document.getElementById('rStart').value`)) === 'time 09:00');
check('флажок «два дня» есть при трёх точках', await js(`!document.getElementById('rTwoL').hidden`));
check('пока два дня выключены, жильё не запрашивается', (await запросовЖилья()) === 0);

const естьДорога = await ждать(`!!(ДОРОГА && ДОРОГА.к === ключДороги() && Array.isArray(ДОРОГА.d.legMinutes))`, 80);
if (!естьДорога) console.log('  (OSRM не ответил — время считается по прямой, проверяю «примерно»)');
const перегоны = естьДорога ? await js(`ДОРОГА.d.legMinutes`) : await js(`перегоны().map(function(x){ return x.мин; })`);
let в = await времена();
check('в таблице три точки', в.length === 3, JSON.stringify(в));
check('первая точка: приезд 09:00, отъезд 09:45 (пробыть 45)', мин(в[0][0]) === 540 && мин(в[0][1]) === 585, JSON.stringify(в[0]));
check('вторая точка: приезд = 09:45 + дорога' + (естьДорога ? ' из legMinutes' : ' по прямой'),
  мин(в[1][0]) === 585 + перегоны[0], в[1][0] + ' при перегоне ' + перегоны[0]);
check('третья точка: приезд = отъезд второй + дорога', мин(в[2][0]) === мин(в[1][1]) + перегоны[1], JSON.stringify(в) + ' / ' + перегоны);
check('у всех по умолчанию «пробыть» 45 мин', await js(`[...document.querySelectorAll('#rPlan1 select.ps')].every(function(s){ return s.value === '45'; })`));
check('варианты «пробыть»: 15, 30, 45, 60, 90, 120, 180', (await js(`[...document.querySelector('#rPlan1 select.ps').options].map(function(o){ return o.value; }).join(',')`)) === '15,30,45,60,90,120,180');
const итог = await js(`document.querySelector('#rPlan1 .pi').textContent`);
check('итог «Последняя точка — до HH:MM» = отъезд последней', итог.startsWith('Последняя точка — до ' + в[2][1].slice(0, 5)), итог);
if (естьДорога) check('с минутами по дорогам пометки «примерно» нет', !(await js(`document.getElementById('rPlan1').textContent.indexOf('примерно') >= 0`)));
check('на дороге между точками — строка «в дороге»', (await js(`document.querySelectorAll('#rPlan1 tr.rd').length`)) === 2);

// без дороги — по прямой ×1,3 при 60 км/ч и «примерно»
{
  const было = await js(`JSON.stringify(ДОРОГА)`);
  await js(`ДОРОГА = null; планИТопливо(); 1`);
  const оценка = await js(`Math.round(км(Т[0], Т[1]) * 1.3)`);
  const вп = await времена();
  check('без legMinutes: приезд второй = 09:45 + прямая ×1,3 при 60 км/ч', мин(вп[1][0]) === 585 + оценка, вп[1][0] + ' / ' + оценка);
  check('без legMinutes: у времени пометка «примерно»', await js(`document.querySelectorAll('#rPlan1 tr.pp')[1].querySelector('.ar').textContent.indexOf('примерно') > 0
    && document.querySelector('#rPlan1 .pi').textContent.indexOf('примерно') > 0`));
  check('без legMinutes: у первой точки пометки нет', await js(`document.querySelector('#rPlan1 tr.pp .ar').textContent === '09:00'`));
  await js(`ДОРОГА = ${было}; планИТопливо(); 1`);
}

// «пробыть» у первой точки 90 → всё дальше сдвинулось на 45 мин и пережило перезагрузку
const первыйИд = await js(`String(Т[0].id)`);
await js(`(function(){ var s = document.querySelector('#rPlan1 select.ps'); s.value = '90'; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`);
const в90 = await времена();
check('пробыть 90: отъезд первой 10:30', мин(в90[0][1]) === 630, JSON.stringify(в90[0]));
check('пробыть 90: все последующие времена сдвинулись на 45 мин',
  в90.slice(1).every((р, i) => мин(р[0]) === мин(в[i + 1][0]) + 45 && мин(р[1]) === мин(в[i + 1][1]) + 45), JSON.stringify(в90));
check('пробыть 90: в localStorage.routeStay по id точки', (await js(`JSON.parse(localStorage.getItem('routeStay') || '{}')[${JSON.stringify(первыйИд)}]`)) === 90);
check('после выбора фокус остался на выборе той же точки', await js(`document.activeElement && document.activeElement.getAttribute('data-id') === ${JSON.stringify(первыйИд)}`));
await открыть(SITE + '/marshrut?p=5069,910026,910027', `Т.length === 3 && document.querySelectorAll('#rPlan1 tr.pp').length === 3`);
if (естьДорога) await ждать(`!!(ДОРОГА && ДОРОГА.к === ключДороги())`, 60);
check('после перезагрузки у первой точки 90', (await js(`document.querySelector('#rPlan1 select.ps').value`)) === '90');
check('после перезагрузки времена те же', JSON.stringify(await времена()) === JSON.stringify(в90), JSON.stringify(await времена()));

// время выезда: запоминается, переход через полночь — «+1 день»
await ввести('rStart', '23:30');
const ночь = await js(`document.querySelector('#rPlan1 .pi').textContent`);
check('выезд 23:30: итог с «+1 день»', /до \d\d:\d\d \+1 день/.test(ночь), ночь);
check('выезд 23:30: приезд первой 23:30', (await времена())[0][0] === '23:30');
check('выезд в localStorage.routeStart', (await js(`localStorage.getItem('routeStart')`)) === '23:30');
await открыть(SITE + '/marshrut?p=5069,910026,910027', `Т.length === 3 && document.querySelectorAll('#rPlan1 tr.pp').length === 3`);
check('выезд пережил перезагрузку', (await js(`document.getElementById('rStart').value`)) === '23:30');
await ввести('rStart', '09:00');
await js(`localStorage.removeItem('routeStay'); ПРОБЫТЬ = {}; планИТопливо(); 1`);

// ── сколько стоит дорога ──
if (естьДорога) await ждать(`!!(ДОРОГА && ДОРОГА.к === ключДороги())`, 60);
const авто = await js(`(ДОРОГА && ДОРОГА.к === ключДороги()) ? Math.round(ДОРОГА.d.km) : расстояниеМаршрута()`);
check('топливо: три поля', (await js(`[...document.querySelectorAll('#rFuel input')].map(function(i){ return i.id; }).join(',')`)) === 'rFuelKm,rFuelUse,rFuelPrice');
check('топливо: расстояние подставилось ' + (естьДорога ? 'из км по дорогам' : 'по прямой ×1,3'), (await js(`document.getElementById('rFuelKm').value`)) === String(авто), (await js(`document.getElementById('rFuelKm').value`)) + ' / ' + авто);
check('топливо: по умолчанию 7.5 и 2.60', (await js(`document.getElementById('rFuelUse').value + ' ' + document.getElementById('rFuelPrice').value`)) === '7.5 2.60');
check('топливо: «↺ по маршруту» не видно, пока расстояние своё', await js(`document.getElementById('rFuelAuto').hidden`));
await ввести('rFuelPrice', '2,60');
await ввести('rFuelKm', '100');
const сумма100 = await js(`document.getElementById('rFuelSum').textContent`);
check('100 км, 7.5 и 2,60 → «7.5 л» и «19.50 BYN»', сумма100 === '≈ 7.5 л · ≈ 19.50 BYN', сумма100);
await ввести('rFuelKm', '250');
check('250 км → итог пересчитан сразу', (await js(`document.getElementById('rFuelSum').textContent`)) === '≈ 18.8 л · ≈ 48.75 BYN', await js(`document.getElementById('rFuelSum').textContent`));
await js(`нарисовать(); планИТопливо(); 1`);
await sleep(700);
check('правка руками не перетирается перерисовкой', (await js(`document.getElementById('rFuelKm').value`)) === '250');
check('после правки видно «↺ по маршруту»', await js(`!document.getElementById('rFuelAuto').hidden`));
await js(`document.getElementById('rFuelAuto').click(); 1`);
check('«↺ по маршруту» вернул расстояние маршрута', (await js(`document.getElementById('rFuelKm').value`)) === String(await js(`расстояниеМаршрута()`)));
check('«↺ по маршруту» спрятался', await js(`document.getElementById('rFuelAuto').hidden`));
await ввести('rFuelPrice', 'abc');
check('неправильная цена → «—»', (await js(`document.getElementById('rFuelSum').textContent`)) === '—');
await ввести('rFuelPrice', '2,75');
await ввести('rFuelUse', '6,2');
check('расход и цена в localStorage.routeFuel', (await js(`localStorage.getItem('routeFuel')`)) === JSON.stringify({ use: '6,2', price: '2,75' }), await js(`localStorage.getItem('routeFuel')`));
await открыть(SITE + '/marshrut?p=5069,910026,910027', `Т.length === 3 && !document.getElementById('rFuel').hidden`);
check('расход и цена пережили перезагрузку', (await js(`document.getElementById('rFuelUse').value + ' ' + document.getElementById('rFuelPrice').value`)) === '6,2 2,75');
await js(`localStorage.removeItem('routeFuel'); 1`);

// ── два дня на четырёх точках ──
await js(`localStorage.clear(); 1`);
await открыть(SITE + '/marshrut?p=5069,910026,910027,286&o=1', `Т.length === 4 && !document.getElementById('rTwoL').hidden`);
await ждать(`!!(ДОРОГА && ДОРОГА.к === ключДороги())`, 60);
check('четыре точки: флажок «Поездка на два дня» виден', await js(`!document.getElementById('rTwoL').hidden && document.getElementById('rTwoL').offsetParent !== null`));
check('до включения: одна кнопка Яндекса', await js(`!document.getElementById('rGo').hidden && document.getElementById('rGo1').hidden && document.getElementById('rGo2').hidden`));
await js(`document.getElementById('rTwo').click(); 1`);
const N = await js(`НОЧЁВКА`);
const ждёмN = await js(`ночёвкаПоУмолчанию()`);
check('ночёвка по умолчанию — где набралась половина пути', N === ждёмN && N >= 1 && N <= 3, N + ' / ' + ждёмN);
const половина = await js(`(function(){ var п = перегоны(), всего = 0, нак = 0; п.forEach(function(x){ всего += x.км; });
  for(var i = 0; i < НОЧЁВКА - 1; i++) нак += п[i].км; var до = нак - (НОЧЁВКА > 1 ? п[НОЧЁВКА - 2].км : 0);
  // после последней точки ночевать негде: если половина набирается только к ней — ночёвка после предпоследней
  return (нак >= всего / 2 || НОЧЁВКА === Т.length - 1) && (НОЧЁВКА === 1 || до < всего / 2); })()`);
check('ночёвка: у точки N накоплено ≥ половины (или это предпоследняя), у предыдущей — меньше', половина, await js(`JSON.stringify(перегоны().map(function(x){ return Math.round(x.км); }))`) + ' N=' + N);
const заголовки = await js(`JSON.stringify([...document.querySelectorAll('#rlist .dh')].map(function(e){ return e.textContent; }))`).then(JSON.parse);
check('в списке заголовки «День 1 · X км» и «День 2 · Y км»', заголовки.length === 2 && /^День 1 · \d+ км$/.test(заголовки[0]) && /^День 2 · \d+ км$/.test(заголовки[1]), заголовки.join(' | '));
check('заголовок «День 2» стоит перед точкой N+1', await js(`(function(){ var л = document.getElementById('rlist'), д = л.querySelectorAll('.dh');
  return л.firstElementChild === д[0] && д[1].nextElementSibling === л.querySelectorAll('.it')[НОЧЁВКА]; })()`));
check('км дней в сумме — длина маршрута', await js(`(function(){ var s = 0; перегоны().forEach(function(x){ s += x.км; });
  var д = [...document.querySelectorAll('#rlist .dh')].map(function(e){ return +e.textContent.match(/(\\d+) км/)[1]; });
  return Math.abs(д[0] + д[1] - s) <= 1.01; })()`));
check('в адресе d=N', (await js(`location.search`)).includes('&d=' + N), await js(`location.search`));
check('выбор «Ночёвка после точки» 1..3 и стоит на N', (await js(`[...document.getElementById('rNightN').options].map(function(o){ return o.value; }).join(',') + '|' + document.getElementById('rNightN').value`)) === '1,2,3|' + N);
check('план по дням: в первом дне N точек, во втором 4−N', (await js(`document.querySelectorAll('#rPlan1 tr.pp').length + ',' + document.querySelectorAll('#rPlan2 tr.pp').length`)) === N + ',' + (4 - N));
const в2 = await времена('#rPlan2');
const ногаN = await js(`перегоны()[НОЧЁВКА - 1].мин`);
check('второй день: выезд тот же, приезд к первой точке = 09:00 + дорога от ночёвки', мин(в2[0][0]) === 540 + ногаN, в2[0][0] + ' / ' + ногаN);
check('у каждого дня свой итог «Последняя точка»', (await js(`document.querySelectorAll('#rPlan .pi').length`)) === 2);
check('две кнопки «День 1/2 в Яндекс.Картах»', await js(`document.getElementById('rGo').hidden && !document.getElementById('rGo1').hidden && !document.getElementById('rGo2').hidden
  && document.getElementById('rGo1').textContent.indexOf('День 1 в Яндекс.Картах') === 0 && document.getElementById('rGo2').textContent.indexOf('День 2 в Яндекс.Картах') === 0`));
check('кнопка первого дня — точки 1..N', (await js(`document.getElementById('rGo1').href`)) === await js(`яндекс(Т.slice(0, НОЧЁВКА))`)
  && (await js(`(document.getElementById('rGo1').href.match(/rtext=([^&]*)/) || [])[1].split('~').length`)) === N);
check('кнопка второго дня — от ночёвки до конца, формат как у rGo', /^https:\/\/yandex\.by\/maps\/\?rtext=[\d.,~]+&rtt=auto$/.test(await js(`document.getElementById('rGo2').href`))
  && (await js(`document.getElementById('rGo2').href.match(/rtext=([^&]*)/)[1].split('~').length`)) === 4 - N + 1, await js(`document.getElementById('rGo2').href`));
check('кнопки видны на телефоне', await js(`document.getElementById('rGo1').offsetHeight > 0 && document.getElementById('rGo2').offsetHeight > 0`));

// ночёвка: заголовок, до 4 карточек или «не нашлось»
check('блок ночёвки между днями', await js(`(function(){ var н = document.getElementById('rNight'); return !н.hidden && н.previousElementSibling.id === 'rPlan1' && н.nextElementSibling.id === 'rPlan2'; })()`));
check('заголовок «Ночёвка рядом с «название»»', (await js(`document.getElementById('rNightH').textContent`)) === 'Ночёвка рядом с «' + (await js(`Т[НОЧЁВКА - 1].name`)) + '»');
const жильёПришло = await ждать(`document.querySelectorAll('#rNightList a.nc').length > 0 || document.getElementById('rNightMsg').textContent === 'В 30 км жилья не нашлось'`, 160);
check('жильё пришло: карточки или «В 30 км жилья не нашлось»', жильёПришло, await js(`document.getElementById('rNightMsg').textContent`));
const карточек = await js(`document.querySelectorAll('#rNightList a.nc').length`);
check('карточек не больше 4', карточек <= 4, карточек);
if (карточек) {
  check('карточки: ссылка на объявление в новой вкладке', await js(`[...document.querySelectorAll('#rNightList a.nc')].every(function(a){ return /^https?:/.test(a.href) && a.target === '_blank' && a.rel === 'noopener'; })`));
  check('карточки: название, цена в BYN, источник', await js(`[...document.querySelectorAll('#rNightList a.nc')].every(function(a){
    return a.querySelector('.p').textContent.trim() && /\\d+ BYN$/.test(a.querySelector('.d').textContent) && a.querySelector('.s').textContent.trim(); })`));
  check('карточки: снимок или заглушка', await js(`[...document.querySelectorAll('#rNightList a.nc')].every(function(a){ return a.querySelector('img') || a.querySelector('.ni'); })`));
  const стэй = await js(`ЖИЛЬЁ[Т[НОЧЁВКА - 1].lat + ',' + Т[НОЧЁВКА - 1].lng]`);
  check('карточки — первые 4 в порядке ответа API', JSON.stringify(await js(`[...document.querySelectorAll('#rNightList a.nc')].map(function(a){ return a.getAttribute('href'); })`))
    === JSON.stringify(стэй.items.slice(0, 4).map(x => x.link)));
} else console.log('  (жилья в 30 км нет — карточки не проверены)');
check('«Всё жильё рядом →» ведёт на поиск области, как кнопка у места на главной', await js(`(function(){ var a = document.getElementById('rNightAll'); var d = ЖИЛЬЁ[Т[НОЧЁВКА - 1].lat + ',' + Т[НОЧЁВКА - 1].lng];
  return !a.hidden && a.textContent === 'Всё жильё рядом →' && a.getAttribute('href') === (d && d.region ? '/?region=' + encodeURIComponent(d.region) : '/'); })()`), await js(`document.getElementById('rNightAll').getAttribute('href')`));
check('жильё запрошено один раз и с r=30', await js(`(function(){ var e = performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/places/stay') >= 0; });
  return e.length === 1 && e[0].name.indexOf('&r=30') > 0; })()`), await запросовЖилья());
// перерисовки не спрашивают жильё повторно
await js(`нарисовать(); планИТопливо(); планИТопливо(); 1`);
await sleep(900);
check('перерисовка не запрашивает жильё заново', (await запросовЖилья()) === 1, await запросовЖилья());

// картинка: разделители «День 1», «День 2»
{
  await js(`window.__плиткиАдрес = ''; window.__оригКартинка = картинкаМаршрута; window.картинкаМаршрута = function(д){ window.__д = д; return window.__оригКартинка(д); }; 1`);
  await js(`window.собратьКартинку().then(function(){ return 1; })`);
  const стр = await js(`JSON.stringify(window.__д.строки.map(function(с){ return с.разделитель ? ('#' + с.разделитель) : String(с.номер); }))`).then(JSON.parse);
  const ждём = ['#День 1'].concat([1, 2, 3, 4].slice(0, N).map(String), ['#День 2'], [1, 2, 3, 4].slice(N).map(String));
  check('картинка: в списке разделители «День 1» и «День 2»', JSON.stringify(стр) === JSON.stringify(ждём), JSON.stringify(стр));
  await js(`window.картинкаМаршрута = window.__оригКартинка; 1`);
}

// смена ночёвки: адрес, заголовки и жильё для другой точки
const другая = N === 1 ? 2 : 1;
await js(`(function(){ var s = document.getElementById('rNightN'); s.value = '${другая}'; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`);
check('смена ночёвки: d в адресе поменялся', (await js(`location.search`)).includes('&d=' + другая), await js(`location.search`));
check('смена ночёвки: «День 2» перед точкой ' + (другая + 1), await js(`document.querySelectorAll('#rlist .dh')[1].nextElementSibling === document.querySelectorAll('#rlist .it')[${другая}]`));
check('смена ночёвки: заголовок блока про другую точку', (await js(`document.getElementById('rNightH').textContent`)) === 'Ночёвка рядом с «' + (await js(`Т[${другая - 1}].name`)) + '»');
await ждать(`document.querySelectorAll('#rNightList a.nc').length > 0 || document.getElementById('rNightMsg').textContent === 'В 30 км жилья не нашлось'`, 160);
check('смена ночёвки: жильё запрошено для новой точки', await js(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/places/stay?lat=' + Т[${другая - 1}].lat) >= 0; }).length === 1`));

// перезагрузка по адресу восстанавливает
const адрес = await js(`location.href`);
await открыть(адрес, `Т.length === 4 && document.querySelectorAll('#rlist .dh').length === 2`);
check('перезагрузка: флажок включён, ночёвка после ' + другая, (await js(`document.getElementById('rTwo').checked + '|' + НОЧЁВКА + '|' + document.getElementById('rNightN').value`)) === 'true|' + другая + '|' + другая);
check('перезагрузка: заголовки дней и две кнопки', await js(`document.querySelectorAll('#rlist .dh').length === 2 && !document.getElementById('rGo1').hidden && document.getElementById('rGo').hidden`));
check('перезагрузка: адрес тот же', (await js(`location.href`)) === адрес, await js(`location.href`));

// перетаскивание строк со вставленными заголовками: стрелка вниз на ручке первой точки
{
  const до = await js(`ключИд(Т)`);
  await js(`(function(){ var р = document.querySelector('#rlist .it .drag'); р.focus(); р.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); })(); 1`);
  const после = await js(`ключИд(Т)`);
  const [a, b, ...rest] = до.split(',');
  check('с заголовками дней стрелка вниз меняет две точки', после === [b, a, ...rest].join(','), до + ' → ' + после);
  check('после перестановки заголовки на месте', await js(`document.querySelectorAll('#rlist .dh').length === 2 && document.querySelectorAll('#rlist .dh')[1].nextElementSibling === document.querySelectorAll('#rlist .it')[НОЧЁВКА]`));
  check('после перестановки d в адресе остался', (await js(`location.search`)).includes('&d=' + другая), await js(`location.search`));
}

// точек меньше трёх — два дня выключаются, d уходит из адреса
await js(`убрать(Т[3].id); 1`);
check('три точки: два дня ещё включены', await js(`ДВА_ДНЯ && document.querySelectorAll('#rlist .dh').length === 2`));
await js(`убрать(Т[2].id); 1`);
check('две точки: два дня выключены', await js(`!ДВА_ДНЯ && document.querySelectorAll('#rlist .dh').length === 0 && document.getElementById('rNight').hidden`));
check('две точки: флажка нет, одна кнопка Яндекса', await js(`document.getElementById('rTwoL').hidden && !document.getElementById('rGo').hidden && document.getElementById('rGo1').hidden`));
check('две точки: d из адреса убран', !(await js(`location.search`)).includes('d='), await js(`location.search`));

// ── /m/<slug>: настройки плана — не правка маршрута ──
await js(`localStorage.clear(); 1`);
await открыть(SITE + '/m/lida-voronovo', `Т.length === 7 && !document.getElementById('rPlan').hidden`);
check('/m: план дня и топливо есть', await js(`!document.getElementById('rPlan').hidden && !document.getElementById('rFuel').hidden`));
await js(`(function(){ var s = document.querySelector('#rPlan1 select.ps'); s.value = '120'; s.dispatchEvent(new Event('change', { bubbles: true })); })(); 1`);
await ввести('rStart', '10:00');
await ввести('rFuelUse', '8');
check('/m: «пробыть», выезд и расход не меняют адрес', (await js(`location.pathname + location.search`)) === '/m/lida-voronovo', await js(`location.pathname + location.search`));
check('/m: маршрут в хранилище не записан', (await js(`localStorage.getItem('route')`)) === null);
await js(`document.getElementById('rTwo').click(); 1`);
const Nm = await js(`НОЧЁВКА`);
check('/m: два дня → адрес /m/lida-voronovo?d=N', (await js(`location.pathname + location.search`)) === '/m/lida-voronovo?d=' + Nm, await js(`location.pathname + location.search`));
check('/m: после двух дней маршрут в хранилище не записан', (await js(`localStorage.getItem('route')`)) === null);
await открыть(SITE + '/m/lida-voronovo?d=' + Nm, `Т.length === 7 && document.querySelectorAll('#rlist .dh').length === 2`);
check('/m?d=N: страница открылась с двумя днями', await js(`document.getElementById('rTwo').checked && НОЧЁВКА === ${Nm}`));
check('/m?d=N: выезд 10:00 и «пробыть» 120 сохранились', (await js(`document.getElementById('rStart').value + '|' + document.querySelector('#rPlan1 select.ps').value`)) === '10:00|120');
await js(`document.getElementById('rTwo').click(); 1`);
check('/m: выключение двух дней убирает d', (await js(`location.pathname + location.search`)) === '/m/lida-voronovo', await js(`location.pathname + location.search`));
await js(`document.getElementById('rTwo').click(); 1`);
// первая правка маршрута на /m — адрес /marshrut, и d переходит в него
await js(`убрать(Т[6].id); 1`);
check('/m: правка маршрута → /marshrut?p=…&o=1&d=N', /^\/marshrut\?p=[^&]+&o=1&d=\d+$/.test(await js(`location.pathname + location.search`)), await js(`location.pathname + location.search`));

// тёмная тема не ломает вид: поля видны
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
check('тёмная тема: фон полей тёмный', (await js(`getComputedStyle(document.getElementById('rFuelKm')).backgroundColor`)) === 'rgb(29, 25, 22)');
await send('Emulation.setEmulatedMedia', { features: [] });
check('страница не прокручивается вбок на телефоне', await js(`document.documentElement.scrollWidth <= innerWidth`), await js(`document.documentElement.scrollWidth`));

await js(`localStorage.clear(); 1`);
check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
