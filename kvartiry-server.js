// Поиск жилья на сутки — Kufar + Realt + Flatbook по Беларуси и 101Hotels по России.
// Квартиры / коттеджи / усадьбы.
// Запуск: node kvartiry-server.js  ->  http://localhost:8080  (или двойной клик "Открыть поиск.bat")
// На Render порт берётся из переменной окружения PORT.

const http = require('http');
const crypto = require('crypto');
const PORT = process.env.PORT || 8080;   // Render задаёт свой порт через переменную окружения
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
// Срок ожидания для всех запросов наружу. Без него одно зависшее соединение
// оставляет запрос «в полёте» навсегда: все, кто спросит то же самое, будут
// ждать его до перезапуска сервера.
const WAIT = 15000;
const ждём = (extra) => Object.assign({ signal: AbortSignal.timeout(WAIT) }, extra || {});
const SITE_URL = 'https://poisk-kvartir.onrender.com';

// ── Своя статистика посещений (без Метрики/Analytics) ──────────────────────
// События копятся в памяти и раз в 30 секунд сбрасываются в файл рядом с сервером.
// ВАЖНО: на бесплатном Render диск временный — при передеплое и перезапуске файл теряется.
const fs = require('fs');
const STATS_FILE = process.env.STATS_FILE || (__dirname + '/stats-data.json');
const STATS_KEY  = process.env.STATS_KEY  || 'poisk2026';   // страница /stats?key=…
const STATS_MAX  = 60000;                                   // сколько событий держим в памяти
let STATS = [], statsDirty = false;
const ЗАПУЩЕН = Date.now();
// Самый долгий перерыв между входящими запросами. По нему видно, будит ли
// сайт внешний пингер: если перерыв дорастал до пятнадцати минут, Render
// успевал усыпить сервис, и первый зашедший ждал полминуты.
let ПОСЛЕДНИЙ_ЗАПРОС = Date.now();
let ДОЛЬШЕ_ВСЕГО_МОЛЧАЛИ = 0;
let ЗАПРОСОВ = 0;
function отметитьЗапрос(){
  const т = Date.now();
  const пауза = т - ПОСЛЕДНИЙ_ЗАПРОС;
  if(пауза > ДОЛЬШЕ_ВСЕГО_МОЛЧАЛИ) ДОЛЬШЕ_ВСЕГО_МОЛЧАЛИ = пауза;
  ПОСЛЕДНИЙ_ЗАПРОС = т;
  ЗАПРОСОВ++;
}
function уптайм(){
  const м = Math.round((Date.now() - ЗАПУЩЕН) / 60000);
  if(м < 60) return м + ' мин';
  const ч = Math.floor(м / 60);
  return ч + ' ч ' + (м % 60) + ' мин';
}

try{
  STATS = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  if(!Array.isArray(STATS)) STATS = [];
  console.log('Статистика: загружено событий — ' + STATS.length);
}catch(e){ STATS = []; }

function statsSave(){
  if(!statsDirty) return;
  statsDirty = false;
  try{ fs.writeFileSync(STATS_FILE, JSON.stringify(STATS)); }
  catch(e){ console.log('Статистика: не записалась —', e.message); }
}
setInterval(statsSave, 30000).unref();
['SIGTERM','SIGINT'].forEach(function(sig){ process.on(sig, function(){ statsSave(); process.exit(0); }); });

function statsAdd(ev){
  STATS.push(ev);
  if(STATS.length > STATS_MAX) STATS.splice(0, STATS.length - STATS_MAX);
  statsDirty = true;
}

// откуда пришёл человек — приводим к понятному названию
// Роботы соцсетей заходят строить превью ссылки, когда её куда-то вставили.
// Внешне это выглядит как переход живого человека, хотя человека не было.
// Считать их вместе с людьми — значит обманывать себя.
const BOTS = [
  [/facebookexternalhit|facebookcatalog|meta-externalagent/i, 'Facebook — робот превью'],
  [/instagramexternalhit/i,                'Instagram — робот превью'],
  [/TelegramBot/i,                         'Telegram — робот превью'],
  [/WhatsApp/i,                            'WhatsApp — робот превью'],
  [/Twitterbot/i,                          'Twitter — робот превью'],
  [/vkShare|VKRobot/i,                     'ВКонтакте — робот превью'],
  [/Slackbot|Discordbot|SkypeUriPreview/i, 'мессенджер — робот превью'],
  [/Googlebot|Google-InspectionTool/i,     'Googlebot'],
  [/YandexBot|YandexRenderResourcesBot/i,  'робот Яндекса'],
  [/bingbot|AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|DataForSeoBot|GPTBot|ClaudeBot/i, 'поисковый робот'],
  [/HeadlessChrome|python-requests|curl\/|Go-http-client|node-fetch|Java\//i, 'автоматика'],
];
function botOf(ua){
  for(let i=0;i<BOTS.length;i++) if(BOTS[i][0].test(ua)) return BOTS[i][1];
  return '';
}

// Встроенный браузер приложения: человек не набирал адрес, а ткнул в ссылку
// прямо в ленте или в переписке. Это самый честный признак живого перехода.
function appOf(ua){
  if(/FBAN|FBAV|FB_IAB/i.test(ua))                    return 'из приложения Facebook';
  if(/Instagram/i.test(ua))                           return 'из приложения Instagram';
  if(/TikTok|BytedanceWebview|musical_ly|Bytedance/i.test(ua)) return 'из приложения TikTok';
  if(/Telegram/i.test(ua))                            return 'из Telegram';
  if(/\bVK\b|VKAndroidApp/i.test(ua))                 return 'из ВКонтакте';
  return '';
}

// Точный адрес источника: 'l.facebook.com' вместо просто 'Facebook'.
// Без него нельзя понять, откуда именно пришёл человек — из ленты, из личных
// сообщений или это вообще робот соцсети зашёл строить превью ссылки.
function refRaw(r){
  try{ return new URL(String(r)).hostname.replace(/^www\./,'').slice(0,60); }
  catch(e){ return ''; }
}
function refHost(r){
  try{
    if(!r) return 'прямой заход';
    const h = new URL(String(r)).hostname.replace(/^www\./,'');
    if(/tiktok/i.test(h))            return 'TikTok';
    if(/instagram/i.test(h))         return 'Instagram';
    if(/t\.me|telegram/i.test(h))    return 'Telegram';
    if(/vk\.com/i.test(h))           return 'ВКонтакте';
    if(/google/i.test(h))            return 'Google';
    if(/yandex|ya\.ru/i.test(h))     return 'Яндекс';
    if(/facebook|fb\.com/i.test(h))  return 'Facebook';
    if(h.indexOf('poisk-kvartir') >= 0) return 'внутри сайта';
    return h.slice(0,40);
  }catch(e){ return 'прямой заход'; }
}

// из тела запроса берём только заранее разрешённые поля
const T_FIELDS = ['n','w','ttfb','load','sec','scroll','total','auto','c','region','city','type','rooms','max','host','from'];
function statsFields(o){
  const out = {};
  for(const k of T_FIELDS){
    const v = o[k];
    if(v === undefined || v === null || v === '') continue;
    out[k] = (typeof v === 'number') ? v : String(v).slice(0,40);
  }
  return out;
}

// ── страница /stats ────────────────────────────────────────────────────────
const DAY_MS = 86400000;

// Служебные коды в отчёте читать невозможно: «— · flat» ничего не говорит.
const TYPE_RU = { flat:'Квартира', cottage:'Коттедж / дом', usadba:'Усадьба' };
// Названия областей берём в момент вызова: сам список объявлен ниже по файлу,
// и обратиться к нему на этапе загрузки нельзя.
function regionRu(key){
  return (typeof REGIONS !== 'undefined' && REGIONS[key]) ? REGIONS[key].oblast : (key || '');
}
// Названия событий по-русски: журнал читаем глазами, а не грепом.
const EV_RU = {
  view:          'зашёл на сайт',
  end:           'ушёл с сайта',
  search:        'поиск жилья',
  places:        'смотрел места',
  places_near:   'места рядом с жильём',
  stay_near:     'жильё рядом с местом',
  all_stay:      'перешёл к жилью области',
  open:          'открыл объявление',
  call:          'нажал на телефон',
  share:         'поделился ссылкой',
  fav:           'добавил в избранное',
  favlist:       'открыл избранное',
  map:           'открыл карту',
  subscribe:     'ждёт уведомлений о жилье',
  place_suggest: 'хочет предложить точку',
};
function evRu(e){ return EV_RU[e] || e; }

function searchLabel(p){
  if(!p) return '';
  if(p.c === 'ru') return 'Россия · ' + (p.city || '') + (p.type ? (' · ' + ((typeof RF_TYPES !== 'undefined' && RF_TYPES[p.type]) || p.type)) : '');
  const city = (p.city && p.city !== '—') ? p.city : regionRu(p.region);
  const type = TYPE_RU[p.type] || p.type || '';
  const rooms = (p.rooms && p.rooms !== 'любое') ? (' · ' + p.rooms + '-комн') : '';
  const price = p.max ? (' · до ' + p.max + ' р.') : '';
  return [city, type].filter(Boolean).join(' · ') + rooms + price;
}

function statsPage(){
  const now = Date.now();
  const esc = function(t){ return String(t).replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); };
  const since = function(ms){ return STATS.filter(function(x){ return now - x.t <= ms; }); };
  const uniq  = function(a){ return new Set(a.map(function(x){ return x.v; })).size; };
  const only  = function(a, e){ return a.filter(function(x){ return x.e === e; }); };

  // Везде, где считаем посетителей, роботов исключаем — иначе цифры врут.
  const human = function(a){ return a.filter(function(x){ return !x.bot; }); };
  const dayA = human(since(DAY_MS)), weekA = human(since(7*DAY_MS));
  const botsWeek = since(7*DAY_MS).filter(function(x){ return x.bot; });
  const humanAll = human(STATS);
  const first = STATS.length ? new Date(STATS[0].t) : null;

  function top(arr, fn, limit){
    const m = new Map();
    for(const x of arr){
      const k = fn(x);
      if(k === undefined || k === null || k === '') continue;
      m.set(k, (m.get(k)||0)+1);
    }
    return [...m.entries()].sort(function(a,b){ return b[1]-a[1]; }).slice(0, limit || 10);
  }
  function bars(rows){
    if(!rows.length) return '<p class="none">пока пусто</p>';
    const max = rows[0][1];
    return '<table class="bars">' + rows.map(function(r){
      return '<tr><td class="k">' + esc(r[0]) + '</td><td class="b"><i style="width:' +
        Math.max(3, Math.round(r[1]/max*100)) + '%"></i></td><td class="n">' + r[1] + '</td></tr>';
    }).join('') + '</table>';
  }
  function tile(label, value, note){
    return '<div class="tile"><div class="lab">' + label + '</div><div class="val">' + value +
           '</div>' + (note ? '<div class="note">' + note + '</div>' : '') + '</div>';
  }
  const pct = function(a, b){ return b ? Math.round(a/b*100) + '%' : '—'; };
  function median(nums){
    if(!nums.length) return 0;
    const a = nums.slice().sort(function(x,y){ return x-y; });
    return a[Math.floor(a.length/2)];
  }
  const avg = function(arr){ return arr.length ? Math.round(arr.reduce(function(a,b){ return a+b; }, 0)/arr.length) : 0; };

  // воронка за 7 дней: считаем по сессиям (один визит = одна сессия)
  const sessView   = new Set(only(weekA,'view').map(function(x){ return x.s; }));
  const sessSearch = new Set(only(weekA,'search').filter(function(x){ return x.p && x.p.auto === 0; }).map(function(x){ return x.s; }));
  const sessGoal   = new Set(weekA.filter(function(x){ return x.e === 'open' || x.e === 'call'; }).map(function(x){ return x.s; }));
  const sessMap    = new Set(only(weekA,'map').map(function(x){ return x.s; }));

  // по дням
  const days = [];
  for(let i = 13; i >= 0; i--){
    const from = now - (i+1)*DAY_MS, to = now - i*DAY_MS;
    const a = human(STATS.filter(function(x){ return x.t > from && x.t <= to; }));
    days.push([ new Date(to - DAY_MS/2).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'}),
                only(a,'view').length, uniq(only(a,'view')) ]);
  }

  // скорость первой загрузки — та самая проблема со сном Render
  const loads  = only(weekA,'view').map(function(x){ return x.p && x.p.load; })
                   .filter(function(v){ return typeof v === 'number' && v > 0; });
  const slow5  = loads.filter(function(v){ return v >= 5000; }).length;
  const slow15 = loads.filter(function(v){ return v >= 15000; }).length;

  // вовлечённость
  const ends = only(weekA,'end');
  const secs = ends.map(function(x){ return x.p && x.p.sec; }).filter(function(v){ return typeof v === 'number'; });
  const scrl = ends.map(function(x){ return x.p && x.p.scroll; }).filter(function(v){ return typeof v === 'number'; });

  const last = STATS.slice(-40).reverse().map(function(x){
    const src = (x.bot ? ('🤖 ' + x.bot) : (x.r || ''))
              + (x.rh && !x.bot ? (' (' + x.rh + ')') : '')
              + (x.app ? (' · ' + x.app) : '');
    const info = (x.e === 'search') ? searchLabel(x.p) : JSON.stringify(x.p || {});
    return '<tr><td>' + new Date(x.t).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) +
      '</td><td>' + esc(evRu(x.e)) + '</td><td>' + esc(src) + '</td><td>' + esc(x.m || '') +
      '</td><td class="raw">' + esc(info)
      + (x.ref ? ('<br>ссылка: ' + esc(x.ref)) : '')
      + (x.ua ? ('<br>' + esc(x.ua)) : '') + '</td></tr>';
  }).join('');

  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><title>Статистика — Поиск жилья</title><style>' +
    'body{margin:0;background:#f4f5f7;color:#141821;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}' +
    '.wrap{max-width:900px;margin:0 auto;padding:20px 16px 60px}' +
    'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;color:#4a5160}' +
    '.sub{color:#8b93a3;font-size:13px;margin:0 0 18px}' +
    '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}' +
    '.tile{background:#fff;border:1px solid #e2e5ea;border-radius:14px;padding:14px}' +
    '.lab{font-size:12px;color:#8b93a3;text-transform:uppercase;letter-spacing:.03em}' +
    '.val{font-size:26px;font-weight:800;margin-top:2px}' +
    '.note{font-size:12px;color:#8b93a3;margin-top:2px}' +
    '.card{background:#fff;border:1px solid #e2e5ea;border-radius:14px;padding:14px 16px}' +
    'table{width:100%;border-collapse:collapse;font-size:14px}' +
    '.bars td{padding:3px 0}.bars .k{width:42%;color:#4a5160}.bars .n{width:52px;text-align:right;font-weight:700}' +
    '.bars .b i{display:block;height:10px;border-radius:6px;background:#9a3412}' +
    '.funnel div{margin:6px 0}.funnel b{font-size:18px}' +
    '.log td{border-top:1px solid #eef0f4;padding:5px 6px;vertical-align:top}' +
    '.log .raw{color:#8b93a3;font-size:12px;word-break:break-all}' +
    '.none{color:#8b93a3;font-size:14px;margin:4px 0}' +
    '.warn{background:#fff4ee;border:1px solid #ffd3bd;border-radius:12px;padding:12px 14px;font-size:14px;margin-top:10px}' +
    '</style></head><body><div class="wrap">' +
    '<h1>Статистика сайта</h1>' +
    '<p class="sub">Событий в памяти: ' + STATS.length +
      (first ? (' · с ' + first.toLocaleString('ru-RU')) : '') +
      ' · данные лежат в файле на сервере и теряются при передеплое</p>' +

    '<div class="tiles">' +
      tile('Заходов сегодня', only(dayA,'view').length, uniq(only(dayA,'view')) + ' чел.') +
      tile('Заходов за 7 дней', only(weekA,'view').length, uniq(only(weekA,'view')) + ' чел.') +
      tile('Всего заходов', only(humanAll,'view').length, uniq(only(humanAll,'view')) + ' чел.') +
      tile('Открыли объявление', weekA.filter(function(x){ return x.e==='open'||x.e==='call'; }).length, 'за 7 дней') +
    '</div>' +

    // Бесплатный Render усыпляет сайт после 15 минут без запросов, и первый
    // зашедший ждёт полминуты. По этой плитке видно, засыпает ли он: если
    // время работы почти всегда меньше 15 минут — значит да, и нужен
    // внешний пингер.
    '<h2>Сон сервера</h2><div class="card"><div class="tiles">' +
      tile('Работает без перерыва', уптайм(), 'с последнего запуска') +
      tile('Самый долгий перерыв', Math.round(ДОЛЬШЕ_ВСЕГО_МОЛЧАЛИ / 60000) + ' мин',
           'между запросами к сайту') +
      tile('Запросов с запуска', ЗАПРОСОВ, 'включая пинги и роботов') +
    '</div><p class="note">' +
      (ДОЛЬШЕ_ВСЕГО_МОЛЧАЛИ >= 14 * 60 * 1000
        ? 'Перерыв дорастал до пятнадцати минут — значит, сайт успевал заснуть, и внешний пингер до него не доходит. Проверьте монитор: он должен дёргать https://poisk-kvartir.onrender.com/ping не реже чем раз в 10 минут.'
        : (Date.now() - ЗАПУЩЕН < 20 * 60 * 1000
            ? 'Сайт запущен недавно — подождите полчаса, и по «самому долгому перерыву» станет видно, будит ли его пингер.'
            : 'Перерывы короче пятнадцати минут: кто-то регулярно дёргает сайт, засыпать он не должен.')) +
    '</p></div>' +

    '<h2>Путь посетителя за 7 дней</h2><div class="card funnel">' +
      '<div><b>' + sessView.size + '</b> зашли на сайт</div>' +
      '<div><b>' + sessSearch.size + '</b> сами запустили поиск — ' + pct(sessSearch.size, sessView.size) + '</div>' +
      '<div><b>' + sessMap.size + '</b> открыли карту — ' + pct(sessMap.size, sessView.size) + '</div>' +
      '<div><b>' + sessGoal.size + '</b> открыли объявление или позвонили — ' + pct(sessGoal.size, sessView.size) + '</div>' +
    '</div>' +

    '<h2>Откуда приходят (7 дней)</h2><div class="card">' +
      bars(top(only(weekA,'view'), function(x){ return x.r + (x.app ? (' · ' + x.app) : ''); }, 12)) +
      '<p class="none">Считаются только живые заходы. Роботы соцсетей — отдельным блоком ниже.</p></div>' +

    '<h2>Метки в ссылках (7 дней)</h2><div class="card">' +
      bars(top(only(weekA,'view').filter(function(x){ return x.p && x.p.from; }),
               function(x){ return x.p.from; }, 12)) +
      '<p class="none">Добавь к ссылке метку — и будет видно, какой ролик привёл людей: ' +
      SITE_URL + '/?from=tiktok-post1</p></div>' +

    '<h2>Роботы и предпросмотры (7 дней)</h2><div class="card">' +
      bars(top(only(botsWeek,'view'), function(x){ return x.bot; }, 12)) +
      '<p class="none">Это не люди. Так соцсети и мессенджеры строят картинку-превью, ' +
      'когда ссылку куда-то вставили, а поисковики — обходят сайт.</p></div>' +

    '<h2>Скорость первой загрузки (7 дней)</h2><div class="card">' +
      '<div class="tiles">' +
        tile('Обычно', (median(loads)/1000).toFixed(1) + ' с', 'медиана') +
        tile('Ждали дольше 5 с', slow5, pct(slow5, loads.length) + ' заходов') +
        tile('Ждали дольше 15 с', slow15, pct(slow15, loads.length) + ' заходов') +
      '</div>' +
      (slow15 ? '<div class="warn">Столько людей упёрлось в спящий сервер Render. Почти все такие заходы — потерянные.</div>' : '') +
    '</div>' +

    '<h2>Заходы по дням</h2><div class="card">' +
      bars(days.map(function(d){ return [d[0] + ' — ' + d[2] + ' чел.', d[1]]; })) + '</div>' +

    '<h2>Что искали (7 дней)</h2><div class="card">' +
      bars(top(only(weekA,'search').filter(function(x){ return x.p && x.p.auto === 0; }),
               function(x){ return searchLabel(x.p); }, 12)) +
    '</div>' +

    '<h2>Устройства и вовлечённость (7 дней)</h2><div class="card"><div class="tiles">' +
      tile('С телефона', only(weekA,'view').filter(function(x){ return x.m === 'моб.'; }).length, 'заходов') +
      tile('С компьютера', only(weekA,'view').filter(function(x){ return x.m === 'комп.'; }).length, 'заходов') +
      tile('Среднее время', avg(secs) + ' с', 'на сайте') +
      tile('Долистали до', avg(scrl) + '%', 'страницы') +
    '</div></div>' +

    '<h2>Чего ждут посетители (7 дней)</h2><div class="card"><div class="tiles">' +
      tile('Уведомления о жилье', weekA.filter(function(x){ return x.e === 'subscribe'; }).length,
           'нажали «Хочу такое»') +
      tile('Свои точки на карте', weekA.filter(function(x){ return x.e === 'place_suggest'; }).length,
           'нажали «Предложить точку»') +
    '</div><p class="note">Обе кнопки пока заглушки. Цифры показывают, что делать раньше.</p></div>' +

    '<h2>Последние события</h2><div class="card"><table class="log">' +
      '<tr><td><b>когда</b></td><td><b>что</b></td><td><b>откуда</b></td><td><b>устр.</b></td><td><b>подробности</b></td></tr>' +
      (last || '<tr><td colspan="5" class="none">пока пусто</td></tr>') +
    '</table></div>' +

    '</div></body></html>';
}

// адрес для обратной связи держим только в base64 (без открытого email в репозитории)

// Области: realt = слаг раздела, oblast = как пишет Kufar, main = главный город (для запроса Kufar)
const REGIONS = {
  'brest':    {realt:'brest-region',   oblast:'Брестская область',   main:'Брест',
    cities:['Брест','Барановичи','Пинск','Кобрин','Берёза','Лунинец','Пружаны','Ганцевичи','Иваново','Жабинка']},
  'minsk':    {realt:'minsk',          oblast:'Минск',               main:'Минск',
    cities:['Минск']},
  'minsk-obl':{realt:'minsk-region',   oblast:'Минская область',     main:'Минск',
    cities:['Минск','Борисов','Солигорск','Молодечно','Жодино','Слуцк','Дзержинск','Вилейка','Марьина Горка','Смолевичи','Логойск','Заславль','Червень']},
  'gomel':    {realt:'gomel-region',   oblast:'Гомельская область',  main:'Гомель',
    cities:['Гомель','Мозырь','Жлобин','Речица','Светлогорск','Калинковичи','Рогачёв','Добруш']},
  'grodno':   {realt:'grodno-region',  oblast:'Гродненская область', main:'Гродно',
    cities:['Гродно','Лида','Слоним','Волковыск','Новогрудок','Ошмяны','Сморгонь','Островец']},
  'vitebsk':  {realt:'vitebsk-region', oblast:'Витебская область',   main:'Витебск',
    cities:['Витебск','Орша','Полоцк','Новополоцк','Поставы','Глубокое','Браслав','Лепель']},
  'mogilev':  {realt:'mogilev-region', oblast:'Могилёвская область', main:'Могилёв',
    cities:['Могилёв','Бобруйск','Горки','Осиповичи','Кричев','Быхов','Климовичи','Шклов']}
};
const CITIES_MAP = Object.fromEntries(Object.entries(REGIONS).map(([k,v])=>[k, v.cities||[]]));

// Центры городов для карты. Kufar отдаёт точные координаты; Realt — нет,
// поэтому его точки ставим у центра города с небольшим разбросом (пометка "≈ по городу").
const TOWN_CENTERS = {
  'Брест':[52.0975,23.7340],'Барановичи':[53.1327,26.0139],'Пинск':[52.1211,26.0966],'Кобрин':[52.2130,24.3590],
  'Берёза':[52.5350,24.9780],'Лунинец':[52.2450,26.8020],'Пружаны':[52.5580,24.4570],'Ганцевичи':[52.7550,26.4360],
  'Иваново':[52.1440,25.5350],'Жабинка':[52.1990,24.0050],
  'Минск':[53.9020,27.5615],'Борисов':[54.2260,28.5050],'Солигорск':[52.7880,27.5420],'Молодечно':[54.3120,26.8490],
  'Жодино':[54.2980,28.0330],'Слуцк':[53.0270,27.5520],'Дзержинск':[53.6840,27.1440],'Вилейка':[54.4890,26.9190],
  'Марьина Горка':[53.5120,28.1470],'Смолевичи':[54.0280,28.0830],'Логойск':[54.2000,27.8500],'Заславль':[54.0030,27.2760],
  'Червень':[53.7106,28.4247],
  'Гомель':[52.4345,30.9754],'Мозырь':[52.0490,29.2450],'Жлобин':[52.8930,30.0240],'Речица':[52.3620,30.3940],
  'Светлогорск':[52.6330,29.7350],'Калинковичи':[52.1310,29.3290],'Рогачёв':[53.0890,30.0490],'Добруш':[52.4100,31.3190],
  'Гродно':[53.6690,23.8130],'Лида':[53.8880,25.2990],'Слоним':[53.0930,25.3190],'Волковыск':[53.1610,24.4570],
  'Новогрудок':[53.6000,25.8280],'Ошмяны':[54.4270,25.9360],'Сморгонь':[54.4800,26.3980],'Островец':[54.6120,25.9540],
  'Витебск':[55.1840,30.2020],'Орша':[54.5090,30.4250],'Полоцк':[55.4850,28.7860],'Новополоцк':[55.5320,28.6350],
  'Поставы':[55.1170,26.8370],'Глубокое':[55.1350,27.6900],'Браслав':[55.6400,27.0410],'Лепель':[54.8790,28.7000],
  'Могилёв':[53.8940,30.3310],'Бобруйск':[53.1450,29.2240],'Горки':[54.2830,30.9870],'Осиповичи':[53.2980,28.6400],
  'Кричев':[53.7080,31.7160],'Быхов':[53.5190,30.2490],'Климовичи':[53.6070,31.9600],'Шклов':[54.2100,30.2880]
};
function approxCoord(town, regMain, seed){
  const c = TOWN_CENTERS[town] || TOWN_CENTERS[regMain] || [53.70,27.95];
  const n = Math.abs(parseInt(String(seed).replace(/\D/g,'').slice(-6)) || 0);
  const dLat = (((n % 97) / 97) - 0.5) * 0.020;                 // ~±1.1 км
  const dLng = (((Math.floor(n / 97) % 97) / 97) - 0.5) * 0.032;
  return [ +(c[0] + dLat).toFixed(6), +(c[1] + dLng).toFixed(6) ];
}

// Типы: kw = слово для запроса Kufar, section = раздел Realt
// Kufar фильтра по типу не имеет — только текстовый поиск, поэтому тип
// приходится узнавать по заголовку объявления. Слова взяты из живых
// заголовков: «Усадьба», «агроусадьба», «коттедж», «дом на сутки».
const TYPE_RX = {
  'flat':    /квартир|апартамент|студи|комнат/i,
  'cottage': /коттедж|дом(?!ик\s*в\s*дерев)|дача|сруб|таунхаус/i,
  'usadba':  /усадьб|агроусадьб|база\s*отдыха|хутор/i
};

const TYPES = {
  'flat':    {kw:'квартира', section:'flat-for-day'},
  'cottage': {kw:'коттедж дом', section:'cottage-for-day'},
  'usadba':  {kw:'усадьба',  section:'cottage-for-day'}
};

// Удобства РБ. Общий набор, который есть у Kufar (подписи в ad_parameters) и Flatbook (apartment_comfort).
// rx — совпадение по тексту удобств Kufar; fb — точное значение apartment_comfort у Flatbook. Realt удобств в списке не отдаёт.
const RB_AMENITIES = [
  {key:'wifi',   label:'Wi-Fi',             rx:/wi-?fi/i,      fb:'Интернет Wi-Fi'},
  {key:'wash',   label:'Стиральная машина', rx:/стиральн/i,    fb:'Стиральная машина'},
  {key:'fridge', label:'Холодильник',       rx:/холодильник/i, fb:'Холодильник'},
  {key:'tv',     label:'Телевизор',         rx:/телевизор/i,   fb:'Телевизор'},
  {key:'micro',  label:'Микроволновка',     rx:/микроволнов/i, fb:'Микроволновая печь'},
  {key:'hair',   label:'Фен',               rx:/\bфен/i,       fb:'Фен'}
];
const RB_AMEN_BY_KEY = Object.fromEntries(RB_AMENITIES.map(a=>[a.key,a]));
const RB_AMEN_CHECKS = RB_AMENITIES.map(a=>'<label class="amen-item"><input type="checkbox" class="rb-amen-cb" value="'+a.key+'"> '+a.label+'</label>').join('');

// Список от Kufar зависит только от типа жилья и города запроса, а комнаты, цена
// и число гостей отсеиваются уже потом. Поэтому список кэшируем, а фильтры
// применяем к сохранённому — смена цены или комнат больше не идёт к источнику.
async function kufarRaw(reg, city, type){
  // Без выбранного города спрашиваем область целиком, а не её центр.
  // По запросу «Брест» Kufar отдаёт почти один Брест, по «Брестская область» —
  // ещё Барановичи, Пинск, Кобрин, Берёзу. Для «что посмотреть рядом» это
  // решает всё: у замка в глубинке ближайшее жильё как раз в райцентре.
  const where = city || reg.oblast;
  return cached('raw|kufar|'+type+'|'+where, async ()=>{
    const t = TYPES[type]||TYPES.flat;
    const url='https://api.kufar.by/search-api/v2/search/rendered-paginated?query='+encodeURIComponent(t.kw+' на сутки '+where)+'&size=200&lang=ru';
    const k = await (await fetch(url, ждём({headers:{'User-Agent':UA}}))).json();
    const g=(a,n)=>(a.ad_parameters||[]).find(y=>y.p===n);
    return (k.ads||[]).map(a=>{
      // координаты Kufar: параметр p="coordinates", v=[долгота, широта]
      let lat=null, lng=null, approx=true;
      const cp=g(a,'coordinates');
      if(cp && Array.isArray(cp.v) && cp.v.length>=2){
        const lo=+cp.v[0], la=+cp.v[1];
        if(la>50 && la<57 && lo>22 && lo<33){ lat=la; lng=lo; approx=false; }
      }
      const area = g(a,'area')?.vl||'';
      if(lat==null){ const c=approxCoord(area||where, reg.main, a.ad_id); lat=c[0]; lng=c[1]; approx=true; }
      const amenText = [].concat(g(a,'flat_improvement')?.vl||[], g(a,'flat_bath')?.vl||[], g(a,'flat_kitchen')?.vl||[]).join(' ');
      return { src:'Kufar',
        price:a.price_byn? a.price_byn/100 : null,
        rooms:+(g(a,'rooms')?.v||0),
        area, region: g(a,'region')?.vl||'',
        capacity: g(a,'house_rent_couchettes')?.vl||'',
        title:a.subject||'', amenText,
        photos: (a.images||[]).map(im=>'https://rms.kufar.by/v1/gallery/'+im.path),
        rating:0, reviews:0, descId:a.ad_id,
        phone:'', name:'', lat, lng, approx, link:a.ad_link||'' };
    }).filter(x=> x.price>0
        // отсечь прокат техники и услуги, которые цепляет запрос
        && !/прокат|пароочистит|пылесос|karcher|керхер|электроинструмент|генератор|виброплит|отбойн|перфоратор|\bдрель|бетоно|шлифов|аппарат|моющий|химчистк|фотозон|аренда авто|прицеп/i.test(x.title)
        // для домов/усадеб — только жильё (есть вместимость)
        && ( type==='flat' || (+x.capacity||0)>0 ) );
  });
}

// «Могилёвская» у нас и «Могилевская» у Kufar — одно и то же место.
// Сравнение строка в строку выбрасывало всю область целиком.
const сравнимо = t => String(t||'').toLowerCase().replace(/ё/g,'е').trim();

async function fromKufar(reg, city, type, rooms, maxP, guests, minP){
  try{
    const list = await kufarRaw(reg, city, type);
    return list.filter(x=>
         (city ? сравнимо(x.area).includes(сравнимо(city)) : сравнимо(x.region)===сравнимо(reg.oblast))
      && (!rooms||x.rooms==rooms) && (!maxP||x.price<=maxP) && (!minP||x.price>=minP)
      && (!guests|| (+x.capacity||0)>=guests));
  }catch(e){ console.error('Kufar:', e.message); return []; }
}

// Realt: у города Минск нет своего слага (minsk/minsk-region -> 404),
// его суточные квартиры лежат в глобальном /rent/<section>/. Остальные области — по слагу.
function realtBase(reg, section){
  const isMinsk = (reg.realt==='minsk' || reg.realt==='minsk-region');
  return isMinsk ? 'https://realt.by/rent/'+section+'/'
                 : 'https://realt.by/'+reg.realt+'/rent/'+section+'/';
}
function realtObjectLink(reg, section, code){
  const isMinsk = (reg.realt==='minsk' || reg.realt==='minsk-region');
  return isMinsk ? 'https://realt.by/rent-'+section+'/object/'+code+'/'
                 : 'https://realt.by/'+reg.realt+'/rent-'+section+'/object/'+code+'/';
}
function parseRealt(html){
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if(!m) return [];
  let res=null;
  (function f(o,d){ if(d>8||!o||typeof o!=='object') return;
    for(const k in o){ if(k==='results'&&Array.isArray(o[k])){res=o[k];return;} f(o[k],d+1); } })(JSON.parse(m[1]),0);
  return res||[];
}

// Точные координаты объекта Realt лежат на его странице:
// ...locationInfo.location = [долгота, широта]. В списке их нет — достаём по требованию.
const REALT_GEO = new Map();   // objectUrl -> [lat,lng] | null (кэш на время жизни инстанса)
function extractRealtLocation(html){
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if(!m) return null;
  let found=null;
  try{
    (function f(o,d){ if(found||d>13||!o||typeof o!=='object') return;
      for(const k in o){ const v=o[k];
        if(k==='location' && Array.isArray(v) && v.length>=2 && typeof v[0]==='number' && typeof v[1]==='number'){
          const a=v[0], b=v[1];
          if(b>50&&b<57&&a>22&&a<33){ found=[b,a]; return; }   // [lon,lat] -> [lat,lng]
          if(a>50&&a<57&&b>22&&b<33){ found=[a,b]; return; }   // на случай [lat,lon]
        }
        if(v && typeof v==='object') f(v,d+1);
      } })(JSON.parse(m[1]),0);
  }catch(e){}
  return found;
}
async function realtGeo(url){
  if(REALT_GEO.has(url)) return REALT_GEO.get(url);
  let loc=null;
  try{
    const h = await (await fetch(url, ждём({headers:{'User-Agent':UA}}))).text();
    loc = extractRealtLocation(h);
  }catch(e){ loc=null; }
  if(REALT_GEO.size>8000) REALT_GEO.clear();   // мягкий предел кэша
  REALT_GEO.set(url, loc);
  return loc;
}
// ограничение параллелизма, чтобы не завалить бесплатный инстанс
async function mapLimit(items, limit, fn){
  const res=new Array(items.length); let i=0;
  async function worker(){ while(i<items.length){ const idx=i++; res[idx]=await fn(items[idx],idx); } }
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)}, worker));
  return res;
}

// Галереи фото для Flatbook и 101hotels (в списочных данных фото одно) — тянем со страниц объектов, кэшируем.
const GALLERY = new Map();   // "src|key" -> { at, list }
// Найденную галерею держим до перезапуска: у объявления снимки не меняются.
// А вот пустой ответ — только минуту: скорее всего страница просто не
// ответила вовремя, и следующему посетителю стоит попробовать снова.
const GALLERY_EMPTY_TTL = 60 * 1000;
async function galleryFor(src, key){
  const ck = src+'|'+key;
  const was = GALLERY.get(ck);
  if(was && (was.list.length || Date.now() - was.at < GALLERY_EMPTY_TTL)) return was.list;
  let out=[];
  try{
    if(src==='Flatbook'){
      const h = await (await fetch(key, ждём({headers:{'User-Agent':UA,'Accept-Language':'ru'}}))).text();
      const set=new Set();
      // Имена файлов бывают и такие: 0-02-05-0559b976…_49.jpg — с дефисами.
      // Прежний разбор их не допускал, и у таких объявлений слайдер молча
      // пропадал. Домен тоже допускаем с приставкой: встречается test.flatbook.by.
      for(const m of h.matchAll(/https:\/\/[a-z0-9.-]*flatbook\.by\/media\/cache\/resolve\/flat_page_gallery\/images\/flat\/[0-9\/]+\/original\/[a-z0-9_.-]+\.(?:jpg|jpeg|png|webp)/gi)) set.add(m[0].replace('//test.', '//'));
      out=[...set].slice(0,20);
    } else if(src==='H101'){
      const at=key.indexOf('@@'); const hid=key.slice(0,at), pageUrl=key.slice(at+2);
      const h = await (await fetch(pageUrl, ждём({headers:{'User-Agent':UA,'Accept-Language':'ru'}}))).text();
      const set=new Set();
      const re=new RegExp('https://s\\.101hotelscdn\\.ru/uploads/image/hotel_image/'+hid.replace(/[^0-9]/g,'')+'/[0-9a-z_]+\\.(?:jpg|jpeg|png|webp)','gi');
      for(const m of h.matchAll(re)) set.add(m[0].replace(/_(thumb|preview|mobile_preview|mobile)\./,'.'));
      out=[...set].slice(0,20);
    }
  }catch(e){ out=[]; }
  if(GALLERY.size>6000) GALLERY.clear();
  GALLERY.set(ck, { at: Date.now(), list: out });
  return out;
}
// У Realt список зависит только от области и типа жилья — всё остальное отсеивается после.
async function realtRaw(reg, type){
  return cached('raw|realt|'+type+'|'+reg.realt, async ()=>{
    const t = TYPES[type]||TYPES.flat;
    const base = realtBase(reg, t.section);
    // тянем 1-ю страницу; для Минска её (до 180) достаточно, пагинацию делаем на клиенте
    const h = await (await fetch(base, ждём({headers:{'User-Agent':UA}}))).text();
    const res = parseRealt(h);
    return res.map(a=>{
      const town=a.townName||'';
      const c=approxCoord(town||reg.main, reg.main, a.code);
      return { src:'Realt',
        price:a.calculatedPrice||null, rooms:a.rooms,
        area:town, region:a.stateRegionName||'',
        capacity:a.maxCapacity||'',
        title:((town)+' '+(a.address||a.title||'')).replace(/\s+/g,' ').trim(),
        photos:(a.images||a.imagesV2||[]).filter(Boolean),
        rating:+a.rating||0, reviews:+a.reviews||0, descId:a.code,
        phone:(a.contactPhones||[])[0]||'', name:a.contactName||'',
        lat:c[0], lng:c[1], approx:true,
        link:realtObjectLink(reg, t.section, a.code) };
    }).filter(x=> x.price>0);
  });
}

