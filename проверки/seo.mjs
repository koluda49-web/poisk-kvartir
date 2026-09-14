// SEO по всему сайту — без браузера, только то, что видит поисковик в ответе.
//
// Зачем. Страниц на сайте почти девятьсот, собираются они десятком разных
// функций, и каждая отдельная правка легко теряет что-то в заголовке: второй
// <h1>, описание на триста знаков, canonical на чужой адрес, пустой alt,
// одинаковый title у двух костёлов из разных деревень. Глазами такого не
// увидеть, а поиск за это наказывает молча. Проверка обходит адреса из
// sitemap.xml (все города, гиды, маршруты, подборки и 30 мест), главную с
// тремя вкладками и служебные адреса и сверяет их с одними и теми же правилами.
//
// Правила для индексируемой страницы: код 200; lang="ru"; один непустой
// <title> до 60 знаков; meta description 120–160 знаков, законченной фразой
// (в конце точка или «…» после целого слова) и не равный заголовку; ровно один <h1>;
// один canonical — абсолютный, на наш домен, совпадает с адресом из sitemap и
// сам отвечает 200; og:title/description/url/image (og:url = canonical,
// картинка — абсолютный адрес); twitter:card; нет noindex; JSON-LD разбирается
// и нужного типа (места — TouristAttraction, маршруты и подборки — ItemList,
// главная — WebSite и FAQPage); у всех <img> в разметке непустой alt. Внутри
// одного типа страниц title и description не повторяются.
// Служебные (/marshrut?p=, /predlozheniya, /stats, /reis, /istochnik, 404) —
// noindex метатегом или заголовком X-Robots-Tag и не попадают в sitemap.
//
// Сервер должен быть запущен.
//   node проверки/seo.mjs                                  (http://127.0.0.1:8095)
//   node проверки/seo.mjs https://poisk-kvartir.onrender.com
//   SEO_MEST=все node проверки/seo.mjs                     (все места, не 30)

const SITE = (process.argv[2] || 'http://127.0.0.1:8095').replace(/\/$/, '');
const ОСНОВА = 'https://poisk-kvartir.onrender.com';
const КЛЮЧ = process.env.STATS_KEY || 'poisk2026';
// SEO_MEST=все — обойти все места, а не выборку (долго: каждое место тянет описание с kudin.by)
const МЕСТ_В_ВЫБОРКЕ = process.env.SEO_MEST === 'все' ? Infinity : (+process.env.SEO_MEST || 30);

const нарушения = [];
let проверено = 0;
function нарушение(адрес, текст) { нарушения.push(адрес + ' — ' + текст); }
const локально = u => u.startsWith(ОСНОВА) ? SITE + u.slice(ОСНОВА.length) : u;
const безОсновы = u => u.startsWith(ОСНОВА) ? (u.slice(ОСНОВА.length) || '/') : u;

async function взять(путь, попыток = 2) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(SITE + путь, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
      return { код: r.status, заголовки: r.headers, тело: await r.text() };
    } catch (e) {
      if (i + 1 >= попыток) return { код: 0, заголовки: new Headers(), тело: '', ошибка: e.message };
    }
  }
}

// ── разбор разметки ─────────────────────────────────────────────────────
const сущности = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const раскрыть = s => String(s).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (м, к) =>
  к[0] === '#' ? String.fromCodePoint(к[1] === 'x' || к[1] === 'X' ? parseInt(к.slice(2), 16) : parseInt(к.slice(1), 10))
               : (сущности[к.toLowerCase()] ?? м));
