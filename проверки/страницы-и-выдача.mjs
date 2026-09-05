// Проверка того, что видит человек и что видит поисковик.
//
// Ловит:
//   1) главная снова отдаётся пустой — человек с ролика видит форму вместо квартир,
//      а Google индексирует страницу без содержимого;
//   2) в выдаче снова появились дубли — одна квартира с разных источников;
//   3) сломались страницы под поиск (город, город+тип, город+цена).
//
// Сервер должен быть уже запущен.
//   npm start                        а в другом окне:
//   npm run проверка-страниц
//   npm run проверка-страниц https://poisk-kvartir.onrender.com

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;

function check(name, ok, detail) {
  if (ok) { passed++; console.log('  OK   ' + name); }
  else { failed++; console.log('  ПАДАЕТ ' + name + (detail ? ('  — ' + detail) : '')); }
}
const get = async (p) => (await fetch(BASE + p)).text();
const json = async (p) => (await fetch(BASE + p)).json();

// ── 1. главная приходит уже с квартирами ───────────────────────────────────
console.log('\n=== главная отдаётся с готовым списком ===');
const home = await get('/');
const hasPreload = /__PRELOAD\s*=/.test(home);
check('в странице есть готовый список', hasPreload,
      'скрипт снова рисует пустоту, пока идёт запрос');

let preloadCount = 0;
try {
  const m = home.match(/__PRELOAD\s*=\s*(\{[\s\S]*?\});/);
  if (m) preloadCount = (JSON.parse(m[1]).items || []).length;
} catch (e) {}
check('в готовом списке есть варианты (' + preloadCount + ')', preloadCount >= 10,
      'ждали хотя бы 10');

check('цены видно прямо в тексте страницы', /\d+\s*BYN/.test(home) || preloadCount > 0,
      'поисковик увидит страницу без цен');

// ── 2. выдача целая: без повторов и без потерь ─────────────────────────────
console.log('\n=== выдача целая ===');
const all = await json('/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=both');
const items = all.items || [];

const links = new Set(items.map(x => x.link));
check('нет двух карточек с одной ссылкой', links.size === items.length,
      items.length - links.size + ' повторов по ссылке');

// Однажды сюда добавили склейку по «телефон + цена». Оказалось, что так
// схлопываются РАЗНЫЕ квартиры одного хозяина: в Минске 59 таких групп, и
// агентство с двадцатью квартирами по одной цене превращалось в одну карточку.
// Дублей между источниками при этом нет вообще — проверено на шести срезах.
// Эта проверка сторожит, чтобы склейка не вернулась и объявления не пропали.
const owners = new Map();
for (const x of items) {
  const ph = String(x.phone || '').replace(/[^0-9]/g, '');
  if (ph.length < 9) continue;
  const key = ph.slice(-9) + '|' + x.price;
  if (!owners.has(key)) owners.set(key, new Set());
  owners.get(key).add((x.title || '').slice(0, 30));
}
const multi = [...owners.values()].filter(v => v.size > 1).length;
check('разные квартиры одного хозяина не склеены (' + multi + ' групп)', multi > 0,
      'ни одной такой группы — похоже, выдачу снова склеили и объявления пропали');

check('вариантов достаточно (' + items.length + ')', items.length > 300,
      'выдача заметно похудела — не потерялись ли объявления?');

// ── 3. фильтр по гостям обязан фильтровать ─────────────────────────────────
// У Flatbook вместимость не приходит вообще, и раньше при запросе «на 6+ гостей»
// все 92 их объявления проходили насквозь: человек просил дом на компанию,
// а получал варианты, часть которых на двоих.
console.log('\n=== фильтр по гостям ===');
const g6 = await json('/api/search?region=minsk-obl&city=&type=usadba&rooms=&guests=6&max=&source=both');
const bad = (g6.items || []).filter(x => !(+x.capacity >= 6));
check('в выдаче «6+ гостей» нет вариантов без вместимости (' + bad.length + ')', bad.length === 0,
      'прошло ' + bad.length + ' из ' + (g6.items || []).length + ' — фильтр не работает');

// ── 4. усадьбы и коттеджи Flatbook должны иметь название ───────────────────
console.log('\n=== названия усадеб и коттеджей ===');
const fb = await json('/api/search?region=minsk-obl&city=&type=usadba&rooms=&guests=&max=&source=flatbook');
const noName = (fb.items || []).filter(x => !x.title || x.title === 'Минск' || x.title.length < 6);
check('у усадеб есть названия и адреса (' + ((fb.items || []).length - noName.length) + ' из ' + (fb.items || []).length + ')',
      noName.length < (fb.items || []).length * 0.2,
      'без названия: ' + noName.length + ' — разбор берёт не те поля');

