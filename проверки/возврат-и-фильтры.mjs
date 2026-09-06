// Что человек делает руками, и что от этого ломалось.
//
// Ловит:
//   1) фильтр по жилью слетал: настроил Ивацевичи, ушёл на страницу места
//      и вернулся — снова город по умолчанию;
//   2) «Ко всем местам» уводило в чужой раздел: пришёл из поиска жилья,
//      а вернулся в список мест по Минску;
//   3) тип жилья «любой» не выбирался вовсе;
//   4) при нуле по типу выдача молчала, вместо того чтобы предложить другой;
//   5) в карточке на карте не листались фотографии.
//
// Нужен Chrome. Сервер должен быть уже запущен.
//   npm run проверка-возврата
//   npm run проверка-возврата https://poisk-kvartir.onrender.com

import { spawn } from 'node:child_process';

const SITE = process.argv[2] || 'http://127.0.0.1:8080';
const PORT = 9460 + (process.pid % 300), sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + process.env.TEMP + '/cdp-back-' + process.pid, 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 40 && !url; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!url) await sleep(500);
}
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
const снимки = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Network.requestWillBeSent' && /\.(jpg|jpeg|png|webp)/i.test(m.params.request.url)) снимки.push(m.params.request.url);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

let failed = 0, passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  OK   ' + name); }
  else { failed++; console.log('  ПАДАЕТ ' + name + (detail ? ('  — ' + detail) : '')); }
};
const открыть = async (путь, ждём = '#grid .card', сек = 90) => {
  await send('Page.navigate', { url: SITE + путь });
  for (let i = 0; i < сек; i++) { if (await js(`document.querySelectorAll(${JSON.stringify(ждём)}).length > 0`)) break; await sleep(1000); }
  await sleep(1500);
};