async function fromRealt(reg, city, type, rooms, maxP, guests, minP){
  try{
    const list = await realtRaw(reg, type);
    return list.filter(x=>
         (city ? сравнимо(x.area).includes(сравнимо(city)) : true)
      && (!rooms||x.rooms==rooms) && (!maxP||x.price<=maxP) && (!minP||x.price>=minP)
      && (!guests|| (+x.capacity||0)>=guests));
  }catch(e){ console.error('Realt:', e.message); return []; }
}

// flatbook.by — суточные квартиры и усадьбы/коттеджи по областным центрам РБ.
// Города = поддомены ({city}.flatbook.by, Минск = основной), усадьбы/коттеджи = путь /kottedzhi/.
// Все данные во встроенном <div id="data-geo" data-geo='[...]'>: координаты, цена, адрес, телефон, фото.
const FLATBOOK_SUB = {'minsk':'','minsk-obl':'','brest':'brest','gomel':'gomel','grodno':'grodno','vitebsk':'vitebsk','mogilev':'mogilev'};
function parseFlatbookGeo(html){
  const m = html.match(/id="data-geo"\s+data-geo='([^']*)'/);
  if(!m) return [];
  try{ let a=JSON.parse(m[1]); if(typeof a==='string') a=JSON.parse(a); return Array.isArray(a)?a:[]; }catch(e){ return []; }
}
// Flatbook понимает комнаты и удобства на своей стороне, поэтому они входят в ключ.
// Цена отсеивается после, значит её смена берётся из памяти.
async function fromFlatbookCity(regKey, center, type, maxP, rooms, amenFb, minP){
  const list = await flatbookRaw(regKey, center, type, rooms, amenFb);
  return list.filter(x=> (!maxP || x.price<=maxP) && (!minP || x.price>=minP));
}

async function flatbookRaw(regKey, center, type, rooms, amenFb){
 return cached('raw|fb|'+regKey+'|'+type+'|'+(rooms||'')+'|'+((amenFb||[]).join(',')), async ()=>{
  const sub = FLATBOOK_SUB[regKey];
  const host = sub ? ('https://'+sub+'.flatbook.by') : 'https://flatbook.by';
  const path = (type==='flat') ? '/' : '/kottedzhi/';   // усадьбы и коттеджи — один раздел
  // фильтры flatbook понимает только для квартир: room_number[]=N ("3"=3+) и apartment_comfort[]=<название>
  const params=[];
  if(type==='flat' && rooms){
    const nums = String(rooms)==='3' ? [3,4,5,6] : [rooms];
    nums.forEach(n=>params.push('room_number%5B%5D='+n));
  }
  if(type==='flat' && amenFb && amenFb.length){
    amenFb.forEach(v=>params.push('apartment_comfort%5B%5D='+encodeURIComponent(v)));
  }
  const q = params.length ? ('?'+params.join('&')) : '';
  try{
    const h = await (await fetch(host+path+q, ждём({headers:{'User-Agent':UA,'Accept-Language':'ru'}}))).text();
    return parseFlatbookGeo(h).map(f=>{
      const ph=String(f.phone||'').replace(/\D/g,'');
      const phone = ph.length===9 ? ('375'+ph) : ph;
      const metro = (f.metro_description&&f.metro_description[0]&&f.metro_description[0].metro_name)||'';
      // У Flatbook два раздела с РАЗНЫМИ именами полей. Квартиры отдают
      // streetName/streetNumber/seoTitle, а усадьбы и коттеджи — address/name.
      // Пока читали только первый набор, все 92 усадьбы показывались как «Минск»
      // без названия и адреса.
      const addr = (((f.streetName||'')+' '+(f.streetNumber||'')).trim())
                 || String(f.address||'').trim();
      const label = String(f.seoTitle || f.name || '').trim().slice(0,70);
      const img0 = f.generatedImagePath ? String(f.generatedImagePath).replace('/yandex_card_image/','/catalog_image/') : '';
      // Город берём по координатам самого объявления, а не по тому,
      // на каком поддомене мы его нашли: один и тот же дом приходит
      // с нескольких, и раньше он подписывался то Минском, то Брестом.
      const la = +f.latitude, lo = +f.longitude;
      const рядом = (la > 50 && lo > 22) ? nearestTown(la, lo) : null;
      // Города в данных Flatbook нет вовсе. Если поблизости нет города,
      // который мы знаем, подпись не ставим совсем: раньше подставлялся
      // центр области, и дом в Несвиже показывался как «Минск». Адрес
      // и название в карточке и так говорят, где это.
      const город = (рядом && рядом.km <= 35) ? рядом.town : '';
      return { src:'Flatbook', cur:'BYN', unit:'сутки',
        price:+f.price_day||0, rooms:0, area:город, capacity:'',
        title: [addr, label].filter(Boolean).join(' · ') || город || 'Жильё на сутки',
        photos: img0 ? [img0] : [],
        rating:0, reviews:0, descId:null, phone, name:'',
        lat:la, lng:lo, approx:false,
        chips: [город].filter(Boolean).concat(metro?['м. '+metro]:[]),
        // Часть объявлений отдаётся со ссылкой на тестовый сайт flatbook.
        // Те же страницы есть на основном домене, поэтому просто убираем
        // приставку: человека нельзя отправлять на тестовый стенд.
        link: String(f.url || (host+'/'+f.alias+'/')).replace('//test.', '//') };
    }).filter(x=> x.price>0 && x.lat>50 && x.lng>22);
  }catch(e){ console.error('Flatbook '+host+':', e.message); return []; }
 });
}
async function fromFlatbook(regKey, city, type, maxP, rooms, amenFb, minP){
  const keys = regKey==='any'
    ? ['minsk','brest','gomel','grodno','vitebsk','mogilev']
    : (FLATBOOK_SUB[regKey]!==undefined ? [regKey] : []);
  // flatbook работает по областным центрам; если выбран конкретный НЕ центр — не подмешиваем
  const tasks = keys.filter(k=>{
    const center = REGIONS[k] && REGIONS[k].main;
    return center && (!city || сравнимо(center).includes(сравнимо(city)));
  }).map(k=> fromFlatbookCity(k, REGIONS[k].main, type, maxP, rooms, amenFb, minP));
  const arrs = await Promise.all(tasks);
  return [].concat(...arrs);
}

// Поиск по НАЗВАНИЮ по всей Беларуси (когда известно название, но не место), по всем трём источникам.
// Kufar — полнотекстовый поиск; Flatbook — по всем городам; Realt — по тексту списка (title/адрес/город).
const KUFAR_JUNK = /прокат|пароочистит|пылесос|karcher|керхер|электроинструмент|генератор|виброплит|отбойн|перфоратор|\bдрель|бетоно|шлифов|аппарат|моющий|химчистк|фотозон|аренда авто|прицеп/i;
// Realt по названию: перебираем разделы всех областей и матчим по тексту списка
// (title/headline/адрес/город). Имена в глубоком описании тут не видны — только то, что в списке.
const RB_REALT_KEYS = ['minsk','brest','gomel','grodno','vitebsk','mogilev'];   // minsk-obl = тот же глобальный список, что minsk
async function fromRealtByName(rx, type, maxP, minP){
  const t = TYPES[type]||TYPES.flat;
  const tasks = RB_REALT_KEYS.map(async k=>{
    const reg = REGIONS[k];
    try{
      const h = await (await fetch(realtBase(reg,t.section), ждём({headers:{'User-Agent':UA}}))).text();
      return parseRealt(h).map(a=>{
        const town=a.townName||'';
        const text=[a.title,a.headline,a.address,town,a.streetName].filter(Boolean).join(' ');
        if(rx && !rx.test(text)) return null;
        const c=approxCoord(town||reg.main, reg.main, a.code);
        return { src:'Realt',
          price:a.calculatedPrice||null, rooms:a.rooms, area:town, region:a.stateRegionName||'',
          capacity:a.maxCapacity||'',
          title:((town)+' '+(a.address||a.title||'')).replace(/\s+/g,' ').trim(),
          photos:(a.images||a.imagesV2||[]).filter(Boolean),
          rating:+a.rating||0, reviews:+a.reviews||0, descId:a.code,
          phone:(a.contactPhones||[])[0]||'', name:a.contactName||'',
          lat:c[0], lng:c[1], approx:true,
          link:realtObjectLink(reg, t.section, a.code) };
      }).filter(Boolean).filter(x=> x.price>0 && (!maxP||x.price<=maxP) && (!minP||x.price>=minP));
    }catch(e){ return []; }
  });
  return [].concat(...await Promise.all(tasks));
}
async function searchByName(name, type, maxP, minP){
  const q=(name||'').trim();
  if(!q) return {total:0,kufar:0,realt:0,flatbook:0,items:[]};
  let rx=null; try{ rx=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); }catch(e){}
  const kufarTask=(async()=>{
    try{
      const слово = (TYPES[type] && type !== 'any') ? (TYPES[type].kw + ' ') : '';
      const url='https://api.kufar.by/search-api/v2/search/rendered-paginated?query='+encodeURIComponent(слово+q+' на сутки')+'&size=42&lang=ru';
      const k=await (await fetch(url, ждём({headers:{'User-Agent':UA}}))).json();
      const g=(a,n)=>(a.ad_parameters||[]).find(y=>y.p===n);
      return (k.ads||[]).map(a=>{
        let lat=null,lng=null,approx=true; const cp=g(a,'coordinates');
        if(cp&&Array.isArray(cp.v)&&cp.v.length>=2){ const lo=+cp.v[0],la=+cp.v[1]; if(la>50&&la<57&&lo>22&&lo<33){lat=la;lng=lo;approx=false;} }
        const area=(g(a,'area')?.vl)||(g(a,'region')?.vl)||'';
        if(lat==null){ const c=approxCoord(area,'Минск',a.ad_id); lat=c[0]; lng=c[1]; }
        return { src:'Kufar', price:a.price_byn?a.price_byn/100:null, rooms:+(g(a,'rooms')?.v||0),
          area, region:g(a,'region')?.vl||'', capacity:g(a,'house_rent_couchettes')?.vl||'',
          title:a.subject||'', photos:(a.images||[]).map(im=>'https://rms.kufar.by/v1/gallery/'+im.path),
          rating:0,reviews:0,descId:a.ad_id,phone:'',name:'',lat,lng,approx,link:a.ad_link||'' };
      }).filter(x=> x.price>0 && (!maxP||x.price<=maxP) && (!minP||x.price>=minP) && (!rx||rx.test(x.title)) && !KUFAR_JUNK.test(x.title)
                 // Kufar ищет по смыслу и на «усадьбу» охотно отдаёт квартиры.
                 // Подсовывать не то, что просили, нельзя: лучше пустая выдача.
                 && (type === 'any' || !TYPE_RX[type] || TYPE_RX[type].test(x.title)));
    }catch(e){ console.error('Kufar name:', e.message); return []; }
  })();
  const типы = type === 'any' ? STAY_TYPES : [type];
  const fbTask=(async()=>{
    try{
      const части = await Promise.all(типы.map(t => fromFlatbook('any','',t,maxP)));
      return [].concat(...части).filter(x=> !rx || rx.test(x.title));
    }
    catch(e){ return []; }
  })();
  const realtTask=(async()=>{ try{
    const части = await Promise.all(типы.map(t => fromRealtByName(rx, t, maxP)));
    return [].concat(...части);
  }catch(e){ return []; } })();
  const [ka,ra,fa]=await Promise.all([kufarTask,realtTask,fbTask]);
  const seen=new Set();
  const all=[...ka,...ra,...fa].filter(x=>{ const k=ключОбъявления(x); if(seen.has(k))return false; seen.add(k); return true; })
                         .sort((a,b)=>a.price-b.price);
  return { total:all.length, kufar:all.filter(x=>x.src==='Kufar').length,
           realt:all.filter(x=>x.src==='Realt').length,
           flatbook:all.filter(x=>x.src==='Flatbook').length, items:all };
}

async function search(regKey, city, type, rooms, maxP, guests, source, amen, minP){
  const amenList = (amen||[]).map(k=>RB_AMEN_BY_KEY[k]).filter(Boolean);
  const hasAmen = amenList.length>0;
  const keys = regKey==='any' ? Object.keys(REGIONS) : [ REGIONS[regKey] ? regKey : 'brest' ];
  const useK = source==='both' || source==='kufar';
  const useR = (source==='both' || source==='realt') && !hasAmen;   // у Realt нет данных удобств в списке → при фильтре удобств не участвует
  // Flatbook вместимость не передаёт вообще — ни в одном объявлении. Раньше при
  // запросе «на 6+ гостей» все его варианты проходили насквозь, и человек, просивший
  // дом на компанию, получал в том числе жильё на двоих. Фильтр обязан фильтровать,
  // поэтому при заданном числе гостей Flatbook не участвует — так же, как Realt
  // не участвует при выборе удобств.
  const useF = (source==='both' || source==='flatbook') && !guests;
  // «любой» — это все три вида сразу: у источников общего запроса нет,
  // поэтому спрашиваем каждый вид отдельно и складываем. Повторы уберёт
  // отбор по ссылке ниже.
  const типы = type === 'any' ? STAY_TYPES : [type];
  const tasks = [];
  keys.forEach(key=>{
    const reg = REGIONS[key];
    типы.forEach(t=>{
      if(useK) tasks.push(fromKufar(reg,city,t,rooms,maxP,guests,minP));
      if(useR) tasks.push(fromRealt(reg,city,t,rooms,maxP,guests,minP));
    });
  });
  if(useF) типы.forEach(t=>
    tasks.push(fromFlatbook(regKey,city,t,maxP,rooms, amenList.map(a=>a.fb).filter(Boolean), minP)));   // flatbook: комнаты + удобства (apartment_comfort)
  const arrs = await Promise.all(tasks);
  let all = [].concat(...arrs);
  // фильтр удобств для Kufar по тексту удобств (Flatbook уже отфильтрован на своей стороне)
  if(hasAmen) all = all.filter(x=> x.src!=='Kufar' || amenList.every(a=> a.rx.test(x.amenText||'')));
  // Убираем повторы. Ссылки мало: Flatbook отдаёт одно и то же объявление
  // с разных поддоменов (mogilev.flatbook.by и flatbook.by), адреса разные,
  // а дом один — в ленте он показывался дважды, да ещё с разными городами.
  const seen = new Set();
  all = all.filter(x=>{ const k = ключОбъявления(x); if(seen.has(k)) return false; seen.add(k); return true; })
           .sort((a,b)=>a.price-b.price)
           // Отдаём наружу полегче: шестнадцать снимков в карточке никто
           // не листает, а список удобств нужен был только что выше, при отборе.
           .map(x=>{ const y = Object.assign({}, x);
                     if(y.photos && y.photos.length > 8) y.photos = y.photos.slice(0, 8);
                     delete y.amenText;
                     return y; });
  return { total: all.length,
           kufar: all.filter(x=>x.src==='Kufar').length,
           realt: all.filter(x=>x.src==='Realt').length,
           flatbook: all.filter(x=>x.src==='Flatbook').length,
           items: all };
}

// ============ Россия: отели с 101hotels.com ============
// Публичный map-эндпоинт ssg.101hotels.com/hotel/available/map?coords=[[minLng,maxLat],[maxLng,minLat]]
// отдаёт отели в рамке с ценой/координатами/фото/рейтингом. Слаг города берём из самого отеля.
// d = половина рамки по широте (dl = d*1.7 по долготе). d держим <=0.15,
// иначе 101hotels отдаёт кластеры вместо отдельных отелей (порог ~0.15-0.18).
const RF_CITIES = {
  'moskva':{name:'Москва', lat:55.7536, lng:37.6198, d:0.14},
  'sankt-peterburg':{name:'Санкт-Петербург', lat:59.9320, lng:30.2999, d:0.14},
  'kazan':{name:'Казань', lat:55.7958, lng:49.1065, d:0.12},
  'adler':{name:'Адлер', lat:43.4056, lng:40.0010, d:0.1},
  'sochi':{name:'Сочи', lat:43.5818, lng:39.7226, d:0.12},
  'simferopol':{name:'Симферополь', lat:44.9485, lng:34.1013, d:0.12},
  'alushta':{name:'Алушта', lat:44.6764, lng:34.4101, d:0.1},
  'sevastopol':{name:'Севастополь', lat:44.6166, lng:33.5254, d:0.12},
  'yalta':{name:'Ялта', lat:44.4974, lng:34.1695, d:0.1},
  'evpatoriya':{name:'Евпатория', lat:45.2001, lng:33.3611, d:0.1},
  'kerch':{name:'Керчь', lat:45.3573, lng:36.4683, d:0.1},
  'feodosiya':{name:'Феодосия', lat:45.0319, lng:35.3824, d:0.1},
  'sudak':{name:'Судак', lat:44.8505, lng:34.9762, d:0.1},
  'alupka':{name:'Алупка', lat:44.4163, lng:34.0445, d:0.1},
  'lazarevskoe':{name:'Лазаревское', lat:43.9089, lng:39.3336, d:0.1},
  'anapa':{name:'Анапа', lat:44.8949, lng:37.3163, d:0.1},
  'gelendjik':{name:'Геленджик', lat:44.5630, lng:38.0791, d:0.1},
  'tuapse':{name:'Туапсе', lat:44.0951, lng:39.0734, d:0.1},
  'novorossiisk':{name:'Новороссийск', lat:44.7237, lng:37.7685, d:0.1},
  'hosta':{name:'Хоста', lat:43.5132, lng:39.8758, d:0.1},
  'loo':{name:'Лоо', lat:43.7017, lng:39.5878, d:0.1},
  'dagomys':{name:'Дагомыс', lat:43.6545, lng:39.6546, d:0.1},
  'vardane':{name:'Вардане', lat:43.7356, lng:39.5487, d:0.1},
  'ashe':{name:'Аше', lat:43.9579, lng:39.2711, d:0.1},
  'matcesta':{name:'Мацеста', lat:43.5585, lng:39.7957, d:0.1},
  'gurzuf':{name:'Гурзуф', lat:44.5473, lng:34.2915, d:0.1},
  'simeiz':{name:'Симеиз', lat:44.4067, lng:34.0054, d:0.1},
  'miskhor':{name:'Мисхор', lat:44.4277, lng:34.0826, d:0.1},
  'foros':{name:'Форос', lat:44.3918, lng:33.7874, d:0.1},
  'livadiya':{name:'Ливадия', lat:44.4751, lng:34.1479, d:0.1},
  'massandra':{name:'Массандра', lat:44.5181, lng:34.1858, d:0.1},
  'gaspra':{name:'Гаспра', lat:44.4350, lng:34.1121, d:0.1},
  'dombai':{name:'Домбай', lat:43.2896, lng:41.6235, d:0.1},
  'khvalynsk':{name:'Хвалынск', lat:52.5003, lng:48.0860, d:0.1},
  'abzakovo':{name:'Абзаково', lat:53.8283, lng:58.5918, d:0.1},
  'sheregesh':{name:'Шерегеш', lat:52.9270, lng:87.9926, d:0.1},
  'beloretck':{name:'Белорецк', lat:53.9665, lng:58.4002, d:0.1},
  'baikalsk':{name:'Байкальск', lat:51.5120, lng:104.1324, d:0.1},
  'kirovsk':{name:'Кировск (Мурманская область)', lat:67.6107, lng:33.6724, d:0.1},
  'pyatigorsk':{name:'Пятигорск', lat:44.0405, lng:43.0700, d:0.1},
  'kislovodsk':{name:'Кисловодск', lat:43.9053, lng:42.7165, d:0.1},
  'essentuki':{name:'Ессентуки', lat:44.0495, lng:42.8561, d:0.1},
  'zheleznovodsk':{name:'Железноводск', lat:44.1393, lng:43.0213, d:0.1},
  'georgievsk':{name:'Георгиевск', lat:44.1496, lng:43.4636, d:0.1},
  'inozemtsevo':{name:'Иноземцево', lat:44.0972, lng:43.0895, d:0.1},
  'divnoe':{name:'Дивное', lat:45.9070, lng:43.3485, d:0.1},
  'leestvyanka':{name:'Листвянка', lat:51.8573, lng:104.8739, d:0.1},
  'patroni':{name:'Патроны', lat:52.1564, lng:104.4665, d:0.1},
  'sarma':{name:'Сарма', lat:53.1001, lng:106.8341, d:0.1},
  'sahyurta':{name:'Сахюрта', lat:53.0180, lng:106.8771, d:0.1},
  'severobaykalsk':{name:'Северобайкальск', lat:55.6279, lng:109.3149, d:0.1},
  'baykal':{name:'Байкал', lat:51.8714, lng:104.8061, d:0.1},
  'gremyachinsk':{name:'Гремячинск (Бурятия)', lat:52.8036, lng:107.9764, d:0.1},
  'vladimir':{name:'Владимир', lat:56.1290, lng:40.4071, d:0.1},
  'yaroslavl':{name:'Ярославль', lat:57.6261, lng:39.8845, d:0.12},
  'suzdal':{name:'Суздаль', lat:56.4200, lng:40.4495, d:0.1},
  'uglich':{name:'Углич', lat:57.5338, lng:38.3355, d:0.1},
  'ivanovo':{name:'Иваново', lat:57.0051, lng:40.9766, d:0.1},
  'kostroma':{name:'Кострома', lat:57.7678, lng:40.9260, d:0.1},
  'murom':{name:'Муром', lat:55.5791, lng:42.0524, d:0.1},
  'rybinsk':{name:'Рыбинск', lat:58.0490, lng:38.8523, d:0.1},
  'viborg':{name:'Выборг', lat:60.7130, lng:28.7329, d:0.1},
  'petergof':{name:'Петергоф', lat:59.8804, lng:29.9066, d:0.1},
  'repino':{name:'Репино', lat:60.1683, lng:29.8673, d:0.1},
  'kronshtadt':{name:'Кронштадт', lat:59.9959, lng:29.7655, d:0.1},
  'sestroretsk':{name:'Сестрорецк', lat:60.1015, lng:29.9574, d:0.1},
  'lomonosov':{name:'Ломоносов', lat:59.9107, lng:29.7360, d:0.1},
  'solnechnoe':{name:'Солнечное', lat:60.1518, lng:29.9345, d:0.1},
  'kareliya':{name:'Республика Карелия (вся)', lat:62.5, lng:33.5, d:2.6},
  'petrozavodsk':{name:'Петрозаводск', lat:61.7849, lng:34.3469, d:0.12},
  'sortavala':{name:'Сортавала', lat:61.7031, lng:30.6906, d:0.1},
  'medvezhegorsk':{name:'Медвежьегорск', lat:62.9166, lng:34.4569, d:0.1},
  'kostomuksha':{name:'Костомукша', lat:64.5783, lng:30.5836, d:0.1},
  'ekaterinburg':{name:'Екатеринбург', lat:56.8386, lng:60.6055, d:0.12},
  'chelyabinsk':{name:'Челябинск', lat:55.1602, lng:61.4006, d:0.12},
  'tyumen':{name:'Тюмень', lat:57.1529, lng:65.5341, d:0.12},
  'hanty-mansiysk':{name:'Ханты-Мансийск', lat:61.0091, lng:69.0375, d:0.1},
  'surgut':{name:'Сургут', lat:61.2541, lng:73.3961, d:0.1},
  'kurgan':{name:'Курган', lat:55.4416, lng:65.3443, d:0.1},
  'magnitogorsk':{name:'Магнитогорск', lat:53.4117, lng:58.9845, d:0.1},
  'salehard':{name:'Салехард', lat:66.5337, lng:66.6049, d:0.1},
  'koktebel':{name:'Коктебель', lat:44.9603, lng:35.2411, d:0.1},
  'shelkino':{name:'Щелкино', lat:45.4276, lng:35.8246, d:0.1},
  'primorskii':{name:'Приморский (Крым)', lat:45.1207, lng:35.4833, d:0.1},
  'morskoe':{name:'Морское', lat:44.8266, lng:34.8034, d:0.1},
  'volgograd':{name:'Волгоград', lat:48.7085, lng:44.5151, d:0.12},
  'rostov-na-donu':{name:'Ростов-на-Дону', lat:47.2225, lng:39.7186, d:0.12},
  'krasnodar':{name:'Краснодар', lat:45.0362, lng:38.9733, d:0.12},
  'yakti-kul':{name:'Якты-Куль', lat:53.5720, lng:58.6208, d:0.1},
  'partenit':{name:'Партенит', lat:44.5765, lng:34.3432, d:0.1},
  'arkhyz':{name:'Архыз', lat:43.5632, lng:41.2813, d:0.1},
  'esto-sadok':{name:'Эсто-Садок', lat:43.6774, lng:40.2809, d:0.1},
  'zvenigorod':{name:'Звенигород', lat:55.7314, lng:36.8552, d:0.1}
};
const RF_TYPES = {'1':'Отели','2':'Хостелы','3':'Гостевые дома','4':'Апартаменты','5':'Пансионаты','6':'Санатории','7':'Базы отдыха','8':'Коттеджи'};
// Удобства В НОМЕРЕ (id услуг 101hotels, тот же параметр services)
const RF_SERVICES = {'5':'Кондиционер','70':'Холодильник','71':'Чайник','64':'Телевизор','7':'Фен','6':'Сейф','120':'Звукоизоляция'};
const RF_CITY_OPTIONS   = Object.entries(RF_CITIES).map(([k,v],i)=>'<option value="'+k+'"'+(i===0?' selected':'')+'>'+v.name+'</option>').join('');
const RF_TYPE_OPTIONS   = Object.entries(RF_TYPES).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
const RF_SERVICE_CHECKS = Object.entries(RF_SERVICES).map(([k,v])=>'<label class="amen-item"><input type="checkbox" class="amen-cb" value="'+k+'"> '+v+'</label>').join('');

