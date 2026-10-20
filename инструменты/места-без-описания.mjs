// Список мест kudin.by без описания → места-без-описания.json (20.10).
// Зачем: Google нашёл ~880 наших адресов, но не обходит их, а в sitemap
// больше тысячи страниц мест. Пустые места (без текста) из sitemap убираем,
// чтобы поисковик тратил обход на квартиры, города и места с описанием.
// Сами страницы остаются на сайте и в ссылках.
//
// Запуск: node инструменты/места-без-описания.mjs
// Ходит в kudin.by по одному запросу на точку, по 4 сразу — минуты три.
// Своих точек (EXTRA_PLACES, 910xxx) здесь нет: у них описание всегда своё.
// Текст из ПРАВКИ_ТОЧЕК сервер учитывает сам — такие места в sitemap остаются.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const KUDIN = 'https://kudin.by';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ФАЙЛ = join(dirname(fileURLToPath(import.meta.url)), '..', 'места-без-описания.json');
const МИН_ТЕКСТ = 40;   // короче — это подпись, а не описание

const точки = await (await fetch(KUDIN + '/api/v1/points/', { headers: { 'User-Agent': UA } })).json();
const ids = (Array.isArray(точки) ? точки : []).filter(p => p && p.id && p.name && p.coords).map(p => +p.id);
console.log('точек:', ids.length);

const пустые = [], ошибки = [];
let i = 0, готово = 0;
async function текст(id){
  for (let попытка = 0; попытка < 3; попытка++) {
    try {
      const r = await fetch(KUDIN + '/api/v1/detail/?id=' + id, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      const it = (j && j.item) || {};
      return String(it.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) { await new Promise(r => setTimeout(r, 2000)); }
  }
  return null;
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (i < ids.length) {
    const id = ids[i++];
    const т = await текст(id);
    if (т === null) ошибки.push(id);
    else if (т.length < МИН_ТЕКСТ) пустые.push(id);
    if (++готово % 100 === 0) console.log(готово, '/', ids.length);
  }
}));
// Не ответила точка — считаем, что описание есть (лучше лишняя страница в sitemap, чем выкинутая живая).
if (ошибки.length > ids.length * 0.2) { console.error('kudin.by не ответил по', ошибки.length, 'точкам — файл не пишу'); process.exit(1); }
пустые.sort((a, b) => a - b);
writeFileSync(ФАЙЛ, JSON.stringify({ обновлено: new Date().toISOString().slice(0, 10), всего: ids.length,
  безОписания: пустые.length, ошибок: ошибки.length, ids: пустые }) + '\n');
console.log('без описания:', пустые.length, 'из', ids.length, '; не ответили:', ошибки.length, '→', ФАЙЛ);
