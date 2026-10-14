// Внутренние ссылки и карта сайта (04.10).
//
// Зачем. Страниц под поиск у города много (недорого, однокомнатные, усадьбы,
// дома, районы Минска, без посредников, «где остановиться», «что посмотреть»),
// а ссылок между ними почти не было — поисковик находил их только по sitemap.
// Проверяем:
//   1) на странице города блок «Ещё по городу» со всеми его страницами — и все
//      они открываются (пустые и помеченные пустыми туда не попадают);
//   2) на странице места в городе — «Квартиры на сутки в …» (с 14.10 заметным блоком
//      в первой половине страницы, с цифрами страницы города) и «Что посмотреть в …»,
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
  ['/minsk', ['/minsk-nedorogo', '/kvartiry-bez-posrednikov', '/minsk-odnokomnatnye', '/minsk-dvuhkomnatnye', '/minsk-centr', '/minsk-vokzal', '/minsk-zavodskoj', '/doma-na-sutki-pod-minskom', '/gde-ostanovitsya-minsk', '/chto-posmotret-minsk',
            // районы Минска по карте (11.10)
            '/minsk-frunzenskij', '/minsk-partizanskij', '/minsk-moskovskij']],
  // однокомнатные 06.10: Могилёв, Витебск, Молодечно
  // двухкомнатные 09.10: Минск, Могилёв, Гродно
  ['/mogilev', ['/mogilev-nedorogo', '/mogilev-odnokomnatnye', '/mogilev-dvuhkomnatnye', '/chto-posmotret-mogilev']],
  ['/vitebsk', ['/vitebsk-nedorogo', '/vitebsk-odnokomnatnye', '/chto-posmotret-vitebsk']],
  ['/molodechno', ['/molodechno-odnokomnatnye']],
  ['/grodno', ['/grodno-nedorogo', '/grodno-usadby', '/grodno-kottedzhi', '/grodno-odnokomnatnye', '/grodno-dvuhkomnatnye', '/gde-ostanovitsya-grodno', '/chto-posmotret-grodno']],
  ['/brest-nedorogo', ['/brest', '/brest-usadby', '/brest-kottedzhi', '/brest-odnokomnatnye', '/gde-ostanovitsya-brest', '/chto-posmotret-brest']],
  ['/minsk-obl', ['/minsk-obl-nedorogo', '/minsk-obl-usadby', '/minsk-obl-kottedzhi', '/doma-na-sutki-pod-minskom']],
  // 11.10 (вечер): «недорого» и однокомнатные в больших районных городах
  ['/lida', ['/gde-ostanovitsya-lida', '/lida-nedorogo']],
  ['/baranovichi', ['/baranovichi-nedorogo', '/baranovichi-odnokomnatnye']],
  ['/bobruisk', ['/bobruisk-nedorogo']],
  ['/pinsk', ['/pinsk-nedorogo']],
  ['/polotsk', ['/polotsk-nedorogo']],
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

