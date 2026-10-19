// Отчёт недели по своей статистике сайта — короткий текстовый файл, не длиннее 15 строк.
//
// Откуда цифры. Снимки /stats?json=1, которые дописывает проверки/снять-статистику.mjs
// в «ТикТок — Поиск квартир\статистика-сайта.jsonl», и (если сайт ответит) текущая
// сводка /stats?json=1 с самого сайта. Никаких внешних сервисов: только наш сайт и файл.
//
// Как склеиваются снимки. Статистика живёт в памяти сервера и при перезапуске Render
// начинается заново. Поэтому снимки делятся на «запуски» (начало = at − uptimeSec);
// у каждого запуска берётся последний снимок. Цифры разных запусков складываются,
// а если запуск начался раньше, чем закончился предыдущий снимок (данные переехали
// с ним), — берётся большее, чтобы не посчитать одно и то же дважды. Люди в разных
// запусках могут повторяться — поэтому «людей» в сумме за неделю со знаком «≈».
//
// Что в отчёте: входы и люди по дням за 7 дней, входы по меткам постов (from=tiktok-ДДММ),
// переходы к объявлениям по площадкам, страницы входа (топ-5), 404 без мусора (куски
// скриптов, /null, только роботы), поиски без результатов, связь (кнопка «Напишите нам»,
// пожелания, «Предложить место»). Нет данных — так и пишем.
//
//   node проверки/отчёт-недели.mjs                         файл снимков + https://nochy.by
//   node проверки/отчёт-недели.mjs http://127.0.0.1:9881   файл снимков + свой сервер
//   node проверки/отчёт-недели.mjs --bez-sajta             только файл снимков
//   node проверки/отчёт-недели.mjs --snimki "D:\файл.jsonl" --papka "D:\отчёты"

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const арг = process.argv.slice(2);
const значение = имя => { const i = арг.indexOf(имя); return i >= 0 ? арг[i + 1] : ''; };
const ПАПКА = значение('--papka') || join(homedir(), 'Desktop', 'ТикТок — Поиск квартир');
const СНИМКИ = значение('--snimki') || join(ПАПКА, 'статистика-сайта.jsonl');
const БЕЗ_САЙТА = арг.includes('--bez-sajta');
const SITE = (арг.find(а => /^https?:\/\//i.test(а)) || 'https://nochy.by').replace(/\/$/, '');
const ДЕНЬ = 86400000;
// день по Минску (UTC+3) — как в сводке сервера
const деньМинск = t => new Date(t + 3 * 3600000).toISOString().slice(0, 10);
const ддмм = д => д.slice(8, 10) + '.' + д.slice(5, 7);

function ключ() {
  if (process.env.STATS_KEY) return process.env.STATS_KEY;
  const код = readFileSync(new URL('../kvartiry-server.js', import.meta.url), 'utf8');
  const м = код.match(/const STATS_KEY\s*=\s*process\.env\.STATS_KEY\s*\|\|\s*'([^']+)'/);
  return м ? м[1] : '';
}

function прочитатьСнимки() {
  if (!existsSync(СНИМКИ)) return [];
  return readFileSync(СНИМКИ, 'utf8').split(/\r?\n/).filter(Boolean)
    .map(с => { try { return JSON.parse(с); } catch { return null; } })
    .filter(о => о && Array.isArray(о.days) && о.at);
}

async function текущая() {
  if (БЕЗ_САЙТА) return null;
  try {
    const r = await fetch(SITE + '/stats?key=' + encodeURIComponent(ключ()) + '&json=1',
      { headers: { 'User-Agent': 'Mozilla/5.0 otchet-nedeli poisk-check' }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) return null;
    const о = await r.json();
    return Array.isArray(о.days) ? о : null;
  } catch { return null; }
}

// Последний снимок каждого запуска сервера; запуски — по времени начала
function запуски(снимки) {
  // начало запуска у снимков одного сервера совпадает с точностью до секунд: ближе двух минут — один запуск
  const все = снимки.map(с => { const t = Date.parse(с.at), начало = t - (с.uptimeSec || 0) * 1000;
    return Object.assign({}, с, { _начало: начало, _конец: t, _с: с.since ? Date.parse(с.since) : начало }); })
    .sort((a, b) => a._начало - b._начало || a._конец - b._конец);
  const out = [];
  for (const с of все) {
    const п = out[out.length - 1];
    if (п && Math.abs(с._начало - п._начало) < 2 * 60000) { if (с._конец >= п._конец) out[out.length - 1] = с; }
    else out.push(с);
  }
  return out;
}

// Склейка чисел запусков: свои данные — сумма, переехавшие (запуск видит события раньше
// конца предыдущего) — большее из двух
function склеить(список, взять) {
  let итог = 0, конец = -Infinity;
  for (const з of список) {
    const v = взять(з) || 0;
    итог = з._с < конец ? Math.max(итог, v) : итог + v;
    конец = Math.max(конец, з._конец);
  }
  return итог;
}
function склеитьКлючи(список, массив, ключПоля, число) {
  const ключи = new Set();
  список.forEach(з => (з[массив] || []).forEach(x => ключи.add(x[ключПоля])));
  const out = [];
  for (const к of ключи) {
    const n = склеить(список, з => { const x = (з[массив] || []).find(y => y[ключПоля] === к); return x ? число(x) : 0; });
    if (n > 0) out.push([к, n]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

// 404 без мусора: куски скриптов, /null, и то, куда ходили только роботы
const мусор = п => { let д = String(п || ''); try { д = decodeURIComponent(д); } catch {} return /['"<>`]|\s\+|\+\s|(^|\/)(null|undefined)\/?$/.test(д); };
const СВЯЗЬ = { knizu: '«Напишите нам»', fb_open: 'открыли форму пожелания', fb_sent: 'отправили пожелание', place_sent: 'предложили место' };

async function главная() {
  const снимки = прочитатьСнимки();
  const сейчас = await текущая();
  if (сейчас) снимки.push(Object.assign({ снято: new Date().toISOString() }, сейчас));
  const теперь = Date.now();
  const дни = [];
  for (let i = 6; i >= 0; i--) дни.push(деньМинск(теперь - i * ДЕНЬ));
  const список = запуски(снимки).filter(з => з._конец > теперь - 8 * ДЕНЬ);
  const строки = [];
  строки.push('Отчёт недели ' + ддмм(дни[0]) + '–' + ddmmСегодня(дни) + ' · ' + (сейчас ? new URL(SITE).host : 'nochy.by') + ' · снимков ' + снимки.length
    + (сейчас ? ' (с текущим)' : БЕЗ_САЙТА ? '' : ' (сайт не ответил — только файл)'));
  if (!список.length) {
    строки.push('Нет данных: за неделю нет ни одного снимка статистики (' + СНИМКИ + ').');
    return записать(строки);
  }
  // по дням: входы / люди
  let входов = 0, людей = 0, нет404 = 0;
  const поДням = дни.map(д => {
    const у = список.filter(з => (з.days || []).some(x => x.day === д));
    if (!у.length) return ддмм(д) + ' нет данных';
    const h = склеить(у, з => (з.days.find(x => x.day === д) || {}).hits);
    const p = склеить(у, з => (з.days.find(x => x.day === д) || {}).people);
    входов += h; людей += p; нет404 += склеить(у, з => (з.days.find(x => x.day === д) || {}).notFound);
    return ддмм(д) + ' ' + h + '/' + p;
  });
  строки.push('Входы/люди по дням: ' + поДням.join(' · '));
  строки.push('За неделю: входов ' + входов + ', людей ≈' + людей + ' (сумма по дням; 404 всего ' + нет404 + ', с мусором).');
  // метки постов
  const метки = склеитьКлючи(список, 'marks', 'from', x => x.hits).filter(([к]) => /^tiktok-/i.test(к));
  const меткиOpen = склеитьКлючи(список, 'marks', 'from', x => x.openSessions);
  const кOpen = new Map(меткиOpen);
  строки.push('Метки постов: ' + (метки.length
    ? метки.slice(0, 6).map(([к, n]) => к + ' ' + n + (кOpen.get(к) ? (' (к объявлениям ' + кOpen.get(к) + ')') : '')).join(', ')
    : 'нет данных'));
  const площадки = склеитьКлючи(список, 'openByHost', 'host', x => x.n);
  строки.push('К объявлениям по площадкам: ' + (площадки.length ? площадки.map(([к, n]) => к + ' ' + n).join(', ') : 'нет данных'));
  const входы = склеитьКлючи(список, 'entryPages', 'path', x => x.n);
  строки.push('Страницы входа (топ-5): ' + (входы.length ? входы.slice(0, 5).map(([к, n]) => к + ' ' + n).join(', ') : 'нет данных'));
  const н404 = склеитьКлючи(список, 'notFound', 'path', x => x.people).filter(([к]) => !мусор(к));
  строки.push('404 у людей (без мусора): ' + (н404.length ? ('всего ' + н404.reduce((s, x) => s + x[1], 0) + ': '
    + н404.slice(0, 5).map(([к, n]) => к + ' ' + n).join(', ')) : 'нет'));
  const нули = склеитьКлючи(список, 'zeroSearches', 'search', x => x.n);
  строки.push('Поиски без результатов: ' + (нули.length ? нули.slice(0, 5).map(([к, n]) => к + ' ' + n).join(', ') : 'нет данных'));
  const есть = список.some(з => Array.isArray(з.contact));
  const связь = склеитьКлючи(список, 'contact', 'what', x => x.n);
  строки.push('Связь: ' + (связь.length ? связь.map(([к, n]) => (СВЯЗЬ[к] || к) + ' ' + n).join(', ') : есть ? 'никто не нажимал' : 'нет данных'));
  const естьЖдут = список.some(з => Array.isArray(з.subscribe));
  const ждут = склеитьКлючи(список, 'subscribe', 'filters', x => x.n);
  строки.push('Ждут уведомлений: ' + (ждут.length ? ждут.slice(0, 5).map(([к, n]) => к + ' ' + n).join(', ') : естьЖдут ? 'никто не нажимал' : 'нет данных'));
  return записать(строки);
}
function ddmmСегодня(дни) { return ддмм(дни[дни.length - 1]); }

function записать(строки) {
  const д = деньМинск(Date.now());
  const файл = join(ПАПКА, 'Отчёт недели ' + ддмм(д) + '.txt');
  mkdirSync(ПАПКА, { recursive: true });
  writeFileSync(файл, строки.slice(0, 15).join('\r\n') + '\r\n', 'utf8');
  console.log(строки.slice(0, 15).join('\n'));
  console.log('\nЗаписано: ' + файл);
  return 0;
}
// Выходим через exitCode, а не process.exit: резкий выход при открытом
// соединении на Windows роняет node с ошибкой libuv.
process.exitCode = await главная();