function hotel101ToItem(hh){
  const co = hh.coords || [];
  const lng = +co[0], lat = +co[1];
  if(!(lat>40 && lat<75 && lng>18 && lng<190)) return null;
  const img = hh.image && (hh.image.path || hh.image.preview_path || hh.image.thumb_path);
  const stars = +hh.stars || 0;
  const typeName = RF_TYPES[String(hh.type_id)] || '';
  const rs = hh.reviews_summary || {};
  const prepay = (hh.min_price_data && hh.min_price_data.prepayment) || '';  // NO = оплата при заселении, FIRST/FULL = предоплата
  const chips = [];
  if(stars) chips.push('★'.repeat(stars));
  if(typeName) chips.push(typeName);
  if(hh.city_name) chips.push(hh.city_name);
  if(prepay==='NO') chips.push('💳 оплата на месте');
  return { src:'H101', cur:'₽', hid:hh.id,
    price:+hh.min_price || 0, prepay,
    rooms:0, area:hh.city_name||'', capacity:'',
    title:hh.full_name||'', address:hh.address||'',
    photos: img ? [img] : [],
    rating:+(rs.rating)||+hh.rating||0, reviews:+(rs.number_reviews)||0,
    descId:null, phone:'', name:'', lat, lng, approx:false, chips,
    link:'https://101hotels.com/main/cities/'+(hh.city_url||'')+'/'+(hh.url||'') };
}
async function fromR101(cityKey, opts){
  const c = RF_CITIES[cityKey] || RF_CITIES['moskva'];
  const d = c.d || 0.18, dl = d * 1.7;   // долготу растягиваем (градус у́же по широте)
  const coords = JSON.stringify([[c.lng-dl, c.lat+d],[c.lng+dl, c.lat-d]]);
  const p = new URLSearchParams();
  p.set('coords', coords);
  if(opts.types)    p.set('types', opts.types);
  if(opts.stars)    p.set('stars', opts.stars);
  if(opts.services) p.set('services', opts.services);
  if(opts.rating)   p.set('rating', opts.rating);
  if(opts.bathroom) p.set('bathroom', '1');   // «Удобства в номере»
  let url = 'https://ssg.101hotels.com/hotel/available/map?' + p.toString();
  if(opts.maxP) url += '&price%5B%5D=0&price%5B%5D=' + encodeURIComponent(opts.maxP);
  try{
    const j = await (await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json','Accept-Language':'ru','Referer':'https://101hotels.com/','X-Requested-With':'XMLHttpRequest'}})).json();
    const hotels = (j.response && j.response.hotels) || [];
    return hotels.map(hotel101ToItem).filter(x=> x && x.price>0 && (!opts.maxP || x.price<=opts.maxP) && (!opts.minP || x.price>=opts.minP));
  }catch(e){ console.error('101hotels:', e.message); return []; }
}
async function searchRF(cityKey, opts){
  let items = await fromR101(cityKey, opts);
  const seen = new Set();
  items = items.filter(x=>{ if(seen.has(x.link)) return false; seen.add(x.link); return true; });
  if(opts.no_card) items = items.filter(x=> x.prepay==='NO');   // оплата при заселении (без предоплаты)
  const s = opts.sort || 'price_asc';
  items.sort((a,b)=> s==='price_desc' ? b.price-a.price
                   : s==='rating_desc' ? (((b.rating||0)-(a.rating||0))||(a.price-b.price))
                   : a.price-b.price);
  return { total: items.length, items };
}

// ── Куда серверу разрешено ходить по ссылке от посетителя ────────────────
// Раньше /api/desc брал любой адрес из запроса и честно его скачивал — то есть
// сайт работал открытым прокси: чужой человек мог заставить наш сервер грузить
// что угодно и от нашего имени. Теперь пускаем только realt.by.
function isRealtUrl(v){
  try{
    const h = new URL(String(v)).hostname.toLowerCase();
    return h === 'realt.by' || h.endsWith('.realt.by');
  }catch(e){ return false; }
}

// Про склейку дублей между источниками.
// Проверено на шести срезах (Минск, Брест, Гомель, Гродно, усадьбы, коттеджи —
// около 900 объявлений): совпадений одного жилья между Kufar, Realt и Flatbook
// НЕТ ни по адресу, ни по телефону. Источники держат разное жильё.
// Склейка по «телефон + цена» была ошибкой: под неё попадали разные квартиры
// одного хозяина по одинаковой цене — в Минске таких групп 59, и агентство
// с двадцатью квартирами по 60 рублей схлопывалось бы в одну карточку.
// Поэтому склейки нет: дубли убираются только по совпадению ссылки.

// ── Места: что посмотреть ─────────────────────────────────────────────────
// Точки берём из нашего же справочника kudin.by. Полные описания остаются
// там: у себя показываем выжимку и ссылку на первоисточник, чтобы два сайта
// не конкурировали в поиске одинаковым текстом.
// Обложки, где человек в кадре — главный герой: лицо читается, фигура
// крупная. Прятать точку из-за этого нельзя — она нужна на карте, — поэтому
// берём из той же галереи другой кадр, общий вид. Просмотрены все 767
// снимков; замены выбраны глазами и лежат в «обложки-точек.json».
// Людей на фоне и мелкие фигуры вдалеке оставляем: масштаб сооружения по
// ним, наоборот, понятнее. Где другого кадра нет — оставляем что есть.
let ОБЛОЖКИ = {};
try{ ОБЛОЖКИ = JSON.parse(fs.readFileSync(__dirname + '/обложки-точек.json', 'utf8')); }
catch(e){ ОБЛОЖКИ = {}; }

// Точки из наших маршрутов, которых нет в справочнике kudin.by.
// Описания — наши собственные, из файлов маршрутов. Фотографии взяты
// с Викисклада, только со свободными лицензиями и с указанием автора:
// этого требуют условия CC BY и CC BY-SA.
const EXTRA_PLACES = [
 {
  "id": 900001,
  "name": "Свято-Успенский Жировичский монастырь",
  "lat": 53.03,
  "lng": 25.342,
  "addr": "аг. Жировичи, Слонимский р-н",
  "cat": "Монастырь",
  "group": "Из маршрутов",
  "pic": "https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b6/%D0%92._%D0%96%D1%8B%D1%80%D0%BE%D0%B2%D1%96%D1%87%D1%8B_-_%D0%90%D0%BD%D1%81%D0%B0%D0%BC%D0%B1%D0%B0%D0%BB%D1%8C_%D0%A1%D1%8C%D0%B2%D1%8F%D1%82%D0%B0-%D0%A3%D1%81%D1%8C%D0%BF%D0%B5%D0%BD%D1%81%D0%BA%D0%B0%D0%B3%D0%B0_%D0%BC%D0%B0%D0%BD%D0%B0%D1%81%D1%82%D1%8B%D1%80%D0%B0_PICT3028.jpg/960px-%D0%92._%D0%96%D1%8B%D1%80%D0%BE%D0%B2%D1%96%D1%87%D1%8B_-_%D0%90%D0%BD%D1%81%D0%B0%D0%BC%D0%B1%D0%B0%D0%BB%D1%8C_%D0%A1%D1%8C%D0%B2%D1%8F%D1%82%D0%B0-%D0%A3%D1%81%D1%8C%D0%BF%D0%B5%D0%BD%D1%81%D0%BA%D0%B0%D0%B3%D0%B0_%D0%BC%D0%B0%D0%BD%D0%B0%D1%81%D1%82%D1%8B%D1%80%D0%B0_PICT3028.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "text": "Один из главных православных центров Беларуси, крупнейший архитектурный ансамбль XVII–XVIII вв. Здесь хранится чудотворная Жировичская икона Божией Матери. В зените славы монастырь называли «новой Ченстоховой» Речи Посполитой. Комплекс включает Успенский собор, Явленскую и Крестовоздвиженскую церкви, здание семинарии. Крюк ~12 км с трассы М1 у Слонима.",
  "author": "Argon by",
  "lic": "CC BY-SA 3.0",
  "src": "https://commons.wikimedia.org/wiki/File:%D0%92._%D0%96%D1%8B%D1%80%D0%BE%D0%B2%D1%96%D1%87%D1%8B_-_%D0%90%D0%BD%D1%81%D0%B0%D0%BC%D0%B1%D0%B0%D0%BB%D1%8C_%D0%A1%D1%8C%D0%B2%D1%8F%D1%82%D0%B0-%D0%A3%D1%81%D1%8C%D0%BF%D0%B5%D0%BD%D1%81%D0%BA%D0%B0%D0%B3%D0%B0_%D0%BC%D0%B0%D0%BD%D0%B0%D1%81%D1%82%D1%8B%D1%80%D0%B0_PICT3028.jpg"
 },
 {
  "id": 900002,
  "name": "Памятник Тысячелетия Бреста",
  "lat": 52.092795,
  "lng": 23.692994,
  "addr": "Брест, ул. Советская",
  "cat": "памятник",
  "group": "Из маршрутов",
  "pic": "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/83/Lieninski_rajon%2C_Brest%2C_Belarus_-_panoramio_%287%29.jpg/960px-Lieninski_rajon%2C_Brest%2C_Belarus_-_panoramio_%287%29.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "text": "Многофигурная композиция 2009 года: наверху ангел-хранитель, ниже — князь Владимир Василькович, Витовт, Николай Радзивилл Чёрный, летописец, безымянные мать и солдат. Главная точка встречи на пешеходной улице.",
  "author": "alinco_fan",
  "lic": "CC BY 3.0",
  "src": "https://commons.wikimedia.org/wiki/File:Lieninski_rajon,_Brest,_Belarus_-_panoramio_(7).jpg"
 },
 {
  "id": 900003,
  "name": "Брестский музей железнодорожной техники",
  "lat": 52.085655,
  "lng": 23.672189,
  "addr": "Брест, пр. Машерова, 2",
  "cat": "музей",
  "group": "Из маршрутов",
  "pic": "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/43/%D0%A1%D1%83250-30%2C_%D0%91%D0%B5%D0%BB%D0%B0%D1%80%D1%83%D1%81%D1%8C%2C_%D0%91%D1%80%D0%B5%D1%81%D1%82%D1%81%D0%BA%D0%B0%D1%8F_%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C%2C_%D0%91%D1%80%D0%B5%D1%81%D1%82%D1%81%D0%BA%D0%B8%D0%B9_%D0%BC%D1%83%D0%B7%D0%B5%D0%B9_%D0%B6%D0%B5%D0%BB%D0%B5%D0%B7%D0%BD%D0%BE%D0%B4%D0%BE%D1%80%D0%BE%D0%B6%D0%BD%D0%BE%D0%B9_%D1%82%D0%B5%D1%85%D0%BD%D0%B8%D0%BA%D0%B8_%28Trainpix_204915%29.jpg/960px-thumbnail.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "text": "Открытая площадка с паровозами, вагонами и путевой техникой — более полусотни единиц. В некоторые кабины пускают.",
  "author": "BLOG",
  "lic": "CC BY-SA 4.0",
  "src": "https://commons.wikimedia.org/wiki/File:%D0%A1%D1%83250-30,_%D0%91%D0%B5%D0%BB%D0%B0%D1%80%D1%83%D1%81%D1%8C,_%D0%91%D1%80%D0%B5%D1%81%D1%82%D1%81%D0%BA%D0%B0%D1%8F_%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C,_%D0%91%D1%80%D0%B5%D1%81%D1%82%D1%81%D0%BA%D0%B8%D0%B9_%D0%BC%D1%83%D0%B7%D0%B5%D0%B9_%D0%B6%D0%B5%D0%BB%D0%B5%D0%B7%D0%BD%D0%BE%D0%B4%D0%BE%D1%80%D0%BE%D0%B6%D0%BD%D0%BE%D0%B9_%D1%82%D0%B5%D1%85%D0%BD%D0%B8%D0%BA%D0%B8_(Trainpix_204915).jpg"
 },
 {
  "id": 900004,
  "name": "Памятник Жану Эммануэлю Жилиберу",
  "lat": 53.685987,
  "lng": 23.835413,
  "addr": "Гродно, парк Жилибера",
  "cat": "памятник",
  "group": "Из маршрутов",
  "pic": "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/%D0%9F%D0%BE%D0%BC%D0%BD%D1%96%D0%BA_%D0%96%D1%8B%D0%BB%D1%8C%D0%B1%D0%B5%D1%80%D1%83.jpg/960px-%D0%9F%D0%BE%D0%BC%D0%BD%D1%96%D0%BA_%D0%96%D1%8B%D0%BB%D1%8C%D0%B1%D0%B5%D1%80%D1%83.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "text": "Французский ботаник и медик, основавший в Гродно в 1775 году врачебную академию и ботанический сад. Парк, названный его именем, вырос из того самого сада — старейшего в стране.",
  "author": "удзельнік Павел Петро",
  "lic": "Public domain",
  "src": "https://commons.wikimedia.org/wiki/File:%D0%9F%D0%BE%D0%BC%D0%BD%D1%96%D0%BA_%D0%96%D1%8B%D0%BB%D1%8C%D0%B1%D0%B5%D1%80%D1%83.jpg"
 },
 {
  "id": 900005,
  "name": "Костёл Обретения Святого Креста и монастырь бернардинцев",
  "lat": 53.674795,
  "lng": 23.83023,
  "addr": "Гродно, ул. Парижской Коммуны, 1",
  "cat": "костёл",
  "group": "Из маршрутов",
  "pic": "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/97/Vilniaus_Kalvariju_baznycia.jpg/960px-Vilniaus_Kalvariju_baznycia.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "text": "Один из старейших действующих костёлов города, строился с конца XVI века. Здесь тоже есть орган и проходят концерты — если органный костёл, который вы вспоминаете, стоит не на площади, а ближе к Неману, то это он.",
  "author": "Renata3",
  "lic": "CC BY-SA 3.0",
  "src": "https://commons.wikimedia.org/wiki/File:Vilniaus_Kalvariju_baznycia.jpg"
 },
 {
  "id": 900006,
  "name": "Свято-Покровский кафедральный собор",
  "lat": 53.684498,
  "lng": 23.841407,
  "addr": "Гродно, ул. Ожешко, 23",
  "cat": "собор",
  "group": "Из маршрутов",
  "pic": "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/10/%D0%A1%D0%B2%D1%8F%D1%82%D0%BE-%D0%9F%D0%BE%D0%BA%D1%80%D0%BE%D0%B2%D1%81%D0%BA%D0%B8%D0%B9_%D0%9A%D0%B0%D1%84%D0%B5%D0%B4%D1%80%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9_%D0%A1%D0%BE%D0%B1%D0%BE%D1%80.JPG/960px-%D0%A1%D0%B2%D1%8F%D1%82%D0%BE-%D0%9F%D0%BE%D0%BA%D1%80%D0%BE%D0%B2%D1%81%D0%BA%D0%B8%D0%B9_%D0%9A%D0%B0%D1%84%D0%B5%D0%B4%D1%80%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9_%D0%A1%D0%BE%D0%B1%D0%BE%D1%80.JPG?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail",
  "text": "Главный православный собор города, построен в 1904–1907 годах как гарнизонный храм в память о погибших в русско-японской войне. Ретроспективно-русский стиль, шатровая колокольня.",
  "author": "Antares1991",
  "lic": "CC BY-SA 3.0",
  "src": "https://commons.wikimedia.org/wiki/File:%D0%A1%D0%B2%D1%8F%D1%82%D0%BE-%D0%9F%D0%BE%D0%BA%D1%80%D0%BE%D0%B2%D1%81%D0%BA%D0%B8%D0%B9_%D0%9A%D0%B0%D1%84%D0%B5%D0%B4%D1%80%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9_%D0%A1%D0%BE%D0%B1%D0%BE%D1%80.JPG"
 },
 {
  "id": 910001,
  "name": "Городище Масковичи",
  "lat": 55.664978,
  "lng": 27.140556,
  "addr": "д. Масковичи, Браславский р-н",
  "cat": "Городище",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Городище XI–XIV веков, знаменитое находками костяных пластин со скандинавскими рунами — след варяжского присутствия на Браславщине. Сверху хороший обзор на озеро Дербо."
 },
 {
  "id": 910002,
  "name": "«Божье Око»",
  "lat": 55.656271,
  "lng": 27.133634,
  "addr": "Браславский р-н, у д. Масковичи",
  "cat": "Смотровая точка",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Круглое озерцо идеально правильной формы, из-за которой его и прозвали Божьим Оком. Смотреть нужно сверху, с холма над берегом — с воды эффект теряется."
 },
 {
  "id": 910003,
  "name": "Городище Шауры",
  "lat": 55.646896,
  "lng": 27.136002,
  "addr": "д. Шауры (Литовщина), Браславский р-н",
  "cat": "Городище",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Ещё одно городище того же куста, на холме над озером. Ориентир на месте — перекрёсток с жёлтым столбиком, от него уходит тропинка на вершину; машину оставляют внизу."
 },
 {
  "id": 910004,
  "name": "Часы «Время зажжения фонарей» и брестский фонарщик",
  "lat": 52.091211,
  "lng": 23.69223,
  "addr": "Брест, ул. Советская",
  "cat": "ритуал",
  "group": "Из маршрутов",
  "pic": "/фото-точек/lamplighter.jpg",
  "text": "Каждый вечер фонарщик в тёмно-синем мундире зажигает вручную 17 керосиновых фонарей на Советской. Время зажжения совпадает с закатом и меняется каждый день — оно выведено на этих часах в начале улицы. Приходить лучше за 10–15 минут до заката: обход занимает около получаса. Традиция возрождена в 2009 году, бессменный фонарщик — Виктор Кирисюк. Примета: подержаться за пуговицу на его мундире и загадать желание. Утром он фонари гасит — зрителей в разы меньше.",
  "author": "фото автора маршрута"
 },
 {
  "id": 910005,
  "name": "Скульптура «Любовник» и знак «Место для поцелуев»",
  "lat": 52.088355,
  "lng": 23.692606,
  "addr": "Брест, ул. Дзержинского, 21",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Фигура мужчины, вылезающего из окна второго этажа, — по мотивам городской легенды о незадачливом любовнике. Рядом на стене дорисованы остальные участники сцены. С 13 февраля 2016 года тут же висит знак «Место для поцелуев», сделанный под дорожный: Брест стал первым городом Беларуси с таким знаком."
 },
 {
  "id": 910006,
  "name": "«Счастливый сапог»",
  "lat": 52.093996,
  "lng": 23.692077,
  "addr": "Брест, ул. Советская, 34",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Бронзовый сапог, в который можно влезть ногой. По легенде о брестских «счастливых сапогах» сын горожанки Анны Александровны нашёл в сапоге семь золотых царских червонцев и разбогател. Примета: примеряя сапог, нащупать спрятанные внутри монеты. Установлен 7 сентября 2013 года."
 },
 {
  "id": 910007,
  "name": "«Пуговица фонарщика»",
  "lat": 52.0888,
  "lng": 23.695076,
  "addr": "Брест, ул. Гоголя",
  "cat": "арт-объект",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Отдельный арт-объект — та самая пуговица, за которую загадывают желание. Удобно, если фонарщика вы не застали: пуговица на месте круглые сутки."
 },
 {
  "id": 910008,
  "name": "Инсталляция «Любовь есть»",
  "lat": 52.091588,
  "lng": 23.693828,
  "addr": "Брест, ул. Советская",
  "cat": "арт-объект",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Небольшая городская инсталляция на пешеходной улице — популярная фототочка рядом с художественной галереей."
 },
 {
  "id": 910009,
  "name": "Лавочка примирения",
  "lat": 52.085341,
  "lng": 23.682334,
  "addr": "Брест, бульвар Шевченко",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Скамья с наклонными половинами: сесть по краям и не съехать к середине невозможно — на том и построена задумка мириться."
 },
 {
  "id": 910010,
  "name": "«Старый город» (кошки)",
  "lat": 52.095898,
  "lng": 23.690084,
  "addr": "Брест, ул. Советская",
  "cat": "арт-объект",
  "group": "Из маршрутов",
  "pic": "/фото-точек/koty.jpg",
  "text": "Композиция со скульптурами кошек, обыгрывающая старый Брест. Одна из самых фотографируемых мелочей на улице.",
  "author": "фото автора маршрута"
 },
 {
  "id": 910011,
  "name": "Музей «Спасённые художественные ценности»",
  "lat": 52.086684,
  "lng": 23.686331,
  "addr": "Брест, ул. Ленина, 39",
  "cat": "музей",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Единственный в Беларуси музей, собранный из вещей, задержанных таможней при попытке вывоза: иконы, живопись, ювелирка, самовары, часы."
 },
 {
  "id": 910012,
  "name": "Брестский областной краеведческий музей",
  "lat": 52.090129,
  "lng": 23.689331,
  "addr": "Брест, ул. К. Маркса, 60",
  "cat": "музей",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Основная экспозиция об истории города и области — хороший вводный час перед прогулкой по центру."
 },
 {
  "id": 910013,
  "name": "Лягушка-путешественница",
  "lat": 53.685948,
  "lng": 23.844594,
  "addr": "Гродно, ул. Ожешко, у ж/д вокзала",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Стоит с 2009 года. В 2016-м кто-то отломал ей палку с узелком — скульптор Владимир Пантелеев восстановил фигуру и добавил сундучок-копилку. С тех пор туристы бросают туда монеты и загадывают желания."
 },
 {
  "id": 910014,
  "name": "Скамейка любви",
  "lat": 53.683993,
  "lng": 23.835969,
  "addr": "Гродно, парк Жилибера",
  "cat": "скамейка",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Парная скамья в парке — обязательная фототочка молодожёнов Гродно вместе со «Скамейкой примирения» неподалёку."
 },
 {
  "id": 910015,
  "name": "Скамейка примирения",
  "lat": 53.684002,
  "lng": 23.836625,
  "addr": "Гродно, парк Жилибера",
  "cat": "скамейка",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Гродненский аналог брестской: сиденья скошены к центру, так что мириться придётся в буквальном смысле. От «Скамейки любви» — тридцать метров."
 },
 {
  "id": 910016,
  "name": "Купидон",
  "lat": 53.682656,
  "lng": 23.832296,
  "addr": "Гродно, центр города",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Маленький бронзовый купидон — одна из тех городских мелочей, которые замечаешь, только если знаешь, что искать."
 },
 {
  "id": 910017,
  "name": "Скамья архитекторов",
  "lat": 53.684535,
  "lng": 23.834708,
  "addr": "Гродно, площадь Тызенгауза",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Композиция в честь создателей облика Гродно. В руках у одной из фигур — оригинальный план города 1780 года, найденный в военно-историческом архиве в Москве."
 },
 {
  "id": 910018,
  "name": "«Я люблю тебя, Гродно!»",
  "lat": 53.68429,
  "lng": 23.836131,
  "addr": "Гродно, парк Жилибера",
  "cat": "арт-объект",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Объёмная надпись в парке — стандартная, но работающая точка для общего кадра."
 },
 {
  "id": 910019,
  "name": "Скульптуры героев фильма «Белые Росы»",
  "lat": 53.707567,
  "lng": 23.843595,
  "addr": "Гродно, микрорайон Девятовка, ул. Дзержинского / Курчатова",
  "cat": "скульптура",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Деревянные фигуры Фёдора (Федоса) Ходаса, соседа Тимофея и пса Валета установлены в 2018 году на месте съёмок фильма 1983 года. Рядом — тот самый колодец из кадра. Крюк от центра, но для любителей кино обязателен."
 },
 {
  "id": 910020,
  "name": "Лютеранская кирха Святого Иоанна",
  "lat": 53.687063,
  "lng": 23.840521,
  "addr": "Гродно, ул. Академическая, 7а",
  "cat": "кирха",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Единственная действующая лютеранская кирха Беларуси, неоготика XIX века. Небольшая, с органом; концерты бывают реже, но акустика камерная и очень чистая."
 },
 {
  "id": 910021,
  "name": "Костёл Девы Марии Ангельской и монастырь францисканцев",
  "lat": 53.671985,
  "lng": 23.822247,
  "addr": "Гродно, ул. Огородная, 5",
  "cat": "костёл",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Барочный костёл XVII века на другом берегу Немана, с монастырским корпусом. Тихое место с видом на город — почти без туристов."
 },
 {
  "id": 910022,
  "name": "Корпус ГрГУ имени Янки Купалы, увитый диким виноградом",
  "lat": 53.684994,
  "lng": 23.840073,
  "addr": "Гродно, ул. Ожешко, 22",
  "cat": "здание",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Бывшая Мариинская женская гимназия конца XIX века, фасад полностью затянут девичьим виноградом. Первые лозы вдоль чугунной ограды высадили ещё гимназистки в XIX веке. Летом стена ярко-зелёная, в сентябре–октябре становится багрово-красной — тогда сюда и стоит приходить за кадром."
 },
 {
  "id": 910023,
  "name": "Августовский канал · шлюз «Немново»",
  "lat": 53.869476,
  "lng": 23.757476,
  "addr": "д. Немново, Гродненский р-н, ~35 км от Гродно",
  "cat": "канал",
  "group": "Из маршрутов",
  "pic": "/фото-точек/nemnovo.jpg",
  "text": "Судоходный канал 1824–1839 годов, соединивший Неман с Вислой, — памятник гидротехники, часть которого действует до сих пор. «Немново» — самый эффектный узел на белорусском участке: четырёхкамерный шлюз, единственный такой на канале. Летом ходят прогулочные теплоходы, рядом велодорожки и байдарки. Отдельная поездка на полдня из Гродно.",
  "author": "фото автора маршрута"
 },
 {
  "id": 910025,
  "name": "Парк-отель «Версаль»",
  "lat": 53.500866,
  "lng": 27.747423,
  "addr": "аг. Сергеевичи, Пуховичский р-н, ~70 км от Минска",
  "cat": "парк-отель",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Усадебный комплекс на берегу Сергеевского озера, в 70 км от Минска. Регулярный французский парк со смотровой площадкой, мини-зоопарк, дворец с парадной лестницей. Место рассчитано на отдых с ночёвкой, но по парку пускают и погулять."
 },
 {
  "id": 910024,
  "name": "Музей автозаправочных колонок",
  "lat": 53.708177,
  "lng": 23.839407,
  "addr": "Гродно, ул. Победы",
  "cat": "музей",
  "group": "Из маршрутов",
  "pic": "",
  "text": "Частная коллекция бензоколонок разных эпох под открытым небом — редкая городская странность, которую стоит увидеть по дороге из города."
 }
];

const KUDIN = 'https://kudin.by';
const PLACES_TTL = 6 * 60 * 60 * 1000;   // список памятников меняется раз в месяцы
const DETAIL_TTL = 24 * 60 * 60 * 1000;

// расстояние между двумя точками на земле, километры
// Всё жильё страны с точными координатами — один список на восемь минут.
// Собирается из тех же запросов, которыми пользуется обычный поиск, поэтому
// отдельной нагрузки на источники почти нет: их ответы и так лежат в памяти.
const STAY_REGIONS = ['minsk','minsk-obl','brest','gomel','grodno','vitebsk','mogilev'];
const STAY_TYPES = ['flat','usadba','cottage'];
async function stayIndex(){
  return cached('idx|stay', async ()=>{
    const было = new Set(), все = [];
    const пары = [];
    STAY_REGIONS.forEach(r => STAY_TYPES.forEach(t => пары.push([r, t])));
    // По четыре пары за раз, а не двадцать одна разом: залп из шестидесяти
    // запросов к трём сайтам — верный способ получить отказ по частоте.
    const части = await mapLimit(пары, 4, ([r, t]) =>
      runSearchQuery(new URLSearchParams({ region:r, city:'', type:t,
        rooms:'', guests:'', max:'', source:'both' }))
        .then(d => ({ t, r, items: d.items || [] })).catch(()=>({ t, r, items: [] })));
    части.forEach(d => d.items.forEach(x => {
      // Точных координат нет у всего Realt: он ставит метку у центра города.
      // Отбрасывать их — значит выкинуть целый источник из трёх, поэтому
      // берём, но расстояние по ним считается приблизительное. В карточке
      // такие помечены словом «около».
      if(!x.lat || !x.lng || было.has(x.link)) return;
      было.add(x.link);
      // сам объявление ни вида, ни области не несёт — помечаем тем запросом,
      // который его принёс: по области потом выбирается, куда ведёт кнопка
      все.push(Object.assign({}, x, { vid: d.t, reg: d.r }));
    }));
    return все;
  });
}

// Жильё рядом с точкой: общий список страны плюс отдельный запрос по
// ближайшим городам. Одним списком не обойтись — Kufar отдаёт не больше
// двухсот объявлений на запрос, и в областной выдаче городские помещаются
// не полностью.
async function stayNearPoint(lat, lng, r, вид){
  if(!lat || !lng) return { items: [], region: '' };
  let items = [], region = '';
  try{
    const части = [await stayIndex()];
    const виды = вид ? [вид] : STAY_TYPES;
    const рядом = townsNear(lat, lng, 75, 8);
    const пары = [];
    рядом.forEach(g => виды.forEach(t => пары.push({ g, t })));
    const ещё = await Promise.all(пары.map(({ g, t }) =>
      runSearchQuery(new URLSearchParams({ region:g.region, city:g.town, type:t,
        rooms:'', guests:'', max:'', source:'both' }))
        .then(d => (d.items||[]).map(x => Object.assign({}, x, { vid: t, reg: g.region })))
        .catch(()=>[])));
    части.push([].concat(...ещё));

    const было = new Set();
    items = [].concat(...части)
      .filter(x => (!вид || x.vid === вид) && x.lat && x.lng
                   && !было.has(x.link) && было.add(x.link) !== null)
      .map(x => Object.assign({}, x, { km: Math.round(distKm(lat, lng, x.lat, x.lng) * 10) / 10 }))
      .filter(x => x.km <= r)
      .sort((a, b) => a.price - b.price);

    // Куда вести кнопку «Показать все варианты в области»: туда, где это
    // жильё и стоит. Считаем по тридцати ближайшим — дальние могут быть уже
    // из соседней области и перетянуть счёт на себя.
    const счёт = {};
    items.slice().sort((a, b) => a.km - b.km).slice(0, 30)
         .forEach(x => { if(x.reg) счёт[x.reg] = (счёт[x.reg] || 0) + 1; });
    const победитель = Object.keys(счёт).sort((a, b) => счёт[b] - счёт[a])[0];
    const город = nearestTown(lat, lng);
    region = победитель || ((город && город.km <= 60) ? город.region : nearestRegion(lat, lng));
  }catch(e){}
  if(!region) region = nearestRegion(lat, lng);
  return { items, region };
}

// какой области принадлежит точка — по ближайшему областному центру
const REGION_CENTERS = [
  ['minsk',      53.9023, 27.5619], ['minsk-obl', 53.9023, 27.5619],
  ['brest',      52.0976, 23.7341], ['grodno',    53.6884, 23.8258],
  ['vitebsk',    55.1904, 30.2049], ['gomel',     52.4345, 30.9754],
  ['mogilev',    53.9007, 30.3313],
];
// Ближайший к точке город, для которого мы знаем координаты, и область,
// в которой он лежит. Нужен для подбора жилья рядом с достопримечательностью:
// поиск по областному центру не находит ни Лиду, ни Ошмяны, ни Быхов.
function регионГорода(town){
  for(const k in CITIES_MAP) if(CITIES_MAP[k].indexOf(town) >= 0) return k;
  return 'minsk';
}

// Все знакомые нам города в округе, от ближнего к дальнему. Одного мало:
// Полоцк и Новополоцк стоят в восьми километрах друг от друга, Борисов
// и Жодино — в двенадцати, и точка между ними теряла половину вариантов.
function townsNear(lat, lng, maxKm, limit){
  const out = [];
  for(const name in TOWN_CENTERS){
    const c = TOWN_CENTERS[name];
    const d = distKm(lat, lng, c[0], c[1]);
    if(d <= (maxKm || 45)) out.push({ town: name, region: регионГорода(name), km: Math.round(d * 10) / 10 });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit || 5);
}

// Разряд точки: чем меньше число, тем выше в списке. Раскладка по группам
// справочника, а не по отдельным категориям — групп восемь, и они не растут.
const РАЗРЯД = {
  'Храмы': 0, 'Дворцы и усадьбы': 0, 'Укрепления': 0,
  'Строения': 1, 'Военные': 1, 'Ландшафтные': 1, 'Разное': 1,
  'Культурные': 2               // памятники и музеи — их и просили убрать вниз
};
// Наши собственные точки идут отдельной группой «Из маршрутов», и среди
// них есть и костёлы, и скульптуры. Для них смотрим на категорию.
const КАТ_ВЕРХ = /костёл|костел|церк|храм|часовн|собор|кирха|синагог|монастыр|дворец|усадьб|замок|крепост/i;
const КАТ_НИЗ  = /скульптур|арт-объект|памятник|музей|скамейк|мурал|граффити/i;
function разряд(p){
  const г = РАЗРЯД[p.group];
  if(г !== undefined) return г;
  const к = String(p.cat || '');
  if(КАТ_ВЕРХ.test(к)) return 0;
  if(КАТ_НИЗ.test(к))  return 2;
  return 1;
}

function nearestTown(lat, lng){
  return townsNear(lat, lng, 1e9, 1)[0] || null;
}

function nearestRegion(lat, lng){
  let best = 'minsk', bd = Infinity;
  for(const [key, a, o] of REGION_CENTERS){
    if(key === 'minsk-obl') continue;
    const d = distKm(lat, lng, a, o);
    if(d < bd){ bd = d; best = key; }
  }
  // вокруг Минска жильё чаще лежит в области, а не в городе
  if(best === 'minsk' && bd > 18) return 'minsk-obl';
  return best;
}

// Чем считать два объявления одним. Ссылка не годится: Flatbook отдаёт
// один и тот же дом с разных поддоменов, и адреса выходят разными.
// Убираем поддомен, а для верности сверяем ещё телефон и цену.
function ключОбъявления(x){
  const ссылка = String(x.link || '')
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z0-9-]+\.(flatbook\.by)/, '$1')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if(ссылка) return x.src + '|' + ссылка;
  return x.src + '|' + (x.phone||'') + '|' + (x.price||'') + '|' + (x.title||'');
}

function distKm(a1, o1, a2, o2){
  const t = Math.PI / 180;
  const x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x/2)**2 + Math.cos(a1*t) * Math.cos(a2*t) * Math.sin(y/2)**2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Приводим название к виду, по которому сравниваем имя файла и имя точки:
// без кавычек, знаков и разницы между «е» и «ё». «Парк-отель «Версаль»» и
// файл «Парк-отель Версаль.jpg» после этого совпадают.
function normPlace(t){
  return String(t || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[«»"'`.,:;!?()\[\]—–_-]/g, ' ')
    .replace(/\s+\d+$/, '')          // «Название 2.jpg» — второй снимок той же точки
    .replace(/\s+/g, ' ').trim();
}

// Что лежит в папке со снимками. Перечитываем раз в минуту: положили файл —
// через минуту он на сайте, перезапускать ничего не надо.
let PHOTO_DIR = { at: 0, byName: {} };
function ownPhotos(){
  if(Date.now() - PHOTO_DIR.at < 60 * 1000) return PHOTO_DIR.byName;
  const byName = {};
  try{
    for(const f of fs.readdirSync(__dirname + '/фото-точек')){
      if(!/\.(jpg|jpeg|png|webp)$/i.test(f)) continue;
      const key = normPlace(f.replace(/\.[^.]+$/, ''));
      if(key && !byName[key]) byName[key] = f;
    }
  }catch(e){}
  PHOTO_DIR = { at: Date.now(), byName };
  return byName;
}

// Свой снимок побеждает снимок из справочника: его кладут осознанно,
// чтобы заменить неудачный кадр или добавить недостающий.
function attachOwn(list){
  const m = ownPhotos();
  for(const k in m){
    return list.map(p => {
      const f = m[normPlace(p.name)];
      return f ? Object.assign({}, p, { pic: '/фото-точек/' + f,
                                        author: p.author || 'фото автора маршрута' }) : p;
    });
  }
  return list;                       // папка пуста — ничего не трогаем
}

async function placesRaw(){
  const raw = await cached('raw|places', async ()=>{
    const [pts, filters] = await Promise.all([
      fetch(KUDIN + '/api/v1/points/',  {headers:{'User-Agent':UA}}).then(r=>r.json()),
      fetch(KUDIN + '/api/v1/filters/', {headers:{'User-Agent':UA}}).then(r=>r.json()),
    ]);
    // разворачиваем дерево категорий в плоский словарь «номер → название»
    const cat = {}, group = {};
    (Array.isArray(filters)?filters:[]).forEach(g=>{
      (g.values||[]).forEach(v=>{
        cat[v.id] = v.name;
        (v.items||[]).forEach(i=>{ cat[i.id] = i.name; group[i.id] = v.name; });
      });
    });
    const list = (Array.isArray(pts)?pts:[]).map(p=>{
      const c = String(p.coords||'').split(',').map(Number);
      const fid = p.filter ? +Object.values(p.filter)[0] : 0;
      return { id:p.id, code:p.code, name:(p.name||'').trim(),
               lat:c[0], lng:c[1], addr:(p.adress||'').trim(), rating:+p.rating||0,
               pic: p.picture ? (KUDIN + p.picture) : '',
               cat: cat[fid] || '', group: group[fid] || cat[fid] || '' };
    });
    // Точку показываем всегда, если есть название и координаты.
    const clean = list.filter(p => p.name && p.lat && p.lng)
      .map(p => ОБЛОЖКИ[p.id] ? Object.assign({}, p, { pic: KUDIN + ОБЛОЖКИ[p.id] }) : p);
    return clean.concat(EXTRA_PLACES);
  }, PLACES_TTL);
  // Привязку делаем поверх кэша, а не внутри: иначе новый файл ждал бы
  // шести часов, пока справочник перечитается.
  return attachOwn(raw);
}

// короткое описание одной точки; полный текст остаётся на kudin.by
async function placeDetail(id){
  // у собственных точек описание своё, ходить за ним некуда
  const own = EXTRA_PLACES.find(p => String(p.id) === String(id));
  if(own) return { id: own.id, name: own.name, years: '', addr: own.addr,
                   text: own.text, full: false, pics: [own.pic], more: own.src || '' };
  return cached('raw|place|' + id, async ()=>{
    const j = await (await fetch(KUDIN + '/api/v1/detail/?id=' + encodeURIComponent(id),
                                 {headers:{'User-Agent':UA}})).json();
    const it = (j && j.item) || {};
    const text = String(it.description || '')
      .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return { id: +id, name: it.name || '', years: it.years || '', addr: it.addr || '',
             text: text.length > 420 ? (text.slice(0, 420).replace(/[\s,;:—-]+\S*$/, '') + '…') : text,
             full: text.length > 420,
             // Снимки лежат в двух местах: у самой точки и у каждой поездки.
             // Берём отовсюду, повторы отбрасываем — из них собирается слайдер.
             pics: (function(){
               const все = [];
               const добавить = a => (a || []).forEach(u => { if(u && !все.includes(u)) все.push(u); });
               добавить(it.prevpics);
               (j.visits || []).forEach(v => добавить(v.prevpics));
               return все.slice(0, 12).map(x => KUDIN + x);
             })(),
             more: KUDIN + '/?point=' + id };
  }, DETAIL_TTL);
}

// ── Кэш результатов поиска ────────────────────────────────────────────────
// Одинаковые запросы в течение 8 минут отдаём из памяти: и быстрее, и источники
// не получают шквал обращений, если на сайт разом придёт много людей.
const CACHE_TTL = 8 * 60 * 1000;
const CACHE_MAX = 300;
const SEARCH_CACHE = new Map();   // ключ -> { at, data }
const INFLIGHT = new Map();       // ключ -> Promise (чтобы не считать одно и то же дважды)

function cacheKey(u){
  return u.pathname + '?' + [...u.searchParams.entries()]
    .sort((a,b)=> a[0] < b[0] ? -1 : 1)
    .map(kv => kv[0] + '=' + kv[1]).join('&');
}
// Пустой ответ живёт в памяти меньше минуты, а не полный срок. Источник
// мог просто не ответить один раз — держать после этого «источника нет»
// восемь минут значит показывать всем пустую выдачу на ровном месте.
const EMPTY_TTL = 45 * 1000;
const isEmpty = d => Array.isArray(d) ? d.length === 0
                   : (d && Array.isArray(d.items) ? d.items.length === 0 : false);

async function cached(key, fn, ttl){
  const life = ttl || CACHE_TTL;
  const hit = SEARCH_CACHE.get(key);
  if(hit && Date.now() - hit.at <= (isEmpty(hit.data) ? Math.min(EMPTY_TTL, life) : life)) return hit.data;
  if(hit) SEARCH_CACHE.delete(key);
  if(INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async ()=>{
    try{
      const data = await fn();
      SEARCH_CACHE.set(key, { at: Date.now(), data });
      if(SEARCH_CACHE.size > CACHE_MAX){
        let oldK = null, oldT = Infinity;
        for(const [k,v] of SEARCH_CACHE) if(v.at < oldT){ oldT = v.at; oldK = k; }
        if(oldK) SEARCH_CACHE.delete(oldK);
      }
      return data;
    } finally { INFLIGHT.delete(key); }
  })();
  INFLIGHT.set(key, p);
  return p;
}

// сам поиск по параметрам запроса — вынесен, чтобы им же пользовался прогрев
function runSearchQuery(q){
  const name = (q.get('name')||'').trim();
  const minP = +(q.get('min')||0);
  return name
    ? searchByName(name, q.get('type')||'flat', +(q.get('max')||0), minP)
    : search(
        q.get('region')||'brest',
        (q.get('city')||'').trim(),
        q.get('type')||'flat',
        q.get('rooms')||'',
        +(q.get('max')||0),
        +(q.get('guests')||0),
        q.get('source')||'both',
        (q.get('amen')||'').split(',').filter(Boolean),
        minP
      );
}


// ── Рейс: страница для телефона ───────────────────────────────────────────
// Отслеживаем один конкретный рейс. Номер и аэропорты можно поменять здесь.
const РЕЙС = process.env.РЕЙС || 'WZ1309';
const АЭРОПОРТЫ = {
  KUF: { name: 'Самара (Курумоч)', lat: 53.504722, lon: 50.164444, tz: 4, станцияЯндекс: '9600380' },
  MSQ: { name: 'Минск (Национальный)', lat: 53.882500, lon: 28.030731, tz: 3 },
};
const РЕЙС_TTL = 60 * 1000;

const безПробелов = t => String(t || '').replace(/\s+/g, '').toUpperCase();

// Курумоч: табло вылета. Данные лежат JSON-ом внутри страницы Яндекса.
async function рейсВылет(номер){
  const html = await (await fetch('https://rasp.yandex.ru/station/'
    + АЭРОПОРТЫ.KUF.станцияЯндекс + '/?event=departure',
    {headers:{'User-Agent':UA,'Accept-Language':'ru'}})).text();
  const сПробелом = номер.replace(/^([A-Za-z]{2})\s*/, '$1 ').toUpperCase();
  const i = html.indexOf('"number":"' + сПробелом + '"');
  if(i === -1) return { error: 'нет в табло вылета' };
  const нач = html.lastIndexOf('{"eventDt"', i);
  if(нач === -1) return { error: 'не разобрал табло вылета' };
  let г = 0, кон = -1;
  for(let k = нач; k < html.length; k++){
    if(html[k] === '{') г++;
    else if(html[k] === '}'){ г--; if(!г){ кон = k; break; } }
  }
  let o;
  try{ o = JSON.parse(html.slice(нач, кон + 1)); }catch(e){ return { error: 'не разобрал запись рейса' }; }
  const st = o.status || {};
  return { plan:(o.eventDt && o.eventDt.datetime) || null, actual: st.actualDt || null,
           status: st.status || null, terminal: st.actualTerminalName || null,
           desks: st.checkInDesks || null,
           // у Яндекса знак обратный: положительное значит «раньше плана»
           delay: typeof o.minutesBetweenEventDtAndActualDt === 'number'
                  ? -o.minutesBetweenEventDtAndActualDt : null };
}

// Минск: табло прилёта, чистый JSON. Номер приходит вместе с совместным
// («WZ1309 / B2-2039»), поэтому ищем вхождение, а не точное совпадение.
async function рейсПрилёт(номер){
  const raw = await (await fetch('https://airport.by/ru/flights/arrival',
    {headers:{'User-Agent':UA,'Accept-Language':'ru','X-Requested-With':'XMLHttpRequest'}})).text();
  let d;
  try{ d = JSON.parse(raw); }catch(e){ return { error: 'табло отдало не JSON' }; }
  const список = Array.isArray(d) ? d : (d.flights || d.data || []);
  const row = список.find(f => безПробелов(f.flight).includes(безПробелов(номер)));
  if(!row) return { error: 'нет в табло прилёта' };
  return { plan: row.plan || null, fact: row.fact || null, delayedTo: row.DelayedTo || null,
           status: (row.status && row.status.title) || '', statusId: row.status && row.status.id,
           delayed: !!row.isDelayed, canceled: !!row.isCanceled,
           gate: row.gate || null, baggage: row.sector_bag_claim || null,
           airline: row.airline && row.airline.title, aircraft: row.aircraft && row.aircraft.title,
           from: ((row.airport && row.airport.title) || '').trim() };
}

// Ред Вингс: своё табло. Отдельного запроса за данными нет, всё в разметке.
// В ячейке времени два места: первое — по расписанию, второе — изменённое.
async function рейсАвиакомпания(номер){
  const html = await (await fetch('https://flyredwings.com/flight-board/',
    {headers:{'User-Agent':UA,'Accept-Language':'ru'}})).text();
  const ключ = 'data-value="' + номер.replace(/^([A-Za-z]{2})\s*/, '$1 ').toUpperCase() + '"';
  const i = html.indexOf(ключ);
  if(i === -1) return { error: 'нет на табло Ред Вингс' };
  const a = html.lastIndexOf('<tr', i), b = html.indexOf('</tr>', i);
  if(a === -1 || b === -1) return { error: 'не разобрал строку табло' };
  const строка = html.slice(a, b + 5).replace(/\s+/g, ' ');
  const ячейка = к => { const j = строка.indexOf('cell--' + к); if(j === -1) return '';
                        return строка.slice(j, строка.indexOf('</td>', j)); };
  const времена = кусок => (кусок.match(/<span class="cell-time__i">([\s\S]*?)<\/span>/g) || [])
    .map(x => x.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() || null);
  const в = времена(ячейка('departure')), п = времена(ячейка('destination'));
  const ст = ячейка('status');
  return { planDep: в[0] || null, factDep: в[1] || null,
           planArr: п[0] || null, factArr: п[1] || null,
           status: ст.slice(ст.indexOf('>') + 1).replace(/<[^>]+>/g, ' ')
                     .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() || null };
}

async function рейсСводка(номер){
  return cached('рейс|' + номер, async ()=>{
    const [в, п, а] = await Promise.all([
      рейсВылет(номер).catch(e => ({ error: String(e).slice(0, 90) })),
      рейсПрилёт(номер).catch(e => ({ error: String(e).slice(0, 90) })),
      рейсАвиакомпания(номер).catch(e => ({ error: String(e).slice(0, 90) })),
    ]);
    const вылетел = в.status === 'departed' || в.status === 'airborne';
    const сел = п.statusId === 'arrived' || /прибыл|приземл/i.test(п.status || '');
    return { номер, снято: Date.now(), вылет: в, прилёт: п, авиакомпания: а,
             вВоздухе: вылетел && !сел, сел };
  }, РЕЙС_TTL);
}

// Время всегда показываем в часовом поясе того аэропорта, о котором речь:
// Самара живёт на час впереди Минска, и путать их нельзя.
function времяВ(iso, tz){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d)) return '—';
  const l = new Date(d.getTime() + d.getTimezoneOffset() * 60000 + tz * 3600000);
  return String(l.getHours()).padStart(2, '0') + ':' + String(l.getMinutes()).padStart(2, '0');
}

