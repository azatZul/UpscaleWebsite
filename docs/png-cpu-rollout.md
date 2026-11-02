# PNG и CPU: реализация и приёмка

## Текущее состояние

Приёмка завершена 30 октября 2026. Мобильный предел прозрачного PNG — **28 311 552 выходных пикселя**, длинная сторона — не более 8192 px. Production gate открыт; пакет ранее подготовлен успешно, деплой не выполнялся. Модели и ORT 1.23.2 не менялись. [Решение о Drawing](drawing-model-decision.md) сохраняет текущие модели и сравнение нативного 4× с двумя проходами 2× на 19 изображениях.

На физическом iPhone 14 Pro / Safari 27.2 прошли три последовательных запуска через настоящий интерфейс: вход 4096×1728, результат 8192×3456, PNG по 99 651 570 байт. Время — 262,722 / 297,333 / 398,581 с. Каждый результат отображался на странице и повторно декодировался из Blob ссылки скачивания; по 256 проб альфы дали alphaError=0. Ошибок и предупреждений страницы не было. Safari Automation отказала в Wake Lock; WebDriver касался инертного элемента каждые 30 секунд. Это условие записано в [итоговом отчёте](../benchmarks/browser/2026-10-30/iphone-maximum-ui.json).

[PNG release manifest](../benchmarks/browser/png-release.json) перечисляет обязательные успешные отчёты; `scripts/package_production.mjs` проверяет их перед упаковкой. [Отчёт упаковки](../benchmarks/browser/2026-10-30/packaging-gate.json) фиксирует 345 файлов, 130,7 MiB, без публикации. [Сводка проверок](../benchmarks/browser/implementation-verification.json) хранит контрольную сумму исходников, прежние результаты полных проверок и область последующих изменений.

## Реализация

- Фактическая альфа <255 выбирает PNG, включая один пиксель с alpha=254; непрозрачные изображения сохраняются в JPEG. PNG/WebP сканируются полосами до 256 строк. PNG-допуск проверяется до выделения полных RGB/alpha-массивов; отдельно учитываются подготовка, экспорт и редактор лиц.
- RGB прозрачных пикселей заполняется глобальным двухпроходным манхэттенским распространением. Доноры имеют alpha≥128; если таких нет, используется максимальная ненулевая альфа. Видимый RGB не перекрашивается. Scratch освобождается до запуска модели. Полностью прозрачный вход обходит модель; пропуск пустого тайла учитывает перекрытие и билинейную поддержку.
- Альфа масштабируется по глобальным центрам пикселей и восстанавливается после смешивания RGB-полос. Превью, результат и база редактора сохраняют прозрачность. Шахматная подложка реализована CSS и не попадает в экспорт. MIME, размеры и расширение проверяются после экспорта.
- YuNet и landmarks/GFPGAN готовят RGB на небольших поверхностях. Наложение лица использует `source-atop`, сохраняя альфу основы. Исправлен Safari-кроп за границами ImageBitmap: вместо отрицательного source rectangle рисуется целое изображение с трансформацией и обрезанием по Canvas. Переключение уже улучшенных лиц пересобирает результат из базы и кэшированных patches без повторного GFPGAN.
- Общий контроллер создаёт новый worker для каждой попытки, игнорирует поздние сообщения, сохраняет готовые лица при повторе апскейла и прежний результат при ошибке редактора. Порядок — WebGPU → проверенный CPU N → CPU 1. Ошибки сети, файла, экспорта и композиции не запускают повтор инференса.
- Таймаут требует реального прогресса, повтор статуса его не продлевает. В фоне таймер приостановлен. Порог — максимум 120 с и тройного измеренного максимума операции; экспорт масштабируется по площади. Падение всей вкладки не восстанавливается.
- ETA обучается полным временем сборки при ≥16 тайлах, только если ни один не пропущен; ключи `uscale-tile-ms-v2-*` сохранены. Аналитика различает этап, исходную причину ошибки, фактический GPU fallback и явный CPU retry.

## Политика CPU

