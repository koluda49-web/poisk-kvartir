// Телефон хозяина с Realt закрыт до нажатия.
//
// Зачем. У карточек Realt сначала стоит кнопка «Показать телефон», и только
// после нажатия появляется ссылка tel:, по которой телефон набирает. Номер
// при этом лежит в data-ph — от посетителя он скрыт, но из разметки не убран.
// У Kufar и Flatbook номер как был открыт, так и остаётся: проверяем и это,
// чтобы правка не расползлась на другие площадки.
//
// Проверяем и сборку разметки, и живую выдачу: разметка ловит ошибку сразу,
// живая выдача — то, что кнопка действительно доезжает до посетителя.
//
// Сервер должен быть уже запущен: npm start, а в другом окне
//   node проверки/телефон.mjs
//   node проверки/телефон.mjs https://poisk-kvartir.onrender.com
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9463, sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new',
  `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--user-data-dir=' + process.env.TEMP + '/cdp-tel-' + process.pid,
  'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const n = ++id; pend.set(n, { res, rej });
  ws.send(JSON.stringify({ id: n, method: m, params: p }));
});
let url;
for (let i = 0; i < 40 && !url; i++) {
  try {
    const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
  if (!url) await sleep(500);
}
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    const p = pend.get(m.id); pend.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  }
});
await send('Page.enable'); await send('Runtime.enable');
const js = async e => (await send('Runtime.evaluate',
  { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (n, ok, d) => ok
  ? (passed++, console.log('  OK   ' + n))
  : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

await send('Page.navigate', { url: SITE + '/' });
for (let i = 0; i < 30; i++) {
  if (await js(`typeof кнопкаТелефона === 'function'`)) break;
  await sleep(500);
}

console.log('\nРазметка телефона');
check('сборщик телефона на странице есть', await js(`typeof кнопкаТелефона === 'function'`));
check('показать-телефон на странице есть', await js(`typeof показатьТелефон === 'function'`));

const реалт = await js(`кнопкаТелефона({src:'Realt',phone:'375291234567',name:'Иван'},'call')`);
check('у Realt вместо номера кнопка', /^<button/.test(реалт || ''), реалт);
check('в кнопке Realt нет tel:', !/tel:/.test(реалт || ''), реалт);
check('в видимом тексте номера нет', !/291234567/.test(String(реалт||'').replace(/<[^>]*>/g, '')), реалт);
check('надпись «Показать телефон»', /Показать телефон/.test(реалт || ''), реалт);

const куфар = await js(`кнопкаТелефона({src:'Kufar',phone:'375291234567',name:'Иван'},'call')`);
check('у Kufar номер открыт сразу', /^<a[^>]+href="tel:\+375291234567"/.test(куфар || ''), куфар);
check('у Kufar видно имя хозяина', /Иван/.test(куфар || ''), куфар);

check('пустой телефон ничего не рисует',
  (await js(`кнопкаТелефона({src:'Realt',phone:'',name:''},'call')`)) === '');

// Нажатие: кнопка должна превратиться в ссылку, по которой телефон набирает.
const после = await js(`(function(){
  const д=document.createElement('div');
  д.innerHTML=кнопкаТелефона({src:'Realt',phone:'375291234567',name:'Иван'},'call');
  document.body.appendChild(д);
  д.firstChild.click();
  const у=д.firstChild;
  const r={тег:у.tagName, href:у.getAttribute('href')||'', текст:у.textContent, класс:у.className};
  д.remove();
  return JSON.stringify(r);
})()`);
const п = JSON.parse(после || '{}');
console.log('\nПосле нажатия «Показать»');
check('на месте кнопки — ссылка', п.тег === 'A', п.тег);
check('ссылка звонит', п.href === 'tel:+375291234567', п.href);
check('виден отформатированный номер', /\+375 29 123-45-67/.test(п.текст || ''), п.текст);
check('видно имя хозяина', /Иван/.test(п.текст || ''), п.текст);
check('оформление кнопки сохранилось', /\bcall\b/.test(п.класс || '') && !/тел-скрыт/.test(п.класс || ''), п.класс);

// Окошко на карте собирается тем же сборщиком — с трубкой и своим классом.
const окно = await js(`кнопкаТелефона({src:'Realt',phone:'375291234567',name:''},'mp-call')`);
check('в окошке карты у Realt тоже кнопка', /^<button/.test(окно || '') && !/tel:/.test(окно || ''), окно);
check('в окошке карты класс mp-call', /class="mp-call/.test(окно || ''), окно);

// ── Живая выдача ─────────────────────────────────────────────────────────
console.log('\nЖивая выдача');
for (let i = 0; i < 60; i++) {
  if (await js(`document.querySelectorAll('#grid .card').length > 0`)) break;
  await sleep(1000);
}
await sleep(2500);

// Realt может не попасть на первую страницу — девятьсот объявлений, а на
// странице двадцать четыре. Перелистываем туда, где он есть, иначе проверка
// молча решит, что проверять нечего.
const страница = await js(`(function(){
  const все = window.__items || [];
  const i = все.findIndex(function(x){ return x.src === 'Realt' && x.phone; });
  if(i < 0) return 0;
  const с = Math.floor(i / 24) + 1;
  if(с !== window.__page) gotoPage(с);
  return с;
})()`);
if (страница) await sleep(800);

const живое = JSON.parse(await js(`JSON.stringify((function(){
  const карточки=[...document.querySelectorAll('#grid .card')];
  const реалт=карточки.filter(function(k){ const t=k.querySelector('.tag'); return t && /Realt/i.test(t.textContent); });
  return {
    всего: карточки.length,
    реалт: реалт.length,
    кнопок: реалт.filter(function(k){ return k.querySelector('button.call'); }).length,
    открытых: реалт.filter(function(k){ return k.querySelector('a.call'); }).length,
    чужихОткрытых: карточки.filter(function(k){
      const t=k.querySelector('.tag');
      return t && !/Realt/i.test(t.textContent) && k.querySelector('a.call');
    }).length
  };
})())`) || '{}');

if (!живое.реалт) {
  console.log('  — объявлений Realt сейчас в выдаче нет, живую часть пропускаю');
} else {
  check('ни одного открытого номера Realt в выдаче', живое.открытых === 0,
    'открытых ' + живое.открытых + ' из ' + живое.реалт);
  check('у карточек Realt стоит кнопка', живое.кнопок > 0,
    'кнопок ' + живое.кнопок + ' из ' + живое.реалт);
  // Kufar и Flatbook не трогали: если их номера тоже закрылись, значит
  // условие по площадке где-то потерялось.
  if (живое.всего > живое.реалт)
    check('у других площадок номер по-прежнему открыт', живое.чужихОткрытых > 0,
      'открытых у не-Realt: ' + живое.чужихОткрытых);
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
