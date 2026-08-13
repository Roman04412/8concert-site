#!/usr/bin/env node
/**
 * Static-site generator for 8concert.com
 *
 * Runs at build time (locally, in CI, or as the "build command" on
 * Vercel/Netlify). Fetches the concert list from Airtable using a token
 * that lives ONLY in the build environment (env var), then writes plain
 * HTML into dist/ — nothing is fetched from the browser, so nothing
 * sensitive ships to visitors.
 *
 * Output:
 *   dist/index.html                    – homepage, concerts already baked in
 *   dist/concert/<slug>/index.html     – one SEO page per concert (JSON-LD Event)
 *   dist/sitemap.xml
 *   dist/robots.txt
 *   dist/styles.css, dist/client.js    – copied from src/
 *
 * Env vars required:
 *   AIRTABLE_TOKEN
 *   AIRTABLE_BASE_ID
 *   AIRTABLE_TABLE_ID
 * Optional:
 *   SITE_URL   (default https://8concert.com)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const SITE_URL = (process.env.SITE_URL || 'https://8concert.com').replace(/\/$/, '');
const MAX_RECORDS = Number(process.env.MAX_RECORDS || 8);

const DIST = path.join(__dirname, 'dist');
// styles.css / client.js live next to build.js at the repo root (not in a
// src/ subfolder) — GitHub's drag-and-drop web uploader flattens folders,
// so this matches what actually ends up in the repo.
const SRC = __dirname;

// TODO: замініть на реальні контакти/соцмережі — зараз це чернетка-заглушка,
// сторінки /about/ і /contacts/ вже підключені й попадуть у sitemap.
const SITE = {
  contactEmail: 'hello@8concert.com',
  telegramUrl: 'https://t.me/Roman0044',
  instagramUrl: '',  // напр. 'https://instagram.com/8concert'
  aboutParagraphs: [
    '8CONCERT — щотижнева редакційна добірка концертів Києва для тих, хто цінує особливі вечори: джаз, класика, трибьюти.',
    'Ми не продаємо квитки самі — обираємо найцікавіші події тижня і ведемо на офіційні майданчики продажу, де ви купуєте квиток напряму в організатора.',
    'Добірка оновлюється щопонеділка. Якщо хочете, щоб ми розглянули ваш концерт для афіші — напишіть нам.',
  ],
};

if (!AIRTABLE_TOKEN || !BASE_ID || !TABLE_ID) {
  console.error(
    'Missing env vars. Set AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID\n' +
    '(copy .env.example to .env and fill it in, or set them in your host\'s dashboard).'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UA_MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];

const TRANSLIT = {
  а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',
  й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',
  ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'iu',я:'ia',
};

function slugify(str) {
  const lower = String(str || '').toLowerCase();
  const translit = lower.replace(/[а-яіїєґ]/g, (ch) => TRANSLIT[ch] ?? ch);
  return translit
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'concert';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Best-effort parse of the free-text Ukrainian "Date" field (e.g. "15 серпня",
// "сьогодні") into an ISO date. Returns null if it can't confidently parse —
// callers must handle that (omit startDate rather than emit a wrong one).
function parseUkrainianDate(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toLowerCase();
  const now = new Date();

  if (text.includes('сьогодні')) return now.toISOString().slice(0, 10);
  if (text.includes('завтра')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  const match = text.match(/(\d{1,2})\s+([а-яіїєґ]+)/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthIdx = UA_MONTHS.findIndex((m) => m.startsWith(match[2].slice(0, 4)));
  if (monthIdx === -1 || day < 1 || day > 31) return null;

  let year = now.getFullYear();
  // If that date already passed this year by more than a month, assume next year.
  const candidate = new Date(year, monthIdx, day);
  if (candidate < now && (now - candidate) / 86400000 > 31) year += 1;

  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${mon.getDate()} — ${sun.getDate()}<br>${UA_MONTHS[sun.getMonth()]}`;
}

// ---------------------------------------------------------------------------
// Fetch data
// ---------------------------------------------------------------------------

async function fetchConcerts() {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?maxRecords=${MAX_RECORDS}&view=Grid%20view`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.records || [];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------


// Airtable "Image" field can be an Attachment array or a plain URL string —
// handle both, prefer a larger thumbnail when Airtable generated one.
function extractImageUrl(field) {
  if (!field) return '';
  if (Array.isArray(field) && field.length > 0) {
    const att = field[0];
    if (att && att.thumbnails) {
      if (att.thumbnails.full && att.thumbnails.full.url) return att.thumbnails.full.url;
      if (att.thumbnails.large && att.thumbnails.large.url) return att.thumbnails.large.url;
    }
    return (att && att.url) || '';
  }
  if (typeof field === 'string') return field.trim();
  return '';
}

function buildConcertData(record, index) {
  const f = record.fields;
  const num = String(index + 1).padStart(2, '0');
  const price = f.Price || '';
  const link = f.Link || '#';
  const isTop = index < 2 || f.Status === 'Топ';
  const isFree = price.toLowerCase().includes('вільний') || price.toLowerCase().includes('безкоштовн');
  const snippet = f.Snippet || '';
  const desc = snippet ? snippet.slice(0, 90) + (snippet.length > 90 ? '...' : '') : '';
  const title = f.Title || 'Назва уточнюється';
  const slug = `${slugify(title)}-${record.id.slice(-6).toLowerCase()}`;
  const isoDate = parseUkrainianDate(f.Date);
  const image = extractImageUrl(f.Image);

  return { record, f, num, price, link, isTop, isFree, snippet, desc, title, slug, isoDate, image };
}

function renderConcertCard(c, { linkTitle }) {
  const { f, num, price, link, isTop, isFree, desc, title, slug, image } = c;
  const titleHtml = linkTitle
    ? `<a class="concert-title" href="/concert/${slug}/">${escapeHtml(title)}</a>`
    : `<div class="concert-title">${escapeHtml(title)}</div>`;

  return `
      <div class="concert-item" data-category="${escapeHtml(f.Category || '')}">
        <div class="concert-num">${num}</div>
        <div class="concert-info">
          ${image ? `<img class="concert-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">` : ''}
          <div class="concert-tags">
            ${isTop ? '<span class="tag tag-warm">Вибір редакції</span>' : ''}
            ${f.Category ? `<span class="tag">${escapeHtml(f.Category)}</span>` : ''}
          </div>
          ${titleHtml}
          ${desc ? `<div class="concert-desc">${escapeHtml(desc)}</div>` : ''}
          <div class="concert-meta">
            ${f.Date ? `<span>📅 ${escapeHtml(f.Date)}</span>` : ''}
            ${f.Location ? `<span>📍 ${escapeHtml(f.Location)}</span>` : ''}
          </div>
        </div>
        <div class="concert-right">
          <div class="concert-price-label">${isFree ? 'Вхід' : 'Від'}</div>
          <div class="concert-price">${isFree ? 'Вільний' : escapeHtml(price) || '—'}</div>
          <a href="${escapeHtml(link)}" class="${isFree ? 'btn-ticket btn-free' : 'btn-ticket'}" target="_blank" rel="noopener sponsored"
             data-ticket-link data-concert-id="${c.record.id}" data-concert-title="${escapeHtml(title)}"
             data-concert-category="${escapeHtml(f.Category || '')}" data-concert-price="${escapeHtml(price)}">
            ${isFree ? 'Деталі' : 'Квитки →'}
          </a>
        </div>
      </div>`;
}

function pageShell({ title, description, canonical, bodyExtraHead = '', headerHtml, contentHtml, jsonLd = null, ogImage = '' }) {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}
<link rel="stylesheet" href="/styles.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
${bodyExtraHead}
</head>
<body>
${headerHtml}
${contentHtml}
<script src="/client.js" defer></script>
</body>
</html>`;
}

function siteHeader() {
  return `<header>
  <a href="/" class="logo">8<span>CONCERT</span></a>
  <nav>
    <a href="/">Афіша</a>
    <a href="/#today" data-tab-link="today">Сьогодні</a>
    <a href="/about/">Про нас</a>
    <a href="/" class="nav-city">Київ</a>
  </nav>
</header>`;
}

function siteFooter() {
  return `<footer>
  <div>
    <div class="footer-logo">8<span>CONCERT</span></div>
    <div class="footer-desc">Редакційна добірка концертів Києва для тих, хто цінує особливі вечори. Оновлюється щопонеділка.</div>
    <div class="footer-genres">
      <span class="footer-genre">Джаз</span>
      <span class="footer-genre">Класика</span>
      <span class="footer-genre">Трибьюти</span>
    </div>
  </div>
  <div>
    <div class="footer-col-title">Афіша</div>
    <div class="footer-links">
      <a href="/">Цей тиждень</a>
      <a href="/#today" data-tab-link="today">Сьогодні</a>
    </div>
  </div>
  <div>
    <div class="footer-col-title">Проєкт</div>
    <div class="footer-links">
      <a href="/about/">Про нас</a>
      <a href="/contacts/">Контакти</a>
      ${SITE.telegramUrl ? `<a href="${escapeHtml(SITE.telegramUrl)}" target="_blank" rel="noopener">Telegram</a>` : ''}
      ${SITE.instagramUrl ? `<a href="${escapeHtml(SITE.instagramUrl)}" target="_blank" rel="noopener">Instagram</a>` : ''}
    </div>
  </div>
  <div class="footer-bottom">
    <div class="footer-copy">© ${new Date().getFullYear()} 8concert.com — Київ</div>
    <div class="footer-copy">Зроблено з любов'ю до музики</div>
  </div>
</footer>`;
}

function renderHomepage(concerts) {
  const weekRange = getWeekRange();
  const today = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }).toLowerCase();
  const todayConcerts = concerts.filter((c) => {
    const d = (c.f.Date || '').toLowerCase();
    return d.includes('сьогодні') || d.includes(today);
  });

  const weekHtml = concerts.length
    ? concerts.map((c) => renderConcertCard(c, { linkTitle: true })).join('')
    : '<div class="loading">Незабаром тут з\'являться найкращі вечори Києва</div>';

  const todayHtml = todayConcerts.length
    ? todayConcerts.map((c) => renderConcertCard(c, { linkTitle: true })).join('')
    : '<div class="loading">Сьогодні ввечері — тиша. Перевірте афішу тижня ✨</div>';

  const countLabel = concerts.length === 8 ? 'вісім подій' : `${concerts.length} подій`;

  const content = `
<div class="hero">
  <div class="hero-left">
    <div class="hero-label">Редакційна добірка</div>
    <h1 class="hero-title">Вісім вечорів,<br>які варто <em>прожити</em></h1>
    <p class="hero-sub">Щотижня обираємо вісім концертів джазу, класики та трибьютів у Києві — для тих, хто цінує особливі моменти.</p>
  </div>
  <div class="hero-right">
    <div class="hero-week">
      <div class="hero-week-label">Тиждень</div>
      <div class="hero-week-dates">${weekRange}</div>
    </div>
    <div class="hero-genres">
      <div class="genre-pill active">🎷 Джаз</div>
      <div class="genre-pill active">🎻 Класика</div>
      <div class="genre-pill active">🎤 Трибьюти</div>
    </div>
  </div>
</div>

<div class="quote-strip">
  <div class="quote-line"></div>
  <div class="quote-text">«Музика — найкоротший шлях між двома серцями»</div>
</div>

<div class="tabs-bar">
  <button class="tab active" onclick="switchTab(this,'week')">Цей тиждень</button>
  <button class="tab" onclick="switchTab(this,'today')" id="today">Сьогодні ввечері</button>
  <span class="tabs-right">${countLabel}</span>
</div>

<div id="tab-week">${weekHtml}</div>
<div id="tab-today" style="display:none">${todayHtml}</div>
`;

  return pageShell({
    title: '8CONCERT — Вісім вечорів, які варто прожити | Афіша концертів Києва',
    description: 'Щотижнева редакційна добірка з восьми концертів джазу, класики та трибьютів у Києві. Обираємо найкращі вечори для тих, хто цінує особливі моменти.',
    canonical: `${SITE_URL}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
    ogImage: (concerts.find((c) => c.image) || {}).image || '',
  });
}

function renderConcertPage(c) {
  const { f, title, desc, snippet, price, isFree, link, slug, isoDate, record, image } = c;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description: snippet || desc || title,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    ...(isoDate ? { startDate: isoDate } : {}),
    location: {
      '@type': 'Place',
      name: f.Location || 'Київ',
      address: { '@type': 'PostalAddress', addressLocality: 'Київ', addressCountry: 'UA' },
    },
    ...(f.Category ? { genre: f.Category } : {}),
    ...(image ? { image: [image] } : {}),
    offers: {
      '@type': 'Offer',
      url: link,
      price: isFree ? '0' : undefined,
      priceCurrency: 'UAH',
      availability: 'https://schema.org/InStock',
    },
  };

  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / ${escapeHtml(title)}</nav>
<article class="concert-page">
  ${image ? `<img class="concert-page-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">` : ''}
  <div class="concert-tags">
    ${f.Category ? `<span class="tag">${escapeHtml(f.Category)}</span>` : ''}
  </div>
  <h1 class="concert-title">${escapeHtml(title)}</h1>
  ${snippet ? `<p class="concert-desc">${escapeHtml(snippet)}</p>` : ''}
  <div class="concert-meta">
    ${f.Date ? `<span>📅 ${escapeHtml(f.Date)}</span>` : ''}
    ${f.Location ? `<span>📍 ${escapeHtml(f.Location)}</span>` : ''}
  </div>
  <p class="concert-price" style="margin-top:24px">${isFree ? 'Вхід вільний' : escapeHtml(price) || ''}</p>
  <a href="${escapeHtml(link)}" class="btn-ticket" style="margin-top:16px" target="_blank" rel="noopener sponsored"
     data-ticket-link data-concert-id="${record.id}" data-concert-title="${escapeHtml(title)}"
     data-concert-category="${escapeHtml(f.Category || '')}" data-concert-price="${escapeHtml(price)}">
    ${isFree ? 'Деталі та реєстрація →' : 'Купити квитки →'}
  </a>
</article>`;

  return pageShell({
    title: `${title} — 8CONCERT`,
    description: (snippet || desc || `${title}. ${f.Date || ''} ${f.Location || ''}`).slice(0, 160),
    canonical: `${SITE_URL}/concert/${slug}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
    jsonLd,
    ogImage: image,
  });
}

function renderAboutPage() {
  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / Про нас</nav>
<article class="concert-page">
  <h1 class="concert-title">Про 8CONCERT</h1>
  ${SITE.aboutParagraphs.map((p) => `<p class="concert-desc" style="font-size:15px;margin-bottom:16px">${escapeHtml(p)}</p>`).join('')}
  <a href="${SITE.telegramUrl || '/contacts/'}" class="btn-ticket" style="margin-top:8px" ${SITE.telegramUrl ? 'target="_blank" rel="noopener"' : ''}>Зв'язатися з нами →</a>
</article>`;

  return pageShell({
    title: 'Про нас — 8CONCERT',
    description: 'Хто робить редакційну добірку концертів Києва 8CONCERT і як ми обираємо події тижня.',
    canonical: `${SITE_URL}/about/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
  });
}

function renderContactsPage() {
  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / Контакти</nav>
<article class="concert-page">
  <h1 class="concert-title">Контакти</h1>
  <p class="concert-desc" style="font-size:15px;margin-bottom:20px">Пропозиції щодо концертів для афіші, співпраця, помилка на сайті — пишіть, відповідаємо особисто.</p>
  ${SITE.telegramUrl ? `<a href="${escapeHtml(SITE.telegramUrl)}" class="btn-ticket" target="_blank" rel="noopener" style="margin-bottom:20px">Написати в Telegram →</a>` : ''}
  <div class="concert-meta" style="flex-direction:column;align-items:flex-start;gap:10px;font-size:14px;margin-top:${SITE.telegramUrl ? '4px' : '0'}">
    <span>✉️ <a href="mailto:${escapeHtml(SITE.contactEmail)}" style="color:var(--brown)">${escapeHtml(SITE.contactEmail)}</a></span>
    ${SITE.instagramUrl ? `<span>📷 <a href="${escapeHtml(SITE.instagramUrl)}" target="_blank" rel="noopener" style="color:var(--brown)">Instagram</a></span>` : ''}
  </div>
</article>`;

  return pageShell({
    title: 'Контакти — 8CONCERT',
    description: 'Як зв\'язатися з редакцією 8CONCERT.',
    canonical: `${SITE_URL}/contacts/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
  });
}

function renderSitemap(concerts) {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/about/`,
    `${SITE_URL}/contacts/`,
    ...concerts.map((c) => `${SITE_URL}/concert/${c.slug}/`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
}

function renderRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching concerts from Airtable...');
  const records = await fetchConcerts();
  console.log(`Got ${records.length} record(s).`);

  const concerts = records.map(buildConcertData);
  const noDateCount = concerts.filter((c) => !c.isoDate).length;
  if (noDateCount) {
    console.warn(
      `Warning: ${noDateCount} concert(s) have a "Date" field that couldn't be parsed into an ISO date, ` +
      `so their Event structured data will be missing startDate (hurts eligibility for Google\'s event rich results). ` +
      `Consider changing the Airtable "Date" column to a real Date field type.`
    );
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  fs.writeFileSync(path.join(DIST, 'index.html'), renderHomepage(concerts));
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), renderSitemap(concerts));
  fs.writeFileSync(path.join(DIST, 'robots.txt'), renderRobots());

  fs.mkdirSync(path.join(DIST, 'about'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'about', 'index.html'), renderAboutPage());

  fs.mkdirSync(path.join(DIST, 'contacts'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'contacts', 'index.html'), renderContactsPage());

  fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(DIST, 'styles.css'));
  fs.copyFileSync(path.join(SRC, 'client.js'), path.join(DIST, 'client.js'));

  for (const c of concerts) {
    const dir = path.join(DIST, 'concert', c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderConcertPage(c));
  }

  console.log(`Done. Wrote ${concerts.length + 3} HTML page(s) to dist/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