// «Ещё в … области» (11.10): у районного города — областной центр и соседние города области,
// у областного центра — его районные города; только живые страницы
console.log('\n=== «Ещё в … области» ===');
const блокОбласти = (h, где) => [...((h.split('<h2>Ещё ' + где + '</h2><div class="others">')[1] || '').split('</div>')[0].matchAll(/<a href="([^"]+)">/g))].map(м => м[1]);
for (const [п, где, нужны] of [
  ['/brest', 'в Брестской области', ['/baranovichi', '/pinsk', '/luninec', '/ivacevichi', '/stolin', '/gancevichi']],
  ['/luninec', 'в Брестской области', ['/brest', '/pinsk', '/ivacevichi', '/stolin']],
  ['/dzerzhinsk', 'в Минской области', ['/minsk-obl', '/fanipol', '/smolevichi', '/lyuban', '/borisov']],
  ['/minsk-obl', 'в Минской области', ['/dzerzhinsk', '/fanipol', '/smolevichi', '/lyuban', '/borisov', '/molodechno']],
  ['/rogachev', 'в Гомельской области', ['/gomel', '/kalinkovichi', '/mozyr']],
  ['/ostrovec', 'в Гродненской области', ['/grodno', '/oshmyany', '/smorgon', '/lida']],
  ['/osipovichi', 'в Могилёвской области', ['/mogilev', '/bobruisk', '/gorki']],
  ['/lepel', 'в Витебской области', ['/vitebsk', '/polotsk', '/orsha']],
]) {
  const { код, html } = await стр(п);
  if (код === 404) { console.log('  (' + п + ' — 404: вариантов сейчас меньше пяти)'); continue; }
  const есть = блокОбласти(html, где);
  check(п + ': блок «Ещё ' + где + '»', код === 200 && есть.length > 0, 'код ' + код);
  const нетЖивых = [];
  for (const а of нужны.filter(а => !есть.includes(а))) if (await открывается(а)) нетЖивых.push(а);
  check(п + ': в блоке все живые страницы области из списка', !нетЖивых.length, 'нет: ' + нетЖивых.join(', '));
  check(п + ': самой себя в блоке нет', !есть.includes(п));
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
// 14.10: жильё города — заметным блоком в первой половине страницы (выше строки фактов
// и «Где переночевать рядом»): «Квартиры на сутки в <город> — N вариантов, обычно ~X BYN →».
// Цифры — из сводки страницы города (без поиска на каждое открытие); нет её — ссылка без цифр.
const блокЖилья = h => { const i = h.indexOf('<a class="stay" href="'); return i < 0 ? '' : h.slice(i, h.indexOf('</a>', i) + 4); };
const доступно = h => +((h.match(/Сейчас доступно <b>(\d+)<\/b>/) || [])[1] || 0);
const обычная = h => +((h.match(/обычная цена около <b>(\d+) BYN<\/b>/) || [])[1] || 0);
const ближнее = (ц, r) => места.filter(p => км(ц[0], ц[1], p.lat, p.lng) <= r)[0];
let сЦифрами = 0;
for (const [город, ц, жильё, гид] of [['Минск', [53.9020, 27.5615], '/minsk', '/chto-posmotret-minsk'],
                                       ['Гродно', [53.6690, 23.8130], '/grodno', '/chto-posmotret-grodno'],
                                       // 11.10: у Лиды страница «что посмотреть» появилась, у Мозыря — 14.10 (9 мест)
                                       ['Лида', [53.8880, 25.2990], '/lida', '/chto-posmotret-lida'],
                                       ['Мозырь', [52.0490, 29.2450], '/mozyr', '/chto-posmotret-mozyr']]) {
  const p = ближнее(ц, 2);
  if (!p) { check('есть место в центре: ' + город, false); continue; }
  const гор = (await стр(жильё)).html;   // страница города — её цифры и попадают в сводку
  const { код, html } = await стр('/mesto/' + p.id);
  const ф = факты(html), ж = блокЖилья(html);
  check('/mesto/' + p.id + ' (' + p.name + ', ' + город + '): блок «Квартиры на сутки» → ' + жильё,
        код === 200 && ж.startsWith('<a class="stay" href="' + жильё + '"><b>Квартиры на сутки '), 'код ' + код + ': ' + ж.slice(0, 160));
  const где = html.indexOf('<a class="stay"');
  check('/mesto/' + p.id + ': блок жилья выше строки фактов и «Где переночевать рядом»',
        где > 0 && где < html.indexOf('<div class="facts">') && где < html.indexOf('<h2>Где переночевать рядом</h2>'));
  check('/mesto/' + p.id + ': в строке фактов жилья больше нет (не дублируем)', !/Квартиры на сутки/.test(ф));
  const ц2 = ж.match(/<\/b>(?: — (\d+) вариант(?:а|ов)?, обычно ~(\d+) BYN)? →<\/a>$/);
  check('/mesto/' + p.id + ': текст ссылки «… — N вариантов, обычно ~X BYN →» или без цифр', !!ц2, ж);
  if (ц2 && ц2[1]) {
    сЦифрами++;
    const n = +ц2[1], x = +ц2[2], n0 = доступно(гор), x0 = обычная(гор);
    // Страница места живёт в кэше 10 минут, а сводка города — пока не устареет: цифры могут
    // отставать от живой страницы города (сразу после запуска каталоги Check-in и Kvartirka
    // добавляют к Лиде полсотни вариантов). Сверяем, что это цифры страницы города, а не
    // жильё в 30 км: число — в пределах 40 %, обычная цена — 20 %.
    check('/mesto/' + p.id + ': цифры страницы ' + жильё + ' (' + n + ' / ~' + x + ' BYN; на странице сейчас ' + n0 + ' / ' + x0 + ')',
          n >= 5 && x > 0 && (!n0 || Math.abs(n - n0) <= Math.max(5, Math.round(n0 * 0.4))) && (!x0 || Math.abs(x - x0) <= Math.max(10, Math.round(x0 * 0.2))));
  }
  // та же ссылка — в окошке места на карте: её отдаёт /api/place
  const апи = await (await fetch(SITE + '/api/place?id=' + p.id)).json().catch(() => ({}));
  check('/api/place?id=' + p.id + ': жильё города для окошка на карте → ' + жильё,
        !!апи.жильё && апи.жильё.путь === жильё && /^Квартиры на сутки .+( — \d+ вариант(а|ов)?, обычно ~\d+ BYN)?$/.test(апи.жильё.подпись || ''), JSON.stringify(апи.жильё));
  if (гид) check('/mesto/' + p.id + ': «Что посмотреть» → ' + гид, ф.includes('href="' + гид + '">Что посмотреть '));
  else check('/mesto/' + p.id + ': «Что посмотреть» нет — у города нет такой страницы', !/href="\/chto-posmotret-/.test(ф));
}
// Страница места кэшируется на 10 минут: собранная до страницы города — без цифр. Хоть у одной они должны быть.
check('хотя бы у одного места в ссылке на город есть цифры (' + сЦифрами + ' из 4)', сЦифрами > 0);
{
  // Мирский замок: до Новогрудка и Несвижа почти 30 км — ни своей страницы города, ни «что посмотреть»
  const { код, html } = await стр('/mesto/2416');
  const ф = факты(html);
  check('/mesto/2416 (Мирский замок): ссылок на город нет — рядом нет города со страницей',
        код === 200 && !/Квартиры на сутки|Что посмотреть/.test(ф) && !блокЖилья(html), ф.slice(0, 200));
  const апи = await (await fetch(SITE + '/api/place?id=2416')).json().catch(() => ({}));
  check('/api/place?id=2416: жилья города для окошка нет', !апи.жильё, JSON.stringify(апи.жильё));
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
                   '/gorki', '/smorgon', '/rechica', '/bereza', '/minsk-zavodskoj',
                   '/dvuhkomnatnye', '/minsk-dvuhkomnatnye', '/mogilev-dvuhkomnatnye', '/grodno-dvuhkomnatnye',
                   // 11.10: районы Минска по карте, трёхкомнатные, цены, малые города второй волны
                   '/minsk-frunzenskij', '/minsk-partizanskij', '/minsk-moskovskij', '/trehkomnatnye', '/ceny-kvartir-na-sutki',
                   '/dzerzhinsk', '/smolevichi', '/ostrovec', '/luninec', '/kalinkovichi', '/lyuban', '/fanipol', '/rogachev',
                   '/oshmyany', '/stolin', '/osipovichi', '/ivacevichi', '/gancevichi', '/lepel',
                   // 11.10 (вечер): большие районные города
                   '/baranovichi-nedorogo', '/baranovichi-odnokomnatnye', '/bobruisk-nedorogo', '/pinsk-nedorogo',
                   '/lida-nedorogo', '/polotsk-nedorogo'])
    check(п + ' в карте сайта', карта.includes('https://nochy.by' + п + '</loc>'));
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
