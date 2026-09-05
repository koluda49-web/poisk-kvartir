// Проверка вкладки «Что посетить».
//
// Ловит:
//   1) пропал список мест или в нём появились точки без названия/фотографии;
//   2) перестал работать подбор «что рядом с городом»;
//   3) не отдаётся описание точки;
//   4) сломалась связка «место → жильё рядом».
//
// Сервер должен быть уже запущен.
//   npm run проверка-мест
//   npm run проверка-мест https://poisk-kvartir.onrender.com

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK   ' + name); }
  else { failed++; console.log('  ПАДАЕТ ' + name + (detail ? ('  — ' + detail) : '')); }
}
const json = async (p) => (await fetch(BASE + p)).json();

// ── 1. список мест ─────────────────────────────────────────────────────────
console.log('\n=== список мест ===');
const all = await json('/api/places');
const items = all.items || [];
// сервер отдаёт страницу, а не всё разом — смотрим на общее число
check('места отдаются (всего ' + (all.total || 0) + ')', (all.total || 0) > 700,
      'ждали хотя бы 700 точек — не отвалился ли справочник');
check('страница выдачи не пустая (' + items.length + ')', items.length > 100);

const noName = items.filter(x => !x.name || x.name.length < 3);
const noPic  = items.filter(x => !x.pic);
const noGeo  = items.filter(x => !(x.lat && x.lng));
check('у всех есть название', noName.length === 0, 'без названия: ' + noName.length);
check('у всех есть координаты', noGeo.length === 0, 'без координат: ' + noGeo.length);
// точку без фотографии показываем — но если фото пропали у большинства,
// значит отвалилась картинка с kudin.by, а не «мы просто ещё не сняли»
check('фотографии на месте (' + (items.length - noPic.length) + ' из ' + items.length + ')',
      noPic.length < items.length * 0.15, 'без фото: ' + noPic.length);

const withCat = items.filter(x => x.cat).length;
check('категории проставлены (' + withCat + ' из ' + items.length + ')',
      withCat > items.length * 0.8, 'без категории слишком много');

// ── 2. что рядом с городом ─────────────────────────────────────────────────
console.log('\n=== что посмотреть рядом с городом ===');
for (const [city, lat, lng, least] of [['Минск', 53.9023, 27.5619, 40], ['Брест', 52.0976, 23.7341, 10]]) {
  const near = await json('/api/places?lat=' + lat + '&lng=' + lng + '&r=50');
  const n = (near.items || []).length;
  check(city + ': нашлось мест в 50 км (' + n + ')', n >= least, 'ждали хотя бы ' + least);
  const far = (near.items || []).filter(x => x.km > 50.5);
  check(city + ': ничего лишнего за пределами радиуса', far.length === 0,
        'вылезло за радиус: ' + far.length);
  const sorted = (near.items || []).every((x, i, a) => i === 0 || a[i - 1].km <= x.km);
  check(city + ': отсортировано от ближних к дальним', sorted);
}

// ── 2б. поиск по названию ──────────────────────────────────────────────────
console.log('\n=== поиск по названию ===');
const mir = await json('/api/places?q=' + encodeURIComponent('мир'));
check('«мир» что-то находит (' + (mir.total || 0) + ')', (mir.total || 0) > 0);
check('в выдаче только подходящее',
      (mir.items || []).every(x => /мир/i.test(x.name + ' ' + x.addr + ' ' + x.cat)),
      'попало лишнее');
// поиск идёт по всей стране, а не только вокруг выбранного города
const mirFar = await json('/api/places?q=' + encodeURIComponent('мир') + '&lat=52.0976&lng=23.7341&r=50');
check('радиус не режет поиск', (mirFar.total || 0) === (mir.total || 0),
      'нашлось ' + (mirFar.total||0) + ' вместо ' + (mir.total||0));
const zamok = await json('/api/places?q=' + encodeURIComponent('замок'));
check('название важнее адреса: «замок» → первым замок',
      /замок/i.test(((zamok.items || [])[0] || {}).name || ''),
      'первым идёт ' + (((zamok.items || [])[0] || {}).name || 'ничего'));
const mirFirst = ((mir.items || [])[0] || {}).name || '';
check('«мир» → сначала Мирский замок, потом «Первой мировой»', /^мирский/i.test(mirFirst),
      'первым идёт ' + mirFirst);

const yo = await json('/api/places?q=' + encodeURIComponent('костел'));
check('«е» и «ё» ищутся одинаково (' + (yo.total || 0) + ')', (yo.total || 0) > 0,
      'по «костел» не находится «костёл»');
const none = await json('/api/places?q=' + encodeURIComponent('щщщщ'));
check('на бессмыслицу отвечает пустотой', (none.total || 0) === 0);

// ── 3. описание точки ──────────────────────────────────────────────────────
console.log('\n=== описание точки ===');
const one = (all.items || [])[0];
const det = await json('/api/place?id=' + one.id);
check('описание приходит (' + (det.text || '').length + ' знаков)', (det.text || '').length > 40,
      'пусто — страница места будет голой');
check('есть ссылка на подробности', /kudin\.by/.test(det.more || ''), 'нет ссылки на первоисточник');

