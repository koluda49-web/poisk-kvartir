// Проверки в браузере убирают за собой профиль Chrome.
//
// Зачем. Каждая проверка запускает headless Chrome со своим профилем
// %TEMP%\cdp-<проверка>-<pid>. Раньше процесс гасили, а папку оставляли —
// за месяц набралось двадцать гигабайт, и у владельца кончился диск.
// Теперь Chrome запускается через проверки/_браузер.mjs, который удаляет
// профиль при любом исходе. Здесь это сторожим на одной проверке-представителе
// (слайдер.mjs — самая короткая): профиль появляется, пока она идёт, и исчезает
// после неё — и когда она прошла, и когда упала необработанной ошибкой
// (адрес сайта, по которому Chrome не может перейти, роняет CDP-запрос).
//
// Сервер должен быть запущен.
//   node проверки/профили-chrome.mjs
//   node проверки/профили-chrome.mjs http://127.0.0.1:8095
import { spawn } from 'node:child_process';
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

async function прогнать(сайт) {
  const п = spawn(process.execPath, [join('проверки', 'слайдер.mjs'), сайт], { cwd: КОРЕНЬ, stdio: ['ignore', 'pipe', 'pipe'] });
  let вывод = '';
  п.stdout.on('data', d => { вывод += d; }); п.stderr.on('data', d => { вывод += d; });
  const профиль = join(ВРЕМЕННЫЕ, 'cdp-sl-' + п.pid);
  let был = false;
  const вышел = new Promise(r => п.once('exit', код => r(код)));
  // пока проверка идёт — смотрим, что профиль правда создаётся под этим именем
  let код = null;
  вышел.then(к => { код = к; });
  for (let i = 0; i < 1200 && код === null; i++) { if (existsSync(профиль)) был = true; await sleep(100); }
  await вышел;
  return { код, был, остался: existsSync(профиль), профиль, вывод };
}

console.log('\n=== проверка прошла: профиль удалён ===');
const удачно = await прогнать(SITE);
check('слайдер.mjs прошёл (код 0)', удачно.код === 0, 'код ' + удачно.код + ': ' + удачно.вывод.slice(-300));
check('пока шла проверка, профиль ' + удачно.профиль + ' существовал', удачно.был);
check('после проверки профиля нет', !удачно.остался);

console.log('\n=== проверка упала необработанной ошибкой: профиль тоже удалён ===');
const упала = await прогнать('не-адрес');
check('слайдер.mjs вышел с кодом 1', упала.код === 1, 'код ' + упала.код + ': ' + упала.вывод.slice(-300));
check('профиль существовал', упала.был);
check('после падения профиля нет', !упала.остался);

console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
