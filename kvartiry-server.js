// Поиск жилья на сутки — Kufar + Realt. Квартиры / коттеджи / усадьбы.
// Запуск: node kvartiry-server.js  ->  http://localhost:8080  (или двойной клик "Открыть поиск.bat")
// На Render порт берётся из переменной окружения PORT.

const http = require('http');
const PORT = process.env.PORT || 8080;   // Render задаёт свой порт через переменную окружения
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

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
      return { src:'Kufar',
        price:a.price_byn? a.price_byn/100 : null,
        rooms:+(g(a,'rooms')?.v||0),
        area: g(a,'area')?.vl||'',
        region: g(a,'region')?.vl||'',
        capacity: g(a,'house_rent_couchettes')?.vl||'',
        title:a.subject||'',
        photos: (a.images||[]).map(im=>'https://rms.kufar.by/v1/gallery/'+im.path),
        rating:0, reviews:0, descId:a.ad_id,
        phone:'', name:'', link:a.ad_link||'' };
    }).filter(x=> x.price>0
        && (city ? new RegExp(city,'i').test(x.area) : x.region===reg.oblast)
        && (!rooms||x.rooms==rooms) && (!maxP||x.price<=maxP) && (!guests|| (+x.capacity||0)>=guests)
        // отсечь прокат техники и услуги, которые цепляет запрос
        && !/прокат|пароочистит|пылесос|karcher|керхер|электроинструмент|генератор|виброплит|отбойн|перфоратор|\bдрель|бетоно|шлифов|аппарат|моющий|химчистк|фотозон|аренда авто|прицеп/i.test(x.title)
        // для домов/усадеб — только жильё (есть вместимость)
        && ( type==='flat' || (+x.capacity||0)>0 ) );
  }catch(e){ console.error('Kufar:', e.message); return []; }
}

async function fromRealt(reg, city, type, rooms, maxP, guests){
  try{
    const t = TYPES[type]||TYPES.flat;
    const h = await (await fetch('https://realt.by/'+reg.realt+'/rent/'+t.section+'/',{headers:{'User-Agent':UA}})).text();
    const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if(!m) return [];
    let res=null;
    (function f(o,d){ if(d>7||!o||typeof o!=='object') return;
      for(const k in o){ if(k==='results'&&Array.isArray(o[k])){res=o[k];return;} f(o[k],d+1); } })(JSON.parse(m[1]),0);
    return (res||[]).map(a=>({ src:'Realt',
      price:a.calculatedPrice||null, rooms:a.rooms,
      area:a.townName||'', region:a.stateRegionName||'',
      capacity:a.maxCapacity||'',
      title:((a.townName||'')+' '+(a.address||a.title||'')).replace(/\s+/g,' ').trim(),
      photos:(a.images||a.imagesV2||[]).filter(Boolean),
      rating:+a.rating||0, reviews:+a.reviews||0, descId:a.code,
      phone:(a.contactPhones||[])[0]||'', name:a.contactName||'',
      link:'https://realt.by/'+reg.realt+'/rent-'+t.section+'/object/'+a.code+'/' }))
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

const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Поиск жилья на сутки</title>
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
html{-webkit-text-size-adjust:100%}
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
  margin-bottom:22px;
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

/* ---------- Status + hint ---------- */
#stat{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  color:var(--txt-2);font-size:14.5px;font-weight:500;
  padding:4px 2px 2px;
  min-height:24px;
}
.hint{
  color:var(--txt-3);
  font-size:13px;
  margin:6px 2px 22px;
  line-height:1.6;
}

/* ---------- Grid ---------- */
#grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  gap:clamp(16px,2.4vw,24px);
  margin-top:18px;
}

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
  <p class="lead">Квартиры, коттеджи и усадьбы из двух крупнейших площадок аренды — в одной ленте. Настройте фильтры и найдите вариант под свою дату и бюджет.</p>

  <div class="bar">
    <label class="fld">
      <span>Область</span>
      <select id="region">
        <option value="any">Любая область</option>
        <option value="brest" selected>Брестская обл.</option>
        <option value="minsk">Минск (город)</option>
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

    <button id="go" class="go">Найти</button>
  </div>

  <div id="stat"></div>

  <div id="grid"></div>

  <p class="hint">Цены и наличие подтягиваются напрямую из объявлений Kufar и Realt. Итоговая стоимость за весь период рассчитывается по выбранным датам заезда и выезда. Перед бронированием уточняйте детали у собственника.</p>
