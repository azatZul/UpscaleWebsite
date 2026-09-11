# Публичные альбомы «до/после» на Cloudflare Worker — план v2

## 0. Продуктовый цикл (источник всех решений ниже)

1. Находим на Reddit запрос на восстановление фото.
2. Локальным скриптом восстанавливаем (вне этого плана).
3. Локальной CLI-командой публикуем альбом: до 20 пар «до/после».
4. Кидаем ссылку в комментарий. Reddit должен показать настоящий watermarked cover.
5. Автор запроса может за небольшую сумму разблокировать полноразмерные файлы.
   Разблокировка глобальная — после неё чистые файлы доступны всем. Это принято намеренно.

Витрина `/gallery` — вторичный, но индексируемый актив: страница живых примеров работы приложения.

## 1. Зафиксированные решения

| # | Решение |
|---|---|
| D1 | Worker живёт на зоне `upscales.app` и сам отдаёт статику из `dist/` через Static Assets. Домен уже проксируется Cloudflare (NS `*.ns.cloudflare.com`); Netlify остаётся запасным деплоем той же сборки. |
| D2 | Worker стоит на `upscales.app/*` и отдаёт весь сайт через Cloudflare Static Assets (`html_handling=none`, `run_worker_first` только на альбомных путях). Существующие `.html`-адреса и индексы каталогов сохраняются сгенерированным `_redirects`. |
| D3 | Обвязку страниц (`<head>`, шапка, подвал, тема, хеши CSS/JS) генерирует `build.py` в виде shell-шаблона; Worker подставляет в него контент. Разметку в TS не дублируем. |
| D4 | Страницы альбомов и `/gallery` — **только на английском**. Локалепрефиксы (`/ru/gallery`) Worker не обслуживает. |
| D5 | `/gallery` индексируется, попадает в `sitemap.xml`, без hreflang-альтернатив. Страницы альбомов — `noindex, nofollow`. |
| D6 | ID альбомов и фото — криптослучайные, Crockford base32, 26 символов (130 бит). Слаги не используем. |
| D7 | Удаления по времени нет. Колонка `expires_at` есть, по умолчанию `NULL`; Cron Trigger добавляется позже, если понадобится. Таблицы `checkouts`, `payment_events`, `refund_jobs` из миграции `0001` тоже зарезервированы под этап 2 и пока не читаются. |
| D8 | Публичного admin API нет. CLI пишет напрямую в R2 (S3-совместимый API) и D1 (REST API) по scoped-токенам Cloudflare. У Worker нет ни одного write-эндпоинта, кроме будущего webhook. |
| D9 | Чистые файлы отдаёт Worker стримом из приватного R2. Presigned-URL не используем — после unlock доступ и так публичный, а так проще инвалидировать. |
| D10 | R2-объекты иммутабельны: ключ содержит случайный ID и никогда не перезаписывается. Перепубликация = новый альбом. Отсюда `immutable`-кэш на preview. |
| D11 | Этап 1 без платежей: провайдер `manual`, разблокировка командой `album unlock <id>` или из loopback-only Reddit Scout. Locked-альбомы с ценой 0 разрешены в production и показывают только watermarked preview. |
| D12 | На странице альбома — единый before/after carousel со стрелками, page control, полноэкранным режимом и ссылкой «Request removal» (mailto). Бэкенда для жалоб нет: снятие делается через `album delete`. |
| D13 | CLI пишется на Python + Pillow + boto3 в отдельном venv. `build.py` остаётся stdlib-only — зависимости CLI в сборку сайта не протекают. |

## 2. Архитектура

```
Reddit / браузер
      │
Cloudflare (зона upscales.app, весь трафик)
      └── Worker (TS)
            ├─ альбомные маршруты
            │     ├─ D1  (метаданные и состояние; таблицы платежей зарезервированы)
            │     ├─ R2  (приватный бакет: preview, cover, clean, zip)
            │     └─ shell ──► env.ASSETS (dist/_shell/album.html)
            └─ всё остальное ──► env.ASSETS (dist/, собранный build.py)

Netlify остаётся запасным деплоем той же самой dist/.

Локально: CLI (Python) ──► R2 S3 API + D1 REST API
```

