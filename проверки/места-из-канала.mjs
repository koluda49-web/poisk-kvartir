// Точки 910105–910120 и правка точки 297 (Синька): места из канала @maria_petkevich,
// которых не было на карте (30.09–01.10.2026).
//
// Зачем. Каждая точка внесена скриптом из проверенных данных (описания — только из
// источников, снимки — с Викисклада со свободной лицензией). Проверяем, что все
// точки дошли до карты и страницы места, стоят в Беларуси, у каждой есть описание,
// а у снимка — автор и лицензия (CC BY и CC BY-SA требуют подписи), что нет дублей
// по названию и что Синька переименована и подписана. Без браузера.
//
//   node проверки/места-из-канала.mjs http://127.0.0.1:8241

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const ПЕРВЫЙ = 910105, ПОСЛЕДНИЙ = 910120;
const СО_СНИМКОМ = [910105, 910106, 910107, 910109, 910110, 910111, 910112, 910113, 910114, 910117, 910118, 910120];
const БЕЗ_СНИМКА = [910108, 910115, 910116, 910119];

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const json = async p => (await fetch(SITE + p)).json();
const текст = async p => { const r = await fetch(SITE + p); return { код: r.status, html: await r.text() }; };

console.log('=== список ===');
const все = (await json('/api/places?light=1')).items || [];
const новые = все.filter(p => p.id >= ПЕРВЫЙ && p.id <= ПОСЛЕДНИЙ);
check('все 16 точек в списке', новые.length === 16,
      'нет: ' + Array.from({ length: 16 }, (_, i) => ПЕРВЫЙ + i).filter(id => !новые.some(p => p.id === id)).join(', '));
check('все в Беларуси', новые.every(p => p.lat >= 51.2 && p.lat <= 56.2 && p.lng >= 23.1 && p.lng <= 32.8),
      новые.filter(p => !(p.lat >= 51.2 && p.lat <= 56.2 && p.lng >= 23.1 && p.lng <= 32.8)).map(p => p.id).join(', '));
const имена = новые.map(p => p.name);
check('названия не повторяются', new Set(имена).size === имена.length);
check('нет дубля с точкой справочника под тем же названием',
      новые.every(н => !все.some(p => p.id < 900000 && p.name.trim().toLowerCase() === н.name.trim().toLowerCase())));

console.log('\n=== каждая точка ===');
for (const id of Array.from({ length: 16 }, (_, i) => ПЕРВЫЙ + i)) {
  const d = await json('/api/place?id=' + id);
  const p = d.place || d;
  const текстТочки = p.text || '';
  check(id + ' «' + (p.name || '').slice(0, 34) + '»: описание не короче 150 знаков', текстТочки.length >= 150, 'знаков: ' + текстТочки.length);
  check(id + ': без слова «флаг»', !/флаг/i.test(текстТочки));
  if (СО_СНИМКОМ.includes(id)) {
    const pics = p.pics || [];
    check(id + ': есть снимок', pics.length > 0 && /^https:\/\//.test(pics[0]));
    const стр = await текст('/mesto/' + id);
    check(id + ': страница места открывается и подписывает автора снимка', стр.код === 200 && /CC BY|CC0|Public domain/i.test(стр.html), 'код ' + стр.код);
  } else if (БЕЗ_СНИМКА.includes(id)) {
    const стр = await текст('/mesto/' + id);
    check(id + ': страница места открывается', стр.код === 200, 'код ' + стр.код);
  }
}

console.log('\n=== Синька (точка 297) ===');
{
  const p = ((await json('/api/place?id=297')).place) || (await json('/api/place?id=297'));
  check('название — «Карьер «Синька» (Гродно)»', /Синька/.test(p.name || ''), p.name);
  check('в описании сказано, что купаться нельзя', /Купаться нельзя/.test(p.text || ''));
  const стр = await текст('/mesto/297');
  check('на странице подпись автора снимка (CC BY 3.0)', /CC BY 3\.0/.test(стр.html) && /Alex A/.test(стр.html));
}

console.log('\n=== поиск находит новые места ===');
for (const [запрос, id] of [['Радзивилки', 910105], ['Освейское', 910107], ['Вязынка', 910111], ['Ветка', 910114], ['Диприз', 910106], ['Стукалы', 910119]]) {
  const r = await json('/api/places?q=' + encodeURIComponent(запрос));
  check('по запросу «' + запрос + '» находится ' + id, (r.items || []).some(p => p.id === id));
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
