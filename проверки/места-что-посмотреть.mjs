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
// План 11.10.2026 (Вордстат, Беларусь, 05.09–04.10.2026):
//   — «что посмотреть» в районных городах — только при восьми местах с фото и описанием в 15 км
//     (без военных объектов, мемориалов и кладбищ). Набрал один Заславль (/chto-posmotret-zaslavl,
//     h1 «Достопримечательности Заславля»), остальные (Лида, Пинск, Бобруйск, Барановичи, Орша, Несвиж,
//     Новогрудок, Борисов, Мозырь, Молодечно) не заводили — их адреса 404 и не в sitemap;
//   — блок «Что посмотреть за 1 день» на страницах Минска, Гродно, Бреста, Витебска, Могилёва и Полоцка:
//     5–7 мест из карточек страницы, без военных объектов, мемориалов, кладбищ и усыпальниц, в порядке
//     обхода (шаг — расстояние по прямой), «пешком» — только если все не дальше 3 км друг от друга;
//     ссылка «Открыть план на карте» — /marshrut?p=…&o=1 с теми же точками в том же порядке.
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

console.log('\n=== без флагов в кадре ===');
// На снимке ратуши City_hall_in_Vitebsk_-_001.jpg у входа висит флаг — правило
// сайта «без флагов». Взят снимок 2013 года, где флагов нет ни у входа, ни на башне.
{
  const p = await json('/api/place?id=910121');
  const снимок = (p.pics || [])[0] || '';
  check('910121 «Витебская ратуша»: не прежний снимок с флагом', !/City_hall_in_Vitebsk_-_001/.test(снимок) && !/City_hall_in_Vitebsk_-_001/.test((p.cred || {}).src || ''), снимок);
  check('910121: снимок Jurasikt, CC BY 3.0, 960 px',
        /VICIEBSK\._Town_hall\.\.jpg\/960px-/.test(снимок) && (p.cred || {}).author === 'Jurasikt' && (p.cred || {}).lic === 'CC BY 3.0',
        снимок.slice(-60) + ' ' + JSON.stringify(p.cred || {}));
  const r = await fetch(снимок, { headers: { 'User-Agent': 'nochy-proverka/1.0' } }).catch(() => null);
  check('910121: снимок открывается', !!r && r.ok && /image/.test(r.headers.get('content-type') || ''), r ? r.status : 'нет ответа');
}

console.log('\n=== поиск находит новые места ===');
for (const [запрос, id] of [['Шагала', 910127], ['Марков', 910132], ['Бялыницкого', 910141], ['Печерский', 910143],
                             ['Охотничий домик', 910147], ['Борисов камень', 910156], ['Домик Петра', 910157]]) {
  const r = await json('/api/places?q=' + encodeURIComponent(запрос));
  check('по запросу «' + запрос + '» находится ' + id, (r.items || []).some(p => p.id === id));
}

const раскрыть = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ВОЕННОЕ = /кладбищ|могил(?![её]в)|мемориальный комплекс|(^|[^а-яё])мемориал([^а-яё]|$)|братск(?!ая церковь)|воинск|партизан|войн|форт|(^|[^а-яё])дот([^а-яё]|$)|бункер|казарм|тюрем|хранилищ|укрепрайон|бруствер|блиндаж|окоп/i;
const полные = new Map();
for (const г of Object.keys((await json('/api/places')).groups || {}))
  for (const p of (await json('/api/places?group=' + encodeURIComponent(г))).items || []) полные.set(String(p.id), p);
