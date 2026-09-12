// Будильник и постоянное хранилище.
//
// Зачем. Бесплатный Render засыпает без запросов, а расписание GitHub
// опаздывает на часы — сервер должен будить себя сам. И его диск временный:
// всё записанное пропадает при перезапуске, поэтому копии данных уходят
// в репозиторий. Проверяем оба механизма без браузера и без настоящего
// GitHub: поднимаем его подделку и отдельный экземпляр сервера на 8097.
//
// Запуск (свой сервер поднимается сам, рабочий на 8080 не трогается):
//   node проверки/будильник-и-хранилище.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const САЙТ = 'http://127.0.0.1:8097', МОК_ПОРТ = 9612;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// ── подделка GitHub: запоминает запросы; GET — 404 в первый раз, дальше sha ──
const запросы = [];
let getов = 0;
const мок = http.createServer((req, res) => {
  let тело = '';
  req.on('data', c => тело += c);
  req.on('end', () => {
    запросы.push({ method: req.method, url: req.url, headers: req.headers, тело });
    if (req.method === 'GET') {
      if (getов++ === 0) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sha":"abc"}'); }
    } else if (req.method === 'PUT') {
      res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"content":{"sha":"def"}}');
    } else { res.writeHead(405); res.end(); }
  });
});
await new Promise(r => мок.listen(МОК_ПОРТ, '127.0.0.1', r));

