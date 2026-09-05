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

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
process.exitCode = failed ? 1 : 0;