// ── 5. страницы под поиск ──────────────────────────────────────────────────
console.log('\n=== страницы под поисковики ===');
const pages = ['/minsk', '/brest', '/minsk-nedorogo', '/brest-usadby', '/minsk-kottedzhi'];
for (const p of pages) {
  const r = await fetch(BASE + p);
  const html = await r.text();
  const cards = (html.match(/class="c"/g) || []).length;
  const title = (html.match(/<title>([^<]*)/) || [])[1] || '';
  check(p + ' отдаётся с карточками (' + cards + ')', r.status === 200 && cards >= 5,
        'код ' + r.status + ', карточек ' + cards);
  check(p + ' имеет свой заголовок', title.length > 15 && !/^Жильё на сутки —/.test(title),
        'заголовок: «' + title.slice(0, 60) + '»');
}

const sitemap = await get('/sitemap.xml');
const locs = (sitemap.match(/<loc>/g) || []).length;
check('карта сайта содержит все страницы (' + locs + ')', locs >= 12,
      'ждали хотя бы 12 адресов');

// ── страницы отдельных мест ───────────────────────────
// Раздел «Что посетить» рисуется скриптом, и для поисковика его нет.
// Ищут же именно «Мирский замок», а не «квартира на сутки Мир». Каждая
// такая страница должна нести своё: снимок, описание, координаты
// и жильё рядом — иначе это пустышка, которая выдаче только навредит.
console.log('\n=== страницы отдельных мест ===');
{
  const r = await fetch(BASE + '/mesto/2416');
  const h = await r.text();
  check('страница места открывается (' + r.status + ')', r.status === 200);
  check('в заголовке окна — название места', /<title>[^<]*Мирский замок/i.test(h),
        (h.match(/<title>[^<]*/) || [''])[0].slice(0, 70));
  check('на странице есть заголовок h1 с названием', /<h1[^>]*>[^<]*Мирский замок/i.test(h));
  check('есть координаты', /53\.45\d+/.test(h) && /26\.47\d+/.test(h));
  check('есть ссылка на маршрут в картах', /yandex\.[a-z]+\/maps[^"']*rtext=/.test(h));
  check('есть снимок места', /<img[^>]+src=["'][^"']*(kudin\.by|фото-точек)/.test(h));
  check('есть жильё рядом с ценой', /\d+\s*BYN/.test(h),
        'без него страница пустая и выдаче только навредит');
  check('указано, откуда описание', /kudin\.by/.test(h));
  check('canonical ведёт на саму себя', /<link rel="canonical" href="[^"]*\/mesto\/2416/.test(h),
        (h.match(/<link rel="canonical"[^>]*>/) || [''])[0]);
  check('есть разметка для поисковика', /TouristAttraction|Place"/.test(h));
}
{
  // человеческий адрес с названием тоже должен работать
  const r = await fetch(BASE + '/mesto/2416-mirski-zamak');
  await r.text();
  check('адрес с названием открывается (' + r.status + ')', r.status === 200);
}
{
  const r = await fetch(BASE + '/mesto/99999999');
  await r.text();
  check('несуществующее место отвечает 404 (' + r.status + ')', r.status === 404,
        'иначе поисковик решит, что таких страниц бесконечно много');
}
{
  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  const мест = (sm.match(/\/mesto\//g) || []).length;
  check('места попали в карту сайта (' + мест + ')', мест > 500,
        'без карты сайта поисковик их не найдёт');
}

// ── страница маршрута ───────────────────────────────
// Ссылка «открыть в Яндекс.Картах» уводит с сайта вслепую: человек не
// видит, что за маршрут получился. Своя страница показывает его на карте
// и даёт доложить точку, прежде чем уходить.
console.log('\n=== страница маршрута ===');
{
  const r = await fetch(BASE + '/marshrut?p=2416,244,285');
  const h = await r.text();
  check('страница маршрута открывается (' + r.status + ')', r.status === 200);
  check('на ней все три точки',
        /Мирский замок/.test(h) && /Несвижский замок/.test(h) && /Лидский замок/.test(h),
        'какая-то из точек потерялась');
  check('есть карта', /leaflet/i.test(h) && /id="rmap"/.test(h));
  check('есть кнопка в Яндекс.Карты с тремя точками',
        ((h.match(/rtext=([^"'&]+)/) || [''])[1] || '').split('~').length === 3,
        (h.match(/rtext=[^"'&]*/) || [''])[0].slice(0, 90));
  check('показан километраж', /\d+\s*км/.test(h));
  check('можно добавить точку', /id="rAdd"/.test(h), 'поля для добавления нет');
  check('есть возврат к списку мест', /\/\?country=places/.test(h));
}
{
  // Порядок объезда должен пересчитываться и на странице: ссылкой можно
  // поделиться, и точки в ней идут как попало. От Мира ближе Несвиж (29 км),
  // чем Лида (118 км) — значит Несвиж должен встать вторым.
  const h = await (await fetch(BASE + '/marshrut?p=2416,285,244')).text();
  const несвиж = h.indexOf('Несвижский замок');
  const лида = h.indexOf('Лидский замок');
  check('порядок объезда пересчитан', несвиж > 0 && лида > 0 && несвиж < лида,
        'точки идут как в адресе, а не по близости');
}
{
  const r = await fetch(BASE + '/marshrut');
  const h = await r.text();
  check('пустой маршрут не ломает страницу (' + r.status + ')', r.status === 200);
  check('пустому маршруту объясняют, что делать', /выберите|добавьте|отметьте/i.test(h),
        'пустая страница без подсказки');
}
{
  const h = await (await fetch(BASE + '/mesto/2416')).text();
  check('на странице места есть заметная кнопка назад',
        /class="back"|id="back"/.test(h),
        'только мелкие хлебные крошки — их не замечают');
}

// ── обновление у тех, кто добавил сайт на экран ────────────
// Без указаний о хранении Safari решает сам, сколько держать копию —
// и человек с ярлыком на домашнем экране может неделю смотреть старую
// версию. Просим спрашивать каждый раз, но по отпечатку, чтобы
// неизменённая страница не качалась заново.
console.log('\n=== страница обновляется у посетителя ===');
{
  const r1 = await fetch(BASE + '/');
  const cc = (r1.headers.get('cache-control') || '').toLowerCase();
  const tag = r1.headers.get('etag') || '';
  await r1.text();
  check('страница просит проверять свежесть (' + (cc || 'заголовка нет') + ')',
        /no-cache|no-store|max-age=0/.test(cc),
        'без этого браузер держит копию сколько сам решит');
  check('у страницы есть отпечаток', !!tag, 'без него проверка свежести качает страницу целиком');
  if (tag) {
    const r2 = await fetch(BASE + '/', { headers: { 'If-None-Match': tag } });
    await r2.text().catch(() => '');
    check('неизменённая страница отвечает 304 (' + r2.status + ')', r2.status === 304,
          'ждали 304 — иначе телефон качает 130 КБ на каждый заход');
  }
  for (const путь of ['/manifest.webmanifest', '/sw.js']) {
    const r = await fetch(BASE + путь);
    await r.text();
    const c = (r.headers.get('cache-control') || '').toLowerCase();
    check(путь + ' просит проверять свежесть', /no-cache|no-store|max-age=0/.test(c),
          c || 'заголовка нет');
  }
}

// ── дорога между точками ────────────────────────────
// Прямая между точками короче настоящей дороги и вводит в заблуждение:
// человек планирует день по числу, которого не бывает.
console.log('\n=== дорога между точками ===');
{
  const d = await (await fetch(BASE + '/api/route?p=53.451232,26.473042;53.222816,26.691436')).json();
  check('дорога считается', d.ok === true, 'маршрутизатор не ответил');
  if (d.ok) {
    // по прямой между Миром и Несвижем 29 км — по дорогам обязано быть больше
    check('по дорогам длиннее, чем по прямой (' + d.km + ' км)', d.km > 30 && d.km < 80,
          'подозрительное расстояние');
    check('время в пути посчитано (' + d.minutes + ' мин)', d.minutes > 5 && d.minutes < 180);
    check('линия проложена по улицам (' + (d.line || []).length + ' точек)',
          (d.line || []).length > 50, 'слишком мало точек — это не дорога, а прямая');
  }
  const пусто = await (await fetch(BASE + '/api/route?p=53.4,26.4')).json();
  check('одной точки для дороги мало', пусто.ok === false);
}
{
  const h = await (await fetch(BASE + '/marshrut?p=2416,244')).text();
  check('со страницы маршрута можно уйти искать жильё', /class="go2"/.test(h),
        'кнопки к списку жилья нет');
}

// ── несуществующие адреса ───────────────────────────
// Любой выдуманный адрес отвечал «200» и главной страницей. Для поисковика
// это значит, что страниц у сайта бесконечно много, и он индексирует мусор.
// Особенно мешает теперь: настоящих страниц мест 798, их надо отличать.
console.log('\n=== несуществующие адреса ===');
for (const путь of ['/kakaya-to-chush', '/minsk-nesushestvuet', '/marshrut/xxx',
                    '/api/nety-takogo', '/mesto/', '/mesto/999999']) {
  const r = await fetch(BASE + путь);
  const h = await r.text().catch(() => '');
  check(путь + ' → 404 (' + r.status + ')', r.status === 404,
        'отвечает «всё в порядке», поисковик проиндексирует мусор');
  if (r.status === 404 && !путь.startsWith('/api/')) {
    // Важно не слово, а что человеку есть куда пойти дальше
    check(путь + ': со страницы есть выход', /href="\/"/.test(h) && h.length > 400,
          'пустая страница без объяснения и ссылок');
  }
}
{
  // настоящие адреса при этом должны остаться живыми
  for (const путь of ['/', '/minsk', '/minsk-nedorogo', '/mesto/2416-mirskij-zamok',
                      '/marshrut?p=2416', '/robots.txt', '/sitemap.xml']) {
    const r = await fetch(BASE + путь);
    await r.text().catch(() => '');
    check('живой адрес не сломан: ' + путь + ' (' + r.status + ')', r.status === 200);
  }
}

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
process.exitCode = failed ? 1 : 0;
