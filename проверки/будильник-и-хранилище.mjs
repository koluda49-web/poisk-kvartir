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

// ── подделка GitHub: запоминает запросы ──────────────────────────────────
// Файлы из В_GITHUB отдаются с содержимым (один — только когда проверка
// «откроет ворота»: так видно, что запись до загрузки не уходит раньше неё).
// Остальные пути: GET — 404 в первый раз, дальше {sha:"abc"}; PUT — 201.
const запросы = [];
const путьК = имя => '/repos/koluda49-web/poisk-kvartir/contents/' + encodeURIComponent('данные') + '/' + encodeURIComponent(имя + '.json');
let открытьВорота; const ворота = new Promise(r => открытьВорота = r);
let починитьGitHub = false;   // пока false, «сбой» отвечает 500
const В_GITHUB = {
  [путьК('из-github')]: { sha: 'gh1', объект: { источник: 'github', версия: 2 } },
  [путьК('слияние')]:   { sha: 'gh2', объект: { источник: 'github', счёт: 5 }, ждать: ворота },
};
const виделиGET = new Set();
const мок = http.createServer((req, res) => {
  let тело = '';
  req.on('data', c => тело += c);
  req.on('end', async () => {
    запросы.push({ method: req.method, url: req.url, headers: req.headers, тело });
    const путь = req.url.split('?')[0];
    if (req.method === 'GET' && путь === путьК('сбой')) {
      if (!починитьGitHub) { res.writeHead(500); res.end('{"message":"Server Error"}'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha: 'gh3', encoding: 'base64', content: Buffer.from('{"источник":"github","после":"сбоя"}').toString('base64') })); }
    } else if (req.method === 'GET' && В_GITHUB[путь]) {
      const ф = В_GITHUB[путь];
      if (ф.ждать) await ф.ждать;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // как настоящий GitHub: base64 с переводами строк
      res.end(JSON.stringify({ sha: ф.sha, encoding: 'base64',
        content: Buffer.from(JSON.stringify(ф.объект)).toString('base64').replace(/.{20}/g, '$&\n') }));
    } else if (req.method === 'GET') {
      if (!виделиGET.has(путь)) { виделиGET.add(путь); res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sha":"abc"}'); }
    } else if (req.method === 'PUT') {
      res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"content":{"sha":"def"}}');
    } else { res.writeHead(405); res.end(); }
  });
});
await new Promise(r => мок.listen(МОК_ПОРТ, '127.0.0.1', r));

