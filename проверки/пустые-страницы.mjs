// Пустые гиды и страницы спроса выпадают из sitemap — но только настоящие.
//
// Зачем. Гид или страница спроса без вариантов отдаёт 404, и сервер
// перестаёт перечислять её в sitemap.xml, иначе поисковик получает битые
// адреса. Опасность обратная: площадки глотают свои сбои и отдают пустой
// список, и после холодного старта или отказа Kufar живая страница выпала бы
// из карты сайта навсегда. Проверяем на своём экземпляре сервера, у которого
// Kufar и Realt «лежат» (подменённый fetch): страницы отдают 404, но
// пометку «пустая» не получают и остаются в sitemap. И что пометка живёт
// час: свежая убирает адрес из sitemap, просроченная — нет.
//
// Без браузера, сервер поднимает сам (порт 8192).
//   node проверки/пустые-страницы.mjs
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { временнаяПапка, удалитьПапку } from './_браузер.mjs';

const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ПОРТ = 8192, САЙТ = 'http://127.0.0.1:' + ПОРТ;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d !== undefined && d !== '' ? '  — ' + d : '')));

const папка = временнаяПапка('pustye-');
// Подмена fetch до запуска сервера: Kufar и Realt не отвечают, остальное как есть
const предзагрузка = join(папка, 'лежат.cjs');
writeFileSync(предзагрузка, "const f = globalThis.fetch;\n"
  + "globalThis.fetch = (u, o) => /kufar\\.by|realt\\.by/.test(String(u && u.url || u)) ? Promise.reject(new Error('проверка: площадка не отвечает')) : f(u, o);\n");
const сервер = spawn(process.execPath, ['-r', предзагрузка, 'kvartiry-server.js'], { cwd: КОРЕНЬ, stdio: 'ignore',
  env: { ...process.env, METRIKA_OFF: '1', PORT: String(ПОРТ), DATA_TEST: '1', DATA_TEST_NAMES: '', DATA_DIR: папка, STATS_FILE: join(папка, 'stats.json'),
         FLATBOOK: 'off', CHECKIN: 'off', KVARTIRKA: 'off', GH_TOKEN: '', RENDER_EXTERNAL_URL: '' } });
async function завершить(код) {
  try { if (сервер.exitCode === null) сервер.kill(); } catch {}   // ровно наш процесс, по pid
  await new Promise(r => { if (сервер.exitCode !== null) r(); else { сервер.once('exit', r); setTimeout(r, 3000); } });
  удалитьПапку(папка);
  process.exit(код);
}
process.on('unhandledRejection', e => { console.log('ОШИБКА ПРОВЕРКИ: ' + (e && e.message || e)); завершить(1); });

let готов = false;
for (let i = 0; i < 60 && !готов && сервер.exitCode === null; i++) {
  try { готов = (await fetch(САЙТ + '/ping')).ok; } catch {}
  if (!готов) await sleep(500);
}
check('свой сервер на ' + ПОРТ + ' поднялся', готов);
if (!готов) await завершить(1);

const пометки = async () => (await (await fetch(САЙТ + '/api/_empty-test')).json());
const вКарте = async () => new Set([...(await (await fetch(САЙТ + '/sitemap.xml')).text()).matchAll(/<loc>[^<]*\/([^/<]+)<\/loc>/g)].map(м => м[1]));

