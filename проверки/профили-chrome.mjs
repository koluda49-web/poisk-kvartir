// Проверки в браузере убирают за собой профиль Chrome.
//
// Зачем. Каждая проверка запускает headless Chrome со своим профилем
// %TEMP%\cdp-<проверка>-<pid>. Раньше процесс гасили, а папку оставляли —
// за месяц набралось двадцать гигабайт, и у владельца кончился диск.
// Теперь Chrome запускается через проверки/_браузер.mjs, который удаляет
// профиль при любом исходе. Здесь это сторожим на двух проверках-представителях:
// слайдер.mjs — самая короткая (прошла и упала необработанной ошибкой: адрес
// сайта, по которому Chrome не может перейти, роняет CDP-запрос) и своя-точка.mjs —
// тяжёлая: карта, десятки вкладок-рендереров, кэш на тысячи файлов. Именно
// у тяжёлых профили и оставались: дочерние процессы Chrome держали файлы.
// Профиль должен существовать, пока проверка идёт, а после неё — ни папки,
// ни процесса chrome.exe с этим --user-data-dir, ни строки «профиль не удалён».
//
// И безопасность уборки — у владельца открыт свой Chrome. Без браузера,
// на подставных процессах node:
//  - «chrome», который уже умер (exitCode задан), а его номер теперь у живого
//    чужого процесса: уборка не должна тронуть этот процесс — ни асинхронная,
//    ни синхронная из обработчика exit;
//  - совпадение --user-data-dir точное: процесс с профилем …cdp-x-12 не
//    гасится уборкой профиля …cdp-x-1, а уборкой своего …cdp-x-12 — гасится.
//
// Сервер должен быть запущен.
//   node проверки/профили-chrome.mjs
//   node проверки/профили-chrome.mjs http://127.0.0.1:8095
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { закрытьChrome, закрытьChromeСинхронно, добить } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ВРЕМЕННЫЕ = tmpdir();   // та же папка, что у _браузер.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

// ── безопасность уборки: подставные процессы ─────────────────────────────
// Подставной процесс держим за его собственный объект ChildProcess и гасим
// в конце только через него.
const пустышка = (...доп) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)', ...доп], { stdio: 'ignore' });
const жив = п => { if (п.exitCode !== null || п.signalCode !== null) return false; try { process.kill(п.pid, 0); return true; } catch { return false; } };
const профильДляПроверки = имя => { const п = join(ВРЕМЕННЫЕ, имя); mkdirSync(join(п, 'Default'), { recursive: true }); writeFileSync(join(п, 'Default', 'x'), 'x'); return п; };
const подставные = [];
process.on('exit', () => подставные.forEach(п => { try { if (жив(п)) п.kill(); } catch {} }));

console.log('\n=== уборка не трогает номер умершего Chrome ===');
{
  const чужой = пустышка(); подставные.push(чужой);
  await sleep(700);
  // «наш Chrome» уже вышел, а его номер получил чужой процесс
  const мёртвый = { pid: чужой.pid, exitCode: 0, signalCode: null, kill() { throw new Error('kill у умершего звать нельзя'); }, once() {} };
  const п1 = профильДляПроверки('cdp-probe-' + process.pid + '-a');
  const удалён = await закрытьChrome(мёртвый, п1);
  await sleep(1500);
  check('асинхронная уборка: чужой процесс с тем же номером жив', жив(чужой));
  check('асинхронная уборка: профиль удалён', удалён && !existsSync(п1));
  const п2 = профильДляПроверки('cdp-probe-' + process.pid + '-b');
  const удалён2 = закрытьChromeСинхронно(мёртвый, п2);
  await sleep(1500);
  check('синхронная уборка (обработчик exit): чужой процесс жив', жив(чужой));
  check('синхронная уборка: профиль удалён', удалён2 && !existsSync(п2));
  // и с signalCode — тоже «умер»
  const убитый = { pid: чужой.pid, exitCode: null, signalCode: 'SIGTERM', kill() { throw new Error('kill у умершего звать нельзя'); }, once() {} };
  await закрытьChrome(убитый, профильДляПроверки('cdp-probe-' + process.pid + '-c'));
  await sleep(1500);
  check('уборка после «убит сигналом»: чужой процесс жив', жив(чужой));
  чужой.kill();
}