// ── свой экземпляр сервера ───────────────────────────────────────────────
const папка = fs.mkdtempSync(path.join(os.tmpdir(), 'данные-проверка-'));
// Устаревшие местные копии — как файлы, пришедшие с кодом развёртывания.
const записатьМестное = (имя, об) => fs.writeFileSync(path.join(папка, имя + '.json'), JSON.stringify(об));
записатьМестное('из-github', { источник: 'локальный', старое: true });
записатьМестное('слияние', { источник: 'локальный' });
записатьМестное('нет-в-github', { источник: 'локальный', только: 'здесь' });
записатьМестное('сбой', { источник: 'локальный' });
const лог = [];
const сервер = spawn(process.execPath, ['kvartiry-server.js'], {
  cwd: КОРЕНЬ,
  env: { ...process.env, PORT: '8097', RENDER_EXTERNAL_URL: САЙТ, SELF_PING_MS: '1500',
         DATA_DIR: папка, GH_TOKEN: 'test', GH_API: 'http://127.0.0.1:' + МОК_ПОРТ, GH_SYNC_MS: '500',
         DATA_TEST: '1', DATA_TEST_NAMES: 'из-github,слияние,нет-в-github,сбой', STATS_FILE: path.join(папка, 'stats.json'),
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

  const пишем = async (имя, об) => fetch(САЙТ + '/api/_data-test', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ имя, объект: об }) });
  const читаем = async имя => (await (await fetch(САЙТ + '/api/_data-test?имя=' + encodeURIComponent(имя))).json()).объект;
  const файлом = имя => { try { return JSON.parse(fs.readFileSync(path.join(папка, имя + '.json'), 'utf8')); } catch { return null; } };
  const ровно = о => (о && typeof о === 'object' && !Array.isArray(о)) ? '{' + Object.keys(о).sort().map(к => JSON.stringify(к) + ':' + ровно(о[к])).join(',') + '}' : JSON.stringify(о);
  const same = (а, б) => ровно(а) === ровно(б);
  const дождаться = async (fn, ms = 10000) => { for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await sleep(100); } return false; };
  const запросыК = (метод, имя) => запросы.filter(q => q.method === метод && q.url.split('?')[0] === путьК(имя));

  // ── загрузка из GitHub при запуске ─────────────────────────────────────
  const изGH = { источник: 'github', версия: 2 };
  check('при запуске в памяти копия из GitHub, а не старый файл', await дождаться(async () => same(await читаем('из-github'), изGH)), JSON.stringify(await читаем('из-github')));
  check('старый местный файл заменён копией из GitHub', same(файлом('из-github'), изGH), JSON.stringify(файлом('из-github')));
  check('загрузка шла с ?ref=main', !!(запросыК('GET', 'из-github')[0] || { url: '' }).url.endsWith('?ref=main'));
  await дождаться(() => запросыК('GET', 'нет-в-github').length >= 1); await sleep(300);
  const толькоЗдесь = { источник: 'локальный', только: 'здесь' };
  check('файла нет в GitHub (404) — остаётся местная копия', same(await читаем('нет-в-github'), толькоЗдесь) && same(файлом('нет-в-github'), толькоЗдесь), JSON.stringify(await читаем('нет-в-github')));

  // «слияние»: подделка держит ответ, пока не откроем ворота
  check('загрузка «слияния» ещё не закончилась', запросыК('GET', 'слияние').length === 1);
  check('пока загрузка идёт, в памяти местная копия', same(await читаем('слияние'), { источник: 'локальный' }));
  const доЗагрузки = { источник: 'запись', своё: 'до загрузки' };
  const rз = await пишем('слияние', доЗагрузки);
  check('запись до загрузки легла в местный файл', rз.ok && same(файлом('слияние'), доЗагрузки));
  await sleep(1200);   // больше GH_SYNC_MS: будь отправка обычной, она бы уже ушла
  check('запись до загрузки не ушла в GitHub раньше загрузки', запросыК('PUT', 'слияние').length === 0, 'PUT: ' + запросыК('PUT', 'слияние').length);
  открытьВорота();
  const слито = { источник: 'github', счёт: 5, своё: 'до загрузки' };
  check('после загрузки в памяти слияние: GitHub + записанное до неё', await дождаться(async () => same(await читаем('слияние'), слито)), JSON.stringify(await читаем('слияние')));
  check('слитое записано в местный файл', same(файлом('слияние'), слито), JSON.stringify(файлом('слияние')));
  check('слитое ушло в GitHub', await дождаться(() => запросыК('PUT', 'слияние').length === 1));
  let тс = {};
  try { тс = JSON.parse(запросыК('PUT', 'слияние')[0].тело); } catch {}
  check('отправлено с sha из загрузки, без лишнего GET', тс.sha === 'gh2' && запросыК('GET', 'слияние').length === 1, 'sha ' + тс.sha + ', GET ' + запросыК('GET', 'слияние').length);
  let слитоВGH = null;
  try { слитоВGH = JSON.parse(Buffer.from(тс.content || '', 'base64').toString('utf8')); } catch {}
  check('в GitHub ушло именно слитое', same(слитоВGH, слито), JSON.stringify(слитоВGH));
  const основа = (await (await fetch(САЙТ + '/api/_data-test?имя=' + encodeURIComponent('слияние'))).json()).основа;
  check('соединить получил основу — местную копию при подключении', same(основа, { источник: 'локальный' }), JSON.stringify(основа));
  check('неизменённые копии обратно в GitHub не отправляются', запросыК('PUT', 'из-github').length === 0 && запросыК('PUT', 'нет-в-github').length === 0);
  check('на /stats видно: из GitHub загружено 2 файла', /Загружено из GitHub<\/div><div class="val">2</.test(await (await fetch(САЙТ + '/stats?key=poisk2026')).text()));

  // «сбой»: GitHub отвечает 500 — местная копия, одна строка в лог, записи ждут, загрузка повторяется
  check('GitHub сбоит — загрузка повторяется', await дождаться(() => запросыК('GET', 'сбой').length >= 3), 'GET: ' + запросыК('GET', 'сбой').length);
  check('при сбое в памяти местная копия', same(await читаем('сбой'), { источник: 'локальный' }));
  await пишем('сбой', { источник: 'запись', пока: 'сбоит' });
  await sleep(1200);
  check('при сбое запись в GitHub не уходит', запросыК('PUT', 'сбой').length === 0);
  const строкиСбоя = лог.join('').split('\n').filter(с => /не загрузилось сбой/.test(с));
  check('о сбое загрузки в логе одна строка', строкиСбоя.length === 1, 'строк: ' + строкиСбоя.length);
  починитьGitHub = true;
  const послеСбоя = { источник: 'github', после: 'сбоя', пока: 'сбоит' };
  check('GitHub ожил — данные загрузились и слились', await дождаться(async () => same(await читаем('сбой'), послеСбоя)), JSON.stringify(await читаем('сбой')));
  check('после сбоя слитое ушло с sha из загрузки', await дождаться(() => запросыК('PUT', 'сбой').length === 1) && JSON.parse(запросыК('PUT', 'сбой')[0].тело).sha === 'gh3');

  // ── будильник ──────────────────────────────────────────────────────────
  await sleep(5000);
  const стат = await (await fetch(САЙТ + '/stats?key=poisk2026')).text();
  const удачных = +((стат.match(/Удачных пингов<\/div><div class="val">(\d+)/) || [])[1] || 0);
  check('за 5 с будильник достучался хотя бы дважды', удачных >= 2, 'удачных: ' + удачных);
  check('на /stats карточка «Будильник» и он включён', /<h2>Будильник<\/h2>/.test(стат) && /Будильник<\/div><div class="val">включён/.test(стат));
  check('на /stats карточка «Постоянное хранилище», отправка включена',
    /<h2>Постоянное хранилище<\/h2>/.test(стат) && /Отправка в GitHub<\/div><div class="val">включена/.test(стат));

  // ── запись без подключения ─────────────────────────────────────────────
  const объект = { привет: 'мир', числа: [1, 2, 3], вложено: { да: true } };
  const r1 = await пишем('проверка', объект);
  check('служебная запись принята', r1.ok, 'ответ ' + r1.status);
  check('локальный файл появился сразу', same(файлом('проверка'), объект), JSON.stringify(файлом('проверка')));
  check('имя с косой чертой не принимается', (await пишем('../взлом', { a: 1 })).status === 400);

  const путь = путьК('проверка');
  check('подделка GitHub получила PUT', await дождаться(() => запросыК('PUT', 'проверка').length >= 1));
  const put1 = запросыК('PUT', 'проверка')[0] || { headers: {} };
  const get1 = запросыК('GET', 'проверка')[0];
  check('перед PUT был GET за sha по тому же пути', !!get1 && запросы.indexOf(get1) < запросы.indexOf(put1));
  check('PUT по правильному пути', put1.url === путь, put1.url);
  let т1 = {};
  try { т1 = JSON.parse(put1.тело); } catch {}
  check('в сообщении коммита [skip render]', /\[skip render\]/.test(т1.message || '') && /^данные: проверка/.test(т1.message || ''), т1.message);
  check('ветка main', т1.branch === 'main', т1.branch);
  let раскодировано = null;
  try { раскодировано = JSON.parse(Buffer.from(т1.content || '', 'base64').toString('utf8')); } catch {}
  check('содержимое раскодируется в тот же объект', same(раскодировано, объект), JSON.stringify(раскодировано));
  check('первый раз без sha (файла не было)', т1.sha === undefined, т1.sha);
  check('заголовки: Bearer, User-Agent, Accept',
    put1.headers.authorization === 'Bearer test' && !!put1.headers['user-agent'] && put1.headers.accept === 'application/vnd.github+json');

  // Несколько записей подряд — одна отправка с последним содержимым.
  await sleep(700);
  const до = запросыК('PUT', 'проверка').length;
  await пишем('проверка', { шаг: 1 });
  await пишем('проверка', { шаг: 2 });
  await пишем('проверка', { шаг: 3 });
  await дождаться(() => запросыК('PUT', 'проверка').length >= до + 1);
  await sleep(1200);
  const новые = запросыК('PUT', 'проверка').slice(до);
  let т2 = {};
  try { т2 = JSON.parse(новые[0].тело); } catch {}
  check('три записи подряд ушли одной отправкой', новые.length === 1, 'PUT: ' + новые.length);
  check('ушло последнее содержимое', JSON.stringify(JSON.parse(Buffer.from(т2.content || '', 'base64').toString('utf8') || 'null')) === '{"шаг":3}');
  check('второй раз с sha из ответа на PUT, без нового GET', т2.sha === 'def' && запросыК('GET', 'проверка').length === 1, 'sha ' + т2.sha + ', GET ' + запросыК('GET', 'проверка').length);

  const стат2 = await (await fetch(САЙТ + '/stats?key=poisk2026')).text();
  check('на /stats видна удачная отправка', /Удачных отправок<\/div><div class="val">[1-9]/.test(стат2));
  // Строки про «../взлом», файл, которого нет в GitHub, и «сбой» вызвала сама проверка.
  const ошибкиЛога = лог.join('').split('\n').filter(с => /Хранилище:|Будильник:/.test(с) && !/недопустимое имя|в GitHub ещё нет|не загрузилось сбой/.test(с));
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
