// IndexNow: сообщить Bing и Яндексу, что страницы появились или изменились.
//
// Зачем. Без уведомления поисковик узнаёт о новой странице при следующем обходе —
// через дни и недели. По протоколу IndexNow (его принимают Bing и Яндекс) адреса
// отправляются POST-запросом с ключом; ключ публичный и лежит на сайте файлом
// https://nochy.by/<ключ>.txt — так поисковик убеждается, что шлёт хозяин сайта.
// Ключ берётся из kvartiry-server.js (константа INDEXNOW_KEY). Сам сервер ничего
// не отправляет: только этот скрипт и только когда его запустили руками.
// Отправляются одни адреса страниц — без почты и без личных данных.
//
//   node проверки/indexnow.mjs https://nochy.by/doma-na-novyj-god gomel       адреса (можно путём)
//   node проверки/indexnow.mjs --file адреса.txt                              по адресу в строке
//   node проверки/indexnow.mjs --new 3                                        из sitemap: lastmod за 3 дня
//   node проверки/indexnow.mjs --new 3 --sitemap http://127.0.0.1:9881/sitemap.xml
//   node проверки/indexnow.mjs --dry …                                        только показать, не слать
//
// Коды ответа: 200 — принято, 202 — принято, ключ ещё проверяется, 400 — неверный
// запрос, 403 — ключ не подошёл (файла ключа нет на сайте), 422 — адреса не с этого
// сайта, 429 — слишком часто.

import { readFileSync, existsSync } from 'node:fs';

const ХОСТ = 'nochy.by', ОСНОВА = 'https://' + ХОСТ;
const АДРЕСА_ПРИЁМА = ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow'];
const ЗА_РАЗ = 10000;   // предел протокола на один запрос

function ключ() {
  const код = readFileSync(new URL('../kvartiry-server.js', import.meta.url), 'utf8');
  const м = код.match(/const INDEXNOW_KEY = '([0-9a-f]{32})'/);
  if (!м) throw new Error('в kvartiry-server.js нет константы INDEXNOW_KEY');
  return м[1];
}

// Разбор аргументов: --dry, --new [N], --file путь, --sitemap адрес, остальное — адреса
function разобрать(арг) {
  const о = { dry: false, новые: null, файлы: [], sitemap: ОСНОВА + '/sitemap.xml', адреса: [] };
  for (let i = 0; i < арг.length; i++) {
    const а = арг[i];
    if (а === '--dry') о.dry = true;
    else if (а === '--new') { const n = +арг[i + 1]; if (n > 0) { о.новые = n; i++; } else о.новые = 1; }
    else if (а === '--file') о.файлы.push(арг[++i]);
    else if (а === '--sitemap') о.sitemap = арг[++i];
    else if (!/^(https?:)?\//i.test(а) && existsSync(а)) о.файлы.push(а);
    else о.адреса.push(а);
  }
  return о;
}

// Адрес — только наш: путь превращаем в https://nochy.by/путь, чужие отбрасываем
function нашАдрес(а) {
  а = String(а || '').trim();
  if (!а || а.startsWith('#')) return '';
  // путь — и без косой черты в начале (doma-na-novyj-god): Git Bash превращает «/путь» в путь к файлу
  if (а.startsWith('/')) а = ОСНОВА + а;
  else if (!/^[a-z]+:/i.test(а)) а = ОСНОВА + '/' + а;
  try {
    const u = new URL(а);
    if (u.hostname !== ХОСТ) return '';
    return ОСНОВА + u.pathname + u.search;
  } catch { return ''; }
}

// Страницы из sitemap, у которых lastmod не старше N дней
async function изКартыСайта(адрес, дней) {
  const xml = await (await fetch(адрес, { signal: AbortSignal.timeout(60000) })).text();
  const порог = Date.now() - дней * 86400000;
  const out = [];
  for (const м of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)) {
    const когда = м[2] ? Date.parse(м[2]) : NaN;
    // lastmod — день (ГГГГ-ММ-ДД): считаем до конца этого дня
    if (!isNaN(когда) && когда + 86400000 > порог) out.push(м[1].replace(/&amp;/g, '&'));
  }
  return out;
}

async function отправить(куда, адреса, к) {
  const тело = { host: ХОСТ, key: к, keyLocation: ОСНОВА + '/' + к + '.txt', urlList: адреса };
  try {
    const r = await fetch(куда, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(тело), signal: AbortSignal.timeout(30000) });
    const т = (await r.text()).replace(/\s+/g, ' ').slice(0, 200);
    return r.status + (т ? (' ' + т) : '');
  } catch (e) { return 'нет ответа: ' + e.message; }
}

async function главная() {
  const о = разобрать(process.argv.slice(2));
  const к = ключ();
  let сырые = о.адреса.slice();
  for (const ф of о.файлы) сырые = сырые.concat(readFileSync(ф, 'utf8').split(/\r?\n/));
  if (о.новые) {
    try { сырые = сырые.concat(await изКартыСайта(о.sitemap, о.новые)); }
    catch (e) { console.log('Карта сайта не открылась (' + о.sitemap + '): ' + e.message); return 1; }
  }
  const чужие = сырые.filter(а => а.trim() && !а.trim().startsWith('#') && !нашАдрес(а));
  const адреса = [...new Set(сырые.map(нашАдрес).filter(Boolean))];
  if (чужие.length) console.log('Пропущены (не ' + ХОСТ + '): ' + чужие.slice(0, 5).join(', ') + (чужие.length > 5 ? ' …' : ''));
  if (!адреса.length) {
    console.log('Адресов нет. Пример: node проверки/indexnow.mjs /doma-na-novyj-god  или  --new 3');
    return 1;
  }
  console.log('Адресов: ' + адреса.length + '; ключ ' + к + ' (файл ' + ОСНОВА + '/' + к + '.txt)');
  адреса.slice(0, 5).forEach(а => console.log('  ' + а));
  if (адреса.length > 5) console.log('  … и ещё ' + (адреса.length - 5));
  if (о.dry) { console.log('--dry: ничего не отправлено'); return 0; }
  let сбой = false;
  for (let i = 0; i < адреса.length; i += ЗА_РАЗ) {
    const пачка = адреса.slice(i, i + ЗА_РАЗ);
    for (const куда of АДРЕСА_ПРИЁМА) {
      const ответ = await отправить(куда, пачка, к);
      if (!/^20[02]\b/.test(ответ)) сбой = true;
      console.log(куда + ' (' + пачка.length + '): ' + ответ);
    }
  }
  return сбой ? 1 : 0;
}
// Выходим через exitCode, а не process.exit: резкий выход при открытом
// соединении на Windows роняет node с ошибкой libuv.
process.exitCode = await главная();
