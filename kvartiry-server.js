// Поиск жилья на сутки — Kufar + Realt. Квартиры / коттеджи / усадьбы.
// Запуск: node kvartiry-server.js  ->  http://localhost:8080  (или двойной клик "Открыть поиск.bat")
// На Render порт берётся из переменной окружения PORT.

const http = require('http');
const PORT = process.env.PORT || 8080;   // Render задаёт свой порт через переменную окружения
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const SITE_URL = 'https://poisk-kvartir.onrender.com';

// Области: realt = слаг раздела, oblast = как пишет Kufar, main = главный город (для запроса Kufar)
const REGIONS = {
  'brest':    {realt:'brest-region',   oblast:'Брестская область',   main:'Брест',
    cities:['Брест','Барановичи','Пинск','Кобрин','Берёза','Лунинец','Пружаны','Ганцевичи','Иваново','Жабинка']},
  'minsk':    {realt:'minsk',          oblast:'Минск',               main:'Минск',
    cities:['Минск']},
  'minsk-obl':{realt:'minsk-region',   oblast:'Минская область',     main:'Минск',
    cities:['Минск','Борисов','Солигорск','Молодечно','Жодино','Слуцк','Дзержинск','Вилейка','Марьина Горка','Смолевичи','Логойск','Заславль']},
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
const TYPES = {
  'flat':    {kw:'квартира', section:'flat-for-day'},
  'cottage': {kw:'коттедж дом', section:'cottage-for-day'},
  'usadba':  {kw:'усадьба',  section:'cottage-for-day'}
};

async function fromKufar(reg, city, type, rooms, maxP, guests){
  try{
    const t = TYPES[type]||TYPES.flat;
    const where = city || reg.main;
    const url='https://api.kufar.by/search-api/v2/search/rendered-paginated?query='+encodeURIComponent(t.kw+' на сутки '+where)+'&size=30&lang=ru';
    const k = await (await fetch(url,{headers:{'User-Agent':UA}})).json();
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
      return { src:'Kufar',
        price:a.price_byn? a.price_byn/100 : null,
        rooms:+(g(a,'rooms')?.v||0),
        area, region: g(a,'region')?.vl||'',
        capacity: g(a,'house_rent_couchettes')?.vl||'',
        title:a.subject||'',
        photos: (a.images||[]).map(im=>'https://rms.kufar.by/v1/gallery/'+im.path),
        rating:0, reviews:0, descId:a.ad_id,
        phone:'', name:'', lat, lng, approx, link:a.ad_link||'' };
    }).filter(x=> x.price>0
        && (city ? new RegExp(city,'i').test(x.area) : x.region===reg.oblast)
        && (!rooms||x.rooms==rooms) && (!maxP||x.price<=maxP) && (!guests|| (+x.capacity||0)>=guests)
        // отсечь прокат техники и услуги, которые цепляет запрос
        && !/прокат|пароочистит|пылесос|karcher|керхер|электроинструмент|генератор|виброплит|отбойн|перфоратор|\bдрель|бетоно|шлифов|аппарат|моющий|химчистк|фотозон|аренда авто|прицеп/i.test(x.title)
        // для домов/усадеб — только жильё (есть вместимость)
        && ( type==='flat' || (+x.capacity||0)>0 ) );
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
    const h = await (await fetch(url,{headers:{'User-Agent':UA}})).text();
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
async function fromRealt(reg, city, type, rooms, maxP, guests){
  try{
    const t = TYPES[type]||TYPES.flat;
    const base = realtBase(reg, t.section);
    // тянем 1-ю страницу; для Минска её (до 180) достаточно, пагинацию делаем на клиенте
    const h = await (await fetch(base,{headers:{'User-Agent':UA}})).text();
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
    })
    .filter(x=> x.price>0
        && (city ? new RegExp(city,'i').test(x.area) : true)
        && (!rooms||x.rooms==rooms) && (!maxP||x.price<=maxP) && (!guests|| (+x.capacity||0)>=guests));
  }catch(e){ console.error('Realt:', e.message); return []; }
}

