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

// «Что посмотреть в Гродно / Минске» («что посмотреть в Минске» 5,2 тыс., «Гродно что посмотреть» 4,2 тыс.)
for (const [п, где, первое] of [['/chto-posmotret-grodno', 'в Гродно', /Старый замок|Коложск|Новый замок/],
                                 ['/chto-posmotret-minsk', 'в Минске', /ратуша|Свято-Духов|Архикафедральный|Троицкое/i]]) {
  const { код, html } = await стр(п);
  check(п + ' открывается с h1 «Что посмотреть ' + где + '»', код === 200 && h1(html) === 'Что посмотреть ' + где, код + ' ' + h1(html));
  if (код !== 200) continue;
  const места = [...html.matchAll(/<h3><a href="[^"]+">([^<]+)<\/a><\/h3><div class="m"><span>([\d,]+) км от центра/g)].map(м => ({ имя: м[1], км: +м[2].replace(',', '.') }));
  check(п + ': не меньше 8 мест', места.length >= 8, 'мест ' + места.length);
  check(п + ': наверху — главное в центре', места.length > 0 && места[0].км <= 3 && первое.test(места.slice(0, 3).map(x => x.имя).join(' ')), места.slice(0, 3).map(x => x.имя + ' ' + x.км).join('; '));
  check(п + ': у каждого места есть описание', (html.match(/<p class="t">[^<]{60,}/g) || []).length === места.length);
  const сВикисклада = (html.match(/<img src="https:\/\/(thumb|upload)\.wikimedia\.org/g) || []).length;
  check(п + ': у фото с Викисклада подписан автор и лицензия', сВикисклада === (html.match(/class="cr">Фото:/g) || []).length, 'фото ' + сВикисклада);
  check(п + ': Куропат на странице нет', !/Куропат/.test(html));
  check(п + ' в карте сайта', карта.includes(п + '</loc>'));
}
check('с /grodno есть ссылка на «Что посмотреть в Гродно»', /href="\/chto-posmotret-grodno"/.test((await стр('/grodno')).html));
{
  const r = await (await fetch(SITE + '/api/place?id=910089')).json();
  check('Минская ратуша есть на карте и с подписью фото', /ратуша/i.test(r.name || '') && !!(r.cred && r.cred.author && r.cred.lic), JSON.stringify(r.cred || {}));
}
// «Что посмотреть в Бресте» (добавлено 30.09, задача brest): в центре — храмы и Советская,
// а не только памятник, часы и кошки, которые одни и были на карте с фото
{
  const п = '/chto-posmotret-brest';
  const { код, html } = await стр(п);
  check(п + ' открывается с h1 «Что посмотреть в Бресте»', код === 200 && h1(html) === 'Что посмотреть в Бресте', код + ' ' + h1(html));
  const места = [...html.matchAll(/<h3><a href="[^"]+">([^<]+)<\/a><\/h3><div class="m"><span>([\d,]+) км от центра/g)].map(м => ({ имя: м[1], км: +м[2].replace(',', '.') }));
  check(п + ': не меньше 8 мест', места.length >= 8, 'мест ' + места.length);
  check(п + ': наверху — главное в центре', места.length > 0 && места[0].км <= 3 && /Николаевск|Симеонов|Воздвижен|Советск/i.test(места.slice(0, 3).map(x => x.имя).join(' ')),
        места.slice(0, 3).map(x => x.имя + ' ' + x.км).join('; '));
  check(п + ': есть братская церковь, Симеоновский собор и костёл', ['Николаевская братская', 'Симеоновский', 'Воздвижения'].every(с => места.some(x => x.имя.includes(с))),
        места.map(x => x.имя).join('; '));
  check(п + ': у каждого места есть описание', места.length > 0 && (html.match(/<p class="t">[^<]{60,}/g) || []).length === места.length);
  const сВикисклада = (html.match(/<img src="https:\/\/(thumb|upload)\.wikimedia\.org/g) || []).length;
  check(п + ': у фото с Викисклада подписан автор и лицензия', сВикисклада === (html.match(/class="cr">Фото:/g) || []).length, 'фото ' + сВикисклада);
  check(п + ': Куропат на странице нет', !/Куропат/.test(html));
  check(п + ' в карте сайта', карта.includes(п + '</loc>'));
  check('с /brest есть ссылка на «Что посмотреть в Бресте»', /href="\/chto-posmotret-brest"/.test((await стр('/brest')).html));
}

// «дом с бассейном» и однокомнатные по городам (добавлено 30.09, задача pages)
for (const [п, где, чужие] of [['/grodno-odnokomnatnye', 'в Гродно', /Лида|Слоним|Волковыск/],
                                ['/brest-odnokomnatnye', 'в Бресте', /Барановичи|Пинск|Кобрин/],
                                ['/gomel-odnokomnatnye', 'в Гомеле', /Мозырь|Жлобин|Речица/]]) {
  const { код, html } = await стр(п);
  check(п + ' открывается с h1 «Однокомнатные квартиры на сутки ' + где + '»', код === 200 && h1(html) === 'Однокомнатные квартиры на сутки ' + где, код + ' ' + h1(html));
  if (код !== 200) continue;
  const к = карточки(html);
  check(п + ': все варианты однокомнатные', к.length >= 5 && к.every(x => x.мета.includes('1-комн')), 'карточек ' + к.length + ', не 1-комн: ' + к.filter(x => !x.мета.includes('1-комн')).length);
  // «Брестская ул.» в Барановичах — не Брест
  check(п + ': других городов области нет', к.every(x => !чужие.test(x.мета.join(' ') + ' ' + x.h3)), (к.find(x => чужие.test(x.мета.join(' ') + ' ' + x.h3)) || {}).h3);
}
{
  const { код, html } = await стр('/doma-s-bassejnom');
  check('/doma-s-bassejnom открывается с h1', код === 200 && h1(html) === 'Дома на сутки с бассейном в Беларуси', код + ' ' + h1(html));
  const к = карточки(html);
  check('…и там только дома с бассейном', к.length >= 5 && к.every(x => /бассейн/i.test(x.h3) && !/квартир|студи|апартамент|комнат/i.test(x.h3)),
    'карточек ' + к.length + '; ' + (к.find(x => !/бассейн/i.test(x.h3) || /квартир|студи|апартамент|комнат/i.test(x.h3)) || {}).h3);
  check('…и честно просит уточнить бассейн у хозяина', /уточняйте у хозяина/.test(html));
}
for (const п of ['/grodno-odnokomnatnye', '/brest-odnokomnatnye', '/gomel-odnokomnatnye', '/doma-s-bassejnom'])
  check(п + ' в карте сайта', карта.includes(п + '</loc>'));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
