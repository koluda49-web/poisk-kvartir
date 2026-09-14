// Общее для проверок: свой headless Chrome и временные папки, которые
// за собой убираются.
//
// Зачем. Каждая проверка в браузере запускала Chrome со своим профилем
// %TEMP%\cdp-<проверка>-<pid> и только гасила процесс — папка профиля
// (десятки мегабайт кэша) оставалась. За месяц прогонов их набралось
// на двадцать гигабайт, и у владельца кончился диск. Теперь профиль
// удаляется в конце проверки при любом исходе: успех, падение, необработанная
// ошибка.
//
// Почему это непросто. Chrome — не один процесс: главный запускает рендереры,
// GPU и служебные (13–15 штук), и они держат файлы профиля. chrome.kill()
// гасит только главный, а rmSync на занятом файле на этой машине бросает
// EPERM сразу, не выполняя своих maxRetries. Поэтому: гасим главный, затем
// все процессы chrome.exe, у которых в командной строке ровно наш
// --user-data-dir (он есть у каждого дочернего), и удаляем папку в цикле
// с настоящими паузами. Не вышло — печатаем «профиль не удалён: <путь>».
//
// Безопасность — у владельца открыт свой Chrome, и он постоянно запускает
// процессы. Поэтому:
//  - по номеру процесса не убиваем НИКОГДА. Номер умершего процесса Windows
//    быстро отдаёт другому, и «taskkill /PID <номер нашего Chrome> /T»
//    через несколько секунд после его смерти мог прийтись в Chrome владельца.
//    Главный Chrome гасим только chrome.kill() и только пока он жив
//    (exitCode и signalCode — null): тогда Node держит открытый дескриптор
//    процесса, и номер занят именно им;
//  - дочерние гасим по одному через открытый дескриптор процесса: сначала
//    дескриптор (номер больше не может достаться другому), затем сверка,
//    что это тот самый процесс из выборки (время запуска и точный
//    --user-data-dir в командной строке), и только потом Kill() через этот
//    дескриптор — см. командаДобивания. Без дерева: каждый наш процесс сам
//    несёт наш путь;
//  - совпадение пути — с границей после него: cdp-x-1 не совпадает с cdp-x-12;
//  - пустой, относительный или не «cdp-…» во временной папке путь профиля —
//    ошибка до того, как что-либо запущено или погашено (проверитьПрофиль);
//  - профили прошлых прогонов, чья проверка уже не жива, подбираются перед
//    запуском Chrome (убратьОстатки) — только удаление папок, ничего не гасится.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, basename, isAbsolute } from 'node:path';

export const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ВРЕМЕННЫЕ = tmpdir();   // на Windows это и есть %TEMP%

// Удаляем рекурсивно — поэтому только то, что точно наше: папка прямо
// или глубже во временной папке системы. Ошибка в имени или пустая
// переменная окружения не должны превратиться в удаление чего-то большего.
function внутриВременной(папка) {
  const отн = relative(resolve(ВРЕМЕННЫЕ), resolve(папка));
  return !!отн && !отн.startsWith('..') && !isAbsolute(отн);
}

const спатьСинхронно = мс => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, мс);
const спать = мс => new Promise(r => setTimeout(r, мс));
function разрешено(папка) {
  if (папка && внутриВременной(папка)) return true;
  if (папка) console.log('  (не удаляю ' + папка + ': не во временной папке)');
  return false;
}
// Одна попытка: null — папки больше нет; иначе код ошибки rmSync
// (или «осталась», если rmSync не бросил, а папка на месте).
function попытка(папка) {
  let код = 'осталась';
  try { rmSync(папка, { recursive: true, force: true }); } catch (e) { код = (e && e.code) || String(e); }
  return existsSync(папка) ? код : null;
}

