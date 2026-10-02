// Сезонные подборки: «Снять дом на Новый год», «Где встретить Новый год в Беларуси»
// и «Новогодний корпоратив» под Минском, в Бресте и в Гродно.
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
  { slug: 'doma-dlya-korporativa',        h1: 'Новогодний корпоратив под Минском',   гостей: 12, пояснение: /банкет/,     обл: 'minsk-obl' },
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
  check('title про то же и не длиннее 60', title.indexOf(с.h1) === 0 && title.length <= 60, title + ' (' + title.length + ')');
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

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
