// Хабы под частые запросы (04.10, по Вордстату, Беларусь, сентябрь 2026):
//   /doma-na-sutki       — «дом на сутки» 4 685, «снять дом на сутки» 3 024, «дом посуточно» 925;
//   /goroda              — «квартиры посуточно» 16 832 и города (Барановичи 1 066, Лида 989…);
//   /kvartiry-nedorogo   — «недорогие квартиры на сутки» 2 909;
//   /dostoprimechatelnosti-belarusi — «достопримечательности беларуси» 4 613,
//                          «что посмотреть в беларуси» 915, «куда поехать в беларуси» 580.
//
// Зачем. Это оглавления: их цифры (сколько вариантов, цена «от», сколько мест)
// должны совпадать с тем, что на страницах, куда они ведут, — ничего не выдумано.
// Названия — ровно те, что выбраны по Вордстату. Вкладка /?country=places — как была.
//
// Сервер должен быть запущен и прогрет (каталоги досок собраны).
//   node проверки/хабы.mjs http://127.0.0.1:9682
const SITE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));
const раскрыть = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const стр = async п => { const r = await fetch(SITE + п, { redirect: 'manual', signal: AbortSignal.timeout(120000) });
  return { код: r.status, куда: r.headers.get('location') || '', кэш: r.headers.get('cache-control') || '', html: await r.text() }; };
