// Каталоги check-in.by и kvartirka.by: полные, не пустеют после запуска
// и не рушатся от одного сломанного раздела.
//
// Зачем. 30.09 нашли три беды сразу. Check-in без параметра sort отдаёт
// список в случайном порядке, и каждый сбор терял своё: «Треугольный дом
// в Налибокской пуще» был в выдаче 28.09 и пропал в следующем сборе.
// После каждой выкладки обе площадки минуты три отсутствовали в поиске —
// первый сбор ждал сорок секунд и шёл целиком, прежде чем что-то показать.
// И одна ошибка на странице обрывала остаток раздела, а неполный каталог
// молча подменял полный.
//
// Два режима.
//   node проверки/каталоги-полнота.mjs
//     поднимает свой сервер (порт 9640) с нарочно сломанными разделами:
//     у kvartirka — квартиры Гродно с самого начала, у check-in — Брестская
//     область со второго сбора (неверный адрес раздела). Смотрит, что через
//     минуту после запуска обе площадки уже в выдаче, что сломанный раздел
//     не обнулил ни свой каталог, ни соседний, что при втором сборе Брест
//     остался из первого и что Минская область check-in собрана полностью.
//     Идёт минут шесть — ждёт двух сборов подряд.
//   node проверки/каталоги-полнота.mjs http://127.0.0.1:8080 [ключ]
//     проверяет уже запущенный сервер (или живой сайт) после конца сбора:
//     полнота Минской области, «Треугольный дом», нет сбоев в /istochnik.
//
// Эталон полноты берём у самой площадки: в каждом ответе списка check-in.by
// лежит mapApartments — весь раздел одним массивом. Кого из него нет в нашем
// каталоге, дочитываем со страницы объявления и смотрим, законно ли его нет
// (цена за человека, архив, нулевая цена — ровно как отбирает сервер).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import tls from 'node:tls';
import { временнаяПапка, удалитьПапку } from './_браузер.mjs';

const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ЖИВОЙ = process.argv[2] || '';
const КЛЮЧ = process.argv[3] || 'poisk2026';
const ПОРТ = 9640;
const САЙТ = ЖИВОЙ || ('http://127.0.0.1:' + ПОРТ);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok
  ? (passed++, console.log('  OK   ' + n))
  : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));

const дай = async q => (await (await fetch(САЙТ + '/api/search?' + q, { signal: AbortSignal.timeout(60000) })).json());
const источник = async () => (await fetch(САЙТ + '/istochnik?key=' + КЛЮЧ)).text();
// Кусок /istochnik про одну площадку: её строка и строки с отступом под ней
const блок = (т, имя) => ((т.match(new RegExp('\\n  ' + имя + '[^\\n]*(?:\\n {4,}[^\\n]*)*')) || [''])[0]);

// ── Свой сервер со сломанными разделами ──────────────────────────────────
let сервер = null, папка = null, агент = null;
async function завершить(код) {
  try { if (сервер && сервер.exitCode === null) сервер.kill(); } catch {}   // ровно наш процесс, по pid
  if (сервер) await new Promise(r => { if (сервер.exitCode !== null) r(); else { сервер.once('exit', r); setTimeout(r, 3000); } });
  if (папка) удалитьПапку(папка);
  // Выходим сами, без process.exit: с ним на Windows после запросов
  // к check-in.by node падал внутри libuv с кодом 127.
  if (агент) агент.destroy();
  console.log('\nПройдено ' + passed + ', падает ' + failed);
  process.exitCode = код;
}
process.on('unhandledRejection', e => { console.log('ОШИБКА ПРОВЕРКИ: ' + (e && e.message || e)); завершить(1).then(() => process.exit(1)); });

const код = readFileSync(join(КОРЕНЬ, 'kvartiry-server.js'), 'utf8');

