// Свои снимки точек, привязанные по номеру: «5069 Название.jpg», «5069 Название 2.jpg».
//
// Зачем. Раньше снимок из «фото-точек» находил точку по названию, а
// одинаковых названий в справочнике много: «Костёл святого Казимира» из
// Липнишек уехал бы и в Ружаны. Проверяем, что снимок с номером достаётся
// ровно своей точке, что своих снимков может быть несколько и они идут
// первыми (обложка — без номера на конце), что старая привязка по имени
// не сломалась, и что в самих файлах нет EXIF — там бывают координаты и
// данные телефона владельца. Без браузера.
//
// Сервер должен быть запущен.
//   node проверки/фото-точек.mjs
//   node проверки/фото-точек.mjs http://127.0.0.1:8095
import { readdirSync, readFileSync, statSync } from 'node:fs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const ПАПКА = new URL('../фото-точек/', import.meta.url);

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const json = async p => (await fetch(SITE + p)).json();
const свой = u => String(u || '').startsWith('/фото-точек/');
const кратко = a => (a || []).map(u => decodeURIComponent(String(u)).split('/').pop()).slice(0, 5).join(' | ');

// ── описание точки: свои снимки первыми ─────────────────────────────────
console.log('=== /api/place ===');
const d5069 = await json('/api/place?id=5069');
const p5069 = d5069.pics || [];
check('5069 (Липнишки): первые 2 снимка свои, с номером 5069',
      p5069.slice(0, 2).every(u => u.startsWith('/фото-точек/5069 ')) && p5069.length >= 2, кратко(p5069));
check('5069: обложка — снимок без номера на конце, второй — «… 2»',
      /Липнишки\.jpg$/.test(p5069[0] || '') && / 2\.jpg$/.test(p5069[1] || ''), кратко(p5069));
check('5069: третьего своего нет, дальше снимки kudin.by',
      p5069.slice(2).every(u => !свой(u)) && p5069.slice(2).some(u => /kudin\.by/.test(u)), кратко(p5069));
check('5069: снимки без повторов', new Set(p5069).size === p5069.length);

const d4820 = await json('/api/place?id=4820');
// Проверка «своих нет» ничего не стоит, если точки или снимков нет вовсе, — сперва убеждаемся, что они есть.
check('4820 (Ружаны, тоже св. Казимира): описание со снимками есть, своих среди них нет',
      d4820.id === 4820 && (d4820.pics || []).length > 0 && d4820.pics.every(u => !свой(u)), кратко(d4820.pics));

const p5068 = (await json('/api/place?id=5068')).pics || [];
check('5068 (Жирмуны): 3 своих первыми, по порядку',
      p5068.slice(0, 3).every(u => u.startsWith('/фото-точек/5068 '))
      && !свой(p5068[3]) && / 2\.jpg$/.test(p5068[1] || '') && / 3\.jpg$/.test(p5068[2] || ''), кратко(p5068));

// ── новые места ─────────────────────────────────────────────────────────
console.log('\n=== новые места 910030–910033 ===');
const новые = { 910030: 'Германишки', 910031: 'Усадьба Вольских', 910032: 'часовня', 910033: 'Брама' };
const своих = { 910030: 3, 910031: 2, 910032: 1, 910033: 1 };
for (const [id, q] of Object.entries(новые)) {
  const r = await json('/api/places?q=' + encodeURIComponent(q));
  const p = (r.items || []).find(x => String(x.id) === id);
  check(id + ' находится по «' + q + '»', !!p, (r.items || []).slice(0, 3).map(x => x.name).join('; '));
  check(id + ': обложка своя (/фото-точек/' + id + ' …)', !!p && String(p.pic).startsWith('/фото-точек/' + id + ' '), p && p.pic);
  const pics = (await json('/api/place?id=' + id)).pics || [];
  check(id + ': в описании ' + своих[id] + ' своих снимков', pics.length === своих[id] && pics.every(u => u.startsWith('/фото-точек/' + id + ' ')), кратко(pics));
}
for (const [id, n] of [[910029, 2], [910027, 1], [910026, 2]]) {
  const pics = (await json('/api/place?id=' + id)).pics || [];
  check(id + ': ' + n + ' своих снимка по номеру', pics.filter(u => u.startsWith('/фото-точек/' + id + ' ')).length === n, кратко(pics));
}

