// Проверка поиска и кэша.
//
// Ловит две разные поломки:
//   1) фильтр перестал браться из памяти и снова ходит к Kufar/Realt/Flatbook
//      (определяем по времени ответа);
//   2) фильтр стал возвращать не то — сверяем с ручной фильтрацией базового списка.
//
// Сервер должен быть уже запущен.
//   npm start                     а в другом окне:
//   npm test                      (проверит http://127.0.0.1:8080)
//   npm test https://poisk-kvartir.onrender.com     (проверит живой сайт)

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;

const get = async (params) => {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/search?' + new URLSearchParams(params).toString());
  const data = await r.json();
  return { ms: Date.now() - t0, data };
};
const links = (d) => (d.items || []).map(x => x.link).sort();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK   ' + name); }
  else { failed++; console.log('  ПАДАЕТ ' + name + (detail ? ('  — ' + detail) : '')); }
}

const base = (src, extra = {}) => ({
  region: 'minsk', city: '', type: 'flat', rooms: '', guests: '', max: '', source: src, ...extra,
});

// Порог «взято из памяти» нельзя задать числом: до локального сервера 5 мс,
// а до Render только сеть съедает 250 мс. Поэтому сначала меряем эталон —
// повторный запрос того же адреса, который заведомо лежит в памяти.
let FAST_MS = 60;
async function calibrate() {
  const probe = base('kufar');
  await get(probe);
  const runs = [];
  for (let i = 0; i < 3; i++) runs.push((await get(probe)).ms);
  const floor = Math.min(...runs);
  FAST_MS = Math.max(60, floor * 2 + 150);
  console.log('Проверяем: ' + BASE);
  console.log('Задержка до сервера: ' + floor + ' мс → порог «из памяти»: ' + FAST_MS + ' мс');
}

await calibrate();

for (const src of ['kufar', 'realt', 'flatbook']) {
  console.log('\n=== ' + src + ' ===');

  const warm = await get(base(src));
  console.log('  базовый список: ' + (warm.data.total ?? 0) + ' шт., ' + warm.ms + ' мс');
  if (!warm.data.items || !warm.data.items.length) { console.log('  пропускаю: источник ничего не вернул'); continue; }

  const prices = warm.data.items.map(x => x.price).sort((a, b) => a - b);
  const cut = prices[Math.floor(prices.length / 2)];

  // ── «цена до»: у всех трёх источников это фильтр ПОСЛЕ получения списка
  const byMax = await get(base(src, { max: String(cut) }));
  check(src + ': «цена до» берётся из памяти (' + byMax.ms + ' мс)', byMax.ms < FAST_MS,
        'ждали меньше ' + FAST_MS + ' мс');
  check(src + ': результат по «цене до» совпадает с ручной фильтрацией',
        same(links(byMax.data), warm.data.items.filter(x => x.price <= cut).map(x => x.link).sort()),
        'получено ' + (byMax.data.total ?? 0) + ', ожидалось ' + warm.data.items.filter(x => x.price <= cut).length);

  // ── «цена от»
  const byMin = await get(base(src, { min: String(cut) }));
  check(src + ': «цена от» берётся из памяти (' + byMin.ms + ' мс)', byMin.ms < FAST_MS,
        'ждали меньше ' + FAST_MS + ' мс');
  check(src + ': результат по «цене от» совпадает с ручной фильтрацией',
        same(links(byMin.data), warm.data.items.filter(x => x.price >= cut).map(x => x.link).sort()),
        'получено ' + (byMin.data.total ?? 0) + ', ожидалось ' + warm.data.items.filter(x => x.price >= cut).length);

  // ── комнаты. У Flatbook они уходят в запрос к источнику, поэтому его пропускаем.
  // Берём 1 комнату, а не 2: двухкомнатные могли бы оказаться в прогреве,
  // и проверка прошла бы не из-за кэша.
  if (src !== 'flatbook') {
    const withRooms = warm.data.items.filter(x => x.rooms == 1);
    const byRooms = await get(base(src, { rooms: '1' }));
    check(src + ': смена числа комнат берётся из памяти (' + byRooms.ms + ' мс)', byRooms.ms < FAST_MS,
          'ждали меньше ' + FAST_MS + ' мс');
    check(src + ': результат по комнатам совпадает с ручной фильтрацией',
          same(links(byRooms.data), withRooms.map(x => x.link).sort()),
          'получено ' + (byRooms.data.total ?? 0) + ', ожидалось ' + withRooms.length);
  }
}