if (!ЖИВОЙ) {
  папка = временнаяПапка('katalogi-');
  // Подмена до запуска сервера. Квартиры Гродно на kvartirka идут по неверному
  // адресу с самого начала — раздел сломан, а прошлого сбора ещё нет.
  // Раздел Брестской области check-in первый сбор проходит честно, а со
  // второго ходит по неверному адресу (площадка отвечает 404) — так видно,
  // что прошлый сбор его выручает. Второй сбор вместо трёх часов начинается
  // через сорок секунд после конца первого; третьего не будет.
  const предзагрузка = join(папка, 'сломать.cjs');
  writeFileSync(предзагрузка, [
    "const https = require('https'); const g = https.get; let брест = 0;",
    "https.get = function(u, ...r){",
    "  if(typeof u === 'string' && u.includes('-na-sutki-brestskaya-oblast?')){",
    "    if(/kvartiry-na-sutki-brestskaya-oblast\\?.*[?&]page=1$/.test(u)) брест++;",
    "    if(брест > 1) u = u.replace('-na-sutki-brestskaya-oblast?', '-na-sutki-brestskaya-oblastx?');",
    "  }",
    "  return g.call(this, u, ...r);",
    "};",
    "const f = globalThis.fetch;",
    "globalThis.fetch = (u, o) => f(typeof u === 'string' ? u.replace('kvartirka.by/grodno/kvartiry', 'kvartirka.by/grodnox/kvartiry') : u, o);",
    "const st = globalThis.setTimeout;",
    "globalThis.setTimeout = function(fn, ms, ...a){",
    "  if(typeof fn === 'function' && fn.name === 'обновитьКаталоги')",
    "    return st.call(this, () => { Promise.resolve(fn()).then(() => st(fn, 40000)); }, ms, ...a);",
    "  return st.call(this, fn, ms, ...a);",
    "};", ''].join('\n'));
  сервер = spawn(process.execPath, ['-r', предзагрузка, 'kvartiry-server.js'], { cwd: КОРЕНЬ, stdio: 'ignore',
    env: { ...process.env, METRIKA_OFF: '1', PORT: String(ПОРТ), DATA_TEST: '1', DATA_TEST_NAMES: '', DATA_DIR: папка,
           STATS_FILE: join(папка, 'stats.json'), GH_TOKEN: '', RENDER_EXTERNAL_URL: '',
           CHECKIN: 'on', KVARTIRKA: 'on' } });
  const старт = Date.now();
  let готов = false;
  for (let i = 0; i < 60 && !готов && сервер.exitCode === null; i++) {
    try { готов = (await fetch(САЙТ + '/ping')).ok; } catch {}
    if (!готов) await sleep(500);
  }
  check('свой сервер на ' + ПОРТ + ' поднялся', готов);
  if (!готов) { await завершить(1); process.exit(1); }

  console.log('\n=== через минуту после запуска обе площадки уже в поиске ===');
  const есть = { checkin: 0, kvartirka: 0 };
  let шёлСбор = false;
  while (Date.now() - старт < 60000 && (!есть.checkin || !есть.kvartirka)) {
    for (const к of Object.keys(есть))
      if (!есть[к]) есть[к] = ((await дай('region=any&type=any&source=' + к)).items || []).length;
    if (/сбор идёт/.test(await источник())) шёлСбор = true;
    if (!есть.checkin || !есть.kvartirka) await sleep(3000);
  }
  const секунд = Math.round((Date.now() - старт) / 1000);
  check('check-in непуст через ' + секунд + ' с после запуска', есть.checkin > 0, 'объявлений ' + есть.checkin);
  check('kvartirka непуста через ' + секунд + ' с после запуска', есть.kvartirka > 0, 'объявлений ' + есть.kvartirka);
  check('/istochnik говорит, что сбор идёт', шёлСбор);

  // Ждём, пока /istochnik не скажет своё: собрано всё и ничего не идёт
  async function дождаться(что, условие, минут) {
    let т = '';
    const до = Date.now() + минут * 60000;
    while (Date.now() < до) {
      т = await источник();
      if (условие(т)) break;
      await sleep(5000);
    }
    check(что, условие(т), т.split('Каталоги в памяти:')[1]);
    console.log('  прошло ' + Math.round((Date.now() - старт) / 1000) + ' с от запуска');
    return т;
  }
  const оба = т => /CheckIn[^\n]*обновлён/.test(т) && /Kvartirka[^\n]*обновлён/.test(т) && !/сбор идёт/.test(т);

  console.log('\n=== первый сбор: сломанный раздел kvartirka не трогает остальное ===');
  const т1 = await дождаться('первый сбор закончился', оба, 8);
  const kv = (await дай('region=any&type=any&source=kvartirka')).items || [];
  const гродно = kv.filter(x => /kvartirka\.by\/grodno\/kvartiry/.test(x.link || '')).length;
  check('сломанный раздел kvartirka (квартиры Гродно) пуст', гродно === 0, 'объявлений ' + гродно);
  check('в /istochnik назван сбой kvartirka по Гродно', /сбой:[^\n]*\/grodno\/kvartiry/.test(блок(т1, 'Kvartirka')),
    блок(т1, 'Kvartirka'));
  check('остальная kvartirka на месте (больше тысячи)', kv.length > 1000, 'объявлений ' + kv.length);
  check('усадьбы Гродненской области kvartirka на месте', kv.some(x => /grodnenskaya-oblast\/usadby/.test(x.link || '')));
  const ci1 = (await дай('region=any&type=any&source=checkin')).items || [];
  const брест1 = ci1.filter(x => x.обл === 'brest').length;
  check('check-in собрался без сбоев', !/сбой:/.test(блок(т1, 'CheckIn')), блок(т1, 'CheckIn'));
  check('check-in Брестской области есть', брест1 > 50, 'объявлений ' + брест1);

  console.log('\n=== второй сбор: сломанный раздел check-in держится на прошлом ===');
  const т2 = await дождаться('второй сбор закончился со сбоем Брестской области',
    т => оба(т) && /сбой:[^\n]*brestskaya-oblast/.test(блок(т, 'CheckIn')), 7);
  check('в /istochnik сказано, что Брест оставлен из прошлого сбора',
    /brestskaya-oblast → [^\n]*?оставлены \d+ из прошлого сбора/.test(блок(т2, 'CheckIn')), блок(т2, 'CheckIn'));
  const ci2 = (await дай('region=any&type=any&source=checkin')).items || [];
  const брест2 = ci2.filter(x => x.обл === 'brest').length;
  check('объявления Брестской области остались', брест2 === брест1, 'было ' + брест1 + ', стало ' + брест2);
  for (const обл of ['minsk-obl', 'vitebsk', 'gomel', 'grodno', 'mogilev'])
    check('check-in ' + обл + ' на месте', ci2.some(x => x.обл === обл));
  check('каталог check-in не усох', ci2.length >= ci1.length - 5, 'было ' + ci1.length + ', стало ' + ci2.length);
}