Репозиторий: новая директория `worker/` (TS, wrangler) и `tools/album/` (CLI). Netlify её игнорирует — команда сборки остаётся `python3 build/build.py`.

## 3. Маршруты

| Маршрут | Ответ |
|---|---|
| `GET /gallery` | SSR-список публичных альбомов, новые сверху. Индексируется. |
| `GET /gallery/:albumId` | SSR-страница альбома. |
| `GET /media/:albumId/:photoId/:variant` | `before` / `after` — watermarked preview из R2. |
| `GET /media/:albumId/cover.jpg` | OG-cover 1200×630, watermarked. Должен отдаваться крауле­рам без кук и редиректов. |
| `GET /media/:albumId/gallery.jpg` | Сжатая before/after-карточка 960×720 для `/gallery`. Альбом без неё в галерею не попадает. |
| `GET /download/:albumId/:photoId` | Полноразмерный чистый файл. Только при `state='unlocked'`, иначе 403. |
| `GET /download/:albumId/all.zip` | Заранее собранный ZIP. Те же условия. |
| `POST /api/albums/:albumId/checkout` | Этап 2. |
| `POST /api/payments/webhook/:provider` | Этап 2. |

Route patterns в `wrangler.jsonc`: `upscales.app/gallery`, `upscales.app/gallery/*`, `upscales.app/a/*` (301), `upscales.app/media/*`, `upscales.app/download/*`, `upscales.app/api/*`.
Путь `/_shell/*` в паттерны **не входит** — иначе subrequest Worker'а зациклится сам на себя.

Состояния: `draft → locked → unlocked`, плюс `deleted` (отдаём 410 Gone). Видимость: `public` (по умолчанию) / `private` — private не перечисляется в `/gallery`, но доступен по ссылке; это не авторизация.

## 4. Данные

### R2 (приватный бакет, один)

```
albums/<albumId>/cover.jpg                    1200×630, watermark
albums/<albumId>/gallery-v2.jpg               gallery card, 2 × 480×720 aspect-fill, JPEG 70
albums/<albumId>/<photoId>/before.webp        preview, длинная сторона ≤ 1600
albums/<albumId>/<photoId>/after-wm.webp      preview + заметный watermark
albums/<albumId>/<photoId>/clean.<ext>        полный результат, EXIF/GPS сняты
albums/<albumId>/all.zip                      все clean-файлы, EXIF сняты
```

### D1

```sql
albums(
  id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',      -- public | private
  state TEXT NOT NULL DEFAULT 'locked',           -- draft | locked | unlocked | deleted
  price_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
  cover_photo_id TEXT, photo_count INTEGER NOT NULL, zip_bytes INTEGER,
  gallery_key TEXT, gallery_mime TEXT, gallery_width INTEGER,
  gallery_height INTEGER, gallery_bytes INTEGER,
  source_url TEXT,                                -- ссылка на тред Reddit, только для себя
  created_at INTEGER NOT NULL, unlocked_at INTEGER,
  expires_at INTEGER,                             -- NULL по умолчанию (D7)
  deleted_at INTEGER)

photos(
  album_id TEXT NOT NULL, id TEXT NOT NULL, position INTEGER NOT NULL,
  before_key TEXT NOT NULL, before_w INTEGER, before_h INTEGER,
  after_key TEXT NOT NULL, after_w INTEGER, after_h INTEGER,
  clean_key TEXT NOT NULL, clean_bytes INTEGER, clean_mime TEXT,
  alt TEXT NOT NULL,
  PRIMARY KEY (album_id, id))

checkouts(id, album_id, provider, external_id, amount_cents, currency, status, created_at, expires_at)
payment_events(id, provider, external_id UNIQUE, album_id, type, amount_cents, currency, raw_hash, received_at)
```

`payment_events.external_id UNIQUE` — защита от повторной обработки webhook на уровне схемы, а не кода.

## 5. Общий shell (ключевой новый пункт)

