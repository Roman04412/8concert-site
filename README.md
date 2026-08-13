# 8concert.com — статична збірка

Що змінилось відносно старої версії (`8concert-3.html`):

- Дані з Airtable тепер тягнуться **під час збірки** (Node-скрипт `build.js`), а не в браузері. Токен більше ніде не світиться у вихідному коді сайту.
- Кожен концерт отримав власну сторінку `/concert/<slug>/` з унікальним `<title>`, description і розміткою `schema.org/Event` (JSON-LD) — це потрібно, щоб Google міг проіндексувати кожну подію окремо і показати event rich result у видачі.
- Головна сторінка віддає вже готовий HTML з картками концертів (не порожній div + fetch), плюс `sitemap.xml` і `robots.txt`.
- На кнопці "Квитки" вже стоїть `dataLayer.push('ticket_click', ...)` — заготовка під GTM/GA4/Meta Pixel для наступного кроку (трекінг реклами).

## ⚠️ Перше, що треба зробити

Токен Airtable з файлу `8concert-3.html`, який ви завантажили, вже був у відкритому вигляді в HTML — якщо сайт хоч раз був опублікований у такому вигляді, вважайте токен скомпрометованим.

**Перевипустіть (rotate) токен в Airtable** (Developer Hub → Personal access tokens → Revoke → створити новий, з правами тільки `data.records:read` на потрібну базу) і впишіть новий у змінні середовища нижче. Старий видаліть.

## Локальний запуск

```bash
cp .env.example .env
# впишіть у .env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID
export $(cat .env | xargs)
npm run build
```

Результат — у папці `dist/`. Відкрийте `dist/index.html` у браузері або підніміть локальний сервер:

```bash
npx serve dist
```

`dist/` у цьому проєкті вже містить демо-збірку на **тестових** даних (я не мав доступу до вашого Airtable з цього середовища) — щоб побачити реальні концерти, запустіть `npm run build` зі своїми змінними середовища.

## Деплой (Vercel, найпростіше)

1. Заведіть репозиторій на GitHub, запуште туди цю папку.
2. На vercel.com → New Project → виберіть репозиторій.
3. Framework Preset: "Other". Build Command: `npm run build`. Output Directory: `dist`.
4. Settings → Environment Variables: додайте `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`, `SITE_URL` (=`https://8concert.com`).
5. Deploy. Прив'яжіть домен 8concert.com у Settings → Domains.

Netlify працює так само (Build command `npm run build`, Publish directory `dist`, env vars у Site settings).

## Щотижневе оновлення афіші

Білд треба перезапускати щоразу, як міняються дані в Airtable (інакше сайт покаже стару афішу). Найпростіше:

- **Vercel/Netlify Deploy Hook** + Airtable Automation: у Airtable зробіть автоматизацію "коли змінилась таблиця → POST-запит на Deploy Hook URL". Тоді сайт перезбирається сам одразу після редагування таблиці.
- Або cron: GitHub Actions раз на день викликає той самий Deploy Hook.

Без цього кроку вкладка "Сьогодні ввечері" з часом розійдеться з реальністю — вона обчислюється на момент збірки.

## SEO — що ще варто зробити

- Зареєструвати домен у [Google Search Console](https://search.google.com/search-console) і надіслати `sitemap.xml`.
- В Airtable завести поле `Date` як справжній тип **Date**, а не текст — зараз дата парситься з тексту типу "15 серпня" на найкращу спробу, і якщо формат "з'їде", сторінка концерту втратить `startDate` в розмітці (а без цього Google не покаже rich result по події).
- Додати нормальні картинки афіш (поле `Image` в Airtable) — зараз OG-preview і сторінки без зображень, а це і для соцмереж, і для CTR у видачі важливо.
- Наповнити `hello@8concert.com` в футері реальною поштою або прибрати.

## Структура проєкту

```
build.js          — генератор сайту (запускається на кожен деплой)
src/styles.css    — стилі (винесено з оригінального файлу без змін)
src/client.js     — клієнтський JS: перемикання табів, dataLayer.push на клік по квитку
scripts/dev-mock-fetch.mjs — заглушка Airtable-запиту для локального тесту без мережі/токена
.env.example      — які змінні середовища потрібні
dist/             — згенерований сайт (не редагувати руками, перезаписується при білді)
```

## Наступний крок (тобі згадали окремо)

GTM/GA4 + Google Ads conversion + Meta Pixel/Conversions API поверх `ticket_click`, який вже шлеться в `dataLayer`. Знадобляться: ID контейнера GTM, Pixel ID Meta, доступ до Google Ads акаунту.