function рейсPage(d){
  const в = d.вылет || {}, п = d.прилёт || {}, а = d.авиакомпания || {};
  const опоздание = в.delay && в.delay > 5 ? в.delay : null;
  const задержан = п.delayed || в.status === 'delayed' || !!опоздание
                   || (а.factDep && а.factDep !== а.planDep);
  const мин = n => { if(n == null) return ''; const h = Math.floor(Math.abs(n)/60), m = Math.abs(n)%60;
                     return (h ? h + ' ч ' : '') + m + ' мин'; };

  let полоса, вид;
  if(п.canceled){ вид = 'плохо'; полоса = 'Рейс отменён'; }
  else if(d.сел){ вид = 'ок'; полоса = 'Приземлился в ' + времяВ(п.fact || п.plan, 3) + ' по Минску'; }
  else if(d.вВоздухе){ вид = 'ок'; полоса = 'В воздухе · посадка в '
    + времяВ(п.fact || п.delayedTo || п.plan, 3) + ' по Минску'; }
  else if(задержан){ вид = 'плохо'; полоса = 'Задержан · вылет в '
    + (а.factDep || времяВ(в.actual || в.plan, 4)) + ' по Самаре'
    + (опоздание ? (' · опоздание ' + мин(опоздание)) : ''); }
  else if(в.error && п.error && а.error){ вид = 'плохо'; полоса = 'Рейса нет в сегодняшних табло'; }
  else { вид = 'ровно'; полоса = 'По расписанию'; }

  const плитка = (k, v, n) => '<div class="p"><div class="k">' + esc(k) + '</div>'
    + '<div class="v">' + esc(v) + '</div>'
    + (n ? ('<div class="n">' + esc(n) + '</div>') : '') + '</div>';

  const источник = (имя, ош, что) => '<span class="' + (ош ? 'нет' : 'есть') + '">'
    + esc(имя) + ': ' + esc(ош || что || 'на связи') + '</span>';

  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex, nofollow">'
    + '<meta http-equiv="refresh" content="60">'
    + '<title>Рейс ' + esc(d.номер) + '</title>'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{background:#faf7f3;color:#1c1917;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:18px 14px 40px}'
    + '.w{max-width:560px;margin:0 auto}'
    + 'h1{font-size:26px;letter-spacing:-.02em;margin:0 0 2px}'
    + '.sub{color:#57534e;font-size:14px;margin-bottom:16px}'
    + '.b{border-radius:12px;padding:16px 18px;font-size:17px;font-weight:700;margin-bottom:16px;'
    +   'border-left:5px solid #9c948c;background:#f0ebe4}'
    + '.b.ок{border-color:#3d5a40;background:#eef3ee}'
    + '.b.плохо{border-color:#9a3412;background:#fbeee8}'
    + '.g{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}'
    + '.p{background:#fff;border:1px solid #e9e2d8;border-radius:12px;padding:12px 14px}'
    + '.k{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#9c948c;margin-bottom:4px}'
    + '.v{font-size:21px;font-weight:700}'
    + '.n{font-size:12.5px;color:#9c948c;margin-top:2px}'
    + '.src{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}'
    + '.src span{font-size:12px;padding:5px 10px;border-radius:999px;background:#fff;border:1px solid #e9e2d8;color:#9c948c}'
    + '.src .есть{border-color:#3d5a40;color:#3d5a40}'
    + '.src .нет{border-color:#9a3412;color:#9a3412}'
    + '.note{font-size:13px;color:#57534e;background:#f0ebe4;border-left:4px solid #9c948c;'
    +   'border-radius:0 8px 8px 0;padding:11px 14px}'
    + '@media (prefers-color-scheme:dark){body{background:#14110e;color:#f6f2ed}'
    +   '.p{background:#1d1916;border-color:#332c25}.b{background:#1d1916}'
    +   '.src span{background:#1d1916;border-color:#332c25}.note{background:#1d1916}'
    +   '.sub,.n,.note{color:#c2b7ab}}'
    + '</style></head><body><div class="w">'
    + '<h1>Рейс ' + esc(d.номер.replace(/^([A-Za-z]{2})/, '$1 ')) + '</h1>'
    + '<p class="sub">' + esc(АЭРОПОРТЫ.KUF.name) + ' → ' + esc(АЭРОПОРТЫ.MSQ.name)
    +   (п.aircraft ? (' · ' + esc(п.aircraft)) : '') + '</p>'
    + '<div class="b ' + вид + '">' + esc(полоса) + '</div>'
    + '<div class="g">'
    +   плитка('Вылет по плану', времяВ(в.plan, 4), 'Самара')
    +   плитка('Вылет ожидается', а.factDep || времяВ(в.actual || в.plan, 4),
              опоздание ? ('позже на ' + мин(опоздание)) : (в.status === 'on_time' ? 'без изменений' : ''))
    +   плитка('Посадка по плану', времяВ(п.plan, 3), 'Минск')
    +   плитка('Посадка ожидается', времяВ(п.fact || п.delayedTo || п.plan, 3), п.status || '')
    +   (в.desks ? плитка('Стойки в Курумоче', в.desks, в.terminal ? ('терминал ' + в.terminal) : '') : '')
    +   ((п.gate || п.baggage) ? плитка('В Минске', п.gate ? ('выход ' + п.gate) : '—',
              п.baggage ? ('багаж, лента ' + п.baggage) : '') : '')
    + '</div>'
    + '<div class="src">'
    +   источник('Курумоч', в.error, '')
    +   источник('Минск', п.error, '')
    +   источник('Ред Вингс', а.error, а.status)
    + '</div>'
    + '<p class="note">Страница сама обновляется раз в минуту. Три табло: аэропорт вылета, '
    + 'аэропорт прилёта и сама авиакомпания — задержку первым показывает кто-то из первых двух, '
    + 'а точное время посадки знает только Минск.</p>'
    + '</div></body></html>';
}

// ── Городские страницы для поисковиков ────────────────────────────────────
// Google не ждёт, пока страница дорисуется скриптом, поэтому для каждого
// областного центра отдаём готовый HTML со списком вариантов.
// Адреса: /minsk, /brest, /gomel, /grodno, /vitebsk, /mogilev, /minsk-obl
// Уточнения к городским страницам: /minsk-nedorogo, /brest-usadby и так далее.
// Данные для них уже лежат в памяти, поэтому страницы почти ничего не стоят,
// а в поиске это десятки адресов вместо семи.
const PAGE_KINDS = {
  '':            { type:'flat',    max:0,  what:'Квартиры на сутки',        extra:'' },
  'nedorogo':    { type:'flat',    max:70, what:'Недорогие квартиры на сутки',
                   extra:' до 70 рублей' },
  'usadby':      { type:'usadba',  max:0,  what:'Усадьбы на сутки',          extra:'' },
  'kottedzhi':   { type:'cottage', max:0,  what:'Коттеджи и дома на сутки',  extra:'' },
};

const CITY_PAGES = {
  'minsk':     { city:'Минск',    where:'в Минске',            what:'Квартиры на сутки' },
  'brest':     { city:'Брест',    where:'в Бресте',            what:'Квартиры на сутки' },
  'gomel':     { city:'Гомель',   where:'в Гомеле',            what:'Квартиры на сутки' },
  'grodno':    { city:'Гродно',   where:'в Гродно',            what:'Квартиры на сутки' },
  'vitebsk':   { city:'Витебск',  where:'в Витебске',          what:'Квартиры на сутки' },
  'mogilev':   { city:'Могилёв',  where:'в Могилёве',          what:'Квартиры на сутки' },
  'minsk-obl': { city:'Минская область', where:'в Минской области', what:'Жильё на сутки' }
};

const esc = t => String(t==null?'':t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SRC_TITLE = { Kufar:'Kufar', Realt:'Realt', Flatbook:'Flatbook', H101:'101Hotels' };
const srcTitle = v => SRC_TITLE[v] || v || 'источнике';

// разбираем адрес вида 'brest-usadby' на город и уточнение
function parseCitySlug(path){
  if(CITY_PAGES[path]) return { city: path, kind: '' };
  for(const k in PAGE_KINDS){
    if(!k) continue;
    if(path.endsWith('-' + k)){
      const city = path.slice(0, -(k.length + 1));
      if(CITY_PAGES[city]) return { city: city, kind: k };
    }
  }
  return null;
}

// Человеческий кусок адреса из названия: «Мирский замок» → «mirskij-zamok».
const ЛАТ = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i',
  'й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu',
  'я':'ya','і':'i','ў':'u','’':''};
// «1 вариант», «24 варианта», «78 вариантов» — иначе текст читается
// как машинный перевод и подрывает доверие к цифрам рядом.
function скл(n, одна, две, много){
  const a = Math.abs(n) % 100, b = a % 10;
  if(a > 10 && a < 20) return много;
  if(b > 1 && b < 5) return две;
  if(b === 1) return одна;
  return много;
}
function вариантов(n){ return n + ' ' + скл(n, 'вариант', 'варианта', 'вариантов'); }

function slugify(name){
  return String(name || '').toLowerCase().split('')
    .map(c => (ЛАТ[c] !== undefined ? ЛАТ[c] : (/[a-z0-9]/.test(c) ? c : '-')))
    .join('').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// Готовые страницы мест держим десять минут: их 798, поисковик обходит их
// подряд, и собирать каждую заново — лишняя работа и лишние запросы к
// источникам жилья.
const MESTO_HTML = new Map();
const MESTO_TTL = 10 * 60 * 1000;
async function mestoPage(id){
  const было = MESTO_HTML.get(String(id));
  if(было && Date.now() - было.at < MESTO_TTL) return было.html;
  const html = await mestoPageBuild(id);
  if(html){
    if(MESTO_HTML.size > 900) MESTO_HTML.clear();
    MESTO_HTML.set(String(id), { at: Date.now(), html });
  }
  return html;
}

// Страница одного места. Отдаётся сервером целиком: поисковик не выполняет
// наш скрипт, а раздел «Что посетить» без этого для него не существует.
async function mestoPageBuild(id){
  const list = await placesRaw();
  const p = list.find(x => String(x.id) === String(id));
  if(!p) return null;

  // Оба запроса идут наружу и друг от друга не зависят: раньше страница
  // ждала их по очереди и открывалась вдвое дольше.
  const [d, рядом] = await Promise.all([
    placeDetail(id).catch(() => ({ text:'', years:'', pics:[], more: KUDIN + '/?point=' + id })),
    stayNearPoint(p.lat, p.lng, 30, ''),
  ]);
  const своё = EXTRA_PLACES.find(x => String(x.id) === String(id));
  const текст = (своё && своё.text) || d.text || '';
  const жильё = рядом.items.slice(0, 8);
  const цены = рядом.items.map(x => x.price).filter(x => x > 0).sort((a,b)=>a-b);

  // Обложка всегда первая: её выбирали руками, чтобы в кадре не было людей.
  const кадры = [];
  if(p.pic) кадры.push(p.pic);
  (d.pics || []).forEach(u => { if(u && !кадры.includes(u)) кадры.push(u); });

  // Первый снимок с адресом, остальные — только с пометкой: браузер их не
  // тронет, пока человек не долистает. Иначе страница тянула бы мегабайты.
  const снимки = !кадры.length ? ''
    : (кадры.length === 1
        ? ('<img class="hero" src="' + esc(кадры[0]) + '" alt="' + esc(p.name) + '">')
        : ('<div class="ph" id="ph">'
           + кадры.map((u, i) => '<img class="hero' + (i ? '' : ' on') + '"'
               + (i ? (' data-src="' + esc(u) + '"') : (' src="' + esc(u) + '"'))
               + ' alt="' + esc(p.name) + '">').join('')
           + '<button class="ph-b ph-l" type="button" aria-label="Предыдущий снимок">‹</button>'
           + '<button class="ph-b ph-r" type="button" aria-label="Следующий снимок">›</button>'
           + '<span class="ph-n" id="phn">1/' + кадры.length + '</span>'
           + '</div>'));

  const где = [p.addr, p.cat].filter(Boolean).join(' · ');
  const title = p.name + (p.addr ? (', ' + p.addr) : '') + ' — что посмотреть и где переночевать рядом';
  const desc = (текст ? текст.slice(0, 150).replace(/\s+\S*$/, '') + '. ' : '')
    + (жильё.length
        ? ('Жильё рядом: ' + вариантов(рядом.items.length) + ' от ' + цены[0] + ' BYN за сутки, ближайшее в ' + жильё[0].km + ' км.')
        : 'Координаты, маршрут в Яндекс.Картах и жильё поблизости.');
  const адрес = SITE_URL + '/mesto/' + p.id + '-' + slugify(p.name);
  const route = 'https://yandex.by/maps/?rtext=~' + p.lat + ',' + p.lng + '&rtt=auto';

  const карточки = жильё.map(function(x){
    const img = (x.photos && x.photos[0]) ? ('<img src="' + esc(x.photos[0]) + '" alt="" loading="lazy">')
                                          : '<div class="noimg">без фото</div>';
    return '<a class="c" href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">' + img
      + '<div class="b"><div class="p">' + x.price + ' BYN <small>/ сутки</small></div>'
      + '<div class="m"><span>' + (x.approx ? esc(x.area || 'рядом') : (x.km + ' км')) + '</span><span>' + esc(x.src) + '</span></div>'
      + '<h3>' + esc((x.title || '').slice(0, 70)) + '</h3></div></a>';
  }).join('');

  const рядомМеста = list
    .filter(x => x.id !== p.id && x.lat && x.lng && distKm(p.lat, p.lng, x.lat, x.lng) <= 25)
    .map(x => Object.assign({}, x, { km: Math.round(distKm(p.lat, p.lng, x.lat, x.lng) * 10) / 10 }))
    .sort((a, b) => a.km - b.km).slice(0, 8);

  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(desc) + '">'
    + '<meta name="robots" content="index,follow">'
    + '<meta name="theme-color" content="#9a3412">'
    + '<link rel="canonical" href="' + адрес + '">'
    + '<meta property="og:type" content="article">'
    + '<meta property="og:title" content="' + esc(p.name) + '">'
    + '<meta property="og:description" content="' + esc(desc) + '">'
    + '<meta property="og:url" content="' + адрес + '">'
    + (p.pic ? ('<meta property="og:image" content="' + esc(p.pic.startsWith('/') ? (SITE_URL + p.pic) : p.pic) + '">') : '')
    + '<script type="application/ld+json">'
    + JSON.stringify({ '@context':'https://schema.org', '@type':'TouristAttraction',
        name: p.name, description: текст.slice(0, 300) || undefined,
        image: p.pic ? (p.pic.startsWith('/') ? (SITE_URL + p.pic) : p.pic) : undefined,
        address: p.addr || undefined,
        geo: { '@type':'GeoCoordinates', latitude: p.lat, longitude: p.lng },
        url: адрес }).replace(/</g,'\\u003c')
    + '</' + 'script>'
    + '<style>'
    + '*{box-sizing:border-box}'
    + 'body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf7f3;color:#1c1917}'
    + '.w{max-width:900px;margin:0 auto;padding:22px 16px 60px}'
    + 'a{color:#9a3412}'
    + '.back{display:inline-block;margin:0 0 14px;padding:9px 17px;background:#fff;border:1px solid #e9e2d8;'
    +   'border-radius:999px;text-decoration:none;color:#1c1917;font-size:14.5px;font-weight:600}'
    + '.back:hover{border-color:#9a3412;color:#9a3412}'
    + 'h1{font-size:clamp(24px,4.6vw,36px);line-height:1.15;margin:0 0 6px;letter-spacing:-.02em}'
    + '.where{color:#57534e;margin:0 0 16px}'
    + '.hero{width:100%;max-height:460px;object-fit:cover;border-radius:14px;display:block;margin:0 0 16px}'
    + '.txt{max-width:70ch}'
    + '.facts{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}'
    + '.facts a,.facts span{background:#fff;border:1px solid #e9e2d8;border-radius:999px;padding:8px 15px;'
    +   'font-size:14px;text-decoration:none;color:#1c1917}'
    + '.cta{display:inline-block;background:#9a3412;color:#fff;text-decoration:none;font-weight:700;'
    +   'padding:13px 22px;border-radius:10px;margin:8px 0 4px}'
    + 'h2{font-size:20px;margin:30px 0 12px}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px}'
    + '.c{background:#fff;border:1px solid #e9e2d8;border-radius:14px;overflow:hidden;display:flex;'
    +   'flex-direction:column;text-decoration:none;color:inherit}'
    + '.c img{width:100%;height:150px;object-fit:cover;display:block}'
    + '.noimg{height:150px;display:flex;align-items:center;justify-content:center;background:#f0eae1;color:#9c948c;font-size:13px}'
    + '.c .b{padding:11px 13px 13px;display:flex;flex-direction:column;gap:5px}'
    + '.c .p{font-size:19px;font-weight:800}.c .p small{font-size:12.5px;font-weight:600;color:#9c948c}'
    + '.c .m{display:flex;gap:6px;flex-wrap:wrap}'
    + '.c .m span{font-size:12.5px;background:#f8f4ef;border:1px solid #f0eae1;border-radius:999px;padding:2px 9px;color:#57534e}'
    + '.c h3{font-size:14px;font-weight:600;margin:2px 0 0}'
    + '.ph{position:relative;margin:0 0 18px}'
    + '.ph .hero{display:none;margin:0}'
    + '.ph .hero.on{display:block}'
    + '.ph-b{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;'
    +   'border:0;border-radius:999px;background:rgba(28,25,23,.55);color:#fff;font-size:26px;'
    +   'line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}'
    + '.ph-b:hover{background:rgba(28,25,23,.8)}'
    + '.ph-l{left:10px}.ph-r{right:10px}'
    + '.ph-n{position:absolute;right:12px;bottom:12px;background:rgba(28,25,23,.6);color:#fff;'
    +   'font-size:12.5px;padding:3px 9px;border-radius:999px}'
    + '.near{display:flex;flex-wrap:wrap;gap:9px;margin-top:6px}'
    + '.near a{background:#fff;border:1px solid #e9e2d8;border-radius:999px;padding:7px 14px;'
    +   'font-size:14px;text-decoration:none;color:#1c1917}'
    + 'footer{margin-top:36px;color:#9c948c;font-size:13.5px;max-width:75ch}'
    + '@media (prefers-color-scheme:dark){body{background:#14110e;color:#f6f2ed}'
    +   '.c,.facts a,.facts span,.near a,.back{background:#1d1916;border-color:#332c25;color:#f6f2ed}'
    +   '.noimg{background:#2b251f}.where,.c .m span{color:#c2b7ab}a{color:#e2703a}}'
    + '</style></head><body><div class="w">'
    + '<a class="back" id="back" href="/?country=places">← Ко всем местам</a>'
    + '<h1>' + esc(p.name) + '</h1>'
    + (где ? ('<p class="where">' + esc(где) + '</p>') : '')
    + снимки
    + (текст ? '' : '')
    + (текст ? ('<div class="txt"><p>' + esc(текст) + '</p></div>') : '')
    + '<div class="facts">'
    +   '<a href="' + route + '" target="_blank" rel="noopener">Проложить маршрут →</a>'
    +   '<span>' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '</span>'
    + '</div>'
    + (жильё.length
        ? ('<h2>Где переночевать рядом</h2>'
           + '<p class="where">В 30 км отсюда сдаётся ' + вариантов(рядом.items.length)
           + (цены.length ? (', самый дешёвый — ' + цены[0] + ' BYN за сутки') : '')
           + '. Это объявления частников с Kufar, Realt и Flatbook, собранные в один список.</p>'
           + '<div class="grid">' + карточки + '</div>'
           + '<a class="cta" href="/?country=by&region=' + рядом.region + '&type=flat">Все варианты в области с фильтрами и картой →</a>')
        : ('<h2>Где переночевать рядом</h2>'
           + '<p class="where">В 30 километрах отсюда сдаваемого жилья сейчас нет. '
           + '<a href="/?country=by&region=' + рядом.region + '&type=flat">Посмотрите жильё в области</a> — '
           + 'до многих мест это час-полтора дороги.</p>'))
    + (рядомМеста.length
        ? ('<h2>Что ещё рядом</h2><div class="near">'
           + рядомМеста.map(x => '<a href="/mesto/' + x.id + '-' + slugify(x.name) + '">'
               + esc(x.name) + ' · ' + x.km + ' км</a>').join('')
           + '</div>')
        : '')
    + '<footer><p>Описание и снимок — из нашего же справочника архитектурного наследия Беларуси. '
    + 'Жильё мы не сдаём и комиссию не берём: показываем объявления '
    + 'с Kufar, Realt и Flatbook. Перед поездкой уточняйте детали у собственника.</p>'
    + '<p><a href="/?country=places">Все ' + list.length + ' мест на карте →</a></p></footer>'
    + '</div>'
    + '<script>'
    // Откуда пришли — самый честный ответ. Если по ссылке со стороны,
    // берём последний список, который человек собирал сам.
    + '(function(){var a=document.getElementById("back");if(!a)return;'
    + 'var свой=false, куда="";'
    + 'try{ var r=document.referrer;'
    + '  var п=r.slice(location.origin.length); if(r && r.indexOf(location.origin)===0 && /^\\/(\\?|$)/.test(п)){ куда=r; свой=true; }'
    + '  else { var с=localStorage.getItem("backTo");'
    + '         if(с && с.charAt(0)==="/") куда=с; } }catch(e){}'
    + 'if(куда) a.href=куда;'
    // Возврат «назад» по истории сохраняет ещё и место прокрутки:
    // человек оказывается на той же карточке, а не в начале ленты.
    + 'if(свой) a.addEventListener("click",function(e){e.preventDefault();history.back();});'
    + '})();</script>'
    + (кадры.length > 1 ? ('<script>'
      + '(function(){var к=document.getElementById("ph");if(!к)return;'
      + 'var с=к.querySelectorAll(".hero"), н=0, ном=document.getElementById("phn");'
      // Подставляем адрес только тому снимку, который вот-вот покажем, и
      // соседнему: браузер успевает загрузить его, пока человек смотрит.
      + 'function грузить(i){var э=с[i];if(э&&!э.src&&э.dataset.src)э.src=э.dataset.src;}'
      + 'function идти(ш){с[н].classList.remove("on");н=(н+ш+с.length)%с.length;'
      + '  грузить(н);грузить((н+1)%с.length);грузить((н-1+с.length)%с.length);'
      + '  с[н].classList.add("on");ном.textContent=(н+1)+"/"+с.length;}'
      + 'к.querySelector(".ph-l").addEventListener("click",function(){идти(-1);});'
      + 'к.querySelector(".ph-r").addEventListener("click",function(){идти(1);});'
      // на телефоне листают пальцем, а не кнопками
      + 'var x0=null;'
      + 'к.addEventListener("touchstart",function(e){x0=e.touches[0].clientX;},{passive:true});'
      + 'к.addEventListener("touchend",function(e){if(x0===null)return;'
      + '  var d=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(d)>40)идти(d<0?1:-1);},{passive:true});'
      + '})();</script>') : '')
    + '</body></html>';
}


// Порядок объезда: от первой точки каждый раз к ближайшей из оставшихся.
// Для трёх-пяти точек это тот же ответ, что и перебор всех вариантов.
function порядокОбъезда(list){
  if(list.length < 3) return list.slice();
  const left = list.slice(1), out = [list[0]];
  while(left.length){
    const cur = out[out.length - 1];
    let bi = 0, bd = Infinity;
    left.forEach(function(p, i){
      const d = distKm(cur.lat, cur.lng, p.lat, p.lng);
      if(d < bd){ bd = d; bi = i; }
    });
    out.push(left.splice(bi, 1)[0]);
  }
  return out;
}

// Страница «не нашлось». Отдаётся с кодом 404, чтобы поисковик понимал:
// такой страницы нет и запоминать её не надо.
function notFoundPage(путь, заголовок){
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Страница не нашлась — Поиск жилья на сутки</title>'
    + '<meta name="robots" content="noindex,follow">'
    + '<meta name="theme-color" content="#9a3412">'
    + '<style>'
    + 'body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;'
    +   'background:#faf7f3;color:#1c1917;display:flex;min-height:100vh;align-items:center}'
    + '.w{max-width:640px;margin:0 auto;padding:32px 20px}'
    + 'h1{font-size:clamp(24px,5vw,34px);line-height:1.15;margin:0 0 10px;letter-spacing:-.02em}'
    + 'p{color:#57534e;margin:0 0 22px}'
    + 'code{background:#f0eae1;border-radius:6px;padding:2px 7px;font-size:14px;word-break:break-all}'
    + '.links{display:flex;flex-wrap:wrap;gap:10px}'
    + '.links a{background:#fff;border:1px solid #e9e2d8;border-radius:999px;padding:10px 18px;'
    +   'text-decoration:none;color:#1c1917;font-weight:600;font-size:14.5px}'
    + '.links a.main{background:#9a3412;border-color:#9a3412;color:#fff}'
    + '@media (prefers-color-scheme:dark){body{background:#14110e;color:#f6f2ed}'
    +   'p{color:#c2b7ab}code{background:#2b251f}.links a{background:#1d1916;border-color:#332c25;color:#f6f2ed}'
    +   '.links a.main{background:#e2703a;border-color:#e2703a;color:#14110e}}'
    + '</style></head><body><div class="w">'
    + '<h1>' + esc(заголовок || 'Такой страницы не нашлось') + '</h1>'
    + '<p>Адрес <code>' + esc(String(путь).slice(0, 120)) + '</code> ведёт в никуда — '
    +   'возможно, ссылка устарела или в ней опечатка.</p>'
    + '<div class="links">'
    +   '<a class="main" href="/">Искать жильё</a>'
    +   '<a href="/?country=places">Что посетить</a>'
    +   '<a href="/minsk">Квартиры в Минске</a>'
    + '</div></div></body></html>';
}

// Страница маршрута: карта с точками по порядку, список, добавление точки —
// и только потом уход в Яндекс.Карты. Раньше кнопка вела наружу вслепую.
async function marshrutPage(ids){
  const все = await placesRaw();
  const найденные = ids.map(id => все.find(p => String(p.id) === String(id)))
                       .filter(Boolean)
                       .map(p => ({ id:p.id, name:p.name, addr:p.addr, lat:p.lat, lng:p.lng }));
  // Ссылкой делятся, и точки в ней идут как попало. Считаем порядок объезда
  // здесь же: от первой каждый раз к ближайшей из оставшихся.
  const точки = порядокОбъезда(найденные);

  let сумма = 0;
  точки.forEach((p, i) => { if(i) сумма += distKm(точки[i-1].lat, точки[i-1].lng, p.lat, p.lng); });

  const яндекс = 'https://yandex.by/maps/?rtext='
    + точки.map(p => p.lat + ',' + p.lng).join('~') + '&rtt=auto';

  const строки = точки.map(function(p, i){
    const шаг = i ? distKm(точки[i-1].lat, точки[i-1].lng, p.lat, p.lng) : 0;
    return '<div class="it"><span class="n">' + (i+1) + '</span>'
      + '<span class="t"><a href="/mesto/' + p.id + '-' + slugify(p.name) + '">' + esc(p.name) + '</a>'
      + (p.addr ? ('<small>' + esc(p.addr) + '</small>') : '') + '</span>'
      + '<span class="km">' + (i ? ('+' + Math.round(шаг) + ' км') : 'старт') + '</span>'
      + '<button class="x" type="button" title="убрать" data-id="' + p.id + '">×</button></div>';
  }).join('');

  const заголовок = точки.length
    ? ('Маршрут на день: ' + точки.map(p => p.name).slice(0, 3).join(', ')
       + (точки.length > 3 ? (' и ещё ' + (точки.length - 3)) : ''))
    : 'Маршрут на день по Беларуси';

  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(заголовок) + '</title>'
    + '<meta name="description" content="Маршрут на день по Беларуси'
    +   (точки.length ? (': ' + точки.length + ' точек, около ' + Math.round(сумма) + ' км между ними') : '')
    +   '. Карта, порядок объезда и переход в Яндекс.Карты.">'
    + '<meta name="robots" content="noindex,follow">'
    + '<meta name="theme-color" content="#9a3412">'
    + '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Ctext y=%27.9em%27 font-size=%2790%27%3E%F0%9F%8F%A0%3C/text%3E%3C/svg%3E">'
    + '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">'
    + '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></' + 'script>'
    + '<style>' + '*{box-sizing:border-box}'+ 'body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf7f3;color:#1c1917}'+ '.w{max-width:900px;margin:0 auto;padding:20px 16px 60px}'+ 'a{color:#9a3412}'+ '.back{display:inline-block;margin:0 0 14px;padding:9px 17px;background:#fff;border:1px solid #e9e2d8;'+   'border-radius:999px;text-decoration:none;color:#1c1917;font-size:14.5px;font-weight:600}'+ 'h1{font-size:clamp(22px,4.4vw,32px);line-height:1.15;margin:0 0 4px;letter-spacing:-.02em}'+ '.sub{color:#57534e;margin:0 0 8px}'+ '.how{color:#57534e;font-size:14.5px;margin:0 0 16px;max-width:70ch}'+ '#rmap{height:min(58vh,440px);border-radius:14px;overflow:hidden;margin:0 0 16px;border:1px solid #e9e2d8}'+ '.pin{width:26px;height:26px;border-radius:50%;background:#9a3412;color:#fff;font-weight:700;font-size:13px;'+   'display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}'+ '.it{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #e9e2d8}'+ '.it:first-child{border-top:0}'+ '.it .n{width:24px;height:24px;flex:none;border-radius:50%;background:#9a3412;color:#fff;font-size:12.5px;'+   'font-weight:700;display:inline-flex;align-items:center;justify-content:center}'+ '.it .t{display:flex;flex-direction:column;line-height:1.25;min-width:0}'+ '.it .t a{text-decoration:none;font-weight:600;color:#1c1917}'+ '.it .t small{color:#9c948c;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+ '.it .km{margin-left:auto;color:#9c948c;font-size:13px;white-space:nowrap}'+ '.it .x{font:inherit;font-size:22px;line-height:1;background:none;border:0;color:#9c948c;cursor:pointer;padding:0 4px}'+ '.it .x:hover{color:#9a3412}'+ '.add{margin:16px 0 0;position:relative}'+ '.add input{width:100%;font:inherit;padding:12px 14px;border:1px solid #e9e2d8;border-radius:10px;background:#fff;color:inherit}'+ '.sug{position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #e9e2d8;border-radius:10px;'+   'margin-top:4px;max-height:270px;overflow:auto;z-index:5;display:none;box-shadow:0 8px 24px rgba(41,32,24,.12)}'+ '.sug button{display:block;width:100%;text-align:left;font:inherit;background:none;border:0;padding:9px 13px;cursor:pointer}'+ '.sug button:hover{background:#f8f4ef}'+ '.sug small{color:#9c948c;display:block;font-size:12.5px}'+ '.go{display:inline-block;margin-top:18px;background:#9a3412;color:#fff;text-decoration:none;font-weight:700;'+   'padding:14px 22px;border-radius:11px}'+ '.go.off{opacity:.4;pointer-events:none}'
+ '.go2{display:inline-block;margin:18px 0 0 10px;background:#fff;border:1px solid #e9e2d8;color:#1c1917;'+   'text-decoration:none;font-weight:700;padding:13px 21px;border-radius:11px}'+ '.go2:hover{border-color:#9a3412;color:#9a3412}'+ '@media (max-width:520px){.go,.go2{display:block;margin-left:0;text-align:center}}'+ '.empty{background:#fff;border:1px dashed #d9cec0;border-radius:14px;padding:22px;color:#57534e;margin-bottom:8px}'+ '@media (prefers-color-scheme:dark){body{background:#14110e;color:#f6f2ed}'+   '.back,.add input,.sug,.empty{background:#1d1916;border-color:#332c25;color:#f6f2ed}'+ '.how{color:#c2b7ab}'+   '.it{border-color:#332c25}.it .t a{color:#f6f2ed}.sub,.it .t small,.it .km{color:#c2b7ab}'+   '.sug button:hover{background:#241f1a}a{color:#e2703a}#rmap{border-color:#332c25}}' + '</style></head><body><div class="w">'
    + '<a class="back" id="back" href="/?country=places">← Ко всем местам</a>'
    + '<h1>Маршрут на день</h1>'
    + '<p class="how">Порядок объезда посчитан сам: от первой точки к ближайшей. '
    +   'Линия и километраж — по настоящим дорогам, не по прямой. Точку можно доложить '
    +   'поиском внизу или убрать крестиком, а потом открыть весь маршрут в Яндекс.Картах. '
    +   'Держите эту страницу открытой рядом со списком мест — новые точки появятся здесь сами.</p>'
    + '<p class="sub" id="rsub">' + (точки.length
        ? (точки.length + ' точек · около ' + Math.round(сумма) + ' км между ними')
        : 'Пока пусто') + '</p>'
    + '<div class="empty" id="rEmpty"' + (точки.length ? ' style="display:none"' : '') + '>'
    +   '<b>Маршрут пока пуст.</b><br>Добавьте места поиском ниже — или отметьте их кнопкой '
    +   '«в маршрут» в разделе <a href="/?country=places">Что посетить</a>.</div>'
    + '<div id="rmap"' + (точки.length ? '' : ' style="display:none"') + '></div>'
    + '<div id="rlist">' + строки + '</div>'
    + '<div class="add"><input id="rAdd" type="text" placeholder="Добавить место: замок, костёл, Мир…" autocomplete="off">'
    +   '<div class="sug" id="rSug"></div></div>'
    + '<a class="go' + (точки.length ? '' : ' off') + '" id="rGo" href="' + яндекс + '" target="_blank" rel="noopener">'
    +   'Открыть маршрут в Яндекс.Картах →</a>'
    + '<a class="go2" id="rStay" href="/">Искать жильё на сутки →</a>'
    + '<script>'
    // Города, по которым сайт умеет искать жильё: нужны, чтобы понять,
    // куда вести кнопку «Искать жильё» — маршрут по Гродно не должен
    // открывать поиск по Минску.
    + 'var ГОРОДА = ' + JSON.stringify(
        Object.entries(REGIONS).flatMap(function(пара){
          return (пара[1].cities || []).filter(function(г){ return TOWN_CENTERS[г]; })
            .map(function(г){ return [г, пара[0], TOWN_CENTERS[г][0], TOWN_CENTERS[г][1]]; });
        })) + ';'
    + 'var СЕРВЕРНЫЕ = ' + JSON.stringify(точки) + ';'+ 'function прочитать(){try{var v=JSON.parse(localStorage.getItem("route")||"[]");'+   'return Array.isArray(v)?v.filter(function(p){return p&&p.lat&&p.lng;}):[];}catch(e){return [];}}'+ 'var ПО_ССЫЛКЕ = /[?&]p=/.test(location.search);'+ 'var МОЙ = прочитать();'+ 'var Т = ПО_ССЫЛКЕ ? СЕРВЕРНЫЕ : МОЙ;'+ 'if(ПО_ССЫЛКЕ && МОЙ.length > СЕРВЕРНЫЕ.length && СЕРВЕРНЫЕ.every(function(p){'+   'return МОЙ.some(function(x){return String(x.id)===String(p.id);});})) Т = МОЙ;'+ 'var карта = null, слой = null, линия = null;'+ 'function км(a,b){var t=Math.PI/180,x=(b.lat-a.lat)*t,y=(b.lng-a.lng)*t;'+   'var h=Math.sin(x/2)*Math.sin(x/2)+Math.cos(a.lat*t)*Math.cos(b.lat*t)*Math.sin(y/2)*Math.sin(y/2);'+   'return 6371*2*Math.asin(Math.sqrt(h));}'+ 'function esc(t){return String(t==null?"":t).replace(/[&<>"]/g,function(c){'+   'return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c];});}'+ 'function сохранить(){try{localStorage.setItem("route",JSON.stringify(Т));}catch(e){}'+   'var q = Т.length ? ("?p=" + Т.map(function(p){return p.id;}).join(",")) : "";'+   'history.replaceState(null, "", "/marshrut" + q);}'+ 'function убрать(id){Т = Т.filter(function(p){return String(p.id)!==String(id);});нарисовать();сохранить();}'+ 'function добавить(p){if(Т.some(function(x){return String(x.id)===String(p.id);}))return;'+   'Т = Т.concat([{id:p.id,name:p.name,addr:p.addr,lat:p.lat,lng:p.lng}]);нарисовать();сохранить();}'+ 'function порядок(){if(Т.length<3)return;var left=Т.slice(1),out=[Т[0]];'+   'while(left.length){var c=out[out.length-1],bi=0,bd=Infinity;'+     'left.forEach(function(p,i){var d=км(c,p);if(d<bd){bd=d;bi=i;}});'+     'out.push(left.splice(bi,1)[0]);}Т=out;}'+ 'function нарисовать(){порядок();'+   'var сумма=0, строки="";'+   'Т.forEach(function(p,i){var шаг=i?км(Т[i-1],p):0;сумма+=шаг;'+     'строки += "<div class=\\"it\\"><span class=\\"n\\">"+(i+1)+"</span>"'+       '+"<span class=\\"t\\"><a href=\\"/mesto/"+p.id+"\\">"+esc(p.name)+"</a>"'+       '+(p.addr?("<small>"+esc(p.addr)+"</small>"):"")+"</span>"'+       '+"<span class=\\"km\\">"+(i?("+"+Math.round(шаг)+" км"):"старт")+"</span>"'+       '+"<button class=\\"x\\" type=\\"button\\" title=\\"убрать\\" data-id=\\""+p.id+"\\">×</button></div>";});'+   'document.getElementById("rlist").innerHTML = строки; подписатьШаги();'+   'document.getElementById("rsub").textContent = Т.length'+     '? (Т.length + " точек · около " + Math.round(сумма) + " км между ними")'+     ': "Пока пусто";'+   'var g = document.getElementById("rGo");'+   'g.href = "https://yandex.by/maps/?rtext=" + Т.map(function(p){return p.lat+","+p.lng;}).join("~") + "&rtt=auto";'+   'g.className = "go" + (Т.length ? "" : " off");'+   'кудаЗаЖильём();'
    + '  document.getElementById("rEmpty").style.display = Т.length ? "none" : "";'+   'document.getElementById("rmap").style.display = Т.length ? "" : "none";'+   'рисоватьКарту();}'+ 'function рисоватьКарту(){if(!Т.length||typeof L==="undefined")return;'+   'if(!карта){карта=L.map("rmap",{scrollWheelZoom:false});'+     'карта.attributionControl.setPrefix("Leaflet");'+     'L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,'+       'attribution:"&copy; OpenStreetMap"}).addTo(карта);слой=L.layerGroup().addTo(карта);}'+   'слой.clearLayers(); if(линия){карта.removeLayer(линия);линия=null;}'+   'var пути=[];'+   'Т.forEach(function(p,i){пути.push([p.lat,p.lng]);'+     'L.marker([p.lat,p.lng],{icon:L.divIcon({className:"",iconSize:[26,26],iconAnchor:[13,13],'+       'html:"<div class=\\"pin\\">"+(i+1)+"</div>"})}).bindTooltip(p.name).addTo(слой);});'+   'if(пути.length>1) линия=L.polyline(пути,{color:"#9a3412",weight:3,opacity:.7}).addTo(карта);'+   'setTimeout(function(){карта.invalidateSize();'+     'if(пути.length>1)карта.fitBounds(пути,{padding:[40,40]});else карта.setView(пути[0],13);},60);'+   'подорогам();}'+ 'function кудаЗаЖильём(){var a=document.getElementById("rStay"); if(!a)return;'
    + '  if(!Т.length){a.href="/";a.textContent="Искать жильё на сутки →";return;}'
    // Берём город, который в среднем ближе всех к точкам маршрута: у поездки
    // по одному городу это он сам, у длинной — та середина, откуда удобно
    // ездить. Один и тот же город может быть в двух областях (Минск), но
    // область к нему всегда своя, из этого же списка.
    + '  var л=null,лд=1e9;'
    + '  ГОРОДА.forEach(function(г){var с=0;'
    + '    Т.forEach(function(p){с+=км({lat:г[2],lng:г[3]},p);});'
    + '    с/=Т.length; if(с<лд){лд=с;л=г;}});'
    + '  if(!л){a.href="/";return;}'
    + '  a.href="/?region="+encodeURIComponent(л[1])+"&city="+encodeURIComponent(л[0]);'
    + '  a.textContent="Искать жильё в городе "+л[0]+" →";}'
    + 'var дорогаЗа = "", ПЕРЕГОНЫ = null;'+ 'function подписатьШаги(){if(!ПЕРЕГОНЫ)return;'
    + '  var э=document.querySelectorAll("#rlist .it .km");'
    + '  for(var i=1;i<э.length;i++){ var v=ПЕРЕГОНЫ[i-1];'
    + '    if(typeof v==="number") э[i].textContent="+"+Math.round(v)+" км"; }}'
    + 'async function подорогам(){if(Т.length<2){ПЕРЕГОНЫ=null;return;}'+   'var к = Т.map(function(p){return p.lat+","+p.lng;}).join(";");'+   'if(к===дорогаЗа)return; дорогаЗа=к;'+   'try{var d=await (await fetch("/api/route?p="+encodeURIComponent(к))).json();'+     'if(!d.ok||к!==дорогаЗа)return;'+     'if(линия){карта.removeLayer(линия);}'+     'линия=L.polyline(d.line,{color:"#9a3412",weight:4,opacity:.75}).addTo(карта);'+     'карта.fitBounds(линия.getBounds(),{padding:[40,40]});'+     'ПЕРЕГОНЫ = d.legs || null; подписатьШаги();'
    + '     var ч=Math.floor(d.minutes/60), м=d.minutes%60;'+     'document.getElementById("rsub").textContent = Т.length+" точек · "+d.km'+       '+" км по дорогам · за рулём около "+(ч?(ч+" ч "+м+" мин"):(м+" мин"));'+   '}catch(e){}}'+ 'var поле=document.getElementById("rAdd"), список=document.getElementById("rSug"), таймер=null;'+ 'поле.addEventListener("input", function(){clearTimeout(таймер);таймер=setTimeout(искать,400);});'+ 'async function искать(){var q=поле.value.trim();'+   'if(q.length<2){список.style.display="none";return;}'+   'try{var d=await (await fetch("/api/places?q="+encodeURIComponent(q))).json();'+     'var найдено=(d.items||[]).slice(0,8);'+     'if(!найдено.length){список.style.display="none";return;}'+     'список.innerHTML=найдено.map(function(p){return "<button type=\\"button\\" data-p=\\""'+       '+esc(JSON.stringify({id:p.id,name:p.name,addr:p.addr,lat:p.lat,lng:p.lng}))+"\\">"'+       '+esc(p.name)+"<small>"+esc(p.addr||"")+"</small></button>";}).join("");'+     'список.style.display="";}catch(e){список.style.display="none";}}'+ 'document.addEventListener("click", function(e){'+   'var x=e.target.closest(".it .x"); if(x){убрать(x.getAttribute("data-id"));return;}'+   'var b=e.target.closest(".sug button");'+   'if(b){try{добавить(JSON.parse(b.getAttribute("data-p")));}catch(err){}'+     'поле.value="";список.style.display="none";return;}'+   'if(!e.target.closest(".add")) список.style.display="none";});'+ 'нарисовать();'+ '(function(){var a=document.getElementById("back");if(!a)return;'+ 'try{ var r=document.referrer, с=localStorage.getItem("backTo");'+ '  if(r && r.indexOf(location.origin)===0 && /^\\/(\\?|$)/.test(r.slice(location.origin.length))) a.href=r;'+ '  else if(с && с.charAt(0)==="/") a.href=с; }catch(e){}})();'+ 'window.addEventListener("storage", function(e){if(e.key && e.key!=="route")return;'+   'var н=прочитать(); if(!н.length && Т.length) return; Т=н; нарисовать();});'+ 'document.addEventListener("visibilitychange", function(){'+   'if(document.visibilityState!=="visible")return; var н=прочитать();'+   'if(н.length!==Т.length){Т=н;нарисовать();}});' + '</' + 'script>'
    + '</div></body></html>';
}

async function cityPage(slug, kind){
  const c = CITY_PAGES[slug];
  const base = PAGE_KINDS[kind || ''];
  // у области своё название раздела: там не только квартиры
  const k = (!kind && c.what) ? Object.assign({}, base, { what: c.what }) : base;
  const uu = new URL('/api/search?region=' + slug + '&city=&type=' + k.type +
                     '&rooms=&guests=&max=' + (k.max || '') + '&source=both', 'http://localhost');
  let data = { items: [], total: 0 };
  try{ data = await runSearchQuery(uu.searchParams); }catch(e){}

  // Выдача отсортирована по цене, поэтому «первые 30» на /minsk и на
  // /minsk-nedorogo оказывались одними и теми же карточками — для поисковика
  // это две страницы с одинаковым содержимым, и он склеит их в одну.
  // На основной странице города показываем срез по всему диапазону цен,
  // на уточняющих — самое дешёвое.
  const pool = data.items || [];
  let items;
  if(!kind && pool.length > 40){
    const step = pool.length / 30;
    items = Array.from({length: 30}, (_, i) => pool[Math.floor(i * step)]).filter(Boolean);
  } else {
    items = pool.slice(0, 30);
  }
  const prices = (data.items || []).map(x => x.price).filter(p => p > 0).sort((a,b)=>a-b);
  const minP = prices.length ? prices[0] : 0;
  const midP = prices.length ? prices[Math.floor(prices.length/2)] : 0;

  const title = k.what + ' ' + c.where + k.extra + ' — снять посуточно';
  const desc  = k.what + ' ' + c.where + k.extra + ': ' + вариантов(data.total || 0) + ' от частников с Kufar, Realt и Flatbook в одном списке'
    + (minP ? (', цены от ' + minP + ' BYN за сутки') : '') + '. Фото, цены, телефоны хозяев и карта.';

  const cards = items.map(function(x){
    const img = (x.photos && x.photos[0])
      ? '<img src="' + esc(x.photos[0]) + '" loading="lazy" alt="' + esc(k.what + ' ' + c.where + ' — ' + (x.title||'')) + '">'
      : '<div class="noimg">фото у источника</div>';
    const meta = [x.area, (x.rooms ? x.rooms + '-комн' : ''), x.capacity ? ('до ' + x.capacity + ' гостей') : '']
      .filter(Boolean).map(function(m){ return '<span>' + esc(m) + '</span>'; }).join('');
    return '<article class="c"><a href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">' + img + '</a>'
      + '<div class="b"><div class="p">' + x.price + ' BYN <small>/ сутки</small></div>'
      + '<div class="m">' + meta + '</div>'
      + '<h3>' + esc(x.title || (k.what + ' ' + c.where)) + '</h3>'
      + '<a class="go" href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">Открыть на ' + esc(srcTitle(x.src)) + '</a>'
      + '</div></article>';
  }).join('');

  const others = Object.keys(CITY_PAGES).filter(function(x){ return x !== slug || kind; })
    .map(function(x){ return '<a href="/' + x + '">' + esc(CITY_PAGES[x].city) + '</a>'; }).join('')
    + Object.keys(PAGE_KINDS).filter(function(x){ return x && x !== (kind || ''); })
      .map(function(x){ return '<a href="/' + slug + '-' + x + '">' + esc(PAGE_KINDS[x].what) + ' ' + esc(c.where) + '</a>'; }).join('');

  const ld = {
    '@context':'https://schema.org', '@type':'ItemList',
    name: title, numberOfItems: items.length,
    itemListElement: items.slice(0,10).map(function(x,i){
      return { '@type':'ListItem', position:i+1, name:(x.title || (c.what+' '+c.where)), url:x.link };
    })
  };

  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(desc) + '">'
    + '<meta name="robots" content="index,follow">'
    + '<meta name="theme-color" content="#9a3412">'
    + '<link rel="canonical" href="' + SITE_URL + '/' + slug + (kind ? ('-' + kind) : '') + '">'
    + '<link rel="manifest" href="/manifest.webmanifest">'
    + '<meta property="og:type" content="website">'
    + '<meta property="og:title" content="' + esc(title) + '">'
    + '<meta property="og:description" content="' + esc(desc) + '">'
    + '<meta property="og:url" content="' + SITE_URL + '/' + slug + (kind ? ('-' + kind) : '') + '">'
    + '<script type="application/ld+json">' + JSON.stringify(ld) + '</script>'
    + '<style>'
    + ':root{color-scheme:light dark}'
    + 'body{margin:0;background:#f4f5f7;color:#141821;font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}'
    + '.w{max-width:1080px;margin:0 auto;padding:24px 16px 60px}'
    + 'h1{font-size:clamp(26px,5vw,38px);line-height:1.15;margin:0 0 10px;letter-spacing:-.02em}'
    + '.lead{color:#4a5160;margin:0 0 18px;max-width:70ch}'
    + '.cta{display:inline-block;background:#9a3412;color:#fff;text-decoration:none;'
    +   'font-weight:700;padding:14px 26px;border-radius:12px;margin-bottom:26px;box-shadow:0 8px 22px -6px rgba(255,90,31,.6)}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}'
    + '.c{background:#fff;border:1px solid #e2e5ea;border-radius:16px;overflow:hidden;display:flex;flex-direction:column}'
    + '.c img{width:100%;height:180px;object-fit:cover;display:block}'
    + '.noimg{height:180px;display:flex;align-items:center;justify-content:center;background:#eef0f4;color:#8b93a3;font-size:13px}'
    + '.c .b{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px;flex:1}'
    + '.c .p{font-size:22px;font-weight:800}.c .p small{font-size:13px;font-weight:600;color:#8b93a3}'
    + '.c .m{display:flex;flex-wrap:wrap;gap:6px}'
    + '.c .m span{font-size:12.5px;background:#f7f8fa;border:1px solid #eef0f4;border-radius:999px;padding:3px 9px;color:#4a5160}'
    + '.c h3{font-size:14.5px;font-weight:600;margin:2px 0 0;color:#141821}'
    + '.c .go{margin-top:auto;padding-top:8px;color:#9a3412;font-weight:700;text-decoration:none;font-size:14px}'
    + '.others{margin:34px 0 0;display:flex;flex-wrap:wrap;gap:10px}'
    + '.others a{background:#fff;border:1px solid #e2e5ea;border-radius:999px;padding:8px 16px;text-decoration:none;color:#141821;font-size:14px}'
    + 'footer{margin-top:34px;color:#8b93a3;font-size:13.5px;max-width:75ch}'
    + 'footer a{color:#9a3412}'
    + '@media (prefers-color-scheme:dark){body{background:#14110e;color:#f6f2ed}.lead{color:#c2b7ab}'
    +   '.c{background:#1d1916;border-color:#332c25}.c h3{color:#f6f2ed}.noimg{background:#2b251f}'
    +   '.c .m span{background:#241f1a;border-color:#332c25;color:#c2b7ab}'
    +   '.others a{background:#1d1916;border-color:#332c25;color:#f6f2ed}}'
    + '</style></head><body><div class="w">'
    + '<h1>' + esc(k.what) + ' ' + esc(c.where) + esc(k.extra) + '</h1>'
    + '<p class="lead">Собрали объявления частников с <b>Kufar</b>, <b>Realt</b> и <b>Flatbook</b> в один список — '
    +   'не нужно открывать три сайта. Сейчас доступно <b>' + (data.total || 0) + '</b> '
    +   скл(data.total || 0, 'вариант', 'варианта', 'вариантов')
    +   (minP ? (', самый дешёвый — <b>' + minP + ' BYN</b> за сутки, обычная цена около <b>' + midP + ' BYN</b>') : '')
    +   '. Цены и наличие подтягиваются из объявлений в реальном времени.</p>'
    + '<a class="cta" href="/?region=' + slug + '&type=' + k.type + (k.max ? ('&max=' + k.max) : '') + '">Открыть поиск с фильтрами и картой →</a>'
    + (cards ? ('<div class="grid">' + cards + '</div>') : '<p>Сейчас вариантов нет — загляните позже.</p>')
    + '<div class="others">' + others + '</div>'
    + '<footer><p>Мы не сдаём жильё сами и не берём комиссию: показываем объявления с Kufar, Realt и Flatbook '
    +   'и отправляем напрямую к хозяину. Перед оплатой проверяйте условия и не переводите предоплату незнакомым людям.</p>'
    +   '<p><a href="/">Все города и карта с ценами →</a></p></footer>'
    + '</div></body></html>';
}

// Иконки приложения для «Добавить на главный экран» (PNG в base64, чтобы обойтись одним файлом)
const ICON_192 = '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';
const ICON_512 = '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';

const META_DESC = 'Поиск жилья на сутки: Беларусь (Kufar, Realt, Flatbook) и отели России (101Hotels) в одном месте. Плюс раздел «Что посетить» — почти 800 достопримечательностей Беларуси на карте с фото, описанием и координатами, и подбор жилья рядом с каждой.';

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Жильё на сутки в Беларуси и России + что посмотреть рядом — Kufar, Realt, Flatbook, 101Hotels</title>
<meta name="description" content="${META_DESC}">
<meta name="keywords" content="снять квартиру на сутки, жильё на сутки Беларусь, квартира посуточно Минск, коттедж на сутки, усадьба на выходные, аренда посуточно Брест Гомель Гродно Витебск Могилёв, отели России посуточно, kufar, realt, flatbook, 101hotels, что посмотреть в Беларуси, достопримечательности Беларуси, замки Беларуси, куда съездить на выходные, карта достопримечательностей">
<meta name="robots" content="index,follow">
<meta name="author" content="poisk-kvartir">
<meta name="theme-color" content="#9a3412">
<link rel="canonical" href="${SITE_URL}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Поиск жилья на сутки">
<meta property="og:title" content="Жильё на сутки в Беларуси и России + что посмотреть рядом">
<meta property="og:description" content="${META_DESC}">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:locale" content="ru_BY">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Жильё на сутки — Kufar, Realt, Flatbook (Беларусь) и 101Hotels (Россия)">
<meta name="twitter:description" content="${META_DESC}">
<link rel="preload" as="image" href="/%D1%84%D0%BE%D1%82%D0%BE-%D1%82%D0%BE%D1%87%D0%B5%D0%BA/hero.jpg" media="(min-width:701px)">
<link rel="preload" as="image" href="/%D1%84%D0%BE%D1%82%D0%BE-%D1%82%D0%BE%D1%87%D0%B5%D0%BA/hero-mob.jpg" media="(max-width:700px)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8F%A0%3C/text%3E%3C/svg%3E">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-title" content="Жильё на сутки">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","name":"Поиск жилья на сутки","url":"${SITE_URL}/","inLanguage":"ru-BY","description":"${META_DESC}",
 "potentialAction":{"@type":"SearchAction","target":{"@type":"EntryPoint","urlTemplate":"${SITE_URL}/?country=places&q={search_term_string}"},"query-input":"required name=search_term_string"}}
</script>
<style>
:root{
  --bg:#faf7f3;
  --bg-grad-1:#f8f4ef;
  --bg-grad-2:#fdfbf8;
  --surface:#ffffff;
  --surface-2:#f8f4ef;
  --surface-3:#f0eae1;
  --line:#e9e2d8;
  --line-strong:#d9cec0;
  --txt:#1c1917;
  --txt-2:#57534e;
  --txt-3:#9c948c;
  --accent:#9a3412;
  --accent-2:#b8471c;
  --accent-ink:#ffffff;
  --accent-soft:rgba(154,52,18,.10);
  --gold:#b45309;
  --kufar:#2f5fa8;
  --kufar-soft:rgba(47,95,168,.12);
  --realt:#c2740c;
  --realt-soft:rgba(194,116,12,.14);
  --shadow-sm:0 1px 2px rgba(41,32,24,.04);
  --shadow-md:0 4px 16px rgba(41,32,24,.07),0 1px 3px rgba(41,32,24,.04);
  --shadow-lg:0 12px 34px rgba(41,32,24,.11);
  --radius:14px;
  --radius-sm:10px;
  --radius-xs:8px;
  --focus:rgba(154,52,18,.30);
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#14110e;
    --bg-grad-1:#171310;
    --bg-grad-2:#100e0b;
    --surface:#1d1916;
    --surface-2:#241f1a;
    --surface-3:#2b251f;
    --line:#332c25;
    --line-strong:#463d33;
    --txt:#f6f2ed;
    --txt-2:#c2b7ab;
    --txt-3:#8b8177;
    --accent:#e2703a;
    --accent-2:#ee8a56;
    --accent-ink:#14110e;
    --accent-soft:rgba(226,112,58,.16);
    --gold:#d9a441;
    --kufar:#6f9be0;
    --kufar-soft:rgba(111,155,224,.18);
    --realt:#e0a03d;
    --realt-soft:rgba(224,160,61,.18);
    --shadow-sm:0 1px 2px rgba(0,0,0,.35);
    --shadow-md:0 6px 20px rgba(0,0,0,.45);
    --shadow-lg:0 18px 44px rgba(0,0,0,.55);
    --focus:rgba(226,112,58,.42);
  }
}

*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--txt);
  background:var(--bg);
  /* Раньше здесь были два цветных пятна — оранжевое и синее. Именно они
     давали ощущение «оранжевое на сером»: страница выглядела подкрашенной.
     Оставляем ровный тёплый лист с еле заметным потемнением сверху. */
  background-image:linear-gradient(180deg,var(--bg-grad-1) 0,var(--bg-grad-2) 420px);
  background-attachment:fixed;
  -webkit-font-smoothing:antialiased;
  line-height:1.5;
  letter-spacing:-.01em;
}