const военное = p => !p || p.group === 'Военные' || /кладбищ|мемориальн|памятник/i.test(p.cat || '') || ВОЕННОЕ.test(p.name || '')
  || ['3736', '910103', '8392', '8180', '4503', '807', '4213'].includes(String(p.id));
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
const сетка = h => [...h.matchAll(/<h3><a href="\/mesto\/(\d+)-[^"]*">([^<]+)<\/a><\/h3><div class="m"><span>([\d,]+) км от центра<\/span>/g)]
  .map(м => ({ id: м[1], имя: раскрыть(м[2]), км: +м[3].replace(',', '.') }));

console.log('\n=== /chto-posmotret-zaslavl (11.10) ===');
{
  const п = '/chto-posmotret-zaslavl';
  const { код, html } = await текст(п);
  check(п + ' открывается (200)', код === 200, 'код ' + код);
  const h1 = раскрыть((html.match(/<h1>([^<]*)<\/h1>/) || [])[1] || '');
  check(п + ': h1 «Достопримечательности Заславля»', h1 === 'Достопримечательности Заславля', h1);
  const м = сетка(html), n = м.length;
  const t = раскрыть((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  check(п + ': title с обоими словами и числом мест (≤ 60)', t === 'Достопримечательности Заславля: что посмотреть, ' + n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'место' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'места' : 'мест') && t.length <= 60, t);
  const d = раскрыть((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  check(п + ': description 120–160', d.length >= 120 && d.length <= 160, d.length + ' ' + d);
  check(п + ': не меньше 8 мест с фото и описанием', n >= 8 && (html.match(/<p class="t">[^<]{60,}/g) || []).length === n
    && html.split('<article class="c">').slice(1).every(к => /<img src="[^"]+"/.test(к)), 'мест ' + n);
  check(п + ': все не дальше 15 км от центра Заславля', м.every(x => км([54.0030, 27.2760], [полные.get(x.id).lat, полные.get(x.id).lng]) <= 15.05),
    м.filter(x => км([54.0030, 27.2760], [полные.get(x.id).lat, полные.get(x.id).lng]) > 15.05).map(x => x.имя).join(', '));
  const плохие = м.filter(x => военное(полные.get(x.id)));
  check(п + ': нет военных объектов, мемориалов и кладбищ (линия Сталина рядом — 18 точек)', !плохие.length, плохие.map(x => x.имя).join(', '));
  check(п + ': Спасо-Преображенский собор и замчище — в начале', /Спасо-Преображенский|Замчище/.test(м.slice(0, 2).map(x => x.имя).join(' ')), м.slice(0, 2).map(x => x.имя).join('; '));
  const сВикисклада = (html.match(/<img src="https:\/\/(thumb|upload)\.wikimedia\.org/g) || []).length;
  check(п + ': у фото с Викисклада подписан автор и лицензия', сВикисклада === (html.match(/class="cr">Фото:/g) || []).length, 'фото ' + сВикисклада);
  for (const x of [м[0], м[n - 1]].filter(Boolean)) check('  /mesto/' + x.id + ' открывается', (await текст('/mesto/' + x.id)).код === 200);
  check(п + ': где остановиться — Минское море и Минская область', html.includes('href="/minskoe-more"') && html.includes('href="/minsk-obl"'));
  check(п + ': ссылка на «Достопримечательности Минской области»', html.includes('href="/chto-posmotret-minskaya-oblast"'));
  check(п + ' в sitemap', карта.includes('<loc>https://nochy.by' + п + '</loc>'));
  check(п + ': ссылка с хаба «Достопримечательности Беларуси»', (await текст('/dostoprimechatelnosti-belarusi')).html.includes('href="' + п + '"'));
  check(п + ': ссылка со страницы жилья /minskoe-more', (await текст('/minskoe-more')).html.includes('href="' + п + '"'));
}
for (const г of ['lida', 'pinsk', 'bobruisk', 'baranovichi', 'orsha', 'nesvizh', 'novogrudok', 'borisov', 'mozyr', 'molodechno']) {
  const п = '/chto-posmotret-' + г;
  check(п + ': не заведена (мест меньше восьми) — 404 и не в sitemap', (await текст(п)).код === 404 && !карта.includes(п + '</loc>'));
}

console.log('\n=== «Что посмотреть за 1 день» (11.10) ===');
for (const [г, где] of [['minsk', 'в Минске'], ['grodno', 'в Гродно'], ['brest', 'в Бресте'], ['vitebsk', 'в Витебске'], ['mogilev', 'в Могилёве'], ['polotsk', 'в Полоцке']]) {
  const п = '/chto-posmotret-' + г;
  const { код, html } = await текст(п);
  const блок = (html.split('<h2>Что посмотреть ' + где + ' за 1 день</h2>')[1] || '').split('<div class="grid">')[0];
  check(п + ': блок «Что посмотреть ' + где + ' за 1 день»', код === 200 && !!блок, 'код ' + код);
  if (!блок) continue;
  const точки = [...блок.matchAll(/<li><a href="\/mesto\/(\d+)-[^"]*">([^<]+)<\/a><small>([^<]+)<\/small><\/li>/g)]
    .map(м => ({ id: м[1], имя: раскрыть(м[2]), шаг: м[3] }));
  check(п + ': 5–7 мест', точки.length >= 5 && точки.length <= 7, String(точки.length));
  const вСетке = new Set(сетка(html).map(x => x.id));
  check(п + ': все места плана — из карточек страницы', точки.every(x => вСетке.has(x.id)));
  const плохие = точки.filter(x => военное(полные.get(x.id)) || /усыпальниц/i.test(x.имя));
  check(п + ': без военных объектов, мемориалов, кладбищ и усыпальниц', !плохие.length, плохие.map(x => x.имя).join(', '));
  const к = точки.map(x => [полные.get(x.id).lat, полные.get(x.id).lng]);
  const шагиСайта = точки.map(x => x.шаг === 'старт' ? 0 : +x.шаг.replace(/^\+/, '').replace(' км', '').replace(',', '.'));
  const шаги = к.map((т, i) => i ? км(к[i - 1], т) : 0);
  check(п + ': шаги «+N км» — по прямой между соседними точками', шагиСайта[0] === 0 && шаги.every((ш, i) => Math.abs(ш - шагиСайта[i]) <= 0.11 + ш * 0.02),
    шагиСайта.join(' ') + ' / ' + шаги.map(x => x.toFixed(2)).join(' '));
  let размах = 0; к.forEach(а => к.forEach(б => { размах = Math.max(размах, км(а, б)); }));
  const пешком = /<p class="lead">Пешком:/.test(блок);
  check(п + ': «пешком» честно — все места не дальше 3 км друг от друга (' + размах.toFixed(1) + ' км)', пешком ? размах <= 3 : /<p class="lead">На машине:/.test(блок));
  // порядок обхода: от каждой точки к ближайшей из оставшихся
  const ближайшие = точки.every((x, i) => i === 0 || к.slice(i).every(т => км(к[i - 1], к[i]) <= км(к[i - 1], т) + 1e-9));
  check(п + ': порядок — от каждой точки к ближайшей следующей', ближайшие);
  const ссылка = (блок.match(/<a class="pr-route" href="([^"]+)" rel="nofollow">Открыть план на карте →<\/a>/) || [])[1] || '';
  const адрес = раскрыть(ссылка);
  check(п + ': «Открыть план на карте» → /marshrut?p=<те же точки>&o=1, без from', адрес === '/marshrut?p=' + точки.map(x => x.id).join(',') + '&o=1', адрес);
  const м = await текст(адрес);
  check(п + ': страница маршрута открывается и знает все точки', м.код === 200 && точки.every(x => м.html.includes(x.id)), 'код ' + м.код);
  const d = раскрыть((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  check(п + ': description 120–160', d.length >= 120 && d.length <= 160, d.length + ' ' + d);
  if (г === 'brest') {
    check(п + ': план без крепости, честно сказано «кроме крепости»', !точки.some(x => ['3736', '910103'].includes(x.id)) && /кроме крепости/.test(блок)
      && /Брестская крепость — в [\d,]+ км от центра/.test(блок));
    // «братская церковь» — храм, а не братская могила: фильтр военного её больше не выкидывает
    check(п + ': в плане Свято-Николаевская братская церковь (910099)', точки.some(x => x.id === '910099'));
  }
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
