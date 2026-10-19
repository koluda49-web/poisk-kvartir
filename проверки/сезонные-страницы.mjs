// Сезонные подборки: «Снять дом на Новый год», «Где встретить Новый год в Беларуси»
// и «Новогодний корпоратив» под Минском, в Бресте и в Гродно; с 19.10 — «Дом на Новый год»
// в Брестской, Гродненской, Витебской, Гомельской и Могилёвской областях.
//
// Зачем. В октябре–ноябре дома на Новый год и на корпоративы ищут больше
// всего. Страницы собираются из общей выдачи: только дома (не квартиры),
// от восьми (на корпоратив — от десяти-двенадцати) гостей, недалеко от города,
// и честно говорят, что праздничную цену и свободный вечер надо спросить у хозяина.
//
// Сервер должен быть запущен.
//   node проверки/сезонные-страницы.mjs
//   node проверки/сезонные-страницы.mjs https://nochy.by
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const текст = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const мета = (html, имя) => ((html.match(new RegExp('<meta name="' + имя + '" content="([^"]*)"')) || [])[1] || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const СТРАНИЦЫ = [
  { slug: 'doma-na-novyj-god',            h1: 'Снять дом на Новый год под Минском',  гостей: 8,  пояснение: /31 декабря/, обл: 'minsk-obl' },
  { slug: 'gde-vstretit-novyj-god',       h1: 'Где встретить Новый год в Беларуси',  гостей: 8,  пояснение: /31 декабря/, обл: 'any' },
  // «корпоратив минск» 1 187, «новогодний корпоратив минск» 596 (Вордстат, сентябрь 2026) — с 04.10
  { slug: 'doma-dlya-korporativa',        h1: 'Корпоратив в Минске и под Минском',   гостей: 12, пояснение: /банкет/,     обл: 'minsk-obl',
    title: 'Корпоратив в Минске: дома и усадьбы, новогодний корпоратив' },
  { slug: 'novogodnij-korporativ-brest',  h1: 'Новогодний корпоратив в Бресте',      гостей: 10, пояснение: /банкет/,     обл: 'brest' },
  { slug: 'novogodnij-korporativ-grodno', h1: 'Новогодний корпоратив в Гродно',      гостей: 12, пояснение: /банкет/,     обл: 'grodno' },
];
const страницы = {};
for (const с of СТРАНИЦЫ) {
  console.log('— /' + с.slug);
  const r = await fetch(SITE + '/' + с.slug);
  const html = await r.text();
  страницы[с.slug] = html;
  check('страница открывается', r.status === 200, 'код ' + r.status);
  if (r.status !== 200) continue;
  check('заголовок h1 «' + с.h1 + '»', html.includes('<h1>' + с.h1 + '</h1>'));
  const title = (html.match(/<title>([^<]*)/) || [])[1] || '';
  check('title ' + (с.title ? ('«' + с.title + '»') : 'про то же') + ' и не длиннее 60', (с.title ? title === с.title : title.indexOf(с.h1) === 0) && title.length <= 60, title + ' (' + title.length + ')');
  const desc = мета(html, 'description');
  check('description 120–160 знаков', desc.length >= 120 && desc.length <= 160, desc.length + ': ' + desc);
  check('есть пояснение про цену и даты', с.пояснение.test(текст(html)) && /уточняйте у хозяина/.test(текст(html)));
  const карточки = html.split('<article class="c">').slice(1);
  check('не меньше пяти вариантов', карточки.length >= 5, 'карточек ' + карточки.length);
  const заголовки = карточки.map(к => (к.match(/<h3>([^<]*)<\/h3>/) || [])[1] || '');
  check('среди вариантов нет квартир', заголовки.every(t => !/квартир|студи|апартамент/i.test(t)), заголовки.find(t => /квартир|студи|апартамент/i.test(t)));
  const гости = карточки.map(к => +((к.match(/до (\d+) гостей/) || [])[1] || 0));
  check('у каждого варианта от ' + с.гостей + ' гостей', гости.every(g => g >= с.гостей), 'нашлось ' + гости.filter(g => g < с.гостей).join(', '));
  const поиск = '/?region=' + с.обл + '&type=cottage';
  check('кнопка ведёт в поиск домов', html.includes('href="' + поиск.replace('&', '&amp;') + '"') || html.includes('href="' + поиск + '"'));
  // остальные новогодние страницы — отдельной строкой
  const блок = (html.split('<h2>Новый год и корпоративы</h2>')[1] || '').split('</div>')[0];
  const мимо = СТРАНИЦЫ.filter(x => x.slug !== с.slug && !блок.includes('href="/' + x.slug + '"')).map(x => x.slug);
  check('в блоке «Новый год и корпоративы» ссылки на остальные четыре', !мимо.length, 'нет: ' + мимо.join(', '));
}

// корпоративы: загородные комплексы с залами — отдельным блоком, со ссылкой на сайт
const корп = страницы['doma-dlya-korporativa'] || '';
check('на странице корпоративов есть блок загородных комплексов', /Загородные комплексы с банкетными залами/.test(корп));
check('в нём шесть комплексов', (корп.match(/<article class="v">/g) || []).length === 6, 'нашлось ' + (корп.match(/<article class="v">/g) || []).length);
check('Robinson Club со ссылкой на свой сайт', /Robinson Club/.test(корп) && корп.includes('href="https://robins.by/'));
check('ссылки на комплексы — nofollow и в новой вкладке', (корп.match(/class="go" href="https:\/\/[^"]+" target="_blank" rel="noopener nofollow">Сайт комплекса/g) || []).length === 6);
check('у комплексов нет цен', корп.split('<article class="v">').slice(1).every(к => !/BYN/.test(к.split('</article>')[0])));
// под Брестом и Гродно комплексы не проверяли — их там нет
for (const slug of ['doma-na-novyj-god', 'gde-vstretit-novyj-god', 'novogodnij-korporativ-brest', 'novogodnij-korporativ-grodno'])
  check('на /' + slug + ' комплексов нет', !/Загородные комплексы|<article class="v">/.test(страницы[slug] || ''));

// главная ведёт на все подборки
const главная = await (await fetch(SITE + '/')).text();
for (const с of СТРАНИЦЫ) check('на главной есть ссылка на /' + с.slug, главная.includes('href="/' + с.slug + '"'));

// со страниц Бреста и Гродно — на свой корпоратив
for (const [город, slug] of [['brest', 'novogodnij-korporativ-brest'], ['grodno', 'novogodnij-korporativ-grodno']]) {
  const h = await (await fetch(SITE + '/' + город)).text();
  check('со страницы /' + город + ' есть ссылка на /' + slug, h.includes('href="/' + slug + '"'));
}

// все страницы в карте сайта и в «других подборках» у соседей
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
for (const с of СТРАНИЦЫ) check('/' + с.slug + ' в карте сайта', карта.includes('/' + с.slug + '</loc>'));
const баня = await (await fetch(SITE + '/dom-s-banej')).text();
for (const с of СТРАНИЦЫ) check('со страницы «Дома с баней» есть ссылка на /' + с.slug, баня.includes('href="/' + с.slug + '"'));

// «Дом на Новый год в <области>» (19.10): дома, коттеджи и усадьбы целиком по всей области,
// без порога по гостям. Цены — обычные из объявлений, про праздник — «уточняйте у хозяина»;
// «Частые вопросы» с живыми цифрами и FAQPage тем же текстом.
const раскрыть = t => String(t).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const ОБЛАСТИ = [['brest', 'в Брестской области'], ['grodno', 'в Гродненской области'], ['vitebsk', 'в Витебской области'],
                 ['gomel', 'в Гомельской области'], ['mogilev', 'в Могилёвской области']];
const поОбластям = h => [...((h.split('<h2>Дом на Новый год по областям</h2>')[1] || '').split('</div>')[0]).matchAll(/href="\/([^"]+)"/g)].map(м => м[1]);
const сНовогоГода = поОбластям(страницы['doma-na-novyj-god'] || ''), сГдеВстретить = поОбластям(страницы['gde-vstretit-novyj-god'] || '');
for (const [обл, где] of ОБЛАСТИ) {
  const slug = 'doma-na-novyj-god-' + обл, h1т = 'Дом на Новый год ' + где;
  console.log('— /' + slug);
  const r = await fetch(SITE + '/' + slug);
  const html = r.status === 200 ? await r.text() : '';
  check('страница открывается', r.status === 200, 'код ' + r.status + (r.status === 404 ? ' (вариантов меньше пяти — данные площадок)' : ''));
  if (r.status !== 200) continue;
  check('h1 «' + h1т + '»', html.includes('<h1>' + h1т + '</h1>'));
  const title = (html.match(/<title>([^<]*)/) || [])[1] || '';
  check('title «' + h1т + ' — снять коттедж» (до 60)', title === h1т + ' — снять коттедж' && title.length <= 60, title + ' (' + title.length + ')');
  const desc = мета(html, 'description');
  check('description 120–160 и про праздничную цену', desc.length >= 120 && desc.length <= 160 && desc.includes('На праздники цену и минимальный срок уточняйте у хозяина.'), desc.length + ': ' + desc);
  check('пояснение: только дома, обычная цена, 31 декабря — у хозяина', /квартир здесь нет/.test(текст(html)) && /на праздники цену и минимальный срок уточняйте у хозяина/.test(текст(html)) && /31 декабря/.test(текст(html)));
  const карточки = html.split('<article class="c">').slice(1);
  const заголовки = карточки.map(к => (к.match(/<h3>([^<]*)<\/h3>/) || [])[1] || '');
  check('не меньше пяти вариантов, и это дома', карточки.length >= 5 && заголовки.every(t => !/квартир|студи|апартамент/i.test(t)), 'карточек ' + карточки.length + '; ' + (заголовки.find(t => /квартир|студи|апартамент/i.test(t)) || ''));
  check('кнопка ведёт в поиск домов области', html.includes('href="/?region=' + обл + '&amp;type=cottage"') || html.includes('href="/?region=' + обл + '&type=cottage"'));
  // частые вопросы: видимый блок и FAQPage тем же текстом; цифры — те же, что в «Сейчас доступно»
  const в = [...((html.split('<h2>Частые вопросы</h2><div class="faq">')[1] || '').split('</div>')[0]).matchAll(/<h3>([^<]*)<\/h3><p>([^<]*)<\/p>/g)].map(м => [раскрыть(м[1]), раскрыть(м[2])]);
  check('«Частые вопросы» — от трёх', в.length >= 3 && в.length <= 6, 'вопросов ' + в.length);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(м => { try { return JSON.parse(м[1]); } catch (e) { return {}; } }).find(о => о['@type'] === 'FAQPage');
  check('FAQPage — те же вопросы и ответы', !!ld && ld.mainEntity.length === в.length && ld.mainEntity.every((q, i) => q.name === в[i][0] && q.acceptedAnswer.text === в[i][1]));
  const всего = +((html.match(/Сейчас доступно <b>(\d+)<\/b>/) || [])[1] || -1);
  const мин = +((html.match(/самый дешёвый — <b>(\d+(?:\.\d+)?) BYN/) || [])[1] || 0), обычно = +((html.match(/обычная цена около <b>(\d+(?:\.\d+)?) BYN/) || [])[1] || 0);
  const о1 = (в.find(x => x[0] === 'Сколько стоит снять дом на Новый год ' + где + '?') || [])[1] || '';
  const м1 = о1.match(new RegExp('^Сейчас ' + где + ' (\\d+) вариант\\S* — дома, коттеджи и усадьбы целиком: самый дешёвый — (\\d+(?:\\.\\d+)?) BYN за сутки, обычная цена около (\\d+(?:\\.\\d+)?) BYN\\. Это цены из объявлений на обычные дни: на праздники цену и минимальный срок уточняйте у хозяина\\.'));
  check('«Сколько стоит…» — цифры страницы (' + всего + ', от ' + мин + ', около ' + обычно + ')', !!м1 && +м1[1] === всего && +м1[2] === мин && +м1[3] === обычно, о1.slice(0, 160));
  check('«Сколько стоит…» — ссылки на дома и усадьбы области', html.includes('<a href="/' + обл + '-kottedzhi">') && html.includes('<a href="/' + обл + '-usadby">'));
  const о2 = (в.find(x => x[0] === 'Есть ли дом на Новый год для большой компании ' + где + '?') || [])[1] || '';
  check('«…для большой компании» — от 8 и от 12 гостей по объявлению', /^(Да: от 8 гостей по объявлению — \d+ вариант|Домов, где по объявлению помещается от 8 гостей, сейчас нет)/.test(о2), о2.slice(0, 120));
  check('«…свободен ли дом на 31 декабря?» — честно: дат не видим', /^Свободные даты площадки нам не показывают/.test((в.find(x => x[0] === 'Как узнать, свободен ли дом на 31 декабря?') || [])[1] || ''));
  check('новогодних цен не выдумываем: в вопросах нет «новогодняя цена — N BYN»', !в.some(x => /(новогодн|праздничн)[а-яё ]*(—|:)? *\d+ BYN/i.test(x[1])));
  check('ссылка с /doma-na-novyj-god (блок «по областям»)', сНовогоГода.includes(slug), сНовогоГода.join(', '));
  check('ссылка с /gde-vstretit-novyj-god (блок «по областям»)', сГдеВстретить.includes(slug));
  for (const п of ['/' + обл, '/' + обл + '-kottedzhi', '/' + обл + '-usadby']) {
    const h = await (await fetch(SITE + п)).text();
    check('ссылка со страницы ' + п, h.includes('<a class="pr-route" href="/' + slug + '">'));
  }
  check('в карте сайта', карта.includes('/' + slug + '</loc>'));
  const блок = (html.split('<h2>Новый год и корпоративы</h2>')[1] || '').split('</div>')[0];
  const мимо = СТРАНИЦЫ.filter(x => !блок.includes('href="/' + x.slug + '"')).map(x => x.slug);
  check('в блоке «Новый год и корпоративы» — все пять общих', !мимо.length, 'нет: ' + мимо.join(', '));
}
// Минской области своей нет: /doma-na-novyj-god и есть она (до 100 км от Минска)
check('/doma-na-novyj-god-minsk-obl не заведена — 404', (await fetch(SITE + '/doma-na-novyj-god-minsk-obl')).status === 404);
// пять областных не вытесняют остальные подборки внизу чужих страниц — только своя область
check('с /dom-s-banej областных «Дом на Новый год» нет', !/href="\/doma-na-novyj-god-/.test(баня));
const однБрест = await (await fetch(SITE + '/brest-odnokomnatnye')).text();
check('с /brest-odnokomnatnye — только своя: /doma-na-novyj-god-brest',
  однБрест.includes('href="/doma-na-novyj-god-brest"') && !/href="\/doma-na-novyj-god-(grodno|vitebsk|gomel|mogilev)"/.test(однБрест));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