const заголовок = h => раскрыть((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
const h1 = h => раскрыть((h.match(/<h1>([^<]*)<\/h1>/) || [])[1] || '');
const описание = h => раскрыть((h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
const самыйДешёвый = h => +((h.match(/самый дешёвый — <b>(\d+(?:\.\d+)?) BYN/) || [])[1] || 0);
const доступно = h => +((h.match(/Сейчас доступно <b>(\d+)<\/b>/) || [])[1] || -1);
const карточки = h => h.split('<article class="c">').slice(1).map(к => ({
  h3: раскрыть((к.match(/<h3>([^<]*)<\/h3>/) || [])[1] || ''), цена: +((к.match(/<div class="p">(?:от )?(\d+(?:\.\d+)?) BYN/) || [])[1] || 0) }));
const строкиТаблицы = (h, после = '') => [...(после ? (h.split(после)[1] || '').split('</table>')[0] : h)
  .matchAll(/<tr><td><a href="([^"]+)">([^<]+)<\/a><\/td><td>(?:<b>(\d+)<\/b>|…)<\/td><td>(?:(\d+(?:\.\d+)?) BYN|—)<\/td><\/tr>/g)]
  .map(м => ({ путь: м[1], имя: раскрыть(м[2]), всего: м[3] === undefined ? null : +м[3], от: м[4] ? +м[4] : 0 }));
const блок = (h, заг) => (h.split('<h2>' + заг + '</h2>')[1] || '').split('</div>')[0];
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
const рядом = (а, б, допуск) => Math.abs(а - б) <= Math.max(допуск, Math.round(б * 0.05));
const сеоОбщее = (п, html) => {
  const t = заголовок(html), d = описание(html);
  check(п + ': title ≤ 60', t.length > 0 && t.length <= 60, t.length + ' ' + t);
  check(п + ': description 120–160', d.length >= 120 && d.length <= 160, d.length + ' ' + d);
  check(п + ': один h1, canonical на себя, index', (html.match(/<h1[\s>]/g) || []).length === 1
    && html.includes('<link rel="canonical" href="https://nochy.by' + п + '">') && /content="index,follow"/.test(html));
  check(п + ' в карте сайта', карта.includes(п + '</loc>'));
};

console.log('\n=== /doma-na-sutki ===');
{
  const п = '/doma-na-sutki';
  const { код, html, кэш } = await стр(п);
  check(п + ' открывается', код === 200, 'код ' + код);
  check(п + ': h1 «Дома на сутки в Беларуси»', h1(html) === 'Дома на сутки в Беларуси', h1(html));
  check(п + ': title «Дома на сутки в Беларуси — снять дом посуточно»', заголовок(html) === 'Дома на сутки в Беларуси — снять дом посуточно', заголовок(html));
  сеоОбщее(п, html);
  check(п + ': отдаётся с кэшем, как соседние страницы спроса', /max-age=(600|120)/.test(кэш), кэш);
  const к = карточки(html);
  check(п + ': не меньше пяти вариантов', к.length >= 5, 'карточек ' + к.length);
  check(п + ': среди вариантов нет квартир', к.every(x => !/квартир|студи|апартамент|комнат/i.test(x.h3)), (к.find(x => /квартир|студи|апартамент|комнат/i.test(x.h3)) || {}).h3);
  const всего = доступно(html);
  const области = строкиТаблицы(html, '<h2>По областям</h2>');
  check(п + ': таблица по областям (от 5 областей)', области.length >= 5, области.map(x => x.имя).join(', '));
  // строки пересекаются (Минск и Минская область), поэтому сумма — не меньше общего числа
  check(п + ': в сумме по областям не меньше, чем «Сейчас доступно», и каждая — не больше', области.reduce((s, x) => s + x.всего, 0) >= всего
    && области.every(x => x.всего <= всего), области.reduce((s, x) => s + x.всего, 0) + ' и ' + всего);
  const мин = самыйДешёвый(html);
  check(п + ': самое низкое «от» по областям = «самый дешёвый» на странице (' + мин + ')', мин > 0 && Math.min(...области.map(x => x.от).filter(Boolean)) === мин,
    области.map(x => x.от).join(', '));
  const адреса = области.map(x => x.путь);
  check(п + ': области ведут на /<область>-kottedzhi (Минск — на «под Минском»)',
    адреса.every(а => /^\/(brest|gomel|grodno|vitebsk|mogilev|minsk-obl)-kottedzhi$/.test(а) || а === '/doma-na-sutki-pod-minskom'), адреса.join(', '));
  for (const а of адреса) check('  ' + а + ' открывается', (await стр(а)).код === 200);
  const ссылки = блок(html, 'Ещё подборки домов');
  for (const а of ['/dom-s-banej', '/doma-s-bassejnom', '/doma-na-sutki-pod-minskom', '/doma-na-novyj-god'])
    check(п + ': есть ссылка на ' + а, ссылки.includes('href="' + а + '"'));
}

console.log('\n=== /kvartiry-nedorogo ===');
{
  const п = '/kvartiry-nedorogo';
  const { код, html } = await стр(п);
  check(п + ' открывается', код === 200, 'код ' + код);
  check(п + ': h1 «Недорогие квартиры на сутки в Беларуси»', h1(html) === 'Недорогие квартиры на сутки в Беларуси', h1(html));
  check(п + ': title «Недорогие квартиры на сутки в Беларуси — по городам»', заголовок(html) === 'Недорогие квартиры на сутки в Беларуси — по городам', заголовок(html));
  сеоОбщее(п, html);
  const к = карточки(html);
  check(п + ': не меньше пяти вариантов', к.length >= 5, 'карточек ' + к.length);
  check(п + ': все не дороже 70 BYN (порог как у /minsk-nedorogo)', к.every(x => x.цена > 0 && x.цена <= 70), к.filter(x => x.цена > 70).map(x => x.цена).join(', '));
  check(п + ': дешёвые сверху', к.every((x, i) => !i || к[i - 1].цена <= x.цена));
  const всего = доступно(html);
  const города = строкиТаблицы(html, '<h2>По городам</h2>');
  check(п + ': таблица по городам', города.length >= 5, города.map(x => x.имя).join(', '));
  check(п + ': в сумме по городам не меньше, чем «Сейчас доступно», и каждый — не больше', города.reduce((s, x) => s + x.всего, 0) >= всего
    && города.every(x => x.всего <= всего), города.reduce((s, x) => s + x.всего, 0) + ' и ' + всего);
  const мин = самыйДешёвый(html);
  check(п + ': самое низкое «от» по городам = «самый дешёвый» на странице (' + мин + ')', мин > 0 && Math.min(...города.map(x => x.от).filter(Boolean)) === мин,
    города.map(x => x.от).join(', '));
  // те же цифры, что на /<город>-nedorogo (выдача живая — допуск на то, что обновилось между запросами)
  for (const г of города) {
    const с = await стр(г.путь);
    let н = доступно(с.html), было = г.всего;
    // выдача живая: разошлось — смотрим хаб ещё раз (его отбор кэшируется на 5 минут)
    if (!рядом(было, н, 3)) { const ещё = строкиТаблицы((await стр(п)).html, '<h2>По городам</h2>').find(x => x.путь === г.путь); if (ещё) было = ещё.всего; н = доступно((await стр(г.путь)).html); }
    check('  ' + г.имя + ': ' + было + ' — как на ' + г.путь + ' (' + н + ')', /-nedorogo$/.test(г.путь) && с.код === 200 && рядом(было, н, 3), г.путь + ' ' + н);
  }
}

console.log('\n=== /goroda ===');
{
  const п = '/goroda';
  let { код, html, кэш } = await стр(п);
  // цифры, которых ещё нет, досчитываются в фоне — второй заход их видит
  for (let i = 0; i < 12 && код === 200 && html.includes('<td>…</td>'); i++) { await new Promise(r => setTimeout(r, 10000)); ({ код, html, кэш } = await стр(п)); }
  check(п + ' открывается', код === 200, 'код ' + код);
  check(п + ': h1 «Квартиры на сутки по городам Беларуси»', h1(html) === 'Квартиры на сутки по городам Беларуси', h1(html));
  check(п + ': title «Квартиры на сутки по городам Беларуси — посуточно»', заголовок(html) === 'Квартиры на сутки по городам Беларуси — посуточно', заголовок(html));
  сеоОбщее(п, html);
  check(п + ': все цифры собраны (нет «…»), кэш как у соседних', !html.includes('<td>…</td>') && /max-age=600/.test(кэш), кэш);
  const строки = строкиТаблицы(html);
  const пути = строки.map(x => x.путь);
  for (const а of ['/minsk', '/brest', '/gomel', '/grodno', '/vitebsk', '/mogilev', '/minsk-obl'])
    check(п + ': есть ' + а, пути.includes(а));
  check(п + ': районные города (Барановичи, Лида, Бобруйск…)', ['/baranovichi', '/lida', '/bobruisk', '/kobrin', '/pinsk'].filter(а => пути.includes(а)).length >= 4, пути.join(' '));
  check(п + ': курорты (Нарочь, Браслав…)', ['/naroch', '/braslav', '/minskoe-more'].some(а => пути.includes(а)), пути.join(' '));
  check(п + ': JSON-LD ItemList по числу строк', html.includes('"@type":"ItemList"') && html.includes('"numberOfItems":' + строки.length));
  // те же цифры, что на страницах (выдача живая — небольшой допуск)
  const выборка = ['/minsk', '/grodno', '/baranovichi', '/lida', '/naroch', '/minsk-obl'].map(а => строки.find(x => x.путь === а)).filter(Boolean);
  for (const с of выборка) {
    const r = await стр(с.путь);
    const н = доступно(r.html);
    // страница только что пересобрана и оставила свои цифры — хаб должен показать их же
    if (!рядом(с.всего, н, 3)) { const ещё = строкиТаблицы((await стр(п)).html).find(x => x.путь === с.путь); if (ещё) { с.всего = ещё.всего; с.от = ещё.от; } }
    check('  ' + с.имя + ': ' + с.всего + ' — как на странице (' + н + ')', r.код === 200 && с.всего !== null && рядом(с.всего, н, 3), 'код ' + r.код);
    const мин = +((r.html.match(/самый дешёвый — <b>(\d+(?:\.\d+)?) BYN/) || [])[1] || 0);
    check('  ' + с.имя + ': «от» ' + с.от + ' — как на странице (' + мин + ')', !мин || Math.abs(с.от - мин) <= 10, '');
  }
  for (const а of ['/doma-na-sutki', '/kvartiry-nedorogo', '/dostoprimechatelnosti-belarusi'])
    check(п + ': ссылка на ' + а, html.includes('href="' + а + '"'));
}

console.log('\n=== /dostoprimechatelnosti-belarusi ===');
{
  const п = '/dostoprimechatelnosti-belarusi';
  let { код, html } = await стр(п);
  for (let i = 0; i < 12 && код === 200 && /<a href="\/chto-posmotret-[a-z]+">Что посмотреть [^<]+<\/a>/.test(html); i++) {
    await new Promise(r => setTimeout(r, 10000)); ({ код, html } = await стр(п));
  }
  check(п + ' открывается', код === 200, 'код ' + код);
  check(п + ': h1 «Достопримечательности Беларуси»', h1(html) === 'Достопримечательности Беларуси', h1(html));
  const всего = (await (await fetch(SITE + '/api/places')).json()).total;
  const t = заголовок(html), м = t.match(/^Достопримечательности Беларуси: что посмотреть, (\d+)\+ мест$/);
  check(п + ': title «Достопримечательности Беларуси: что посмотреть, N00+ мест» — N по справочнику (' + всего + ')',
    !!м && +м[1] % 100 === 0 && +м[1] <= всего && всего - +м[1] < 100, t);
  сеоОбщее(п, html);
  check(п + ': кнопка «Все места на карте» → /?country=places', html.includes('<a class="cta" href="/?country=places">Все места на карте →</a>'));
  // «что посмотреть» по городам — с тем же числом мест, что на страницах
  const города = [...html.matchAll(/<a href="\/(chto-posmotret-[a-z]+)">Что посмотреть [^<]+ <small>(\d+) мест[аоы]?<\/small><\/a>/g)].map(м => ({ slug: м[1], n: +м[2] }));
  check(п + ': все семь «что посмотреть» с числом мест', города.length === 7, города.map(x => x.slug).join(', '));
  for (const г of города) {
    const r = await стр('/' + г.slug);
    const n = [...r.html.matchAll(/<h3><a href="\/mesto\//g)].length;
    check('  /' + г.slug + ': ' + г.n + ' мест — как на странице (' + n + ')', r.код === 200 && n === г.n);
  }
  const подборки = (await (await fetch(SITE + '/sitemap.xml')).text()).match(/\/podborka\/[a-z0-9-]+(?=<\/loc>)/g) || [];
  check(п + ': ссылки на все подборки (' + подборки.length + ')', подборки.length > 0 && подборки.every(а => html.includes('href="' + а + '"')));
  check(п + ': ссылка на все маршруты /m и на маршрут из видео', html.includes('href="/m"') && /href="\/m\/[a-z0-9-]+"/.test(html));
  for (const г of ['Замки и крепости', 'Дворцы и усадьбы', 'Костёлы, церкви, часовни и синагоги'])
    check(п + ': группа «' + г + '» со ссылками на места и на карту', (html.split('<h2>' + г + '</h2>')[1] || '').split('<h2>')[0].match(/href="\/mesto\/\d+-/g)?.length >= 3
      && /href="\/\?country=places&amp;group=[^"]+">Все на карте/.test((html.split('<h2>' + г + '</h2>')[1] || '').split('<h2>')[0]));
  check(п + ': без военных мест и мемориалов (доты, форты, мемориальные комплексы)', !/<span class="pcat">(Доты|Форты|Мемориальные комплексы|Объекты «Холодной войны»)<\/span>/.test(html));
}

console.log('\n=== мало вариантов — хаб не 404 (на него ведёт главная) ===');
{
  const предел = async (s, n) => { try { const r = await fetch(SITE + '/api/_empty-test?slug=' + s + '&limit=' + n, { method: 'POST' }); return r.ok && !!(await r.json()).pid; } catch { return false; } };
  if (!(await предел('kvartiry-nedorogo', 2))) console.log('  (сервер без DATA_TEST=1 — пункт пропущен)');
  else {
    try {
      const { код, html } = await стр('/kvartiry-nedorogo');
      check('/kvartiry-nedorogo с двумя вариантами — 200 и честное «всего 2 варианта»', код === 200 && /подходит всего 2 варианта/.test(html), 'код ' + код);
    } finally { await предел('kvartiry-nedorogo', -1); }
    const { код, html } = await стр('/kvartiry-nedorogo');
    check('предел снят — снова полный список', код === 200 && !/подходит всего/.test(html));
  }
}

console.log('\n=== /?country=places — вкладка приложения, как была ===');
{
  const { код, куда, html } = await стр('/?country=places');
  check('/?country=places: 200 без перенаправления', код === 200 && !куда, код + ' ' + куда);
  check('/?country=places: свой title вкладки', заголовок(html) === 'Что посмотреть в Беларуси: замки, усадьбы и доты на карте', заголовок(html));
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
