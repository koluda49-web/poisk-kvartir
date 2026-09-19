// Новые точки 910038–910087: костёлы, усадьбы, камни, озёра со снимками Викисклада,
// и правильные названия двух точек справочника (Идолта, Поставы).
//
// Зачем. Точек сразу полсотни, вносились скриптом из проверенных данных —
// проверяем, что каждая дошла до карты и страницы места, стоит в Беларуси,
// с описанием, а снимок с Викисклада подписан лицензией (этого требуют
// CC BY и CC BY-SA). Ещё — что среди новых нет дублей и что поиск находит
// и новые места, и переименованные точки справочника. Без браузера.
//
// Сервер должен быть запущен. Третий аргумент — сайт, с которым сравнить
// общее число мест (по умолчанию рабочий): у нас их должно быть больше
// ровно на число новых.
//   node проверки/новые-места-belahrudka.mjs http://127.0.0.1:8241
//   node проверки/новые-места-belahrudka.mjs http://127.0.0.1:8241 https://poisk-kvartir.onrender.com

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const БАЗА = process.argv[3] || 'https://poisk-kvartir.onrender.com';
const ПЕРВЫЙ = 910038, ПОСЛЕДНИЙ = 910087;
const ЧИСЛО = ПОСЛЕДНИЙ - ПЕРВЫЙ + 1;   // 50

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const json = async (p, сайт = SITE) => (await fetch(сайт + p)).json();
const новый = id => id >= ПЕРВЫЙ && id <= ПОСЛЕДНИЙ;

// ── облегчённый список ──────────────────────────────────────────────────
console.log('=== /api/places?light=1 ===');
const lite = await json('/api/places?light=1');
const все = lite.items || [];
const новые = все.filter(p => новый(p.id));
check('в облегчённом списке все ' + ЧИСЛО + ' новых точек', новые.length === ЧИСЛО,
      'нашлось ' + новые.length + ', нет: ' + Array.from({ length: ЧИСЛО }, (_, i) => ПЕРВЫЙ + i).filter(id => !новые.some(p => p.id === id)).join(', '));
check('за новыми нет лишних id (' + (ПОСЛЕДНИЙ + 1) + '+ в диапазоне 910xxx)', !все.some(p => p.id > ПОСЛЕДНИЙ && p.id < 920000),
      все.filter(p => p.id > ПОСЛЕДНИЙ && p.id < 920000).map(p => p.id).join(', '));
const вне = новые.filter(p => !(p.lat >= 51.2 && p.lat <= 56.2 && p.lng >= 23.1 && p.lng <= 32.8));
check('все новые — в границах Беларуси', вне.length === 0, вне.map(p => p.id + ' ' + p.lat + ',' + p.lng).join('; '));
check('в облегчённом списке нет alt', все.every(p => p.alt === undefined));

// дубли: две новые точки одной категории ближе 50 м
const метры = (a, b) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const дубли = [];
for (let i = 0; i < новые.length; i++)
  for (let j = i + 1; j < новые.length; j++)
    if (новые[i].cat === новые[j].cat && метры(новые[i], новые[j]) < 50) дубли.push(новые[i].id + '/' + новые[j].id);
check('среди новых нет дублей (одна категория ближе 50 м)', дубли.length === 0, дубли.join('; '));

// общее число: у нас больше, чем на рабочем сайте, ровно на новые точки
// (если рабочий их уже получил — вычитаем их из его счёта)
try {
  const база = await json('/api/places?light=1', БАЗА);
  const уже = (база.items || []).filter(p => новый(p.id)).length;
  const ждём = база.total - уже + ЧИСЛО;
  check('всего мест ' + lite.total + ' = ' + (база.total - уже) + ' (' + БАЗА + ' без новых) + ' + ЧИСЛО,
        lite.total === ждём, 'ждали ' + ждём);
} catch (e) {
  check('общее число мест сравнивается с ' + БАЗА, false, e.message);
}

// ── описание и страница каждой точки ────────────────────────────────────
console.log('\n=== /api/place и /mesto ===');
const битые = [], безЛицензии = [], страницы = [];
for (let id = ПЕРВЫЙ; id <= ПОСЛЕДНИЙ; id++) {
  const д = await json('/api/place?id=' + id);
  if (!д.name || !String(д.text || '').trim()) битые.push(id + ' (нет name/text)');
  const pic = (д.pics || [])[0] || '';
  if (pic) {
    if (!/^https:\/\/(thumb|upload)\.wikimedia\.org\//.test(pic)) битые.push(id + ' (снимок не с Викисклада: ' + pic.slice(0, 60) + ')');
    if (!д.cred || !д.cred.lic || !д.cred.author) безЛицензии.push(id);
  }
  const с = await fetch(SITE + '/mesto/' + id);
  const h = await с.text();
  const имя = String(д.name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  if (с.status !== 200 || !(h.includes(д.name) || h.includes(имя))) страницы.push(id + ' (' + с.status + ')');
}
check('у каждой новой точки есть название и описание, снимок — с Викисклада', битые.length === 0, битые.join('; '));
check('у каждого снимка есть автор и лицензия (cred)', безЛицензии.length === 0, безЛицензии.join(', '));
check('/mesto/<id> — 200 и название на странице', страницы.length === 0, страницы.join('; '));

// ── поиск ───────────────────────────────────────────────────────────────
console.log('\n=== поиск ===');
async function найти(q) {
  const r = await json('/api/places?q=' + encodeURIComponent(q));
  return r.items || [];
}
for (const [q, id] of [['Белогруда', 910038], ['Гожа', 910039], ['Кася и Бася', null], ['Воротишин', null], ['Рудаково', null]]) {
  const r = await найти(q);
  const нашлось = r.filter(p => новый(p.id));
  check('«' + q + '» находит новую точку' + (id ? ' ' + id : ''), id ? нашлось.some(p => p.id === id) : нашлось.length > 0,
        r.slice(0, 3).map(p => p.id + ' ' + p.name).join('; '));
}
// слово есть только в alt (белорусское написание) — находится, но alt в ответ не уходит
const поAlt = await найти('Шчучын');
check('«Шчучын» (только в alt) находит дворец в Щучине, alt в ответе нет',
      поAlt.some(p => новый(p.id) && /Щучин/.test(p.name)) && поAlt.every(p => p.alt === undefined),
      поAlt.slice(0, 3).map(p => p.id + ' ' + p.name).join('; '));
const идолта = await найти('Идолта');
check('«Идолта» находит 4688 под новым названием',
      идолта.some(p => p.id === 4688 && p.name === 'Костёл Матери Божией Шкаплерной (Идолта)'),
      идолта.slice(0, 3).map(p => p.id + ' ' + p.name).join('; '));
const д4688 = await json('/api/place?id=4688');
check('4688: своё описание (модерн, 1937–1939)', д4688.name === 'Костёл Матери Божией Шкаплерной (Идолта)' && /1937–1939/.test(д4688.text || ''),
      (д4688.text || '').slice(0, 80));
const поставы = await найти('Постав');
check('«Постав» находит 4678 «Костёл Святого Антония Падуанского (Поставы)»',
      поставы.some(p => p.id === 4678 && p.name === 'Костёл Святого Антония Падуанского (Поставы)'),
      поставы.slice(0, 3).map(p => p.id + ' ' + p.name).join('; '));
const д4678 = await json('/api/place?id=4678');
check('4678: новое имя, снимки справочника на месте, text не undefined',
      д4678.name === 'Костёл Святого Антония Падуанского (Поставы)' && (д4678.pics || []).length > 0 && typeof д4678.text === 'string',
      JSON.stringify(д4678).slice(0, 160));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
