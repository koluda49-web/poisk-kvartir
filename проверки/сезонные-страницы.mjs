// Сезонные подборки: «Дома на Новый год» и «Дома и усадьбы для корпоратива».
//
// Зачем. В октябре–ноябре дома на Новый год и на корпоративы ищут больше
// всего. Страницы собираются из общей выдачи: только дома (не квартиры),
// от восьми (двенадцати) гостей, не дальше 100 (70) км от Минска, и честно
// говорят, что праздничную цену и свободный вечер надо спросить у хозяина.
//
// Сервер должен быть запущен.
//   node проверки/сезонные-страницы.mjs
//   node проверки/сезонные-страницы.mjs https://poisk-kvartir.onrender.com
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const текст = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const СТРАНИЦЫ = [
  { slug: 'doma-na-novyj-god',     h1: 'Дома на Новый год под Минском',                  гостей: 8,  пояснение: /31 декабря/ },
  { slug: 'doma-dlya-korporativa', h1: 'Дома и усадьбы для корпоратива под Минском',     гостей: 12, пояснение: /банкет/ },
];
for (const с of СТРАНИЦЫ) {
  console.log('— /' + с.slug);
  const r = await fetch(SITE + '/' + с.slug);
  const html = await r.text();
  check('страница открывается', r.status === 200, 'код ' + r.status);
  if (r.status !== 200) continue;
  check('заголовок h1 «' + с.h1 + '»', html.includes('<h1>' + с.h1 + '</h1>'));
  check('title про то же', new RegExp('<title>' + с.h1).test(html));
  check('есть пояснение про цену и даты', с.пояснение.test(текст(html)) && /уточняйте у хозяина/.test(текст(html)));
  const карточки = html.split('<article class="c">').slice(1);
  check('не меньше пяти вариантов', карточки.length >= 5, 'карточек ' + карточки.length);
  const заголовки = карточки.map(к => (к.match(/<h3>([^<]*)<\/h3>/) || [])[1] || '');
  check('среди вариантов нет квартир', заголовки.every(t => !/квартир|студи|апартамент/i.test(t)), заголовки.find(t => /квартир|студи|апартамент/i.test(t)));
  const гости = карточки.map(к => +((к.match(/до (\d+) гостей/) || [])[1] || 0));
  check('у каждого варианта от ' + с.гостей + ' гостей', гости.every(g => g >= с.гостей), 'нашлось ' + гости.filter(g => g < с.гостей).join(', '));
  check('кнопка ведёт в поиск домов', html.includes('href="/?region=minsk-obl&amp;type=cottage"') || html.includes('href="/?region=minsk-obl&type=cottage"'));
}

// обе страницы в карте сайта и в «других подборках» у соседей
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
for (const с of СТРАНИЦЫ) check('/' + с.slug + ' в карте сайта', карта.includes('/' + с.slug + '</loc>'));
const баня = await (await fetch(SITE + '/dom-s-banej')).text();
for (const с of СТРАНИЦЫ) check('со страницы «Дома с баней» есть ссылка на /' + с.slug, баня.includes('href="/' + с.slug + '"'));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
