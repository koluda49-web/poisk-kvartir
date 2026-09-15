// Адреса объявлений сходятся с их точками на карте, а заголовки — без повторов.
//
// Зачем. Готовя пост про Браслав (15.09), нашли два промаха:
//   1) «Жильё рядом» у Замковой горы показывало квартиру «Глубокое, ул. Октября 41»
//      в полутора километрах — хозяин поставил метку на улицу Октября в Браславе,
//      а Глубокое в семидесяти километрах;
//   2) заголовки Realt шли с повтором города: «Браслав Браслав Ленинская ул. 76».
// Проверка на живых данных своего экземпляра, без браузера:
//   - у «Жильё рядом» Замковой горы нет объявлений из Глубокого;
//   - ни у одного заголовка в выдаче нет повтора «X X» в начале;
//   - по всем объявлениям check-in.by и kvartirka.by: город из адреса и точка
//     не дальше 30 км друг от друга, деревня — не дальше 50 км от райцентров
//     своей области. Итог — список расхождений, он должен быть пустым.
//
// Сервер должен быть уже запущен; каталоги досок собираются минуты три-пять
// после старта — проверка их дождётся.
//   node проверки/адреса-объявлений.mjs
//   node проверки/адреса-объявлений.mjs http://127.0.0.1:8095

import { readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok
  ? (passed++, console.log('  OK   ' + n))
  : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Сеть живая: источник может не ответить с первого раза.
async function json(p) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(BASE + p); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(2000);
  }
  return {};
}
const поиск = q => json('/api/search?' + new URLSearchParams(Object.assign(
  { region: 'any', city: '', type: 'any', rooms: '', guests: '', max: '' }, q)));

