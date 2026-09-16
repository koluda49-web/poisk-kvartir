# План: шесть улучшений (16.09)

> **Для исполнителя-агента:** обязательный навык — superpowers:subagent-driven-development (лучше) или superpowers:executing-plans. Шаги — чекбоксы `- [ ]`.

**Цель:** «По пути» по всей дороге, «что рядом» и «выходные» у объявлений, места на городских страницах, ссылка на подборку избранного и «Рекомендуемые» вместо «дешёвые сверху» по умолчанию.

**Устройство:** всё в `kvartiry-server.js` (серверные функции + клиентский код в `PAGE` и в странице `/marshrut`), проверки — отдельные скрипты в `проверки/`. Хранилища нет: всё, что нужно запомнить, — в ссылке или в браузере посетителя.

**Стек:** Node ≥18 без зависимостей, Leaflet на главной, headless Chrome через `проверки/_браузер.mjs`.

Ветка: `uluchsheniya-16-09`. Рабочая папка: `C:\Users\User-NUC\Desktop\Поиск квартир`.

## Global Constraints

1. **Один файл сервера** `kvartiry-server.js` (~11 000 строк). Номера строк ниже — на коммит `678d3fb`, ищите по именам функций.
2. **Главная** — шаблонная строка `const PAGE = \`…\`` (≈строка 6832). Внутри клиентского кода **нельзя** обратные кавычки и `${`; **обратная косая черта съедается** шаблоном (в регулярках обходиться без `\`). Готовую серверную функцию можно вставить в `PAGE` как `${имя.toString()}` (так уже вставлены `перетаскиваниеСтрок`, `подогнатьСнимки`, ≈строка 9718) — подстановка не разбирается повторно, внутри такой функции `\` можно.
3. **Страница `/marshrut`** (`marshrutPage`) собирается сложением строк в одинарных кавычках; кавычки в клиентском коде — `\\"`.
4. Стиль: русские имена, комментарии по-русски и объясняют «зачем», плотность — как в соседнем коде. Палитра главной — CSS-переменные (`--accent`, `--txt-2`, `--txt-3`, `--line`, `--surface-2`); страницы под поиск — `СТИЛЬ_СПИСКА`.
5. **Без флагов и политики. Ничего рекламного** (никаких плашек «хит», «лучшее предложение», ярких баннеров): новые блоки — обычное содержание в палитре сайта.
6. **Не выдумывать фактов.** В текстах — только данные сайта: названия и категории мест, расстояния, число объявлений, цены из выдачи.
7. **Фотографии** — только те, что сайт уже показывает (`p.pic` мест, `x.photos` объявлений). Папку `фото-точек/` и её снимки не трогать.
8. **Процессы.** НИКОГДА `taskkill /IM chrome.exe`, `/IM node.exe`, `pkill node` и любое убийство по имени — у владельца открыт свой Chrome и свои node. Порт **8080 не использовать**. Локальный сервер для проверок:
   ```bash
   cd "/c/Users/User-NUC/Desktop/Поиск квартир"
   (PORT=8241 node kvartiry-server.js > "$TEMP/srv8241.log" 2>&1 &)
   for i in $(seq 1 60); do curl -s http://127.0.0.1:8241/ping >/dev/null && break; sleep 2; done
   ```
   Остановить — только свой PID по порту:
   ```bash
   PID=$(netstat -ano | grep ":8241 " | grep LISTENING | awk '{print $5}' | head -1); [ -n "$PID" ] && taskkill //F //PID $PID
   ```
   Площадки (Kufar, Realt, Flatbook, Check-in, Kvartirka) включены по умолчанию; каталоги Check-in и Kvartirka собираются ~3 минуты — проверки выдачи запускать после этого.
9. **Проверки в браузере** — только через `запуститьChrome` из `проверки/_браузер.mjs` (он сам удаляет профиль `%TEMP%\cdp-*`), **по одной за раз**. После прогона убедиться, что свежих `%TEMP%\cdp-*` не осталось: `ls -d "$TEMP"/cdp-* 2>/dev/null`. Итоговая строка проверки — `Пройдено N, падает M`, код выхода 1 при падениях. Новую проверку добавить в `package.json` (`"проверка-…": "node проверки/….mjs"`). Порты Chrome новых проверок: **9631–9635** (заняты: 9351, 9355, 9371, 9451, 9460, 9463, 9511, 9561, 9563, 9601–9610, 9612, 9623, 9675).
10. **Все существующие проверки должны проходить** после каждой задачи, которую они касаются, и все вместе — в конце: `скрипт-страницы`, `страницы-и-выдача`, `seo`, `поиск-и-кэш`, `фильтры`, `вкладки`, `возврат-и-фильтры`, `места`, `по-пути`, `план-дня`, `порядок-маршрута`, `рекомендуемые-маршруты`, `маршруты-из-видео`, `своя-точка`, `пустые-страницы`, `слайдер`, `телефон`. Любую правку `PAGE` сразу проверять `node проверки/скрипт-страницы.mjs http://127.0.0.1:8241`.
11. **Телефон:** всё новое должно работать на ширине ~400 px без прокрутки страницы вбок (`document.documentElement.scrollWidth <= innerWidth`).
12. **Коммит** после каждой задачи в `uluchsheniya-16-09`, сообщение по-русски (что и зачем), последняя строка `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Не пушить. Яндекс.Метрику в этом плане не трогать (отдельная задача).

### Каркас проверки в браузере

Все новые браузерные проверки начинаются так (порт и имя — из задачи):

```js
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9631, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const getJSON = async u => (await fetch(u)).json();

const { закрыть } = запуститьChrome(PORT, 'imya');
let ws, id = 0; const pend = new Map(); const ошибки = [];
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') ошибки.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') ошибки.push((m.params.args || []).map(a => a.value || a.description).join(' '));
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const ждать = async (усл, раз = 80) => { for (let i = 0; i < раз; i++) { if (await js(усл)) return true; await sleep(250); } return false; };

// … проверки задачи …

check('в консоли нет ошибок', ошибки.length === 0, ошибки.slice(0, 2).join(' | '));
console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
```

---

### Task 1: «По пути» — вдоль всей дороги

**Что не так.** `ближеКЛинии` (≈строка 4736) берёт 12 ближайших к линии мест. На маршруте Минск → Гродно (`p=53.90240,27.56190;53.67780,23.82950`, 276 км) все 12 — в самом Минске и Гродно (Кальварийский костёл 0,1 км, Лямус 0,2 км…), а придорожные Раков (4726), Ивье (8209), Мурованка (286), Скидель (4198) не попадают. Прототип алгоритма ниже на живом справочнике дал: 4980, 4351, 4356, **4726**, 8203, 5062, 8211, **8209**, 5029, **286**, 4191, **4198** — все четыре.

**Files:**
- Modify: `kvartiry-server.js` — `ближеКЛинии` (≈4736–4776), комментарий над `местаПоПути` (≈4700).
- Modify: `проверки/по-пути.mjs`.

**Interfaces:**
- Consumes: `distKm(a1,o1,a2,o2)` (≈2823), `разряд(p)` (≈2234), `placesRaw()` (поля `id,name,addr,lat,lng,pic,cat,group,rating`).
- Produces: `/api/route/near` → `{ ok, items:[{id,name,addr,lat,lng,pic,cat,km,along}] }`, `along` — км от начала маршрута по линии (один знак), список **отсортирован по `along`** (порядок дороги). Кэш и ключи (`ПО_ПУТИ_КЭШ`, `near|…`) не меняются.

**Правила отбора** (константы в начале функции):
- как сейчас: рамка линии + 0,1°, ≤ 5 км от линии, без `skip`, без мест ближе 0,3 км к точке маршрута;
- `длина` — длина линии (сумма прорежённых отрезков), `радиусТочки = min(15, 0.06 × длина)` км. Место ближе `радиусТочки` к какой-либо точке маршрута — «у точки»: оно идёт только добором, **не больше 2 на каждую точку маршрута** (к ближайшей);
- остальные («дорожные») раскладываются в `кусков = clamp(round(длина / 40), 1, 6)` равных кусков по `along`; внутри куска порядок: `разряд` ↑, `rating` ↓, `km` ↑;
- набор до 12 по кругу: по одному из каждого куска; первый проход пропускает места ближе 2 км к уже взятому (чтобы не брать пять дотов одного укрепрайона), второй — без этого условия; затем добор «у точек»;
- итог сортируется по `along` (при равенстве — по `km`).

- [ ] **Step 1: Дописать в проверку ожидания нового порядка и Минск → Гродно**

В `проверки/по-пути.mjs`:

1) В `проверитьОтвет` заменить проверку порядка и полей:

```js
  check(имя + ': по порядку вдоль дороги', it.every((p, i) => typeof p.along === 'number' && (!i || it[i - 1].along <= p.along)), it.map(p => p.along).join(','));
  // …
  check(имя + ': у мест все поля', it.every(p => ['id', 'name', 'addr', 'lat', 'lng', 'pic', 'cat', 'km', 'along'].every(k => k in p)));
```
(строку `по возрастанию расстояния` удалить).

2) После проверок неправильного `p` добавить:

```js
// Длинная дорога: места должны идти вдоль всей дороги, а не только в городах на концах
{
  const pМГ = '53.90240,27.56190;53.67780,23.82950';
  const дорогаМГ = await getJSON(SITE + '/api/route?p=' + pМГ);
  if (дорогаМГ.ok) {
    const d = await getJSON(SITE + '/api/route/near?p=' + pМГ);
    const it = проверитьОтвет('Минск—Гродно', d, [{ lat: 53.9024, lng: 27.5619 }, { lat: 53.6778, lng: 23.8295 }], []);
    const ids = it.map(p => String(p.id));
    const придорожные = ['4726', '8209', '286', '4198'].filter(x => ids.includes(x));
    check('Минск—Гродно: из Ракова, Ивья, Мурованки, Скиделя есть хотя бы 3', придорожные.length >= 3, ids.join(','));
    const радиус = Math.min(15, 0.06 * дорогаМГ.km);
    const уМинска = it.filter(p => км(53.9024, 27.5619, p.lat, p.lng) < радиус).length;
    const уГродно = it.filter(p => км(53.6778, 23.8295, p.lat, p.lng) < радиус).length;
    check('Минск—Гродно: у каждого конца не больше 2 мест', уМинска <= 2 && уГродно <= 2, уМинска + ' / ' + уГродно);
    check('Минск—Гродно: места на всей дороге (разброс along ≥ 60% длины)',
      it.length > 1 && it[it.length - 1].along - it[0].along >= 0.6 * дорогаМГ.km, it.map(p => p.along).join(','));
  } else console.log('  (OSRM не ответил — Минск—Гродно пропускаю)');
}
```

3) В блоке второго экземпляра сервера ожидание `ждёмЛВ` посчитать по новым правилам (линия у поддельного OSRM — прямая):

```js
    const поНовымПравилам = (места, a, b, skip) => {
      const длина = км(a.lat, a.lng, b.lat, b.lng), радиус = Math.min(15, 0.06 * длина);
      const годные = поСправочнику(места, a, b, skip);
      let уA = 0, уB = 0, дорожных = 0;
      годные.forEach(p => {
        const дA = км(a.lat, a.lng, p.lat, p.lng), дB = км(b.lat, b.lng, p.lat, p.lng);
        if (Math.min(дA, дB) >= радиус) дорожных++; else if (дA <= дB) уA++; else уB++;
      });
      return Math.min(12, дорожных + Math.min(2, уA) + Math.min(2, уB));
    };
    const ждёмЛВ = поНовымПравилам(местаВторого, липнишки, вороново, ['5069', '910027']);
```
и заголовок проверки: `'по дорогам Липнишки—Вороново: мест столько, сколько по новым правилам (' + ждёмЛВ + ')'`.

4) В разделе страницы после `две точки: секция «По пути» видна` добавить:

```js
{
  const естьИды = await иды();
  const порядокAPI = (await getJSON(SITE + '/api/route/near?' + (await js(`ключПоПути()`)))).items
    .map(p => String(p.id)).filter(x => !естьИды.includes(x));
  check('лента идёт в порядке дороги, как в ответе сервера', JSON.stringify(await карточки()) === JSON.stringify(порядокAPI), (await карточки()).join(','));
}
```

- [ ] **Step 2: Запустить — должно падать**

Сервер на 8241 (раздел Global Constraints, п. 8), затем `node проверки/по-пути.mjs http://127.0.0.1:8241`.
Ожидается: ПАДАЕТ «по порядку вдоль дороги», «у мест все поля», «из Ракова… хотя бы 3», «у каждого конца не больше 2».

- [ ] **Step 3: Переписать `ближеКЛинии`**