.wrap{
  max-width:1200px;
  margin:0 auto;
  padding:clamp(20px,4vw,52px) clamp(16px,4vw,40px) 80px;
}

/* ---------- Heading ---------- */
h1{
  font-size:clamp(28px,5.2vw,46px);
  line-height:1.04;
  font-weight:800;
  letter-spacing:-.03em;
  margin:6px 0 8px;
}
h1 .accent{ color:var(--accent); }
.lead{
  color:var(--txt-2);
  font-size:clamp(15px,2.4vw,19px);
  max-width:60ch;
  margin:0 0 clamp(22px,4vw,34px);
}
/* Шапка: знак слева, источники справа. До сих пор сайт нечем было узнать —
   страница начиналась сразу с большого заголовка. */
/* Фотополоса за шапкой и заголовком. Заливка задана и цветом, и снимком:
   если снимок не загрузится, полоса всё равно тёмная и текст на ней читается. */
.wrap{position:relative}
.wrap::before{
  content:"";position:absolute;left:0;right:0;top:0;z-index:-1;
  height:clamp(430px,52vw,560px);
  background-color:#2a201a;
  background-image:linear-gradient(180deg,rgba(28,22,18,.66) 0,rgba(28,22,18,.72) 45%,var(--bg-grad-1) 97%),
                   url("/фото-точек/hero.jpg");
  background-size:auto, cover;
  background-position:center, center 38%;
  background-repeat:no-repeat, no-repeat;
}
/* На узком экране широкая полоса обрезается до куска стены — там свой кадр */
@media (max-width:700px){
  .wrap::before{
    height:clamp(380px,96vw,460px);
    background-image:linear-gradient(180deg,rgba(28,22,18,.62) 0,rgba(28,22,18,.72) 50%,var(--bg-grad-1) 97%),
                     url("/фото-точек/hero-mob.jpg");
    background-position:center, center 30%;
  }
}
/* На полосе текст светлый — на своём обычном цвете он бы пропал */
.hero-ink, .hero-ink h1{color:#fff}
.hero-ink .lead{color:rgba(255,255,255,.86)}
.hero-ink .brand{color:#fff}
.hero-ink .brand b{color:rgba(255,255,255,.72)}
.hero-ink h1 .accent{color:#ffb289}
.hero-ink .top{border-bottom-color:rgba(255,255,255,.22)}
.hero-ink .kicker{color:rgba(255,255,255,.88);background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.24)}
.hero-ink .kicker .dot{background:#ffb289}

.top{
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding-bottom:clamp(16px,3vw,26px);margin-bottom:clamp(14px,2.6vw,24px);
  border-bottom:1px solid var(--line);
}
.brand{display:inline-flex;align-items:center;gap:11px;text-decoration:none;color:var(--txt)}
/* Ширина считается вместе с отступами (box-sizing:border-box выше по файлу),
   поэтому размер задаём с их учётом — иначе рисунок схлопывается в точку. */
.brand svg{width:38px;height:38px;padding:9px;border-radius:10px;background:var(--accent);fill:var(--accent-ink);flex:none}
.brand span{display:flex;flex-direction:column;line-height:1.15;font-weight:800;font-size:16.5px;letter-spacing:-.02em}
.brand b{font-weight:500;font-size:12px;color:var(--txt-3);letter-spacing:0}
.kicker{
  display:inline-flex;align-items:center;gap:8px;
  font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  color:var(--txt-3);
  background:var(--surface-2);
  border:1px solid var(--line);
  padding:6px 12px;border-radius:999px;
}
.kicker .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
@media (max-width:560px){ .kicker{font-size:10.5px;padding:5px 10px} }

/* ---------- Filter bar ---------- */
.bar{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:clamp(16px,3vw,22px);
  box-shadow:var(--shadow-md);
  margin-bottom:18px;
}
.fld{display:flex;flex-direction:column;gap:6px;min-width:0}
.fld > span{
  font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--txt-3);padding-left:2px;
}
.fld.span-2{grid-column:span 2}

.bar select,
.bar input{
  width:100%;
  font:inherit;font-size:15px;
  color:var(--txt);
  background:var(--surface-2);
  border:1px solid var(--line);
  border-radius:var(--radius-sm);
  padding:12px 14px;
  min-height:48px;
  transition:border-color .15s, box-shadow .15s, background .15s;
  appearance:none;-webkit-appearance:none;
}
.bar input::placeholder{color:var(--txt-3)}
.bar select{
  padding-right:40px;
  background-image:linear-gradient(45deg,transparent 50%,var(--txt-2) 50%),linear-gradient(135deg,var(--txt-2) 50%,transparent 50%);
  background-position:calc(100% - 20px) 21px, calc(100% - 15px) 21px;
  background-size:5px 5px,5px 5px;
  background-repeat:no-repeat;
  cursor:pointer;
}
.bar select:hover,.bar input:hover{border-color:var(--line-strong)}
.bar select:focus,.bar input:focus{
  outline:none;
  border-color:var(--accent);
  background:var(--surface);
  box-shadow:0 0 0 4px var(--focus);
}
.bar input[type=date]{cursor:pointer}
.bar input[type=date]::-webkit-calendar-picker-indicator{opacity:.6;cursor:pointer}
@media (prefers-color-scheme: dark){
  .bar input[type=date]::-webkit-calendar-picker-indicator{filter:invert(1) opacity(.6)}
}

/* ---------- Find button ---------- */
.go{
  grid-column:1 / -1;
  font:inherit;font-size:16.5px;font-weight:700;letter-spacing:-.01em;
  color:var(--accent-ink);
  background:var(--accent);
  border:none;
  border-radius:var(--radius-sm);
  padding:14px 30px;
  min-height:50px;
  cursor:pointer;
  box-shadow:none;
  transition:transform .12s, box-shadow .15s, filter .15s;
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
}
.go::before{content:"⌕";font-size:20px;line-height:1;margin-top:-1px}
.go:hover{background:var(--accent-2)}
.go:active{transform:translateY(1px)}
.go:focus-visible{outline:none;box-shadow:0 0 0 4px var(--focus)}
/* На телефоне кнопка во всю ширину — так удобнее пальцем. На компьютере
   полоса в 1100 пикселей выглядела как рекламный баннер. */
@media (min-width:640px){ .go{justify-self:start;min-width:230px} }

/* ---------- Toolbar: status + view switch ---------- */
.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;margin:2px 2px 4px}
#stat{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  color:var(--txt-2);font-size:14.5px;font-weight:500;
  min-height:24px;
}
.seg{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px}
.seg button{
  font:inherit;font-size:13.5px;font-weight:700;
  color:var(--txt-2);background:none;border:none;cursor:pointer;
  padding:7px 15px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;
  transition:background .15s,color .15s;
}
.seg button.on{background:var(--accent);color:var(--accent-ink)}
.hint{
  color:var(--txt-3);
  font-size:13px;
  margin:16px 2px 22px;
  line-height:1.6;
}

/* ---------- Grid ---------- */
#grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  gap:clamp(16px,2.4vw,24px);
  margin-top:12px;
}

