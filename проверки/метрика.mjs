// Яндекс.Метрика — без браузера, по ответам сервера.
//
// Зачем. Счётчик 112722670 должен стоять на каждой HTML-странице сайта ровно
// один раз (два init — двойные визиты), ничего не показывать посетителю и не
// попадать на личные страницы владельца (/predlozheniya, /stats), иначе он сам
// засорит себе статистику. Страниц собирает десяток разных функций — проверка
// обходит по одной каждого вида. Второй сервер с METRIKA_OFF=1 — так проверки
// не шлют визиты в Метрику.
//
// Проверка сама поднимает два сервера (8243 — со счётчиком, 8244 — METRIKA_OFF=1)
// с выключенными площадками и временной папкой данных и гасит их по своим PID.
//   node проверки/метрика.mjs
//   node проверки/метрика.mjs https://nochy.by   (страницы со счётчиком — с живого сайта)

import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';

const ВНЕШНИЙ = (process.argv[2] || '').replace(/\/$/, '');
const ПОРТ_ВКЛ = 8243, ПОРТ_ВЫКЛ = 8244;
const КЛЮЧ = process.env.STATS_KEY || 'poisk2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));

const ИНИТ = 'ym(112722670,"init"';
const КАРТИНКА = '<noscript><div><img src="https://mc.yandex.ru/watch/112722670" style="position:absolute;left:-9999px" alt=""></div></noscript>';
const СКРИПТ = '<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(112722670,"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});</script>';
const сколько = (т, к) => т.split(к).length - 1;

const корень = new URL('..', import.meta.url);
const папка = (process.env.TEMP || process.env.TMP || '/tmp') + '/metrika-test-' + process.pid;
const серверы = [];
function поднять(порт, выкл) {
  const д = папка + '/' + порт; mkdirSync(д, { recursive: true });
  const env = { ...process.env, PORT: String(порт), DATA_DIR: д, STATS_FILE: д + '/stats.json', GH_TOKEN: '',
                KUFAR: 'off', REALT: 'off', FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off' };
  delete env.METRIKA_OFF;
  if (выкл) env.METRIKA_OFF = '1';
  const п = spawn(process.execPath, ['kvartiry-server.js'], { cwd: корень, env, stdio: 'ignore' });
  серверы.push(п);
  return п;
}
async function завершить(код) {
  for (const п of серверы) {
    try { if (п.exitCode === null) п.kill(); } catch {}   // ровно наш процесс, по его pid
    await new Promise(r => { if (п.exitCode !== null) r(); else { п.once('exit', r); setTimeout(r, 3000); } });
  }
  try { rmSync(папка, { recursive: true, force: true }); } catch {}
  console.log('\nПройдено ' + passed + ', падает ' + failed);
  process.exit(код);
}
async function ждатьСервер(сайт) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(сайт + '/ping', { signal: AbortSignal.timeout(3000) })).ok) return true; } catch {}
    await sleep(500);
  }
  return false;
}
async function взять(сайт, путь) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(сайт + путь, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
      return { код: r.status, тип: r.headers.get('content-type') || '', тело: await r.text() };
    } catch (e) { if (i === 2) return { код: 0, тип: '', тело: '', ошибка: e.message }; await sleep(1000); }
  }
}

try {
  const ВКЛ = ВНЕШНИЙ || 'http://127.0.0.1:' + ПОРТ_ВКЛ;
  const ВЫКЛ = 'http://127.0.0.1:' + ПОРТ_ВЫКЛ;
  if (!ВНЕШНИЙ) поднять(ПОРТ_ВКЛ, false);
  поднять(ПОРТ_ВЫКЛ, true);
  check('сервер со счётчиком отвечает', await ждатьСервер(ВКЛ));
  check('сервер с METRIKA_OFF=1 отвечает', await ждатьСервер(ВЫКЛ));

  const СО_СЧЁТЧИКОМ = ['/', '/?country=places', '/mesto/286', '/m/lida-voronovo', '/m', '/marshrut?p=286,4198',
    '/podborka/osen', '/grodno', '/novogrudok', '/nesvizh', '/izbrannoe?s=', '/net-takoj-stranicy-123', '/mesto/999999999'];
  for (const путь of СО_СЧЁТЧИКОМ) {
    const о = await взять(ВКЛ, путь);
    const т = о.тело;
    if (!/text\/html/.test(о.тип)) { check(путь + ': HTML-страница', false, о.код + ' ' + о.тип + (о.ошибка ? ' ' + о.ошибка : '')); continue; }
    check(путь + ': init ровно один раз (' + о.код + ')', сколько(т, ИНИТ) === 1, 'найдено ' + сколько(т, ИНИТ));
    check(путь + ': код счётчика дословно', т.includes(СКРИПТ));
    check(путь + ': noscript-картинка ровно одна', сколько(т, КАРТИНКА) === 1, 'найдено ' + сколько(т, КАРТИНКА));
    const конецГоловы = т.indexOf('</head>'), тело = т.search(/<body[\s>]/);
    check(путь + ': скрипт в <head>, картинка в <body>',
      конецГоловы > 0 && т.indexOf(СКРИПТ) < конецГоловы && тело > конецГоловы && т.indexOf(КАРТИНКА) > тело);
    check(путь + ': информера нет', !/informer/i.test(т));
  }

  for (const путь of ['/predlozheniya?key=' + КЛЮЧ, '/stats?key=' + КЛЮЧ]) {
    if (ВНЕШНИЙ && КЛЮЧ === 'poisk2026') break;   // на живом сайте ключ другой
    const о = await взять(ВКЛ, путь);
    check(путь.split('?')[0] + ': страница владельца (' + о.код + ') без счётчика',
      о.код === 200 && !о.тело.includes('mc.yandex') && !о.тело.includes('112722670'), о.код + '');
  }
  const робот = await взять(ВКЛ, '/robots.txt');
  check('/robots.txt не тронут', робот.код === 200 && !робот.тело.includes('mc.yandex'));
  const поиск = await взять(ВКЛ, '/api/places?light=1');
  check('JSON не тронут', !поиск.тело.includes('mc.yandex'));

  for (const путь of ['/', '/grodno', '/net-takoj-stranicy-123']) {
    const о = await взять(ВЫКЛ, путь);
    check('METRIKA_OFF=1: ' + путь + ' (' + о.код + ') без счётчика',
      /text\/html/.test(о.тип) && !о.тело.includes('mc.yandex') && !о.тело.includes('112722670'));
  }
  await завершить(failed ? 1 : 0);
} catch (e) {
  check('проверка не сломалась', false, e.stack);
  await завершить(1);
}