```js
// Места «по пути»: не дальше 5 км от дороги и — главное — вдоль всей дороги.
// Раньше брали 12 ближайших к линии, и на маршруте Минск → Гродно все 12
// оказывались в самих городах на концах: там мест больше всего и до линии
// ноль метров. Придорожные Раков, Ивье, Мурованка и Скидель не попадали.
// Теперь дорога делится на куски по ~40 км, из каждого берём по очереди
// лучшее (разряд, рейтинг, близость к дороге), а места в городах-точках
// маршрута — только добором, не больше двух на точку.
function ближеКЛинии(все, линия, пары, пропустить){
  const ПРЕДЕЛ = 5, ЗАПАС = 0.1, МАКС = 12, У_ТОЧКИ_МАКС = 2, СОСЕДИ_КМ = 2;
  let юг = 90, север = -90, запад = 180, восток = -180;
  линия.forEach(c => { юг = Math.min(юг, c[0]); север = Math.max(север, c[0]);
                       запад = Math.min(запад, c[1]); восток = Math.max(восток, c[1]); });
  юг -= ЗАПАС; север += ЗАПАС; запад -= ЗАПАС; восток += ЗАПАС;
  // Равнопромежуточная проекция вокруг середины рамки: на сотне километров
  // ошибка — метры, а считать в разы проще, чем по сфере.
  const R = 6371 * Math.PI / 180, cos = Math.cos((юг + север) / 2 * Math.PI / 180);
  const xy = c => [c[1] * R * cos, c[0] * R];
  // У OSRM вершина на каждые десятки метров — для «до 5 км» хватает вершин через 200 м.
  const отрезки = [];
  линия.forEach((c, i) => {
    const q = xy(c), послед = отрезки[отрезки.length - 1];
    if(!послед || i === линия.length - 1 || Math.hypot(q[0] - послед[0], q[1] - послед[1]) >= 0.2) отрезки.push(q);
  });
  if(отрезки.length === 1) отрезки.push(отрезки[0]);
  // сколько километров от начала линии до каждой вершины
  const пройдено = [0];
  for(let i = 1; i < отрезки.length; i++)
    пройдено.push(пройдено[i-1] + Math.hypot(отрезки[i][0] - отрезки[i-1][0], отрезки[i][1] - отрезки[i-1][1]));
  const длина = пройдено[пройдено.length - 1];
  // «В городе-точке»: на дороге в 276 км — 15 км, на дороге в 28 км — 1,7 км
  const радиусТочки = Math.min(15, длина * 0.06);
  const убрать = new Set(пропустить);
  const дорожные = [], уТочек = пары.map(() => []);
  for(const p of все){
    if(!(p.lat >= юг && p.lat <= север && p.lng >= запад && p.lng <= восток)) continue;
    if(убрать.has(String(p.id))) continue;
    let ближняя = 0, доТочки = Infinity;
    пары.forEach((c, i) => { const d = distKm(c[0], c[1], p.lat, p.lng); if(d < доТочки){ доТочки = d; ближняя = i; } });
    // это сама точка маршрута (или она же под другим номером)
    if(доТочки < 0.3) continue;
    const [px, py] = xy([p.lat, p.lng]);
    let лучшее = Infinity, где = 0;
    for(let i = 1; i < отрезки.length; i++){
      const [ax, ay] = отрезки[i-1], [bx, by] = отрезки[i];
      const dx = bx - ax, dy = by - ay, l2 = dx*dx + dy*dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / l2)) : 0;
      const ex = ax + t*dx - px, ey = ay + t*dy - py, d2 = ex*ex + ey*ey;
      if(d2 < лучшее){ лучшее = d2; где = пройдено[i-1] + t * Math.sqrt(l2); }
    }
    const км = Math.sqrt(лучшее);
    if(км > ПРЕДЕЛ) continue;
    const м = { id:p.id, name:p.name, addr:p.addr, lat:p.lat, lng:p.lng, pic:p.pic || '', cat:p.cat || '',
                km: Math.round(км * 10) / 10, along: Math.round(где * 10) / 10,
                р: разряд(p), рейтинг: p.rating || 0 };
    (доТочки < радиусТочки ? уТочек[ближняя] : дорожные).push(м);
  }
  const лучше = (a, b) => a.р - b.р || b.рейтинг - a.рейтинг || a.km - b.km;
  const кусков = Math.max(1, Math.min(6, Math.round(длина / 40)));
  const куски = Array.from({ length: кусков }, () => []);
  дорожные.forEach(м => куски[Math.min(кусков - 1, Math.floor(м.along / (длина || 1) * кусков))].push(м));
  куски.forEach(к => к.sort(лучше));
  const итог = [];
  const рядомСВзятым = м => итог.some(x => distKm(x.lat, x.lng, м.lat, м.lng) < СОСЕДИ_КМ);
  // по кругу по одному из куска; сначала не берём соседей уже взятых, потом добираем любых
  for(const строго of [true, false]){
    for(let было = -1; итог.length < МАКС && итог.length !== было; ){
      было = итог.length;
      for(const к of куски){
        if(итог.length >= МАКС) break;
        const м = к.find(x => !итог.includes(x) && !(строго && рядомСВзятым(x)));
        if(м) итог.push(м);
      }
    }
  }
  уТочек.forEach(список => список.sort(лучше).slice(0, У_ТОЧКИ_МАКС)
    .forEach(м => { if(итог.length < МАКС) итог.push(м); }));
  return итог.sort((a, b) => a.along - b.along || a.km - b.km)
    .map(м => ({ id:м.id, name:м.name, addr:м.addr, lat:м.lat, lng:м.lng, pic:м.pic, cat:м.cat, km:м.km, along:м.along }));
}
```

В комментарии над `ПО_ПУТИ_КЭШ` заменить «ближайшие первыми, до 12» на «вдоль всей дороги, по порядку от начала, до 12».

Клиент `/marshrut` менять не нужно: `показатьПоПути` рисует карточки в порядке ответа, а он теперь — порядок дороги. Подпись «N км от дороги» остаётся.

- [ ] **Step 4: Перезапустить сервер (по PID) и прогнать**

`node проверки/по-пути.mjs http://127.0.0.1:8241` → `Пройдено N, падает 0`.
Затем `node проверки/план-дня.mjs http://127.0.0.1:8241` и `node проверки/рекомендуемые-маршруты.mjs http://127.0.0.1:8241` (они тоже открывают ленту) → падает 0. Проверить, что `%TEMP%\cdp-*` не остались.

- [ ] **Step 5: Коммит**

```bash
git add kvartiry-server.js проверки/по-пути.mjs
git commit -m "По пути: места вдоль всей дороги, а не в городах на концах; порядок дороги в ленте

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: «Рядом» в карточках объявлений

**Как устроено сейчас.** Карточки главной рисует `renderCards()` (≈8351) из `window.__items` (или `FAVS` в избранном); у каждой есть кнопка «🏰 Что посмотреть рядом» → `placesNear(idx)` (≈9018, открывает вкладку мест в радиусе 25 км). Список мест на главной для жилья не загружается. Карточек на странице 24 (`PAGE_SIZE`), объявлений в выдаче — до тысяч.

**Решение.** Считать на сервере только для видимой страницы: один запрос `GET /api/places/ryadom?p=lat,lng;…` (до 24 пар) после отрисовки карточек. 24 точки × ~812 мест с отсечением по рамке — доли миллисекунды, отдельный пространственный индекс не нужен (если справочник вырастет в десятки раз — сетка по 0,3°×0,5°). В браузере ответы кэшируются по координатам, повторная отрисовка сервер не спрашивает. Только объявления с точными координатами (`!x.approx`) и не отели России (`x.src !== 'H101'`).

**Files:**
- Modify: `kvartiry-server.js` — новые функции рядом с `местаПоПути` (≈4700); маршрут `/api/places/ryadom` рядом с `/api/places/popular` (≈10737); `renderCards` (≈8351) и новый блок клиентского кода после `placesNear` (≈9026) в `PAGE`; CSS рядом с `.seenear` (≈7670).
- Create: `проверки/рядом-с-жильём.mjs` (порт **9631**).
- Modify: `package.json` — `"проверка-рядом-с-жильём": "node проверки/рядом-с-жильём.mjs"`.

**Interfaces:**
- Produces (сервер):
  - `местаВокруг(все, lat, lng, радиусКм)` → `[{ p, км }]` — места в радиусе, порядок `разряд(p)` ↑, `км` ↑.
  - `рядомСЖильём(все, lat, lng)` → `{ n, top:[{id,name,km,href}], w }`: `n` — мест в 25 км; `top` — до 2 мест (порядок `местаВокруг`, второе не ближе 1 км к первому), `km` с одним знаком, `href` = `/mesto/<id>-<slugify(name)>`; `w` — `выходныеОтЖилья(все, lat, lng).length >= 3` (функция из Task 5; в этой задаче — заглушка `w:false`, Task 5 её подключит).
  - `GET /api/places/ryadom?p=lat,lng;…` → `{ ok:true, items:[…] }` в порядке пар; 1..24 пары (`парыМаршрута`), иначе `{ ok:false }`. `Cache-Control: public, max-age=600`.
- Produces (клиент, `PAGE`): `РЯДОМ_КЭШ`, `ключРядом(x)`, `показатьРядом(idx, д)`, `дополнитьРядом(items, start)`; разметка `<div class="nb" id="nb<idx>" data-k="<lat4>,<lng4>">`. Task 5 дописывает в `показатьРядом` ссылку «выходные».

- [ ] **Step 1: Написать проверку**

`проверки/рядом-с-жильём.mjs` — каркас (порт 9631, имя `'nb'`), тело:

```js
// «Рядом» в карточках жилья: API пачкой и строка в карточке.
function км(a1, o1, a2, o2) {
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// ── API ──
const мир = [53.4514, 26.4720], глушь = [52.2000, 30.9000];   // у Мира мест много; вторая — для проверки формы ответа
const d = await getJSON(SITE + '/api/places/ryadom?p=' + [мир, глушь].map(c => c.join(',')).join(';'));
check('ok и два ответа по порядку', d.ok === true && Array.isArray(d.items) && d.items.length === 2, JSON.stringify(d).slice(0, 200));
const а = d.items[0];
const места = (await getJSON(SITE + `/api/places?lat=${мир[0]}&lng=${мир[1]}&r=25`)).items;
check('Мир: n — число мест в 25 км', а.n === места.length, а.n + ' / ' + места.length);
check('Мир: первое место — первое из /api/places', а.top[0] && String(а.top[0].id) === String(места[0].id), JSON.stringify(а.top));
check('Мир: не больше двух мест, второе не ближе 1 км к первому', а.top.length <= 2 && (а.top.length < 2 || (() => {
  const x = места.find(p => String(p.id) === String(а.top[0].id)), y = места.find(p => String(p.id) === String(а.top[1].id));
  return км(x.lat, x.lng, y.lat, y.lng) >= 1; })()));
check('Мир: km с одним знаком и совпадает с расстоянием', а.top.every(t => { const p = места.find(q => String(q.id) === String(t.id));
  return Math.round(t.km * 10) / 10 === t.km && Math.abs(км(мир[0], мир[1], p.lat, p.lng) - t.km) <= 0.06; }));
check('Мир: ссылки на страницы мест', а.top.every(t => /^\/mesto\/\d+-[a-z0-9-]+$/.test(t.href)));
check('у ответа поле w — логическое', typeof а.w === 'boolean' && typeof d.items[1].w === 'boolean');
for (const плохой of ['', 'abc', Array(25).fill('53.9,27.5').join(';')])
  check('неправильный p → ok:false (' + плохой.slice(0, 12) + '…)', (await getJSON(SITE + '/api/places/ryadom?p=' + encodeURIComponent(плохой))).ok === false);
const t0 = Date.now();
await getJSON(SITE + '/api/places/ryadom?p=' + Array(24).fill(мир.join(',')).join(';'));
check('24 точки считаются быстро (< 300 мс)', Date.now() - t0 < 300, (Date.now() - t0) + ' мс');

// ── страница ──
await send('Page.navigate', { url: SITE + '/?region=grodno&type=any' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
await ждать(`document.querySelectorAll('#grid .nb a').length > 0`, 80);
const карточки = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#grid .card')].map(function(c, i){
  var x = window.__items[(window.__page - 1) * 24 + i]; var nb = c.querySelector('.nb');
  return { approx: !!x.approx, lat: x.lat, nb: !!nb, text: nb ? nb.textContent : '' }; }))`));
check('строка «Рядом» только у точных координат', карточки.every(к => к.nb === !к.approx), JSON.stringify(карточки.filter(к => к.nb === к.approx)).slice(0, 200));
check('хоть у одной карточки «Рядом: … км»', карточки.some(к => /^Рядом: .+ \d+(,\d)? км/.test(к.text)), карточки.map(к => к.text).join(' | ').slice(0, 300));
const запросов = () => js(`performance.getEntriesByType('resource').filter(function(e){ return e.name.indexOf('/api/places/ryadom') >= 0; }).length`);
const было = await запросов();
check('на страницу — один запрос', было === 1, было);
await js(`renderCards(); 1`); await sleep(800);
check('перерисовка той же страницы не спрашивает сервер', (await запросов()) === было);
const ещё = await js(`(function(){ var b = document.querySelector('#grid .nb .nb-more'); if(!b) return null; b.click(); return 1; })()`);
if (ещё) {
  await ждать(`window.__mode === 'places'`, 40);
  check('«ещё N» открывает места рядом с жильём', await js(`window.__mode === 'places' && !!window.__plCenter`));
}
check('на 400 px страница не ездит вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
```

Добавить скрипт в `package.json`.

- [ ] **Step 2: Запустить — падает**

`node проверки/рядом-с-жильём.mjs http://127.0.0.1:8241` → API отвечает 404 JSON, проверки падают.

- [ ] **Step 3: Серверная часть**