// ── костёл в Гольшанах: снимки владельца и поиск ────────────────────────
console.log('\n=== 910034 (Гольшаны) ===');
const p910034 = (await json('/api/place?id=910034')).pics || [];
check('910034: в описании 2 своих снимка, обложка — общий вид (без номера), второй — «… 2»',
      p910034.length === 2 && p910034.every(u => u.startsWith('/фото-точек/910034 '))
      && /Гольшаны\.jpg$/.test(p910034[0]) && / 2\.jpg$/.test(p910034[1]), кратко(p910034));
// «церковь Иоанна» — так место назвал владелец; в названии «Костёл», слово есть в alt
for (const q of ['Гольшаны', 'Иоанна Крестителя', 'церковь Иоанна']) {
  const r = await json('/api/places?q=' + encodeURIComponent(q));
  const p = (r.items || []).find(x => x.id === 910034);
  check('910034 находится по «' + q + '»', !!p && String(p.pic).startsWith('/фото-точек/910034 '),
        (r.items || []).slice(0, 3).map(x => x.name + ' ' + x.pic).join('; '));
}
const стр910034 = await fetch(SITE + '/mesto/910034');
const html910034 = await стр910034.text();
check('/mesto/910034 — 200, название и 2 своих кадра', стр910034.status === 200
      && html910034.includes('Костёл Святого Иоанна Крестителя (Гольшаны)')
      && [...html910034.matchAll(/<img class="hero[^"]*"\s+(?:src|data-src)="([^"]+)"/g)].filter(m => m[1].startsWith('/фото-точек/910034 ')).length === 2,
      String(стр910034.status));

// ── Жиличи, Понемунь (снимки с Commons с подписью) и Ишкольдь ─────────────
console.log('\n=== 910035, 910036, 4851 ===');
for (const [id, имя, запросы, лиц] of [
  [910035, 'Жиличский исторический комплекс-музей (дворец Булгаков)', ['Жиличи', 'дворец Булгаков', 'Добосна'], 'CC BY 2.0'],
  [910036, 'Усадьба Понемунь (Гродно)', ['Понемунь', 'Панямонь', 'усадьба Ляхницких'], 'CC BY-SA 3.0'],
]) {
  const д = await json('/api/place?id=' + id);
  check(id + ': описание и снимок с Commons', (д.pics || []).some(u => u.startsWith('https://thumb.wikimedia.org/'))
        && String(д.text || '').length > 100 && д.cred && д.cred.lic === лиц && String(д.more || '').startsWith('https://commons.wikimedia.org/wiki/File:'), JSON.stringify(д).slice(0, 200));
  for (const q of запросы) {
    const r = await json('/api/places?q=' + encodeURIComponent(q));
    check(id + ' находится по «' + q + '»', (r.items || []).some(x => x.id === id && x.name === имя && x.alt === undefined));
  }
  const с = await fetch(SITE + '/mesto/' + id); const h = await с.text();
  check('/mesto/' + id + ' — 200, название и лицензия снимка', с.status === 200 && h.includes(имя) && h.includes(лиц), String(с.status));
}
const r4851 = await json('/api/places?q=' + encodeURIComponent('Ишкольд'));
check('4851 называется «Костёл Святой Троицы (Ишкольдь)» и находится по «Ишкольд»',
      (r4851.items || []).some(x => x.id === 4851 && x.name === 'Костёл Святой Троицы (Ишкольдь)'),
      (r4851.items || []).slice(0, 3).map(x => x.id + ' ' + x.name).join('; '));
const д4851 = await json('/api/place?id=4851');
check('4851: своё описание про 1449 год, снимки kudin остались', /1449/.test(д4851.text || '') && (д4851.pics || []).length > 0, (д4851.text || '').slice(0, 80));

// ── страница места: слайдер ─────────────────────────────────────────────
console.log('\n=== /mesto ===');
const стр = await fetch(SITE + '/mesto/910030');
const html = await стр.text();
const кадры = [...html.matchAll(/<img class="hero[^"]*"\s+(?:src|data-src)="([^"]+)"/g)].map(m => m[1]);
check('/mesto/910030 — 200', стр.status === 200, String(стр.status));
check('/mesto/910030: в слайдере 3 снимка, все свои, счётчик «1/3»', кадры.length === 3 && кадры.every(свой) && html.includes('id="phn">1/3<'), кратко(кадры));
const html5069 = await (await fetch(SITE + '/mesto/5069')).text();
const к5069 = [...html5069.matchAll(/<img class="hero[^"]*"\s+(?:src|data-src)="([^"]+)"/g)].map(m => m[1]);
check('/mesto/5069: первые два кадра свои, дальше kudin.by',
      к5069.slice(0, 2).every(u => u.startsWith('/фото-точек/5069 ')) && к5069.slice(2).every(u => !свой(u)), кратко(к5069));

// файл отдаётся по адресу из страницы
const адрес = кадры[1] ? кадры[1].replace(/&amp;/g, '&') : '';
const файл = адрес ? await fetch(SITE + encodeURI(адрес)) : null;
check('второй снимок 910030 отдаётся как image/jpeg',
      !!файл && файл.status === 200 && /image\/jpeg/.test(файл.headers.get('content-type') || ''), файл && файл.status);

// ── облегчённый список и старая привязка по имени ───────────────────────
console.log('\n=== /api/places ===');
const все = await json('/api/places');
const по = id => (все.items || []).find(x => String(x.id) === String(id));
const lite = await json('/api/places?light=1');
check('в облегчённом списке есть 5069 и новые места',
      [5069, 910030, 910031, 910032, 910033, 910034].every(id => (lite.items || []).some(x => x.id === id)));
const поиск5069 = await json('/api/places?q=' + encodeURIComponent('Липнишки'));
const т5069 = (поиск5069.items || []).find(x => x.id === 5069) || по(5069);
check('у 5069 обложка своя (pic)', !!т5069 && String(т5069.pic).startsWith('/фото-точек/5069 '), т5069 && т5069.pic);
const т4820 = ((await json('/api/places?q=' + encodeURIComponent('Ружаны'))).items || []).find(x => x.id === 4820) || по(4820);
check('у 4820 (Ружаны) обложка есть и она не своя', !!т4820 && !!т4820.pic && !свой(т4820.pic), т4820 && т4820.pic);
const немново = ((await json('/api/places?q=' + encodeURIComponent('Немново'))).items || []).find(x => x.id === 910023);
check('шлюз «Немново» — по-прежнему nemnovo.jpg', !!немново && немново.pic === '/фото-точек/nemnovo.jpg', немново && немново.pic);
const версаль = ((await json('/api/places?q=' + encodeURIComponent('Версаль'))).items || []).find(x => x.id === 910025);
check('«Версаль» — по-прежнему «Парк-отель Версаль.jpg» (по имени)', !!версаль && версаль.pic === '/фото-точек/Парк-отель Версаль.jpg', версаль && версаль.pic);

// ── сами файлы ──────────────────────────────────────────────────────────
console.log('\n=== файлы в фото-точек ===');
const сНомером = readdirSync(ПАПКА).filter(f => /^\d+ .+\.jpg$/i.test(f));
// Владелец добавляет снимки — число только растёт, поэтому «не меньше».
check('файлов с номером точки не меньше 17', сНомером.length >= 17, String(сНомером.length));
check('имена проходят проверку адреса (без «», запятых)',
      сНомером.every(f => /^[0-9A-Za-zА-Яа-яЁё _.()-]+\.(jpg|jpeg|png|webp)$/.test(f)), сНомером.filter(f => !/^[0-9A-Za-zА-Яа-яЁё _.()-]+\.jpg$/.test(f)).join('; '));
// Размер JPEG — из маркера SOF: длинная сторона не больше 1600.
function размеры(buf) {
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [0, 0];
}
const плохие = [];
for (const f of сНомером) {
  const buf = readFileSync(new URL(encodeURIComponent(f), ПАПКА));
  const [w, h] = размеры(buf);
  const кб = statSync(new URL(encodeURIComponent(f), ПАПКА)).size / 1024;
  if (кб > 450 || Math.max(w, h) > 1600 || !w || buf.includes(Buffer.from('Exif')))
    плохие.push(f + ' (' + Math.round(кб) + ' КБ, ' + w + '×' + h + (buf.includes(Buffer.from('Exif')) ? ', EXIF' : '') + ')');
}
check('каждый файл ≤ 450 КБ, ≤ 1600 px и без EXIF', плохие.length === 0, плохие.join('; '));

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
