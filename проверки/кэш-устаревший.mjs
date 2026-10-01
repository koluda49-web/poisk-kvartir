// Устаревший ответ кэша отдаётся сразу, а площадки опрашиваются в фоне (01.10.2026).
//
// Зачем. После каждых восьми минут тишины кэш протухал, и следующий посетитель ждал живых
// запросов к Kufar/Realt/Flatbook (на Render — секунды). Теперь протухший непустой ответ
// (не старше четырёх сроков жизни) уходит сразу, а обновляется в фоне.
// Проверка поднимает свой сервер на порту 9650 с сроком жизни кэша 4 секунды.
//
//   node проверки/кэш-устаревший.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9650, BASE = 'http://127.0.0.1:' + PORT, sleep = ms => new Promise(r => setTimeout(r, ms));
const сервер = spawn(process.execPath, ['kvartiry-server.js'], { cwd: КОРЕНЬ, stdio: 'ignore',
  env: { ...process.env, PORT: String(PORT), METRIKA_OFF: '1', CACHE_TTL_MS: '4000' } });

let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const запрос = async () => {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/search?region=minsk&city=&type=flat&rooms=&guests=&max=&source=kufar');
  const d = await r.json();
  return { мс: Date.now() - t0, всего: d.total || 0 };
};

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/ping')).ok) break; } catch {} await sleep(500); }
  await sleep(1500);
  console.log('=== кэш со сроком жизни 4 секунды ===');
  const а = await запрос();
  if (!а.всего) { console.log('  Kufar ничего не вернул — проверять нечего'); process.exit(0); }
  console.log('  первый запрос (живой): ' + а.мс + ' мс, ' + а.всего + ' шт.');
  const б = await запрос();
  check('сразу после первого — из памяти (' + б.мс + ' мс)', б.мс < 200, б.мс + ' мс');
  await sleep(5500);   // срок вышел, но до четырёх сроков далеко
  const в = await запрос();
  check('срок вышел, а ответ отдан сразу из устаревшего (' + в.мс + ' мс)', в.мс < 200, в.мс + ' мс при живом ' + а.мс + ' мс');
  check('и данные на месте (' + в.всего + ' шт.)', в.всего > 0);
  await sleep(3000);   // фоновое обновление успело
  const г = await запрос();
  check('после фонового обновления снова быстро (' + г.мс + ' мс)', г.мс < 200, г.мс + ' мс');
  await sleep(18000); // больше четырёх сроков: устаревший ответ уже не отдаётся, идёт живой запрос
  const д = await запрос();
  check('старше четырёх сроков ответ по-прежнему приходит с данными (' + д.всего + ' шт., ' + д.мс + ' мс)', д.всего > 0);
} finally {
  сервер.kill();
}
console.log('\nПройдено ' + passed + ', падает ' + failed);
process.exit(failed ? 1 : 0);