async function search(regKey, city, type, rooms, maxP, guests, source){
  const keys = regKey==='any' ? Object.keys(REGIONS) : [ REGIONS[regKey] ? regKey : 'brest' ];
  const useK = source!=='realt', useR = source!=='kufar';
  const tasks = [];
  keys.forEach(key=>{
    const reg = REGIONS[key];
    if(useK) tasks.push(fromKufar(reg,city,type,rooms,maxP,guests));
    if(useR) tasks.push(fromRealt(reg,city,type,rooms,maxP,guests));
  });
  const arrs = await Promise.all(tasks);
  let all = [].concat(...arrs);
  // убрать дубли по ссылке (Kufar при 'любой области' может повторяться)
  const seen = new Set();
  all = all.filter(x=>{ if(seen.has(x.link)) return false; seen.add(x.link); return true; })
           .sort((a,b)=>a.price-b.price);
  return { total: all.length,
           kufar: all.filter(x=>x.src==='Kufar').length,
           realt: all.filter(x=>x.src==='Realt').length,
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
const RF_SERVICE_CHIPS  = Object.entries(RF_SERVICES).map(([k,v])=>'<button type="button" class="chip" data-v="'+k+'">'+v+'</button>').join('');

function hotel101ToItem(hh){
  const co = hh.coords || [];
  const lng = +co[0], lat = +co[1];
  if(!(lat>40 && lat<75 && lng>18 && lng<190)) return null;
  const img = hh.image && (hh.image.preview_path || hh.image.path || hh.image.thumb_path);
  const stars = +hh.stars || 0;
  const typeName = RF_TYPES[String(hh.type_id)] || '';
  const rs = hh.reviews_summary || {};
  const prepay = (hh.min_price_data && hh.min_price_data.prepayment) || '';  // NO = оплата при заселении, FIRST/FULL = предоплата
  const chips = [];
  if(stars) chips.push('★'.repeat(stars));
  if(typeName) chips.push(typeName);
  if(hh.city_name) chips.push(hh.city_name);
  if(prepay==='NO') chips.push('💳 оплата на месте');
  return { src:'H101', cur:'₽',
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
  let url = 'https://ssg.101hotels.com/hotel/available/map?' + p.toString();
  if(opts.maxP) url += '&price%5B%5D=0&price%5B%5D=' + encodeURIComponent(opts.maxP);
  try{
    const j = await (await fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json','Accept-Language':'ru','Referer':'https://101hotels.com/','X-Requested-With':'XMLHttpRequest'}})).json();
    const hotels = (j.response && j.response.hotels) || [];
    return hotels.map(hotel101ToItem).filter(x=> x && x.price>0 && (!opts.maxP || x.price<=opts.maxP));
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

const META_DESC = 'Поиск жилья на сутки: Беларусь (Kufar + Realt) и отели России (101hotels) в одном месте. Фильтры по городу, типу, цене, звёздам, рейтингу и удобствам, список и карта с ценами, телефоны и описания.';

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Жильё на сутки в Беларуси — квартиры, коттеджи, усадьбы (Kufar + Realt)</title>
<meta name="description" content="${META_DESC}">
<meta name="keywords" content="снять квартиру на сутки, жильё на сутки Беларусь, квартира посуточно Минск, коттедж на сутки, усадьба на выходные, аренда посуточно Брест Гомель Гродно Витебск Могилёв, kufar realt">
<meta name="robots" content="index,follow">
<meta name="author" content="poisk-kvartir">
<meta name="theme-color" content="#ff5a1f">
<link rel="canonical" href="${SITE_URL}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Поиск жилья на сутки">
<meta property="og:title" content="Жильё на сутки в Беларуси — квартиры, коттеджи, усадьбы">
<meta property="og:description" content="${META_DESC}">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:locale" content="ru_BY">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Жильё на сутки в Беларуси — Kufar + Realt в одном поиске">
<meta name="twitter:description" content="${META_DESC}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%8F%A0%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","name":"Поиск жилья на сутки","url":"${SITE_URL}/","inLanguage":"ru-BY","description":"${META_DESC}"}
</script>
<style>
:root{
  --bg:#f4f5f7;
  --bg-grad-1:#eef0f4;
  --bg-grad-2:#f6f7f9;
  --surface:#ffffff;
  --surface-2:#f7f8fa;
  --surface-3:#eef0f4;
  --line:#e2e5ea;
  --line-strong:#d3d7de;
  --txt:#141821;
  --txt-2:#4a5160;
  --txt-3:#8b93a3;
  --accent:#ff5a1f;
  --accent-2:#ff7d47;
  --accent-ink:#ffffff;
  --accent-soft:rgba(255,90,31,.12);
  --gold:#f5a623;
  --kufar:#2f6bff;
  --kufar-soft:rgba(47,107,255,.14);
  --realt:#ff7a18;
  --realt-soft:rgba(255,122,24,.14);
  --shadow-sm:0 1px 2px rgba(20,24,33,.05),0 2px 8px rgba(20,24,33,.05);
  --shadow-md:0 6px 24px rgba(20,24,33,.09),0 2px 8px rgba(20,24,33,.05);
  --shadow-lg:0 18px 50px rgba(20,24,33,.14);
  --radius:20px;
  --radius-sm:12px;
  --radius-xs:10px;
  --focus:rgba(255,90,31,.35);
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0a0c12;
    --bg-grad-1:#0d1018;
    --bg-grad-2:#07080d;
    --surface:#14171f;
    --surface-2:#191d27;
    --surface-3:#1f2430;
    --line:#252b38;
    --line-strong:#323a4a;
    --txt:#f2f4f8;
    --txt-2:#aab2c2;
    --txt-3:#6b7386;
    --accent:#ff6a34;
    --accent-2:#ff8a58;
    --accent-ink:#0a0c12;
    --accent-soft:rgba(255,106,52,.16);
    --gold:#ffc247;
    --kufar:#5b8bff;
    --kufar-soft:rgba(91,139,255,.18);
    --realt:#ff8a3d;
    --realt-soft:rgba(255,138,61,.18);
    --shadow-sm:0 1px 2px rgba(0,0,0,.4);
    --shadow-md:0 10px 30px rgba(0,0,0,.5);
    --shadow-lg:0 24px 60px rgba(0,0,0,.6);
    --focus:rgba(255,106,52,.45);
  }
}

*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{
  margin:0;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--txt);
  background:var(--bg);
  background-image:
    radial-gradient(1200px 700px at 85% -10%, var(--accent-soft), transparent 60%),
    radial-gradient(900px 600px at 5% 0%, var(--kufar-soft), transparent 55%),
    linear-gradient(180deg,var(--bg-grad-1),var(--bg-grad-2));
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
  font-size:clamp(30px,6vw,54px);
  line-height:1.04;
  font-weight:800;
  letter-spacing:-.03em;
  margin:6px 0 8px;
}
h1 .accent{
  background:linear-gradient(120deg,var(--accent),var(--accent-2));
  -webkit-background-clip:text;
  background-clip:text;
  color:transparent;
}
.lead{
  color:var(--txt-2);
  font-size:clamp(15px,2.4vw,19px);
  max-width:60ch;
  margin:0 0 clamp(22px,4vw,34px);
}
.kicker{
  display:inline-flex;align-items:center;gap:8px;
  font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--accent);
  background:var(--accent-soft);
  border:1px solid color-mix(in srgb,var(--accent) 22%,transparent);
  padding:6px 13px;border-radius:999px;
}
.kicker .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}

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
  background:linear-gradient(120deg,var(--accent),var(--accent-2));
  border:none;
  border-radius:var(--radius-sm);
  padding:15px 22px;
  min-height:54px;
  cursor:pointer;
  box-shadow:0 8px 22px -6px color-mix(in srgb,var(--accent) 70%,transparent);
  transition:transform .12s, box-shadow .15s, filter .15s;
  display:inline-flex;align-items:center;justify-content:center;gap:9px;
}
.go::before{content:"⌕";font-size:20px;line-height:1;margin-top:-1px}
.go:hover{filter:brightness(1.04);box-shadow:0 12px 28px -6px color-mix(in srgb,var(--accent) 75%,transparent)}
.go:active{transform:translateY(1px)}
.go:focus-visible{outline:none;box-shadow:0 0 0 4px var(--focus),0 8px 22px -6px color-mix(in srgb,var(--accent) 70%,transparent)}

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
.seg button.on{background:var(--accent);color:var(--accent-ink);box-shadow:0 4px 12px -4px color-mix(in srgb,var(--accent) 70%,transparent)}
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
.price-pin.Realt{background:#ff7a18}
.price-pin::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#fff}
.price-pin:hover{filter:brightness(1.06);z-index:1000}
.leaflet-popup-content{margin:12px 14px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.mp-price{font-weight:800;font-size:17px;color:#141821}
.mp-price small{font-weight:500;color:#888;font-size:12px}
.mp-meta{font-size:12.5px;color:#555;margin:2px 0 8px}
.mp-call{display:block;font-size:13px;font-weight:700;color:#141821;margin:2px 0}
.mp-open{display:inline-block;margin-top:6px;font-weight:800;color:#ff5a1f;text-decoration:none}
.mp-approx{color:#9098a6;font-size:11px;margin-top:5px}

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
.country button.on{background:var(--accent);color:var(--accent-ink);box-shadow:0 4px 12px -4px color-mix(in srgb,var(--accent) 70%,transparent)}

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

/* ---------- 101Hotels (РФ) source colours ---------- */
.tag.H101{background:linear-gradient(120deg,#7c3aed,#a855f7)}
.price-pin.H101{background:#7c3aed}

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
  <span class="kicker"><span class="dot"></span>Kufar + Realt · Беларусь</span>
  <h1>Жильё на сутки, <span class="accent">без лишних вкладок</span></h1>
  <p class="lead">Квартиры, коттеджи и усадьбы на сутки из двух крупнейших площадок аренды Беларуси — Kufar и Realt — в одной ленте и на карте. Настройте фильтры и найдите вариант под свою дату и бюджет.</p>

  <div class="country">
    <button id="cbBY" class="on" type="button" onclick="setCountry('by')">🇧🇾 Беларусь · посуточно</button>
    <button id="cbRU" type="button" onclick="setCountry('ru')">🇷🇺 Россия · отели</button>
  </div>

  <form class="bar" id="bar" onsubmit="return false">
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
        <option value="flat">Квартира</option>
        <option value="cottage">Коттедж / дом</option>
        <option value="usadba">Усадьба</option>
      </select>
    </label>

    <label class="fld">
      <span>Комнат</span>
      <select id="rooms">
        <option value="">любое</option>
        <option value="1">1</option>
        <option value="2" selected>2</option>
        <option value="3">3+</option>
      </select>
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
      <span>Цена до, руб/сутки</span>
      <input id="max" type="number" placeholder="без огранич.">
    </label>

    <label class="fld">
      <span>Источник</span>
      <select id="source">
        <option value="both">Kufar + Realt</option>
        <option value="kufar">Только Kufar</option>
        <option value="realt">Только Realt</option>
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
      <span>Цена до, ₽/ночь</span>
      <input id="rfMax" type="number" placeholder="без огранич.">
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
      <span class="chip-sep">Удобства в номере:</span>
      ${RF_SERVICE_CHIPS}
    </div>
    <button id="goRF" class="go" type="button">Найти отели</button>
  </form>

  <div class="toolbar">
    <div id="stat"></div>
    <span id="geo" style="color:var(--txt-3);font-size:12.5px"></span>
    <div class="seg" role="tablist" aria-label="Вид">
      <button id="viewList" class="on" type="button" onclick="setView('list')">☰ Список</button>
      <button id="viewMap" type="button" onclick="setView('map')">📍 Карта</button>
    </div>
  </div>

  <div id="map" style="display:none"></div>
  <div id="grid"></div>
  <div id="pager"></div>

  <p class="hint" id="hint">Цены и наличие подтягиваются напрямую из объявлений Kufar и Realt в режиме реального времени. На карте цена показана прямо на метке: <b style="color:var(--kufar)">синие</b> — Kufar, <b style="color:var(--realt)">оранжевые</b> — Realt. Точные координаты подтягиваются из объявления; пока адрес уточняется, метка стоит у центра города (значок ≈ в подсказке). Итоговая стоимость за весь период рассчитывается по датам заезда и выезда. Перед бронированием уточняйте детали у собственника.</p>
</div>

<button id="up" class="up" type="button" aria-label="Наверх" title="Наверх">↑</button>

<script>
const $=s=>document.querySelector(s);
const CITIES = ${JSON.stringify(CITIES_MAP)};
const PAGE_SIZE = 24;
window.__page = 1;
window.__view = 'list';
window.__mode = 'by';   // 'by' = Беларусь (Kufar+Realt), 'ru' = Россия (101hotels)

function srcName(s){ return s==='H101' ? '101Hotels' : s; }
function curOf(x){ return (x && x.cur) ? x.cur : 'BYN'; }
const HINT_RU = 'Отели и жильё России с 101hotels.com в реальном времени. Цена «от» за ночь показана прямо на метке карты (<b style="color:#7c3aed">фиолетовые</b> — 101Hotels, координаты точные). Доступны фильтры по типу размещения, звёздам, цене, рейтингу, удобствам и оплате при заселении. Список и карта; перед бронированием проверяйте даты и условия на 101hotels.com.';

// переключение Беларусь / Россия
function setCountry(c){
  window.__mode = (c==='ru') ? 'ru' : 'by';
  const ru = window.__mode==='ru';
  $('#cbBY').classList.toggle('on', !ru);
  $('#cbRU').classList.toggle('on', ru);
  $('#bar').style.display   = ru ? 'none' : '';
  $('#barRF').style.display = ru ? '' : 'none';
  if(!window.__hintBY) window.__hintBY = $('#hint').innerHTML;
  $('#hint').innerHTML = ru ? HINT_RU : window.__hintBY;
  window.__page = 1;
  run();
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
  const p=new URLSearchParams({ city:$('#rfCity').value });
  const t=$('#rfType').value;   if(t)  p.set('type', t);
  const st=$('#rfStars').value; if(st) p.set('stars', st);
  const mx=$('#rfMax').value;   if(mx) p.set('max', mx);
  const rt=$('#rfRating').value;if(rt) p.set('rating', rt);
  p.set('sort', $('#rfSort').value);
  if($('#rfNoCard').classList.contains('on')) p.set('no_card','1');
  const svc=[...document.querySelectorAll('#barRF .chip[data-v].on')].map(b=>b.dataset.v).join(',');
  if(svc) p.set('services', svc);
  $('#stat').textContent='Ищу отели…'; $('#grid').innerHTML=''; $('#pager').innerHTML='';
  try{
    const d=await (await fetch('/api/rf/search?'+p.toString())).json();
    const cityName=$('#rfCity').selectedOptions[0] ? $('#rfCity').selectedOptions[0].textContent : '';
    $('#stat').textContent='Найдено '+d.total+' отелей'+(cityName?(' · '+cityName):'');
    window.__items=d.items||[]; window.__page=1;
    if(!window.__items.length){ $('#grid').innerHTML='<div class="empty">Ничего не найдено. Смягчите фильтры.</div>'; if(window.__view==='map') plotMap(true); return; }
    sortItems();
    if(window.__view==='map') plotMap(true); else renderCards();
  }catch(e){ $('#stat').textContent='Ошибка: '+e.message; }
}
async function run(){
  if(window.__mode==='ru') return runRF();
  const p=new URLSearchParams({
    region:$('#region').value, city:$('#city').value.trim(), type:$('#type').value,
    rooms:$('#rooms').value, guests:$('#guests').value, max:$('#max').value, source:$('#source').value
  });
  $('#stat').textContent='Ищу…'; $('#grid').innerHTML=''; $('#pager').innerHTML='';
  try{
    const d=await (await fetch('/api/search?'+p.toString())).json();
    const N=nights();
    $('#stat').textContent='Найдено '+d.total+' (Kufar '+d.kufar+' + Realt '+d.realt+')'+(N?(', расчёт на '+N+' ноч.'):'');
    window.__items=d.items||[]; window.__page=1;
    if(!window.__items.length){ $('#grid').innerHTML='<div class="empty">Ничего не найдено. Смягчите фильтры.</div>'; if(window.__view==='map') plotMap(true); return; }
    sortItems();
    if(window.__view==='map'){ plotMap(true); enrichRealt(); } else renderCards();
  }catch(e){ $('#stat').textContent='Ошибка: '+e.message; }
}
function renderCards(){
  const all=window.__items||[];
  if(!all.length){ $('#pager').innerHTML=''; return; }
  sortItems();
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
        ? '<div class="meta">'+x.chips.map(function(c){return '<span>'+c+'</span>';}).join('')+'</div>'
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
      return '<div class="card">'+slider
        +'<div class="bd">'
        +'<div class="pr">'+x.price+' '+curOf(x)+' <span class="tot">/ '+(x.chips?'ночь':'сутки')+'</span></div>'+total+stars
        +meta
        +'<div class="ttl">'+(x.title||'').replace(/</g,'&lt;')+'</div>'+desc
        +'<div class="act">'+call+'<a href="'+x.link+'" target="_blank" rel="noopener">Открыть</a></div>'
        +'</div></div>';
    }).join('');
  renderPager(pages);
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
  $('#viewList').classList.toggle('on', v==='list');
  $('#viewMap').classList.toggle('on', v==='map');
  $('#grid').style.display = v==='list' ? '' : 'none';
  $('#pager').style.display = v==='list' ? '' : 'none';
  $('#map').style.display = v==='map' ? '' : 'none';
  if(v==='map'){ plotMap(true); enrichRealt(); } else renderCards();
}
// карта Leaflet: цена на метке, тултип при наведении, карточка в попапе
function popupHtml(x){
  const img=x.photos&&x.photos[0]? '<img src="'+x.photos[0]+'" style="width:100%;height:120px;object-fit:cover;border-radius:8px;display:block;margin-bottom:8px" alt="">':'';
  if(x.chips){   // отель 101hotels
    const rate=(x.reviews>0&&x.rating>0)? '<div style="font-size:12px;color:#e6a400;font-weight:700;margin:2px 0">★ '+x.rating.toFixed(1)+' · '+x.reviews+' отз.</div>':'';
    return '<div class="mp"><div class="mp-price">'+x.price+' '+curOf(x)+' <small>/ ночь</small></div>'
      +'<div class="mp-meta">'+(x.title||'')+'</div>'
      +'<div class="mp-meta">'+x.chips.join(' · ')+'</div>'+rate+img
      +'<a class="mp-open" href="'+x.link+'" target="_blank" rel="noopener">Открыть на 101Hotels →</a></div>';
  }
  const call=x.phone? '<a class="mp-call" href="tel:+'+x.phone+'">📞 '+fmtPhone(x.phone)+(x.name?(' · '+x.name):'')+'</a>':'';
  const ap=x.approx? '<div class="mp-approx">≈ адрес примерный (по городу)</div>':'';
  const cap=x.capacity? (' · до '+x.capacity+' гостей'):'';
  return '<div class="mp"><div class="mp-price">'+x.price+' BYN <small>/ сутки</small></div>'
    +'<div class="mp-meta">'+(x.area||'')+' · '+x.rooms+'-комн'+cap+'</div>'
    +img+call
    +'<a class="mp-open" href="'+x.link+'" target="_blank" rel="noopener">Открыть на '+x.src+' →</a>'+ap+'</div>';
}
function plotMap(fit){
  if(typeof L==='undefined'){ $('#map').innerHTML='<div style="padding:24px;color:var(--txt-2)">Карта не загрузилась (нет связи с картографическим сервисом).</div>'; return; }
  if(!window.__map){
    window.__map=L.map('map',{scrollWheelZoom:true}).setView([53.70,27.95],6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(window.__map);
    window.__mlayer=L.layerGroup().addTo(window.__map);
  }
  window.__mlayer.clearLayers();
  const items=(window.__items||[]).filter(x=>x.lat&&x.lng);
  const pts=[];
  items.forEach(function(x){
    const icon=L.divIcon({className:'',iconSize:[1,1],iconAnchor:[0,0],html:'<div class="price-pin '+x.src+'">'+x.price+'</div>'});
    const mk=L.marker([x.lat,x.lng],{icon:icon,riseOnHover:true}).addTo(window.__mlayer);
    const tip = x.chips
      ? (x.chips.join(' · ')+' · '+x.price+' '+curOf(x))
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
// Россия (101hotels)
document.querySelectorAll('#barRF select, #barRF input').forEach(el=>{ if(el.id!=='rfSort') el.addEventListener('change',run); });
$('#rfSort').addEventListener('change', function(){ window.__page=1; renderCards(); });
document.querySelectorAll('#barRF .chip').forEach(ch=> ch.addEventListener('click', function(){ this.classList.toggle('on'); run(); }));
$('#goRF').addEventListener('click',run);
// кнопка "наверх"
window.addEventListener('scroll', function(){ $('#up').classList.toggle('show', window.scrollY>500); });
window.addEventListener('load',run);
</script></body></html>`;

http.createServer(async (req,res)=>{
  const u = new URL(req.url, 'http://localhost');
  if(u.pathname === '/api/search'){
    const data = await search(
      u.searchParams.get('region')||'brest',
      (u.searchParams.get('city')||'').trim(),
      u.searchParams.get('type')||'flat',
      u.searchParams.get('rooms')||'',
      +(u.searchParams.get('max')||0),
      +(u.searchParams.get('guests')||0),
      u.searchParams.get('source')||'both'
    );
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(data)); return;
  }
  if(u.pathname === '/api/geo' && req.method === 'POST'){
    let body='';
    req.on('data', c=>{ body+=c; if(body.length>200000) req.destroy(); });
    req.on('end', async ()=>{
      let urls=[];
      try{ urls=(JSON.parse(body).urls||[]).filter(x=>typeof x==='string' && /realt\.by/.test(x)).slice(0,60); }catch(e){}
      const out={};
      await mapLimit(urls, 10, async (url)=>{ out[url]=await realtGeo(url); });
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({results:out}));
    });
    return;
  }
  if(u.pathname === '/api/rf/search'){
    const data = await searchRF(
      u.searchParams.get('city') || 'moskva',
      { types:    u.searchParams.get('type')     || '',
        stars:    u.searchParams.get('stars')    || '',
        services: u.searchParams.get('services') || '',
        rating:   u.searchParams.get('rating')   || '',
        no_card:  u.searchParams.get('no_card')  || '',
        maxP:     +(u.searchParams.get('max')    || 0),
        sort:     u.searchParams.get('sort')     || 'price_asc' }
    );
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(data)); return;
  }
  if(u.pathname === '/api/desc'){
    let text='';
    try{
      const src=u.searchParams.get('src'), id=u.searchParams.get('id'), url=u.searchParams.get('url');
      if(src==='Kufar' && id){
        const dj = await (await fetch('https://api.kufar.by/search-api/v1/item/'+id+'/rendered?lang=ru',{headers:{'User-Agent':UA}})).json();
        text = (dj.result && dj.result.body) || '';
      } else if(src==='Realt' && url){
        const h = await (await fetch(url,{headers:{'User-Agent':UA}})).text();
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
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({text})); return;
  }
  if(u.pathname === '/robots.txt'){
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('User-agent: *\nAllow: /\nSitemap: '+SITE_URL+'/sitemap.xml\n'); return;
  }
  if(u.pathname === '/sitemap.xml'){
    res.writeHead(200, {'Content-Type':'application/xml; charset=utf-8'});
    res.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'+SITE_URL+'/</loc><changefreq>daily</changefreq><priority>1.0</priority></url></urlset>'); return;
  }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(PAGE);
}).listen(PORT, ()=> console.log('Открой http://localhost:'+PORT));