function атрибут(тег, имя) {
  const м = тег.match(new RegExp('\\s' + имя + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i'));
  return м ? раскрыть(м[2] ?? м[3]) : null;
}
function разобрать(html) {
  // Скрипты и стили вырезаем: в клиентском коде полно строк с «<img» и «<h1»,
  // поисковик их разметкой не считает.
  const jsonld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(м => м[1]);
  const чистый = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
                     .replace(/<!--[\s\S]*?-->/g, '');
  const голова = (чистый.match(/<head[\s\S]*?<\/head>/i) || [чистый])[0];
  const метаТеги = [...голова.matchAll(/<meta\b[^>]*>/gi)].map(м => м[0]);
  const мета = (ключ, знач) => метаТеги.filter(т => (атрибут(т, ключ) || '').toLowerCase() === знач).map(т => атрибут(т, 'content'));
  return {
    lang: (html.match(/<html[^>]*\slang=["']([^"']+)/i) || [])[1] || '',
    titles: [...голова.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(м => раскрыть(м[1]).trim()),
    описания: мета('name', 'description'),
    robots: мета('name', 'robots').join(',').toLowerCase(),
    ogTitle: мета('property', 'og:title'), ogDesc: мета('property', 'og:description'),
    ogUrl: мета('property', 'og:url'), ogImage: мета('property', 'og:image'),
    twitter: мета('name', 'twitter:card'),
    canonical: [...голова.matchAll(/<link\b[^>]*>/gi)].map(м => м[0])
      .filter(т => (атрибут(т, 'rel') || '').toLowerCase() === 'canonical').map(т => атрибут(т, 'href')),
    h1: [...чистый.matchAll(/<h1[\s>]/gi)].length,
    безAlt: [...чистый.matchAll(/<img\b[^>]*>/gi)].map(м => м[0]).filter(т => !(атрибут(т, 'alt') || '').trim()),
    текст: раскрыть(чистый.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' '),
    jsonld,
  };
}
function типыJSONLD(блоки, адрес) {
  const типы = new Set();
  const обойти = о => {
    if (Array.isArray(о)) return о.forEach(обойти);
    if (!о || typeof о !== 'object') return;
    [].concat(о['@type'] || []).forEach(т => типы.add(т));
    Object.values(о).forEach(обойти);
  };
  for (const б of блоки) {
    let о;
    try { о = JSON.parse(б); } catch (e) { нарушение(адрес, 'JSON-LD не разбирается: ' + e.message); continue; }
    if (!/schema\.org/.test(JSON.stringify(о['@context'] || ''))) нарушение(адрес, 'JSON-LD без @context schema.org');
    обойти(о);
    // ItemList без позиций поисковик не принимает как список
    const списки = [];
    const найти = x => { if (Array.isArray(x)) x.forEach(найти); else if (x && typeof x === 'object') { if (x['@type'] === 'ItemList') списки.push(x); Object.values(x).forEach(найти); } };
    найти(о);
    for (const с of списки) {
      const эл = с.itemListElement || [];
      if (!эл.length) нарушение(адрес, 'ItemList без itemListElement');
      else if (эл.some((e, i) => e.position !== i + 1)) нарушение(адрес, 'ItemList: позиции не 1..N по порядку');
    }
  }
  return типы;
}

// ── правила индексируемой страницы ──────────────────────────────────────
const поТипам = {};   // тип → [{адрес, title, description}]
const картинки = new Set();
const канонические = new Set();
async function индексируемая(путь, тип, ждёмТипы) {
  проверено++;
  const адрес = путь;
  const r = await взять(путь);
  if (r.код !== 200) { нарушение(адрес, 'код ' + r.код + (r.ошибка ? ' (' + r.ошибка + ')' : '')); return; }
  const с = разобрать(r.тело);
  const н = т => нарушение(адрес, т);
  if (с.lang !== 'ru') н('lang="' + с.lang + '" вместо "ru"');
  if (с.titles.length !== 1) н('<title> на странице: ' + с.titles.length);
  const title = с.titles[0] || '';
  if (!title) н('пустой <title>');
  else if (title.length > 60) н('title длиннее 60 (' + title.length + '): ' + title);
  if (с.описания.length !== 1) н('meta description: ' + с.описания.length);
  const d = (с.описания[0] || '').trim();
  if (d && (d.length < 120 || d.length > 160)) н('description ' + d.length + ' знаков (нужно 120–160): ' + d);
  if (d && !/[.!?»)…]$/.test(d)) н('description без точки в конце: …' + d.slice(-40));
  // Обрыв посреди слова: кусок перед «…» есть в тексте страницы, а за ним
  // в тексте идёт буква — значит, слово разрезано.
  for (const м of d.matchAll(/…/g)) {
    const кусок = d.slice(Math.max(0, м.index - 30), м.index);
    const i = кусок.length >= 12 ? с.текст.indexOf(кусок) : -1;
    if (i >= 0 && /[а-яёa-z0-9]/i.test(с.текст.charAt(i + кусок.length))) н('description рвёт слово: «…' + кусок + '…»');
  }
  if (d && d === title) н('description повторяет title');
  if (с.h1 !== 1) н('<h1> на странице: ' + с.h1);
  if (/noindex/.test(с.robots) || /noindex/i.test(r.заголовки.get('x-robots-tag') || '')) н('закрыта noindex');
  if (с.canonical.length !== 1) н('canonical: ' + с.canonical.length);
  const кан = с.canonical[0] || '';
  if (кан && !кан.startsWith(ОСНОВА + '/')) н('canonical не абсолютный на ' + ОСНОВА + ': ' + кан);
  else if (кан && безОсновы(кан) !== путь) н('canonical ведёт на ' + кан);
  if (кан) канонические.add(кан);
  for (const [имя, v] of [['og:title', с.ogTitle], ['og:description', с.ogDesc], ['og:url', с.ogUrl], ['og:image', с.ogImage], ['twitter:card', с.twitter]]) {
    if (v.length !== 1 || !String(v[0] || '').trim()) н(имя + ': ' + (v.length ? 'пусто' : 'нет') + (v.length > 1 ? ' (' + v.length + ' шт.)' : ''));
  }
  if (с.ogUrl[0] && кан && с.ogUrl[0] !== кан) н('og:url (' + с.ogUrl[0] + ') ≠ canonical');
  if (с.ogImage[0]) {
    if (!/^https?:\/\//.test(с.ogImage[0])) н('og:image не абсолютный: ' + с.ogImage[0]);
    else картинки.add(с.ogImage[0]);
  }
  if (с.безAlt.length) н('img без alt (или пустой): ' + с.безAlt.length + ' — ' + с.безAlt[0].slice(0, 120));
  const типы = типыJSONLD(с.jsonld, адрес);
  for (const т of ждёмТипы || []) if (!типы.has(т)) н('нет JSON-LD ' + т + (типы.size ? ' (есть: ' + [...типы].join(', ') + ')' : ''));
  (поТипам[тип] = поТипам[тип] || []).push({ адрес, title, d });
}

async function служебная(путь, что) {
  проверено++;
  const r = await взять(путь);
  const заголовок = r.заголовки.get('x-robots-tag') || '';
  const метатег = /text\/html/.test(r.заголовки.get('content-type') || '') ? разобрать(r.тело).robots : '';
  if (!/noindex/i.test(заголовок) && !/noindex/.test(метатег)) нарушение(путь, что + ': нет noindex (код ' + r.код + ')');
}

// ── sitemap и robots ────────────────────────────────────────────────────
const robots = (await взять('/robots.txt')).тело;
проверено++;
if (!robots.includes('Sitemap: ' + ОСНОВА + '/sitemap.xml')) нарушение('/robots.txt', 'нет ссылки на sitemap');
if (/^Disallow:\s*\/\s*$/m.test(robots)) нарушение('/robots.txt', 'закрыт весь сайт');
for (const нужное of ['/mesto/', '/m/', '/podborka/', '/marshrut-', '/minsk']) {
  const закрыт = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map(м => м[1]).find(п => нужное.startsWith(п) || п.startsWith(нужное));
  if (закрыт) нарушение('/robots.txt', 'Disallow: ' + закрыт + ' закрывает ' + нужное);
}

const sm = await взять('/sitemap.xml');
проверено++;
const локи = [...sm.тело.matchAll(/<loc>([^<]*)<\/loc>/g)].map(м => раскрыть(м[1]));
if (sm.код !== 200 || !локи.length) нарушение('/sitemap.xml', 'пустой или код ' + sm.код);
if (new Set(локи).size !== локи.length) нарушение('/sitemap.xml', 'повторы адресов: ' + (локи.length - new Set(локи).size));
локи.filter(л => !л.startsWith(ОСНОВА + '/')).forEach(л => нарушение('/sitemap.xml', 'чужой адрес ' + л));
const пути = локи.map(безОсновы);
пути.filter(п => /^\/(marshrut(\?|$)|predlozheniya|stats|reis|istochnik|api\/|marshrut-fajl)/.test(п))
    .forEach(п => нарушение('/sitemap.xml', 'служебный адрес ' + п));

function типАдреса(п) {
  if (п === '/' || п.startsWith('/?')) return 'главная';
  if (п.startsWith('/mesto/')) return 'место';
  if (п.startsWith('/podborka/')) return 'подборка';
  if (п === '/m') return 'список маршрутов';
  if (п.startsWith('/m/')) return 'маршрут из видео';
  if (п.startsWith('/marshrut-')) return 'готовый маршрут';
  if (п.startsWith('/gde-ostanovitsya-')) return 'гид';
  return 'город и спрос';
}
const ТИПЫ_JSONLD = {
  'главная': ['WebSite'], 'место': ['TouristAttraction'], 'подборка': ['ItemList'], 'список маршрутов': ['ItemList'],
  'маршрут из видео': ['ItemList'], 'готовый маршрут': ['ItemList'],
};
for (const нужная of ['/', '/?country=ru', '/?country=places']) {
  if (!пути.includes(нужная)) нарушение('/sitemap.xml', 'нет ' + нужная);
}
for (const тип of ['место', 'подборка', 'список маршрутов', 'маршрут из видео', 'готовый маршрут', 'гид', 'город и спрос']) {
  if (!пути.some(п => типАдреса(п) === тип)) нарушение('/sitemap.xml', 'нет ни одной страницы типа «' + тип + '»');
}

// Выборка мест — равномерно по всему списку, чтобы попали и старые, и
// добавленные по предложениям (они в конце).
const места = пути.filter(п => типАдреса(п) === 'место');
const выборка = места.length <= МЕСТ_В_ВЫБОРКЕ ? места
  : Array.from({ length: МЕСТ_В_ВЫБОРКЕ }, (_, i) => места[Math.floor(i * (места.length - 1) / (МЕСТ_В_ВЫБОРКЕ - 1))]);
// Одноимённые места («Костёл», «Церковь») — самые вероятные дубли заголовков:
// добавляем в выборку все места с повторяющимся хвостом адреса.
const поИмени = new Map();
for (const п of места) { const имя = п.replace(/^\/mesto\/\d+-?/, ''); поИмени.set(имя, (поИмени.get(имя) || []).concat(п)); }
const тёзки = [...поИмени.values()].filter(г => г.length > 1).flat().slice(0, 40);
const обход = [...new Set(пути.filter(п => типАдреса(п) !== 'место').concat(выборка, тёзки))];

console.log('sitemap: ' + локи.length + ' адресов, мест ' + места.length + '; обходим ' + обход.length
  + ' (мест ' + обход.filter(п => типАдреса(п) === 'место').length + ', из них тёзок ' + тёзки.length + ')');
if (!пути.includes('/?country=places')) обход.push('/?country=ru', '/?country=places');

// По 4 запроса разом: сервер один, а городские страницы тянут выдачу.
for (let i = 0; i < обход.length; i += 4) {
  await Promise.all(обход.slice(i, i + 4).map(п => { const т = типАдреса(п); return индексируемая(п, т, ТИПЫ_JSONLD[т]); }));
}
if (!канонические.size) нарушение('обход', 'ни одного canonical');
// Главная — ещё FAQ
{
  const с = разобрать((await взять('/')).тело);
  if (!типыJSONLD(с.jsonld, '/').has('FAQPage')) нарушение('/', 'нет JSON-LD FAQPage');
}

// Дубли внутри типа
for (const [тип, список] of Object.entries(поТипам)) {
  for (const поле of ['title', 'd']) {
    const счёт = new Map();
    for (const x of список) if (x[поле]) счёт.set(x[поле], (счёт.get(x[поле]) || []).concat(x.адрес));
    for (const [знач, адреса] of счёт) if (адреса.length > 1)
      нарушение(адреса.join(', '), 'одинаковый ' + (поле === 'd' ? 'description' : 'title') + ' у страниц «' + тип + '»: ' + знач.slice(0, 90));
  }
}

// Картинки для соцсетей: наши должны открываться, чужие не проверяем —
// до kudin.by из проверки не всегда есть связь.
for (const к of картинки) {
  if (!к.startsWith(ОСНОВА)) continue;
  const r = await fetch(локально(к), { method: 'GET', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r || r.status !== 200) нарушение(к, 'og:image не открывается (' + (r ? r.status : 'нет связи') + ')');
}

// Битые canonical: адрес должен отвечать 200 сам по себе
for (const к of канонические) {
  const п = безОсновы(к);
  if (обход.includes(п)) continue;   // уже открыт выше
  const r = await взять(п);
  if (r.код !== 200) нарушение(к, 'canonical отвечает ' + r.код);
}

// ── служебные ───────────────────────────────────────────────────────────
const первые = места.slice(0, 3).map(п => п.match(/^\/mesto\/(\d+)/)[1]).join(',');
await служебная('/marshrut?p=' + первые, 'самодельный маршрут');
await служебная('/marshrut', 'пустой маршрут');
await служебная('/predlozheniya?key=' + КЛЮЧ, 'предложения');
await служебная('/predlozheniya', 'предложения без ключа');
await служебная('/stats?key=' + КЛЮЧ, 'статистика');
await служебная('/stats', 'статистика без ключа');
await служебная('/reis?key=' + КЛЮЧ, 'рейс');
await служебная('/reis', 'рейс без ключа');
await служебная('/istochnik?key=' + КЛЮЧ, 'источники');
await служебная('/istochnik', 'источники без ключа');
await служебная('/net-takoy-stranicy', 'страница 404');
await служебная('/mesto/999999999-net', '404 места');
await служебная('/m/net-takogo', '404 маршрута');
await служебная('/podborka/net-takoy', '404 подборки');

// ── итог ─────────────────────────────────────────────────────────────────
const поТипуСчёт = Object.entries(поТипам).map(([т, с]) => т + ' ' + с.length).join(', ');
console.log('Страниц по типам: ' + поТипуСчёт);
if (нарушения.length) {
  console.log('\nНарушения (' + нарушения.length + '):');
  нарушения.forEach(н => console.log('  ПАДАЕТ ' + н));
} else console.log('\nНарушений нет.');
// Счёт — по адресам: «падает» — сколько страниц с нарушениями, «пройдено» — остальные
const падает = new Set(нарушения.map(н => н.split(' — ')[0])).size;
console.log('\nПройдено ' + Math.max(0, проверено - падает) + ', падает ' + падает);
process.exit(нарушения.length ? 1 : 0);
