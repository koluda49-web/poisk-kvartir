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
// GPU и служебные, и они держат файлы профиля. chrome.kill() гасил только
// главный, остальные доживали своё, а rmSync на занятом файле на этой машине
// бросает EPERM сразу, не выполняя своих maxRetries. Ошибка глоталась, и папка
// оставалась. Теперь: гасим дерево своего процесса (taskkill /PID … /T — по
// номеру, не по имени), добиваем по номеру всё, у кого в командной строке
// именно наш --user-data-dir, и удаляем в цикле с настоящими паузами, пока
// папка не исчезнет. Не вышло — печатаем «профиль не удалён: <путь>».
//
// Убиваем только свои процессы — по номеру, никогда по имени: у владельца
// открыт свой Chrome, и его профиль в командной строке другой.
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

// Номера процессов chrome.exe, у которых в командной строке наш профиль.
// Имя процесса здесь только для выборки — гасим потом по номеру и только те,
// что запущены с нашим уникальным --user-data-dir (в нём pid проверки).
const запросПроцессов = профиль => ['-NoProfile', '-NonInteractive', '-Command',
  "$p = [regex]::Escape('" + профиль.replace(/'/g, "''") + "'); "
  + "$q = [string][char]34; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match ('--user-data-dir=' + $q + '?' + $p + '(' + $q + '|\\s|$)') } | ForEach-Object { $_.ProcessId }"];
const номера = вывод => String(вывод || '').split(/\s+/).map(Number).filter(n => n > 0);
function погаситьПоНомеру(pid, sync) {
  const арг = ['/PID', String(pid), '/T', '/F'];
  if (sync) { try { execFileSync('taskkill', арг, { stdio: 'ignore', timeout: 5000 }); } catch {} return Promise.resolve(); }
  return new Promise(r => execFile('taskkill', арг, { timeout: 5000 }, () => r()));
}
function добитьСинхронно(профиль) {
  if (process.platform !== 'win32') return;
  let вывод = '';
  try { вывод = execFileSync('powershell', запросПроцессов(профиль), { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  номера(вывод).forEach(pid => погаситьПоНомеру(pid, true));
}
async function добить(профиль) {
  if (process.platform !== 'win32') return;
  const вывод = await new Promise(r => execFile('powershell', запросПроцессов(профиль), { encoding: 'utf8', timeout: 8000 }, (e, out) => r(out)));
  await Promise.all(номера(вывод).map(pid => погаситьПоНомеру(pid, false)));
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
  const вышел = new Promise(r => {
    if (chrome.exitCode !== null) return r();
    chrome.once('exit', r); chrome.once('error', r);
  });
  let закрытие = null;
  // Можно звать сколько угодно раз — закроет и уберёт один раз.
  let закрыто = false;
  const закрыть = () => закрытие || (закрытие = (async () => {
    // дерево своего процесса — главный Chrome и все его дочерние, по номеру
    if (chrome.pid) await погаситьПоНомеру(chrome.pid, false);
    try { if (chrome.exitCode === null) chrome.kill(); } catch {}
    await Promise.race([вышел, спать(5000)]);
    await добить(profile);   // осиротевшие дочерние с нашим профилем
    await удалитьПапкуЖдя(profile, { ждать: 15000, послеНеудачи: () => добить(profile), что: 'профиль не удалён' });
    закрыто = true;
  })());
  // Страховка на выход через process.exit без закрыть() (или до его конца):
  // синхронно гасим дерево и удаляем с паузами — ждать обещаний здесь нельзя.
  process.on('exit', () => {
    if (закрыто && !existsSync(profile)) return;
    if (chrome.pid) погаситьПоНомеру(chrome.pid, true);
    добитьСинхронно(profile);
    удалитьПапку(profile, { ждать: 6000, послеНеудачи: () => добитьСинхронно(profile), что: 'профиль не удалён' });
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