// ── смена области обязана по-прежнему ходить за данными,
//    иначе кэш склеил бы разные города в один список
console.log('\n=== другая область — данные должны быть свои ===');
const brest = await get(base('kufar', { region: 'brest' }));
const minsk = await get(base('kufar'));
check('Брест и Минск дают разные списки',
      !same(links(brest.data), links(minsk.data)),
      'списки совпали — значит кэш перепутал области');

// ── Flatbook: ссылки и галереи ────────────────────────────
// В карточке Flatbook приходит один снимок, остальные страница дотягивает
// через /api/gallery. Если разбор перестал их находить, слайдер молча
// исчезает — на глаз это заметно только если знать, что он был.
console.log('\n=== Flatbook: ссылки и галереи ===');
const fb = (await get(base('flatbook'))).data.items || [];
check('Flatbook вообще отвечает (' + fb.length + ')', fb.length > 50);

// Часть объявлений приходит со ссылкой на тестовый сайт flatbook.
// Человека туда отправлять нельзя, да и снимки оттуда не подхватываются.
const testDomain = fb.filter(x => /(^|\/\/)test\./.test(x.link || ''));
check('нет ссылок на тестовый сайт', testDomain.length === 0,
      'ведут на тестовый домен: ' + testDomain.length + ', например ' + ((testDomain[0] || {}).link || ''));

const sample = fb.slice(0, 12).map(x => ({ src: 'Flatbook', key: x.link }));
const gal = await (await fetch(BASE + '/api/gallery', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reqs: sample }) })).json();
const counts = sample.map(r => ((gal.results || {})[r.key] || []).length);
const empty = counts.filter(n => n < 2).length;
check('у объявлений находится галерея (' + (sample.length - empty) + ' из ' + sample.length + ')',
      empty === 0,
      'без галереи: ' + empty + ' — слайдер у них не появится');

// ── все области живы ────────────────────────────────
// Источник может молча выпасть по одной области — например, если название
// области у него написано иначе, чем у нас («Могилевская» без «ё»).
// На глаз это незаметно: остальные шесть областей работают.
console.log('\n=== каждая область отвечает ===');
const ОБЛАСТИ = ['minsk', 'minsk-obl', 'brest', 'gomel', 'grodno', 'vitebsk', 'mogilev'];
for (const src of ['kufar', 'realt', 'flatbook']) {
  const пусто = [];
  for (const reg of ОБЛАСТИ) {
    const d = await get(base(src, { region: reg }));
    if (!(d.data.total > 0)) пусто.push(reg);
  }
  check(src + ': отвечает по всем семи областям', пусто.length === 0,
        'пусто по: ' + пусто.join(', '));
}

// ── отели России ──────────────────────────────────
// 101hotels отвечает две с лишним секунды. Столько же ждал каждый, кто
// первым переключался на вкладку России, — поэтому её греем при запуске.
console.log('\n=== отели России ===');
{
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/rf/search?city=moskva&sort=price_asc');
  const d = await r.json();
  const мс = Date.now() - t0;
  check('отели находятся (' + (d.total || 0) + ')', (d.total || 0) > 0,
        'вкладка России пустая');
  check('город по умолчанию прогрет (' + мс + ' мс)', мс < FAST_MS,
        'ждали меньше ' + FAST_MS + ' мс — значит прогрев не работает и первый '
        + 'зашедший ждёт две секунды');
}

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
// Выходим через exitCode, а не process.exit: резкий выход не даёт node закрыть
// сетевое соединение и на Windows роняет его с ошибкой libuv.
process.exitCode = failed ? 1 : 0;
