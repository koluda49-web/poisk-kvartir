// Страницы спроса, на которые ведут кнопки главной, не отвечают 404.
//
// Зачем. Кнопки «Дома на Новый год →», «Корпоратив в Бресте →» вшиты в
// разметку главной и не знают, сколько сейчас вариантов. Раньше страница
// спроса с меньше чем пятью вариантами отдавала 404 — и кнопка на нашей же
// главной вела в никуда (у корпоратива в Бресте 02.10.2026 было 6–12 домов,
// на грани). Теперь: мало вариантов — показываем всё, что есть, с честной
// фразой и кнопкой полного поиска; ни одного — страница с пояснением,
// закрытая от поиска (её проверяет пустые-страницы.mjs). Мало вариантов, но
// площадки ответили не все — фраза «часть площадок не ответила», noindex и
// no-cache. Прочие страницы спроса — как раньше: меньше пяти — 404.
//
// Сервер должен быть запущен. Часть про «мало вариантов» требует DATA_TEST=1
// (служебный вход /api/_empty-test?slug=…&limit=n оставляет не больше n
// вариантов); без него эти пункты пропускаются с пометкой.
//   node проверки/страницы-с-главной.mjs http://127.0.0.1:9678
const SITE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));
const открыть = async путь => { const r = await fetch(SITE + путь, { signal: AbortSignal.timeout(120000) }); return { код: r.status, html: await r.text(), r }; };
const карточек = html => html.split('<article class="c">').length - 1;

console.log('\n=== все кнопки главной ведут на живые страницы ===');
const главная = (await открыть('/')).html;
const адреса = [...new Set([...главная.matchAll(/class="preset preset-go" href="\/([a-z0-9-]+)"/g)].map(м => м[1]))];
check('на главной есть кнопки подборок (' + адреса.length + ')', адреса.length >= 5, адреса.join(', '));
for (const slug of адреса) {
  const { код } = await открыть('/' + slug);
  check('/' + slug + ' открывается (код ' + код + ')', код === 200, 'код ' + код);
}

console.log('\n=== вариантов меньше пяти ===');
const slug = 'novogodnij-korporativ-brest';
const предел = async (s, n, ещё = '') => {
  try {
    const r = await fetch(SITE + '/api/_empty-test?slug=' + s + '&limit=' + n + ещё, { method: 'POST' });
    return r.ok && !!(await r.json()).pid;
  } catch { return false; }
};
if (!(await предел(slug, 2))) {
  console.log('  (сервер без DATA_TEST=1 — пункты про малое число вариантов пропущены)');
} else {
  try {
    const { код, html, r } = await открыть('/' + slug);
    check('/' + slug + ' с двумя вариантами — 200', код === 200, 'код ' + код);
    check('  показаны оба варианта', карточек(html) === 2, 'карточек ' + карточек(html));
    check('  честная фраза «всего 2 варианта»', /подходит всего 2 варианта — показываем всё, что нашлось/.test(html));
    check('  кнопка полного поиска', html.includes('<a class="cta" href="/?region=brest&type=cottage">'));
    check('  страница открыта для поиска (не noindex)', !/noindex/.test(html) && !/noindex/.test(r.headers.get('x-robots-tag') || ''));
    const пометки = await (await fetch(SITE + '/api/_empty-test')).json();
    check('  не помечена пустой', !(slug in пометки.пометки), JSON.stringify(пометки.пометки));
    const карта = await (await fetch(SITE + '/sitemap.xml')).text();
    check('  осталась в sitemap', карта.includes('/' + slug + '</loc>'));

    // Те же два варианта, но площадки ответили не все: «подходит всего 2»
    // было бы неправдой — список просто не дособран. Страница честно об этом
    // говорит и на это время закрыта от поиска и от кэша.
    if (await предел(slug, 2, '&polnyj=0')) {
      const н = await открыть('/' + slug);
      check('/' + slug + ' с двумя вариантами при неполном ответе площадок — 200', н.код === 200, 'код ' + н.код);
      check('  показаны оба варианта', карточек(н.html) === 2, 'карточек ' + карточек(н.html));
      check('  фраза «часть площадок не ответила», а не «подходит всего 2»',
            /Часть площадок сейчас не ответила — показываем, что успело прийти/.test(н.html) && !/подходит всего/.test(н.html));
      check('  кнопка полного поиска', н.html.includes('<a class="cta" href="/?region=brest&type=cottage">'));
      check('  закрыта от поиска: noindex и в метатеге, и в заголовке',
            /<meta name="robots" content="noindex/.test(н.html) && /noindex/.test(н.r.headers.get('x-robots-tag') || ''));
      check('  без canonical и без «index,follow»', !/rel="canonical"/.test(н.html) && !/content="index,follow"/.test(н.html));
      check('  не кэшируется (no-cache)', /no-cache/.test(н.r.headers.get('cache-control') || ''), н.r.headers.get('cache-control'));
      await предел(slug, 2);   // площадки снова «ответили все»
      const п = await открыть('/' + slug);
      check('  ответили все — снова «подходит всего 2» и открыта для поиска',
            /подходит всего 2 варианта/.test(п.html) && !/noindex/.test(п.html) && !/noindex/.test(п.r.headers.get('x-robots-tag') || ''));
    }

    // прочие страницы спроса — как раньше
    const другая = 'minsk-odnokomnatnye';
    if (await предел(другая, 2)) {
      const о = await открыть('/' + другая);
      check('/' + другая + ' (не с главной) с двумя вариантами — по-прежнему 404', о.код === 404, 'код ' + о.код);
    }
  } finally {
    await предел(slug, -1);
    await предел('minsk-odnokomnatnye', -1);
  }
  // предел снят — страница как обычно
  const { код, html } = await открыть('/' + slug);
  check('после снятия предела /' + slug + ' снова полная', код === 200 && !/показываем всё, что нашлось/.test(html), 'код ' + код + ', карточек ' + карточек(html));
  await открыть('/minsk-odnokomnatnye');   // снять пометку «пустая», если её поставили
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