</div>
<script>
const $=s=>document.querySelector(s);
const CITIES = ${JSON.stringify(CITIES_MAP)};
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
async function run(){
  const p=new URLSearchParams({
    region:$('#region').value, city:$('#city').value.trim(), type:$('#type').value,
    rooms:$('#rooms').value, guests:$('#guests').value, max:$('#max').value, source:$('#source').value
  });
  $('#stat').textContent='Ищу…'; $('#grid').innerHTML='';
  try{
    const d=await (await fetch('/api/search?'+p.toString())).json();
    const N=nights();
    $('#stat').textContent='Найдено '+d.total+' (Kufar '+d.kufar+' + Realt '+d.realt+')'+(N?(', расчёт на '+N+' ноч.'):'');
    if(!d.items.length){ $('#grid').innerHTML='<div class="empty">Ничего не найдено. Смягчите фильтры.</div>'; return; }
    window.__items=d.items;
    renderCards();
  }catch(e){ $('#stat').textContent='Ошибка: '+e.message; }
}
function renderCards(){
  const items=window.__items||[]; if(!items.length) return;
  const s=$('#sort')?$('#sort').value:'price_asc';
  items.sort(function(a,b){ return s==='price_desc'? b.price-a.price : s==='rating_desc'? (((b.rating||0)-(a.rating||0))||(a.price-b.price)) : a.price-b.price; });
  const N=nights();
  $('#grid').innerHTML=items.map(function(x,idx){
      const capChip = x.capacity ? ('<span>до '+x.capacity+' гостей</span>') : '';
      const total = N ? ('<div class="total">'+(x.price*N)+' BYN за '+N+' ноч.</div>') : '';
      const call = x.phone ? '<a class="call" href="tel:+'+x.phone+'">'+fmtPhone(x.phone)+(x.name?(' · '+x.name):'')+'</a>' : '';
      const desc = x.descId ? '<div class="desc-t" onclick="showDesc('+idx+')" id="dt'+idx+'">Описание ▾</div><div class="desc" id="dd'+idx+'" style="display:none"></div>' : '';
      // рейтинг: 0..10 -> 5 звёзд, показываем только при отзывах
      let stars='';
      if(x.reviews>0 && x.rating>0){
        const st=Math.round(x.rating/2);
        stars='<div class="stars">'+'★'.repeat(st)+'☆'.repeat(5-st)+'<span class="num">'+x.rating.toFixed(1)+' · '+x.reviews+' отз.</span></div>';
      }
      // бейдж источника — оверлеем на фото
      const tag='<span class="tag '+x.src+'">'+x.src+'</span>';
      // слайдер фото
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
        +'<div class="pr">'+x.price+' BYN <span class="tot">/ сутки</span></div>'+total+stars
        +'<div class="meta"><span>'+(x.area||'—')+'</span><span>'+x.rooms+'-комн</span>'+capChip+'</div>'
        +'<div class="ttl">'+(x.title||'').replace(/</g,'&lt;')+'</div>'+desc
        +'<div class="act">'+call+'<a href="'+x.link+'" target="_blank" rel="noopener">Открыть</a></div>'
        +'</div></div>';
    }).join('');
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
document.querySelectorAll('.bar select, .bar input').forEach(el=>{ if(el.id!=='sort') el.addEventListener('change',run); });
$('#sort').addEventListener('change', renderCards);
$('#go').addEventListener('click',run);
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
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  res.end(PAGE);
}).listen(PORT, ()=> console.log('Открой http://localhost:'+PORT));
