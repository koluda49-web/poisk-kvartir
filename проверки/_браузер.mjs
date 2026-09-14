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
import { join } from 'node:path';

export const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ВРЕМЕННЫЕ = process.env.TEMP || tmpdir();

// Удалить папку с повторами: rmSync с maxRetries повторяет синхронно,
// поэтому годится и в обработчике process.on('exit').
export function удалитьПапку(папка) {
  if (!папка) return;
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
  const profile = join(ВРЕМЕННЫЕ, 'cdp-' + имя + '-' + process.pid);
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
    удалитьПапку(profile);
  })());
  // Страховка на выход через process.exit без закрыть(): синхронно гасим
  // и удаляем с повторами (дождаться выхода процесса здесь уже нельзя).
  process.on('exit', () => {
    try { if (chrome.exitCode === null) chrome.kill(); } catch {}
    удалитьПапку(profile);
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