// ── 4. связка «место → жильё рядом» ────────────────────────────────────────
console.log('\n=== жильё рядом с местом ===');
const stay = await json('/api/places/stay?lat=53.9023&lng=27.5619');
check('подбирается жильё рядом (' + (stay.total || 0) + ')', (stay.total || 0) > 0,
      'связка «место → жильё» не работает');
check('у вариантов посчитано расстояние',
      (stay.items || []).every(x => typeof x.km === 'number'), 'нет расстояния до места');

// ── 4б. адрес говорит, где это ─────────────────────
// Точки, добавленные нами вручную, легко описать одной улицей и забыть
// город. «ул. Академическая, 7а» — это не адрес: непонятно, Гродно это
// или Минск.
console.log('\n=== адреса точек ===');
// Берём полный список: искать наши точки поиском нельзя — точка без города
// в адресе по городу и не найдётся, и проверка прошла бы впустую.
const own = ((await json('/api/places?light=1')).items || []).filter(x => x.id >= 900000);
const ГДЕ = /минск|брест|гомел|гродн|витебск|могил|полоцк|несвиж|слоним|браслав|немново|жирович|р-н|район|обл|аг\.|д\.|г\.|п\.|дер\./i;
const безГорода = own.filter(x => !ГДЕ.test(x.addr || ''));
check('у наших точек в адресе есть город или район (' + own.length + ' шт.)',
      own.length > 0 && безГорода.length === 0,
      безГорода.length
        ? ('без города: ' + безГорода.map(x => x.name + ' — «' + x.addr + '»').slice(0, 4).join('; '))
        : 'наши точки вообще не попали в выдачу');

// ── 4в. жильё рядом с глубинкой ──────────────────
// Ради областных центров этот раздел не нужен: туда и так едут. Смысл в том,
// чтобы найти ночлег у замка в Лиде или у костёла в Гольшанах. Раньше поиск
// шёл по центру области, и там выходил ноль.
console.log('\n=== жильё рядом с местами вне областных центров ===');
for (const [название, lat, lng] of [['Лидский замок', 53.8845, 25.3007],
                                    ['Гольшанский замок', 54.2506, 26.0022],
                                    ['Новогрудок, руины замка', 53.5996, 25.8255],
                                    ['Мирский замок', 53.4512, 26.4730],
                                    ['Несвижский замок', 53.2226, 26.6912]]) {
  const d = await json('/api/places/stay?lat=' + lat + '&lng=' + lng);
  check(название + ': жильё рядом нашлось (' + (d.total || 0) + ')', (d.total || 0) > 0,
        'ноль — значит ищем не в том городе');
}

// ── 4г. свои снимки ──────────────────────────────────
// Снимок кладут в папку «фото-точек» и называют именем точки — он должен
// подхватиться сам, без правок кода. Имя файла по-русски: заставлять
// переименовывать в латиницу значит терять смысл затеи.
console.log('\n=== свои снимки подхватываются по имени файла ===');
{
  const свои = ((await json('/api/places?light=1')).items || []);
  const версаль = свои.find(x => /версаль/i.test(x.name || ''));
  check('точка «Версаль» есть в справочнике', !!версаль,
        'её нет — значит не добавили');
  if (версаль) {
    const d = await json('/api/place?id=' + версаль.id);
    check('у «Версаля» есть описание', (d.text || '').length > 40, 'описание пустое');
  }
  const полный = ((await json('/api/places?q=' + encodeURIComponent('версаль'))).items || [])[0];
  check('у «Версаля» подхватился свой снимок',
        !!(полный && /фото-точек/.test(полный.pic || '')),
        'снимок: ' + ((полный || {}).pic || 'нет'));
  if (полный && полный.pic) {
    const r = await fetch(BASE + encodeURI(полный.pic));
    check('снимок с русским именем отдаётся (' + r.status + ')', r.status === 200,
          'сервер не отдал файл: ' + полный.pic);
    await r.arrayBuffer().catch(() => {});
  }
  // и заодно: наружу из папки выйти нельзя
  for (const злой of ['/фото-точек/..%2F..%2Fpackage.json', '/фото-точек/..%5C..%5Ckvartiry-server.js']) {
    const r = await fetch(BASE + злой);
    await r.text().catch(() => {});
    check('попытка выйти из папки отбита (' + r.status + ')', r.status === 404, злой);
  }
}

// ── 5. карта и переход к жилью ─────────────────────────────────────────────
console.log('\n=== карта и переход к жилью ===');
const light = await json('/api/places?light=1');
check('на карту уходят все точки (' + (light.items || []).length + ')',
      (light.items || []).length === (light.total || 0),
      'на карте только часть: ' + (light.items || []).length + ' из ' + (light.total || 0));
const lightSize = JSON.stringify(light).length;
check('облегчённый ответ не раздут (' + Math.round(lightSize / 1024) + ' КБ)',
      lightSize < 200 * 1024, 'слишком тяжело для телефона');
check('в облегчённом ответе нет ссылок на снимки',
      (light.items || []).every(x => !x.pic), 'снимки зря утяжеляют карту');
check('область для перехода к жилью приходит (' + (stay.region || '') + ')',
      !!stay.region, 'кнопке «показать все варианты» некуда вести');
const stayFar = await json('/api/places/stay?lat=53.4514&lng=26.4731');
check('область приходит, даже когда рядом пусто (' + (stayFar.region || '') + ')',
      !!stayFar.region, 'в пустом ответе нет области');

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
process.exitCode = failed ? 1 : 0;
