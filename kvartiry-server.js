// Поиск жилья на сутки — Kufar + Realt. Квартиры / коттеджи / усадьбы.
// Запуск: node kvartiry-server.js  ->  http://localhost:8080  (или двойной клик "Открыть поиск.bat")
// Крутится локально, ничего никуда не заливает.

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
 :root{--bg:#f5f6f8;--card:#fff;--text:#1a1d22;--muted:#6b7280;--line:#e5e7eb;--accent:#0b6b3a;--kufar:#1a73e8;--realt:#e8541a}
 @media(prefers-color-scheme:dark){:root{--bg:#13151a;--card:#1c1f26;--text:#e8eaed;--muted:#9aa0a6;--line:#2b303a;--accent:#37c07f}}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
 .wrap{max-width:960px;margin:0 auto;padding:22px 14px 60px}
 h1{font-size:22px;margin:0 0 16px}
 .bar{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px}
 @media(max-width:680px){.bar{grid-template-columns:repeat(2,1fr)}}
 label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
 select,input{width:100%;padding:10px 12px;font-size:15px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--text)}
 .go{grid-column:1/-1;padding:12px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
 .stat{color:var(--muted);font-size:14px;margin:0 2px 14px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
 .card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
 .slider{position:relative;aspect-ratio:4/3;background:#8882;overflow:hidden}
 .slider .im{width:100%;height:100%;object-fit:cover;display:block}
 .slider .nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;
   background:rgba(0,0,0,.45);color:#fff;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
 .slider .prev{left:8px}.slider .next{right:8px}
 .slider .cnt{position:absolute;bottom:8px;right:10px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;padding:2px 8px;border-radius:20px}
 .stars{font-size:14px;color:#f5a623;letter-spacing:1px}
 .stars .num{color:var(--muted);font-size:12px;margin-left:4px}
 .ph{aspect-ratio:4/3;background:#8882 center/cover no-repeat}
 .bd{padding:12px;display:flex;flex-direction:column;gap:6px;flex:1}
 .pr{font-size:20px;font-weight:700}
 .tot{font-size:13px;color:var(--accent);font-weight:600}
 .meta{font-size:13px;color:var(--muted)}
 .ttl{font-size:14px;line-height:1.35;max-height:3.7em;overflow:hidden}
 .tag{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;color:#fff}
 .tag.Kufar{background:var(--kufar)}.tag.Realt{background:var(--realt)}
 .act{margin-top:auto;display:flex;gap:8px;padding-top:6px}
 .act a{flex:1;text-align:center;text-decoration:none;font-size:13px;font-weight:600;padding:9px;border-radius:8px;border:1px solid var(--line);color:var(--text)}
 .act a.call{background:var(--accent);color:#fff;border-color:transparent}
 .desc-t{font-size:13px;color:var(--kufar);cursor:pointer;user-select:none}
 .desc{font-size:13px;color:var(--muted);line-height:1.45;white-space:pre-line;margin-top:2px}
 .empty{color:var(--muted);text-align:center;padding:40px}
 .hint{font-size:12px;color:var(--muted);margin:12px 2px 0}
</style></head><body><div class="wrap">
<h1>🏠 Жильё на сутки — Kufar + Realt</h1>
<div class="bar">
  <div><label>Область</label><select id="region">
    <option value="any">Любая область</option>
    <option value="brest" selected>Брестская обл.</option>
    <option value="minsk">Минск (город)</option>
    <option value="minsk-obl">Минская обл.</option>
    <option value="gomel">Гомельская обл.</option>
    <option value="grodno">Гродненская обл.</option>
    <option value="vitebsk">Витебская обл.</option>
    <option value="mogilev">Могилёвская обл.</option>
  </select></div>
  <div><label>Город</label><select id="city"><option value="">любой</option></select></div>
  <div><label>Тип жилья</label><select id="type">
    <option value="flat">Квартира</option>
    <option value="cottage">Коттедж / дом</option>
    <option value="usadba">Усадьба</option>
  </select></div>
  <div><label>Комнат</label><select id="rooms"><option value="">любое</option><option>1</option><option selected>2</option><option value="3">3+</option></select></div>
  <div><label>Гостей</label><select id="guests"><option value="">любое</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option value="8">8+</option></select></div>
  <div><label>Цена до, BYN</label><input id="max" type="number" placeholder="без огранич."></div>
  <div><label>Источник</label><select id="source"><option value="both">Kufar + Realt</option><option value="kufar">Только Kufar</option><option value="realt">Только Realt</option></select></div>
  <div><label>Сортировка</label><select id="sort"><option value="price_asc">Дешёвые сверху</option><option value="price_desc">Дорогие сверху</option><option value="rating_desc">По рейтингу</option></select></div>
  <div><label>Заезд</label><input id="from" type="date"></div>
  <div><label>Выезд</label><input id="to" type="date"></div>
  <button class="go" id="go">Найти</button>
</div>
<div class="stat" id="stat"></div>
<div class="grid" id="grid"></div>
<p class="hint">Даты считают итог за все ночи (цена × ночей). Наличие на конкретные даты уточняйте у хозяина — площадки его не гарантируют. Усадьбы/коттеджи по Realt идут из раздела коттеджей.</p>
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
      const cap=x.capacity? (' · до '+x.capacity+' гостей'):'';
      const total=N? ('<div class="tot">'+(x.price*N)+' BYN за '+N+' ноч.</div>'):'';
      const call = x.phone ? '<a class="call" href="tel:+'+x.phone+'">'+fmtPhone(x.phone)+(x.name?(' · '+x.name):'')+'</a>' : '';
      const desc = x.descId ? '<div class="desc-t" onclick="showDesc('+idx+')" id="dt'+idx+'">Описание ▾</div><div class="desc" id="dd'+idx+'" style="display:none"></div>' : '';
      // рейтинг: 0..10 -> 5 звёзд, показываем только при отзывах
      let stars='';
      if(x.reviews>0 && x.rating>0){
        const s=Math.round(x.rating/2);
        stars='<div class="stars">'+'★'.repeat(s)+'☆'.repeat(5-s)+'<span class="num">'+x.rating.toFixed(1)+' · '+x.reviews+' отз.</span></div>';
      }
      // слайдер фото
      const ph=x.photos&&x.photos.length? x.photos : [];
      let slider;
      if(ph.length){
        const nav = ph.length>1
          ? '<button class="nav prev" onclick="slide('+idx+',-1)">‹</button><button class="nav next" onclick="slide('+idx+',1)">›</button><div class="cnt" id="cnt'+idx+'">1/'+ph.length+'</div>'
          : '';
        slider='<div class="slider"><img class="im" id="im'+idx+'" src="'+ph[0]+'" loading="lazy" alt="">'+nav+'</div>';
      } else {
        slider='<div class="slider"></div>';
      }
      return '<div class="card">'+slider
        +'<div class="bd">'
        +'<div><span class="tag '+x.src+'">'+x.src+'</span></div>'
        +'<div class="pr">'+x.price+' BYN<span class="meta"> / сутки</span></div>'+total+stars
        +'<div class="meta">'+(x.area||'')+' · '+x.rooms+'-комн'+cap+'</div>'
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
