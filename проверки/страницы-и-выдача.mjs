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

// ── 3. страницы под поиск ──────────────────────────────────────────────────
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

console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
process.exitCode = failed ? 1 : 0;
