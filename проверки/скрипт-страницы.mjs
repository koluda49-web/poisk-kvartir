// Проверка, что скрипт страницы вообще запустится в браузере.
//
// Зачем. Страница собирается на сервере как одна большая строка, и внутри неё
// легко испортить экранирование: например, \n превращается в настоящий перенос
// и рвёт строку пополам. Сайт после этого отдаётся с кодом 200, но у посетителя
// не работает НИЧЕГО. Команда `node -c` такое не ловит — она проверяет только
// сам сервер, а не то, что он отдаёт.
//
// Сервер должен быть уже запущен.
//   npm start                        а в другом окне:
//   npm run проверка-страницы
//   npm run проверка-страницы https://poisk-kvartir.onrender.com

const BASE = process.argv[2] || 'http://127.0.0.1:8080';

const html = await (await fetch(BASE + '/')).text();
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m, checked = 0, bad = 0;

while ((m = re.exec(html))) {
  const attrs = m[1] || '', code = m[2];
  if (/\bsrc=/.test(attrs)) continue;                                // подключённый файл, не наш текст
  if (/type=["'](?!text\/javascript|module)/.test(attrs)) continue;  // ld+json и прочее не код
  checked++;
  try { new Function(code); }
  catch (e) { bad++; console.log('Сломан блок скрипта: ' + e.message); }
}

console.log(bad
  ? ('СЛОМАНО блоков: ' + bad + ' — страница у посетителя работать не будет')
  : ('Скрипт страницы разбирается без ошибок (проверено блоков: ' + checked + ')'));
process.exit(bad ? 1 : 0);