// ── Полнота Минской области check-in против самой площадки ──────────────
console.log('\n=== check-in: Минская область собрана полностью ===');
const пэм = (код.match(/const CI_ПРОМЕЖУТОЧНЫЙ = `([\s\S]*?)`/) || [])[1];
const строкаПравила = код.split('\n').find(x => x.startsWith('const ЦЕНА_ЗА_ЧЕЛОВЕКА = '));
const ЦЕНА_ЗА_ЧЕЛОВЕКА = eval(строкаПравила.replace('const ЦЕНА_ЗА_ЧЕЛОВЕКА = ', '').replace(/;\s*$/, ''));
агент = new https.Agent({ ca: tls.rootCertificates.concat(пэм ? [пэм] : []), keepAlive: true, maxSockets: 2 });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ci = (путь, з = {}) => new Promise((ок, беда) => {
  const q = https.get('https://check-in.by' + путь, { agent: агент, headers: { 'User-Agent': UA, ...з } }, r => {
    const к = []; r.on('data', x => к.push(x)); r.on('end', () => ок({ status: r.statusCode, text: Buffer.concat(к).toString('utf8') }));
  });
  q.setTimeout(20000, () => q.destroy(new Error('check-in не ответил'))); q.on('error', беда);
});
let версия = '';
async function ciJson(путь) {
  if (!версия) {
    const h = (await ci('/')).text;
    версия = ((h.match(/&quot;version&quot;:&quot;([a-f0-9]+)&quot;/) || h.match(/"version":"([a-f0-9]+)"/)) || [])[1] || '';
  }
  const r = await ci(путь, { 'X-Inertia': 'true', 'X-Inertia-Version': версия, 'Accept': 'text/html, application/xhtml+xml' });
  if (r.status === 409) { версия = ''; return ciJson(путь); }
  if (r.status !== 200) throw new Error('check-in ' + r.status + ' ' + путь);
  return JSON.parse(r.text);
}