console.log('\n=== совпадение --user-data-dir точное ===');
{
  const длинный = join(ВРЕМЕННЫЕ, 'cdp-x-' + process.pid + '2');   // …cdp-x-<pid>2
  const короткий = join(ВРЕМЕННЫЕ, 'cdp-x-' + process.pid);         // …cdp-x-<pid>
  const сДлинным = пустышка('--', '--user-data-dir=' + длинный); подставные.push(сДлинным);
  await sleep(1000);
  const погашены1 = await добить(короткий, 'node.exe');
  await sleep(800);
  check('уборка профиля ' + короткий + ' не гасит процесс с ' + длинный, жив(сДлинным) && !погашены1.includes(сДлинным.pid), JSON.stringify(погашены1));
  const погашены2 = await добить(длинный, 'node.exe');
  let умер = false;
  for (let i = 0; i < 30 && !умер; i++) { await sleep(200); умер = !жив(сДлинным); }
  check('уборка своего профиля гасит ровно этот процесс (контроль)', умер && погашены2.length === 1 && погашены2[0] === сДлинным.pid, JSON.stringify(погашены2));
  if (!умер) сДлинным.kill();
}

// Живые chrome.exe с этим профилем — только чтение, ничего не гасим
function процессыСПрофилем(профиль) {
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      "$p = [regex]::Escape('" + профиль.replace(/'/g, "''") + "'); $q = [string][char]34; "
      + "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match ('--user-data-dir=' + $q + '?' + $p + '(' + $q + '|\\s|$)') } | ForEach-Object { $_.ProcessId }"],
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return '?'; }
}

async function прогнать(файл, имя, сайт) {
  const п = spawn(process.execPath, [join('проверки', файл), сайт], { cwd: КОРЕНЬ, stdio: ['ignore', 'pipe', 'pipe'] });
  let вывод = '';
  п.stdout.on('data', d => { вывод += d; }); п.stderr.on('data', d => { вывод += d; });
  const профиль = join(ВРЕМЕННЫЕ, 'cdp-' + имя + '-' + п.pid);
  let был = false;
  const вышел = new Promise(r => п.once('exit', код => r(код)));
  // пока проверка идёт — смотрим, что профиль правда создаётся под этим именем
  let код = null;
  вышел.then(к => { код = к; });
  for (let i = 0; i < 3000 && код === null; i++) { if (existsSync(профиль)) был = true; await sleep(100); }
  await вышел;
  return { код, был, остался: existsSync(профиль), процессы: процессыСПрофилем(профиль), профиль, вывод };
}

console.log('\n=== проверка прошла: профиль удалён ===');
function итог(р, что) {
  check(что + ': пока шла проверка, профиль ' + р.профиль + ' существовал', р.был);
  check(что + ': после проверки папки профиля нет', !р.остался);
  check(что + ': нет chrome.exe с этим профилем', р.процессы === '', р.процессы);
  check(что + ': нет строки «профиль не удалён»', !/профиль не удалён/.test(р.вывод), (р.вывод.match(/профиль не удалён[^\n]*/) || [''])[0]);
}
const удачно = await прогнать('слайдер.mjs', 'sl', SITE);
check('слайдер.mjs прошёл (код 0)', удачно.код === 0, 'код ' + удачно.код + ': ' + удачно.вывод.slice(-300));
итог(удачно, 'слайдер');

console.log('\n=== проверка упала необработанной ошибкой: профиль тоже удалён ===');
const упала = await прогнать('слайдер.mjs', 'sl', 'не-адрес');
check('слайдер.mjs вышел с кодом 1', упала.код === 1, 'код ' + упала.код + ': ' + упала.вывод.slice(-300));
итог(упала, 'слайдер упал');

console.log('\n=== тяжёлая проверка (своя-точка.mjs): профиль удалён ===');
const тяжёлая = await прогнать('своя-точка.mjs', 'own', SITE);
check('своя-точка.mjs прошла (код 0)', тяжёлая.код === 0, 'код ' + тяжёлая.код + ': ' + тяжёлая.вывод.slice(-300));
итог(тяжёлая, 'своя-точка');

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
