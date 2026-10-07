// Страницы о поездках по Беларуси (план 07.10.2026, по Вордстату, Беларусь, сентябрь 2026):
//   /zamki-belarusi                  — «замки беларуси» 5 930;
//   /kuda-poehat-na-vyhodnye         — «куда съездить / поехать на выходные» 546 + 400;
//   /usadby-belarusi                 — «усадьбы беларуси» 1 480;
//   /marshruty-po-belarusi           — «маршрут по беларуси» 507 (на автомобиле 117 + 114);
//   /chto-posmotret-minskaya-oblast  — «достопримечательности минской области» 286;
//   /podborka/s-detmi                — «куда съездить / поехать с детьми» 427 + 328 (адрес прежний).
//
// Зачем. Это страницы из справочника мест: всё на них должно быть правдой —
// карточки ведут на живые /mesto/*, у каждой фото, военных объектов, кладбищ и
// мемориалов нет (правило сайта), Минск на странице области не считается, цифры
// жилья — те же, что на страницах жилья. Названия — ровно те, что выбраны по Вордстату.
// Страницы — в sitemap, на них ведут хаб «Достопримечательности Беларуси» и подвал главной.
//
// Сервер должен быть запущен и прогрет (каталоги досок собраны).
//   node проверки/poezdki.mjs http://127.0.0.1:9698
const SITE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));
const раскрыть = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const стр = async п => { const r = await fetch(SITE + п, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
  return { код: r.status, кэш: r.headers.get('cache-control') || '', html: await r.text() }; };
const заголовок = h => раскрыть((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
const h1 = h => раскрыть((h.match(/<h1>([^<]*)<\/h1>/) || [])[1] || '');
const описание = h => раскрыть((h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
// карточки мест: <article class="c"> с картинкой и ссылкой на /mesto/<id>-…
const карточки = h => h.split(/<article class="c[^"]*">/).slice(1).map(к => ({
  фото: (к.match(/<img src="([^"]+)"[^>]*alt="([^"]+)"/) || [])[1] || '',
  место: (к.match(/href="(\/mesto\/(\d+)-[a-z0-9-]*)"/) || [])[1] || '',
  id: (к.match(/href="\/mesto\/(\d+)-/) || [])[1] || '',
  имя: раскрыть((к.match(/<h3>(?:<a[^>]*>)?([^<]*)</) || [])[1] || ''),
  км: +((к.match(/<span>(?:до дальней точки )?(\d+) км от Минска<\/span>/) || [])[1] || -1),
  текст: к }));
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
const справочник = (await (await fetch(SITE + '/api/places')).json());
const группы = Object.keys(справочник.groups || {});
const места = new Map();
for (const г of группы) for (const p of (await (await fetch(SITE + '/api/places?group=' + encodeURIComponent(г))).json()).items || []) места.set(String(p.id), p);
check('справочник мест загружен', места.size > 500, String(места.size));
const главная = (await стр('/')).html;
const хаб = (await стр('/dostoprimechatelnosti-belarusi')).html;
const ВОЕННОЕ = /кладбищ|могил|мемориальный комплекс|(^|[^а-яё])мемориал([^а-яё]|$)|братск|воинск|партизан|войн|форт|(^|[^а-яё])дот([^а-яё]|$)|бункер|казарм|тюрем|хранилищ|укрепрайон|бруствер/i;
const военноеМесто = p => !p || p.group === 'Военные' || /кладбищ|мемориальн|памятник/i.test(p.cat || '') || ВОЕННОЕ.test(p.name || '')
  || ['3736', '910103', '8392'].includes(String(p.id));
const км = (a, b) => { const t = Math.PI / 180, x = (b[0] - a[0]) * t, y = (b[1] - a[1]) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(y / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };
const МИНСК = [53.9023, 27.5619];

const ПОЕЗДКИ = [
  ['/zamki-belarusi', 'Замки Беларуси', 'Замки Беларуси на карте: где находятся, фото и описание'],
  ['/kuda-poehat-na-vyhodnye', 'Куда съездить на выходные в Беларуси', 'Куда съездить на выходные в Беларуси: готовые планы'],
  ['/usadby-belarusi', 'Усадьбы Беларуси', 'Усадьбы Беларуси: старинные усадьбы на карте с фото'],
  ['/marshruty-po-belarusi', 'Маршруты по Беларуси на машине', 'Маршруты по Беларуси на машине: готовые и свои'],
  ['/chto-posmotret-minskaya-oblast', 'Достопримечательности Минской области', 'Достопримечательности Минской области: что посмотреть'],
];
const страницы = {};
for (const [п, нужныйH1, нужныйTitle] of ПОЕЗДКИ) {
  console.log('\n=== ' + п + ' ===');
  let { код, html, кэш } = await стр(п);
  // цифры жилья досчитываются в фоне — второй заход их видит
  for (let i = 0; i < 6 && код === 200 && /max-age=120/.test(кэш); i++) { await new Promise(r => setTimeout(r, 10000)); ({ код, html, кэш } = await стр(п)); }
  страницы[п] = html;
  check(п + ' открывается (200)', код === 200, 'код ' + код);
  check(п + ': h1 «' + нужныйH1 + '»', h1(html) === нужныйH1, h1(html));
  check(п + ': title «' + нужныйTitle + '» (≤ 60)', заголовок(html) === нужныйTitle && нужныйTitle.length <= 60, заголовок(html));
  const d = описание(html);
  check(п + ': description 120–160', d.length >= 120 && d.length <= 160, d.length + ' ' + d);
  check(п + ': один h1, canonical на себя, index', (html.match(/<h1[\s>]/g) || []).length === 1
    && html.includes('<link rel="canonical" href="https://nochy.by' + п + '">') && /content="index,follow"/.test(html));
  check(п + ': кэш public', /public, max-age=(600|120)/.test(кэш), кэш);
  check(п + ' в sitemap', карта.includes('<loc>https://nochy.by' + п + '</loc>'));
  check(п + ': ссылка с хаба «Достопримечательности Беларуси»', хаб.includes('href="' + п + '"'));
  check(п + ': ссылка в подвале главной', главная.includes('href="' + п + '"'));
  const остальные = ПОЕЗДКИ.map(x => x[0]).filter(x => x !== п);
  check(п + ': ссылки на остальные страницы поездок и на «с детьми»', остальные.every(x => html.includes('href="' + x + '"')) && html.includes('href="/podborka/s-detmi"'),
    остальные.filter(x => !html.includes('href="' + x + '"')).join(' '));
  const к = карточки(html);
  const сФото = к.filter(x => x.фото);
  check(п + ': не меньше 8 карточек с фото', сФото.length >= 8, 'карточек ' + к.length + ', с фото ' + сФото.length);
  check(п + ': у всех картинок есть alt', !/<img(?![^>]*alt="[^"]+")[^>]*>/.test(html));
  // чужой снимок (Викисклад) — с подписью автора и лицензии
  const безПодписи = к.filter(x => /^https?:\/\/(upload|thumb)\.wikimedia\.org\//.test(x.фото) && !/<p class="cr">Фото: /.test(x.текст));
  check(п + ': снимки Викисклада подписаны', !безПодписи.length, безПодписи.map(x => x.имя).join(', '));
  if (п !== '/marshruty-po-belarusi' && п !== '/kuda-poehat-na-vyhodnye') {
    check(п + ': каждая карточка ведёт на /mesto/ места из справочника', к.every(x => x.id && места.has(x.id)), к.filter(x => !места.has(x.id)).map(x => x.имя).join(', '));
    // км от Минска — по координатам справочника (по прямой, округлено)
    const неТе = к.filter(x => { const p = места.get(x.id); return !p || Math.abs(Math.round(км(МИНСК, [p.lat, p.lng])) - x.км) > 1; });
    check(п + ': «N км от Минска» сходится с координатами места', !неТе.length, неТе.slice(0, 5).map(x => x.имя + ' ' + x.км).join(', '));
    const плохие = к.filter(x => военноеМесто(места.get(x.id)));
    check(п + ': нет военных объектов, мемориалов и кладбищ', !плохие.length, плохие.map(x => x.имя).join(', '));
    check(п + ': без повторов мест', new Set(к.map(x => x.id)).size === к.length);
    // ссылки на места живые: выборка из начала, середины и конца
    const выборка = [...new Set([0, 1, Math.floor(к.length / 2), к.length - 1].map(i => к[i]).filter(Boolean))];
    for (const x of выборка) check('  ' + x.место + ' открывается', (await стр(x.место)).код === 200);
  }
}

console.log('\n=== /zamki-belarusi: что в списке ===');
{
  const к = карточки(страницы['/zamki-belarusi']);
  const ид = к.map(x => x.id);
  check('первые — те, что ищут: Коссовский, Мирский, Несвижский, Лидский', ид.slice(0, 4).join(',') === '301,2416,244,285', ид.slice(0, 4).join(','));
  check('Брестской крепости (мемориал) нет, тюремного замка нет', !ид.includes('3736') && !ид.includes('4733'));
  check('все — замки, крепости-замки или замчища', к.every(x => { const p = места.get(x.id);
    return p && (/^(Замки|замок|Крепости)$/.test(p.cat) || /(замок|замчище)/i.test(p.name)); }), к.map(x => x.имя).join(', '));
  check('кнопка «Замки и крепости на карте» → вкладка мест с фильтром', страницы['/zamki-belarusi'].includes('href="/?country=places&amp;group=' + encodeURIComponent('Укрепления') + '"'));
  const жильё = (страницы['/zamki-belarusi'].split('<h2>Где остановиться рядом с замками</h2>')[1] || '').split('</div>')[0];
  const пути = [...жильё.matchAll(/href="(\/[a-z-]+)"/g)].map(м => м[1]);
  check('жильё рядом с замками — страницы городов (Несвиж, Лида…)', пути.includes('/nesvizh') && пути.includes('/lida'), пути.join(' '));
  for (const а of пути) check('  ' + а + ' открывается', (await стр(а)).код === 200);
}

console.log('\n=== /usadby-belarusi: что в списке ===');
{
  const h = страницы['/usadby-belarusi'];
  const к = карточки(h), ид = к.map(x => x.id);
  check('первые — те, что ищут: Красный Берег, Огинских (Залесье), Жиличи', ид.slice(0, 3).join(',') === '5139,4698,910035', ид.slice(0, 3).join(','));
  check('в начале — про агроусадьбы на сутки со ссылкой на /<обл>-usadby', /Если ищете агроусадьбу на сутки<\/b>[^]*?href="\/minsk-obl-usadby"/.test(h.split('<div class="grid">')[0]));
  for (const а of ['/minsk-obl-usadby', '/grodno-usadby', '/brest-usadby']) check('  ссылка ' + а, h.includes('href="' + а + '"'));
  check('нет замков (они на /zamki-belarusi) и особняков', к.every(x => !/замок|особняк/i.test(x.имя)), к.filter(x => /замок|особняк/i.test(x.имя)).map(x => x.имя).join(', '));
}

console.log('\n=== /chto-posmotret-minskaya-oblast: что в списке ===');
{
  const h = страницы['/chto-posmotret-minskaya-oblast'];
  const к = карточки(h), ид = к.map(x => x.id);
  check('Минска (города) нет: ни одного адреса «г. Минск»', к.every(x => !/(^|[^а-я])(г\.\s*)?Минск(,|$)/.test((места.get(x.id) || {}).addr || '')),
    к.filter(x => /(^|[^а-я])(г\.\s*)?Минск(,|$)/.test((места.get(x.id) || {}).addr || '')).map(x => x.имя).join(', '));
  check('Мирского замка нет (это Гродненская область)', !ид.includes('2416'));
  check('Несвижский замок — в «Главном»', (h.split('<h2>Ещё в Минской области')[0] || '').includes('/mesto/244-'));
  check('ссылка на «Что посмотреть в Минске»', h.includes('href="/chto-posmotret-minsk"'));
  check('с /chto-posmotret-minsk есть ссылка сюда', (await стр('/chto-posmotret-minsk')).html.includes('href="/chto-posmotret-minskaya-oblast"'));
  const далее = (h.split('<h2>Ещё в Минской области — по удалённости от Минска</h2>')[1] || '');
  const кмДалее = карточки(далее).map(x => x.км);
  check('«Ещё» — по удалённости от Минска', кмДалее.length > 5 && кмДалее.every((x, i) => !i || кмДалее[i - 1] <= x), кмДалее.join(','));
}

console.log('\n=== /kuda-poehat-na-vyhodnye: планы ===');
{
  const h = страницы['/kuda-poehat-na-vyhodnye'];
  const к = карточки(h);
  check('не меньше 8 планов с фото', к.filter(x => x.фото).length >= 8, String(к.length));
  check('планы — от ближних к дальним', к.every((x, i) => !i || к[i - 1].км <= x.км), к.map(x => x.км).join(','));
  check('в тексте честно: «на машине» и «недалеко от Минска»', /на машине/.test(h) && /недалеко от Минска/i.test(h));
  const видеть = [...h.matchAll(/<div class="see">(.*?)<\/div>/g)].map(м => [...м[1].matchAll(/href="\/mesto\/(\d+)-/g)].map(x => x[1]));
  check('у каждого плана 1–3 места «что увидеть» из справочника, без военных и кладбищ', видеть.length === к.length
    && видеть.every(в => в.length >= 1 && в.length <= 3 && в.every(id => места.has(id) && !военноеМесто(места.get(id)))), видеть.map(в => в.length).join(','));
  for (const а of ['/m/lida-voronovo', '/m/braslavshchina-2-dnya', '/naroch', '/chto-posmotret-grodno', '/marshrut-minsk-brest'])
    check('  есть ссылка на ' + а, h.includes('href="' + а + '"'));
  // «где ночевать»: число вариантов то же, что на странице жилья (выдача живая — допуск)
  const ночлег = [...h.matchAll(/<a href="(\/[a-z-]+)">[^<]+<\/a> — (\d+) вариант/g)].map(м => ({ путь: м[1], всего: +м[2] }));
  check('у планов есть «где ночевать» с числом вариантов', ночлег.length >= 5, String(ночлег.length));
  for (const н of ночлег.filter(x => ['/lida', '/naroch', '/nesvizh', '/polotsk'].includes(x.путь))) {
    const р = await стр(н.путь);
    const там = +((р.html.match(/Сейчас доступно <b>(\d+)<\/b>/) || [])[1] || -1);
    check('  ' + н.путь + ': ' + н.всего + ' — как на странице (' + там + ')', р.код === 200 && Math.abs(там - н.всего) <= Math.max(3, Math.round(там * 0.05)));
  }
}

console.log('\n=== /marshruty-po-belarusi ===');
{
  const h = страницы['/marshruty-po-belarusi'];
  for (const а of ['/m/lida-voronovo', '/m/braslavshchina-2-dnya', '/marshrut-minsk-brest', '/marshrut-minsk-brest-grodno', '/marshrut-braslavshchina', '/podborka/osen'])
    check('  карточка ' + а, h.includes('<a href="' + а + '"><img'));
  check('объяснение конструктора: Яндекс.Карты, по дорогам, своя точка', /Яндекс\.Картах/.test(h) && /по настоящим дорогам/.test(h) && /своя точка/.test(h));
  check('кнопка «Проложить свой маршрут» → /marshrut (nofollow)', h.includes('<a class="cta" href="/marshrut" rel="nofollow">'));
}

console.log('\n=== /podborka/s-detmi ===');
{
  const { код, html } = await стр('/podborka/s-detmi');
  check('/podborka/s-detmi открывается (адрес прежний)', код === 200, 'код ' + код);
  check('h1 «Куда съездить с детьми в Беларуси»', h1(html) === 'Куда съездить с детьми в Беларуси', h1(html));
  check('title «Куда съездить с детьми в Беларуси: места и маршруты»', заголовок(html) === 'Куда съездить с детьми в Беларуси: места и маршруты', заголовок(html));
  const d = описание(html);
  check('description 120–160', d.length >= 120 && d.length <= 160, d.length + ' ' + d);
  check('в тексте «куда поехать с детьми»', /Куда поехать с детьми/i.test(html.split('<p class="intro">')[1] || ''));
  check('ссылки на страницы поездок', ПОЕЗДКИ.every(x => html.includes('href="' + x[0] + '"')));
}

console.log('\n=== прочее ===');
for (const п of ['/zamki-belarusi-net', '/usadby']) check(п + ' — не наша страница (404)', (await стр(п)).код === 404);

console.log('\nИтог: пройдено ' + passed + ', не прошло ' + failed);
process.exit(failed ? 1 : 0);
