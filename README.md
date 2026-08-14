# 8concert.com — статична збірка

Сайт — статичний генератор (`build.js`), який під час кожної збірки тягне дані з Airtable і пише готовий HTML у `dist/`. Нічого не фетчиться в браузері, тому Airtable-токен ніколи не потрапляє у вихідний код, який бачать відвідувачі.

## Що вже зроблено

- Дані — з Airtable, під час збірки (build-time), токен лише в змінних середовища.
- Кожен концерт має власну сторінку `/concert/<slug>/` з унікальним title/description і `schema.org/Event` (JSON-LD): дата, час (з правильним часовим поясом Києва, EET/EEST), локація, ціна, картинка.
- Категорійні сторінки `/jazz/`, `/klasika/`, `/trybuti/` — окремі URL під кожен жанр (потрібно для індексації запитів типу "джаз Київ").
- Головна: `sitemap.xml`, `robots.txt`, JSON-LD Organization/WebSite/ItemList, favicon + apple-touch-icon.
- Картинки концертів скачуються з Airtable і кладуться в `dist/images/` під час збірки — Airtable-посилання на файли підписані й протухають за кілька годин, хотлінкати їх напряму не можна.
- Минулі концерти (дата в минулому) автоматично зникають з головної.
- Вкладка "Цей тиждень" показує тільки події поточного тижня (пн–нд), "Сьогодні ввечері" — тільки сьогоднішні, "8 подій" — весь добірний пул.
- Кнопка "Квитки" вже шле `dataLayer.push('ticket_click', ...)` — заготовка під GTM/GA4/Meta Pixel.
- Автоматична щоденна пересборка (див. нижче) — вкладки й дати завжди актуальні без ручних дій.

## Локальний запуск

```bash
cp .env.example .env
# впишіть у .env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID
export $(cat .env | xargs)
npm run build
```

Результат — у `dist/`. Перегляд:

```bash
npx serve dist
```

Без мережі/токена можна перевірити сам генератор на тестових даних:

```bash
node -e "import('./scripts/dev-mock-fetch.mjs').then(() => import('./build.js'))"
```

## Продакшн: Netlify

Сайт живе на Netlify, підключений напряму до цього GitHub-репозиторію (Site settings → Build & deploy → Continuous deployment). Кожен `git push` у `main` запускає нову збірку.

- Build command: `npm run build` (з `netlify.toml`)
- Publish directory: `dist`
- Env vars: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID` — у Site settings → Environment variables (значення `AIRTABLE_TOKEN` НЕ позначайте як "secret" — інакше воно не резолвиться в білді, це відомий баг конектора)
- Домен `8concert.com` прив'язаний у Domain management

## Автоматичне оновлення афіші

Airtable Free-план не підтримує "Run a script"/webhook-автоматизації, тому пересборка тригериться інакше: `netlify/functions/daily-rebuild.mjs` — Netlify Scheduled Function, яка щодня о 03:00 UTC (06:00 Київ) сама б'є по Build Hook сайту. Нічого з боку Airtable налаштовувати не треба.

Щоб оновити афішу негайно, а не чекати до ранку — Netlify Dashboard → Deploys → Trigger deploy → Deploy site.

## Структура проєкту

```
build.js                             — генератор сайту (запускається на кожен деплой)
src/styles.css                       — стилі
src/client.js                        — клієнтський JS: таби, фільтр жанрів, dataLayer.push
assets/                              — favicon.ico, apple-touch-icon.png, icon-*.png
netlify/functions/daily-rebuild.mjs  — щоденний тригер пересборки
scripts/dev-mock-fetch.mjs           — заглушка Airtable-запиту для локального тесту без мережі/токена
.env.example                         — які змінні середовища потрібні
netlify.toml                         — build command, publish dir, functions dir
dist/                                — згенерований сайт (не редагувати руками, перезаписується при білді, в git не потрапляє)
```

## Відомі обмеження / що варто зробити далі

- В Airtable поле `Date` краще тримати як справжній тип **Date** (build.js розуміє і текст типу "15 серпня", і нативний ISO-формат, і навіть якщо не розпізнає — просто не покаже startDate в розмітці, подія не зникне).
- Поле `Time` — Airtable міг типізувати його як **Duration**, а не текст (типова поведінка при створенні нової колонки з часом) — build.js це вже враховує, конвертує число секунд назад у ЧЧ:ММ.
- Наповнити `hello@8concert.com` в футері реальною поштою або прибрати; додати `Instagram`, якщо буде акаунт.
- GTM/GA4 + Google Ads conversion + Meta Pixel/Conversions API поверх `ticket_click` з `dataLayer` — контейнер ще не підключено, самі events вже йдуть.
- Форма підписки на розсилку (Netlify Forms) — обговорювалась, ще не зроблена.