Рядом с `местаПоПути`:

```js
// ── Что рядом с жильём ────────────────────────────────────────────────────
// Строка «Рядом: Мирский замок 0,1 км · …» в карточке объявления. Считаем
// только для видимой страницы (до 24 карточек) одним запросом: мест около
// восьмисот, с отсечением по рамке это доли миллисекунды, отдельный
// пространственный индекс пока не нужен.
const РЯДОМ_С_ЖИЛЬЁМ_КМ = 25;   // тот же радиус, что у кнопки «Что посмотреть рядом»
function местаВокруг(все, lat, lng, радиус){
  const dLat = радиус / 111, dLng = радиус / (111 * Math.cos(lat * Math.PI / 180));
  const out = [];
  for(const p of все){
    if(Math.abs(p.lat - lat) > dLat || Math.abs(p.lng - lng) > dLng) continue;
    const км = distKm(lat, lng, p.lat, p.lng);
    if(км <= радиус) out.push({ p, км });
  }
  // как список мест на вкладке: сначала разряд (замок, костёл, усадьба), потом близость
  return out.sort((a, b) => разряд(a.p) - разряд(b.p) || a.км - b.км);
}
function рядомСЖильём(все, lat, lng){
  const вокруг = местаВокруг(все, lat, lng, РЯДОМ_С_ЖИЛЬЁМ_КМ);
  const top = [];
  for(const { p, км } of вокруг){
    // часовня в двухстах метрах от уже названного замка — это то же место
    if(top.some(t => distKm(t.lat, t.lng, p.lat, p.lng) < 1)) continue;
    top.push({ id:p.id, name:p.name, lat:p.lat, lng:p.lng, km: Math.round(км * 10) / 10 });
    if(top.length === 2) break;
  }
  return { n: вокруг.length,
           top: top.map(t => ({ id:t.id, name:t.name, km:t.km, href:'/mesto/' + t.id + '-' + slugify(t.name) })),
           w: false };   // Task 5: выходныеОтЖилья(все, lat, lng).length >= 3
}
```

Маршрут (перед `/api/places/popular`):

```js
  // «Рядом» для карточек жилья: пачка координат видимой страницы
  if(u.pathname === '/api/places/ryadom'){
    const сырые = String(u.searchParams.get('p') || '').split(';').filter(Boolean);
    const пары = парыМаршрута(u.searchParams.get('p'));
    let ответ = { ok:false };
    if(пары.length >= 1 && пары.length <= 24 && пары.length === сырые.length){
      try{
        const все = await placesRaw();
        ответ = { ok:true, items: пары.map(c => рядомСЖильём(все, c[0], c[1])) };
      }catch(e){ ответ = { ok:false }; }
    }
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8',
                        'Cache-Control': ответ.ok ? 'public, max-age=600' : 'no-store'});
    res.end(JSON.stringify(ответ)); return;
  }
```
(`парыМаршрута` режет до 30 — поэтому сверка с числом сырых пар: 25 пар → `ok:false`.)

- [ ] **Step 4: Клиент в `PAGE`**

В `renderCards` перед строкой с `seenear` добавить (внутри `'<div class="bd">'`):

```js
        +((x.lat&&x.lng&&!x.approx&&x.src!=='H101')?('<div class="nb" id="nb'+idx+'" data-k="'+ключРядом(x)+'"></div>'):'')
```

и сразу после присваивания `$('#grid').innerHTML=…join('');` — `дополнитьРядом(items, start);`.

После функции `placesNear`:

```js
// ── «Рядом» в карточках жилья ─────────────────────────────────────────────
// Сервер считает места вокруг видимых карточек одним запросом; ответы
// помним по координатам, чтобы перелистывание назад и перерисовка не
// спрашивали его снова.
const РЯДОМ_КЭШ = {};
function ключРядом(x){ return (+x.lat).toFixed(4) + ',' + (+x.lng).toFixed(4); }
function показатьРядом(idx, д){
  const el = document.getElementById('nb' + idx);
  if(!el) return;
  if(!д || !д.n){ el.innerHTML = ''; return; }
  const имена = д.top.map(function(p){
    return '<a href="' + p.href + '">' + esc2(p.name) + '</a> ' + String(p.km).replace('.', ',') + ' км';
  }).join(' · ');
  const ещё = д.n > д.top.length
    ? (' · <button type="button" class="nb-more" data-near="' + idx + '">ещё ' + (д.n - д.top.length) + '</button>') : '';
  el.innerHTML = '<span class="nb-t">Рядом:</span> ' + имена + ещё;
}
async function дополнитьРядом(items, start){
  const нужно = [];
  items.forEach(function(x, i){
    if(!(x.lat && x.lng && !x.approx && x.src !== 'H101')) return;
    const к = ключРядом(x), idx = start + i;
    if(РЯДОМ_КЭШ[к]) показатьРядом(idx, РЯДОМ_КЭШ[к]); else нужно.push({ к: к, idx: idx });
  });
  if(!нужно.length) return;
  const ключи = нужно.map(function(н){ return н.к; }).filter(function(к, i, a){ return a.indexOf(к) === i; });
  try{
    const d = await (await fetch('/api/places/ryadom?p=' + encodeURIComponent(ключи.join(';')))).json();
    if(!d || !d.ok) return;
    ключи.forEach(function(к, i){ РЯДОМ_КЭШ[к] = d.items[i] || { n: 0, top: [], w: false }; });
    // Пока ждали, страницу могли перелистнуть: пишем только в ту же карточку
    нужно.forEach(function(н){
      const el = document.getElementById('nb' + н.idx);
      if(el && el.getAttribute('data-k') === н.к) показатьРядом(н.idx, РЯДОМ_КЭШ[н.к]);
    });
  }catch(e){}
}
document.addEventListener('click', function(ev){
  const b = ev.target && ev.target.closest ? ev.target.closest('[data-near]') : null;
  if(!b) return;
  ev.preventDefault();
  placesNear(+b.getAttribute('data-near'));
});
```

CSS рядом с `.seenear`:

```css
.nb{margin-top:8px;font-size:12.5px;line-height:1.45;color:var(--txt-2);overflow-wrap:anywhere}
.nb:empty{display:none}
.nb-t{color:var(--txt-3)}
.nb a{color:var(--txt);text-decoration:none;border-bottom:1px solid var(--line)}
.nb a:hover{color:var(--accent);border-color:var(--accent)}
.nb-more{font:inherit;color:var(--accent);background:none;border:0;padding:0;cursor:pointer}
```

- [ ] **Step 5: Прогнать**

Перезапустить сервер (по PID), подождать каталоги. `node проверки/скрипт-страницы.mjs http://127.0.0.1:8241`, `node проверки/рядом-с-жильём.mjs http://127.0.0.1:8241`, затем по одной `слайдер`, `телефон`, `фильтры` → падает 0.

- [ ] **Step 6: Коммит**

```bash
git add kvartiry-server.js проверки/рядом-с-жильём.mjs package.json
git commit -m "Карточки жилья: строка «Рядом» с ближайшими местами и числом мест в 25 км

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Городские страницы — «жильё + что посмотреть»

**Как устроено сейчас.** Три семейства индексируемых страниц:
- `CITY_PAGES` (≈3365) + `PAGE_KINDS` → `cityPage(slug, kind)` (≈6709): `/minsk`, `/grodno`, `/grodno-nedorogo`, `/grodno-usadby`, `/grodno-kottedzhi`… (7 × 4);
- `СПРОС` (≈6516) → `спросPage(slug)` (≈6600): районные города (`/lida`, `/polotsk`…), районы Минска, курорты с `точка` (`/braslav` уже есть, `/naroch`…); в sitemap все непустые;
- `ГИДЫ` (≈6286) → `гидPage` — там блок мест уже есть, не трогаем.

Новогрудка и Несвижа нет. На живом сайте 16.09: `grodno`+«Новогрудок» — 18 объявлений (все с точными координатами), `minsk-obl`+«Несвиж» — 34; `СПРОС_МИНИМУМ = 5`, так что страницы наполнятся. Готовые маршруты — `ВИДЕО_МАРШРУТЫ` (`/m/lida-voronovo`, `/m/braslavshchina-2-dnya`).

**Files:**
- Modify: `kvartiry-server.js` — `СПРОС` (+`novogrudok`, `nesvizh`), новые функции `центрСтраницы`, `местаДляСтраницы`, `маршрутДляСтраницы`, `блокМестРядом` (перед `cityPage`), `cityPage`, `спросPage`, `СТИЛЬ_СПИСКА` (стили блока).
- Create: `проверки/города-и-места.mjs` (без браузера + одна проверка ширины в браузере, порт **9632**).
- Modify: `package.json` — `"проверка-городов-и-мест": "node проверки/города-и-места.mjs"`; `проверки/страницы-и-выдача.mjs` — в список минимумов (≈строка 307) добавить `['novogrudok', 5], ['nesvizh', 5]`.

**Interfaces:**
- Consumes: `placesRaw()`, `distKm`, `разряд`, `slugify`, `esc`, `скл`, `ВИДЕО_МАРШРУТЫ`, `точкиВидео(м)`, `TOWN_CENTERS`, `заголовокСтраницы`, `описаниеСтраницы`, `метаСтраницы`.
- Produces:
  - `центрСтраницы(z)` → `[lat,lng] | null`: `z.центр || z.точка || TOWN_CENTERS[z.город || z.city] || null`; для `minsk-obl` и `dom-s-banej` (нет города) — `null`, блока нет.
  - `местаДляСтраницы(центр)` → до 8 мест `{id,name,cat,pic,км}` в 30 км; порядок `разряд` ↑, `rating` ↓, `км` ↑; место ближе 0,5 км к уже взятому пропускается.
  - `маршрутДляСтраницы(центр, места)` → `{ href, текст }`: первый `ВИДЕО_МАРШРУТЫ`, у которого ≥ 2 числовые точки справочника в 40 км от центра → `{ href:'/m/<slug>', текст:'Готовый маршрут: <title> →' }`; иначе при ≥ 2 местах → `{ href:'/marshrut?p=<id первых 5 через запятую>', текст:'Собрать маршрут из этих мест →' }`; иначе `null`.
  - `блокМестРядом(места, маршрут)` → HTML-строка (пустая при < 3 местах).

- [ ] **Step 1: Написать проверку**

`проверки/города-и-места.mjs`:

```js
// Городские страницы: жильё + что посмотреть рядом.
// Проверяем, что на страницах города есть блок мест из нашего справочника
// (названия и расстояния сходятся со справочником — ничего не придумано),
// ссылка на готовый или собранный маршрут, новые Новогрудок и Несвиж
// в sitemap, заголовки и описания в рамках SEO-правил.
// Сервер должен быть запущен, каталоги досок собраны.
//   node проверки/города-и-места.mjs http://127.0.0.1:8241
import { запуститьChrome } from './_браузер.mjs';