`cpu-policy.js` учитывает ОС, движок/версию браузера, классы ядер 1–2 / 3–4 / 5–8 / 9–16 / 17+ и памяти ≤4 / >4 / неизвестно. Неизвестный класс, отсутствие проверенной строки, изоляции или shared memory оставляют CPU 1. Версия Safari берётся из `Version`; минимальная версия не задаёт верхней границы, известные плохие диапазоны запрещаются отдельно. Worker повторно проверяет возможности, ORT настраивается один раз до сессий.

Для macOS / Chromium ≥151, 9–16 ядер, память >4 ГБ включены **8 потоков апскейла и 7 потоков лиц**. Исходные измерения: M4 Pro, 14 ядер, 48 ГБ (браузер сообщает 8 ГБ), пять запусков кандидатов 1/2/4/7/8. Выбор требует стабильности, ≥15% выигрыша и предпочитает меньше потоков при разнице ≤3%. Суммарная медиана четырёх моделей апскейла сократилась примерно на 82%, лиц — на 78%. Это измерения одного тайла в новом продуктовом worker, а не обещание одинакового ускорения для любой фотографии.

Отказ CPU N при запуске/инференсе, таймаут или подтверждённое понижение ORT до одного потока запоминаются на 7 дней. Ключ включает ревизии политики/ORT/моделей, ОС/движок/основную версию, классы устройства, группу и N. Отмена, сеть и экспорт не запоминаются; localStorage необязателен. Без инициализации модели `effectiveThreads` не выдаёт фиктивную единицу и не портит кэш отказов.

На iPhone/iPad лица используют CPU 1, апскейл может использовать WebGPU. Многопоточность остальных ОС/движков/классов не включена. Физические Android/iPad и настоящий desktop Safari в этой приёмке не проверялись; Playwright WebKit учитывается отдельно.

## Сохранённые проверки

В Git оставлены последние полные результаты по каждому сценарию и исходные замеры, прямо указанные в политике/таймаутах. Дубликаты, промежуточные ревизии и диагностические логи перенесены в игнорируемую `.web-model-work/browser-reports/archive/2026-10-30-cleanup/`; они не требуются для упаковки. Повторная генерация отчётов по умолчанию также пишет в `.web-model-work/browser-reports/`.

| Проверка | Сохранённые данные |
| --- | --- |
| PNG Photo/Drawing × 2×/4×, по 36 случаев | [Chromium](../benchmarks/browser/2026-10-28/release-28mp/png-chromium.json), [WebKit](../benchmarks/browser/2026-10-28/release-28mp/png-webkit.json), [Firefox](../benchmarks/browser/2026-10-28/png-firefox.json) |
| YuNet → landmarks → GFPGAN → апскейл → выключение/возврат лица | [Chromium](../benchmarks/browser/2026-10-28/release-28mp/face-png-chromium.json), [WebKit](../benchmarks/browser/2026-10-28/face-png-webkit.json), [Firefox](../benchmarks/browser/2026-10-28/face-png-firefox.json) |
| Реальный iPhone: 18 PNG/WebP-случаев, JPEG, отмена, recovery, редакторы 1024×1024 и 6144×4608 | [iPhone processing](../benchmarks/browser/2026-10-28/iphone-processing.json) |
| GPU adapter/import/download/export failures, PNG admission, кэш лиц, ETA, UI/аналитика | [Регрессии](../benchmarks/browser/2026-10-28/release-28mp/regressions-chromium.json) |
| Пустой PNG не отключает рабочую многопоточность | [Кэш потоков](../benchmarks/browser/2026-10-28/release-28mp/thread-cache-chromium.json) |
| Реальная авария worker → зависание CPU N → CPU 1 | [Восстановление](../benchmarks/browser/2026-10-28/release-28mp/recovery-chromium.json) |
| PNG/JPEG, имена/подписи, шахматная подложка и отмена | [Интерфейс](../benchmarks/browser/2026-10-28/release-28mp/ui-chromium.json) |
| Полная сборка и две отдельные lab-сборки, manifest/assets и семь локализованных страниц | [Сохранность сборки](../benchmarks/browser/2026-10-28/lab-build.json) |
| Прежние полные тесты: 123 JS, 77 Python без пропусков, 153 серверных, TypeScript, 126 страниц | [Локальная проверка](../benchmarks/browser/2026-10-28/release-28mp/local-verification.json) |
| Исходные измерения CPU-политики | [Апскейл](../benchmarks/browser/mac_chromium_151_product_cpu.json), [лица целиком](../benchmarks/browser/cpu-face-detect-chromium-final.json), [GFPGAN](../benchmarks/browser/cpu-face-chromium-final.json) |