Проблема, которой не было в v1: HTML сайта целиком собирается `build.py` — `head()`, `nav()`, `footer()`, `THEME_BOOT`, хеши `CSS_V`/`JS_V`. Если Worker будет рендерить свою разметку на TS, появится второй источник правды и страницы разъедутся при первой же правке шапки.

Решение:

1. `build.py` дополнительно пишет `dist/_shell/album.html` — обычную страницу сайта (английская локаль) с маркерами `<!--HEAD-->` и `<!--BODY-->` вместо мета-тегов и контента.
2. Worker читает shell через `env.ASSETS` — то же самое `dist/`, что отдаётся посетителям, без обращения к внешнему origin и без цикла через собственный route.
3. Если shell недоступен или в нём не ровно по одному маркеру, Worker отвечает `503` с `Retry-After`, а не отдаёт полупустую страницу.
4. Worker подставляет в `<!--HEAD-->` уникальные `og:title` / `og:description` / `og:image` / `og:image:width|height` / `twitter:card` / `robots`, в `<!--BODY-->` — контент альбома. Никакого JS-заполнения метаданных.

Из этого же следует, что слайдеры бесплатны: страница альбома выдаёт ту же разметку `.cmp-wrap`, что и `compare_slider()` (`build/build.py:1433`), и её подхватывает существующий код `assets/site.js:353`.

**Важно:** на альбомных слайдерах не ставить `data-follow` — этот флаг включает анимированный режим с `window`-слушателями `mousemove`/`scroll`/`resize` на каждый инстанс (`assets/site.js:504`). На 20 слайдерах это 60 глобальных слушателей и 20 rAF-циклов. Использовать вариант как у compare (`data-keep-pos="1"`).

## 6. CLI

`album.json` в папке публикации: `title`, до 20 элементов `{ before, after, alt }`, необязательный `cover`, необязательный `source_url`, подтверждение прав.

```
album publish <folder> [--private] [--price-usd N] [--unlocked]
album visibility <id> public|private
album unlock <id>
album delete <id>
album list
```

Локально CLI: валидирует пары и форматы → снимает EXIF/GPS (и в preview, и в clean, и в ZIP) → делает preview WebP → накладывает watermark → собирает cover 1200×630 и gallery JPEG 960×720 → собирает ZIP → грузит в R2 → вставляет строки в D1 → печатает готовую ссылку.

Автоцена: 1 фото — $3, 2–4 — $5, 5–20 — $8. `--price-usd` переопределяет цену; только `--unlocked` публикует сразу разблокированным. `--price-usd 0` без `--unlocked` создаёт ручной locked-альбом без checkout.

Публикация неатомарна по своей природе (R2 → D1). Порядок: сначала все объекты в R2, затем одна вставка в D1 в состоянии `locked`. Альбом виден только после успешной записи в D1; осиротевшие объекты R2 подчищает `album gc`.

## 7. Разблокировка и платежи

Интерфейс из v1 сохраняется без изменений:

```ts
interface PaymentProvider {
  createCheckout(input): Promise<{ checkoutId: string; redirectUrl: string }>;
  verifyWebhook(rawBody, headers): Promise<PaymentEvent>;
  expireCheckout(checkoutId: string): Promise<void>;
  refund(paymentId: string, reason: string): Promise<void>;
}
```

Этап 1 реализует только адаптер `manual`, вызываемый из CLI. Разблокировка в обоих случаях — один и тот же атомарный запрос:

```sql
UPDATE albums SET state='unlocked', unlocked_at=? WHERE id=? AND state='locked'
```

Победитель определяется по `meta.changes === 1`; второй одновременный платёж возвращается. Цена берётся только из D1, сумма от клиента не принимается. Webhook — источник истины, success redirect только ускоряет обновление страницы.

Провайдер выбирается после определения юрисдикции: Stripe/Paddle/Lemon Squeezy российский бизнес не поддерживают.

## 8. Кэш и заголовки

| Маршрут | Cache-Control | Прочее |
|---|---|---|
| `/gallery` | `public, max-age=0, s-maxage=60` | индексируется |
| `/gallery/:id` | `private, no-store` | `X-Robots-Tag: noindex, nofollow`; состояние всегда свежее |
| `/media/*` | `public, max-age=31536000, immutable` | ключи иммутабельны (D10) |
| `/download/*` | `private, no-store` | `Content-Disposition: attachment`, поддержка `Range`, ETag из R2 |

