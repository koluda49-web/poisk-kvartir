// Проверяем в настоящем браузере, что кнопка наверху доводит до формы связи.
// В панели предпросмотра прокрутка окна не работает вовсе, поэтому смотрим
// через отдельный Chrome.
import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9371, sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--user-data-dir=' + process.env.TEMP + '/cdp-scr-' + process.pid, 'about:blank',
], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!url) await sleep(500);
}
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let ok = 0, плохо = 0;
const check = (имя, усл, деталь) => { if (усл) { ok++; console.log('  OK   ' + имя); } else { плохо++; console.log('  ПАДАЕТ ' + имя + (деталь ? ('  — ' + деталь) : '')); } };

await send('Page.navigate', { url: SITE + '/' });
for (let i = 0; i < 60; i++) { if (await js('!!document.getElementById("knizu")')) break; await sleep(500); }
await sleep(3500);

check('кнопка наверху есть', await js('!!document.getElementById("knizu")'));
check('кнопка видна', await js('(function(){var r=document.getElementById("knizu").getBoundingClientRect();return r.width>50&&r.height>10;})()'));
check('кнопка выше формы связи',
      await js('document.getElementById("knizu").getBoundingClientRect().top < document.getElementById("foot").getBoundingClientRect().top'));

const до = await js('Math.round(window.scrollY)');
await js('document.getElementById("knizu").click(); 1');
await sleep(2500);
const после = await js('Math.round(window.scrollY)');
const видно = await js('(function(){var r=document.getElementById("foot").getBoundingClientRect();return r.top>-200&&r.top<window.innerHeight;})()');
check('после нажатия страница прокрутилась (' + до + ' → ' + после + ')', после > до + 200,
      'кнопка никуда не ведёт');
check('форма связи оказалась на экране', видно, 'прокрутило, но не туда');

const текст = await js('(document.getElementById("foot")||{}).textContent||""');
check('в блоке есть обращение к владельцам жилья', /Сдаёте жильё/.test(текст));
check('сказано, что размещать надо на площадках', /Kufar/.test(текст) && /Flatbook/.test(текст));
check('обещания «разместите у нас» нет', !/разместите у нас|разместить у нас объявление/i.test(текст));

console.log('\nИтог: успешно ' + ok + ', провалено ' + плохо);
ws.close(); chrome.kill(); process.exit(плохо ? 1 : 0);