Отдельные ранние отчёты сохранены только как первичные источники чисел в `TIMING_PROFILES`: [Firefox tile](../benchmarks/browser/png-firefox-rgb-parity.json), [детекция](../benchmarks/browser/face-png-chromium-final.json), [экспорт большого PNG](../benchmarks/browser/iphone_14_pro_png_max_interrupted.json). Последняя серия была прервана и имеет `passed:false`; она подтверждает длительность завершённых операций, но не приёмку старого предела. В production gate она не включена.

Цветовой эталон — непрозрачный проход того же декодированного RGB с восстановленной альфой. Canvas может округлять RGB при малой альфе; побитовое сохранение такого RGB не обещается. В Firefox повторное наложение дало raw RGB-разницу до 19, воспроизводимую обычным PNG → Canvas → PNG без инференса; видимая композиция на белом/чёрном фоне отличается не более чем на 2/255, непрозрачные пиксели и альфа не меняются. Firefox-матрица выполнялась независимыми процессами: её времена не считаются измерением производительности. После снижения только мобильного лимита полные Chromium/WebKit-матрицы повторены; новый полный Firefox-повтор не заявляется.

На iPhone в проверке редактора были два предупреждения о перенесённых ResizeObserver-уведомлениях без исключений JS. Финальная максимальная серия прошла без предупреждений. Прежний предел 51 986 432 px отклонён: дополнительное ImageBitmap/Canvas-чтение после UI-экспорта оказалось нестабильным; ранее две максимальные серии теряли WebDriver-сессию в третьем прогоне. Причина потери сессии не установлена. После снижения до 28,3 МП один запуск был добровольно остановлен пользователем; окончательная приёмка основана на трёх завершённых запусках 30 октября.

После ревью `check_ios_png.py` сбрасывает старый успешный JSON до загрузки worker/обращения к WebDriver и сохраняет `passed:false` при сбоях подготовки, транспорта, потере страницы и таймауте, оставляя завершённые прогоны. Все 12 тестов двух iPhone-скриптов прошли отдельно; остальные проверки и физическая приёмка повторно не запускались. Последующая очистка отчётов меняет только материалы проверки и документацию.

## Воспроизведение

Исправление от 2 ноября 2026: в `2e7e8d1` статус начала каждого тайла скрывал
процент и ETA до следующего завершённого тайла; следующий статус снова сразу
их скрывал. Теперь начало тайла сохраняет измеренный прогресс и ETA, а
композиция/экспорт показывают 96–97%. Проверка `--suite progress` использует
настоящие workers через публичный UI и проверяет каждый статус на трёх тайлах
JPEG и прозрачного PNG. Она воспроизводит ошибку на исходном worker из коммита
и проходит в Chromium 151 и Playwright WebKit 26.5 после исправления.
[Отчёт](../benchmarks/browser/2026-11-02/processing-progress.json) также содержит
два чередующихся сравнения CPU 1 с кодом до последнего коммита: заметного
замедления на этом desktop-тесте нет. Физический iPhone повторно не проверялся;
это исправление отображения, а не подтверждённое ускорение iOS.

Общий production-релиз 2 ноября опубликован на `upscales.app`: исправление
прогресса, мобильная раскладка store badges и счётчик 1686 отзывов.
Cloudflare version: `3074c4c6-6f2d-4698-8b71-208681f633de`.