try {
  console.log('\n=== тип жилья «любой» ===');
  {
    await открыть('/?region=brest&type=flat');
    const есть = await js(`!!document.querySelector('#type option[value="any"]')`);
    check('в списке типов есть «любой»', есть, 'выбрать все виды сразу нельзя');
    if (есть) {
      const кв = await js(`(document.querySelector('#stat')||{}).textContent`);
      await js(`$('#type').value='any'; run(); 1`);
      for (let i = 0; i < 60; i++) { if (!/Ищу/.test(await js(`(document.querySelector('#stat')||{}).textContent`) || '')) break; await sleep(1000); }
      await sleep(1500);
      const лю = await js(`(document.querySelector('#stat')||{}).textContent`);
      const n = s => +((String(s).match(/Найдено\s+(\d+)/) || [])[1] || 0);
      console.log('    только квартиры: ' + n(кв) + ' · любой тип: ' + n(лю));
      check('«любой» находит больше, чем один вид', n(лю) > n(кв),
            'квартир ' + n(кв) + ', «любой» ' + n(лю));
    }
  }

  console.log('\n=== по типу ничего нет — говорим об этом ===');
  {
    // в Ивацевичах сдают только квартиры: усадеб там нет
    await открыть('/?type=usadba&name=%D0%B8%D0%B2%D0%B0%D1%86%D0%B5%D0%B2%D0%B8%D1%87%D0%B8', '#grid .empty');
    const пусто = await js(`(document.querySelector('#grid .empty')||{}).textContent || ''`);
    check('усадьбы не подменяются квартирами',
          /тип/i.test(пусто) && !/Смягчите фильтры\.$/.test(пусто.trim()),
          'показано: ' + пусто.slice(0, 70));
    for (let i = 0; i < 30; i++) { if (await js(`!!document.querySelector('.empty-go')`)) break; await sleep(1000); }
    const предложение = await js(`(document.querySelector('#empt')||{}).textContent || ''`);
    check('предложено посмотреть другой тип', /Показать любой тип/.test(предложение),
          'подсказки нет: ' + предложение.slice(0, 80));
    if (/Показать любой тип/.test(предложение)) {
      await js(`document.querySelector('.empty-go').click(); 1`);
      for (let i = 0; i < 60; i++) { if (await js(`document.querySelectorAll('#grid .card').length > 0`)) break; await sleep(1000); }
      check('кнопка действительно показывает варианты',
            (await js(`document.querySelectorAll('#grid .card').length`)) > 0,
            'после нажатия по-прежнему пусто');
    }
  }

  console.log('\n=== фильтр по жилью не слетает ===');
  {
    await открыть('/?region=brest&name=%D0%B8%D0%B2%D0%B0%D1%86%D0%B5%D0%B2%D0%B8%D1%87%D0%B8');
    const было = await js(`JSON.stringify({name:$('#qname').value, region:$('#region').value})`);
    // уходим на страницу места и возвращаемся, как это делает человек
    await send('Page.navigate', { url: SITE + '/mesto/244-nesvizhskij-zamok' });
    await sleep(3500);
    const назад = await js(`(document.getElementById('back')||{}).getAttribute('href')`);
    check('со страницы места возврат ведёт в поиск жилья',
          назад && /name=/.test(назад), 'ведёт на: ' + назад);
    await send('Page.navigate', { url: SITE + (назад || '/') });
    for (let i = 0; i < 60; i++) { if (await js(`!!document.querySelector('#qname')`)) break; await sleep(500); }
    await sleep(2000);
    const стало = await js(`JSON.stringify({name:$('#qname').value, region:$('#region').value})`);
    check('настройки поиска жилья на месте', стало === было, было + ' → ' + стало);
  }

  console.log('\n=== пришли из жилья через «Что посмотреть рядом» ===');
  {
    await открыть('/?region=brest&name=%D0%B8%D0%B2%D0%B0%D1%86%D0%B5%D0%B2%D0%B8%D1%87%D0%B8');
    await js(`placesNear(0); 1`);
    await sleep(4000);
    // адрес стал адресом вкладки мест — настройки жилья должны пережить это
    await send('Page.navigate', { url: SITE + '/mesto/244-nesvizhskij-zamok' });
    await sleep(3000);
    // Щёлкаем по ссылке, а не переходим командой: при переходе командой
    // браузер не ставит referrer, а починка держится именно на нём.
    await js(`document.getElementById('back').click(); 1`);
    for (let i = 0; i < 60; i++) { if (await js(`!!document.querySelector('#qname')`)) break; await sleep(500); }
    await sleep(2500);
    const имя = await js(`$('#qname').value`);
    check('поиск по названию «ивацевичи» уцелел', /ивацевичи/i.test(имя || ''),
          'в поле осталось: «' + имя + '»');
  }

  console.log('\n=== фотографии в карточке на карте ===');
  {
    await открыть('/?region=minsk&type=flat');
    снимки.length = 0;
    await js(`setView('map'); 1`);
    await sleep(6000);
    const открыл = await js(`(async function(){
      var сп=[]; window.__mlayer && window.__mlayer.eachLayer(function(l){ if(l.getPopup) сп.push(l); });
      if(!сп.length) return '';
      // метка может лежать внутри скопления — сначала раскрываем его
      var м = сп[0];
      await new Promise(function(res){ if(window.__mlayer.zoomToShowLayer) window.__mlayer.zoomToShowLayer(м,res); else res(); });
      await new Promise(function(r){ setTimeout(r,1200); });
      м.openPopup();
      return 'да';
    })()`);
    await sleep(3500);
    const всего = await js(`document.querySelectorAll('.leaflet-popup .mp-ph1').length`);
    check('в карточке на карте есть фотографии', открыл === 'да' && всего > 0, 'снимков: ' + всего);
    const много = await js(`!!document.querySelector('.leaflet-popup .mp-ph')`);
    if (много) {
      // Ленивость проверяем по разметке, а не по запросам в сеть: те же
      // снимки уже лежат в кэше после ленты, и запроса может не быть вовсе.
      const безАдреса = await js(`Array.from(document.querySelectorAll('.leaflet-popup .mp-ph1'))
        .filter(function(э){ return !э.getAttribute('src'); }).length`);
      const всегоВОкне = await js(`document.querySelectorAll('.leaflet-popup .mp-ph1').length`);
      check('при открытии адрес есть только у первого снимка',
            безАдреса === всегоВОкне - 1, 'без адреса ' + безАдреса + ' из ' + всегоВОкне);
      const счёт1 = await js(`(document.querySelector('.leaflet-popup .mp-ph-n')||{}).textContent`);
      await js(`document.querySelector('.leaflet-popup .mp-ph-r').click(); 1`);
      await sleep(2000);
      const счёт2 = await js(`(document.querySelector('.leaflet-popup .mp-ph-n')||{}).textContent`);
      check('фотографии листаются (' + счёт1 + ' → ' + счёт2 + ')', счёт1 !== счёт2, 'счётчик не сдвинулся');
      check('видно ровно один снимок',
            (await js(`document.querySelectorAll('.leaflet-popup .mp-ph1.on').length`)) === 1);
      const сАдресом = await js(`Array.from(document.querySelectorAll('.leaflet-popup .mp-ph1'))
        .filter(function(э){ return !!э.getAttribute('src'); }).length`);
      check('после листания адрес появился у показанного и соседних',
            сАдресом > 1 && сАдресом < всегоВОкне + 1,
            'адрес есть у ' + сАдресом + ' из ' + всегоВОкне);
    } else {
      console.log('    у первой метки один снимок — листать нечего, это не ошибка');
    }
  }
} finally {
  console.log('\nИтог: успешно ' + passed + ', провалено ' + failed);
  try { ws.close(); } catch {}
  chrome.kill();
}
process.exit(failed ? 1 : 0);
