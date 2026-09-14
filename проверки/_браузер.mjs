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
//  - дочерние гасим в одном конвейере PowerShell: выборка по точному
//    совпадению --user-data-dir и Terminate на тех же объектах CIM, без
//    промежутка «нашли номер — потом убили»; без /T — каждый наш процесс
//    сам несёт наш путь;
//  - совпадение пути — с границей после него: cdp-x-1 не совпадает с cdp-x-12.
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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
// Одна попытка: true — папки больше нет.
function попытка(папка) {
  try { rmSync(папка, { recursive: true, force: true }); } catch {}
  return !existsSync(папка);
}

// Удалить папку синхронно, с настоящими паузами между попытками (годится
// и в обработчике process.on('exit'), где ждать обещаний уже нельзя).
export function удалитьПапку(папка, { ждать = 5000, послеНеудачи, что = 'папка не удалена' } = {}) {
  if (!разрешено(папка)) return true;
  const до = Date.now() + ждать;
  for (let i = 0; ; i++) {
    if (попытка(папка)) return true;
    if (Date.now() >= до) break;
    if (послеНеудачи && i % 10 === 9) послеНеудачи();
    спатьСинхронно(200);
  }
  console.log(что + ': ' + папка);
  return false;
}
// То же без блокировки — для обычного завершения проверки.
export async function удалитьПапкуЖдя(папка, { ждать = 15000, послеНеудачи, что = 'папка не удалена' } = {}) {
  if (!разрешено(папка)) return true;
  const до = Date.now() + ждать;
  for (let i = 0; ; i++) {
    if (попытка(папка)) return true;
    if (Date.now() >= до) break;
    if (послеНеудачи && i % 10 === 9) await послеНеудачи();
    await спать(200);
  }
  console.log(что + ': ' + папка);
  return false;
}

// Конвейер PowerShell: процессы с именем имяПроцесса и ровно этим
// --user-data-dir в командной строке (путь экранирован, после него — кавычка,
// пробел или конец строки) → Terminate на тех же объектах. Печатает номера
// погашенных — для журнала и проверки. Двойных кавычек в аргументе нет:
// их пришлось бы экранировать для командной строки Windows.
// имяПроцесса меняется только в проверке (подставной node.exe вместо chrome.exe).
export function командаДобивания(профиль, имяПроцесса = 'chrome.exe') {
  const в1 = s => String(s).replace(/'/g, "''");
  if (!/^[\w.-]+$/.test(имяПроцесса)) throw new Error('командаДобивания: недопустимое имя процесса ' + имяПроцесса);
  return ['-NoProfile', '-NonInteractive', '-Command',
    "$p = [regex]::Escape('" + в1(профиль) + "'); $q = [string][char]34; "
    + "Get-CimInstance Win32_Process -Filter ('Name=''' + '" + имяПроцесса + "' + '''') "
    + "| Where-Object { $_.CommandLine -and $_.CommandLine -match ('--user-data-dir=' + $q + '?' + $p + '(' + $q + '|\\s|$)') } "
    + "| ForEach-Object { $_.ProcessId; Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }"];
}
const номера = вывод => String(вывод || '').split(/\s+/).map(Number).filter(n => n > 0);
export function добитьСинхронно(профиль, имяПроцесса) {
  if (process.platform !== 'win32') return [];
  try {
    return номера(execFileSync('powershell', командаДобивания(профиль, имяПроцесса),
      { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { return []; }
}
export async function добить(профиль, имяПроцесса) {
  if (process.platform !== 'win32') return [];
  return new Promise(r => execFile('powershell', командаДобивания(профиль, имяПроцесса),
    { encoding: 'utf8', timeout: 15000 }, (e, out) => r(номера(out))));
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
  if (!внутриВременной(profile) || !basename(profile).startsWith('cdp-')) throw new Error('запуститьChrome: профиль вне временной папки: ' + profile);
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