try {
  const эталон = [];
  for (const раздел of ['kvartiry', 'doma']) {
    const p = (await ciJson('/' + раздел + '-na-sutki-minskaya-oblast?guests_count=1&sort=price_asc&page=1')).props;
    эталон.push(...(p.mapApartments || []));
    check('mapApartments ' + раздел + ' совпадает с pagination.total', (p.mapApartments || []).length === p.pagination.total,
      (p.mapApartments || []).length + ' против ' + p.pagination.total);
  }
  const наши = (await дай('region=minsk-obl&type=any&source=checkin')).items || [];
  const нашиСлаги = new Set(наши.map(x => String(x.link || '').split('/').pop()));
  const нет = эталон.filter(a => !нашиСлаги.has(a.slug));
  // Кого нет — законно ли: дочитываем объявление и отбираем как сервер
  const незаконно = [];
  for (const a of нет) {
    let полное = null;
    try {
      const p = (await ciJson('/' + (a.type === 'house' ? 'dom/' : 'kvartira/') + a.slug)).props;
      полное = p.apartment || p.house;
    } catch (e) { /* снято с площадки прямо сейчас — считаем законным */ continue; }
    const законно = !полное || полное.status === 'archived' || !(Math.round(+полное.cost_day) > 0)
      || ЦЕНА_ЗА_ЧЕЛОВЕКА.test(String(полное.description || '') + ' ' + String(полное.title || ''));
    if (!законно) незаконно.push(a.slug);
    await sleep(150);
  }
  console.log('  на площадке ' + эталон.length + ', у нас ' + наши.length + ', нет у нас ' + нет.length
    + ' (из них законно — цена за человека, архив — ' + (нет.length - незаконно.length) + ')');
  // Пара объявлений может появиться на площадке между сбором и проверкой
  check('из Минской области не пропало ни одного живого объявления', незаконно.length <= 2,
    'пропали ' + незаконно.length + ': ' + незаконно.slice(0, 5).join(', '));
  const треугольный = эталон.find(a => a.slug === 'treugolnyj-dom-v-nalibokskoj-pushche');
  if (треугольный)
    check('«Треугольный дом в Налибокской пуще» в выдаче', нашиСлаги.has(треугольный.slug));
  else
    console.log('  — «Треугольного дома» на площадке больше нет, проверять нечего');
} catch (e) {
  check('check-in.by отвечает проверке', false, e.message);
}

console.log('\n=== /istochnik: полнота и сбои check-in ===');
{
  const т = блок(await источник(), 'CheckIn');
  const м = т.match(/собрано (\d+) из (\d+)/);
  check('сервер пишет «собрано N из M»', !!м, т);
  if (м) check('собрано почти всё (не больше двух на живые изменения)', +м[1] >= +м[2] - 2, м[0]);
  if (ЖИВОЙ) check('в /istochnik нет сбоя check-in', !/сбой:/.test(т), т);
  else {
    // Разделы, названные в строке сбоя: «kvartiry-brestskaya-oblast → …»
    const названы = [...(т.match(/сбой:[^\n]*/) || [''])[0].matchAll(/(?:kvartiry|doma)-[a-z-]+(?= →|:)/g)].map(м => м[0]);
    check('сбой check-in — только сломанный нами раздел', названы.every(р => /brestskaya-oblast/.test(р)), т);
  }
}

await завершить(failed ? 1 : 0);
