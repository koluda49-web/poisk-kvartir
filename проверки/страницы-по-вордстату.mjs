// Страницы под реальные запросы (Вордстат, Беларусь, 26.08–24.09.2026).
//
// Зачем. Названия страниц подобраны под то, как ищут: «агроусадьба» — 16 тыс.
// в месяц против 262 у «усадьба на сутки», «дом на сутки» — 4,7 тыс. против
// 1,4 тыс. у «коттедж», «посуточно» — 23 тыс., «без посредников» — 1,4 тыс.,
// «однокомнатные» — 2,2 тыс., «новогодний корпоратив» — 1,8 тыс. И на
// страницах усадеб и коттеджей должны быть дома, а не квартиры: разделы
// площадок отдают туда и квартиры (на /minsk-usadby были районы Минска).
//
// Сервер должен быть запущен.
//   node проверки/страницы-по-вордстату.mjs
//   node проверки/страницы-по-вордстату.mjs https://poisk-kvartir.onrender.com
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const стр = async п => { const r = await fetch(SITE + п, { redirect: 'manual' }); return { код: r.status, куда: r.headers.get('location') || '', html: r.status === 200 ? await r.text() : '' }; };
const заголовок = h => ((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
const h1 = h => ((h.match(/<h1>([^<]*)<\/h1>/) || [])[1] || '');
const карточки = h => h.split('<article class="c">').slice(1).map(к => ({
  h3: (к.match(/<h3>([^<]*)<\/h3>/) || [])[1] || '', мета: [...к.matchAll(/<span>([^<]*)<\/span>/g)].map(м => м[1]) }));

// города — «снять посуточно» в заголовке
// (и «что посмотреть рядом», где влезает: «что посмотреть в Минске» — 5,2 тыс.)
for (const [п, город] of [['/minsk', 'в Минске'], ['/grodno', 'в Гродно'], ['/vitebsk', 'в Витебске']]) {
  const { код, html } = await стр(п);
  check(п + ': заголовок «Квартиры на сутки ' + город + '» и «посуточно»', код === 200 && заголовок(html).startsWith('Квартиры на сутки ' + город) && /посуточно/.test(заголовок(html)), заголовок(html));
}

// агроусадьбы и дома по областям — только дома, название по области
for (const [п, что, где] of [['/brest-usadby', 'Агроусадьбы на сутки', 'в Брестской области'],
                              ['/grodno-kottedzhi', 'Дома и коттеджи на сутки', 'в Гродненской области'],
                              ['/minsk-obl-usadby', 'Агроусадьбы на сутки', 'в Минской области']]) {
  const { код, html } = await стр(п);
  check(п + ' открывается', код === 200, 'код ' + код);
  if (код !== 200) continue;
  check(п + ': h1 «' + что + ' ' + где + '»', h1(html) === что + ' ' + где, h1(html));
  const к = карточки(html);
  check(п + ': среди вариантов нет квартир', к.every(x => !/квартир|студи|апартамент|комнат/i.test(x.h3)), (к.find(x => /квартир|студи|апартамент|комнат/i.test(x.h3)) || {}).h3);
}

// Минск: агроусадеб и домов в черте города нет — адреса переехали
for (const [п, куда] of [['/minsk-usadby', '/minsk-obl-usadby'], ['/minsk-kottedzhi', '/doma-na-sutki-pod-minskom']]) {
  const r = await стр(п);
  check(п + ' → 301 на ' + куда, r.код === 301 && r.куда === куда, r.код + ' ' + r.куда);
}
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
check('переехавших адресов нет в карте сайта', !/\/minsk-usadby<|\/minsk-kottedzhi</.test(карта));
const минск = (await стр('/minsk')).html;
check('с /minsk нет ссылок на переехавшие адреса', !/href="\/minsk-usadby"|href="\/minsk-kottedzhi"/.test(минск));

// новые страницы под запросы
{
  const { код, html } = await стр('/kvartiry-bez-posrednikov');
  check('/kvartiry-bez-posrednikov открывается с h1', код === 200 && h1(html) === 'Квартиры на сутки без посредников в Минске', h1(html));
  check('…и честно объясняет, что мы не посредник', /не берём комиссию/.test(html));
}
{
  const { код, html } = await стр('/minsk-odnokomnatnye');
  check('/minsk-odnokomnatnye открывается с h1', код === 200 && h1(html) === 'Однокомнатные квартиры на сутки в Минске', h1(html));
  const к = карточки(html);
  check('…и все варианты однокомнатные', к.length >= 5 && к.every(x => x.мета.includes('1-комн')), 'карточек ' + к.length + ', не 1-комн: ' + к.filter(x => !x.мета.includes('1-комн')).length);
}
{
  const { код, html } = await стр('/doma-na-sutki-pod-minskom');
  check('/doma-na-sutki-pod-minskom открывается с h1', код === 200 && h1(html) === 'Дома на сутки под Минском', h1(html));
  const к = карточки(html);
  check('…и там только дома', к.length >= 5 && к.every(x => !/квартир|студи|апартамент|комнат/i.test(x.h3)), 'карточек ' + к.length);
}
{
  const { код, html } = await стр('/doma-dlya-korporativa');
  check('корпоративы: title «Новогодний корпоратив под Минском: … загородные комплексы»', код === 200 && /^Новогодний корпоратив под Минском: .*загородные комплексы/.test(заголовок(html)), заголовок(html));
}
for (const п of ['/kvartiry-bez-posrednikov', '/minsk-odnokomnatnye', '/doma-na-sutki-pod-minskom'])
  check(п + ' в карте сайта', карта.includes(п + '</loc>'));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