Отдельная ошибка Chrome на iOS исправлена локально 2 ноября: MediaPipe 1.0.1
считал `CriOS/... Safari/...` без `Version/` браузером без OffscreenCanvas и
обращался к `document.createElement` внутри worker. Теперь граф FaceLandmarker
получает явный OffscreenCanvas. На физическом iPhone / iOS 27.2.0 / Chrome 156
два исходных запуска падали с `Can't find variable: document`; после исправления
обнаружены и улучшены оба лица, готовое изображение получено и подтверждено
пользователем. [Отчёт](../benchmarks/browser/2026-11-02/ios-chrome-faces.json)
содержит также полный UI-тест с этим User-Agent в Chromium и WebKit. Проверка
требует реальных landmarks/GFPGAN и готового JPEG; подмена только движка
браузера без User-Agent эту ошибку не воспроизводила.

Индикатор скачивания модели также скорректирован локально: вместо прежних
45% на веса и 55% на движок используются 90% + 10%, с одной подписью и без
нового этапа. Поэтому закэшированный движок больше не создаёт скачок с
половины шкалы до завершения. Если Content-Length отсутствует или относится
к сжатому HTTP-ответу, процент не выдумывается; полученные байты продолжают
обновлять watchdog. Проверки `progress` и `ios-faces` проверяют отображаемые
значения, достижение 90% и 100% и отсутствие отдельного этапа движка.

```sh
npm run test:tool
python3 -m unittest discover -s tests -p 'test_ios*.py'
python3 -m unittest discover -s tests -p test_localization.py
npm run build
node scripts/check_lab_build.mjs
USCALE_LAB_PORT=4187 node scripts/serve_lab.mjs
node scripts/check_browser_processing.mjs --suite png --url http://127.0.0.1:4187
node scripts/check_browser_processing.mjs --suite cpu --model all --threads 1,2,4,7,8
node scripts/check_browser_processing.mjs --suite faces --threads 1,2,4,7,8 --local-face-model
node scripts/check_browser_processing.mjs --suite faces --detect --threads 1,2,4,7,8 --local-face-model
node scripts/check_browser_processing.mjs --suite face-png --local-face-model
node scripts/check_browser_processing.mjs --suite recovery
node scripts/check_browser_processing.mjs --suite ui
node scripts/check_browser_processing.mjs --suite progress
node scripts/check_browser_processing.mjs --suite ios-faces --local-face-model
node scripts/check_browser_processing.mjs --suite regressions --local-face-model
node scripts/check_browser_processing.mjs --suite thread-cache --local-face-model
node scripts/check_browser_processing.mjs --suite drawing-ablation
```

Браузерный runner поддерживает `--browser chromium|firefox|webkit`, `--output`, `--model`, `--scale`, `--names`, `--runs`, `--pause`. Если Playwright установлен вне checkout, задаётся `USCALE_PLAYWRIGHT_MODULE` до его `index.mjs`; браузеры выбираются через `PLAYWRIGHT_BROWSERS_PATH`. Локальная GFPGAN проверяется по SHA256 против production-весов и передаётся потоком. Для GPU-регрессий Chromium получает тестовый `--enable-unsafe-webgpu`, на Mac — `--use-angle=metal`; разрешение loopback и fault injection относятся только к тестовому контексту.

Для физического iPhone включить Web Inspector / Remote Automation, запустить `safaridriver --port 4188` и создать iOS Safari WebDriver session. В её отдельной вкладке открыть `https://upscales.app/upscale/?mode=device`, телефон оставить разблокированным. Затем:

```sh
python3 scripts/check_ios_processing.py --session SESSION_ID --suite processing
python3 scripts/check_ios_processing.py --session SESSION_ID --suite maximum --keep-active
```

Это локально собранные UI/workers с неизменными опубликованными URL моделей, без деплоя. Максимальная UI-серия требует ≥3 последовательных проходов; по умолчанию вход 4096×1728, результат 8192×3456. `--keep-active` фиксирует касания инертного элемента каждые 30 с при отказе Safari Automation в Wake Lock. `scripts/check_ios_png.py --session SESSION_ID` оставлен для отдельной диагностики product worker; он не заменяет UI/display/download/reopen-приёмку. JSON, снимки и PNG сохраняются локально в игнорируемой `.web-model-work/browser-reports/`. Для измерения CPU на телефоне кандидаты 1/2 чередуются минимум по пять раз с одинаковыми паузами 60 с; такие многопоточные профили пока не включены.