const SITE = process.argv[2] || 'http://127.0.0.1:8241';
const PORT = 9632, sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
const check = (n, ok, d) => ok ? (passed++, console.log('  OK   ' + n)) : (failed++, console.log('  ПАДАЕТ ' + n + (d ? '  — ' + d : '')));
const раскрыть = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function км(a1, o1, a2, o2) {
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const справочник = (await (await fetch(SITE + '/api/places?light=1')).json()).items;
const место = id => справочник.find(p => String(p.id) === String(id));

// центр — как у сервера: точка курорта, центр из записи или TOWN_CENTERS
const СТРАНИЦЫ = [
  ['/grodno', [53.6690, 23.8130], null],
  ['/minsk', [53.9020, 27.5615], null],
  ['/braslav', [55.6333, 27.05], '/m/braslavshchina-2-dnya'],
  ['/novogrudok', [53.6000, 25.8280], null],
  ['/nesvizh', [53.2226, 26.6739], null],
  ['/lida', [53.8880, 25.2990], '/m/lida-voronovo'],
];
for (const [путь, центр, маршрут] of СТРАНИЦЫ) {
  const r = await fetch(SITE + путь);
  const html = await r.text();
  check(путь + ': 200', r.status === 200, r.status);
  if (r.status !== 200) continue;
  check(путь + ': блок «Что посмотреть рядом»', html.includes('<h2>Что посмотреть рядом</h2>'));
  const карточки = [...html.matchAll(/<a class="pc" href="\/mesto\/(\d+)-[a-z0-9-]+">[\s\S]*?<b>([^<]*)<\/b>[\s\S]*?<span class="pk">([\d,]+) км от центра<\/span>/g)];
  check(путь + ': от 3 до 8 мест', карточки.length >= 3 && карточки.length <= 8, карточки.length);
  check(путь + ': названия — из справочника', карточки.every(к => место(к[1]) && место(к[1]).name === раскрыть(к[2])),
    карточки.filter(к => !место(к[1]) || место(к[1]).name !== раскрыть(к[2])).map(к => к[1]).join(','));
  check(путь + ': расстояния сходятся (± 0,1 км) и ≤ 30 км', карточки.every(к => { const p = место(к[1]); const д = +к[3].replace(',', '.');
    return p && д <= 30 && Math.abs(км(центр[0], центр[1], p.lat, p.lng) - д) <= 0.1; }));
  check(путь + ': у снимков непустой alt', [...html.matchAll(/<a class="pc"[\s\S]*?<\/a>/g)].every(м => !/<img/.test(м[0]) || /<img[^>]+alt="[^"]+"/.test(м[0])));
  const ссылка = (html.match(/<a class="pr-route" href="([^"]+)"/) || [])[1];
  if (маршрут) check(путь + ': ссылка на готовый маршрут ' + маршрут, ссылка === маршрут, ссылка);
  else check(путь + ': ссылка на маршрут из мест этого блока', !!ссылка && (/^\/m\/[a-z0-9-]+$/.test(ссылка)
    || (ссылка.startsWith('/marshrut?p=') && ссылка.slice(12).split(',').every(id => карточки.some(к => к[1] === id)))), ссылка);
  const title = раскрыть((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const desc = раскрыть((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  // у /braslav основа заголовка длинная (48 знаков), хвост «и что посмотреть рядом» не влезает в 60
  check(путь + ': title ≤ 60' + (путь === '/braslav' ? '' : ' и про места'), title.length <= 60 && (путь === '/braslav' || /посмотреть/.test(title)), title);
  check(путь + ': description 120–160 и называет число мест', desc.length >= 120 && desc.length <= 160 && /\d+ мест/.test(desc), desc.length + ' ' + desc);
}
// уточняющие страницы остаются про цену/тип, блок мест только на основной
const недорого = await (await fetch(SITE + '/grodno-nedorogo')).text();
check('/grodno-nedorogo: заголовок прежний', /<title>Недорогие квартиры на сутки в Гродно до 70 рублей/.test(недорого));
const карта = await (await fetch(SITE + '/sitemap.xml')).text();
check('sitemap: /novogrudok и /nesvizh', карта.includes('/novogrudok</loc>') && карта.includes('/nesvizh</loc>'));

// телефон: блок мест не распирает страницу
const { закрыть } = запуститьChrome(PORT, 'city');
let ws, id = 0; const pend = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
let url;
for (let i = 0; i < 60 && !url; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); url = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(500); }
ws = new WebSocket(url);
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 1, mobile: true });
const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
await send('Page.navigate', { url: SITE + '/braslav' });
await sleep(2500);
check('/braslav на 400 px: без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
check('/braslav на 400 px: карточки мест в ленту вбок', await js(`getComputedStyle(document.querySelector('.places')).overflowX === 'auto'`));

console.log('\nПройдено ' + passed + ', падает ' + failed);
ws.close(); await закрыть();
process.exit(failed ? 1 : 0);
```

Добавить скрипт в `package.json`. (Если `/lida` не наберёт 3 мест в 30 км — это данные справочника, не ошибка: проверка выведет число; тогда убрать `/lida` из списка и записать в коммите почему.)

- [ ] **Step 2: Запустить — падает** (нет блока, 404 на `/novogrudok`, `/nesvizh`).

- [ ] **Step 3: Новые страницы спроса**

В `СПРОС`, в группе районных городов после `'zhodino'`:

```js
  // города с замками: жильё ищут вместе с «что посмотреть» (добавлены 16.09;
  // на живом сайте 18 и 34 объявления). У Несвижа нет своих координат
  // в TOWN_CENTERS — центр для блока мест задаём здесь.
  'novogrudok':  { обл:'grodno',    город:'Новогрудок', где:'в Новогрудке' },
  'nesvizh':     { обл:'minsk-obl', город:'Несвиж',     где:'в Несвиже', центр:[53.2226, 26.6739] },
```

`центр` не путать с `точка`: `точка` переводит страницу на поиск по радиусу (`спросДанные`), `центр` нужен только блоку мест.

- [ ] **Step 4: Функции блока** (перед `async function cityPage`)

```js
// ── Что посмотреть рядом на городских страницах ──────────────────────────
// Человек выбирает, где ночевать, и заодно — куда съездить. Места берём из
// своего справочника, расстояния считаем от центра города; ничего, кроме
// названий, категорий и километров, в блок не пишем.
function центрСтраницы(z){
  return z.центр || z.точка || TOWN_CENTERS[z.город || z.city] || null;
}
function местаДляСтраницы(все, центр){
  const out = [];
  все.map(p => ({ p, км: distKm(центр[0], центр[1], p.lat, p.lng) }))
    .filter(x => x.км <= 30)
    .sort((a, b) => разряд(a.p) - разряд(b.p) || (b.p.rating || 0) - (a.p.rating || 0) || a.км - b.км)
    .forEach(x => {
      if(out.length >= 8) return;
      // часовня во дворе уже взятого замка — то же место
      if(out.some(y => distKm(y.lat, y.lng, x.p.lat, x.p.lng) < 0.5)) return;
      out.push({ id:x.p.id, name:x.p.name, cat:x.p.cat || '', pic:x.p.pic || '', lat:x.p.lat, lng:x.p.lng,
                 км: Math.round(x.км * 10) / 10 });
    });
  return out;
}
function маршрутДляСтраницы(все, центр, места){
  const поНомеру = new Map(все.map(p => [String(p.id), p]));
  const готовый = ВИДЕО_МАРШРУТЫ.find(м => точкиВидео(м).filter(t => {
    const p = /^[0-9]+$/.test(t) && поНомеру.get(t);
    return p && distKm(центр[0], центр[1], p.lat, p.lng) <= 40;
  }).length >= 2);
  if(готовый) return { href: '/m/' + готовый.slug, текст: 'Готовый маршрут: ' + готовый.title + ' →' };
  if(места.length >= 2) return { href: '/marshrut?p=' + места.slice(0, 5).map(p => p.id).join(','),
                                 текст: 'Собрать маршрут из этих мест →' };
  return null;
}
// Фразу не собираем из «где»: «в Гродно» → «от Гродно» ещё выходит, а
// «на Браславских озёрах» уже нет. Поэтому — «от центра», без названия.
function блокМестРядом(места, маршрут){
  if(места.length < 3) return '';
  return '<h2>Что посмотреть рядом</h2>'
    + '<p class="lead">' + места.length + ' ' + скл(места.length, 'место', 'места', 'мест')
    +   ' в тридцати километрах от центра — из нашего справочника '
    +   '<a href="/?country=places">«Что посетить»</a>.</p>'
    + '<div class="places">' + места.map(function(p){
        const img = p.pic
          ? '<img src="' + esc(p.pic) + '" loading="lazy" alt="' + esc(p.name) + '">'
          : '<span class="noimg">без фото</span>';
        return '<a class="pc" href="/mesto/' + p.id + '-' + slugify(p.name) + '">' + img
          + '<b>' + esc(p.name) + '</b>'
          + (p.cat ? '<span class="pcat">' + esc(p.cat) + '</span>' : '')
          + '<span class="pk">' + String(p.км).replace('.', ',') + ' км от центра</span></a>';
      }).join('') + '</div>'
    + (маршрут ? '<a class="pr-route" href="' + esc(маршрут.href) + '"'
        + (маршрут.href.indexOf('/marshrut') === 0 ? ' rel="nofollow"' : '') + '>' + esc(маршрут.текст) + '</a>' : '');
}
```

В `СТИЛЬ_СПИСКА` дописать (перед `@media`):

```js
  + 'h2{font-size:22px;margin:34px 0 10px;letter-spacing:-.01em}'
  + '.places{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin:0 0 14px}'
  + '.pc{display:flex;flex-direction:column;gap:3px;background:#fff;border:1px solid #e2e5ea;border-radius:14px;'
  +   'overflow:hidden;text-decoration:none;color:#141821;padding-bottom:10px}'
  + '.pc img,.pc .noimg{width:100%;height:120px;object-fit:cover;display:flex;align-items:center;justify-content:center;'
  +   'background:#eef0f4;color:#8b93a3;font-size:12.5px;margin-bottom:6px}'
  + '.pc b,.pc .pcat,.pc .pk{padding:0 12px}'
  + '.pc b{font-size:14.5px;line-height:1.3}'
  + '.pc .pcat,.pc .pk{font-size:12.5px;color:#8b93a3}'
  + '.pr-route{display:inline-block;color:#9a3412;font-weight:700;text-decoration:none;margin:4px 0 8px}'
  + '@media (max-width:600px){.places{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}'
  +   '.pc{flex:0 0 160px;scroll-snap-align:start}}'
```
и в тёмную тему: `.pc{background:#1d1916;border-color:#332c25;color:#f6f2ed}.pc .noimg{background:#2b251f}`. `h2` в `гидPage` и `маршрутСобрать` задан своим стилем позже — там он перекроет общий, это нормально.

- [ ] **Step 5: Подключить в `cityPage` и `спросPage`**

`cityPage` (только основная страница города, `!kind`):

```js
  let места = [], маршрут = null;
  const центр = !kind ? центрСтраницы(c) : null;
  if(центр){
    try{ const все = await placesRaw(); места = местаДляСтраницы(все, центр); маршрут = маршрутДляСтраницы(все, центр, места); }catch(e){}
  }
  const сМестами = места.length >= 3;
```
- `title`: хвосты `сМестами ? [' и что посмотреть рядом', ' — снять посуточно', ' посуточно'] : [' — снять посуточно', ' посуточно']`;
- в `описаниеСтраницы` после фразы про площадки вставить `сМестами ? ('Рядом ' + места.length + ' ' + скл(места.length, 'место', 'места', 'мест') + ' из справочника «Что посетить»' + (маршрут ? ' и маршрут на день.' : '.')) : ''`;
- в разметке — `блокМестРядом(места, маршрут)` сразу после `.grid` с объявлениями (перед `.others`).

`спросPage` — то же, центр `центрСтраницы(z)`, без условия `kind`. Названия в `title`/`description` не выдумываем: только число мест.

Кэш: страницы уже отдаются с `max-age=300/600`; `placesRaw()` в памяти — дополнительный кэш не нужен.

- [ ] **Step 6: Прогнать**

Перезапуск сервера, ждать каталоги. `node проверки/города-и-места.mjs http://127.0.0.1:8241`, `node проверки/seo.mjs http://127.0.0.1:8241` (заголовки ≤ 60, описания 120–160, уникальность, alt), `node проверки/страницы-и-выдача.mjs http://127.0.0.1:8241`, `node проверки/пустые-страницы.mjs http://127.0.0.1:8241` → падает 0. Если `seo.mjs` находит одинаковые описания у двух страниц одного типа — добавить в описание число объявлений (оно уже первое в списке фраз) и перепроверить.

- [ ] **Step 7: Коммит**

```bash
git add kvartiry-server.js проверки/города-и-места.mjs проверки/страницы-и-выдача.mjs package.json
git commit -m "Городские страницы: что посмотреть рядом и маршрут; новые страницы Новогрудка и Несвижа

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: «Поделиться подборкой» из избранного

**Как устроено сейчас.** `FAVS` (≈8814) — массив целых объявлений в `localStorage.pk_favs`; вид «♥» (`setView('fav')`) рисует их `renderCards`. Сервер об избранном не знает, постоянного хранилища нет (диск Render стирается при выкладке).

**Решение.** Ссылка `/izbrannoe?s=<коды через ~>` — сами объявления закодированы короткими кодами площадок, сервер ничего не хранит. Страница `/izbrannoe` собирается на сервере: ищет объявления в том, что уже лежит в памяти (каталоги Check-in/Kvartirka, сырые ответы Kufar/Realt/Flatbook в `SEARCH_CACHE`, индекс `stayIndex()`), показывает найденные карточками и честно пишет про ненайденные (со ссылкой на площадку). `noindex`, в sitemap не попадает.

Коды (обратимые, только известные площадки; всё остальное пропускается):

| код | ссылка |
|---|---|
| `k<цифры>` | `https://www.kufar.by/item/<цифры>` |
| `r<путь>` | `https://realt.by/<путь>` |
| `c<путь>` | `https://check-in.by/<путь>` |
| `v<путь>` | `https://kvartirka.by/<путь>` |
| `f<путь>` | `https://flatbook.by/<путь>` |
| `g<поддомен>/<путь>` | `https://<поддомен>.flatbook.by/<путь>` |

`<путь>` — `[A-Za-z0-9/_.-]{1,160}` без `..`; поддомен — `[a-z0-9-]{1,30}`. Отели России (`H101`) в ссылку не попадают. До 40 объявлений.

**Files:**
- Modify: `kvartiry-server.js` — функции `кодСсылки`, `ссылкаИзКода` (рядом с `SRC_TITLE`, ≈3470), `объявленияПоСсылкам`, `избранноеPage` (после `спросPage`), маршрут `/izbrannoe` (перед городскими страницами, ≈10594); в `PAGE` — `${кодСсылки.toString()}` рядом с `${перетаскиваниеСтрок.toString()}`, кнопка `#favShare` и функция `поделитьсяПодборкой` рядом с избранным (≈8814), вызов в `renderCards`.
- Create: `проверки/поделиться-избранным.mjs` (порт **9633**).
- Modify: `package.json` — `"проверка-поделиться-избранным": "node проверки/поделиться-избранным.mjs"`.

**Interfaces:**
- Produces:
  - `кодСсылки(link: string) → string` (`''` — не делимся), `ссылкаИзКода(код: string) → string` (`''` — плохой код). Взаимно обратны для всех ссылок пяти площадок.
  - `объявленияПоСсылкам(ссылки: string[]) → Promise<{ найдены: item[], нет: string[], проверено: boolean }>` — `проверено=false`, если каталоги ещё не собраны и индекс пуст (тогда не утверждаем «снято»).
  - `GET /izbrannoe?s=…` → HTML, `X-Robots-Tag: noindex` + `<meta name="robots" content="noindex,follow">`, `Cache-Control: no-cache`; в странице `window.__ПОДБОРКА = [...]` (найденные объявления) для кнопки «Сохранить к себе».
  - Клиент главной: `поделитьсяПодборкой()`.

- [ ] **Step 1: Написать проверку**

`проверки/поделиться-избранным.mjs` — каркас (порт 9633, имя `'favshare'`), тело:

```js
// ── коды ссылок: туда и обратно (через страницу, где функция вставлена) ──
await send('Page.navigate', { url: SITE + '/' });
await ждать(`typeof кодСсылки === 'function'`, 80);
const примеры = ['https://www.kufar.by/item/1054421624', 'https://realt.by/grodno-region/rent-flat-for-day/object/3939207/',
  'https://check-in.by/kvartira/kvartira-ryadom-s-tsentrom-volkovysk', 'https://kvartirka.by/lida/kvartiry/posutochno/id4879',
  'https://flatbook.by/kvartira-yl-surganova-5/', 'https://grodno.flatbook.by/kvartira-yl-popovicha-33/'];
const коды = await js(`${JSON.stringify(примеры)}.map(кодСсылки)`);
check('коды короткие и с буквой площадки', коды.every((к, i) => 'krcvfg'.includes(к[0]) && к.length < примеры[i].length), коды.join(' '));
check('чужие ссылки не кодируются', (await js(`[кодСсылки('https://evil.example/x'), кодСсылки('https://www.kufar.by/item/12ab'), кодСсылки('javascript:alert(1)')].join('|')`)) === '||');

// ── страница по ссылке: три живых объявления и одно выдуманное ──
const выдача = (await getJSON(SITE + '/api/search?region=grodno&city=&type=any&rooms=&guests=&max=&source=both')).items;
const взять = src => выдача.find(x => x.src === src);
const живые = ['Kufar', 'CheckIn', 'Kvartirka'].map(взять).filter(Boolean);
check('в выдаче есть Kufar, Check-in и Kvartirka', живые.length === 3);
const живыеКоды = await js(`${JSON.stringify(живые.map(x => x.link))}.map(кодСсылки)`);
const s = живыеКоды.concat(['k1', 'x..', 'r../../etc']).join('~');
const r = await fetch(SITE + '/izbrannoe?s=' + encodeURIComponent(s));
const html = await r.text();
check('/izbrannoe: 200 и noindex заголовком и метатегом', r.status === 200 && /noindex/.test(r.headers.get('x-robots-tag') || '') && /<meta name="robots" content="noindex/.test(html));
check('/izbrannoe: три карточки в порядке ссылки', (() => { const ссылки = [...html.matchAll(/<article class="c"><a href="([^"]+)"/g)].map(м => м[1].replace(/&amp;/g, '&'));
  return JSON.stringify(ссылки) === JSON.stringify(живые.map(x => x.link)); })());
check('/izbrannoe: про ненайденное — одно и со ссылкой на Kufar', /Сейчас не нашли: 1/.test(html) && html.includes('https://www.kufar.by/item/1'));
check('/izbrannoe: плохие коды молча пропущены', !/etc|x\.\./.test(html.replace(/<script[\s\S]*?<\/script>/g, '')));
check('/izbrannoe: в sitemap нет', !(await (await fetch(SITE + '/sitemap.xml')).text()).includes('/izbrannoe'));
const пусто = await fetch(SITE + '/izbrannoe');
check('/izbrannoe без s: 200 и понятный текст', пусто.status === 200 && /Подборка пустая/.test(await пусто.text()));

// ── кнопка в избранном ──
await js(`localStorage.setItem('pk_favs', ${JSON.stringify(JSON.stringify(живые))}); 1`);
await send('Page.navigate', { url: SITE + '/' });
await ждать(`typeof setView === 'function' && FAVS.length === 3`, 80);
await js(`delete navigator.share; navigator.share = undefined; window.__скопировано = null;
  navigator.clipboard.writeText = function(t){ window.__скопировано = t; return Promise.resolve(); }; setView('fav'); 1`);
check('в избранном видна кнопка «Поделиться подборкой»', await ждать(`(function(){ var b = document.getElementById('favShare'); return b && b.offsetParent !== null && b.textContent.indexOf('Поделиться подборкой') >= 0; })()`, 20));
await js(`document.getElementById('favShare').click(); 1`);
await ждать(`!!window.__скопировано`, 20);
const ссылка = await js(`window.__скопировано`);
check('скопирована ссылка /izbrannoe с кодами в порядке избранного', ссылка === SITE + '/izbrannoe?s=' + живыеКоды.join('~'), ссылка);
await js(`setView('list'); 1`);
check('в обычном списке кнопки нет', await js(`!document.getElementById('favShare') || document.getElementById('favShare').offsetParent === null`));

// ── открыть ссылку в чистом браузере и сохранить к себе ──
await js(`localStorage.removeItem('pk_favs'); 1`);
await send('Page.navigate', { url: ссылка });
await ждать(`document.querySelectorAll('article.c').length === 3`, 40);
await js(`document.getElementById('izSave').click(); 1`);
check('«Сохранить к себе» кладёт три объявления в избранное', await js(`JSON.parse(localStorage.getItem('pk_favs')||'[]').length === 3`));
await js(`document.getElementById('izSave').click(); 1`);
check('повторное сохранение не дублирует', await js(`JSON.parse(localStorage.getItem('pk_favs')||'[]').length === 3`));
check('на 400 px без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
await js(`localStorage.clear(); 1`);
```

- [ ] **Step 2: Запустить — падает** (`кодСсылки` не определена, `/izbrannoe` → 404).

- [ ] **Step 3: Коды ссылок** (рядом с `SRC_TITLE`)

```js
// ── Подборка избранного по ссылке ────────────────────────────────────────
// Хранить подборки негде (диск Render стирается при выкладке), поэтому сами
// объявления едут в ссылке короткими кодами. Только пять известных площадок:
// ссылка не должна превращаться в способ отправить человека на чужой сайт.
// Функция вставляется и в скрипт главной (.toString()).
function кодСсылки(link){
  var s = String(link || ''), m;
  var путь = /^[A-Za-z0-9\/_.-]{1,160}$/;
  if((m = s.match(/^https:\/\/www\.kufar\.by\/item\/(\d{1,15})$/))) return 'k' + m[1];
  var базы = [['r', 'https://realt.by/'], ['c', 'https://check-in.by/'], ['v', 'https://kvartirka.by/'], ['f', 'https://flatbook.by/']];
  for(var i = 0; i < базы.length; i++){
    if(s.indexOf(базы[i][1]) === 0){
      var хвост = s.slice(базы[i][1].length);
      return (путь.test(хвост) && хвост.indexOf('..') < 0) ? базы[i][0] + хвост : '';
    }
  }
  if((m = s.match(/^https:\/\/([a-z0-9-]{1,30})\.flatbook\.by\/(.+)$/)) && путь.test(m[2]) && m[2].indexOf('..') < 0)
    return 'g' + m[1] + '/' + m[2];
  return '';
}
function ссылкаИзКода(код){
  const к = String(код || ''), б = к.charAt(0), х = к.slice(1);
  if(б === 'k') return /^\d{1,15}$/.test(х) ? 'https://www.kufar.by/item/' + х : '';
  if(!/^[A-Za-z0-9\/_.-]{1,192}$/.test(х) || х.indexOf('..') >= 0) return '';
  const базы = { r:'https://realt.by/', c:'https://check-in.by/', v:'https://kvartirka.by/', f:'https://flatbook.by/' };
  if(базы[б]) return базы[б] + х;
  if(б === 'g'){ const m = х.match(/^([a-z0-9-]{1,30})\/(.+)$/); return m ? 'https://' + m[1] + '.flatbook.by/' + m[2] : ''; }
  return '';
}
```

(Внутри `кодСсылки` — `var` и `function`, без стрелок: её текст идёт в браузер как есть; обратные косые в регулярках допустимы, потому что вставка — через `${кодСсылки.toString()}`.)

- [ ] **Step 4: Поиск объявлений по ссылкам и страница**

После `спросPage`:

```js
// Где искать объявление по ссылке, не спрашивая площадки: каталоги Check-in
// и Kvartirka в памяти целиком; Kufar, Realt и Flatbook — в сырых ответах,
// что лежат в кэше поиска, и в общем индексе «жильё рядом».
async function объявленияПоСсылкам(ссылки){
  const нужны = new Set(ссылки), нашли = new Map();
  const смотреть = x => { if(x && x.link && нужны.has(x.link) && !нашли.has(x.link)) нашли.set(x.link, x); };
  КАТАЛОГ.CheckIn.forEach(смотреть); КАТАЛОГ.Kvartirka.forEach(смотреть);
  for(const [ключ, з] of SEARCH_CACHE){
    if(ключ.indexOf('raw|kufar|') === 0 || ключ.indexOf('raw|realt|') === 0 || ключ.indexOf('raw|fb|') === 0)
      (Array.isArray(з.data) ? з.data : []).forEach(смотреть);
  }
  let индекс = [];
  if(нашли.size < нужны.size){ try{ индекс = await stayIndex(); }catch(e){} индекс.forEach(смотреть); }
  // Уверенно сказать «объявления больше нет» можно, только если было где искать
  const проверено = (КАТАЛОГ_ОБНОВЛЁН.CheckIn > 0 || КАТАЛОГ_ОБНОВЛЁН.Kvartirka > 0) && индекс.length + SEARCH_CACHE.size > 50;
  return { найдены: ссылки.filter(l => нашли.has(l)).map(l => нашли.get(l)),
           нет: ссылки.filter(l => !нашли.has(l)), проверено };
}

async function избранноеPage(s){
  const коды = String(s || '').split('~').map(к => к.trim()).filter(Boolean).slice(0, 40);
  const ссылки = [...new Set(коды.map(ссылкаИзКода).filter(Boolean))];
  const d = ссылки.length ? await объявленияПоСсылкам(ссылки) : { найдены: [], нет: [], проверено: true };
  const карточки = d.найдены.map(function(x){
    const img = (x.photos && x.photos[0])
      ? '<img src="' + esc(x.photos[0]) + '" loading="lazy" alt="' + esc(x.title || 'Жильё на сутки') + '">'
      : '<div class="noimg">фото у источника</div>';
    const мета = [x.area, (x.rooms ? x.rooms + '-комн' : ''), x.capacity ? ('до ' + x.capacity + ' гостей') : '']
      .filter(Boolean).map(function(m){ return '<span>' + esc(m) + '</span>'; }).join('');
    return '<article class="c"><a href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">' + img + '</a>'
      + '<div class="b"><div class="p">' + (x.от ? 'от ' : '') + x.price + ' BYN <small>/ сутки</small></div>'
      + '<div class="m">' + мета + '</div><h3>' + esc(x.title || 'Жильё на сутки') + '</h3>'
      + '<a class="go" href="' + esc(x.link) + '" target="_blank" rel="noopener nofollow">Открыть на ' + esc(srcTitle(x.src)) + '</a></div></article>';
  }).join('');
  const площадка = l => srcTitle(l.indexOf('kufar') >= 0 ? 'Kufar' : l.indexOf('realt') >= 0 ? 'Realt'
    : l.indexOf('check-in') >= 0 ? 'CheckIn' : l.indexOf('kvartirka') >= 0 ? 'Kvartirka' : 'Flatbook');
  const ненайденные = d.нет.length
    ? '<div class="gone"><b>Сейчас не нашли: ' + d.нет.length + '</b> — '
      + (d.проверено ? 'скорее всего, объявление сняли с площадки.' : 'площадки ещё не ответили, попробуйте через пару минут.')
      + '<ul>' + d.нет.map(l => '<li><a href="' + esc(l) + '" target="_blank" rel="noopener nofollow">Проверить на '
      + esc(площадка(l)) + '</a></li>').join('') + '</ul></div>'
    : '';
  const пусто = !ссылки.length;
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,follow"><title>Подборка жилья на сутки</title>'
    + '<meta name="theme-color" content="#9a3412">'
    + '<style>' + СТИЛЬ_СПИСКА
    +   '.gone{margin:22px 0 0;color:#4a5160;font-size:14.5px}.gone ul{margin:6px 0 0;padding-left:20px}.gone a{color:#9a3412}'
    +   '.save{font:inherit;font-weight:700;background:#fff;color:#9a3412;border:1px solid #9a3412;border-radius:12px;padding:12px 20px;margin:0 0 22px;cursor:pointer}'
    +   '@media (prefers-color-scheme:dark){.gone{color:#c2b7ab}.save{background:#1d1916}}'
    + '</style></head><body><div class="w">'
    + '<h1>Подборка жилья</h1>'
    + (пусто
        ? '<p class="lead">Подборка пустая: в ссылке нет объявлений. Отметьте варианты сердечком в поиске и нажмите «Поделиться подборкой».</p>'
        : '<p class="lead">Эти варианты отметили и прислали вам ссылкой. Цены и наличие — из самих объявлений на площадках, '
          + 'бронируйте напрямую у хозяина.</p>'
          + (d.найдены.length ? '<button class="save" id="izSave" type="button">♥ Сохранить к себе в избранное</button>' : ''))
    + (карточки ? '<div class="grid">' + карточки + '</div>' : '')
    + ненайденные
    + '<footer><p><a href="/">Искать жильё на сутки →</a></p></footer>'
    + '</div><script>window.__ПОДБОРКА=' + вСкрипт(d.найдены) + ';'
    + '(function(){var b=document.getElementById("izSave");if(!b)return;b.addEventListener("click",function(){'
    +   'var f=[];try{f=JSON.parse(localStorage.getItem("pk_favs")||"[]");if(!Array.isArray(f))f=[];}catch(e){f=[];}'
    +   'window.__ПОДБОРКА.forEach(function(x){if(!f.some(function(y){return y.link===x.link;}))f.push(x);});'
    +   'try{localStorage.setItem("pk_favs",JSON.stringify(f));}catch(e){}'
    +   'b.textContent="✓ Сохранено — "+f.length+" в избранном";});})();'
    + '</' + 'script></body></html>';
}
```

Маршрут (перед блоком «Страницы под живой поисковый спрос»):

```js
  // Подборка избранного по ссылке: объявления закодированы в самой ссылке
  if(u.pathname === '/izbrannoe'){
    let html = '';
    try{ html = await избранноеPage(u.searchParams.get('s')); }catch(e){ html = ''; }
    if(!html){ res.writeHead(500, {'X-Robots-Tag':'noindex'}); res.end('Не получилось собрать подборку'); return; }
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache', 'X-Robots-Tag':'noindex'});
    res.end(html); return;
  }
```

В `проверки/seo.mjs` адрес не добавлять в индексируемые; если там есть список служебных адресов для проверки noindex (`/marshrut?p=`, `/stats`…) — добавить `/izbrannoe?s=k1`.

- [ ] **Step 5: Кнопка в избранном (`PAGE`)**

Рядом с `${перетаскиваниеСтрок.toString()}` добавить строку `${кодСсылки.toString()}`.

В `renderCards`, в ветке `window.__view==='fav'` (после проверки на пустоту, перед отрисовкой) сделать сверху кнопку: разметку `<div class="favbar"><button id="favShare" type="button" class="favshare">Поделиться подборкой</button><span id="favNote"></span></div>` вставлять первой строкой в `$('#grid').innerHTML` только когда `window.__view==='fav'` и `FAVS.length`. (Сетка `#grid` — grid; у `.favbar` — `grid-column:1/-1`.)

После `favToggle`:

```js
// ── Поделиться подборкой ──────────────────────────────────────────────────
// Избранное живёт только в этом браузере. Ссылка /izbrannoe?s=… везёт сами
// объявления короткими кодами — сервер ничего не хранит.
async function поделитьсяПодборкой(){
  const коды = FAVS.map(function(x){ return кодСсылки(x.link); }).filter(Boolean);
  const россия = FAVS.filter(function(x){ return x.src === 'H101'; }).length;
  if(!коды.length){ toast('В подборке нет объявлений из Беларуси'); return; }
  const ссылка = location.origin + '/izbrannoe?s=' + коды.slice(0, 40).join('~');
  const текст = 'Подборка жилья на сутки: ' + коды.length + ' ' + скл(коды.length, 'вариант', 'варианта', 'вариантов');
  try{
    if(navigator.share){ await navigator.share({ title: 'Подборка жилья', text: текст, url: ссылка }); }
    else if(navigator.clipboard){ await navigator.clipboard.writeText(ссылка); toast('Ссылка на подборку скопирована'); }
    else { window.prompt('Ссылка на подборку', ссылка); }
    if(россия) $('#favNote').textContent = 'Отели России в ссылку не попадают.';
    if(window.__T) window.__T('fav_share', { n: коды.length });
  }catch(e){}
}
document.addEventListener('click', function(ev){
  const b = ev.target && ev.target.closest ? ev.target.closest('#favShare') : null;
  if(!b) return;
  ev.preventDefault();
  поделитьсяПодборкой();
});
```

Серверную `скл` (≈3497) добавить в `PAGE` строкой `${скл.toString()}` рядом с `${кодСсылки.toString()}` (сначала проверить `grep -n "function скл" kvartiry-server.js` внутри `PAGE` — если там уже есть своя, использовать её).

CSS в `PAGE`:

```css
.favbar{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.favshare{font:inherit;font-weight:700;font-size:14px;padding:10px 16px;border-radius:var(--radius-sm);
  background:var(--surface);color:var(--accent);border:1px solid var(--line-strong);cursor:pointer}
.favshare:hover{border-color:var(--accent)}
#favNote{font-size:12.5px;color:var(--txt-3)}
```

- [ ] **Step 6: Прогнать** `скрипт-страницы`, `поделиться-избранным`, `seo`, `вкладки` → падает 0; `%TEMP%\cdp-*` не осталось.

- [ ] **Step 7: Коммит**

```bash
git add kvartiry-server.js проверки/поделиться-избранным.mjs package.json проверки/seo.mjs
git commit -m "Избранное: ссылка на подборку /izbrannoe без хранения на сервере, честно про снятые объявления

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: «Выходные от этого жилья»

**Решение.** Сервер выбирает 3–5 лучших мест в 30 км от жилья и лучший порядок объезда (петля от жилья и обратно, перебор ≤ 120 вариантов), `GET /vyhodnye?lat=&lng=` отвечает `302` на существующую страницу `/marshrut?p=<жильё>,<места>,<жильё>&o=1` (там уже план дня и расчёт топлива). Старт и финиш — свои точки `m<lat5>_<lng5>~Жильё`; у финиша координаты сдвинуты на 0,00001°, иначе у двух точек был бы один id (так уже сделано в `/m/braslavshchina-2-dnya`). В карточке ссылка появляется, когда `/api/places/ryadom` вернул `w:true`.

**Files:**
- Modify: `kvartiry-server.js` — `выходныеОтЖилья`, `порядокПетли` (после `рядомСЖильём`), `рядомСЖильём` (`w`), маршрут `/vyhodnye` (рядом с `/marshrut`), `показатьРядом` в `PAGE`, CSS.
- Create: `проверки/выходные.mjs` (порт **9634**).
- Modify: `package.json` — `"проверка-выходных": "node проверки/выходные.mjs"`; `проверки/рядом-с-жильём.mjs` — проверка `w`.

**Interfaces:**
- Consumes: `местаВокруг` (Task 2), `разряд`, `distKm`, `своюТочкуИзСсылки`.
- Produces:
  - `выходныеОтЖилья(все, lat, lng) → place[]` — в порядке объезда; кандидаты — `местаВокруг(все, lat, lng, 30)` с `разряд ≤ 1`, отсортированные `разряд` ↑, `rating` ↓, `км` ↑; место ближе 1 км к взятому пропускается; не больше 5.
  - `порядокПетли(lat, lng, места) → place[]` — перестановка с наименьшей суммой `distKm` дом → … → дом (при равенстве — первая найденная в порядке перебора).
  - `ссылкаВыходных(lat, lng, места) → string` — `/marshrut?p=…&o=1`.
  - `GET /vyhodnye?lat=<число>&lng=<число>` → `302`; координаты вне Беларуси (lat 51–56,5, lng 23–33) или меньше 3 мест → `302` на `/?country=places` (с `lat/lng` в Беларуси — всё равно на вкладку мест: там человек выберет сам). `Cache-Control: no-store`, `X-Robots-Tag: noindex`.

- [ ] **Step 1: Написать проверку**

`проверки/выходные.mjs` — каркас (порт 9634, имя `'wknd'`), тело:

```js
function км(a1, o1, a2, o2) {
  const t = Math.PI / 180, x = (a2 - a1) * t, y = (o2 - o1) * t;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a1 * t) * Math.cos(a2 * t) * Math.sin(y / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const РАЗРЯД = { 'Храмы': 0, 'Дворцы и усадьбы': 0, 'Укрепления': 0, 'Строения': 1, 'Военные': 1, 'Ландшафтные': 1, 'Разное': 1, 'Культурные': 2 };
const разряд = p => РАЗРЯД[p.group] ?? (/костёл|костел|церк|храм|часовн|собор|кирха|синагог|монастыр|дворец|усадьб|замок|крепост/i.test(p.cat || '') ? 0
  : /скульптур|арт-объект|памятник|музей|скамейк|мурал|граффити/i.test(p.cat || '') ? 2 : 1);
// Ожидаемый выбор — по тем же правилам, из /api/places (у него есть group и rating)
async function ожидаем(lat, lng) {
  const все = (await getJSON(SITE + `/api/places?lat=${lat}&lng=${lng}&r=30`)).items;
  const канд = все.map(p => ({ p, д: км(lat, lng, p.lat, p.lng) })).filter(x => x.д <= 30 && разряд(x.p) <= 1)
    .sort((a, b) => разряд(a.p) - разряд(b.p) || (b.p.rating || 0) - (a.p.rating || 0) || a.д - b.д);
  const взято = [];
  for (const { p } of канд) { if (взято.some(q => км(q.lat, q.lng, p.lat, p.lng) < 1)) continue; взято.push(p); if (взято.length === 5) break; }
  let лучший = null, лучшая = Infinity;
  const перебор = (путь, ост) => {
    if (!ост.length) { let д = 0, пр = { lat, lng }; путь.concat([{ lat, lng }]).forEach(т => { д += км(пр.lat, пр.lng, т.lat, т.lng); пр = т; });
      if (д < лучшая - 1e-9) { лучшая = д; лучший = путь; } return; }
    ост.forEach((т, i) => перебор(путь.concat([т]), ост.slice(0, i).concat(ост.slice(i + 1))));
  };
  перебор([], взято);
  return (лучший || []).map(p => String(p.id));
}
// ── сервер ──
const [lat, lng] = [53.45140, 26.47200];   // Мир
const r = await fetch(SITE + `/vyhodnye?lat=${lat}&lng=${lng}`, { redirect: 'manual' });
const куда = r.headers.get('location') || '';
check('302 на /marshrut с o=1', r.status === 302 && куда.startsWith('/marshrut?p=') && куда.endsWith('&o=1'), r.status + ' ' + куда);
const точки = decodeURIComponent(куда.slice('/marshrut?p='.length, куда.length - 4)).split(',');
check('старт и финиш — «Жильё» у тех же координат', точки[0] === 'm53.45140_26.47200~Жильё' && точки[точки.length - 1] === 'm53.45141_26.47201~Жильё', точки[0] + ' … ' + точки[точки.length - 1]);
const места = точки.slice(1, -1);
check('от 3 до 5 мест, все номера справочника, без повторов', места.length >= 3 && места.length <= 5 && места.every(x => /^\d+$/.test(x)) && new Set(места).size === места.length, места.join(','));
check('выбор и порядок — по правилам (разряд, рейтинг, близость; кратчайшая петля)', JSON.stringify(места) === JSON.stringify(await ожидаем(lat, lng)), места.join(','));
const заГраницей = await fetch(SITE + '/vyhodnye?lat=59.9&lng=30.3', { redirect: 'manual' });
check('вне Беларуси — на вкладку мест', заГраницей.status === 302 && заГраницей.headers.get('location') === '/?country=places');
const мусор = await fetch(SITE + '/vyhodnye?lat=abc', { redirect: 'manual' });
check('мусор в координатах — на вкладку мест', мусор.status === 302 && мусор.headers.get('location') === '/?country=places');
check('noindex', /noindex/.test(r.headers.get('x-robots-tag') || ''));
const р = await getJSON(SITE + `/api/places/ryadom?p=${lat},${lng}`);
check('/api/places/ryadom у Мира: w = true', р.ok && р.items[0].w === true);

// ── страница маршрута открывается с этими точками ──
await send('Page.navigate', { url: SITE + куда });
await ждать(`typeof Т !== 'undefined' && Т.length === ${точки.length}`, 80);
check('на /marshrut столько же точек и порядок ручной', await js(`Т.length === ${точки.length} && ПОРЯДОК === 'manual'`));
check('первая и последняя строки — «Жильё»', await js(`Т[0].name === 'Жильё' && Т[Т.length - 1].name === 'Жильё'`));
check('план дня виден', await ждать(`!!document.getElementById('rPlan') && !document.getElementById('rPlan').hidden`, 40));

// ── ссылка в карточке ──
await send('Page.navigate', { url: SITE + '/?region=minsk-obl&city=' + encodeURIComponent('Несвиж') + '&type=any' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
const есть = await ждать(`!!document.querySelector('#grid .nb .nb-wk')`, 60);
check('у жилья под Несвижем есть «Маршрут на выходные…»', есть);
if (есть) check('ссылка ведёт на /vyhodnye с координатами карточки и nofollow', await js(`(function(){
  var a = document.querySelector('#grid .nb .nb-wk'), card = a.closest('.card'), i = [...document.querySelectorAll('#grid .card')].indexOf(card);
  var x = window.__items[(window.__page - 1) * 24 + i];
  return a.getAttribute('rel') === 'nofollow' && a.getAttribute('href') === '/vyhodnye?lat=' + (+x.lat).toFixed(5) + '&lng=' + (+x.lng).toFixed(5); })()`));
check('на 400 px без прокрутки вбок', await js(`document.documentElement.scrollWidth <= innerWidth`));
await js(`localStorage.clear(); 1`);
```

- [ ] **Step 2: Запустить — падает** (`/vyhodnye` → 404).

- [ ] **Step 3: Сервер**

После `рядомСЖильём`:

```js
// ── Выходные от жилья ─────────────────────────────────────────────────────
// Из карточки объявления — готовый маршрут на день: 3–5 лучших мест в 30 км
// и порядок, при котором кольцо от жилья и обратно самое короткое. Открываем
// обычную страницу маршрута — там уже план дня и расчёт топлива.
const ВЫХОДНЫЕ_КМ = 30, ВЫХОДНЫЕ_МАКС = 5;
function выходныеОтЖилья(все, lat, lng){
  const взято = [];
  местаВокруг(все, lat, lng, ВЫХОДНЫЕ_КМ)
    .filter(x => разряд(x.p) <= 1)   // памятники и музеи — не повод ехать
    .sort((a, b) => разряд(a.p) - разряд(b.p) || (b.p.rating || 0) - (a.p.rating || 0) || a.км - b.км)
    .forEach(({ p }) => {
      if(взято.length >= ВЫХОДНЫЕ_МАКС) return;
      if(взято.some(q => distKm(q.lat, q.lng, p.lat, p.lng) < 1)) return;   // то же место
      взято.push(p);
    });
  return порядокПетли(lat, lng, взято);
}
// Пять мест — 120 порядков: перебрать быстрее, чем придумывать эвристику.
function порядокПетли(lat, lng, места){
  const дом = { lat, lng };
  let лучший = места.slice(), лучшая = Infinity;
  (function перебор(путь, остаток){
    if(!остаток.length){
      let д = 0, пред = дом;
      путь.concat([дом]).forEach(т => { д += distKm(пред.lat, пред.lng, т.lat, т.lng); пред = т; });
      if(д < лучшая - 1e-9){ лучшая = д; лучший = путь; }
      return;
    }
    остаток.forEach((т, i) => перебор(путь.concat([т]), остаток.slice(0, i).concat(остаток.slice(i + 1))));
  })([], места);
  return лучший;
}
function ссылкаВыходных(lat, lng, места){
  // У финиша координаты сдвинуты на 0,00001°: две точки с одним id маршрут склеил бы в одну
  const старт = 'm' + lat.toFixed(5) + '_' + lng.toFixed(5) + '~' + encodeURIComponent('Жильё');
  const финиш = 'm' + (lat + 0.00001).toFixed(5) + '_' + (lng + 0.00001).toFixed(5) + '~' + encodeURIComponent('Жильё');
  return '/marshrut?p=' + [старт].concat(места.map(p => p.id), [финиш]).join(',') + '&o=1';
}
```

В `рядомСЖильём` заменить `w: false` на `w: выходныеОтЖилья(все, lat, lng).length >= 3`.

Маршрут (перед `/marshrut`):

```js
  // «Выходные от этого жилья»: собираем маршрут и отправляем на его страницу
  if(u.pathname === '/vyhodnye'){
    const lat = +u.searchParams.get('lat'), lng = +u.searchParams.get('lng');
    let куда = '/?country=places';
    if(isFinite(lat) && isFinite(lng) && lat > 51 && lat < 56.5 && lng > 23 && lng < 33){
      try{
        const места = выходныеОтЖилья(await placesRaw(), lat, lng);
        if(места.length >= 3) куда = ссылкаВыходных(lat, lng, места);
      }catch(e){}
    }
    res.writeHead(302, { 'Location': куда, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(); return;
  }
```

Проверить на `/marshrut`, что ссылка с `o=1` и двумя «Жильё» открывается ровно так (обработчик `/marshrut` уже передаёт `o=1` в `marshrutPage`; `своюТочкуИзСсылки` берёт имя после `~`).

- [ ] **Step 4: Ссылка в карточке (`PAGE`)**

В `показатьРядом` (Task 2) перед `el.innerHTML = …`:

```js
  const x = (window.__view==='fav' ? FAVS : (window.__items||[]))[idx];
  const выходные = (д.w && x)
    ? ('<a class="nb-wk" rel="nofollow" href="/vyhodnye?lat=' + (+x.lat).toFixed(5) + '&lng=' + (+x.lng).toFixed(5) + '">Маршрут на выходные от этого жилья →</a>')
    : '';
```
и `el.innerHTML = '<span class="nb-t">Рядом:</span> ' + имена + ещё + выходные;`

CSS: `.nb-wk{display:block;margin-top:6px;font-weight:700;color:var(--accent);text-decoration:none;border:0}`

В `проверки/рядом-с-жильём.mjs` добавить: `check('Мир: w = true (мест на выходные хватает)', а.w === true);`

- [ ] **Step 5: Прогнать** `скрипт-страницы`, `выходные`, `рядом-с-жильём`, `план-дня`, `своя-точка`, `порядок-маршрута` (по одной) → падает 0.

- [ ] **Step 6: Коммит**

```bash
git add kvartiry-server.js проверки/выходные.mjs проверки/рядом-с-жильём.mjs package.json
git commit -m "Выходные от жилья: маршрут на день по лучшим местам в 30 км с возвратом к жилью

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: «Рекомендуемые» — порядок объявлений по умолчанию

**Как сейчас.** `#sort` (≈7884): «Дешёвые сверху» (`price_asc`, выбран), «Дорогие сверху», «По рейтингу». `URL_DEFAULTS.sort = 'price_asc'` (≈9842), `sortItems()` (≈8217). Предзагрузка главной (≈10920) — первые 24 из выдачи по цене. В Минске 16.09 (1649 объявлений, медиана 135 BYN) первые — «Место в номере на сутки для 9-ти человек» за 35 (Kufar), Kvartirka за 35–50, Check-in за 40. «Цена за человека» у Check-in уже отсекается при сборе (`ЦЕНА_ЗА_ЧЕЛОВЕКА`, ≈2540), у Kvartirka берётся посуточная цена; у Kufar и Flatbook признаков нет — только заголовок. Смена `#sort` сейчас не пишет адрес (≈8667: только `renderCards`).

**Решение.** Новое значение `recommended` («Рекомендуемые») — по умолчанию. Порядок полосами относительно медианы цены текущей выдачи (без похожих на койко-место):
- полоса 0 — обычные, цена в `[0,75·м; 1,35·м]`;
- полоса 1 — обычные, `[0,5·м; 0,75·м)` или `(1,35·м; 2,5·м]`;
- полоса 2 — обычные остальные (очень дёшево или очень дорого);
- полоса 3 — похожие на хостел/койко-место/цену за человека (по тексту заголовка и чипов).
Внутри полосы — ближе к медиане (`|ln(цена/м)|`), затем больше фото, затем ссылка (устойчиво). Любой выбранный вручную порядок работает как сейчас. Фильтры (комнаты, цена, тип…) порядок не меняют: в списке видно «Рекомендуемые», пока человек сам не выберет другое. Та же функция на сервере — для предзагрузки главной, основных городских страниц, страниц спроса и гидов; `-nedorogo` остаётся «сначала дешёвые».

**Files:**
- Modify: `kvartiry-server.js` — `похожеНаМесто`, `медианаЦены`, `рекомендуемыйПорядок` (рядом с `ЦЕНА_ЗА_ЧЕЛОВЕКА`, ≈2540); `PAGE`: `${…toString()}` ×3, `#sort`, `sortItems`, `currentSort`, `URL_DEFAULTS`, обработчик `#sort`, предзагрузка (клиент ≈10018 и сервер ≈10920); `cityPage`, `спросPage`, `гидPage`; FAQ в JSON-LD главной (≈6864) и `SEO`-текст, где сказано «сортировка … по цене».
- Create: `проверки/порядок-объявлений.mjs` (порт **9635**).
- Modify: `package.json` — `"проверка-порядка-объявлений": "node проверки/порядок-объявлений.mjs"`; `проверки/фильтры.mjs` — без изменений (он явно ставит `price_asc`), проверить, что проходит.

**Interfaces:**
- Produces:
  - `похожеНаМесто(x) → boolean` — `/хостел|hostel|койк|мест[оа] в (номере|комнате|хостеле)|спальн(ое|ые) мест|кровать в|за человека|с человека|за чел(\.|овек|$| )|\/ ?чел/i` по `x.title + ' ' + (x.chips||[]).join(' ')`.
  - `медианаЦены(список) → number` — медиана `price > 0` среди `!похожеНаМесто`; 0, если таких нет.
  - `рекомендуемыйПорядок(список, медиана?) → новый массив` (исходный не меняет). Без медианы считает сам; при медиане 0 — по цене по возрастанию, похожие на место — в конец.
  - Предзагрузка: `window.__PRELOAD.med` — медиана всей выдачи, клиент кладёт её в `window.__медиана` до первого `run()`, `run()` её сбрасывает.

Все три функции пишутся через `function`/`var` без стрелок (идут в браузер через `.toString()`).

- [ ] **Step 1: Написать проверку**

`проверки/порядок-объявлений.mjs` — каркас (порт 9635, имя `'recsort'`), тело:

```js
// ── функция на синтетике ──
await send('Page.navigate', { url: SITE + '/' });
await ждать(`typeof рекомендуемыйПорядок === 'function'`, 80);
const синт = await js(`рекомендуемыйПорядок([
  {price:35, title:'Место в номере на сутки для 9-ти человек', link:'a'},
  {price:130, title:'1-комн квартира', link:'b'},
  {price:60, title:'Студия у метро', link:'c'},
  {price:500, title:'Коттедж', link:'d'},
  {price:140, title:'2-комн', link:'e'}]).map(function(x){ return x.price; }).join(',')`);
check('синтетика: 140,130,60,500,35 (медиана 140, хостел в конце)', синт === '140,130,60,500,35', синт);
check('похожеНаМесто: хостел, койко-место, /чел; квартира — нет', await js(`[похожеНаМесто({title:'Хостел Центр'}), похожеНаМесто({title:'Койко-место у вокзала'}),
  похожеНаМесто({title:'Домик', chips:['30 р./чел']}), !похожеНаМесто({title:'Квартира на Немиге'})].every(Boolean)`));
check('медиана без хостелов', (await js(`медианаЦены([{price:35,title:'хостел'},{price:100},{price:120},{price:200}])`)) === 120);

// ── главная без параметров ──
await send('Page.navigate', { url: SITE + '/' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
await sleep(1500);
check('в «Сортировке» выбрано «Рекомендуемые»', await js(`$('#sort').value === 'recommended' && $('#sort').selectedOptions[0].textContent === 'Рекомендуемые'`));
check('«Рекомендуемые» — первый пункт', await js(`$('#sort').options[0].value === 'recommended'`));
const первые = JSON.parse(await js(`(function(){ var м = медианаЦены(window.__all); return JSON.stringify({ м: м,
  стр: window.__items.slice(0, 24).map(function(x){ return { price: x.price, место: похожеНаМесто(x) }; }),
  есть: window.__items.some(похожеНаМесто) }); })()`));
check('первые 24 — не хостелы', первые.стр.every(x => !x.место), JSON.stringify(первые.стр.filter(x => x.место)));
check('первая карточка — у медианы (±25%)', первые.стр[0].price >= 0.75 * первые.м && первые.стр[0].price <= 1.35 * первые.м, первые.стр[0].price + ' при медиане ' + первые.м);
if (первые.есть) check('похожие на место — в самом конце выдачи', await js(`(function(){ var i = window.__items, п = i.findIndex(похожеНаМесто);
  return п >= 0 && i.slice(п).every(похожеНаМесто); })()`));
check('в адресе нет sort', await js(`!/sort=/.test(location.search)`));

// ── выбор человека ──
await js(`$('#sort').value = 'price_asc'; $('#sort').dispatchEvent(new Event('change', {bubbles:true})); 1`);
await sleep(500);
check('«Дешёвые сверху» — по возрастанию цены, как раньше', await js(`window.__items.every(function(x, i, a){ return !i || a[i-1].price <= x.price; })`));
check('выбор записан в адрес', await js(`/sort=price_asc/.test(location.search)`));
await send('Page.navigate', { url: SITE + '/?sort=price_asc' });
await ждать(`document.querySelectorAll('#grid .card').length > 0 && !/Ищу/.test(document.getElementById('stat').textContent)`, 240);
check('ссылка с sort=price_asc открывается дешёвыми сверху', await js(`$('#sort').value === 'price_asc' && window.__items.every(function(x, i, a){ return !i || a[i-1].price <= x.price; })`));
await js(`$('#rooms').value = '2'; $('#rooms').dispatchEvent(new Event('change', {bubbles:true})); 1`);
await ждать(`!/Ищу/.test(document.getElementById('stat').textContent)`, 240);
check('фильтр не сбрасывает выбранный порядок', await js(`$('#sort').value === 'price_asc'`));
await js(`$('#sort').value = 'recommended'; $('#sort').dispatchEvent(new Event('change', {bubbles:true})); 1`);
await sleep(500);
check('вернули «Рекомендуемые» — sort пропал из адреса', await js(`!/sort=/.test(location.search)`));

// ── серверные страницы ──
const медиана = xs => { const ц = xs.filter(x => x > 0).sort((a, b) => a - b); return ц[Math.floor(ц.length / 2)]; };
const выдача = (await getJSON(SITE + '/api/search?region=grodno&city=&type=flat&rooms=&guests=&max=&source=both')).items;
const htmlГродно = await (await fetch(SITE + '/grodno')).text();
const ценыГродно = [...htmlГродно.matchAll(/<div class="p">(?:от )?(\d+) BYN/g)].map(м => +м[1]);
const мГ = медиана(выдача.filter(x => !/хостел|hostel|койк|мест[оа] в (номере|комнате|хостеле)/i.test(x.title || '')).map(x => x.price));
check('/grodno: первая карточка у медианы (±25%)', ценыГродно.length > 0 && ценыГродно[0] >= 0.75 * мГ && ценыГродно[0] <= 1.35 * мГ, ценыГродно.slice(0, 5).join(',') + ' медиана ' + мГ);
const htmlДёшево = await (await fetch(SITE + '/grodno-nedorogo')).text();
const ценыД = [...htmlДёшево.matchAll(/<div class="p">(?:от )?(\d+) BYN/g)].map(м => +м[1]);
check('/grodno-nedorogo: по-прежнему дешёвые сверху', ценыД.every((ц, i) => !i || ценыД[i - 1] <= ц), ценыД.slice(0, 8).join(','));
const home = await (await fetch(SITE + '/')).text();
const пред = JSON.parse((home.match(/__PRELOAD\s*=\s*(\{[\s\S]*?\});/) || [])[1] || '{}');
check('предзагрузка главной: есть med и первая — у медианы', пред.med > 0 && пред.items[0].price >= 0.75 * пред.med && пред.items[0].price <= 1.35 * пред.med, пред.med + ' / ' + (пред.items || [])[0]?.price);
```

- [ ] **Step 2: Запустить — падает** (`рекомендуемыйПорядок` нет, `#sort` = `price_asc`).

- [ ] **Step 3: Функции порядка** (после `ЦЕНА_ЗА_ЧЕЛОВЕКА`)

```js
// ── «Рекомендуемые» ───────────────────────────────────────────────────────
// Владелец (16.09): по умолчанию сверху стояли самые дешёвые — а это места
// в хостеле и цены за человека, и выдача выглядела обманом. Теперь без
// выбора человека сверху обычное жильё по обычной для этой выдачи цене,
// дальше — дешевле и дороже, в самом конце — похожее на койко-место.
// Стоит выбрать «Дешёвые сверху» — порядок строго по цене, как раньше.
// Функции идут и в скрипт главной (.toString()) — без стрелок.
function похожеНаМесто(x){
  var т = String((x && x.title) || '') + ' ' + ((x && x.chips) || []).join(' ');
  return /хостел|hostel|койк|мест[оа] в (номере|комнате|хостеле)|спальн(ое|ые) мест|кровать в|за человека|с человека|за чел(\.|овек|$| )|\/ ?чел/i.test(т);
}
function медианаЦены(список){
  var ц = (список || []).filter(function(x){ return x && x.price > 0 && !похожеНаМесто(x); })
    .map(function(x){ return x.price; }).sort(function(a, b){ return a - b; });
  return ц.length ? ц[Math.floor(ц.length / 2)] : 0;
}
function рекомендуемыйПорядок(список, медиана){
  var м = медиана > 0 ? медиана : медианаЦены(список);
  function полоса(x){
    if(похожеНаМесто(x)) return 3;
    if(!м || !(x.price > 0)) return 2;
    var к = x.price / м;
    if(к >= 0.75 && к <= 1.35) return 0;
    if(к >= 0.5 && к <= 2.5) return 1;
    return 2;
  }
  return (список || []).map(function(x){
    return { x: x, п: полоса(x), д: (м && x.price > 0) ? Math.abs(Math.log(x.price / м)) : x.price || 0,
             ф: (x.photos || []).length };
  }).sort(function(a, b){
    return a.п - b.п || a.д - b.д || b.ф - a.ф || (a.x.link < b.x.link ? -1 : a.x.link > b.x.link ? 1 : 0);
  }).map(function(o){ return o.x; });
}
```

(При `м = 0` поле `д` — цена, значит порядок по возрастанию цены, хостелы в конце.)

- [ ] **Step 4: Главная (`PAGE`)**

1) Рядом с `${перетаскиваниеСтрок.toString()}`:
```
${похожеНаМесто.toString()}
${медианаЦены.toString()}
${рекомендуемыйПорядок.toString()}
```
2) `#sort`:
```html
      <select id="sort">
        <option value="recommended" selected>Рекомендуемые</option>
        <option value="price_asc">Дешёвые сверху</option>
        <option value="price_desc">Дорогие сверху</option>
        <option value="rating_desc">По рейтингу</option>
      </select>
```
3) `currentSort`: для Беларуси `($('#sort')?$('#sort').value:'recommended')` (Россия без изменений — `rfSort`, там нет «Рекомендуемых»).
4) `sortItems`:
```js
function sortItems(){
  const s=currentSort();
  if(window.__mode!=='ru' && s==='recommended'){
    // медиана — по всей выдаче; у предзагрузки в руках 24 карточки, медиану приносит сервер
    const м = window.__медиана || медианаЦены(window.__all||[]);
    // на месте, а не новым массивом: слайдер, описание и enrichRealt держат ссылку на __items
    const порядок = рекомендуемыйПорядок(window.__items||[], м);
    const items = window.__items||[];
    items.length = 0;
    порядок.forEach(function(x){ items.push(x); });
    return;
  }
  (window.__items||[]).sort(function(a,b){ return s==='price_desc'? b.price-a.price : s==='rating_desc'? (((b.rating||0)-(a.rating||0))||(a.price-b.price)) : a.price-b.price; });
}
```
5) `URL_DEFAULTS.sort = 'recommended'`. В `applyUrl` и возврате фильтров ничего менять не надо: пустое `sort` оставляет выбранное по умолчанию.
6) Обработчик `#sort` (≈8667): `$('#sort').addEventListener('change', function(){ window.__page=1; renderCards(); syncUrl(); });`
7) Предзагрузка, клиент (≈10021): после `window.__items = …` — `window.__медиана = window.__PRELOAD.med || 0;`. В `run()` рядом с `window.__preloadShown = false;` — `window.__медиана = 0;`.
8) Предзагрузка, сервер (≈10923):
```js
      const порядок = рекомендуемыйПорядок(d.items || []);
      const preload = { total:d.total, kufar:d.kufar, realt:d.realt, flatbook:d.flatbook,
                        med: медианаЦены(d.items || []), items: порядок.slice(0, 24) };
```
9) Тексты: в FAQ JSON-LD главной «Повторы убираем, места в выдаче не продаём: сортировка одна для всех, по цене.» → «Повторы убираем, места в выдаче не продаём: порядок одинаковый для всех — сначала обычные варианты по типичной для города цене, а «дешёвые сверху» и другие порядки можно выбрать самому.» Найти такие же слова в других местах: `grep -n "сортировка одна\|по цене\." kvartiry-server.js` и поправить так же по смыслу, не добавляя новых фактов.

- [ ] **Step 5: Городские страницы**

- `cityPage`: ветку «срез по всему диапазону цен» (`if(!kind && pool.length > 40){ step… }`) и `pool.slice(0, 30)` заменить на:
```js
  // Основная страница — «Рекомендуемые», как главная по умолчанию: сверху
  // обычное жильё по обычной цене. Уточнение «недорого» — дешёвые сверху
  // (за ним и приходят); у усадеб и коттеджей — тоже рекомендуемые.
  // Страницы /minsk и /minsk-nedorogo от этого по-прежнему разные.
  const items = (kind === 'nedorogo' ? pool : рекомендуемыйПорядок(pool)).slice(0, 30);
```
(комментарий про «первые 30 одинаковые» — удалить вместе со старым кодом).
- `спросPage`: `const items = рекомендуемыйПорядок(d.items || []).slice(0, 30);`
- `гидPage`: `рекомендуемыйПорядок(кв.items || []).slice(0, 12)`.
- `stayNearPoint` («жильё рядом» у мест) не трогаем: там порядок — отдельный вопрос (см. «Неясности»).

- [ ] **Step 6: Прогнать** (по одной): `скрипт-страницы`, `порядок-объявлений`, `фильтры`, `возврат-и-фильтры`, `страницы-и-выдача`, `seo`, `поиск-и-кэш`, `слайдер` → падает 0. Если `страницы-и-выдача` проверяет различие `/minsk` и `/minsk-nedorogo` — должно проходить.

- [ ] **Step 7: Коммит**

```bash
git add kvartiry-server.js проверки/порядок-объявлений.mjs package.json
git commit -m "Выдача: «Рекомендуемые» по умолчанию — обычное жильё по типичной цене сверху, хостелы в конце

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Яндекс.Метрика на всех страницах (невидимо)

Владелец создал счётчик **112722670** (вебвизор, карта скроллинга, аналитика форм включены; информер не нужен). Код ставится на каждую HTML-страницу сайта и ничего не показывает посетителю.

- [ ] **Step 1:** Найти все места, где собирается `<head>` HTML-страниц (главная `PAGE`/`ГЛАВНАЯ`, /marshrut, /m/<slug>, /mesto, /podborka, городские страницы, /predlozheniya, /stats, 404 и прочие). Лучше один общий кусок (константа, например `МЕТРИКА`) и вставка через уже существующие общие помощники (`метаСтраницы` и т. п.), чтобы новые страницы получали его автоматически. Учесть ограничения `PAGE` (шаблонная строка: без обратных кавычек, `${`, обратные слэши съедаются).
- [ ] **Step 2:** Код — стандартный асинхронный (exact values):
  - в `<head>`: `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(112722670,"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});</script>`
  - в `<body>` (или сразу после head-скрипта): `<noscript><div><img src="https://mc.yandex.ru/watch/112722670" style="position:absolute;left:-9999px" alt=""></div></noscript>`
  - Страницы только для владельца (`/predlozheniya`, `/stats`) — без счётчика, чтобы владелец не засорял статистику.
  - Не ставить счётчик, если страницу открыли проверки: переменная окружения `METRIKA_OFF=1` отключает вставку (в тестах запускать сервер с ней; на Render её нет). Живые проверки против сайта не должны массово слать визиты — достаточно, что `METRIKA_OFF` нет только на Render; прогоны против живого сайта редкие.
  - Если на сайте есть Content-Security-Policy — разрешить `mc.yandex.ru`, `mc.yandex.by`, `yastatic.net` (script/img/connect/frame для вебвизора).
- [ ] **Step 3:** Метки `?from=tiktok-…` не трогать — Метрика видит их в адресе сама.
- [ ] **Step 4:** Тест `проверки/метрика.mjs` (без браузера): сервер без `METRIKA_OFF` — главная, /mesto/286, /m/lida-voronovo, /marshrut?p=286,4198, /podborka/osen, /grodno, 404 содержат `ym(112722670,"init"` ровно один раз и noscript-картинку; /predlozheniya?key=… и /stats?key=… — не содержат; сервер с `METRIKA_OFF=1` — главная не содержит. На видимой части страницы ничего нового (нет информера).
- [ ] **Step 5:** Прогнать `скрипт-страницы`, `seo`, `страницы-и-выдача`, `метрика` → падает 0. Коммит «Метрика: счётчик 112722670 на всех страницах, без информера».

---

### Итоговая сверка (после Task 7)

- [ ] Свежий запуск сервера на 8241, подождать ~3 мин (каталоги).
- [ ] По одной: `скрипт-страницы`, `поиск-и-кэш`, `страницы-и-выдача`, `seo`, `пустые-страницы`, `фильтры`, `вкладки`, `возврат-и-фильтры`, `места`, `слайдер`, `телефон`, `по-пути`, `план-дня`, `порядок-маршрута`, `маршруты-из-видео`, `рекомендуемые-маршруты`, `своя-точка`, `поделиться-и-картинка`, `подборки`, `популярное`, и новые `рядом-с-жильём`, `города-и-места`, `поделиться-избранным`, `выходные`, `порядок-объявлений` → везде «падает 0».
- [ ] `ls -d "$TEMP"/cdp-* 2>/dev/null` — пусто (или только чужие старые, не от этого прогона).
- [ ] Остановить свой сервер по PID порта 8241.

## Неясности (решены так, владельцу стоит подтвердить)

1. **Task 6, «при выборе фильтра»**: понято как «когда человек сам выбирает порядок». Фильтры (комнаты, цена, тип) порядок не переключают — остаётся «Рекомендуемые», что и написано в списке. Если владелец хотел, чтобы любой фильтр включал «дешёвые сверху», — одна строка в обработчике фильтров.
2. **Task 6, хостелы у Kvartirka/Check-in без слова «хостел»** (например, 35 BYN на Воронянского, 10) по тексту не распознать; они уходят вниз полосой «очень дёшево» (< 0,5 медианы), но не в самый конец.
3. **Task 6, «жильё рядом» на страницах мест и маршрутов** (`stayNearPoint`, сортировка по цене) и отели России не меняются — владелец говорил о главной и городских страницах.
4. **Task 3, заголовки основных городских страниц** меняются на «… и что посмотреть рядом» — это может на время сдвинуть их позиции в поиске.
5. **Task 4**: объявление, которого нет в памяти сервера (Kufar отдаёт до 200 на запрос), показывается как «не нашли сейчас» со ссылкой на площадку, а не как «снято».
