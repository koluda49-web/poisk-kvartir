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

// ── Цена «от» у усадеб ───────────────────────────────────────────────────
// В усадьбе несколько домиков, и в объявлении написано «от 280 рублей».
// Показывать это как точную цену нельзя. Заодно ловим старую беду: цену
// с человека, которая стоит в карточке рядом, и неразрывный пробел
// в тысячах — из-за него «от 1 800» когда-то читалось как 88.
console.log('\n=== цена «от» ===');
{
  const kv = (await дай('region=any&type=any&source=kvartirka')).items || [];
  const усадьбы = kv.filter(x => /usadby/.test(x.link || ''));
  check('усадьбы kvartirka есть', усадьбы.length > 100, 'их ' + усадьбы.length);
  check('у усадеб цена помечена «от»', усадьбы.length > 0 && усадьбы.every(x => x.от === true),
    'без пометки: ' + усадьбы.filter(x => !x.от).length);
  check('у квартир пометки «от» нет',
    kv.filter(x => !/usadby/.test(x.link || '')).every(x => !x.от));
  check('дорогие усадьбы не превратились в дешёвые',
    усадьбы.some(x => x.price >= 800), 'самая дорогая: ' + Math.max(...усадьбы.map(x => x.price)));
  check('нет цен ниже разумного', kv.filter(x => x.price < 20).length === 0,
    'дешевле 20 рублей: ' + kv.filter(x => x.price < 20).length);
}

// ── Цена за человека ─────────────────────────────────────────────────────
// Владелец решил не показывать объявления, где цена указана с человека:
// в выдаче «дом за 35 рублей» на деле стоит 35 с каждого. Правило берём
// прямо из кода сервера — проверяем ровно то, что там написано.
console.log('\n=== цена за человека ===');
{
  const { readFileSync } = await import('node:fs');
  const код = readFileSync(new URL('../kvartiry-server.js', import.meta.url), 'utf8');
  const строка = код.split('\n').find(x => x.startsWith('const ЦЕНА_ЗА_ЧЕЛОВЕКА = '));
  check('правило есть в коде', !!строка);
  if (строка) {
    const R = eval(строка.replace('const ЦЕНА_ЗА_ЧЕЛОВЕКА = ', '').replace(/;\s*$/, ''));
    const ловить = ['Стоимость за 1чел/сут, также сдаем', 'Цена за человека в сутки', '25 руб/чел',
                    'цена за место в комнате', '30 р. с человека', '40 BYN с чел.', 'за одного гостя'];
    const неТрогать = ['Дом до 6 человек, баня', 'вместимость 8 человек', 'Рядом озеро, для 4 гостей',
                       'за чистотой следим', 'Сдаётся с 1 сентября', 'с человеком договоримся о заезде',
                       'Мядель, ул. Челюскинцев 5'];
    const мимо = ловить.filter(t => !R.test(t));
    const зря = неТрогать.filter(t => R.test(t));
    check('ловит цену за человека', мимо.length === 0, 'пропустил: ' + мимо.join(' | '));
    check('не трогает обычные объявления', зря.length === 0, 'зря поймал: ' + зря.join(' | '));
  }
}

// ── Повторы между площадками ─────────────────────────────────────────────
console.log('\n=== повторы между площадками ===');
const всё = await дай('region=minsk&type=any');
const items = всё.items || [];
check('в общей выдаче есть все пять источников',
  new Set(items.map(x => x.src)).size >= 5, [...new Set(items.map(x => x.src))].join(','));

// Ни одно объявление не должно пропадать из общей выдачи.
//
// Склейку «тот же телефон, тот же дом, те же комнаты» пробовали и убрали:
// по фотографиям одинаковым жильём оказалась меньше половины таких пар,
// остальное — соседние квартиры одного агентства и домики одной усадьбы.
// Склейка прятала настоящие объявления. Эта проверка не даст вернуть её
// незаметно: всё, что отдаёт каждая площадка по отдельности, обязано
// оказаться и в общей выдаче.
{
  const общие = new Set(items.map(x => x.link));
  const пропавшие = [];
  for (const ключ of ['kufar', 'realt', 'flatbook', 'checkin', 'kvartirka']) {
    const своё = (await дай('region=minsk&type=any&source=' + ключ)).items || [];
    своё.forEach(x => { if (!общие.has(x.link)) пропавшие.push(ключ + ': ' + (x.title || '').slice(0, 40)); });
  }
  check('из общей выдачи не пропало ни одного объявления', пропавшие.length === 0,
    'пропало ' + пропавшие.length + (пропавшие.length ? ('; ' + пропавшие.slice(0, 3).join(' | ')) : ''));
}

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