// Кто держит папку: процессы, у которых путь есть в командной строке
// (кроме самого запроса). Только чтение. Путь передаём через окружение —
// так его не нужно экранировать для PowerShell.
// PowerShell на этой машине запускается и по 20 с — запросы только читают, ждём с запасом
const ЖДАТЬ_ЧТЕНИЯ = 60000;
const СКРИПТ_КТО_ДЕРЖИТ = String.raw`
$p = [regex]::Escape($env:CDP_PAPKA);
Get-CimInstance Win32_Process |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $p } |
  ForEach-Object { $_.Name + ':' + $_.ProcessId }
`.replace(/\r?\n\s*/g, ' ');
function ктоДержит(папка) {
  if (process.platform !== 'win32') return '?';
  try {
    const вывод = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', СКРИПТ_КТО_ДЕРЖИТ],
      { encoding: 'utf8', timeout: ЖДАТЬ_ЧТЕНИЯ, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CDP_PAPKA: папка } });
    return вывод.trim().split(/\s+/).filter(Boolean).join(', ') || 'нет процессов с этим путём';
  } catch { return 'не удалось узнать'; }
}
// Почему папка осталась — чтобы следующую утечку профилей было чем разобрать,
// а не гадать (однажды их набралось на двадцать гигабайт).
function почемуОсталась(папка, код) {
  let файлы;
  try { const все = readdirSync(папка, { recursive: true }); файлы = все.slice(0, 5).join(', ') + (все.length > 5 ? ' … (всего ' + все.length + ')' : ''); }
  catch (e) { файлы = '(не прочитать: ' + ((e && e.code) || e) + ')'; }
  return '  код ' + код + '; осталось: ' + (файлы || '—') + '; держат: ' + ктоДержит(папка);
}

// Удалить папку синхронно, с настоящими паузами между попытками (годится
// и в обработчике process.on('exit'), где ждать обещаний уже нельзя).
export function удалитьПапку(папка, { ждать = 5000, послеНеудачи, что = 'папка не удалена' } = {}) {
  if (!разрешено(папка)) return true;
  const до = Date.now() + ждать;
  let код;
  for (let i = 0; ; i++) {
    if ((код = попытка(папка)) === null) return true;
    if (Date.now() >= до) break;
    if (послеНеудачи && i % 10 === 9) послеНеудачи();
    спатьСинхронно(200);
  }
  console.log(что + ': ' + папка);
  console.log(почемуОсталась(папка, код));
  return false;
}
// То же без блокировки — для обычного завершения проверки.
export async function удалитьПапкуЖдя(папка, { ждать = 15000, послеНеудачи, что = 'папка не удалена' } = {}) {
  if (!разрешено(папка)) return true;
  const до = Date.now() + ждать;
  let код;
  for (let i = 0; ; i++) {
    if ((код = попытка(папка)) === null) return true;
    if (Date.now() >= до) break;
    if (послеНеудачи && i % 10 === 9) await послеНеудачи();
    await спать(200);
  }
  console.log(что + ': ' + папка);
  console.log(почемуОсталась(папка, код));
  return false;
}