## 9. Безопасность

- Бакет приватный; знание ключа не даёт доступа к clean-файлу — Worker сперва читает `state` из D1.
- Ни одного публичного write-эндпоинта (D8). Токены CLI: R2 — только на один бакет, D1 — только на одну базу; лежат в локальном `.env`, в репозиторий не попадают.
- ID валидируются регуляркой `^[0-9A-HJKMNP-TV-Z]{26}$`, `variant` — из фиксированного enum. Path traversal невозможен по построению.
- `title`/`alt` экранируются при рендере; входные MIME — allowlist растровых форматов, SVG/HTML запрещены.
- Worker обёрнут в try/catch и никогда не роняет существующие маршруты — они физически не входят в route patterns (D2).

## 10. Dev, деплой, секреты

- Прод: `scripts/deploy-cloudflare.sh production` — сборка, тесты, `npm run check`, remote-миграция D1 и `wrangler deploy` одной командой.
- Правка шапки/CSS уезжает тем же деплоем: shell лежит в той же `dist/`, что и статика.
- Локально: `python3 build/build.py`, затем `wrangler dev` (конфигурация `albums-worker` в `.claude/launch.json`) с локальными D1/R2.
- SSL режим зоны — Full (strict), как сейчас.
- Наблюдаемость: включить Workers Logs (`observability.enabled`).

## 11. Правки существующего кода

- `build.py`: рендер `dist/_shell/album.html`; добавить `/gallery` в `render_sitemap()` (`build/build.py:1692`) без hreflang-альтернатив; ссылка на `/gallery` в подвале (`build/build.py:806`).
- `localization/common.json`: одна новая запись `footer.gallery` с переводами на все 12 локалей — иначе упадёт `tests/test_localization.py`.
- `static/_headers` не трогаем: ответы Worker им не подчиняются, заголовки ставит сам Worker.
- `assets/site.css` — стили карточек галереи и locked-оверлея; слайдер переиспользуется как есть.

## 12. Тесты

Python (существующий стек): полнота локализации, наличие `/gallery` в sitemap, наличие маркеров в shell-шаблоне.

TS (`vitest` + `@cloudflare/vitest-pool-workers`, локальные D1/R2):

- цены для 1, 2, 4, 5, 20 фото и `--price-usd`;
- public/private и смена видимости; private не в `/gallery`;
- 403 на `/download/*` до unlock, 200 после — для любого посетителя;
- ZIP и сохранение порядка фотографий;
- уникальные OG/Twitter-теги присутствуют в исходном HTML (regex по тексту ответа, не по DOM);
- `deleted` → 410;
- снятие EXIF/GPS (unit-тест CLI);
- фоллбек при недоступном origin-shell;
- `Range` на `/download`;
- `noindex` на альбоме и его отсутствие на `/gallery`;
- `/`, `/ru/`, `/guides/`, `/compare.html` продолжают отдаваться из Static Assets без редиректов;
- смоук после деплоя: `/`, `/ru/`, `/compare.html`, `/sitemap.xml`, `/robots.txt` не изменились.

Тесты вебхуков и конкурентных платежей появятся вместе с этапом 2.

## 13. Открытые вопросы

1. Юрисдикция и платёжный провайдер понадобятся только для будущей автоматической платной разблокировки; ручные locked-альбомы уже поддерживаются.
2. Индексируемая `/gallery` делает чужие восстановленные фото находимыми в поиске. Альбомы при этом `noindex`. Если это нежелательно — `/gallery` тоже закрывается, и раздел теряет SEO-смысл.

## 14. Критерий готовности этапа 1

Одна CLI-команда публикует набор и возвращает ссылку; Reddit показывает уникальный watermarked cover из исходного HTML; альбом появляется в `/gallery` (private — нет); `album unlock` атомарно открывает полноразмерные файлы и ZIP всем посетителям; существующие маршруты и SEO-страницы не изменились.
