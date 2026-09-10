// Две доски объявлений: check-in.by и kvartirka.by.
//
// Зачем. Их каталоги лежат в памяти и обновляются в фоне, а не спрашиваются
// при каждом поиске — иначе на бесплатном тарифе человек ждал бы лишние
// секунды. У такой схемы своя цена: если фоновый сбор молча сломается,
// источник просто исчезнет из выдачи и никто этого не заметит. Проверка
// смотрит, что оба каталога живые, что объявления пригодны для карточки
// и что повторы между площадками склеены.
//
// Сервер должен быть уже запущен, и с его старта должно пройти около трёх
// минут — столько идёт первый сбор каталогов.
//   node проверки/доски.mjs
//   node проверки/доски.mjs https://poisk-kvartir.onrender.com

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
let failed = 0, passed = 0;
const check = (n, ok, d) => ok
  ? (passed++, console.log('  OK   ' + n))
  : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

const дай = async q => (await (await fetch(SITE + '/api/search?' + q)).json());

const ПЛОЩАДКИ = [
  ['checkin',   'CheckIn',   'check-in.by',   200],
  ['kvartirka', 'Kvartirka', 'kvartirka.by',  200],
];

for (const [ключ, метка, домен, минимум] of ПЛОЩАДКИ) {
  console.log('\n=== ' + домен + ' ===');
  const d = await дай('region=any&type=any&source=' + ключ);
  const it = d.items || [];
  check('каталог не пуст', it.length >= минимум, 'объявлений ' + it.length);
  if (!it.length) continue;

  check('все объявления с этой площадки', it.every(x => x.src === метка));
  check('у всех есть цена', it.every(x => x.price > 0));
  check('все ссылки ведут на ' + домен, it.every(x => (x.link || '').includes(домен)),
    (it.find(x => !(x.link || '').includes(домен)) || {}).link);
  check('у всех есть координаты', it.filter(x => x.lat && x.lng).length / it.length > 0.9,
    'без координат ' + it.filter(x => !x.lat).length);
  check('координаты в пределах Беларуси',
    it.filter(x => x.lat).every(x => x.lat > 51 && x.lat < 57 && x.lng > 23 && x.lng < 33));
  check('у большинства есть фотографии', it.filter(x => x.photos && x.photos.length).length / it.length > 0.8,
    'без фото ' + it.filter(x => !(x.photos || []).length).length);
  check('в карточке написан адрес', it.filter(x => (x.title || '').length > 6).length / it.length > 0.9);
  check('телефон хозяина есть', it.filter(x => x.phone).length / it.length > 0.8,
    'без телефона ' + it.filter(x => !x.phone).length);

  // Фильтры отбирают из памяти — если отбор сломается, это видно сразу.
  const дёшево = await дай('region=any&type=any&source=' + ключ + '&max=60');
  check('фильтр «до 60 рублей» работает',
    (дёшево.items || []).length > 0 && (дёшево.items || []).every(x => x.price <= 60));
  const однушки = await дай('region=any&type=any&rooms=1&source=' + ключ);
  check('фильтр по комнатам работает',
    (однушки.items || []).length > 0 && (однушки.items || []).every(x => +x.rooms === 1));
  const минск = await дай('region=minsk&type=any&source=' + ключ);
  check('область Минск отбирается',
    (минск.items || []).length > 0 && (минск.items || []).every(x => /минск/i.test(x.area || '')));
  check('в области меньше, чем по стране', (минск.items || []).length < it.length);
}

// ── Повторы между площадками ─────────────────────────────────────────────
console.log('\n=== повторы между площадками ===');
const всё = await дай('region=minsk&type=any');
const items = всё.items || [];
check('в общей выдаче есть все пять источников',
  new Set(items.map(x => x.src)).size >= 5, [...new Set(items.map(x => x.src))].join(','));

// Одно и то же жильё не должно остаться дважды: тот же телефон и тот же дом.
function домКлюч(x) {
  const t = ((x.title || '') + ' ' + (x.area || '')).toLowerCase().replace(/ё/g, 'е')
    .replace(/[^а-я0-9]+/g, ' ');
  const слова = (t.match(/[а-я]{5,}/g) || []).filter(w => w !== 'минск');
  const дом = (t.match(/\b\d{1,4}\b/) || [])[0] || '';
  return слова.length && дом ? (слова[0] + '|' + дом) : '';
}
// Тот же телефон и тот же дом — ещё не повтор: у хозяина бывает несколько
// квартир в одном подъезде. Повтором считаем только когда сходится ещё
// и комнатность, — именно это правило и стоит на сервере.
const пары = new Map();
let повторов = 0;
items.forEach(x => {
  const k = домКлюч(x), t = String(x.phone || '').replace(/\D/g, '');
  if (!k || t.length !== 12) return;
  const ключ = t + '@' + k;
  if (!пары.has(ключ)) пары.set(ключ, []);
  пары.get(ключ).push(x);
});
const повторные = [];
for (const g of пары.values()) {
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    if (g[i].src === g[j].src) continue;
    if (g[i].rooms && g[j].rooms && +g[i].rooms !== +g[j].rooms) continue;
    повторов++;
    if (повторные.length < 4) повторные.push(g[i].src + ' / ' + g[j].src + ': ' + (g[i].title || ''));
  }
}
check('одно и то же жильё не показано дважды', повторов === 0,
  'повторов ' + повторов + (повторные.length ? ('; ' + повторные.join(' | ')) : ''));

// ── Выключатель ──────────────────────────────────────────────────────────
console.log('\n=== выключатель ===');
const ключСтат = process.argv[3] || 'poisk2026';
if (/127\.0\.0\.1|localhost/.test(SITE)) {
  await fetch(SITE + '/istochnik?key=' + ключСтат + '&checkin=off');
  const без = await дай('region=minsk&type=any');
  check('выключенный check-in пропадает из выдачи',
    !(без.items || []).some(x => x.src === 'CheckIn'));
  await fetch(SITE + '/istochnik?key=' + ключСтат + '&checkin=on');
  const снова = await дай('region=minsk&type=any');
  check('и возвращается', (снова.items || []).some(x => x.src === 'CheckIn'));
} else {
  console.log('  — выключатель проверяем только на своей машине');
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