// Остатки прошлых прогонов. Профиль называется cdp-<имя>-<pid>, где pid —
// номер процесса node.exe проверки. Если проверку убили (закрыли окно,
// Ctrl+C до обработчиков, падение машины), её уборка не выполнилась, и папка
// лежит вечно. Перед каждым запуском Chrome подбираем такие папки:
//  - только папки cdp-…-<число> прямо во временной папке;
//  - <pid> в имени — не живой node.exe (жив — значит, проверка ещё идёт
//    или номер уже у другого node; и то и другое не трогаем);
//  - ни у одного живого chrome.exe нет этой папки в командной строке
//    (Chrome пережил свою проверку и ещё держит профиль);
//  - не узнали, какие процессы живы, — не трогаем ничего.
// Процессы здесь не гасятся никогда — только читаем список и удаляем папки.
const СКРИПТ_ЖИВЫХ = String.raw`
$n = @(Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | ForEach-Object { $_.ProcessId });
$c = @(Get-CimInstance Win32_Process -Filter 'Name=''chrome.exe''' | Where-Object { $_.CommandLine } | ForEach-Object { $_.CommandLine });
ConvertTo-Json -Compress -InputObject @{ n = $n; c = $c }
`.replace(/\r?\n\s*/g, ' ');
const ОСТАТОК = /^cdp-.+-(\d+)$/;
// Путь в командной строке с границей после него: cdp-x-1 не совпадает с cdp-x-12.
// Без учёта регистра — Windows его не различает, а лишний пропуск безопасен.
function естьВСтроке(папка, строка) {
  const п = папка.toLowerCase(), с = String(строка).toLowerCase();
  for (let i = с.indexOf(п); i >= 0; i = с.indexOf(п, i + 1)) {
    const после = с[i + п.length];
    if (после === undefined || после === '"' || после === '/' || после === String.fromCharCode(92) || после.trim() === '') return true;
  }
  return false;
}
export function убратьОстатки() {
  if (process.platform !== 'win32') return [];
  let имена;
  try {
    имена = readdirSync(ВРЕМЕННЫЕ, { withFileTypes: true })
      .filter(d => d.isDirectory() && ОСТАТОК.test(d.name)).map(d => d.name);
  } catch { return []; }
  if (!имена.length) return [];
  let живые;
  try {
    живые = JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', СКРИПТ_ЖИВЫХ],
      { encoding: 'utf8', timeout: ЖДАТЬ_ЧТЕНИЯ, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; }
  const узлы = new Set([].concat(живые.n || []).map(Number));
  const строки = [].concat(живые.c || []).filter(Boolean);
  const убраны = [];
  for (const имя of имена) {
    const папка = join(ВРЕМЕННЫЕ, имя);
    if (узлы.has(Number(имя.match(ОСТАТОК)[1]))) continue;
    if (строки.some(с => естьВСтроке(папка, с))) continue;
    const код = попытка(папка);
    if (код === null) убраны.push(имя);
    else console.log('  (профиль прошлого прогона не удалён: ' + папка + ', код ' + код + ')');
  }
  if (убраны.length) console.log('  убраны профили прошлых прогонов: ' + убраны.join(', '));
  return убраны;
}

// Конвейер PowerShell: процессы с именем имяПроцесса и ровно этим
// --user-data-dir в командной строке (путь экранирован, после него — кавычка,
// пробел или конец строки). Каждый гасится только так:
//  1. открываем настоящий дескриптор процесса (Get-Process по номеру +
//     .Handle). Пока дескриптор открыт, Windows не отдаст этот номер другому
//     процессу;
//  2. сверяем, что за дескриптором тот же процесс, что попал в выборку:
//     время запуска по дескриптору совпадает с CreationDate из снимка CIM
//     (с точностью до 1 мс — у CIM микросекунды). Не прочиталось или другое —
//     пропускаем: номер уже у другого процесса;
//  3. при открытом дескрипторе заново читаем командную строку по этому номеру
//     и снова проверяем точный путь профиля и время запуска;
//  4. только тогда Kill() через этот дескриптор (один процесс, без дерева)
//     и закрываем дескриптор.
// Промежуток «выборка → открыли дескриптор» остаётся, но его закрывает
// сверка времени запуска: процесс, получивший освободившийся номер, запущен
// позже нашего. Печатает номера погашенных — для журнала и проверки.
// Двойных кавычек в аргументе нет (их пришлось бы экранировать для
// командной строки Windows): кавычка собирается из [char]34.
// имяПроцесса меняется только в проверке (подставной node.exe вместо chrome.exe).
const СКРИПТ_ДОБИВАНИЯ = String.raw`
$p = [regex]::Escape('__ПУТЬ__'); $q = [string][char]34;
$re = '--user-data-dir=' + $q + '?' + $p + '(' + $q + '|\s|$)';
$same = { param($a, $b) [math]::Abs(($a.ToUniversalTime() - $b.ToUniversalTime()).TotalMilliseconds) -lt 1 };
Get-CimInstance Win32_Process -Filter ('Name=''' + '__ИМЯ__' + '''') |
  Where-Object { $_.CommandLine -and $_.CommandLine -match $re } |
  ForEach-Object {
    $c = $_; $h = $null;
    try {
      $h = Get-Process -Id $c.ProcessId -ErrorAction Stop;
      $null = $h.Handle;
      if (-not (& $same $h.StartTime $c.CreationDate)) { return };
      $c2 = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c.ProcessId);
      if (-not $c2 -or -not $c2.CommandLine -or -not ($c2.CommandLine -match $re)) { return };
      if (-not (& $same $h.StartTime $c2.CreationDate)) { return };
      $h.Kill();
      $c.ProcessId;
    } catch { } finally { if ($h) { $h.Dispose() } }
  }
`;
// Путь профиля, с которым вообще можно гасить процессы и удалять папку:
// непустой, абсолютный, во временной папке и с именем cdp-…  Пустой путь дал бы
// выражение «--user-data-dir=» и конец строки — под него попал бы любой процесс
// с пустым флагом; относительный совпал бы с чужим профилем с тем же хвостом.
// Ошибка — до того, как собрана команда и что-либо запущено или погашено.
function проверитьПрофиль(профиль, кто) {
  const п = typeof профиль === 'string' ? профиль : '';
  if (!п.trim() || !isAbsolute(п) || !внутриВременной(п) || !basename(п).startsWith('cdp-'))
    throw new Error(кто + ': недопустимый путь профиля «' + профиль + '» (нужен абсолютный путь cdp-… во временной папке)');
}
export function командаДобивания(профиль, имяПроцесса = 'chrome.exe') {
  проверитьПрофиль(профиль, 'командаДобивания');
  if (!/^[\w.-]+$/.test(имяПроцесса)) throw new Error('командаДобивания: недопустимое имя процесса ' + имяПроцесса);
  // В строке PowerShell в одинарных кавычках одинарной кавычкой считаются и
  // типографские U+2018–U+201B — их тоже удваиваем, иначе такая кавычка
  // в имени папки закончила бы строку.
  const скрипт = СКРИПТ_ДОБИВАНИЯ.replace('__ПУТЬ__', () => профиль.replace(/['\u2018-\u201B]/g, к => к + к))
    .replace('__ИМЯ__', () => имяПроцесса).replace(/\r?\n\s*/g, ' ');
  return ['-NoProfile', '-NonInteractive', '-Command', скрипт];
}
// Сколько ждать PowerShell добивания. Было 15 с, но на этой машине под нагрузкой
// один его запуск занимает 5–20 с: команду обрывало по таймауту, дочерние
// chrome.exe оставались жить и держать профиль — «профиль не удалён», а в журнале
// «держат: chrome.exe:…». Что и как гасится, от ожидания не меняется: каждый
// процесс по-прежнему сверяется через открытый дескриптор перед Kill().
const ЖДАТЬ_ДОБИВАНИЯ = 60000;
const номера = вывод => String(вывод || '').split(/\s+/).map(Number).filter(n => n > 0);
export function добитьСинхронно(профиль, имяПроцесса) {
  проверитьПрофиль(профиль, 'добитьСинхронно');
  if (process.platform !== 'win32') return [];
  try {
    return номера(execFileSync('powershell', командаДобивания(профиль, имяПроцесса),
      { encoding: 'utf8', timeout: ЖДАТЬ_ДОБИВАНИЯ, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; }
}
export async function добить(профиль, имяПроцесса) {
  проверитьПрофиль(профиль, 'добить');
  if (process.platform !== 'win32') return [];
  return new Promise(r => execFile('powershell', командаДобивания(профиль, имяПроцесса),
    { encoding: 'utf8', timeout: ЖДАТЬ_ДОБИВАНИЯ }, (e, out) => r(номера(out))));
}

// Гасим главный процесс только пока он жив и Node держит его дескриптор.
// Умер сам — его номер уже может принадлежать чужому процессу, не трогаем.
export function живой(процесс) {
  return !!процесс && процесс.exitCode === null && процесс.signalCode === null;
}
function погаситьГлавный(процесс) {
  if (!живой(процесс)) return false;
  try { процесс.kill(); } catch {}
  return true;
}

// Уборка после Chrome — отдельно от запуска, чтобы её можно было проверить
// на подставном «chrome» (профили-chrome.mjs). chrome — объект ChildProcess
// (или похожий: pid, exitCode, signalCode, kill, once).
export async function закрытьChrome(chrome, profile, { имяПроцесса } = {}) {
  проверитьПрофиль(profile, 'закрытьChrome');   // до того, как что-то погашено
  const вышел = new Promise(r => {
    if (!живой(chrome)) return r();
    chrome.once('exit', r); chrome.once('error', r);
  });
  погаситьГлавный(chrome);
  await Promise.race([вышел, спать(5000)]);
  await добить(profile, имяПроцесса);   // дочерние с нашим профилем
  return удалитьПапкуЖдя(profile, { ждать: 15000, послеНеудачи: () => добить(profile, имяПроцесса), что: 'профиль не удалён' });
}
export function закрытьChromeСинхронно(chrome, profile, { имяПроцесса } = {}) {
  проверитьПрофиль(profile, 'закрытьChromeСинхронно');
  погаситьГлавный(chrome);
  добитьСинхронно(profile, имяПроцесса);
  return удалитьПапку(profile, { ждать: 6000, послеНеудачи: () => добитьСинхронно(profile, имяПроцесса), что: 'профиль не удалён' });
}

// Временная папка (DATA_DIR, STATS_FILE второго экземпляра сервера), которая
// удалится при выходе, даже если проверка упала раньше своей уборки.
export function временнаяПапка(префикс) {
  const папка = mkdtempSync(join(tmpdir(), префикс));
  process.on('exit', () => удалитьПапку(папка));
  return папка;
}

// Запустить Chrome на порту отладки. имя — часть имени профиля: cdp-<имя>-<pid>.
// доп — флаги сверх обычных (например, --user-agent=…).
// ловитьОшибки — повесить обработчики unhandledRejection/uncaughtException:
// сообщить, закрыть Chrome с уборкой профиля и выйти с кодом 1. Проверки со
// своими обработчиками передают false и сами зовут закрыть().
export function запуститьChrome(порт, имя, { доп = [], ловитьОшибки = true } = {}) {
  // имя попадает в путь профиля, который потом удаляется: только буквы, цифры, «_» и «-»
  if (!/^[\p{L}\p{N}_-]+$/u.test(String(имя))) throw new Error('запуститьChrome: недопустимое имя профиля «' + имя + '»');
  const profile = join(ВРЕМЕННЫЕ, 'cdp-' + имя + '-' + process.pid);
  проверитьПрофиль(profile, 'запуститьChrome');
  убратьОстатки();   // профили прошлых прогонов, чья проверка уже не жива
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${порт}`, '--disable-gpu',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    // без отчётов о падениях: crashpad — ещё один процесс, который держит профиль
    '--disable-breakpad', '--disable-crash-reporter', '--no-crash-upload', ...доп,
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let закрытие = null, закрыто = false;
  // Можно звать сколько угодно раз — закроет и уберёт один раз.
  const закрыть = () => закрытие || (закрытие = закрытьChrome(chrome, profile).then(() => { закрыто = true; }));
  // Страховка на выход через process.exit без закрыть() (или до его конца):
  // то же синхронно — ждать обещаний здесь нельзя.
  process.on('exit', () => {
    if (закрыто && !existsSync(profile)) return;
    закрытьChromeСинхронно(chrome, profile);
  });
  if (ловитьОшибки) {
    const упали = async e => {
      console.log('ОШИБКА ПРОВЕРКИ: ' + (e && (e.stack || e.message) || e));
      await закрыть();
      process.exit(1);
    };
    process.on('unhandledRejection', упали);
    process.on('uncaughtException', упали);
  }
  return { chrome, profile, закрыть };
}
