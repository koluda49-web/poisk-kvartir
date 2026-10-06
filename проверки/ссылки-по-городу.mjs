// Внутренние ссылки и карта сайта (04.10).
//
// Зачем. Страниц под поиск у города много (недорого, однокомнатные, усадьбы,
// дома, районы Минска, без посредников, «где остановиться», «что посмотреть»),
// а ссылок между ними почти не было — поисковик находил их только по sitemap.
// Проверяем:
//   1) на странице города блок «Ещё по городу» со всеми его страницами — и все
//      они открываются (пустые и помеченные пустыми туда не попадают);
//   2) на странице места в городе — «Квартиры на сутки в …» и «Что посмотреть в …»,
//      а у места вдали от городов со страницей этих ссылок нет;
//   3) в sitemap.xml у каждого адреса lastmod (дата, не из будущего), новые хабы там есть.
//
// Сервер должен быть запущен и прогрет. Пункт про пометку «пустая» — только с DATA_TEST=1.
//   node проверки/ссылки-по-городу.mjs http://127.0.0.1:9682
const SITE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));
const стр = async п => { const r = await fetch(SITE + п, { signal: AbortSignal.timeout(120000) }); return { код: r.status, html: await r.text() }; };
const блокЕщё = h => [...((h.split('<h2>Ещё по городу</h2><div class="others">')[1] || '').split('</div>')[0].matchAll(/<a href="([^"]+)">/g))].map(м => м[1]);
const открытые = new Map();
const открывается = async а => { if (!открытые.has(а)) открытые.set(а, (await стр(а)).код); return открытые.get(а) === 200; };

console.log('\n=== «Ещё по городу» ===');
for (const [п, нужны] of [
  ['/minsk', ['/minsk-nedorogo', '/kvartiry-bez-posrednikov', '/minsk-odnokomnatnye', '/minsk-centr', '/minsk-vokzal', '/minsk-zavodskoj', '/doma-na-sutki-pod-minskom', '/gde-ostanovitsya-minsk', '/chto-posmotret-minsk']],
  // однокомнатные 06.10: Могилёв, Витебск, Молодечно
  ['/mogilev', ['/mogilev-nedorogo', '/mogilev-odnokomnatnye', '/chto-posmotret-mogilev']],
  ['/vitebsk', ['/vitebsk-nedorogo', '/vitebsk-odnokomnatnye', '/chto-posmotret-vitebsk']],
  ['/molodechno', ['/molodechno-odnokomnatnye']],
  ['/grodno', ['/grodno-nedorogo', '/grodno-usadby', '/grodno-kottedzhi', '/grodno-odnokomnatnye', '/gde-ostanovitsya-grodno', '/chto-posmotret-grodno']],
  ['/brest-nedorogo', ['/brest', '/brest-usadby', '/brest-kottedzhi', '/brest-odnokomnatnye', '/gde-ostanovitsya-brest', '/chto-posmotret-brest']],
  ['/minsk-obl', ['/minsk-obl-nedorogo', '/minsk-obl-usadby', '/minsk-obl-kottedzhi', '/doma-na-sutki-pod-minskom']],  ['/lida', ['/gde-ostanovitsya-lida']],
]) {
  const { код, html } = await стр(п);
  const есть = блокЕщё(html);
  check(п + ': блок «Ещё по городу»', код === 200 && есть.length > 0, 'код ' + код);
  const нет = нужны.filter(а => !есть.includes(а));
  // страница спроса может сейчас не открываться (мало вариантов) — тогда её и не должно быть
  const нетЖивых = [];
  for (const а of нет) if (await открывается(а)) нетЖивых.push(а);
  check(п + ': в блоке все живые страницы города', !нетЖивых.length, 'нет: ' + нетЖивых.join(', '));
  check(п + ': самой себя в блоке нет', !есть.includes(п));
  check(п + ': переехавших адресов нет', !есть.some(а => /^\/minsk-(usadby|kottedzhi)$/.test(а)));
  const битые = [];
  for (const а of есть) if (!(await открывается(а))) битые.push(а + ' (' + открытые.get(а) + ')');
  check(п + ': все ссылки блока открываются (' + есть.length + ')', !битые.length, битые.join(', '));
}

const служебный = async з => { try { const r = await fetch(SITE + '/api/_empty-test?' + з, { method: 'POST' }); return r.ok && !!(await r.json()).pid; } catch { return false; } };
if (!(await служебный('slug=minsk-uruchie&age=' + (2 * 60 * 60 * 1000)))) console.log('  (сервер без DATA_TEST=1 — пункт про пустую страницу пропущен)');
else {
  try {
    await служебный('slug=minsk-uruchie&age=0');
    check('/minsk: помеченную пустой /minsk-uruchie не предлагает', !блокЕщё((await стр('/minsk')).html).includes('/minsk-uruchie'));
  } finally { await служебный('slug=minsk-uruchie&age=' + (2 * 60 * 60 * 1000)); }
}

console.log('\n=== страница места: город рядом ===');
const места = (await (await fetch(SITE + '/api/places?light=1')).json()).items;
const км = (a1, o1, a2, o2) => { const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2; return 6371 * 2 * Math.asin(Math.sqrt(h)); };
const факты = h => (h.split('<div class="facts">')[1] || '').split('</div>')[0];
const ближнее = (ц, r) => места.filter(p => км(ц[0], ц[1], p.lat, p.lng) <= r)[0];
for (const [город, ц, жильё, гид] of [['Минск', [53.9020, 27.5615], '/minsk', '/chto-posmotret-minsk'],
                                       ['Гродно', [53.6690, 23.8130], '/grodno', '/chto-posmotret-grodno'],
                                       ['Лида', [53.8880, 25.2990], '/lida', null]]) {
  const p = ближнее(ц, 2);
  if (!p) { check('есть место в центре: ' + город, false); continue; }
  const { код, html } = await стр('/mesto/' + p.id);
  const ф = факты(html);
  check('/mesto/' + p.id + ' (' + p.name + ', ' + город + '): «Квартиры на сутки» → ' + жильё, код === 200 && ф.includes('href="' + жильё + '">Квартиры на сутки '), 'код ' + код);
  if (гид) check('/mesto/' + p.id + ': «Что посмотреть» → ' + гид, ф.includes('href="' + гид + '">Что посмотреть '));
  else check('/mesto/' + p.id + ': «Что посмотреть» нет — у города нет такой страницы', !/href="\/chto-posmotret-/.test(ф));
}
{
  // Мирский замок: до Новогрудка и Несвижа почти 30 км — ни своей страницы города, ни «что посмотреть»
  const { код, html } = await стр('/mesto/2416');
  const ф = факты(html);
  check('/mesto/2416 (Мирский замок): ссылок на город нет — рядом нет города со страницей', код === 200 && !/Квартиры на сутки|Что посмотреть/.test(ф), ф.slice(0, 200));
}

console.log('\n=== sitemap.xml ===');
{
  const карта = await (await fetch(SITE + '/sitemap.xml')).text();
  const адреса = [...карта.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(м => м[1]);
  const сегодня = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const безДаты = адреса.filter(а => !/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(а));
  check('у каждого адреса lastmod ГГГГ-ММ-ДД (' + адреса.length + ')', адреса.length > 100 && !безДаты.length, безДаты.slice(0, 3).join(' | '));
  const будущее = адреса.filter(а => ((а.match(/<lastmod>([^<]+)/) || [])[1] || '') > сегодня);
  check('lastmod не из будущего', !будущее.length, будущее.slice(0, 2).join(' | '));
  for (const п of ['/goroda', '/doma-na-sutki', '/kvartiry-nedorogo', '/dostoprimechatelnosti-belarusi',
                   '/odnokomnatnye', '/mogilev-odnokomnatnye', '/vitebsk-odnokomnatnye', '/molodechno-odnokomnatnye',
                   '/gorki', '/smorgon', '/rechica', '/bereza', '/minsk-zavodskoj'])
    check(п + ' в карте сайта', карта.includes('https://nochy.by' + п + '</loc>'));
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
