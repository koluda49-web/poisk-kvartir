// Снимок своей статистики сайта в файл — перед каждой выкладкой и по расписанию.
//
// Зачем. Статистика живёт в памяти сервера и в файле на временном диске Render:
// каждая выкладка её стирает, и ряды «по дням» обрываются на 1–2 днях. Снимок
// берёт сводку /stats?json=1 (только агрегаты: входы по дням, по меткам,
// переходы к объявлениям по площадкам и страницам, 404, поиски без результата —
// без событий и без адресов) и дописывает её одной строкой в
// «ТикТок — Поиск квартир\статистика-сайта.jsonl» на Рабочем столе.
//
// Ключ /stats — как у сервера: из окружения STATS_KEY, а нет его — тот, что
// задан в kvartiry-server.js по умолчанию. В вывод ключ не печатается.
//   node проверки/снять-статистику.mjs                         (https://nochy.by)
//   node проверки/снять-статистику.mjs http://127.0.0.1:8080   (свой сервер)
//   node проверки/снять-статистику.mjs https://nochy.by "D:\другой\файл.jsonl"

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const SITE = (process.argv.slice(2).find(a => /^https?:\/\//i.test(a)) || 'https://nochy.by').replace(/\/$/, '');
const ФАЙЛ = process.argv.slice(2).find(a => !/^https?:\/\//i.test(a))
  || join(homedir(), 'Desktop', 'ТикТок — Поиск квартир', 'статистика-сайта.jsonl');

function ключ() {
  if (process.env.STATS_KEY) return process.env.STATS_KEY;
  const код = readFileSync(new URL('../kvartiry-server.js', import.meta.url), 'utf8');
  const м = код.match(/const STATS_KEY\s*=\s*process\.env\.STATS_KEY\s*\|\|\s*'([^']+)'/);
  if (!м) throw new Error('ключ /stats не найден ни в STATS_KEY, ни в kvartiry-server.js');
  return м[1];
}

// Выходим через exitCode, а не process.exit: резкий выход при открытом
// соединении на Windows роняет node с ошибкой libuv.
async function снять() {
  let ответ = null, текст = '';
  for (let i = 0; i < 3 && !ответ; i++) {
    try {
      ответ = await fetch(SITE + '/stats?key=' + encodeURIComponent(ключ()) + '&json=1',
        { headers: { 'User-Agent': 'Mozilla/5.0 snimok-statistiki poisk-check' }, signal: AbortSignal.timeout(60000) });
      текст = await ответ.text();
    } catch (e) {
      ответ = null;
      if (i === 2) { console.log('Не удалось забрать статистику: ' + e.message); return 1; }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!ответ.ok) { console.log('Сайт ответил ' + ответ.status + (ответ.status === 403 ? ' — ключ не подошёл' : '')); return 1; }
  let тело = null;
  try { тело = JSON.parse(текст); } catch {}
  if (!тело || !Array.isArray(тело.days)) {
    console.log('Ответ не похож на сводку — на сайте ещё версия без журнала входов (?json=1 отдаёт обычную страницу).');
    return 1;
  }

  const строка = { снято: new Date().toISOString(), адрес: SITE, ...тело };
  mkdirSync(dirname(ФАЙЛ), { recursive: true });
  appendFileSync(ФАЙЛ, JSON.stringify(строка) + '\n', 'utf8');

  const сегодня = тело.days[тело.days.length - 1] || {};
  const open = тело.openByHost.reduce((с, x) => с + x.n, 0);
  console.log('Снимок дописан: ' + ФАЙЛ);
  console.log('  событий в памяти сервера: ' + тело.events + (тело.since ? (' (с ' + тело.since.slice(0, 16).replace('T', ' ') + ' UTC)') : '')
    + ', сервер работает ' + Math.round(тело.uptimeSec / 60) + ' мин');
  console.log('  дней в ряду: ' + тело.days.length + '; сегодня входов ' + (сегодня.hits || 0) + ', людей ' + (сегодня.people || 0)
    + ', 404 ' + (сегодня.notFound || 0));
  console.log('  меток за 7 дней: ' + тело.marks.length + ', переходов к объявлениям: ' + open + ', адресов с 404: ' + тело.notFound.length);
  return 0;
}
process.exitCode = await снять();
