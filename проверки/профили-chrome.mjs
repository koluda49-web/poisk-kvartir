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
// Сервер должен быть запущен.
//   node проверки/профили-chrome.mjs
//   node проверки/профили-chrome.mjs http://127.0.0.1:8095
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ВРЕМЕННЫЕ = tmpdir();   // та же папка, что у _браузер.mjs
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

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
