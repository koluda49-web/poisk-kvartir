// Общее для проверок: свой headless Chrome и временные папки, которые
// за собой убираются.
//
// Зачем. Каждая проверка в браузере запускала Chrome со своим профилем
// %TEMP%\cdp-<проверка>-<pid> и только гасила процесс — папка профиля
// (десятки мегабайт кэша) оставалась. За месяц прогонов их набралось
// на двадцать гигабайт, и у владельца кончился диск. Теперь профиль
// удаляется в конце проверки при любом исходе: успех, падение, необработанная
// ошибка. На Windows Chrome держит файлы профиля ещё мгновение после смерти
// процесса — поэтому сначала ждём его выхода (до 5 с), потом удаляем с повторами.
//
// Убиваем ровно свой процесс — по объекту child_process (его pid), никогда
// по имени: у владельца открыт свой Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

// Удалить папку с повторами: rmSync с maxRetries повторяет синхронно,
// поэтому годится и в обработчике process.on('exit').
export function удалитьПапку(папка) {
  if (!папка || !внутриВременной(папка)) { if (папка) console.log('  (не удаляю ' + папка + ': не во временной папке)'); return; }
  try { rmSync(папка, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
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
  const удалитьПрофиль = () => { if (basename(profile).startsWith('cdp-')) удалитьПапку(profile); };
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${порт}`, '--disable-gpu',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', ...доп,
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  const вышел = new Promise(r => {
    if (chrome.exitCode !== null) return r();
    chrome.once('exit', r); chrome.once('error', r);
  });
  let закрытие = null;
  // Можно звать сколько угодно раз — закроет и уберёт один раз.
  const закрыть = () => закрытие || (закрытие = (async () => {
    try { if (chrome.exitCode === null) chrome.kill(); } catch {}
    await Promise.race([вышел, new Promise(r => setTimeout(r, 5000))]);
    удалитьПрофиль();
  })());
  // Страховка на выход через process.exit без закрыть(): синхронно гасим
  // и удаляем с повторами (дождаться выхода процесса здесь уже нельзя).
  process.on('exit', () => {
    try { if (chrome.exitCode === null) chrome.kill(); } catch {}
    удалитьПрофиль();
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
