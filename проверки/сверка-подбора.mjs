// Сплошная сверка по ВСЕМ точкам: сравниваем подбор сайта с честным счётом.
// Честный счёт: тянем всё жильё страны с точными координатами и отбираем
// по настоящему расстоянию до точки. Никаких выборок — все 798.
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const OUT = process.argv[3] || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const json = async (p) => {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(BASE + p); const d = await r.json(); if (d) return d; } catch (e) {}
    await sleep(1500);
  }
  return null;
};

const ОБЛАСТИ = ['minsk', 'minsk-obl', 'brest', 'gomel', 'grodno', 'vitebsk', 'mogilev'];
const ВИДЫ = ['flat', 'usadba', 'cottage'];
const ГОРОДА = ['Барановичи','Пинск','Кобрин','Борисов','Солигорск','Молодечно','Жодино','Слуцк',
  'Мозырь','Жлобин','Речица','Светлогорск','Лида','Слоним','Волковыск','Новогрудок','Ошмяны',
  'Орша','Полоцк','Новополоцк','Бобруйск','Горки','Осиповичи'];

function км(a1, o1, a2, o2) {
  const t = Math.PI / 180;
  const x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// ── честный счёт: всё, что вообще можно достать ───────────────────────────
console.log('Собираю всё жильё страны (области + крупные города)…');
const всё = [], было = new Set();
const добавить = (items) => (items || []).forEach(x => {
  if (!x.lat || !x.lng || x.approx || было.has(x.link)) return;
  было.add(x.link); всё.push(x);
});
for (const r of ОБЛАСТИ) {
  for (const t of ВИДЫ) {
    добавить(((await json('/api/search?' + new URLSearchParams({ region: r, city: '', type: t,
      rooms: '', guests: '', max: '', source: 'both' }).toString())) || {}).items);
  }
}
console.log('  по областям:', всё.length);
for (const c of ГОРОДА) {
  for (const t of ВИДЫ) {
    for (const r of ОБЛАСТИ) {
      const d = await json('/api/search?' + new URLSearchParams({ region: r, city: c, type: t,
        rooms: '', guests: '', max: '', source: 'both' }).toString());
      if (d && d.total) { добавить(d.items); break; }   // город лежит в одной области
    }
  }
}
console.log('  с городами:', всё.length);

// ── обход всех точек ──────────────────────────────────────────────────────
const точки = ((await json('/api/places?light=1')) || {}).items || [];
console.log('точек:', точки.length);

const потери = [], пусто = [], лишние = [];
let сделано = 0, ровно = 0;
const ПОТОКОВ = 5;

async function работник(куски) {
  for (const p of куски) {
    const d = await json('/api/places/stay?lat=' + p.lat + '&lng=' + p.lng + '&r=30');
    сделано++;
    if (сделано % 150 === 0) console.log('  пройдено', сделано, 'из', точки.length);
    const наш = (d && d.total) || 0;
    const честно = всё.filter(x => км(p.lat, p.lng, x.lat, x.lng) <= 30).length;
    if (наш < честно) потери.push({ id: p.id, name: p.name, addr: p.addr, наш, честно });
    else ровно++;
    if (!наш && !честно) пусто.push({ id: p.id, name: p.name, addr: p.addr });
    // проверяем и обратное: не показываем ли то, что дальше 30 км
    if (d && (d.items || []).some(x => x.km > 30.05)) лишние.push({ id: p.id, name: p.name });
  }
}

const куски = Array.from({ length: ПОТОКОВ }, (_, i) => точки.filter((_, n) => n % ПОТОКОВ === i));
await Promise.all(куски.map(работник));

console.log('\n================ ИТОГ ================');
console.log('всё жильё страны с точными координатами:', всё.length);
console.log('точек проверено:', точки.length);
console.log('нашли столько же или больше, чем есть:', ровно);
console.log('НАШЛИ МЕНЬШЕ, ЧЕМ ЕСТЬ:', потери.length);
console.log('показали то, что дальше 30 км:', лишние.length);
console.log('рядом действительно ничего нет:', пусто.length);

if (потери.length) {
  console.log('\n--- где теряем (худшие 30) ---');
  потери.sort((a, b) => (b.честно - b.наш) - (a.честно - a.наш));
  потери.slice(0, 30).forEach(x => console.log('  ', (x.name || '').slice(0, 34).padEnd(36),
    (x.addr || '').slice(0, 30).padEnd(32), 'наш:', String(x.наш).padStart(4), ' есть:', String(x.честно).padStart(4)));
}
if (лишние.length) {
  console.log('\n--- показали лишнее ---');
  лишние.slice(0, 10).forEach(x => console.log('  ', x.id, x.name));
}
if (OUT) { writeFileSync(OUT, JSON.stringify({ потери, лишние, пусто }, null, 1)); console.log('\nподробности:', OUT); }
process.exitCode = (потери.length || лишние.length) ? 1 : 0;