/* ---------- Map ---------- */
#map{
  height:min(72vh,640px);
  border-radius:var(--radius);
  border:1px solid var(--line);
  box-shadow:var(--shadow-md);
  margin-top:12px;
  overflow:hidden;
  z-index:0;
}
.leaflet-div-icon{background:none;border:none}
.price-pin{
  position:absolute;transform:translate(-50%,-100%);
  white-space:nowrap;font:800 12px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:#fff;padding:5px 9px;border-radius:999px;
  border:2px solid #fff;box-shadow:0 3px 9px rgba(0,0,0,.35);cursor:pointer;
}
.price-pin.Kufar{background:#2f6bff}
.price-pin.Realt{background:#c2740c}
.price-pin::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#fff}
.price-pin:hover{filter:brightness(1.06);z-index:1000}
.leaflet-popup-content{margin:12px 14px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.mp-price{font-weight:800;font-size:17px;color:#141821}
.mp-price small{font-weight:500;color:#888;font-size:12px}
.mp-meta{font-size:12.5px;color:#555;margin:2px 0 8px}
.mp-call{display:block;font-size:13px;font-weight:700;color:#141821;margin:2px 0}
.mp-open{display:inline-block;margin-top:6px;font-weight:800;color:#9a3412;text-decoration:none}
.mp-approx{color:#9098a6;font-size:11px;margin-top:5px}
.mp-route{display:block;width:100%;margin-top:8px;font:inherit;font-size:13px;font-weight:700;
  background:var(--surface-2);border:1px solid var(--line);border-radius:999px;
  padding:8px 14px;cursor:pointer;color:var(--txt-2)}
.mp-route.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}

/* ---------- Card ---------- */
.card{
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:var(--radius);
  overflow:hidden;
  display:flex;flex-direction:column;
  box-shadow:var(--shadow-sm);
  transition:transform .18s cubic-bezier(.2,.7,.3,1), box-shadow .2s, border-color .2s;
}
.card:hover{
  transform:translateY(-4px);
  box-shadow:var(--shadow-lg);
  border-color:var(--line-strong);
}

/* ---------- Slider ---------- */
.slider{
  position:relative;
  aspect-ratio:4/3;
  background:var(--surface-3);
  overflow:hidden;
}
.slider .im{
  position:absolute;inset:0;
  width:100%;height:100%;
  object-fit:cover;
  display:block;
}
.slider::after{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.28) 0%,transparent 26%,transparent 62%,rgba(0,0,0,.32) 100%);
}

/* slider nav arrows */
.nav{
  position:absolute;top:50%;transform:translateY(-50%);
  z-index:3;
  width:38px;height:38px;
  display:flex;align-items:center;justify-content:center;
  border:none;cursor:pointer;
  border-radius:50%;
  background:rgba(15,17,23,.5);
  color:#fff;font-size:0;
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  opacity:0;
  transition:opacity .18s, background .15s, transform .12s;
}
.card:hover .nav{opacity:1}
.nav:hover{background:rgba(15,17,23,.78)}
.nav:active{transform:translateY(-50%) scale(.92)}
.nav::before{content:"";width:9px;height:9px;border-top:2px solid #fff;border-right:2px solid #fff}
.prev{left:10px}
.prev::before{transform:rotate(-135deg);margin-left:3px}
.next{right:10px}
.next::before{transform:rotate(45deg);margin-right:3px}
@media (hover:none){.nav{opacity:.85}}

/* photo counter */
.cnt{
  position:absolute;bottom:12px;right:12px;z-index:3;
  font-size:12px;font-weight:600;
  color:#fff;
  background:rgba(15,17,23,.55);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  padding:4px 9px;border-radius:999px;
  letter-spacing:.02em;
}

/* source tag on photo */
.tag{
  position:absolute;top:12px;left:12px;z-index:3;
  font-size:11.5px;font-weight:800;letter-spacing:.03em;
  color:#fff;
  padding:5px 11px;border-radius:999px;
  box-shadow:0 4px 12px rgba(0,0,0,.25);
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
}
.tag.Kufar{background:linear-gradient(120deg,var(--kufar),#4d80ff)}
.tag.Realt{background:linear-gradient(120deg,var(--realt),#ff9a3d)}

/* ---------- Card body ---------- */
.bd{
  display:flex;flex-direction:column;gap:10px;
  padding:16px 17px 17px;
  flex:1;
}

/* price row */
.pr{
  display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;
  font-size:26px;font-weight:800;letter-spacing:-.02em;
  color:var(--txt);
  line-height:1.05;
}
.pr .tot{
  font-size:13px;font-weight:600;
  color:var(--txt-3);
  letter-spacing:0;
}
.total{font-size:13.5px;font-weight:700;color:var(--accent);letter-spacing:-.01em}

/* meta line (rooms/guests/etc) */
.meta{
  display:flex;flex-wrap:wrap;gap:6px 8px;
  font-size:13px;color:var(--txt-2);
  align-items:center;
}
.meta > *{
  background:var(--surface-2);
  border:1px solid var(--line);
  padding:3px 9px;border-radius:8px;
  font-weight:500;
  white-space:nowrap;
}

/* title */
.ttl{
  font-size:16.5px;font-weight:700;letter-spacing:-.01em;
  color:var(--txt);
  line-height:1.32;
  margin:0;
}

/* rating */
.stars{
  display:inline-flex;align-items:center;gap:6px;
  font-size:14px;font-weight:600;color:var(--gold);
  letter-spacing:.04em;
}
.stars .num{
  color:var(--txt-2);font-weight:600;font-size:13px;letter-spacing:0;
}

/* description */
.desc-t{
  font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--accent);cursor:pointer;user-select:none;
  margin-top:2px;
}
.desc{
  font-size:13.5px;color:var(--txt-2);
  line-height:1.55;
  margin:0;white-space:pre-line;
}

/* actions */
.act{
  display:flex;gap:9px;flex-wrap:wrap;
  margin-top:auto;padding-top:6px;
}
.act a{
  flex:1 1 auto;
  text-align:center;
  text-decoration:none;
  font-size:14px;font-weight:700;letter-spacing:-.01em;
  color:var(--txt);
  background:var(--surface-2);
  border:1px solid var(--line-strong);
  border-radius:var(--radius-xs);
  padding:11px 14px;
  min-height:44px;
  display:inline-flex;align-items:center;justify-content:center;gap:7px;
  transition:background .15s, border-color .15s, transform .1s, color .15s;
}
.act a:hover{background:var(--surface-3);border-color:var(--txt-3)}
.act a:active{transform:translateY(1px)}
.act a.call{
  color:var(--accent-ink);
  background:linear-gradient(120deg,var(--accent),var(--accent-2));
  border-color:transparent;
  box-shadow:0 6px 16px -6px color-mix(in srgb,var(--accent) 70%,transparent);
}
.act a.call:hover{filter:brightness(1.05);background:linear-gradient(120deg,var(--accent),var(--accent-2))}

/* ---------- Pager ---------- */
#pager{
  display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:7px;
  margin-top:26px;
}
.pg{
  font:inherit;font-size:14.5px;font-weight:700;
  min-width:42px;height:42px;padding:0 12px;
  display:inline-flex;align-items:center;justify-content:center;
  color:var(--txt);background:var(--surface);
  border:1px solid var(--line);border-radius:var(--radius-xs);cursor:pointer;
  transition:background .15s,border-color .15s,color .15s,transform .1s;
}
.pg:hover:not(:disabled){border-color:var(--txt-3);background:var(--surface-2)}
.pg:active:not(:disabled){transform:translateY(1px)}
.pg:disabled{opacity:.4;cursor:default}
.pg.cur{background:var(--accent);color:var(--accent-ink);border-color:transparent;box-shadow:0 6px 16px -6px color-mix(in srgb,var(--accent) 70%,transparent)}
.pg-dots{color:var(--txt-3);padding:0 2px}

/* ---------- Empty state ---------- */
.empty{
  grid-column:1 / -1;
  text-align:center;
  color:var(--txt-2);
  padding:clamp(40px,8vw,72px) 24px;
  background:var(--surface);
  border:1px dashed var(--line-strong);
  border-radius:var(--radius);
  font-size:15.5px;
}
.empty::before{
  content:"🏠";
  display:block;font-size:40px;margin-bottom:14px;filter:grayscale(.2);
}

/* ---------- Scroll to top ---------- */
.up{
  position:fixed;right:22px;bottom:22px;z-index:1200;
  width:50px;height:50px;border-radius:50%;
  border:none;cursor:pointer;
  color:var(--accent-ink);
  background:linear-gradient(120deg,var(--accent),var(--accent-2));
  font-size:22px;font-weight:800;line-height:1;
  box-shadow:0 10px 26px -8px color-mix(in srgb,var(--accent) 80%,transparent),0 4px 10px rgba(0,0,0,.15);
  opacity:0;transform:translateY(14px) scale(.9);pointer-events:none;
  transition:opacity .2s, transform .2s, filter .15s;
  display:flex;align-items:center;justify-content:center;
}
.up.show{opacity:1;transform:none;pointer-events:auto}
.up:hover{filter:brightness(1.06)}
.up:active{transform:scale(.94)}

/* ---------- Feedback (пожелания) ---------- */
.foot{display:flex;flex-direction:column;align-items:center;gap:10px;margin:34px 2px 0;padding-top:26px;border-top:1px solid var(--line)}
.foot .foot-h{font-size:14.5px;font-weight:600;color:var(--txt-2)}
.fb-open{
  font:inherit;font-size:15.5px;font-weight:700;letter-spacing:-.01em;
  color:var(--accent-ink);
  background:linear-gradient(120deg,var(--accent),var(--accent-2));
  border:none;border-radius:999px;padding:14px 28px;cursor:pointer;
  box-shadow:0 10px 26px -6px color-mix(in srgb,var(--accent) 72%,transparent);
  transition:transform .12s, box-shadow .15s, filter .15s;
  display:inline-flex;align-items:center;gap:9px;
}
.fb-open:hover{filter:brightness(1.05);box-shadow:0 14px 30px -6px color-mix(in srgb,var(--accent) 80%,transparent)}
.fb-open:active{transform:translateY(1px)}
.fb-overlay{
  position:fixed;inset:0;z-index:1400;
  background:rgba(10,12,18,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;padding:18px;
}
.fb-overlay.show{display:flex}
.fb-panel{
  width:100%;max-width:460px;position:relative;
  background:var(--surface);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:24px 22px 22px;
}
.fb-panel h3{margin:0 0 4px;font-size:19px;font-weight:800;letter-spacing:-.02em}
.fb-panel .sub{margin:0 0 14px;color:var(--txt-3);font-size:13px;line-height:1.5}
.fb-panel input,.fb-panel textarea{
  width:100%;font:inherit;font-size:15px;color:var(--txt);
  background:var(--surface-2);border:1px solid var(--line);
  border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:10px;
}
.fb-panel textarea{min-height:120px;resize:vertical}
.fb-panel input:focus,.fb-panel textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px var(--focus)}
.fb-send{
  width:100%;font:inherit;font-size:16px;font-weight:700;
  color:var(--accent-ink);background:linear-gradient(120deg,var(--accent),var(--accent-2));
  border:none;border-radius:var(--radius-sm);padding:13px;cursor:pointer;
}
.fb-send:hover{filter:brightness(1.05)}
.fb-send:disabled{opacity:.6;cursor:default}
.fb-close{
  position:absolute;top:12px;right:14px;width:32px;height:32px;
  border:none;background:var(--surface-2);border-radius:50%;
  font-size:20px;color:var(--txt-2);cursor:pointer;line-height:1;
}
.fb-close:hover{background:var(--surface-3)}
.fb-status{font-size:13.5px;margin-top:10px;min-height:18px}
.fb-status.ok{color:#12b76a}
.fb-status.err{color:#e5484d}

/* ---------- Country switch (РБ / РФ) ---------- */
.country{
  display:inline-flex;gap:4px;
  background:var(--surface-2);border:1px solid var(--line);
  border-radius:999px;padding:4px;margin:0 0 18px;
}
.country button{
  font:inherit;font-size:14px;font-weight:700;
  color:var(--txt-2);background:none;border:none;cursor:pointer;
  padding:9px 17px;border-radius:999px;
  transition:background .15s,color .15s;
}
.country button.on{background:var(--accent);color:var(--accent-ink)}

/* ---------- Chips row (РФ: оплата, удобства) ---------- */
.chiprow{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chip{
  font:inherit;font-size:13px;font-weight:600;
  color:var(--txt-2);background:var(--surface-2);border:1px solid var(--line);
  border-radius:999px;padding:8px 13px;cursor:pointer;
  transition:background .15s,color .15s,border-color .15s;
}
.chip:hover{border-color:var(--line-strong)}
.chip.on{background:var(--accent);color:var(--accent-ink);border-color:transparent}
.chip.pay.on{background:#12b76a;color:#fff}
.chip-sep{font-size:12.5px;color:var(--txt-3);font-weight:700;margin-left:4px}
.amen{grid-column:1 / -1;margin-top:2px}
.amen > span{display:block;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--txt-3);padding-left:2px;margin-bottom:9px}
.amen-box{display:flex;flex-wrap:wrap;gap:10px 18px}
.amen-item{display:inline-flex;align-items:center;gap:7px;font-size:14px;color:var(--txt);cursor:pointer;user-select:none;font-weight:500}
.amen-item input{
  -webkit-appearance:auto; appearance:auto;   /* сброс .bar input, иначе чекбокс без галочки */
  width:18px; height:18px; min-height:0; flex:0 0 auto;
  padding:0; margin:0; border:none; border-radius:0; background:none; box-shadow:none;
  accent-color:var(--accent); cursor:pointer;
}
.amen-item.amen-all{color:var(--txt);padding-right:16px;margin-right:6px;border-right:1px solid var(--line)}

/* ---------- 101Hotels (РФ) source colours ---------- */
.tag.H101{background:linear-gradient(120deg,#7c3aed,#a855f7)}
.price-pin.H101{background:#7c3aed}
.tag.Flatbook{background:linear-gradient(120deg,#0a9d70,#12c78f)}
.price-pin.Flatbook{background:#0a9d70}

.onlyph{grid-column:1 / -1;margin-top:2px}
.share{
  position:absolute;top:10px;right:58px;z-index:3;
  width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;
  background:rgba(20,24,33,.42);color:#fff;font-size:17px;line-height:1;
  display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(4px);transition:transform .15s, background .15s;
}
.share:hover{transform:scale(1.08);background:rgba(20,24,33,.6)}
.toast{
  position:fixed;left:50%;bottom:26px;transform:translate(-50%,20px);
  background:var(--txt);color:var(--surface);font-size:14.5px;font-weight:600;
  padding:12px 20px;border-radius:999px;box-shadow:var(--shadow-lg);
  opacity:0;pointer-events:none;transition:opacity .2s, transform .2s;z-index:9999;
}
.toast.show{opacity:1;transform:translate(-50%,0)}
/* Быстрые наборы фильтров — чтобы человеку с ролика не пришлось возиться с полями */
/* Места: карточки достопримечательностей */
.pl-grid{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:640px){.pl-grid{grid-template-columns:1fr 1fr}}
@media(min-width:1000px){.pl-grid{grid-template-columns:repeat(3,1fr)}}
.plc{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm)}
.plc .ph{position:relative;aspect-ratio:16/10;background:var(--surface-3)}
.plc .ph img{width:100%;height:100%;object-fit:cover;display:block}
.mp-ph1{width:100%;height:120px;object-fit:cover;border-radius:8px;display:block;margin-bottom:8px}
.mp-ph{position:relative}
.mp-ph .mp-ph1{display:none}
.mp-ph .mp-ph1.on{display:block}
.mp-ph-b{position:absolute;top:52px;transform:translateY(-50%);width:28px;height:28px;border:0;
  border-radius:999px;background:rgba(28,25,23,.55);color:#fff;font-size:19px;line-height:1;
  cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.mp-ph-b:hover{background:rgba(28,25,23,.82)}
.mp-ph-l{left:6px}.mp-ph-r{right:6px}
.mp-ph-n{position:absolute;right:8px;top:92px;background:rgba(28,25,23,.6);color:#fff;
  font-size:11px;padding:2px 7px;border-radius:999px}
.mp-pl .mp-pic-box:empty{display:none}
.mp-pl .mp-pic{width:100%;height:130px;object-fit:cover;border-radius:10px;margin-bottom:8px;display:block}
.mp-pl .mp-tx:empty{display:none}
.mp-pl .mp-tx{font-size:12.5px;line-height:1.45;color:var(--txt-2);margin:6px 0 8px;
  max-height:132px;overflow:auto}
.mp-pl .mp-coord{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 8px;
  padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:var(--surface-2);
  font:inherit;font-size:12.5px;color:var(--txt-2);cursor:pointer;text-align:left}
.mp-pl .mp-coord span{margin-left:auto;color:var(--accent);font-size:11.5px}
.mp-pl .mp-coord:hover{border-color:var(--accent)}
.allstay{display:block;width:100%;margin-top:10px;padding:11px 14px;border:0;border-radius:11px;
  background:var(--accent);color:#fff;font:inherit;font-weight:700;font-size:14px;cursor:pointer}
.allstay:hover{filter:brightness(1.06)}
/* Пока маршрут набирается, панель уезжает вверх за экран. Полоска внизу
   держит его на виду и ведёт на страницу с картой. */
#routeBar{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:60;
  background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:700;
  font-size:14.5px;padding:12px 20px;border-radius:999px;box-shadow:0 8px 24px rgba(41,32,24,.28)}
#routeBar:hover{background:var(--accent-2)}
@media (max-width:520px){ #routeBar{left:12px;right:12px;transform:none;text-align:center} }
#routeBox{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:14px 16px;margin:0 0 14px;box-shadow:var(--shadow-sm)}
.rt-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.rt-head b{font-size:16px}
#rtSum{color:var(--txt-3);font-size:13.5px}
.rt-clear{margin-left:auto;font:inherit;font-size:13px;color:var(--txt-2);background:none;
  border:1px solid var(--line);border-radius:999px;padding:4px 12px;cursor:pointer}
.rt-clear:hover{border-color:var(--accent);color:var(--accent)}
.rt-item{display:flex;align-items:baseline;gap:9px;padding:5px 0;font-size:14.5px;
  border-top:1px solid var(--line)}
.rt-item:first-child{border-top:0}
.rt-item .n{width:22px;height:22px;flex:none;border-radius:50%;background:var(--accent);color:var(--accent-ink);
  font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.rt-item .km{margin-left:auto;color:var(--txt-3);font-size:13px;white-space:nowrap}
.rt-item .x{font:inherit;background:none;border:0;color:var(--txt-3);cursor:pointer;padding:0 2px}
.rt-item .x:hover{color:var(--accent)}
.rt-go{display:inline-block;margin-top:12px;background:var(--accent);color:var(--accent-ink);
  text-decoration:none;font-weight:700;font-size:14.5px;border-radius:var(--radius-sm);padding:11px 18px}
.rt-go:hover{background:var(--accent-2)}
.plc .toroute{font:inherit;font-size:13.5px;font-weight:600;background:var(--surface-2);
  border:1px solid var(--line);border-radius:999px;padding:7px 14px;cursor:pointer;color:var(--txt-2)}
.plc .toroute.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.empty-go{display:block;margin:12px auto 0;font:inherit;font-weight:700;background:var(--accent);color:var(--accent-ink);border:0;border-radius:11px;padding:12px 20px;cursor:pointer}
.empty-go:hover{filter:brightness(1.07)}
.fld.off{opacity:.45}
.fld.off select{cursor:not-allowed}
.plc .nopic{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  color:var(--txt-3);font-size:13px;background:repeating-linear-gradient(45deg,
  var(--surface-2),var(--surface-2) 12px,var(--surface-3) 12px,var(--surface-3) 24px)}
.plc .km{position:absolute;left:10px;top:10px;background:rgba(20,24,33,.72);color:#fff;
  font-size:12.5px;font-weight:700;border-radius:999px;padding:4px 11px;backdrop-filter:blur(4px)}
.plc .bd{padding:13px 15px 15px;display:flex;flex-direction:column;gap:7px;flex:1}
.plc .ct{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--txt-3)}
.plc h3{margin:0;font-size:17px;line-height:1.28}
.plc .ad{font-size:13.5px;color:var(--txt-2)}
.plc .tx{font-size:14px;color:var(--txt-2);line-height:1.5}
.plc .cred{font-size:11.5px;color:var(--txt-3)}
.plc .cred a{color:var(--txt-3)}
.plc .row{margin-top:auto;padding-top:8px;display:flex;gap:8px;flex-wrap:wrap}
.plc .row a,.plc .row button{font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;
  border-radius:999px;padding:8px 14px;text-decoration:none;border:1px solid var(--line);
  background:var(--surface-2);color:var(--txt-2)}
.plc .row .go2{background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;border:none}
.plc .row .stay2{background:var(--accent-soft);color:var(--accent);border-color:transparent}
.seenear{width:100%;margin-top:8px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;
  background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-xs);
  padding:9px 12px;color:var(--txt-2)}
.seenear:hover{border-color:var(--accent);color:var(--accent)}
.pl-pin{display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;
  background:#6d4bd6;color:#fff;font-size:15px;border:3px solid #fff;box-shadow:0 3px 10px rgba(20,24,33,.35)}
.near{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--radius-sm);
  padding:12px 14px;margin-top:10px}
.near b{display:block;margin-bottom:8px;font-size:14px}
.near-list{display:flex;gap:10px;overflow-x:auto}
.near-list a{flex:0 0 150px;text-decoration:none;color:inherit}
.near-list img{width:100%;height:92px;object-fit:cover;border-radius:10px;display:block}
.near-list .p{font-weight:800;font-size:15px;margin-top:5px}
.near-list .s{font-size:12px;color:var(--txt-3)}
.presets{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 10px;margin:0 0 6px;-webkit-overflow-scrolling:touch}
.presets::-webkit-scrollbar{display:none}
.preset{
  flex:0 0 auto;font:inherit;font-size:14px;font-weight:600;white-space:nowrap;
  color:var(--txt-2);background:var(--surface);border:1px solid var(--line);
  border-radius:999px;padding:9px 16px;cursor:pointer;transition:.15s;
}
.preset:hover{border-color:var(--line-strong);color:var(--txt)}
.preset.on{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);
  box-shadow:0 4px 14px -4px color-mix(in srgb,var(--accent) 70%,transparent)}
/* Кружки с числом вместо кучи наложенных меток */
.cl-pin{
  display:flex;align-items:center;justify-content:center;
  width:44px;height:44px;border-radius:50%;
  background:linear-gradient(135deg,var(--accent),var(--accent-2));
  color:#fff;font-weight:800;font-size:14px;
  border:3px solid #fff;box-shadow:0 4px 14px rgba(20,24,33,.35);
}
.cl-pin.big{width:56px;height:56px;font-size:16px}
.ftoggle{
  display:none;align-items:center;gap:10px;width:100%;
  font:inherit;font-size:15px;font-weight:700;color:var(--txt);
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);
  padding:13px 16px;margin-bottom:12px;cursor:pointer;text-align:left;
  box-shadow:var(--shadow-sm);
}
.ftoggle .sum{font-weight:500;color:var(--txt-3);font-size:13.5px;margin-left:auto;text-align:right}
.fav{
  position:absolute;top:10px;right:10px;z-index:3;
  width:40px;height:40px;border-radius:50%;border:none;cursor:pointer;
  background:rgba(20,24,33,.42);color:#fff;font-size:19px;line-height:1;
  display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(4px);transition:transform .15s, background .15s;
}
.fav:hover{transform:scale(1.08);background:rgba(20,24,33,.6)}
.fav.on{background:var(--accent);color:#fff}
.slider{position:relative}
.sub-box{
  background:var(--surface);border:1px dashed var(--line-strong);border-radius:var(--radius);
  padding:18px 20px;margin:22px 0 6px;text-align:center;
}
.sub-box h3{margin:0 0 6px;font-size:17px}
.sub-box p{margin:0 0 12px;color:var(--txt-2);font-size:14px}
.sub-box .soon{display:inline-block;font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:4px 11px;margin-bottom:9px}
.sub-btn{
  font:inherit;font-size:15px;font-weight:700;color:var(--accent-ink);
  background:linear-gradient(120deg,var(--accent),var(--accent-2));
  border:none;border-radius:var(--radius-sm);padding:12px 22px;cursor:pointer;
}
.sub-btn:disabled{opacity:.6;cursor:default;background:var(--surface-3);color:var(--txt-2)}
.sub-ok{margin-top:10px;font-size:14px;color:var(--txt-2)}
@media (max-width:639px){
  .ftoggle{display:flex}
  .bar.hid{display:none}
}
.cities{margin:18px 2px 6px;font-size:13.5px;color:var(--txt-3);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cities a{color:var(--txt-2);text-decoration:none;background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:5px 13px}
.cities a:hover{border-color:var(--accent);color:var(--accent)}
/* ---------- Responsive ---------- */
@media (min-width:640px){
  .bar{grid-template-columns:repeat(3,1fr)}
  .fld.span-2{grid-column:span 1}
}
@media (min-width:1000px){
  .bar{grid-template-columns:repeat(6,1fr)}
  .go{grid-column:1 / -1}
}
</style></head><body>
<div class="wrap">
 <div class="hero-ink">
  <header class="top">
    <a class="brand" href="/" aria-label="Поиск жилья на сутки">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.4 12 4l9 7.4V20a1 1 0 0 1-1 1h-5.2v-5.6H9.2V21H4a1 1 0 0 1-1-1z"/></svg>
      <span>Поиск жилья<b>на сутки, в одном месте</b></span>
    </a>
    <span class="kicker"><span class="dot"></span>Kufar · Realt · Flatbook · 101Hotels</span>
  </header>
  <h1>Жильё на сутки, <span class="accent">без лишних вкладок</span></h1>
  <p class="lead">Квартиры, коттеджи и усадьбы на сутки из Kufar, Realt и Flatbook по Беларуси — плюс отели и жильё России с 101Hotels. Всё в одной ленте и на карте: настройте фильтры и найдите вариант под свою дату и бюджет.</p>

 </div>

  <div class="country">
    <button id="cbBY" class="on" type="button" onclick="setCountry('by')">Беларусь · посуточно</button>
    <button id="cbRU" type="button" onclick="setCountry('ru')">Россия · отели</button>
    <button id="cbPL" type="button" onclick="setCountry('places')">🏰 Что посетить</button>
  </div>

  <button id="fToggle" class="ftoggle" type="button" aria-expanded="true"><span>⚙️ Фильтры</span><span class="sum" id="fSum"></span></button>
  <form class="bar" id="bar" onsubmit="return false">
    <label class="fld" style="grid-column:1 / -1">
      <span>🔎 Поиск по названию</span>
      <input id="qname" type="text" placeholder="усадьба «Веста» — ищем по всей Беларуси">
    </label>
    <label class="fld">
      <span>Область</span>
      <select id="region">
        <option value="any">Любая область</option>
        <option value="brest">Брестская обл.</option>
        <option value="minsk" selected>Минск (город)</option>
        <option value="minsk-obl">Минская обл.</option>
        <option value="gomel">Гомельская обл.</option>
        <option value="grodno">Гродненская обл.</option>
        <option value="vitebsk">Витебская обл.</option>
        <option value="mogilev">Могилёвская обл.</option>
      </select>
    </label>

    <label class="fld">
      <span>Город</span>
      <select id="city">
        <option value="">любой</option>
      </select>
    </label>

    <label class="fld">
      <span>Тип жилья</span>
      <select id="type">
        <option value="any">любой</option>
        <option value="flat">Квартира</option>
        <option value="cottage">Коттедж / дом</option>
        <option value="usadba">Усадьба</option>
      </select>
    </label>

    <label class="fld">
      <span>Комнат</span>
      <select id="rooms">
        <option value="" selected>любое</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3+</option>
      </select>
    </label>

    <label class="fld">
      <span>Цена от, руб</span>
      <input id="min" type="number" min="0" placeholder="любая">
    </label>

    <label class="fld">
      <span>Цена до, руб</span>
      <input id="max" type="number" min="0" placeholder="без огранич.">
    </label>

    <label class="fld">
      <span>Гостей</span>
      <select id="guests">
        <option value="">любое</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
        <option value="6">6</option>
        <option value="8">8+</option>
      </select>
    </label>

    <label class="fld">
      <span>Источник</span>
      <select id="source">
        <option value="both">Все источники</option>
        <option value="kufar">Только Kufar</option>
        <option value="realt">Только Realt</option>
        <option value="flatbook">Только Flatbook</option>
      </select>
    </label>

    <label class="fld">
      <span>Сортировка</span>
      <select id="sort">
        <option value="price_asc">Дешёвые сверху</option>
        <option value="price_desc">Дорогие сверху</option>
        <option value="rating_desc">По рейтингу</option>
      </select>
    </label>

    <label class="fld">
      <span>Заезд</span>
      <input id="from" type="date">
    </label>

    <label class="fld">
      <span>Выезд</span>
      <input id="to" type="date">
    </label>

    <div class="amen">
      <span>Удобства в номере</span>
      <div class="amen-box">${RB_AMEN_CHECKS}</div>
    </div>
    <div class="onlyph"><label class="amen-item"><input type="checkbox" id="onlyPhoto"> Только с фото</label></div>
    <button id="go" class="go" type="button">Найти</button>
  </form>

  <form class="bar" id="barRF" style="display:none" onsubmit="return false">
    <label class="fld">
      <span>Город</span>
      <select id="rfCity">${RF_CITY_OPTIONS}</select>
    </label>
    <label class="fld">
      <span>Тип размещения</span>
      <select id="rfType"><option value="">любой</option>${RF_TYPE_OPTIONS}</select>
    </label>
    <label class="fld">
      <span>Звёзды</span>
      <select id="rfStars">
        <option value="">любые</option>
        <option value="3,4,5">3★ и выше</option>
        <option value="4,5">4★ и выше</option>
        <option value="5">5★</option>
      </select>
    </label>
    <label class="fld">
      <span>Цена от, ₽</span>
      <input id="rfMin" type="number" min="0" placeholder="любая">
    </label>
    <label class="fld">
      <span>Цена до, ₽</span>
      <input id="rfMax" type="number" min="0" placeholder="без огранич.">
    </label>
    <label class="fld">
      <span>Рейтинг</span>
      <select id="rfRating">
        <option value="">любой</option>
        <option value="7">7+ хорошо</option>
        <option value="8">8+ очень хорошо</option>
        <option value="9">9+ отлично</option>
      </select>
    </label>
    <label class="fld">
      <span>Сортировка</span>
      <select id="rfSort">
        <option value="price_asc">Дешёвые сверху</option>
        <option value="price_desc">Дорогие сверху</option>
        <option value="rating_desc">По рейтингу</option>
      </select>
    </label>
    <div class="chiprow">
      <button type="button" class="chip pay" id="rfNoCard" data-pay="1">💳 Оплата при заселении</button>
    </div>
    <div class="amen">
      <span>Удобства в номере</span>
      <div class="amen-box">
        <label class="amen-item amen-all"><input type="checkbox" id="rfBathroom"> <b>Удобства в номере</b></label>
        ${RF_SERVICE_CHECKS}
      </div>
    </div>
    <div class="onlyph"><label class="amen-item"><input type="checkbox" id="rfOnlyPhoto"> Только с фото</label></div>
    <button id="goRF" class="go" type="button">Найти отели</button>
  </form>

  <form class="bar" id="barPL" style="display:none" onsubmit="return false">
    <label class="fld span-2">
      <span>🔎 Поиск по названию</span>
      <input id="plQ" type="text" placeholder="замок, костёл, Мир, Несвиж…">
    </label>
    <label class="fld">
      <span>Рядом с городом</span>
      <select id="plCity"></select>
    </label>
    <label class="fld">
      <span>В радиусе</span>
      <select id="plRadius">
        <option value="25">25 км</option>
        <option value="50" selected>50 км</option>
        <option value="100">100 км</option>
        <option value="200">200 км</option>
        <option value="0">вся Беларусь</option>
      </select>
    </label>
    <label class="fld span-2">
      <span>Что смотреть</span>
      <select id="plGroup"><option value="">всё подряд</option></select>
    </label>
    <label class="fld">
      <span>Заезд</span>
      <input id="plFrom" type="date">
    </label>
    <label class="fld">
      <span>Выезд</span>
      <input id="plTo" type="date">
    </label>
  </form>

  <div class="presets" id="presets">
    <button class="preset" type="button" data-preset="cheap">до 60 руб</button>
    <button class="preset" type="button" data-preset="weekend">на выходные</button>
    <button class="preset" type="button" data-preset="company">компания 6+</button>
    <button class="preset" type="button" data-preset="usadba">усадьбы</button>
    <button class="preset" type="button" data-preset="one">1 комната</button>
    <button class="preset" type="button" data-preset="photo">только с фото</button>
  </div>

  <div class="toolbar">
    <div id="stat"></div>
    <span id="geo" style="color:var(--txt-3);font-size:12.5px"></span>
    <div class="seg" role="tablist" aria-label="Вид">
      <button id="viewList" class="on" type="button" onclick="setView('list')">☰ Список</button>
      <button id="viewMap" type="button" onclick="setView('map')">📍 Карта</button>
      <button id="viewFav" type="button" onclick="setView('fav')">♥ <span id="favN">0</span></button>
    </div>
  </div>

  <div id="routeBox" style="display:none">
    <div class="rt-head">
      <b>Маршрут на день</b>
      <span id="rtSum"></span>
      <button type="button" id="rtClear" class="rt-clear">очистить</button>
    </div>
    <div id="rtList"></div>
    <a id="routeGo" class="rt-go" href="/marshrut" target="_blank" rel="noopener">Посмотреть маршрут на карте →</a>
  </div>

  <div id="map" style="display:none"></div>
  <div id="grid"></div>
  <div id="pager"></div>

  <nav class="cities" aria-label="Города">Квартиры на сутки по городам: <a href="/minsk">Минск</a><a href="/brest">Брест</a><a href="/gomel">Гомель</a><a href="/grodno">Гродно</a><a href="/vitebsk">Витебск</a><a href="/mogilev">Могилёв</a><a href="/minsk-obl">Минская область</a></nav>
  <p class="hint" id="hint">Цены и наличие подтягиваются напрямую из объявлений Kufar, Realt и Flatbook в режиме реального времени. На карте цена показана прямо на метке: <b style="color:var(--kufar)">синие</b> — Kufar, <b style="color:var(--realt)">оранжевые</b> — Realt, <b style="color:#0a9d70">зелёные</b> — Flatbook (областные центры, квартиры и усадьбы). Точные координаты подтягиваются из объявления; пока адрес уточняется, метка стоит у центра города (значок ≈ в подсказке). Итоговая стоимость за весь период рассчитывается по датам заезда и выезда. Перед бронированием уточняйте детали у собственника.</p>

  <div class="foot">
    <div class="foot-h">Нашли неточность или хотите что-то добавить?</div>
    <div class="sub-box" id="subBox">
    <div class="soon">Скоро</div>
    <h3>Следить за новыми вариантами</h3>
    <p>Появится жильё по вашим фильтрам — пришлём уведомление, чтобы не мониторить вручную.</p>
    <button id="subBtn" class="sub-btn" type="button">Хочу такое</button>
    <div class="sub-ok" id="subOk"></div>
  </div>

    <div class="sub-box" id="plBox" style="display:none">
    <div class="soon">Скоро</div>
    <h3>Знаете место, которого здесь нет?</h3>
    <p>Пришлёте название и координаты — проверим и добавим на карту. Особенно ждём то,
       что не найдёшь в путеводителях: заброшки, валуны, старые мосты, смотровые точки.</p>
    <button id="plBtn" class="sub-btn" type="button">Предложить точку</button>
    <div class="sub-ok" id="plOk"></div>
  </div>

  <button id="fbOpen" class="fb-open" type="button">💬 Оставить пожелание или дополнение</button>
  </div>
</div>

<a id="routeBar" href="/marshrut" target="_blank" rel="noopener" style="display:none"></a>

<div class="fb-overlay" id="fbModal">
  <div class="fb-panel">
    <button class="fb-close" id="fbClose" type="button" aria-label="Закрыть">×</button>
    <h3>Пожелания и дополнения</h3>
    <p class="sub">Что улучшить, какой сайт или город добавить, что не так — напишите, я прочитаю.</p>
    <input id="fbEmail" type="email" placeholder="Ваш email (необязательно, если нужен ответ)">
    <textarea id="fbMsg" placeholder="Ваши пожелания, замечания, идеи…"></textarea>
    <button class="fb-send" id="fbSend" type="button">Отправить</button>
    <div class="fb-status" id="fbStatus"></div>
  </div>
</div>

<div class="toast" id="toast"></div>
<button id="up" class="up" type="button" aria-label="Наверх" title="Наверх">↑</button>

<script>
/*ПРЕДЗАГРУЗКА*/
const $=s=>document.querySelector(s);
const CITIES = ${JSON.stringify(CITIES_MAP)};
const PAGE_SIZE = 24;
window.__page = 1;
window.__view = 'list';
window.__mode = 'by';   // 'by' = Беларусь (Kufar+Realt+Flatbook), 'ru' = Россия (101hotels)

function srcName(s){ return s==='H101' ? '101Hotels' : s; }
function curOf(x){ return (x && x.cur) ? x.cur : 'BYN'; }
const FB_TO = 'a29sdWRhNDlAZ21haWwuY29t';   // адрес обратной связи в base64 (не открытым текстом)
const HINT_RU = 'Отели и жильё России с 101hotels.com в реальном времени. Цена «от» за ночь показана прямо на метке карты (<b style="color:#7c3aed">фиолетовые</b> — 101Hotels, координаты точные). Доступны фильтры по типу размещения, звёздам, цене, рейтингу, удобствам и оплате при заселении. Список и карта; перед бронированием проверяйте даты и условия на 101hotels.com.';

// переключение Беларусь / Россия
function setCountry(c, quiet){
  window.__mode = (c==='ru' || c==='places') ? c : 'by';
  const ru = window.__mode==='ru', pl = window.__mode==='places';
  $('#cbBY').classList.toggle('on', !ru && !pl);
  $('#cbRU').classList.toggle('on', ru);
  $('#cbPL').classList.toggle('on', pl);
  $('#bar').style.display   = (!ru && !pl) ? '' : 'none';
  $('#barRF').style.display = ru ? '' : 'none';
  $('#barPL').style.display = pl ? '' : 'none';
  $('#grid').className = pl ? 'pl-grid' : '';
  // Пресеты и свёрнутые фильтры относятся к жилью Беларуси — в других
  // режимах они только мешают: меняют невидимые поля и путают сводкой.
  const pr = $('#presets'); if(pr) pr.style.display = (ru || pl) ? 'none' : '';
  // Уведомления о новом жилье во вкладке мест ни к чему, а предложить точку
  // логично только там, где эти точки и показаны.
  const sb = $('#subBox'); if(sb) sb.style.display = pl ? 'none' : '';
  const pb = $('#plBox');  if(pb) pb.style.display = pl ? '' : 'none';
  drawRoute();
  const ft = $('#fToggle'); if(ft) ft.style.display = (ru || pl) ? 'none' : '';
  if(!window.__hintBY) window.__hintBY = $('#hint').innerHTML;
  $('#hint').innerHTML = pl ? HINT_PL : (ru ? HINT_RU : window.__hintBY);
  window.__page = 1;
  if(!quiet) run();
}


function fillCities(){
  const reg=$('#region').value, sel=$('#city'), cur=sel.value;
  const list = reg==='any' ? [] : (CITIES[reg]||[]);
  sel.innerHTML='<option value="">любой</option>'+list.map(c=>'<option>'+c+'</option>').join('');
  sel.disabled = (reg==='any');
  if(reg!=='any' && [...sel.options].some(o=>o.value===cur)) sel.value=cur;
}
$('#region').addEventListener('change', fillCities);
fillCities();

function nights(){
  const a=$('#from').value, b=$('#to').value;
  if(!a||!b) return 0;
  const n=Math.round((new Date(b)-new Date(a))/86400000);
  return n>0? n : 0;
}
function currentSort(){
  return window.__mode==='ru'
    ? ($('#rfSort')?$('#rfSort').value:'price_asc')
    : ($('#sort')?$('#sort').value:'price_asc');
}
function sortItems(){
  const s=currentSort();
  (window.__items||[]).sort(function(a,b){ return s==='price_desc'? b.price-a.price : s==='rating_desc'? (((b.rating||0)-(a.rating||0))||(a.price-b.price)) : a.price-b.price; });
}
async function runRF(){
  ++window.__runToken;   // то же самое при переходе на вкладку России
  syncUrl();
  const p=new URLSearchParams({ city:$('#rfCity').value });
  const t=$('#rfType').value;   if(t)  p.set('type', t);
  const st=$('#rfStars').value; if(st) p.set('stars', st);
  const mx=$('#rfMax').value;   if(mx) p.set('max', mx);
  const mn=$('#rfMin').value;   if(mn) p.set('min', mn);
  const rt=$('#rfRating').value;if(rt) p.set('rating', rt);
  p.set('sort', $('#rfSort').value);
  if($('#rfNoCard').classList.contains('on')) p.set('no_card','1');
  const svc=[...document.querySelectorAll('#barRF .amen-cb:checked')].map(cb=>cb.value).join(',');
  if(svc) p.set('services', svc);
  if($('#rfBathroom').checked) p.set('bathroom','1');   // фильтр «Удобства в номере»
  $('#stat').textContent='Ищу отели…'; $('#grid').innerHTML=''; $('#pager').innerHTML='';
  try{
    const d=await (await fetch('/api/rf/search?'+p.toString())).json();
    const cityName=$('#rfCity').selectedOptions[0] ? $('#rfCity').selectedOptions[0].textContent : '';
    $('#stat').textContent='Найдено '+d.total+' отелей'+(cityName?(' · '+cityName):'');
    if(window.__T) window.__T('search', { c:'ru', auto: window.__firstRun?1:0,
      city:cityName||$('#rfCity').value, type:$('#rfType').value||'любой', total:d.total });
    window.__firstRun = 0;
    window.__all=d.items||[]; applyPhotoFilter(); window.__page=1;
    if(!window.__items.length){ $('#grid').innerHTML=пустоТекст(); if(window.__view==='map') plotMap(true); return; }
    sortItems();
    if(window.__view==='map') plotMap(true); else renderCards();
  }catch(e){ $('#stat').textContent='Ошибка: '+e.message; }
}
// Поиск идёт по трём источникам параллельно, и каждый рисуется сразу, как ответил:
// Kufar обычно отвечает первым, поэтому человек видит квартиры, не дожидаясь остальных.
const SRC_NAME = { kufar:'Kufar', realt:'Realt', flatbook:'Flatbook' };
async function run(){
  if(window.__mode==='places') return runPlaces();
  if(window.__mode==='ru') return runRF();
  const name=$('#qname')?$('#qname').value.trim():'';
  const base=new URLSearchParams({
    region:$('#region').value, city:$('#city').value.trim(), type:$('#type').value,
    rooms:$('#rooms').value, guests:$('#guests').value, max:$('#max').value, min:$('#min').value
  });
  const amen=[...document.querySelectorAll('#bar .rb-amen-cb:checked')].map(cb=>cb.value).join(',');
  if(amen) base.set('amen', amen);
  syncUrl();

  const auto = window.__firstRun?1:0; window.__firstRun = 0;
  const token = ++window.__runToken;
  // Если карточки уже нарисованы из предзагрузки, а это первый автоматический
  // поиск — не стираем их. Иначе человек увидит, как готовый список пропадает
  // и сменяется надписью «Ищу…»: ради этого предзагрузка и делалась.
  const keepShown = window.__preloadShown && auto;
  if(!keepShown){
    $('#stat').textContent='Ищу…'; $('#grid').innerHTML=''; $('#pager').innerHTML='';
  }
  window.__preloadShown = false;
  window.__all=[]; window.__items=[]; window.__page=1;

  const N=nights();
  const tail = (name?(' по запросу «'+name+'»'):'') + (N?(', расчёт на '+N+' ноч.'):'');
  if(isNarrow()) filtersCollapsed(true);
  const draw = function(){
    sortItems();
    if(window.__view==='map'){ plotMap(true); enrichRealt(); } else renderCards();
  };

  // поиск по названию сервер делает сразу по всем источникам — один запрос
  if(name){
    const p=new URLSearchParams(base); p.set('source', $('#source').value); p.set('name', name);
    try{
      const d=await (await fetch('/api/search?'+p.toString())).json();
      if(token!==window.__runToken) return;
      const parts=[]; if(d.kufar)parts.push('Kufar '+d.kufar); if(d.realt)parts.push('Realt '+d.realt); if(d.flatbook)parts.push('Flatbook '+d.flatbook);
      $('#stat').textContent='Найдено '+d.total+(parts.length?(' ('+parts.join(' + ')+')'):'')+tail;
      window.__all=d.items||[]; applyPhotoFilter();
      if(!window.__items.length){ $('#grid').innerHTML=пустоТекст(); if(window.__view==='map') plotMap(true); }
      else draw();
      if(window.__T) window.__T('search', { c:'by', auto:auto, region:$('#region').value,
        city:$('#city').value.trim(), type:$('#type').value, rooms:$('#rooms').value||'любое',
        max:+$('#max').value||0, total:d.total });
    }catch(e){ if(token===window.__runToken) $('#stat').textContent='Ошибка: '+e.message; }
    return;
  }

  const pick=$('#source').value;
  let sources = (pick==='both') ? ['kufar','realt','flatbook'] : [pick];
  if(amen) sources = sources.filter(function(x){ return x!=='realt'; });   // у Realt нет данных удобств в списке

  const seen=new Set(), counts={};
  let done=0, failed=0;

  await Promise.all(sources.map(async function(src){
    const p=new URLSearchParams(base); p.set('source', src);
    try{
      const d=await (await fetch('/api/search?'+p.toString())).json();
      if(token!==window.__runToken) return;
      (d.items||[]).forEach(function(x){ if(!seen.has(x.link)){ seen.add(x.link); window.__all.push(x); } });
      applyPhotoFilter();
      counts[src]=d.total||0;
    }catch(e){ failed++; }
    if(token!==window.__runToken) return;
    done++;
    const parts=sources.filter(function(x){ return counts[x]; }).map(function(x){ return SRC_NAME[x]+' '+counts[x]; });
    const hid=(window.__all||[]).length-(window.__items||[]).length;
    const head='Найдено '+window.__items.length+(parts.length?(' ('+parts.join(' + ')+')'):'')+(hid>0?(' · без фото скрыто '+hid):'');
    $('#stat').textContent = (done<sources.length) ? (head+' · ищу ещё…') : (head+tail);
    if(window.__items.length) draw();
  }));

  if(token!==window.__runToken) return;
  if(!window.__items.length){
    $('#grid').innerHTML = failed===sources.length
      ? '<div class="empty">Источники не ответили. Попробуйте ещё раз через минуту.</div>'
      : пустоТекст();
    $('#stat').textContent = failed===sources.length ? 'Ошибка загрузки' : ('Найдено 0'+tail);
    if(window.__view==='map') plotMap(true);
  }
  if(window.__T) window.__T('search', { c:'by', auto:auto, region:$('#region').value,
    city:$('#city').value.trim(), type:$('#type').value, rooms:$('#rooms').value||'любое',
    max:+$('#max').value||0, total:(window.__all||[]).length });
  syncPresets();
}
function renderCards(){
  // Второй рубеж: даже если запоздалый ответ доберётся сюда, он не должен
  // рисовать квартиры в ленте мест.
  if(window.__mode === 'places' && window.__view !== 'fav') return;
  const all = (window.__view==='fav') ? FAVS : (window.__items||[]);
  if(window.__view==='fav' && !all.length){
    $('#grid').innerHTML='<div class="empty">Здесь пусто. Нажмите ♥ на понравившемся варианте — он сохранится в вашем браузере.</div>';
    $('#pager').innerHTML=''; return;
  }
  if(!all.length){ $('#pager').innerHTML=''; return; }
  if(window.__view!=='fav') sortItems();
  const pages=Math.max(1, Math.ceil(all.length/PAGE_SIZE));
  if(window.__page>pages) window.__page=pages;
  if(window.__page<1) window.__page=1;
  const start=(window.__page-1)*PAGE_SIZE;
  const items=all.slice(start, start+PAGE_SIZE);
  const N=nights();
  $('#grid').innerHTML=items.map(function(x,i){
      const idx=start+i;   // глобальный индекс в window.__items (для слайдера/описания)
      const capChip = x.capacity ? ('<span>до '+x.capacity+' гостей</span>') : '';
      const total = N ? ('<div class="total">'+(x.price*N)+' BYN за '+N+' ноч.</div>') : '';
      const call = x.phone ? '<a class="call" href="tel:+'+x.phone+'">'+fmtPhone(x.phone)+(x.name?(' · '+x.name):'')+'</a>' : '';
      const desc = x.descId ? '<div class="desc-t" onclick="showDesc('+idx+')" id="dt'+idx+'">Описание ▾</div><div class="desc" id="dd'+idx+'" style="display:none"></div>' : '';
      let stars='';
      if(x.reviews>0 && x.rating>0){
        const st=Math.round(x.rating/2);
        stars='<div class="stars">'+'★'.repeat(st)+'☆'.repeat(5-st)+'<span class="num">'+x.rating.toFixed(1)+' · '+x.reviews+' отз.</span></div>';
      }
      const tag='<span class="tag '+x.src+'">'+srcName(x.src)+'</span>';
      const meta = x.chips
        ? (x.chips.length
            ? '<div class="meta">'+x.chips.map(function(c){return '<span>'+c+'</span>';}).join('')+'</div>'
            : '')
        : '<div class="meta"><span>'+(x.area||'—')+'</span><span>'+x.rooms+'-комн</span>'+capChip+'</div>';
      const ph=x.photos&&x.photos.length? x.photos : [];
      let slider;
      if(ph.length){
        const nav = ph.length>1
          ? '<button class="nav prev" onclick="slide('+idx+',-1)"></button><button class="nav next" onclick="slide('+idx+',1)"></button><div class="cnt" id="cnt'+idx+'">1/'+ph.length+'</div>'
          : '';
        slider='<div class="slider">'+tag+'<img class="im" id="im'+idx+'" src="'+ph[0]+'" loading="lazy" alt="">'+nav+'</div>';
      } else {
        slider='<div class="slider">'+tag+'</div>';
      }
      const fav = '<button class="fav'+(isFav(x.link)?' on':'')+'" type="button" data-fav="'+idx+'" title="В избранное">\u2665</button>';
      const shr = '<button class="share" type="button" data-share="'+idx+'" title="Поделиться">\u21AA</button>';
      return '<div class="card">'+slider.replace('<div class="slider">', '<div class="slider">'+fav+shr)
        +'<div class="bd">'
        +'<div class="pr">'+x.price+' '+curOf(x)+' <span class="tot">/ '+(x.unit||(x.src==='H101'?'ночь':'сутки'))+'</span></div>'+total+stars
        +meta
        +'<div class="ttl">'+(x.title||'').replace(/</g,'&lt;')+'</div>'+desc
        +'<div class="act">'+call+'<a href="'+x.link+'" target="_blank" rel="noopener">Открыть</a></div>'
        +((x.lat&&x.lng)?('<button class="seenear" type="button" onclick="placesNear('+idx+')">🏰 Что посмотреть рядом</button>'):'')
        +'</div></div>';
    }).join('');
  renderPager(pages);
  loadGalleries();
}
// Дотягиваем галереи фото для Flatbook/101hotels (на текущей странице) — чтобы работал слайдер
async function loadGalleries(){
  if(window.__galBusy) return;
  const start=(window.__page-1)*PAGE_SIZE;
  const pageItems=(window.__items||[]).slice(start, start+PAGE_SIZE);
  // Одна попытка на карточку — мало: страница объявления может не ответить
  // вовремя, и тогда слайдер пропадает у этого посетителя навсегда.
  // Даём вторую попытку через несколько секунд.
  const need=pageItems.filter(x=>(x.src==='Flatbook'||x.src==='H101') && (!x.photos||x.photos.length<2) && (x.__galTry||0)<2 && x.link);
  if(!need.length) return;
  window.__galBusy=true;
  need.forEach(x=>x.__galTry=(x.__galTry||0)+1);
  const reqs=need.map(x=>({ src:x.src, key: x.src==='H101' ? (x.hid+'@@'+x.link) : x.link }));
  try{
    const r=await (await fetch('/api/gallery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reqs:reqs})})).json();
    const res=r.results||{};
    let changed=false;
    need.forEach(x=>{ const key=x.src==='H101'?(x.hid+'@@'+x.link):x.link; const g=res[key]; if(g&&g.length>1){ x.photos=g; changed=true; } });
    window.__galBusy=false;
    if(changed){ applyPhotoFilter(); if(window.__view==='list') renderCards(); }
    const again = need.filter(x=>(!x.photos||x.photos.length<2) && x.__galTry<2);
    if(again.length) setTimeout(loadGalleries, 4000);
  }catch(e){ window.__galBusy=false; need.forEach(x=>x.__galTry=Math.max(0,(x.__galTry||1)-1)); }
}
function renderPager(pages){
  const el=$('#pager');
  if(pages<=1){ el.innerHTML=''; return; }
  const pg=window.__page, win=2;
  let html='<button class="pg" '+(pg<=1?'disabled':'')+' onclick="gotoPage('+(pg-1)+')" aria-label="Назад">‹</button>';
  let start=Math.max(1,pg-win), end=Math.min(pages,pg+win);
  if(start>1){ html+='<button class="pg" onclick="gotoPage(1)">1</button>'; if(start>2) html+='<span class="pg-dots">…</span>'; }
  for(let i=start;i<=end;i++) html+='<button class="pg'+(i===pg?' cur':'')+'" onclick="gotoPage('+i+')">'+i+'</button>';
  if(end<pages){ if(end<pages-1) html+='<span class="pg-dots">…</span>'; html+='<button class="pg" onclick="gotoPage('+pages+')">'+pages+'</button>'; }
  html+='<button class="pg" '+(pg>=pages?'disabled':'')+' onclick="gotoPage('+(pg+1)+')" aria-label="Вперёд">›</button>';
  el.innerHTML=html;
}
function gotoPage(p){
  window.__page=p; renderCards();
  const top=$('#grid').getBoundingClientRect().top+window.scrollY-80;
  window.scrollTo({top:top,behavior:'smooth'});
}
// вид: список / карта
function setView(v){
  window.__view=v;
  if(v==='map' && window.__T) window.__T('map', {});
  if(v==='fav' && window.__T) window.__T('favlist', {});
  $('#viewList').classList.toggle('on', v==='list');
  $('#viewMap').classList.toggle('on', v==='map');
  $('#viewFav').classList.toggle('on', v==='fav');
  const cards = (v==='list' || v==='fav');
  $('#grid').style.display  = cards ? '' : 'none';
  $('#pager').style.display = cards ? '' : 'none';
  $('#map').style.display   = v==='map' ? '' : 'none';
  window.__page = 1;
  if(window.__mode==='places'){ if(v==='map') plotPlaces(); else renderPlaces(); return; }
  if(v==='map'){ plotMap(true); enrichRealt(); } else renderCards();
}
// карта Leaflet: цена на метке, тултип при наведении, карточка в попапе
function popupHtml(x){
  const img = снимкиОкошка(x.photos);
  if(x.chips){   // отель 101hotels / flatbook (карточка по чипам)
    const unit=x.unit||(x.src==='H101'?'ночь':'сутки');
    const rate=(x.reviews>0&&x.rating>0)? '<div style="font-size:12px;color:#e6a400;font-weight:700;margin:2px 0">★ '+x.rating.toFixed(1)+' · '+x.reviews+' отз.</div>':'';
    const call=x.phone? '<a class="mp-call" href="tel:+'+x.phone+'">📞 '+fmtPhone(x.phone)+'</a>':'';
    return '<div class="mp"><div class="mp-price">'+x.price+' '+curOf(x)+' <small>/ '+unit+'</small></div>'
      +'<div class="mp-meta">'+(x.title||'')+'</div>'
      +(x.chips.length ? ('<div class="mp-meta">'+x.chips.join(' · ')+'</div>') : '')+rate+img+call
      +'<a class="mp-open" href="'+x.link+'" target="_blank" rel="noopener">Открыть на '+srcName(x.src)+' →</a></div>';
  }
  const call=x.phone? '<a class="mp-call" href="tel:+'+x.phone+'">📞 '+fmtPhone(x.phone)+(x.name?(' · '+x.name):'')+'</a>':'';
  const ap=x.approx? '<div class="mp-approx">≈ адрес примерный (по городу)</div>':'';
  const cap=x.capacity? (' · до '+x.capacity+' гостей'):'';
  return '<div class="mp"><div class="mp-price">'+x.price+' BYN <small>/ сутки</small></div>'
    +'<div class="mp-meta">'+(x.area||'')+' · '+x.rooms+'-комн'+cap+'</div>'
    +img+call
    +'<a class="mp-open" href="'+x.link+'" target="_blank" rel="noopener">Открыть на '+x.src+' →</a>'+ap+'</div>';
}
// Первый кадр с адресом, остальные — с пометкой: пока человек не листает,
// браузер их не трогает. Иначе открытие метки тянуло бы восемь снимков.
function снимкиОкошка(photos){
  const с = (photos || []).filter(Boolean).slice(0, 8);
  if(!с.length) return '';
  if(с.length === 1)
    return '<img class="mp-ph1" src="' + с[0] + '" alt="">';
  return '<div class="mp-ph">'
    + с.map(function(u, i){
        return '<img class="mp-ph1' + (i ? '' : ' on') + '"'
             + (i ? (' data-src="' + u + '"') : (' src="' + u + '"')) + ' alt="">';
      }).join('')
    + '<button class="mp-ph-b mp-ph-l" type="button" onclick="окошкоЛистать(this,-1)">‹</button>'
    + '<button class="mp-ph-b mp-ph-r" type="button" onclick="окошкоЛистать(this,1)">›</button>'
    + '<span class="mp-ph-n">1/' + с.length + '</span></div>';
}

function окошкоЛистать(кн, шаг){
  const к = кн.parentNode;
  const с = к.querySelectorAll('.mp-ph1');
  let н = 0;
  for(let i = 0; i < с.length; i++) if(с[i].classList.contains('on')) н = i;
  с[н].classList.remove('on');
  н = (н + шаг + с.length) % с.length;
  // подставляем адрес показываемому и соседним, чтобы листалось без пауз
  [н, (н + 1) % с.length, (н - 1 + с.length) % с.length].forEach(function(i){
    const э = с[i]; if(э && !э.getAttribute('src') && э.dataset.src) э.src = э.dataset.src;
  });
  с[н].classList.add('on');
  к.querySelector('.mp-ph-n').textContent = (н + 1) + '/' + с.length;
}

function plotMap(fit){
  if(typeof L==='undefined'){ $('#map').innerHTML='<div style="padding:24px;color:var(--txt-2)">Карта не загрузилась (нет связи с картографическим сервисом).</div>'; return; }
  if(!window.__map){
    window.__map=L.map('map',{scrollWheelZoom:true}).setView([53.70,27.95],6);
    window.__map.attributionControl.setPrefix('Leaflet');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(window.__map);
    // Метки в центре города наваливаются друг на друга сотнями и карта
    // становится нечитаемой. Близкие собираем в кружок с числом.
    window.__mlayer = (typeof L.markerClusterGroup === 'function')
      ? L.markerClusterGroup({
          maxClusterRadius: 55,
          showCoverageOnHover: false,
          spiderfyDistanceMultiplier: 1.6,
          iconCreateFunction: function(cl){
            const n = cl.getChildCount(), big = n > 50, sz = big ? 56 : 44;
            return L.divIcon({ className:'', iconSize:[sz,sz], iconAnchor:[sz/2,sz/2],
              html:'<div class="cl-pin'+(big?' big':'')+'">'+n+'</div>' });
          }
        })
      : L.layerGroup();
    window.__map.addLayer(window.__mlayer);
  }
  window.__mlayer.clearLayers();
  const items=(window.__items||[]).filter(x=>x.lat&&x.lng);
  const pts=[];
  items.forEach(function(x){
    const icon=L.divIcon({className:'',iconSize:[1,1],iconAnchor:[0,0],html:'<div class="price-pin '+x.src+'">'+x.price+'</div>'});
    const mk=L.marker([x.lat,x.lng],{icon:icon,riseOnHover:true});
    window.__mlayer.addLayer(mk);
    const tip = x.chips
      ? ((x.chips.length ? (x.chips.join(' · ')+' · ') : '')+x.price+' '+curOf(x))
      : ((x.area?x.area+' · ':'')+x.rooms+'-комн · '+x.price+' BYN'+(x.approx?' (≈)':''));
    mk.bindTooltip(tip,{direction:'top',offset:[0,-14]});
    mk.bindPopup(popupHtml(x),{maxWidth:260,minWidth:220});
    pts.push([x.lat,x.lng]);
  });
  setTimeout(function(){
    window.__map.invalidateSize();
    if(fit && pts.length) window.__map.fitBounds(pts,{padding:[45,45],maxZoom:15});
  },60);
}
// Точные координаты Realt подгружаем со страниц объектов порциями (фоном, с кэшем на сервере)
async function enrichRealt(){
  if(window.__enriching) return;            // защита от повторного входа
  window.__enriching=true;
  const note=$('#geo');
  try{
    while(window.__view==='map'){
      const need=(window.__items||[]).filter(x=>x.src==='Realt' && x.approx && x.link && !x.__geoTried);
      if(!need.length) break;
      if(note) note.textContent='уточняю точные адреса Realt… (' + need.length + ')';
      const chunk=need.slice(0,40);
      chunk.forEach(x=>x.__geoTried=true);
      let moved=0;
      try{
        const r=await (await fetch('/api/geo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls:chunk.map(x=>x.link)})})).json();
        const res=r.results||{};
        chunk.forEach(x=>{ const c=res[x.link]; if(c && c.length===2){ x.lat=c[0]; x.lng=c[1]; x.approx=false; moved++; } });
      }catch(e){}
      if(moved && window.__view==='map') plotMap(false);   // перерисовать без сброса масштаба
    }
  } finally {
    window.__enriching=false;
    if(note) note.textContent='';
  }
}
// телефон: 375298261243 -> +375 29 826-12-43
function fmtPhone(p){
  const s=String(p).replace(/\\D/g,'');
  const m=s.match(/^375(\\d{2})(\\d{3})(\\d{2})(\\d{2})$/);
  return m? '+375 '+m[1]+' '+m[2]+'-'+m[3]+'-'+m[4] : '+'+s;
}
// раскрыть описание (ленивая загрузка)
async function showDesc(card){
  const it=window.__items[card]; if(!it) return;
  const t=document.getElementById('dt'+card), d=document.getElementById('dd'+card);
  if(d.style.display==='block'){ d.style.display='none'; t.textContent='Описание ▾'; return; }
  d.style.display='block'; t.textContent='Описание ▲';
  if(!d.dataset.loaded){
    d.textContent='Загружаю…';
    try{
      const p=new URLSearchParams({src:it.src});
      if(it.src==='Kufar') p.set('id', it.descId); else p.set('url', it.link);
      const r=await (await fetch('/api/desc?'+p.toString())).json();
      d.textContent = r.text || 'Описание не указано. Смотрите на площадке.';
      d.dataset.loaded='1';
    }catch(e){ d.textContent='Не удалось загрузить описание.'; }
  }
}
// листание фото в карточке
window.__idx={};
function slide(card, dir){
  const ph=(window.__items[card]||{}).photos||[];
  if(ph.length<2) return;
  const cur=(window.__idx[card]||0);
  const next=(cur+dir+ph.length)%ph.length;
  window.__idx[card]=next;
  const img=document.getElementById('im'+card); if(img) img.src=ph[next];
  const cnt=document.getElementById('cnt'+card); if(cnt) cnt.textContent=(next+1)+'/'+ph.length;
}
// Беларусь
document.querySelectorAll('#bar select, #bar input').forEach(el=>{ if(el.id!=='sort') el.addEventListener('change',run); });
$('#sort').addEventListener('change', function(){ window.__page=1; renderCards(); });
$('#go').addEventListener('click',run);
$('#qname').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); run(); } });
// Россия (101hotels)
document.querySelectorAll('#barRF select, #barRF input').forEach(el=>{ if(el.id!=='rfSort') el.addEventListener('change',run); });
$('#rfSort').addEventListener('change', function(){ window.__page=1; renderCards(); });
document.querySelectorAll('#barRF .chip').forEach(ch=> ch.addEventListener('click', function(){ this.classList.toggle('on'); run(); }));
$('#goRF').addEventListener('click',run);
// кнопка "наверх"
window.addEventListener('scroll', function(){ $('#up').classList.toggle('show', window.scrollY>500); });
$('#up').addEventListener('click', function(){ window.scrollTo({top:0,behavior:'smooth'}); });
// форма "оставить пожелание"
function fbToggle(v){ $('#fbModal').classList.toggle('show', v); }
$('#fbOpen').addEventListener('click', function(){ fbToggle(true); setTimeout(function(){$('#fbMsg').focus();},50); });
$('#fbClose').addEventListener('click', function(){ fbToggle(false); });
$('#fbModal').addEventListener('click', function(e){ if(e.target===this) fbToggle(false); });
document.addEventListener('keydown', function(e){ if(e.key==='Escape') fbToggle(false); });
$('#fbSend').addEventListener('click', async function(){
  const msg=$('#fbMsg').value.trim(), email=$('#fbEmail').value.trim();
  const st=$('#fbStatus'); st.className='fb-status';
  if(!msg){ st.className='fb-status err'; st.textContent='Напишите, пожалуйста, сообщение.'; return; }
  this.disabled=true; st.textContent='Отправляю…';
  const self=this;
  const ok=function(){ st.className='fb-status ok'; st.textContent='Спасибо! Сообщение отправлено.';
    $('#fbMsg').value=''; $('#fbEmail').value=''; self.disabled=false; setTimeout(function(){ fbToggle(false); },1600); };
  const fail=function(){ st.className='fb-status err'; st.textContent='Не удалось отправить, попробуйте позже.'; self.disabled=false; };
  // /ajax принимает JSON; CORS у FormSubmit открыт, браузер сам шлёт Referer
  fetch('https://formsubmit.co/ajax/'+atob(FB_TO), {
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({ _subject:'Поиск жилья — пожелание с сайта', email: email||'не указан', Сообщение: msg })
  })
    .then(function(r){ return r.json().catch(function(){ return {success:'true'}; }); })
    .then(function(j){ (String(j.success)==='true') ? ok() : fail(); })
    .catch(function(){ fail(); });
});
// ── своя статистика: ничего не уходит на сторонние сервисы ─────────────────
(function(){
  try{
    var vid = localStorage.getItem('pk_vid'), isNew = 0;
    if(!vid){ vid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('pk_vid', vid); isNew = 1; }
    var sid = Math.random().toString(36).slice(2);
    window.__T = function(e, d){
      try{
        var o = d || {}; o.e = e; o.v = vid; o.s = sid;
        var b = JSON.stringify(o);
        if(navigator.sendBeacon) navigator.sendBeacon('/api/t', new Blob([b], {type:'application/json'}));
        else fetch('/api/t', {method:'POST', body:b, keepalive:true});
      }catch(_){}
    };
    window.addEventListener('load', function(){
      // на такт позже: в момент самого события loadEventEnd ещё не проставлен
      setTimeout(function(){
        var n = (performance.getEntriesByType('navigation')||[])[0];
        var load = n ? Math.round(n.loadEventEnd || n.duration || 0) : 0;
        if(!load) load = Math.round(performance.now());
        // метка ссылки: /?from=tiktok-post1 — сразу видно, какой ролик привёл
      var q = new URLSearchParams(location.search);
      var mark = (q.get('from') || q.get('utm_source') || '').slice(0, 40);
      window.__T('view', { r: document.referrer||'', n: isNew, w: innerWidth,
                           ttfb: n ? Math.round(n.responseStart) : 0, load: load, from: mark });
      }, 0);
    });
    var maxS = 0, t0 = Date.now(), sent = false;
    addEventListener('scroll', function(){
      var d = (scrollY + innerHeight) / Math.max(1, document.body.scrollHeight);
      if(d > maxS) maxS = d;
    }, {passive:true});
    function bye(){
      if(sent) return; sent = true;
      window.__T('end', { sec: Math.round((Date.now()-t0)/1000), scroll: Math.min(100, Math.round(maxS*100)) });
    }
    addEventListener('pagehide', bye);
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden') bye(); });
    // переходы в объявление и звонки
    document.addEventListener('click', function(ev){
      var a = (ev.target && ev.target.closest) ? ev.target.closest('a') : null;
      if(!a) return;
      var href = a.getAttribute('href') || '';
      if(/^tel:/.test(href)) window.__T('call', {});
      else if(a.target === '_blank' && /^https?:/.test(href)){
        try{ window.__T('open', { host: new URL(a.href).hostname.replace(/^www\./,'') }); }catch(_){}
      }
    }, true);
  }catch(_){}
})();
// ── Короткое сообщение внизу экрана ───────────────────────────────────────
let toastT = null;
function toast(msg){
  const el=$('#toast'); if(!el) return;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(function(){ el.classList.remove('show'); }, 2200);
}

// ── Поделиться вариантом ──────────────────────────────────────────────────
// На телефоне открывается системное меню «Поделиться», на компьютере —
// ссылка просто копируется в буфер.
async function shareItem(idx){
  const x = (window.__view==='fav' ? FAVS : (window.__items||[]))[idx];
  if(!x) return;
  const head = x.price + ' ' + curOf(x) + '/' + (x.unit || (x.src==='H101'?'ночь':'сутки'))
             + (x.area ? (' · ' + x.area) : '');
  const body = head + (x.title ? ('\\n' + x.title) : '') + '\\nНашёл через ' + location.host;
  try{
    if(navigator.share){
      await navigator.share({ title: head, text: body, url: x.link });
    } else if(navigator.clipboard){
      await navigator.clipboard.writeText(body + '\\n' + x.link);
      toast('Ссылка скопирована');
    } else {
      window.open(x.link, '_blank', 'noopener');
    }
    if(window.__T) window.__T('share', {});
  }catch(e){}
}
document.addEventListener('click', function(ev){
  const b = ev.target && ev.target.closest ? ev.target.closest('[data-share]') : null;
  if(!b) return;
  ev.preventDefault(); ev.stopPropagation();
  shareItem(+b.getAttribute('data-share'));
});

// ── Фильтр «только с фото» ────────────────────────────────────────────────
// Полный набор держим в __all, а показываем __items: так номера карточек
// не сбиваются и слайдер с описанием продолжают попадать в нужный вариант.
function photoOnly(){
  const cb = window.__mode==='ru' ? $('#rfOnlyPhoto') : $('#onlyPhoto');
  return !!(cb && cb.checked);
}
function applyPhotoFilter(){
  const all = window.__all || [];
  window.__items = photoOnly() ? all.filter(function(x){ return x.photos && x.photos.length; }) : all.slice();
}
function onPhotoToggle(){
  applyPhotoFilter();
  window.__page = 1;
  syncUrl();
  const hidden = (window.__all||[]).length - (window.__items||[]).length;
  if(photoOnly() && hidden>0) toast('Скрыто без фото: ' + hidden);
  if(window.__view==='map'){ plotMap(true); enrichRealt(); } else renderCards();
}
$('#onlyPhoto').addEventListener('change', onPhotoToggle);
$('#rfOnlyPhoto').addEventListener('change', onPhotoToggle);

// ── Избранное ─────────────────────────────────────────────────────────────
// Храним прямо в браузере посетителя: сервер об этом ничего не знает.
let FAVS = [];
try{ FAVS = JSON.parse(localStorage.getItem('pk_favs')||'[]'); if(!Array.isArray(FAVS)) FAVS=[]; }catch(e){ FAVS=[]; }
function isFav(link){ return FAVS.some(function(f){ return f.link===link; }); }
function favSave(){
  try{ localStorage.setItem('pk_favs', JSON.stringify(FAVS)); }catch(e){}
  const n=$('#favN'); if(n) n.textContent = FAVS.length;
}
function favToggle(idx){
  const x=(window.__view==='fav' ? FAVS : (window.__items||[]))[idx];
  if(!x) return;
  const at=FAVS.findIndex(function(f){ return f.link===x.link; });
  if(at>=0) FAVS.splice(at,1); else FAVS.push(x);
  favSave();
  if(window.__view==='fav'){ window.__page=1; renderCards(); } else renderCards();
}
document.addEventListener('click', function(ev){
  const b = ev.target && ev.target.closest ? ev.target.closest('[data-fav]') : null;
  if(!b) return;
  ev.preventDefault(); ev.stopPropagation();
  favToggle(+b.getAttribute('data-fav'));
  if(window.__T) window.__T('fav', {});
});

// ── Фильтры на телефоне сворачиваются ─────────────────────────────────────
// На узком экране форма занимала почти два экрана, и человек видел поля
// вместо квартир. Теперь она свёрнута, а в кнопке — краткая сводка.
function filtersSummary(){
  if(window.__mode==='ru'){
    const c=$('#rfCity').selectedOptions[0];
    const a=$('#rfMin').value, b=$('#rfMax').value;
    const price = (a&&b) ? (' · '+a+'–'+b+' ₽') : a ? (' · от '+a+' ₽') : b ? (' · до '+b+' ₽') : '';
    return (c?c.textContent:'') + price;
  }
  const reg=$('#region').selectedOptions[0], typ=$('#type').selectedOptions[0];
  const parts=[ ($('#city').value || (reg?reg.textContent:'')), (typ?typ.textContent:'') ];
  if($('#rooms').value) parts.push($('#rooms').value+'-комн');
  const mn=$('#min').value, mx=$('#max').value;
  if(mn && mx)      parts.push(mn+'–'+mx+' р.');
  else if(mn)       parts.push('от '+mn+' р.');
  else if(mx)       parts.push('до '+mx+' р.');
  if($('#onlyPhoto').checked) parts.push('с фото');
  return parts.filter(Boolean).join(' · ');
}
function filtersCollapsed(v){
  const bar = window.__mode==='ru' ? $('#barRF') : $('#bar');
  bar.classList.toggle('hid', v);
  const t=$('#fToggle'); if(t) t.setAttribute('aria-expanded', String(!v));
  const sum=$('#fSum'); if(sum) sum.textContent = v ? filtersSummary() : '';
}
const isNarrow = function(){ return window.matchMedia('(max-width:639px)').matches; };
$('#fToggle').addEventListener('click', function(){
  const bar = window.__mode==='ru' ? $('#barRF') : $('#bar');
  filtersCollapsed(!bar.classList.contains('hid'));
});
if(isNarrow()) filtersCollapsed(true);

// ── Заглушка подписки ─────────────────────────────────────────────────────
$('#plBtn').addEventListener('click', function(){
  this.disabled = true;
  this.textContent = 'Записали';
  $('#plOk').innerHTML = 'Спасибо! Форма ещё в разработке — считаем, скольким она нужна. '
    + 'А пока напишите точку через <b>«Оставить пожелание или дополнение»</b> внизу страницы: '
    + 'это письмо дойдёт до нас сразу.';
  if(window.__T) window.__T('place_suggest', {});
});

$('#subBtn').addEventListener('click', function(){
  this.disabled = true;
  this.textContent = 'Записали';
  $('#subOk').textContent = 'Спасибо! Функция ещё в разработке — мы считаем, сколько людей её ждёт.';
  if(window.__T) window.__T('subscribe', {});
});

// ── Установка на телефон ──────────────────────────────────────────────────
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){ navigator.serviceWorker.register('/sw.js').catch(function(){}); });
}

window.__runToken = 0;

// ── Что посетить ──────────────────────────────────────────────────────────
// Точки берём из своего же справочника kudin.by. Здесь показываем выжимку,
// полное описание — по ссылке на первоисточник.
const PL_CITIES = [
  ['Минск', 53.9023, 27.5619], ['Брест', 52.0976, 23.7341], ['Гродно', 53.6884, 23.8258],
  ['Витебск', 55.1904, 30.2049], ['Гомель', 52.4345, 30.9754], ['Могилёв', 53.9007, 30.3313],
  ['Мир', 53.4514, 26.4720], ['Несвиж', 53.2226, 26.6739], ['Браслав', 55.6400, 27.0400],
];
window.__places = [];

// переход «от жилья к местам»: показываем, что посмотреть вокруг этой квартиры
// Ноль по фильтру — не тупик: чаще всего дело в одном поле. Если по типу
// пусто, а «любой» что-то находит, честно скажем об этом и предложим кнопку.
function пустоТекст(){
  const t = $('#type') ? $('#type').value : 'any';
  if(t === 'any') return '<div class="empty">Ничего не найдено. Смягчите фильтры.</div>';
  setTimeout(естьДругоеЖильё, 0);
  return '<div class="empty" id="empt">Ничего не найдено по выбранному типу жилья. '
       + 'Смягчите фильтры.</div>';
}

async function естьДругоеЖильё(){
  const блок = document.getElementById('empt'); if(!блок) return;
  const t = $('#type').value; if(t === 'any') return;
  try{
    // тот же запрос, но без ограничения по типу
    const p = new URLSearchParams();
    const nm = $('#qname').value.trim();
    if(nm) p.set('name', nm); else {
      p.set('region', $('#region').value);
      if($('#city').value) p.set('city', $('#city').value.trim());
    }
    p.set('type', 'any');
    ['rooms','guests','min','max','source'].forEach(function(k){
      const v = $('#'+k).value; if(v && v !== URL_DEFAULTS[k]) p.set(k, v);
    });
    const d = await (await fetch('/api/search?' + p.toString())).json();
    const n = d.total || 0;
    if(!n || !document.getElementById('empt')) return;
    const вид = $('#type').options[$('#type').selectedIndex].textContent.toLowerCase();
    блок.innerHTML = 'По типу «' + вид + '» здесь ничего не сдаётся. '
      + 'Другого жилья рядом — <b>' + n + '</b>.'
      + '<button class="empty-go" type="button" onclick="показатьЛюбой()">Показать любой тип →</button>';
  }catch(e){}
}

function показатьЛюбой(){
  $('#type').value = 'any';
  if(typeof run === 'function') run(); else document.getElementById('go').click();
}

function placesNear(idx){
  const x = (window.__view==='fav' ? FAVS : (window.__items||[]))[idx];
  if(!x || !x.lat || !x.lng) return;
  window.__plCenter = { lat:x.lat, lng:x.lng, label:(x.area || 'этого жилья') };
  $('#plRadius').value = '25';
  setCountry('places');
  if(window.__T) window.__T('places_near', {});
}

function plCityCoords(){
  if(window.__plCenter) return window.__plCenter;
  const v = $('#plCity').value;
  const c = PL_CITIES.find(function(x){ return x[0] === v; });
  return c ? { lat: c[1], lng: c[2] } : null;
}

// Условия отбора мест — одни и те же для списка и для карты.
function plParams(){
  const c = plCityCoords(), r = $('#plRadius').value, g = $('#plGroup').value;
  const q = $('#plQ').value.trim();
  const p = new URLSearchParams();
  if(g) p.set('group', g);
  if(q) p.set('q', q);
  if(c && +r && !q){ p.set('lat', c.lat); p.set('lng', c.lng); p.set('r', r); }
  return p;
}

async function runPlaces(){
  // Поиск жилья мог быть ещё в полёте: его ответ дорисовал бы свои карточки
  // поверх мест. Сдвигаем метку — старый запрос увидит её и сам замолчит.
  ++window.__runToken;
  const c = plCityCoords(), r = $('#plRadius').value, g = $('#plGroup').value;
  const q = $('#plQ').value.trim();
  // при поиске по названию ищем по всей стране, поэтому город и радиус гасим
  $('#plCity').disabled = $('#plRadius').disabled = !!q;
  $('#plCity').closest('.fld').classList.toggle('off', !!q);
  $('#plRadius').closest('.fld').classList.toggle('off', !!q);
  const around = window.__plCenter ? ('рядом с ' + window.__plCenter.label) : ('рядом с городом ' + $('#plCity').value);
  const p = plParams();
  $('#stat').textContent = 'Ищу места…';
  $('#grid').innerHTML = ''; $('#pager').innerHTML = '';
  try{
    const d = await (await fetch('/api/places?' + p.toString())).json();
    window.__places = d.items || [];
    // список категорий подставляем один раз
    const sel = $('#plGroup');
    if(sel.options.length <= 1 && d.groups){
      Object.entries(d.groups).sort(function(a,b){ return b[1]-a[1]; }).forEach(function(kv){
        const o = document.createElement('option'); o.value = kv[0];
        o.textContent = kv[0] + ' (' + kv[1] + ')'; sel.appendChild(o);
      });
      if(g) sel.value = g;
    }
    const where = q ? (' по запросу «' + q + '»') : ((c && +r) ? (' ' + around + ', до ' + r + ' км') : ' по всей Беларуси');
    $('#stat').textContent = 'Найдено мест: ' + d.total + where;
    renderPlaces();
    drawRoute();
    if(window.__view === 'map') plotPlaces();
    syncUrl();
    if(window.__T) window.__T('places', { city: $('#plCity').value, total: d.total });
  }catch(e){ $('#stat').textContent = 'Ошибка: ' + e.message; }
}

function renderPlaces(){
  // Тот же рубеж в обратную сторону: запоздалый ответ по местам не должен
  // рисовать точки в ленте жилья.
  if(window.__mode !== 'places') return;
  const list = window.__places || [];
  if(!list.length){ $('#grid').innerHTML = '<div class="empty">Здесь ничего не нашлось. Попробуйте больший радиус.</div>'; return; }
  $('#grid').className = 'pl-grid';
  $('#grid').innerHTML = list.slice(0, 60).map(function(p, i){
    const km = (p.km !== undefined) ? ('<div class="km">' + p.km + ' км</div>') : '';
    // Яндекс.Карты строят маршрут от текущего положения; на телефоне откроется приложение
    const route = 'https://yandex.by/maps/?rtext=~' + p.lat + ',' + p.lng + '&rtt=auto';
    return '<article class="plc" id="pl' + i + '">'
      + '<div class="ph">' + km + (p.pic
          ? ('<img src="' + p.pic + '" loading="lazy" alt="' + esc2(p.name) + '">')
          : '<div class="nopic">фотографии пока нет</div>') + '</div>'
      + '<div class="bd"><div class="ct">' + esc2(p.cat || p.group) + '</div>'
      + '<h3>' + esc2(p.name) + '</h3>'
      + '<div class="ad">' + esc2(p.addr) + '</div>'
      + '<div class="tx" id="tx' + i + '"></div>'
      + (p.author ? ('<div class="cred">фото: ' + esc2(p.author) + (p.lic ? (', ' + esc2(p.lic)) : '')
          + (p.src ? (' · <a href="' + esc2(p.src) + '" target="_blank" rel="noopener">Викисклад</a>') : '') + '</div>') : '')
      + '<div class="row">'
      +   '<a class="go2" href="' + route + '" target="_blank" rel="noopener">Проложить маршрут</a>'
      +   '<button class="stay2" type="button" onclick="stayNear(' + i + ')">Жильё рядом</button>'
      +   '<button class="toroute' + (inRoute(p.id) ? ' on' : '') + '" type="button" onclick="toggleRoute('
      +     i + ')">' + (inRoute(p.id) ? '✓ в маршруте' : '+ в маршрут') + '</button>'
      +   '<a href="/mesto/' + p.id + '-' + esc2(slugRu(p.name)) + '">Подробнее</a>'
      + '</div><div id="near' + i + '"></div></div></article>';
  }).join('');
  // Описания тянем по одному запросу на точку, поэтому не грузим всё сразу:
  // подтягиваем, когда карточка появляется на экране.
  if(window.__plObs) window.__plObs.disconnect();
  if('IntersectionObserver' in window){
    window.__plObs = new IntersectionObserver(function(rows){
      rows.forEach(function(r){
        if(!r.isIntersecting) return;
        const i = +r.target.id.replace('pl','');
        const p = (window.__places||[])[i];
        if(p) loadPlaceText(p.id, i);
        window.__plObs.unobserve(r.target);
      });
    }, { rootMargin: '300px' });
    document.querySelectorAll('.plc').forEach(function(el){ window.__plObs.observe(el); });
  } else {
    list.slice(0, 12).forEach(function(p, i){ loadPlaceText(p.id, i); });
  }
}
// то же превращение названия в кусок адреса, что и на сервере
const ЛАТ2 = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i',
  'й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu',
  'я':'ya','і':'i','ў':'u'};
function slugRu(name){
  return String(name || '').toLowerCase().split('')
    .map(function(c){ return ЛАТ2[c] !== undefined ? ЛАТ2[c] : (/[a-z0-9]/.test(c) ? c : '-'); })
    .join('').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function esc2(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

const PL_TEXT = {};
async function loadPlaceText(id, i){
  const box = document.getElementById('tx' + i); if(!box) return;
  try{
    if(!PL_TEXT[id]) PL_TEXT[id] = await (await fetch('/api/place?id=' + id)).json();
    const d = PL_TEXT[id];
    box.textContent = d.text || '';
  }catch(e){}
}

async function stayNear(i){
  const p = (window.__places || [])[i]; if(!p) return;
  const box = document.getElementById('near' + i); if(!box) return;
  if(box.dataset.open === '1'){ box.innerHTML = ''; box.dataset.open = '0'; return; }
  box.dataset.open = '1';
  box.innerHTML = '<div class="near">Ищу жильё рядом…</div>';
  try{
    const d = await (await fetch('/api/places/stay?lat=' + p.lat + '&lng=' + p.lng + '&r=30')).json();
    // Пусто в тридцати километрах — самое время предложить область целиком:
    // человеку всё равно нужно где-то ночевать.
    if(!d.total){
      box.innerHTML = '<div class="near">В 30 км отсюда сдаваемого жилья сейчас нет.'
        + (d.region ? ('<button class="allstay" type="button" data-r="' + d.region
             + '" onclick="allStay(this)">Посмотреть жильё в этой области →</button>') : '')
        + '</div>';
      return;
    }
    const N = nights();
    const cards = (d.items || []).slice(0, 6).map(function(x){
      const img = (x.photos && x.photos[0]) ? '<img src="' + x.photos[0] + '" loading="lazy" alt="">' : '';
      return '<a href="' + x.link + '" target="_blank" rel="noopener">' + img
        + '<div class="p">' + x.price + ' BYN' + (N ? ('<small> · ' + (x.price*N) + ' за ' + N + ' ноч.</small>') : '') + '</div><div class="s">'
        // У Realt точной точки нет — метка стоит у центра города. Показывать
        // «около 0 км» было бы враньём, поэтому пишем сам город.
        + (x.approx ? esc2(x.area || 'рядом') : (x.km + ' км'))
        + ' · ' + srcName(x.src) + '</div></a>';
    }).join('');
    const all = d.region
      ? ('<button class="allstay" type="button" data-r="' + d.region + '" onclick="allStay(this)">'
         + 'Показать все варианты в области →</button>')
      : '';
    box.innerHTML = '<div class="near"><b>Жильё рядом — ' + d.total + ' '
      + (function(n){var a=Math.abs(n)%100,b=a%10;
          return (a>10&&a<20)?'вариантов':(b>1&&b<5)?'варианта':(b===1)?'вариант':'вариантов';})(d.total)
      + '</b><div class="near-list">'
      + cards + '</div>' + all + '</div>';
    if(window.__T) window.__T('stay_near', {});
  }catch(e){ box.innerHTML = ''; }
}

async function plotPlaces(){
  if(typeof L === 'undefined') return;
  if(!window.__map){ plotMap(false); }
  // В списке лежат первые триста точек, а на карте должны быть все.
  const p2 = plParams(); p2.set('light', '1');
  const key = p2.toString();
  let all = window.__places || [];
  if(window.__plMapKey === key && window.__plMap){ all = window.__plMap; }
  else {
    try{
      const d = await (await fetch('/api/places?' + key)).json();
      all = d.items || all;
      window.__plMap = all; window.__plMapKey = key;
    }catch(e){}
  }
  window.__mlayer.clearLayers();
  const pts = [];
  all.forEach(function(p, i){
    // шесть знаков после запятой — точность около десяти сантиметров,
    // больше навигаторам не нужно
    const coords = p.lat.toFixed(6) + ', ' + p.lng.toFixed(6);
    const icon = L.divIcon({ className:'', iconSize:[30,30], iconAnchor:[15,15], html:'<div class="pl-pin">🏰</div>' });
    const mk = L.marker([p.lat, p.lng], { icon: icon });
    mk.bindTooltip(p.name, { direction:'top', offset:[0,-14] });
    mk.bindPopup('<div class="mp mp-pl">'
      + '<div class="mp-pic-box" id="mpic' + i + '">'
      + (p.pic ? ('<img class="mp-pic" src="' + esc2(p.pic) + '" alt="">') : '') + '</div>'
      + '<div class="mp-meta">' + esc2(p.cat) + '</div>'
      + '<div class="mp-price" style="font-size:16px">' + esc2(p.name) + '</div>'
      + '<div class="mp-meta">' + esc2(p.addr) + '</div>'
      + '<div class="mp-tx" id="mtx' + i + '">Загружаю описание…</div>'
      + '<button class="mp-coord" type="button" data-c="' + coords + '" onclick="copyCoords(this)">'
      + '📍 ' + coords + '<span>копировать</span></button>'
      + '<a class="mp-open" href="https://yandex.by/maps/?rtext=~' + p.lat + ',' + p.lng + '&rtt=auto" target="_blank" rel="noopener">Проложить маршрут →</a>'
      // Своя страница места, а не чужой сайт: уводить человека с карты
      // на другой проект незачем, у нас есть и описание, и жильё рядом.
      + ' <a class="mp-open" href="/mesto/' + p.id + '-' + esc2(slugRu(p.name)) + '">Подробнее →</a>'
      // Название пишем в атрибут, а не в onclick: в названиях встречаются
      // кавычки, и строка внутри строки ломала бы разметку.
      + '<button class="mp-route' + (inRoute(p.id) ? ' on' : '') + '" type="button"'
      +   ' data-id="' + p.id + '" data-lat="' + p.lat + '" data-lng="' + p.lng + '"'
      +   ' data-name="' + esc2(p.name) + '" onclick="pinRoute(this)">'
      +   (inRoute(p.id) ? '✓ в маршруте' : '+ в маршрут') + '</button></div>',
      { maxWidth:300, minWidth:240 });
    // Описание тянем только когда окошко открыли: на карте бывает под тысячу
    // точек, грузить их описания заранее — тысяча лишних запросов.
    mk.on('popupopen', function(){ loadMapText(p.id, i); syncPins(); });
    window.__mlayer.addLayer(mk);
    pts.push([p.lat, p.lng]);
  });
  setTimeout(function(){
    window.__map.invalidateSize();
    if(pts.length) window.__map.fitBounds(pts, { padding:[45,45], maxZoom:13 });
  }, 60);
}

// Переносим человека из места в поиск жилья по той же области. Не ссылкой
// с перезагрузкой: страница уже загружена, достаточно переключить вкладку.
function allStay(btn){
  const reg = btn.getAttribute('data-r') || '';
  if($('#region').querySelector('option[value="' + reg + '"]')) $('#region').value = reg;
  fillCities();
  $('#city').value = '';
  $('#type').value = 'flat';
  // Кнопка обещает ВСЕ варианты, а блок «жильё рядом» и показывает всё подряд,
  // не глядя на фильтры. Если оставить прежние — «1 комната», «только
  // Flatbook» — человек попадёт на узкий список и решит, что вариантов мало.
  // Даты заезда и выезда не трогаем: это его поездка, а не фильтр.
  ['rooms','guests','min','max','qname'].forEach(function(id){ const el=$('#'+id); if(el) el.value=''; });
  $('#source').value = 'both';
  const ph = $('#onlyPhoto'); if(ph) ph.checked = false;
  document.querySelectorAll('#bar .rb-amen-cb').forEach(function(cb){ cb.checked = false; });
  syncPresets();
  setCountry('by');
  syncUrl();
  if(window.__T) window.__T('all_stay', { region: reg });
  const g = $('#stat') || $('#grid');
  if(g) g.scrollIntoView({ behavior:'smooth', block:'start' });
}

// ── Маршрут на день ───────────────────────────────────────────────────────
// Набор точек, порядок объезда и одна ссылка в Яндекс.Карты. Порядок считаем
// жадно: от первой добавленной каждый раз идём к ближайшей из оставшихся.
// Для трёх-пяти точек это даёт тот же ответ, что и перебор, а считается сразу.
window.__route = [];
try{ window.__route = JSON.parse(localStorage.getItem('route') || '[]'); }catch(e){}

// Расстояние по прямой, километры. На сервере такая функция есть, но она
// там и остаётся: страница живёт в браузере и до неё не дотянется.
function кмМежду(a1, o1, a2, o2){
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x/2)*Math.sin(x/2)
          + Math.cos(a1*t) * Math.cos(a2*t) * Math.sin(y/2) * Math.sin(y/2);
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function inRoute(id){ return (window.__route || []).some(function(p){ return p.id === id; }); }

function toggleRoute(i){
  const p = (window.__places || [])[i]; if(!p) return;
  routeToggle(p);
}

// Точку добавляют и из ленты, и из окошка на карте. Номера там разные
// (в ленте триста точек, на карте все), поэтому работаем по самой точке.
function routeToggle(p){
  const было = inRoute(p.id);
  if(было) window.__route = window.__route.filter(function(x){ return x.id !== p.id; });
  else window.__route = window.__route.concat([{ id:p.id, name:p.name, lat:p.lat, lng:p.lng }]);
  try{ localStorage.setItem('route', JSON.stringify(window.__route)); }catch(e){}
  if(window.__T && !было) window.__T('route_add', {});
  // Перерисовываем одну кнопку, а не всю ленту: заново рисовать шесть десятков
  // карточек ради галочки — это перезагрузка всех снимков и рывок страницы.
  (window.__places || []).forEach(function(x, i){ if(x.id === p.id) markRoute(i, !было); });
  syncPins();
  drawRoute();
}

function pinRoute(b){
  routeToggle({ id: +b.dataset.id, name: b.dataset.name,
                lat: +b.dataset.lat, lng: +b.dataset.lng });
}

// кнопки в открытых окошках на карте
function syncPins(){
  document.querySelectorAll('.mp-route').forEach(function(b){
    const on = inRoute(+b.dataset.id);
    b.classList.toggle('on', on);
    b.textContent = on ? '✓ в маршруте' : '+ в маршрут';
  });
}

// вид кнопки «в маршрут» у одной карточки
function markRoute(i, on){
  const card = document.getElementById('pl' + i); if(!card) return;
  const b = card.querySelector('.toroute'); if(!b) return;
  b.classList.toggle('on', !!on);
  b.textContent = on ? '✓ в маршруте' : '+ в маршрут';
}

function clearRoute(){
  const были = (window.__route || []).map(function(p){ return p.id; });
  window.__route = [];
  try{ localStorage.removeItem('route'); }catch(e){}
  (window.__places || []).forEach(function(p, i){ if(были.indexOf(p.id) >= 0) markRoute(i, false); });
  syncPins();
  drawRoute();
}

// порядок объезда: от первой точки каждый раз к ближайшей из оставшихся
function orderRoute(list){
  if(list.length < 3) return list.slice();
  const left = list.slice(1), out = [list[0]];
  while(left.length){
    const cur = out[out.length - 1];
    let bi = 0, bd = Infinity;
    left.forEach(function(p, i){
      const d = кмМежду(cur.lat, cur.lng, p.lat, p.lng);
      if(d < bd){ bd = d; bi = i; }
    });
    out.push(left.splice(bi, 1)[0]);
  }
  return out;
}

function drawRoute(){
  const box = $('#routeBox'); if(!box) return;
  const list = orderRoute(window.__route || []);
  window.__route = list;
  const bar = $('#routeBar');
  if(!list.length || window.__mode !== 'places'){
    box.style.display = 'none';
    if(bar) bar.style.display = 'none';
    return;
  }
  box.style.display = '';
  let сумма = 0;
  const строки = list.map(function(p, i){
    const шаг = i ? кмМежду(list[i-1].lat, list[i-1].lng, p.lat, p.lng) : 0;
    сумма += шаг;
    return '<div class="rt-item"><span class="n">' + (i+1) + '</span>'
      + '<span>' + esc2(p.name) + '</span>'
      + '<span class="km">' + (i ? ('+' + Math.round(шаг) + ' км') : 'старт') + '</span>'
      + '<button class="x" type="button" title="убрать" onclick="dropRoute(' + p.id + ')">×</button></div>';
  }).join('');
  $('#rtList').innerHTML = строки;
  $('#rtSum').textContent = list.length + ' точ. · около ' + Math.round(сумма) + ' км между ними';
  // Ведём на свою страницу: там маршрут видно на карте и можно доложить
  // точку, не возвращаясь в список. В Яндекс уходим уже оттуда.
  const адрес = '/marshrut?p=' + list.map(function(p){ return p.id; }).join(',');
  $('#routeGo').href = адрес;
  if(bar){
    bar.href = адрес;
    bar.textContent = 'Маршрут: ' + list.length + ' точ. · показать на карте →';
    bar.style.display = '';
  }
}

function dropRoute(id){
  window.__route = (window.__route || []).filter(function(p){ return p.id !== id; });
  try{ localStorage.setItem('route', JSON.stringify(window.__route)); }catch(e){}
  // если эта точка сейчас видна в ленте — снимаем отметку с её кнопки
  (window.__places || []).forEach(function(p, i){ if(p.id === id) markRoute(i, false); });
  syncPins();
  drawRoute();
}

// Копируем координаты в буфер. Если браузер не разрешил (так бывает на
// старых телефонах) — выделяем текст, чтобы человек скопировал сам.
function copyCoords(btn){
  const text = btn.getAttribute('data-c') || '';
  const done = function(){
    const was = btn.innerHTML;
    btn.innerHTML = '✓ скопировано';
    setTimeout(function(){ btn.innerHTML = was; }, 1600);
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done, function(){ selectText(btn); });
  } else { selectText(btn); }
}
function selectText(el){
  try{
    const r = document.createRange(); r.selectNodeContents(el);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }catch(e){}
}

// Описание для окошка на карте. Ответы держим в том же хранилище, что и
// карточки списка, поэтому повторное открытие точки ничего не запрашивает.
async function loadMapText(id, i){
  const box = document.getElementById('mtx' + i);
  if(!box) return;
  try{
    // В PL_TEXT лежит весь ответ сервера — тот же, что и для карточек списка,
    // поэтому повторное открытие точки ничего не запрашивает заново.
    if(!PL_TEXT[id]) PL_TEXT[id] = await (await fetch('/api/place?id=' + id)).json();
    const d = PL_TEXT[id] || {};
    const b2 = document.getElementById('mtx' + i);
    if(b2) b2.textContent = d.text || d.years || '';
    // Снимок в облегчённом списке для карты не передаётся — берём из подробностей.
    const holder = document.getElementById('mpic' + i);
    const pic = (d.pics || [])[0];
    if(pic && holder && !holder.firstChild){
      holder.innerHTML = '<img class="mp-pic" src="' + esc2(pic) + '" alt="">';
    }
  }catch(e){
    const b2 = document.getElementById('mtx' + i);
    if(b2) b2.textContent = '';
  }
}

// ── Быстрые наборы фильтров ───────────────────────────────────────────────
// Человек с ролика не будет разбираться с восемью полями. Один тап — готовый
// набор. Повторный тап снимает набор и возвращает как было.
function nextWeekend(){
  const d = new Date(), day = d.getDay();                // 0 — воскресенье, 6 — суббота
  // Если выходные уже идут — берём сегодня и завтра, а не следующую неделю.
  const shift = (day === 6 || day === 0) ? 0 : (6 - day);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate() + shift);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1);
  // Дату собираем из местных частей: toISOString переводит в Гринвич, и ночью
  // (с 00:00 до 03:00 по Минску) подставлял бы вчерашний день.
  const fmt = x => x.getFullYear() + '-' +
    String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
  return [fmt(a), fmt(b)];
}
const HINT_PL = 'Раздел «Что посетить» — почти 800 достопримечательностей Беларуси: замки, костёлы, '
  + 'усадьбы, форты, музеи и памятники. У каждой точки фотография, короткое описание и координаты.'
  + '<br><br><b>Одна точка.</b> «Проложить маршрут» ведёт прямо в Яндекс.Карты — на телефоне '
  + 'откроется приложение и поведёт от вашего места. «Жильё рядом» показывает квартиры, коттеджи '
  + 'и усадьбы на сутки в 30 км отсюда — из Kufar, Realt и Flatbook сразу.'
  + '<br><br><b>Несколько точек — маршрут на день.</b> Отмечайте кнопкой «+ в маршрут» сколько '
  + 'угодно мест: внизу появится полоска, а по ней — страница с картой. Порядок объезда '
  + 'считается сам, от первой точки к ближайшей. Линия идёт по настоящим дорогам, поэтому '
  + 'километраж и время за рулём честные, а не «по прямой». Там же можно доложить место поиском, '
  + 'убрать лишнее и уже потом открыть весь маршрут в Яндекс.Картах.'
  + '<br><br>Страницу маршрута удобно держать в соседней вкладке: добавили точку здесь — она сразу '
  + 'появилась там. Адрес страницы меняется вместе с маршрутом, так что ссылкой можно поделиться.'
  + '<br><br>Описания и фотографии — из нашего же справочника архитектурного наследия Беларуси; '
  + 'кнопка «Подробнее» открывает полную страницу памятника здесь же.';

const PRESETS = {
  cheap:   function(on){ $('#max').value = on ? '60' : ''; },
  company: function(on){ $('#guests').value = on ? '6' : ''; },
  usadba:  function(on){ $('#type').value = on ? 'usadba' : 'flat'; },
  one:     function(on){ $('#rooms').value = on ? '1' : ''; },
  photo:   function(on){ $('#onlyPhoto').checked = on; },
  weekend: function(on){
    if(on){ const w = nextWeekend(); $('#from').value = w[0]; $('#to').value = w[1]; }
    else  { $('#from').value = ''; $('#to').value = ''; }
  },
};
document.querySelectorAll('#presets .preset').forEach(function(b){
  b.addEventListener('click', function(){
    const key = b.getAttribute('data-preset');
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on);
    PRESETS[key](on);
    if(key === 'photo'){ onPhotoToggle(); return; }
    run();
  });
});
// подсветить наборы, которые уже включены (например, при заходе по ссылке)
function syncPresets(){
  const state = {
    cheap:   $('#max').value === '60',
    company: $('#guests').value === '6',
    usadba:  $('#type').value === 'usadba',
    one:     $('#rooms').value === '1',
    photo:   $('#onlyPhoto').checked,
    weekend: !!($('#from').value && $('#to').value),
  };
  document.querySelectorAll('#presets .preset').forEach(function(b){
    b.classList.toggle('on', !!state[b.getAttribute('data-preset')]);
  });
}
favSave();

// ── Фильтры в адресной строке ─────────────────────────────────────────────
// Поиск можно скинуть ссылкой: /?region=brest&type=flat&max=50
// В адрес пишем только то, что отличается от значений по умолчанию.
const URL_DEFAULTS = { region:'minsk', city:'', type:'flat', rooms:'', guests:'', min:'', max:'', source:'both', sort:'price_asc' };
function syncUrl(){
  try{
    const p=new URLSearchParams();
    if(window.__mode==='places'){
      p.set('country','places');
      if($('#plCity').value)   p.set('city',   $('#plCity').value);
      if($('#plRadius').value!=='50') p.set('r', $('#plRadius').value);
      if($('#plGroup').value)  p.set('group',  $('#plGroup').value);
      if($('#plQ').value.trim()) p.set('q', $('#plQ').value.trim());
      if($('#from').value) p.set('from', $('#from').value);
      if($('#to').value)   p.set('to',   $('#to').value);
      // Страница места одна на всех и отдаётся из кэша, поэтому адрес
      // возврата она берёт отсюда: иначе «назад» уводит в город
      // по умолчанию и человек настраивает список заново.
    } else if(window.__mode==='ru'){
      p.set('country','ru');
      p.set('city', $('#rfCity').value);
      if($('#rfType').value)   p.set('type',   $('#rfType').value);
      if($('#rfStars').value)  p.set('stars',  $('#rfStars').value);
      if($('#rfRating').value) p.set('rating', $('#rfRating').value);
      if($('#rfMax').value)    p.set('max',    $('#rfMax').value);
      if($('#rfMin').value)    p.set('min',    $('#rfMin').value);
      if($('#rfSort').value!=='price_asc') p.set('sort', $('#rfSort').value);
      if($('#rfNoCard').classList.contains('on')) p.set('nocard','1');
      if($('#rfBathroom').checked) p.set('bath','1');
      const svc=[...document.querySelectorAll('#barRF .amen-cb:checked')].map(cb=>cb.value).join(',');
      if(svc) p.set('services', svc);
      if($('#rfOnlyPhoto').checked) p.set('photo','1');
    } else {
      ['region','city','type','rooms','guests','min','max','source','sort'].forEach(function(k){
        const v=$('#'+k).value;
        if(v && v!==URL_DEFAULTS[k]) p.set(k, v);
      });
      const nm=$('#qname').value.trim(); if(nm) p.set('name', nm);
      const am=[...document.querySelectorAll('#bar .rb-amen-cb:checked')].map(cb=>cb.value).join(',');
      if(am) p.set('amen', am);
      if($('#from').value) p.set('from', $('#from').value);
      if($('#to').value)   p.set('to',   $('#to').value);
      if($('#onlyPhoto').checked) p.set('photo','1');
    }
    const q=p.toString();
    history.replaceState(null, '', q ? ('/?'+q) : '/');
    // Куда возвращаться со страницы места или маршрута — и что подставить
    // в поиск жилья, если человек ушёл со страницы и вернулся.
    try{
      localStorage.setItem('backTo', q ? ('/?'+q) : '/');
      if(window.__mode !== 'places' && window.__mode !== 'ru')
        localStorage.setItem('byFilters', q);
    }catch(e){}
  }catch(e){}
}
// разобрать адрес при открытии и подставить в форму (поиск запустится сам)
function applyUrl(){
  try{
    const q=new URLSearchParams(location.search);
    if(![...q.keys()].length) return;
    const set=function(id,v){ const el=$('#'+id); if(el && v!==null && v!==undefined) el.value=v; };
    if(q.get('country')==='places'){
      if(q.get('city'))  $('#plCity').value  = q.get('city');
      if(q.get('r'))     $('#plRadius').value = q.get('r');
      if(q.get('q'))     $('#plQ').value = q.get('q');
      if(q.get('from')){ $('#from').value = q.get('from'); $('#plFrom').value = q.get('from'); }
      if(q.get('to')){   $('#to').value   = q.get('to');   $('#plTo').value   = q.get('to'); }
      window.__plGroup = q.get('group') || '';
      setCountry('places', true);
      return;
    }
    if(q.get('country')==='ru'){
      set('rfCity',   q.get('city'));
      set('rfType',   q.get('type'));
      set('rfStars',  q.get('stars'));
      set('rfRating', q.get('rating'));
      set('rfMax',    q.get('max'));
      set('rfMin',    q.get('min'));
      set('rfSort',   q.get('sort') || 'price_asc');
      if(q.get('nocard')==='1') $('#rfNoCard').classList.add('on');
      if(q.get('bath')==='1')   $('#rfBathroom').checked = true;
      if(q.get('photo')==='1')  $('#rfOnlyPhoto').checked = true;
      const svc=(q.get('services')||'').split(',').filter(Boolean);
      document.querySelectorAll('#barRF .amen-cb').forEach(function(cb){ cb.checked = svc.indexOf(cb.value)>=0; });
      setCountry('ru', true);
      return;
    }
    ['region','type','rooms','guests','min','max','source','sort'].forEach(function(k){ if(q.get(k)!==null) set(k, q.get(k)); });
    fillCities();                                  // список городов зависит от области
    if(q.get('city')) set('city', q.get('city'));
    if(q.get('name')) set('qname', q.get('name'));
    if(q.get('from')) set('from', q.get('from'));
    if(q.get('to'))   set('to',   q.get('to'));
    if(q.get('photo')==='1') $('#onlyPhoto').checked = true;
    const am=(q.get('amen')||'').split(',').filter(Boolean);
    document.querySelectorAll('#bar .rb-amen-cb').forEach(function(cb){ cb.checked = am.indexOf(cb.value)>=0; });
  }catch(e){}
}
// Список городов и обработчики вкладки «Что посетить».
// Ставим здесь, а не рядом с setCountry: там PL_CITIES ещё не объявлен,
// и обращение к нему на этапе загрузки роняло весь скрипт страницы.
(function(){
  const sel = $('#plCity');
  PL_CITIES.forEach(function(c){
    const o = document.createElement('option'); o.value = c[0]; o.textContent = c[0]; sel.appendChild(o);
  });
  $('#plCity').addEventListener('change', function(){ window.__plCenter = null; runPlaces(); });
  $('#plRadius').addEventListener('change', runPlaces);
  // Даты поездки одни на весь сайт: поля в разделе мест пишут в те же
  // «заезд» и «выезд», по которым считается стоимость за весь срок.
  ['plFrom','plTo'].forEach(function(id){
    const el = $('#' + id); if(!el) return;
    el.addEventListener('change', function(){
      $('#from').value = $('#plFrom').value;
      $('#to').value   = $('#plTo').value;
      syncUrl();
      // пересобираем уже раскрытые блоки «жильё рядом», чтобы в них
      // появилась стоимость за весь срок
      document.querySelectorAll('.plc [id^=near]').forEach(function(b){
        if(b.dataset.open === '1'){ const i = +b.id.replace('near',''); b.dataset.open='0'; stayNear(i); }
      });
    });
  });
  $('#rtClear').addEventListener('click', clearRoute);

  let plTimer = null;
  $('#plQ').addEventListener('input', function(){
    clearTimeout(plTimer); plTimer = setTimeout(runPlaces, 400);   // ждём, пока допечатают
  });
  $('#plGroup').addEventListener('change', runPlaces);
})();

// Вернулись со своей же страницы (места или маршрута) — возвращаем и
// настройки поиска жилья: иначе они молча сбрасывались на значения
// по умолчанию, и человек искал заново.
(function(){
  try{
    const r = document.referrer;
    if(!r || r.indexOf(location.origin) !== 0) return;
    const откуда = r.slice(location.origin.length);
    if(!/^\\/(mesto|marshrut)\\b/.test(откуда)) return;
    const свои = new URLSearchParams(location.search);
    // Если в адресе уже стоят настройки жилья, они главнее. При этом
    // «city» на вкладке мест — это город мест, а не жилья, поэтому
    // на вкладках «Что посетить» и «Россия» смотреть на адрес не нужно.
    const чужаяВкладка = свои.get('country') === 'places' || свои.get('country') === 'ru';
    if(!чужаяВкладка && ['region','city','type','name','rooms','guests','min','max','source','sort']
        .some(function(k){ return свои.get(k) !== null; })) return;
    const сохр = localStorage.getItem('byFilters');
    if(!сохр) return;
    const q = new URLSearchParams(сохр);
    ['region','city','type','rooms','guests','min','max','source','sort'].forEach(function(k){
      const v = q.get(k), el = $('#'+k); if(v !== null && el) el.value = v;
    });
    if(q.get('name')) $('#qname').value = q.get('name');
    if(q.get('from')) $('#from').value = q.get('from');
    if(q.get('to'))   $('#to').value   = q.get('to');
    if(q.get('photo') === '1') $('#onlyPhoto').checked = true;
    (q.get('amen')||'').split(',').filter(Boolean).forEach(function(v){
      const cb = document.querySelector('#bar .rb-amen-cb[value="'+v+'"]'); if(cb) cb.checked = true;
    });
    window.__вернулся = true;
  }catch(e){}
})();

applyUrl();
syncPresets();

// Готовый список, вложенный сервером: рисуем его сразу, чтобы первый экран
// не был пустым. Он показывается только для вида по умолчанию; как только
// человек трогает фильтр, обычный запрос всё заменит живыми данными.
(function(){
  try{
    if(!window.__PRELOAD || location.search) return;
    window.__all = window.__PRELOAD.items || [];
    window.__items = window.__all.slice();
    window.__page = 1;
    const p = window.__PRELOAD;
    const parts = [];
    if(p.kufar) parts.push('Kufar '+p.kufar);
    if(p.realt) parts.push('Realt '+p.realt);
    if(p.flatbook) parts.push('Flatbook '+p.flatbook);
    $('#stat').textContent = 'Найдено '+p.total+(parts.length?(' ('+parts.join(' + ')+')'):'');
    renderCards();
    window.__preloadShown = true;
  }catch(e){}
})();
window.__firstRun = 1;
window.addEventListener('load',run);
</script></body></html>`;

// Сбой в обработке одного запроса не должен ронять весь сервис
process.on('uncaughtException',  e => console.log('Непойманная ошибка:', e && e.message));
process.on('unhandledRejection', e => console.log('Необработанный отказ:', e && e.message));

http.createServer(async (req,res)=>{
  отметитьЗапрос();
  const u = new URL(req.url, 'http://localhost');
  if(u.pathname === '/api/search'){
    const data = await runSearchQuery(u.searchParams);
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(data)); return;
  }
  if(u.pathname === '/api/geo' && req.method === 'POST'){
    let body='';
    req.on('data', c=>{ body+=c; if(body.length>200000) req.destroy(); });
    req.on('end', async ()=>{
      let urls=[];
      // раньше проверка была «есть ли realt.by где-нибудь в строке» —
      // под неё подходил и https://чужой-сайт/?realt.by
      try{ urls=(JSON.parse(body).urls||[]).filter(isRealtUrl).slice(0,60); }catch(e){}
      const out={};
      await mapLimit(urls, 10, async (url)=>{ out[url]=await realtGeo(url); });
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({results:out}));
    });
    return;
  }
  if(u.pathname === '/api/gallery' && req.method === 'POST'){
    let body='';
    req.on('data', c=>{ body+=c; if(body.length>60000) req.destroy(); });
    req.on('end', async ()=>{
      let reqs=[];
      try{ reqs=(JSON.parse(body).reqs||[]).filter(x=>x&&x.key&&(x.src==='Flatbook'||x.src==='H101')).slice(0,30); }catch(e){}
      const out={};
      await mapLimit(reqs, 8, async (rq)=>{ out[rq.key]=await galleryFor(rq.src, rq.key); });
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({results:out}));
    });
    return;
  }
  if(u.pathname === '/api/rf/search'){
    const data = await cached(cacheKey(u), ()=> searchRF(
      u.searchParams.get('city') || 'moskva',
      { types:    u.searchParams.get('type')     || '',
        stars:    u.searchParams.get('stars')    || '',
        services: u.searchParams.get('services') || '',
        rating:   u.searchParams.get('rating')   || '',
        no_card:  u.searchParams.get('no_card')  || '',
        bathroom: u.searchParams.get('bathroom') || '',
        maxP:     +(u.searchParams.get('max')    || 0),
        minP:     +(u.searchParams.get('min')    || 0),
        sort:     u.searchParams.get('sort')     || 'price_asc' }
    ));
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(data)); return;
  }
  if(u.pathname === '/api/desc'){
    let text='';
    try{
      const src=u.searchParams.get('src'), id=u.searchParams.get('id'), url=u.searchParams.get('url');
      if(src==='Kufar' && id && /^[0-9]{1,20}$/.test(id)){
        const dj = await (await fetch('https://api.kufar.by/search-api/v1/item/'+id+'/rendered?lang=ru',{headers:{'User-Agent':UA}})).json();
        text = (dj.result && dj.result.body) || '';
      } else if(src==='Realt' && isRealtUrl(url)){
        const h = await (await fetch(url, ждём({headers:{'User-Agent':UA}}))).text();
        const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if(m){ let best='';
          (function f(o,d){ if(d>10||!o||typeof o!=='object') return;
            for(const k in o){ const v=o[k];
              if((/description|comment/i.test(k)) && typeof v==='string' && v.length>best.length) best=v;
              else f(v,d+1);
            } })(JSON.parse(m[1]),0);
          text=best;
        }
      }
    }catch(e){ text=''; }
    text = String(text).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({text})); return;
  }
  // приём событий статистики со страницы
  if(u.pathname === '/api/t' && req.method === 'POST'){
    let body='';
    req.on('data', c=>{ body+=c; if(body.length>4000) req.destroy(); });
    req.on('end', ()=>{
      try{
        const d  = JSON.parse(body||'{}');
        const ua = String(req.headers['user-agent']||'');
        statsAdd({
          t: Date.now(),
          e: String(d.e||'').slice(0,16),
          v: String(d.v||'').slice(0,32),
          s: String(d.s||'').slice(0,32),
          r: refHost(d.r),
          rh: refRaw(d.r),
          ref: String(d.r||'').slice(0, 200),
          bot: botOf(ua),
          app: appOf(ua),
          ua: ua.slice(0, 120),
          m: /Mobile|Android|iPhone|iPad/i.test(ua) ? 'моб.' : 'комп.',
          p: statsFields(d)
        });
      }catch(e){}
      res.writeHead(204); res.end();
    });
    return;
  }
  // Рейс — за тем же ключом, что и статистика: страница личная,
  // в поиске ей делать нечего.
  if(u.pathname === '/reis'){
    if(u.searchParams.get('key') !== STATS_KEY){
      res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('Нужен ключ: /reis?key=…'); return;
    }
    const номер = (u.searchParams.get('n') || РЕЙС).trim().slice(0, 10);
    let свод;
    try{ свод = await рейсСводка(номер); }
    catch(e){ свод = { номер, вылет:{error:'нет связи'}, прилёт:{error:'нет связи'},
                       авиакомпания:{error:'нет связи'}, вВоздухе:false, сел:false }; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(рейсPage(свод)); return;
  }
  if(u.pathname === '/stats'){
    if(u.searchParams.get('key') !== STATS_KEY){
      res.writeHead(403, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('Нужен ключ: /stats?key=…'); return;
    }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(statsPage()); return;
  }
  // страницы под поиск: /minsk, /brest, /minsk-nedorogo, /brest-usadby …
  const cityHit = parseCitySlug(u.pathname.slice(1));
  if(cityHit){
    try{
      const html = await cityPage(cityHit.city, cityHit.kind);
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300'});
      res.end(html);
    }catch(e){
      console.log('Городская страница не собралась:', e.message);
      res.writeHead(302, {'Location':'/?region='+cityHit.city}); res.end();
    }
    return;
  }
  // собственные фотографии точек: лежат файлами рядом с сервером
  if(u.pathname.startsWith('/фото-точек/') || u.pathname.startsWith('/%D1%84%D0%BE%D1%82%D0%BE-%D1%82%D0%BE%D1%87%D0%B5%D0%BA/')){
    const name = decodeURIComponent(u.pathname).split('/').pop();
    // Имя разрешаем русское: файл называют именем точки, и заставлять
    // переименовывать в латиницу значит терять весь смысл затеи.
    // Наружу из папки не выпускаем: косые черты уже отрезаны выше, здесь
    // отсекаем обратную косую и переход на уровень выше.
    if(name.indexOf('..') >= 0 || /[\\/:*?"<>|]/.test(name)
       || !/^[0-9A-Za-zА-Яа-яЁё _.()-]+\.(jpg|jpeg|png|webp)$/.test(name)){
      res.writeHead(404); res.end(); return;
    }
    try{
      const buf = fs.readFileSync(__dirname + '/фото-точек/' + name);
      res.writeHead(200, {'Content-Type': /png$/i.test(name) ? 'image/png' : 'image/jpeg',
                          'Content-Length': buf.length, 'Cache-Control':'public, max-age=604800'});
      res.end(buf);
    }catch(e){ res.writeHead(404); res.end(); }
    return;
  }
  // Браузер просит /favicon.ico сам, даже когда значок объявлен в разметке.
  // Отдаём его, чтобы в журнале не копились несуществующие адреса.
  // Адрес для внешнего пингера: отвечает сразу, страницу не собирает.
  // Render считает это входящим запросом и не усыпляет сервис.
  if(u.pathname === '/ping'){
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    res.end('ok ' + Math.round((Date.now() - ЗАПУЩЕН) / 1000) + 's'); return;
  }
  if(u.pathname === '/favicon.ico'){
    res.writeHead(200, {'Content-Type':'image/svg+xml; charset=utf-8',
                        'Cache-Control':'public, max-age=604800'});
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
          + '<text y=".9em" font-size="90">\uD83C\uDFE0</text></svg>'); return;
  }
  if(u.pathname === '/manifest.webmanifest'){
    res.writeHead(200, {'Content-Type':'application/manifest+json; charset=utf-8',
                        'Cache-Control':'no-cache'});
    res.end(JSON.stringify({
      name: 'Жильё на сутки — Беларусь и Россия',
      short_name: 'Жильё на сутки',
      description: META_DESC,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f4f5f7',
      theme_color: '#9a3412',
      lang: 'ru',
      icons: [
        { src:'/icon-192.png', sizes:'192x192', type:'image/png', purpose:'any' },
        { src:'/icon-512.png', sizes:'512x512', type:'image/png', purpose:'any' },
        { src:'/icon-512.png', sizes:'512x512', type:'image/png', purpose:'maskable' }
      ]
    })); return;
  }
  if(u.pathname === '/icon-192.png' || u.pathname === '/icon-512.png'){
    const buf = Buffer.from(u.pathname === '/icon-192.png' ? ICON_192 : ICON_512, 'base64');
    res.writeHead(200, {'Content-Type':'image/png','Content-Length':buf.length,'Cache-Control':'public, max-age=604800'});
    res.end(buf); return;
  }
  if(u.pathname === '/sw.js'){
    // Минимальный service worker: нужен, чтобы браузер предложил «Добавить на главный экран».
    // Ничего не кэшируем — цены должны быть свежими.
    res.writeHead(200, {'Content-Type':'application/javascript; charset=utf-8',
                        'Cache-Control':'no-cache'});
    res.end("self.addEventListener('install', function(){ self.skipWaiting(); });\n" +
            "self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });\n" +
            "self.addEventListener('fetch', function(e){ e.respondWith(fetch(e.request)); });\n"); return;
  }
  // список мест: целиком, по категории или вокруг точки
  if(u.pathname === '/api/places'){
    let list = await placesRaw();
    const g = (u.searchParams.get('group')||'').trim();
    if(g) list = list.filter(p => p.group === g);
    // поиск по названию и месту: без учёта регистра, «е» и «ё» считаем одной буквой
    const norm = t => String(t||'').toLowerCase().replace(/ё/g,'е');
    const q = norm(u.searchParams.get('q')).trim();
    if(q){
      // сначала совпадения в названии, и те, что стоят в начале слова:
      // по запросу «мир» человек ищет Мирский замок, а не «Первой Мировой»
      const score = p => {
        const n = norm(p.name), a = norm(p.addr) + ' ' + norm(p.cat);
        if(n === q) return 0;
        if(n.startsWith(q)) return 1;
        if(new RegExp('(^|[^а-яa-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(n)) return 2;
        if(n.includes(q)) return 3;
        if(a.includes(q)) return 4;
        return 9;
      };
      list = list.map(p => Object.assign({}, p, { _s: score(p) }))
                 .filter(p => p._s < 9)
                 .sort((x, y) => x._s - y._s || y.rating - x.rating)
                 .map(p => { delete p._s; return p; });
    }
    const lat = +u.searchParams.get('lat'), lng = +u.searchParams.get('lng');
    // когда ищут по названию, ограничивать радиусом бессмысленно —
    // человек ищет конкретный объект, а не «что рядом»
    const r = q ? 0 : +(u.searchParams.get('r') || 50);
    if(lat && lng && r){
      list = list.map(p => Object.assign({}, p, { km: Math.round(distKm(lat, lng, p.lat, p.lng) * 10) / 10 }))
                 .filter(p => p.km <= r)
                 // Сначала разряд, потом расстояние: в городе первым должен
                 // стоять костёл или усадьба, а не ближайший памятник.
                 .sort((a, b) => разряд(a) - разряд(b) || a.km - b.km);
    } else if(!q){
      list = list.slice().sort((a, b) => разряд(a) - разряд(b) || b.rating - a.rating);
    }
    // Для карты нужен весь список, но без ссылок на снимки: они занимают
    // три четверти веса ответа, а на карте не показываются до открытия точки.
    if(u.searchParams.get('light')){
      const light = list.slice(0, 1200).map(p => ({ id:p.id, name:p.name, lat:p.lat, lng:p.lng,
                                                    cat:p.cat, addr:p.addr, km:p.km }));
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ total: list.length, items: light })); return;
    }
    const groups = {};
    (await placesRaw()).forEach(p => { if(p.group) groups[p.group] = (groups[p.group]||0) + 1; });
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ total: list.length, groups, items: list.slice(0, 300) })); return;
  }
  // описание одной точки
  if(u.pathname === '/api/place'){
    const id = (u.searchParams.get('id')||'').replace(/[^0-9]/g, '');
    if(!id){ res.writeHead(400); res.end('{}'); return; }
    let d = { text:'', more: KUDIN + '/?point=' + id };
    try{ d = await placeDetail(id); }catch(e){}
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(d)); return;
  }
  // жильё рядом с местом
  if(u.pathname === '/api/places/stay'){
    const lat = +u.searchParams.get('lat'), lng = +u.searchParams.get('lng');
    const r = +(u.searchParams.get('r') || 30);
    const d = await stayNearPoint(lat, lng, r, u.searchParams.get('type') || '');
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ total: d.items.length, region: d.region, items: d.items.slice(0, 12) })); return;
  }
  // страница отдельного места: /mesto/2416 или /mesto/2416-mirskij-zamok
  // Дорога между точками: длина и линия по настоящим улицам, а не по прямой.
  // Считает открытый маршрутизатор OSRM; ответ держим сутки — дороги
  // меняются реже, чем цены на квартиры.
  if(u.pathname === '/api/route'){
    const пары = (u.searchParams.get('p') || '').split(';')
      .map(x => x.split(',').map(Number))
      .filter(c => c.length === 2 && c[0] > 40 && c[0] < 70 && c[1] > 15 && c[1] < 45)
      .slice(0, 12);
    if(пары.length < 2){
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end('{"ok":false}'); return;
    }
    const ключ = 'osrm|' + пары.map(c => c[0].toFixed(5) + ',' + c[1].toFixed(5)).join(';');
    let ответ = { ok:false };
    try{
      ответ = await cached(ключ, async ()=>{
        const coords = пары.map(c => c[1] + ',' + c[0]).join(';');
        const url = 'https://router.project-osrm.org/route/v1/driving/' + coords
                  + '?overview=full&geometries=geojson';
        const j = await (await fetch(url, {headers:{'User-Agent':UA}})).json();
        const r = j && j.routes && j.routes[0];
        if(!r) return { ok:false };
        return { ok:true,
                 km: Math.round(r.distance / 100) / 10,
                 minutes: Math.round(r.duration / 60),
                 // длина каждого перегона: в списке рядом с точкой пишем её,
                 // а не расстояние по прямой — иначе шаги не сходятся с итогом
                 legs: (r.legs || []).map(l => Math.round(l.distance / 100) / 10),
                 line: (r.geometry.coordinates || []).map(c => [c[1], c[0]]) };
      }, 24 * 60 * 60 * 1000);
    }catch(e){ ответ = { ok:false }; }
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify(ответ)); return;
  }
  if(u.pathname === '/marshrut'){
    const ids = (u.searchParams.get('p') || '').split(',')
      .map(x => x.replace(/[^0-9]/g, '')).filter(Boolean).slice(0, 20);
    let html = '';
    try{ html = await marshrutPage(ids); }catch(e){ html = ''; }
    if(!html){ res.writeHead(500); res.end('Не получилось собрать маршрут'); return; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache'});
    res.end(html); return;
  }
  if(u.pathname.startsWith('/mesto/')){
    const хвост = decodeURIComponent(u.pathname.slice('/mesto/'.length));
    const id = (хвост.match(/^[0-9]+/) || [''])[0];
    let html = null;
    if(id){ try{ html = await mestoPage(id); }catch(e){ console.error('Место ' + id + ':', e.message); } }
    if(!html){
      res.writeHead(404, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache'});
      res.end(notFoundPage(u.pathname, 'Такого места у нас нет'));
      return;
    }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'public, max-age=600'});
    res.end(html); return;
  }
  if(u.pathname === '/robots.txt'){
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('User-agent: *\nAllow: /\nSitemap: '+SITE_URL+'/sitemap.xml\n'); return;
  }
  if(u.pathname === '/sitemap.xml'){
    res.writeHead(200, {'Content-Type':'application/xml; charset=utf-8'});
    const urls = ['<url><loc>'+SITE_URL+'/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>']
      .concat(Object.keys(CITY_PAGES).map(function(k){
        return '<url><loc>'+SITE_URL+'/'+k+'</loc><changefreq>daily</changefreq><priority>0.8</priority></url>';
      }))
      .concat([].concat(...Object.keys(CITY_PAGES).map(function(city){
        return Object.keys(PAGE_KINDS).filter(Boolean).map(function(kind){
          return '<url><loc>'+SITE_URL+'/'+city+'-'+kind+'</loc><changefreq>daily</changefreq><priority>0.6</priority></url>';
        });
      })));
    // Места — самая большая часть карты сайта: их ищут по названию, а не
    // по слову «квартира». Без карты поисковик о них не узнает.
    let места = [];
    try{
      места = (await placesRaw()).map(function(p){
        return '<url><loc>'+SITE_URL+'/mesto/'+p.id+'-'+slugify(p.name)+'</loc>'
             + '<changefreq>weekly</changefreq><priority>0.7</priority></url>';
      });
    }catch(e){}
    res.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
      + urls.concat(места).join('') + '</urlset>'); return;
  }
  // Всё, что не разобрали выше, — не наш адрес. Раньше сюда попадал любой
  // мусор и получал главную страницу с кодом «200».
  if(u.pathname !== '/'){
    if(u.pathname.startsWith('/api/')){
      res.writeHead(404, {'Content-Type':'application/json; charset=utf-8'});
      res.end('{"error":"нет такого адреса"}'); return;
    }
    res.writeHead(404, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache'});
    res.end(notFoundPage(u.pathname)); return;
  }

  // Главную отдаём уже с квартирами: список лежит в памяти после прогрева,
  // и человеку не приходится ждать запроса, а поисковик видит содержимое.
  // Вкладываем только первую страницу выдачи — этого хватает на первый экран.
  let page = PAGE;
  if(u.pathname === '/' && ![...u.searchParams.keys()].length){
    try{
      const pu = new URL('/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=both', 'http://localhost');
      const d = await runSearchQuery(pu.searchParams);
      const preload = { total:d.total, kufar:d.kufar, realt:d.realt, flatbook:d.flatbook,
                        items:(d.items||[]).slice(0, 24) };
      const inject = 'window.__PRELOAD=' + JSON.stringify(preload).replace(/</g,'\\u003c') + ';';
      // Подставляем функцией, а не строкой: в строке замены последовательности
      // $' и $` означают «весь текст после/до совпадения». Название объявления
      // пишут люди, и заголовок вида «Квартира 30$' центр» вставил бы в страницу
      // её собственный хвост, закрыв тег script и сломав сайт целиком.
      page = PAGE.replace('/*ПРЕДЗАГРУЗКА*/', () => inject);
    }catch(e){ /* не вышло — страница просто загрузится как раньше */ }
  }
  // Отпечаток страницы: браузер пришлёт его обратно, и если ничего
  // не изменилось, мы ответим «304» без тела — это несколько сотен байт
  // вместо ста тридцати килобайт.
  const tag = '"' + crypto.createHash('sha1').update(page).digest('base64').slice(0, 22) + '"';
  if(req.headers['if-none-match'] === tag){
    res.writeHead(304, {'ETag': tag, 'Cache-Control':'no-cache'});
    res.end(); return;
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8',
                      'Cache-Control':'no-cache', 'ETag': tag});
  res.end(page);
}).listen(PORT, ()=> console.log('Открой http://localhost:'+PORT));

// ── Прогрев ───────────────────────────────────────────────────────────────
// Render на бесплатном тарифе усыпляет сервис, и первый живой посетитель
// ждёт не только запуск, но и «холодные» соединения с Kufar/Realt/Flatbook.
// Поэтому сразу после старта сами прогоняем тот же поиск, что открывается
// по умолчанию — результат ложится в кэш, и человек получает его мгновенно.
const WARM_UP = [
  '/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=kufar',
  '/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=realt',
  '/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=flatbook'
];
function warmUp(){
  // Общий список жилья для «что рядом» — заранее, чтобы первый нажавший
  // кнопку не ждал семь секунд.
  stayIndex().then(function(l){ console.log('Прогрев «рядом»: ' + l.length); })
             .catch(function(e){ console.log('Прогрев «рядом» не удался:', e.message); });
  WARM_UP.forEach(function(path){
    const uu = new URL(path, 'http://localhost');
    runSearchQuery(uu.searchParams)
      .then(function(d){ console.log('Прогрев ' + uu.searchParams.get('source') + ': ' + d.total); })
      .catch(function(e){ console.log('Прогрев не удался:', e.message); });
  });
  // Отели России греем отдельно: 101hotels отвечает две с лишним секунды,
  // и первый зашедший на вкладку столько и ждал. Греем ровно тот запрос,
  // который страница делает при переключении: город по умолчанию и цена
  // по возрастанию. Ключ кэша считаем той же функцией, что и обработчик, —
  // иначе прогреется одно, а спросится другое.
  const рф = new URL('/api/rf/search?city=moskva&sort=price_asc', 'http://localhost');
  cached(cacheKey(рф), function(){
    return searchRF('moskva', { types:'', stars:'', services:'', rating:'',
                                no_card:'', bathroom:'', maxP:0, minP:0, sort:'price_asc' });
  }).then(function(d){ console.log('Прогрев отелей России: ' + (d && d.total)); })
    .catch(function(e){ console.log('Прогрев отелей не удался:', e.message); });
}
setTimeout(warmUp, 1500);
setInterval(warmUp, 7 * 60 * 1000).unref();   // держим кэш тёплым
