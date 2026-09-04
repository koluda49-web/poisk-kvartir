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
