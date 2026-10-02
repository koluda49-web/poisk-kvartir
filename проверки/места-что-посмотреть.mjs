// Точки 910121–910160: главные места Витебска, Могилёва, Гомеля и Полоцка (02.10.2026)
// для страниц «Что посмотреть в …».
//
// Зачем. Своих мест с фото и описанием у этих городов было 1, 2, 4 и 4, а страница
// собирается от восьми. Точки внесены скриптом из проверенных данных: описания своими
// словами по статьям Википедии, снимки — с Викисклада со свободной лицензией.
// Проверяем, что все точки дошли до карты и страницы места, стоят в своём городе,
// у каждой есть описание и снимок с автором и лицензией (CC BY и CC BY-SA требуют
// подписи), что источник описания записан в источники-описаний.json, что нет дублей
// и что Красного моста и памятника букве «Ў» нет — у сайта правило «без военного
// и политики». Без браузера.
//
//   node проверки/места-что-посмотреть.mjs http://127.0.0.1:9676
import { readFileSync } from 'node:fs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
// [город, первый id, последний id, центр, не дальше км]
const ГОРОДА = [
  ['Витебск', 910121, 910132, [55.1840, 30.2020], 6],
  ['Могилёв', 910133, 910143, [53.8940, 30.3310], 6],
  ['Гомель',  910144, 910152, [52.4250, 31.0130], 6],
  ['Полоцк',  910153, 910160, [55.4850, 28.7860], 6],
];
const ПЕРВЫЙ = 910121, ПОСЛЕДНИЙ = 910160, ЧИСЛО = ПОСЛЕДНИЙ - ПЕРВЫЙ + 1;

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const json = async p => (await fetch(SITE + p)).json();
const текст = async p => { const r = await fetch(SITE + p); return { код: r.status, html: await r.text() }; };
const км = (a, b) => {
  const к = Math.PI / 180, x = (b[1] - a[1]) * к * Math.cos((a[0] + b[0]) / 2 * к), y = (b[0] - a[0]) * к;
  return 6371 * Math.hypot(x, y);
};

console.log('=== список ===');
const все = (await json('/api/places?light=1')).items || [];
const новые = все.filter(p => p.id >= ПЕРВЫЙ && p.id <= ПОСЛЕДНИЙ);
check('все ' + ЧИСЛО + ' точек в списке', новые.length === ЧИСЛО,
      'нет: ' + Array.from({ length: ЧИСЛО }, (_, i) => ПЕРВЫЙ + i).filter(id => !новые.some(p => p.id === id)).join(', '));
check('все в Беларуси', новые.every(p => p.lat >= 51.2 && p.lat <= 56.2 && p.lng >= 23.1 && p.lng <= 32.8),
      новые.filter(p => !(p.lat >= 51.2 && p.lat <= 56.2 && p.lng >= 23.1 && p.lng <= 32.8)).map(p => p.id).join(', '));
for (const [город, с, по, центр, предел] of ГОРОДА) {
  const свои = новые.filter(p => p.id >= с && p.id <= по);
  const далеко = свои.filter(p => км(центр, [p.lat, p.lng]) > предел);
  check(город + ': ' + (по - с + 1) + ' точек, все не дальше ' + предел + ' км от центра', свои.length === по - с + 1 && далеко.length === 0,
        далеко.map(p => p.id + ' ' + км(центр, [p.lat, p.lng]).toFixed(1) + ' км').join('; '));
}
const имена = новые.map(p => p.name);
check('названия не повторяются', new Set(имена).size === имена.length);
check('нет дубля с другой точкой под тем же названием',
      новые.every(н => !все.some(p => p.id !== н.id && p.name.trim().toLowerCase() === н.name.trim().toLowerCase())),
      новые.filter(н => все.some(p => p.id !== н.id && p.name.trim().toLowerCase() === н.name.trim().toLowerCase())).map(p => p.name).join('; '));
const рядом = новые.flatMap(н => все.filter(p => p.id !== н.id && p.cat === н.cat && км([н.lat, н.lng], [p.lat, p.lng]) < 0.05).map(p => н.id + '~' + p.id));
check('нет второй точки той же категории ближе 50 м', рядом.length === 0, рядом.join(', '));
check('Красного моста и памятника букве «Ў» нет', !новые.some(p => /Красный мост|букве/i.test(p.name)));

console.log('\n=== источники описаний ===');
const ист = JSON.parse(readFileSync(new URL('../источники-описаний.json', import.meta.url), 'utf8'));
const безИсточника = Array.from({ length: ЧИСЛО }, (_, i) => ПЕРВЫЙ + i)
  .filter(id => !ист.some(x => x.id === id && /^https:\/\/ru\.wikipedia\.org\/wiki\/[^%]+$/.test(x.src)));
check('у каждой точки источник — статья Википедии, адрес кириллицей', безИсточника.length === 0, безИсточника.join(', '));

console.log('\n=== каждая точка ===');
for (let id = ПЕРВЫЙ; id <= ПОСЛЕДНИЙ; id++) {
  const p = await json('/api/place?id=' + id);
  const т = p.text || '';
  const имя = id + ' «' + (p.name || '').slice(0, 34) + '»';
  check(имя + ': описание не короче 150 знаков, без слова «флаг»', т.length >= 150 && !/флаг/i.test(т), 'знаков: ' + т.length);
  const pics = p.pics || [];
  check(имя + ': снимок с Викисклада, автор и лицензия',
        /^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(pics[0] || '') && !!(p.cred && p.cred.author && /^(CC|Public domain)/i.test(p.cred.lic || '')),
        (pics[0] || 'нет снимка').slice(0, 60) + ' ' + JSON.stringify(p.cred || {}));
  const стр = await текст('/mesto/' + id);
  check(имя + ': страница места открывается и подписывает автора снимка',
        стр.код === 200 && !!p.cred && стр.html.includes(p.cred.lic), 'код ' + стр.код);
}

console.log('\n=== поиск находит новые места ===');
for (const [запрос, id] of [['Шагала', 910127], ['Марков', 910132], ['Бялыницкого', 910141], ['Печерский', 910143],
                             ['Охотничий домик', 910147], ['Борисов камень', 910156], ['Домик Петра', 910157]]) {
  const r = await json('/api/places?q=' + encodeURIComponent(запрос));
  check('по запросу «' + запрос + '» находится ' + id, (r.items || []).some(p => p.id === id));
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