function км(a1, o1, a2, o2) {
  const t = Math.PI / 180;
  const h = Math.sin((a2 - a1) * t / 2) ** 2
    + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin((o2 - o1) * t / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const сравнимо = t => String(t || '').toLowerCase().replace(/ё/g, 'е').trim();

// Справочник городов берём из самого сервера — это данные, а не логика:
// разбор адреса и расстояния проверка считает сама.
const исходник = readFileSync(new URL('../kvartiry-server.js', import.meta.url), 'utf8');
const вытащить = (имя) => {
  const m = исходник.match(new RegExp('const ' + имя + ' = (\\{[\\s\\S]*?\\n\\});'));
  return m ? Function('return ' + m[1])() : {};
};
const ЦЕНТРЫ = вытащить('TOWN_CENTERS');
const ОБЛАСТИ = вытащить('REGIONS');
const РАЙЦЕНТРЫ = вытащить('РАЙЦЕНТРЫ');
const ГОРОДА = [];
for (const [имя, к] of Object.entries(ЦЕНТРЫ)) {
  const обл = Object.keys(ОБЛАСТИ).find(о => (ОБЛАСТИ[о].cities || []).includes(имя)) || 'minsk';
  ГОРОДА.push([имя, обл, к]);
}
for (const [обл, города] of Object.entries(РАЙЦЕНТРЫ))
  for (const [имя, к] of Object.entries(города)) ГОРОДА.push([имя, обл, к]);
const минская = о => о === 'minsk' || о === 'minsk-obl';
const однаОбласть = (а, б) => а === б || (минская(а) && минская(б));
check('справочник городов прочитан (' + ГОРОДА.length + ')', ГОРОДА.length > 100);

// Город из заголовка: первый кусок до запятой, кроме области.
function городИзЗаголовка(заголовок) {
  const к = String(заголовок || '').split(',').map(x => x.trim()).filter(x => x && !/област/i.test(x))[0] || '';
  if (/^(аг\.|а\.\s*г\.|а\/г|д\.|п\.|пос\.|х\.)/i.test(к)) return { имя: к.replace(/^\S+\s*/, ''), деревня: true };
  const имя = к.replace(/^(г\.\s*п\.|гп\.?|г\.)\s*/i, '');
  return { имя, деревня: false };
}

// ── 0. ждём каталоги ─────────────────────────────────────────────────────
console.log('\n=== каталоги досок собраны ===');
let ci = [], kv = [];
for (let i = 0; i < 60; i++) {
  ci = (await поиск({ source: 'checkin' })).items || [];
  kv = (await поиск({ source: 'kvartirka' })).items || [];
  if (ci.length && kv.length) break;
  if (i === 0) console.log('  … жду каталоги (до десяти минут)');
  await sleep(10000);
}
check('check-in.by в памяти (' + ci.length + ')', ci.length > 100);
check('kvartirka.by в памяти (' + kv.length + ')', kv.length > 100);

// ── 1. Замковая гора в Браславе ──────────────────────────────────────────
console.log('\n=== «Жильё рядом» у Замковой горы ===');
const ЗАМКОВАЯ = [55.6346, 27.0459];
const рядом = await json('/api/places/stay?lat=' + ЗАМКОВАЯ[0] + '&lng=' + ЗАМКОВАЯ[1] + '&r=30');
const изГлубокого = (рядом.items || []).filter(x => /глубок/i.test((x.title || '') + ' ' + (x.area || '')));
check('в «Жильё рядом» нет объявлений из Глубокого', !изГлубокого.length,
  изГлубокого.map(x => x.src + ' «' + x.title + '» ' + x.km + ' км').join('; '));
// Двенадцать карточек — не всё: смотрим и по всему каталогу в радиусе 30 км.
const вРадиусе = ci.concat(kv).filter(x => x.lat && км(ЗАМКОВАЯ[0], ЗАМКОВАЯ[1], x.lat, x.lng) <= 30
                                          && /глубок/i.test((x.title || '') + ' ' + (x.area || '')));
check('во всём каталоге в 30 км от горы нет Глубокого', !вРадиусе.length,
  вРадиусе.map(x => x.link).join(' '));

// Сама квартира не пропала: в выдаче по Глубокому она есть и стоит у Глубокого.
const СЛАГ = 'ukhozhennaya-kvartira-glubokoe';
const та = ci.find(x => (x.link || '').includes(СЛАГ));
if (та) {
  const гл = ЦЕНТРЫ['Глубокое'];
  check('квартира «Глубокое, ул. Октября» стоит у Глубокого (' + Math.round(км(гл[0], гл[1], та.lat, та.lng)) + ' км)',
    та.lat && км(гл[0], гл[1], та.lat, та.lng) <= 30);
  const поГороду = (await поиск({ region: 'vitebsk', city: 'Глубокое', source: 'checkin' })).items || [];
  check('и осталась в выдаче по Глубокому', поГороду.some(x => (x.link || '').includes(СЛАГ)));
} else {
  console.log('  —    объявления ' + СЛАГ + ' в каталоге уже нет, пропускаю');
}

// ── 2. заголовки без повтора в начале ────────────────────────────────────
console.log('\n=== заголовки без повтора города ===');
// «X X …» для X из одного-трёх слов: «Браслав Браслав», «Турна Большая Турна Большая».
function повторВНачале(t) {
  const с = сравнимо(t).split(/[\s,]+/).filter(Boolean);
  for (let n = 1; n <= 3 && 2 * n <= с.length; n++)
    if (с.slice(0, n).join(' ') === с.slice(n, 2 * n).join(' ')) return true;
  return false;
}
let realtВсего = 0;
const повторы = [];
for (const region of ['vitebsk', 'brest', 'minsk', 'grodno', 'gomel', 'mogilev']) {
  const it = (await поиск({ region, source: 'both' })).items || [];
  realtВсего += it.filter(x => x.src === 'Realt').length;
  it.filter(x => повторВНачале(x.title)).forEach(x => повторы.push(region + ' ' + x.src + ' «' + x.title + '»'));
}
ci.concat(kv).filter(x => повторВНачале(x.title)).forEach(x => повторы.push(x.src + ' «' + x.title + '»'));
check('Realt в выдаче есть (' + realtВсего + ') — проверка заголовков не пустая', realtВсего > 0);
check('ни одного заголовка с повтором в начале', !повторы.length,
  повторы.length + ': ' + повторы.slice(0, 5).join('; '));
const висящие = ci.filter(x => /,\s*ул\.?$/.test(x.title || ''));
check('у check-in.by нет заголовков с висящим «ул.»', !висящие.length,
  висящие.slice(0, 3).map(x => x.title).join('; '));

// ── 3. город в адресе и точка ────────────────────────────────────────────
console.log('\n=== город в адресе и точка на карте ===');
const расхождения = [], поправлено = [];
let сверено = 0;
for (const x of ci.concat(kv)) {
  if (x.сверено) поправлено.push(x.src + ' «' + x.title + '» → ' + x.сверено + '  ' + x.link);
  if (!x.lat || !x.lng) continue;
  const место = городИзЗаголовка(x.title);
  const город = место.деревня ? null
    : ГОРОДА.find(г => сравнимо(г[0]) === сравнимо(место.имя) && однаОбласть(г[1], x.обл));
  if (город) {
    сверено++;
    const d = км(город[2][0], город[2][1], x.lat, x.lng);
    if (d > 30) расхождения.push(x.src + ' «' + x.title + '»: до ' + город[0] + ' ' + Math.round(d) + ' км  ' + x.link);
  } else if (x.обл) {
    const d = Math.min(...ГОРОДА.filter(г => однаОбласть(г[1], x.обл)).map(г => км(г[2][0], г[2][1], x.lat, x.lng)));
    if (d > 50) расхождения.push(x.src + ' «' + x.title + '»: до райцентров своей области ' + Math.round(d) + ' км  ' + x.link);
  }
}
console.log('  городов из адреса сверено: ' + сверено + ' из ' + (ci.length + kv.length));
console.log('  поправлено сервером (объяснимые случаи): ' + поправлено.length);
поправлено.forEach(s => console.log('       ' + s));
check('расхождений город/точка нет', !расхождения.length, расхождения.length + '');
расхождения.forEach(s => console.log('       ' + s));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