// ── свой экземпляр сервера ───────────────────────────────────────────────
const папка = fs.mkdtempSync(path.join(os.tmpdir(), 'данные-проверка-'));
const лог = [];
const сервер = spawn(process.execPath, ['kvartiry-server.js'], {
  cwd: КОРЕНЬ,
  env: { ...process.env, PORT: '8097', RENDER_EXTERNAL_URL: САЙТ, SELF_PING_MS: '1500',
         DATA_DIR: папка, GH_TOKEN: 'test', GH_API: 'http://127.0.0.1:' + МОК_ПОРТ, GH_SYNC_MS: '500',
         DATA_TEST: '1', STATS_FILE: path.join(папка, 'stats.json'),
         KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
сервер.stdout.on('data', d => лог.push(String(d)));
сервер.stderr.on('data', d => лог.push(String(d)));

let второй = null;
async function завершить(код) {
  for (const п of [сервер, второй]) {
    if (!п) continue;
    try { if (п.exitCode === null) п.kill(); } catch {}   // kill() бьёт ровно по child.pid
    await new Promise(r => { if (п.exitCode !== null) r(); else { п.once('exit', r); setTimeout(r, 3000); } });
  }
  await new Promise(r => мок.close(r));
  try { fs.rmSync(папка, { recursive: true, force: true }); } catch {}
  process.exit(код);
}

try {
  let готов = false;
  for (let i = 0; i < 120 && !готов; i++) {
    try { готов = (await fetch(САЙТ + '/ping', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
    if (!готов) await sleep(500);
  }
  check('сервер на 8097 отвечает на /ping', готов, лог.join('').slice(-300));
  if (!готов) throw new Error('сервер не поднялся');

  // ── будильник ──────────────────────────────────────────────────────────
  await sleep(5000);
  const стат = await (await fetch(САЙТ + '/stats?key=poisk2026')).text();
  const удачных = +((стат.match(/Удачных пингов<\/div><div class="val">(\d+)/) || [])[1] || 0);
  check('за 5 с будильник достучался хотя бы дважды', удачных >= 2, 'удачных: ' + удачных);
  check('на /stats карточка «Будильник» и он включён', /<h2>Будильник<\/h2>/.test(стат) && /Будильник<\/div><div class="val">включён/.test(стат));
  check('на /stats карточка «Постоянное хранилище», отправка включена',
    /<h2>Постоянное хранилище<\/h2>/.test(стат) && /Отправка в GitHub<\/div><div class="val">включена/.test(стат));

  // ── хранилище ──────────────────────────────────────────────────────────
  const объект = { привет: 'мир', числа: [1, 2, 3], вложено: { да: true } };
  const пишем = async (имя, об) => fetch(САЙТ + '/api/_data-test', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ имя, объект: об }) });
  const r1 = await пишем('проверка', объект);
  check('служебная запись принята', r1.ok, 'ответ ' + r1.status);
  const файл = path.join(папка, 'проверка.json');
  let локально = null;
  try { локально = JSON.parse(fs.readFileSync(файл, 'utf8')); } catch {}
  check('локальный файл появился сразу', JSON.stringify(локально) === JSON.stringify(объект), JSON.stringify(локально));
  check('имя с косой чертой не принимается', (await пишем('../взлом', { a: 1 })).status === 400);

  const путь = '/repos/koluda49-web/poisk-kvartir/contents/' + encodeURIComponent('данные') + '/' + encodeURIComponent('проверка.json');
  const ждатьPUT = async (n) => { for (let i = 0; i < 40; i++) { if (запросы.filter(q => q.method === 'PUT').length >= n) return true; await sleep(250); } return false; };
  check('подделка GitHub получила PUT', await ждатьPUT(1));
  const put1 = запросы.find(q => q.method === 'PUT');
  const get1 = запросы.find(q => q.method === 'GET');
  check('перед PUT был GET за sha по тому же пути', !!get1 && get1.url.split('?')[0] === путь && запросы.indexOf(get1) < запросы.indexOf(put1), get1 && get1.url);
  check('PUT по правильному пути', !!put1 && put1.url === путь, put1 && put1.url);
  let т1 = {};
  try { т1 = JSON.parse(put1.тело); } catch {}
  check('в сообщении коммита [skip render]', /\[skip render\]/.test(т1.message || '') && /^данные: проверка/.test(т1.message || ''), т1.message);
  check('ветка main', т1.branch === 'main', т1.branch);
  let раскодировано = null;
  try { раскодировано = JSON.parse(Buffer.from(т1.content || '', 'base64').toString('utf8')); } catch {}
  check('содержимое раскодируется в тот же объект', JSON.stringify(раскодировано) === JSON.stringify(объект), JSON.stringify(раскодировано));
  check('первый раз без sha (файла не было)', т1.sha === undefined, т1.sha);
  check('заголовки: Bearer, User-Agent, Accept',
    put1.headers.authorization === 'Bearer test' && !!put1.headers['user-agent'] && put1.headers.accept === 'application/vnd.github+json');

  // Несколько записей подряд — одна отправка с последним содержимым.
  await sleep(700);
  const до = запросы.filter(q => q.method === 'PUT').length;
  await пишем('проверка', { шаг: 1 });
  await пишем('проверка', { шаг: 2 });
  await пишем('проверка', { шаг: 3 });
  await ждатьPUT(до + 1);
  await sleep(1200);
  const новые = запросы.filter(q => q.method === 'PUT').slice(до);
  let т2 = {};
  try { т2 = JSON.parse(новые[0].тело); } catch {}
  check('три записи подряд ушли одной отправкой', новые.length === 1, 'PUT: ' + новые.length);
  check('ушло последнее содержимое', JSON.stringify(JSON.parse(Buffer.from(т2.content || '', 'base64').toString('utf8') || 'null')) === '{"шаг":3}');
  check('второй раз с sha из GET', т2.sha === 'abc', т2.sha);

  const стат2 = await (await fetch(САЙТ + '/stats?key=poisk2026')).text();
  check('на /stats видна удачная отправка', /Удачных отправок<\/div><div class="val">[1-9]/.test(стат2));
  // Строку про «../взлом» проверка вызвала сама — её не считаем.
  const ошибкиЛога = лог.join('').split('\n').filter(с => /Хранилище:|Будильник:/.test(с) && !/недопустимое имя/.test(с));
  check('в логе сервера нет ошибок хранилища и будильника', ошибкиЛога.length === 0, ошибкиЛога[0]);

  // ── при выходе отложенное уходит сразу ────────────────────────────────
  // В Windows настоящий SIGTERM обработчик не получает — процесс просто
  // убивается. Поэтому второй экземпляр получает через IPC команду и сам
  // вызывает свои обработчики сигнала (process.emit), как это сделал бы Render.
  сервер.kill();
  await new Promise(r => { if (сервер.exitCode !== null) r(); else { сервер.once('exit', r); setTimeout(r, 3000); } });
  const предзагрузка = path.join(папка, 'сигнал.cjs');
  fs.writeFileSync(предзагрузка, "process.on('message', m => { if (m === 'SIGTERM') process.emit('SIGTERM', 'SIGTERM'); });\n");
  const сервер2 = spawn(process.execPath, ['-r', предзагрузка, 'kvartiry-server.js'], {
    cwd: КОРЕНЬ,
    env: { ...process.env, PORT: '8097', DATA_DIR: папка, GH_TOKEN: 'test', GH_API: 'http://127.0.0.1:' + МОК_ПОРТ,
           GH_SYNC_MS: '600000', DATA_TEST: '1', STATS_FILE: path.join(папка, 'stats.json'),
           RENDER_EXTERNAL_URL: '', KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  второй = сервер2;
  let готов2 = false;
  for (let i = 0; i < 120 && !готов2; i++) {
    try { готов2 = (await fetch(САЙТ + '/ping', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
    if (!готов2) await sleep(500);
  }
  check('второй экземпляр поднялся', готов2);
  const стат3 = await (await fetch(САЙТ + '/stats?key=poisk2026')).text();
  check('без RENDER_EXTERNAL_URL будильник выключен', /Будильник<\/div><div class="val">выключен/.test(стат3));
  const доВыхода = запросы.filter(q => q.method === 'PUT').length;
  await пишем('при-выходе', { последнее: true });
  await sleep(500);
  check('с окном 10 минут сразу ничего не уходит', запросы.filter(q => q.method === 'PUT').length === доВыхода);
  const вышел = new Promise(r => сервер2.once('exit', () => r(Date.now())));
  const т0 = Date.now();
  сервер2.send('SIGTERM');
  const когдаВышел = await Promise.race([вышел, sleep(12000).then(() => 0)]);
  const putВыход = запросы.filter(q => q.method === 'PUT').slice(доВыхода);
  check('по сигналу сервер вышел быстро (до 8 с)', когдаВышел && когдаВышел - т0 < 8500, когдаВышел ? (когдаВышел - т0) + ' мс' : 'не вышел');
  check('перед выходом отложенное ушло в GitHub', putВыход.length === 1 && /при-выходе/.test(decodeURIComponent(putВыход[0].url)), 'PUT: ' + putВыход.length);
} catch (e) {
  check('проверка дошла до конца', false, e.message);
}

console.log('\nПройдено ' + passed + ', падает ' + failed);
await завершить(failed ? 1 : 0);