console.log('\n=== площадки не отвечают: страницы 404, но из sitemap не выпадают ===');
check('служебный вход говорит со своим сервером', (await пометки()).pid === сервер.pid);
for (const [slug, что] of [['gde-ostanovitsya-minsk', 'гид'], ['minsk-uruchie', 'спрос с отбором по слову'], ['braslav', 'спрос вокруг точки']]) {
  const r = await fetch(САЙТ + '/' + slug, { signal: AbortSignal.timeout(90000) });
  check(что + ' /' + slug + ' без вариантов отдаёт 404', r.status === 404, 'код ' + r.status);
}
// Страница, на которую ведёт кнопка главной, не 404: ссылка там вшита.
// Сбой площадок — 503 с понятным текстом (поисковик придёт позже и живую не выкинет).
const ГЛАВНАЯ_СПРОС = 'novogodnij-korporativ-brest';
{
  const r = await fetch(САЙТ + '/' + ГЛАВНАЯ_СПРОС, { signal: AbortSignal.timeout(90000) });
  const h = await r.text();
  check('/' + ГЛАВНАЯ_СПРОС + ' (ссылка с главной) при сбое — 503, не 404', r.status === 503, 'код ' + r.status);
  check('  с «Retry-After»', !!r.headers.get('retry-after'));
  check('  честный текст про сбой и кнопка полного поиска', /ответили не все/.test(h) && h.includes('href="/?region=brest&type=cottage"'));
  check('  есть ссылки на соседние подборки', /<h2>Другие подборки<\/h2><div class="others"><a href="\//.test(h));
}
const п1 = await пометки();
check('ни одна не помечена пустой — сбой площадок не повод', Object.keys(п1.пометки).length === 0, JSON.stringify(п1.пометки));
const к1 = await вКарте();
check('все три по-прежнему в sitemap', ['gde-ostanovitsya-minsk', 'minsk-uruchie', 'braslav'].every(s => к1.has(s)));
check('и страница с главной тоже', к1.has(ГЛАВНАЯ_СПРОС));

console.log('\n=== площадки ответили, а вариантов мало: страница помечена и выпала из sitemap ===');
// Выключаем Kufar и Realt переключателем /istochnik: выключенная площадка
// не обязана отвечать, и пустой ответ становится «полным» — как в жизни,
// когда все площадки ответили, а в Уручье четыре квартиры.
await fetch(САЙТ + '/istochnik?key=poisk2026&kufar=off&realt=off');
for (const slug of ['gde-ostanovitsya-minsk', 'minsk-uruchie', 'braslav']) {
  const r = await fetch(САЙТ + '/' + slug, { signal: AbortSignal.timeout(90000) });
  check('/' + slug + ' по-прежнему 404', r.status === 404, 'код ' + r.status);
}
const п0 = await пометки();
check('все три помечены пустыми', ['gde-ostanovitsya-minsk', 'minsk-uruchie', 'braslav'].every(s => s in п0.пометки), JSON.stringify(п0.пометки));
{
  // та же страница с главной, когда площадки ответили и вариантов ноль
  const r = await fetch(САЙТ + '/' + ГЛАВНАЯ_СПРОС, { signal: AbortSignal.timeout(90000) });
  const h = await r.text();
  check('/' + ГЛАВНАЯ_СПРОС + ' без вариантов — 200, не 404', r.status === 200, 'код ' + r.status);
  check('  закрыта от поиска: noindex и в метатеге, и в заголовке', /<meta name="robots" content="noindex/.test(h) && /noindex/.test(r.headers.get('x-robots-tag') || ''));
  check('  говорит, что сейчас ничего не сдаётся, и ведёт в полный поиск', /ничего не сдаётся/.test(h) && h.includes('href="/?region=brest&type=cottage"'));
  check('  ссылки на соседние подборки', (h.split('<h2>Другие подборки</h2>')[1] || '').includes('<a href="/'));
  check('  h1 прежний', h.includes('<h1>Новогодний корпоратив в Бресте</h1>'));
}
const к0 = await вКарте();
check('и в sitemap их нет', ['gde-ostanovitsya-minsk', 'minsk-uruchie', 'braslav'].every(s => !к0.has(s)));
check('пустая страница с главной помечена и тоже выпала из sitemap', ГЛАВНАЯ_СПРОС in (await пометки()).пометки && !к0.has(ГЛАВНАЯ_СПРОС));

console.log('\n=== пометка живёт час ===');
check('пометке отведён час', п1.живёт === 60 * 60 * 1000, String(п1.живёт));
await fetch(САЙТ + '/api/_empty-test?slug=gde-ostanovitsya-lida&age=0', { method: 'POST' });
await fetch(САЙТ + '/api/_empty-test?slug=minsk-centr&age=' + (2 * 60 * 60 * 1000), { method: 'POST' });
const к2 = await вКарте();
check('свежая пометка убирает гид из sitemap', !к2.has('gde-ostanovitsya-lida'));
check('просроченная (2 ч) не действует — страница в sitemap', к2.has('minsk-centr'));
const п2 = await пометки();
check('просроченная пометка стёрта, свежая осталась', !('minsk-centr' in п2.пометки) && 'gde-ostanovitsya-lida' in п2.пометки, JSON.stringify(п2.пометки));

console.log('\nПройдено ' + passed + ', падает ' + failed);
await завершить(failed ? 1 : 0);
