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
const DISPLAY_COUNT = Number(process.env.DISPLAY_COUNT || 8);
const FETCH_LIMIT = 100; // Airtable's max per request without pagination — plenty of headroom

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

// Static category landing pages (/jazz/, /klasika/, /trybuti/) — the genre
// filter on the homepage is client-side JS only, so without these pages
// Google has no crawlable URL to rank for "джаз Київ" / "класика Київ" /
// "трибьюти Київ" style queries.
const CATEGORIES = [
  {
    name: 'Джаз',
    slug: 'jazz',
    emoji: '🎷',
    title: 'Джаз концерти Києва — афіша',
    intro: 'Джазові концерти Києва цього сезону: джем-сейшени, вечори класичного свінгу та сучасного джазу на терасах і в клубах міста.',
  },
  {
    name: 'Класика',
    slug: 'klasika',
    emoji: '🎻',
    title: 'Класична музика Києва — афіша концертів',
    intro: 'Концерти класичної музики в Києві: симфонічні оркестри, камерні вечори та виконання світових хітів у класичній обробці.',
  },
  {
    name: 'Трибьюти',
    slug: 'trybuti',
    emoji: '🎤',
    title: 'Трибьюти в Києві — афіша концертів',
    intro: 'Трибьют-шоу та концерти на честь легендарних виконавців у Києві — від симфонічних програм до клубних вечорів.',
  },
];

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

  // Airtable's native "Date" field type returns ISO format (e.g. "2026-08-13"),
  // not Ukrainian text — handle that directly instead of falling through to the
  // Ukrainian-text regex below (which would never match it).
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

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

function formatDateDisplay(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (isoDate === todayStr) return 'Сьогодні';
  if (isoDate === tomorrowStr) return 'Завтра';
  const sameYear = y === now.getFullYear();
  return `${d} ${UA_MONTHS[m - 1]}${sameYear ? '' : ' ' + y}`;
}

// Kyiv flips between EET (+2) and EEST (+3) twice a year (DST), so the
// correct UTC offset for a given date can't be hardcoded. Let the JS Intl
// API (backed by the full IANA tz database) resolve it instead of
// reimplementing the EU DST rules by hand.
function kyivOffset(isoDate) {
  try {
    const d = new Date(`${isoDate}T12:00:00Z`); // midday sidesteps any DST-boundary edge case
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Kyiv',
      timeZoneName: 'shortOffset',
    }).formatToParts(d);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    const match = tzPart && tzPart.value.match(/GMT([+-]\d+)/);
    const hours = match ? parseInt(match[1], 10) : 2;
    return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
  } catch {
    return '+02:00';
  }
}

// ISO (Mon-Sun) bounds of the current calendar week, as YYYY-MM-DD strings —
// used to make the "Цей тиждень" tab actually mean "this week" instead of
// "next 8 concerts whenever they happen to be".
function getWeekBounds() {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const toIso = (d) => d.toISOString().slice(0, 10);
  return { start: toIso(mon), end: toIso(sun) };
}

function pluralEvents(n) {
  if (n === 8) return 'вісім подій';
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} подія`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} події`;
  return `${n} подій`;
}

// ---------------------------------------------------------------------------
// Fetch data
// ---------------------------------------------------------------------------

async function fetchConcerts() {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?maxRecords=${FETCH_LIMIT}&view=Grid%20view`;
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

function buildConcertData(record) {
  const f = record.fields;
  const price = f.Price || '';
  const link = f.Link || '#';
  const isFree = price.toLowerCase().includes('вільний') || price.toLowerCase().includes('безкоштовн');
  const snippet = f.Snippet || '';
  const desc = snippet ? snippet.slice(0, 90) + (snippet.length > 90 ? '...' : '') : '';
  const title = f.Title || 'Назва уточнюється';
  const slug = `${slugify(title)}-${record.id.slice(-6).toLowerCase()}`;
  const isoDate = parseUkrainianDate(f.Date);
  // "Time" is a plain text field (e.g. "19:00") — validate loosely, ignore
  // anything that doesn't look like HH:MM rather than emit a broken datetime.
  const timeMatch = f.Time ? String(f.Time).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)/) : null;
  const timeDisplay = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '';
  const dateDisplay = (isoDate ? formatDateDisplay(isoDate) : (f.Date || '')) + (timeDisplay ? `, ${timeDisplay}` : '');
  // Full ISO datetime with Kyiv's correct UTC offset for that specific date —
  // used as Event startDate in JSON-LD. Falls back to date-only when there's
  // no time, and to nothing at all when there's no date either (existing
  // isoDate-null behaviour is unchanged).
  const startDateTime = isoDate && timeMatch ? `${isoDate}T${timeDisplay}:00${kyivOffset(isoDate)}` : isoDate;
  const image = extractImageUrl(f.Image);

  return { record, f, price, link, isFree, snippet, desc, title, slug, isoDate, dateDisplay, startDateTime, image };
}

// Only filters out events we're CONFIDENT have already happened (a successfully
// parsed date that's strictly before today). Records with an unparseable date
// are kept visible rather than risk hiding something that's actually upcoming.
function isPastEvent(concert, todayStr) {
  return Boolean(concert.isoDate) && concert.isoDate < todayStr;
}

function renderConcertCard(c, { linkTitle }) {
  const { f, num, price, link, isTop, isFree, desc, title, slug, image, dateDisplay } = c;
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
            ${dateDisplay ? `<span>📅 ${escapeHtml(dateDisplay)}</span>` : ''}
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
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
      <a href="/#week" data-tab-link="week">Цей тиждень</a>
      <a href="/#today" data-tab-link="today">Сьогодні</a>
      ${CATEGORIES.map((cat) => `<a href="/${cat.slug}/">${escapeHtml(cat.name)}</a>`).join('\n      ')}
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
  const todayStr = new Date().toISOString().slice(0, 10);
  const { start: weekStart, end: weekEnd } = getWeekBounds();

  // "Цей тиждень" only shows concerts that actually fall within the current
  // Mon–Sun week (unparseable dates are kept rather than hidden — see the
  // isPastEvent comment above for the same reasoning). Anything with a known
  // date outside this window belongs to a later week, not this one.
  const weekConcerts = concerts.filter((c) => !c.isoDate || (c.isoDate >= weekStart && c.isoDate <= weekEnd));
  const todayConcerts = concerts.filter((c) => c.isoDate === todayStr);

  const renumber = (list) => list.map((c, index) => ({
    ...c,
    num: String(index + 1).padStart(2, '0'),
    isTop: index < 2 || c.f.Status === 'Топ',
  }));

  const weekList = renumber(weekConcerts);
  const todayList = renumber(todayConcerts);

  const weekHtml = weekList.length
    ? weekList.map((c) => renderConcertCard(c, { linkTitle: true })).join('')
    : '<div class="loading">На цьому тижні нових концертів ще не додали. Загляньте трохи пізніше ✨</div>';

  const todayHtml = todayList.length
    ? todayList.map((c) => renderConcertCard(c, { linkTitle: true })).join('')
    : '<div class="loading">Сьогодні ввечері — тиша. Перевірте афішу тижня ✨</div>';

  // "Топ 8" is the full curated pool regardless of week — since "Цей тиждень"
  // is now an honest weekly filter, this is the only place to see all 8 picks
  // at once when they're spread across more than one week.
  const top8Html = concerts.length
    ? concerts.map((c) => renderConcertCard(c, { linkTitle: true })).join('')
    : '<div class="loading">Незабаром тут з\'являться найкращі вечори Києва</div>';

  const content = `
<div class="hero">
  <div class="hero-left">
    <div class="hero-label">Редакційна добірка</div>
    <h1 class="hero-title">Вісім вечорів,<br>які варто <em>прожити</em></h1>
    <p class="hero-sub">Щотижня обираємо вісім концертів джазу, класики та трибьютів у Києві — для тих, хто цінує особливі моменти.</p>
  </div>
  <div class="hero-right">
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
  <button class="tab active" onclick="switchTab(this,'top8')" id="top8">8 подій</button>
  <button class="tab" onclick="switchTab(this,'week')" id="week">Цей тиждень</button>
  <button class="tab" onclick="switchTab(this,'today')" id="today">Сьогодні ввечері</button>
</div>

<div id="tab-top8">${top8Html}</div>
<div id="tab-week" style="display:none">${weekHtml}</div>
<div id="tab-today" style="display:none">${todayHtml}</div>
`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: '8CONCERT',
        url: SITE_URL,
        logo: `${SITE_URL}/icon-512.png`,
        ...(SITE.telegramUrl ? { sameAs: [SITE.telegramUrl] } : {}),
      },
      {
        '@type': 'WebSite',
        name: '8CONCERT',
        url: SITE_URL,
      },
      {
        '@type': 'ItemList',
        name: 'Афіша 8CONCERT — редакційна добірка концертів Києва',
        itemListElement: concerts.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `${SITE_URL}/concert/${c.slug}/`,
          name: c.title,
        })),
      },
    ],
  };

  return pageShell({
    title: '8CONCERT — Вісім вечорів, які варто прожити | Афіша концертів Києва',
    description: 'Щотижнева редакційна добірка з восьми концертів джазу, класики та трибьютів у Києві. Обираємо найкращі вечори для тих, хто цінує особливі моменти.',
    canonical: `${SITE_URL}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
    jsonLd,
    ogImage: (concerts.find((c) => c.image) || {}).image || '',
  });
}

function renderConcertPage(c) {
  const { f, title, desc, snippet, price, isFree, link, slug, isoDate, dateDisplay, startDateTime, record, image } = c;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description: snippet || desc || title,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    ...(startDateTime ? { startDate: startDateTime } : {}),
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
    ${dateDisplay ? `<span>📅 ${escapeHtml(dateDisplay)}</span>` : ''}
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

function renderCategoryPage(cat, concerts) {
  const items = concerts
    .filter((c) => c.f.Category === cat.name)
    .map((c, index) => ({
      ...c,
      num: String(index + 1).padStart(2, '0'),
      isTop: index < 2 || c.f.Status === 'Топ',
    }));

  const listHtml = items.length
    ? items.map((c) => renderConcertCard(c, { linkTitle: true })).join('')
    : '<div class="loading">Найближчим часом нових концертів у цій категорії ще не додали. Загляньте трохи пізніше ✨</div>';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'ItemList',
      name: `${cat.name} концерти Києва — 8CONCERT`,
      itemListElement: items.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/concert/${c.slug}/`,
        name: c.title,
      })),
    }],
  };

  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / ${escapeHtml(cat.name)}</nav>
<div class="hero" style="padding-bottom:24px">
  <div class="hero-left">
    <div class="hero-label">Редакційна добірка</div>
    <h1 class="hero-title">${cat.emoji} ${escapeHtml(cat.name)} у Києві</h1>
    <p class="hero-sub">${escapeHtml(cat.intro)}</p>
  </div>
</div>
<div class="category-list">${listHtml}</div>
`;

  return pageShell({
    title: `${cat.title} | 8CONCERT`,
    description: cat.intro,
    canonical: `${SITE_URL}/${cat.slug}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
    jsonLd,
  });
}

function renderSitemap(concerts) {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/about/`,
    `${SITE_URL}/contacts/`,
    ...CATEGORIES.map((cat) => `${SITE_URL}/${cat.slug}/`),
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

  const todayStr = new Date().toISOString().slice(0, 10);
  const allConcerts = records.map(buildConcertData);

  const pastCount = allConcerts.filter((c) => isPastEvent(c, todayStr)).length;
  if (pastCount) {
    console.log(`Skipping ${pastCount} concert(s) with a date in the past.`);
  }

  const concerts = allConcerts
    .filter((c) => !isPastEvent(c, todayStr))
    .slice(0, DISPLAY_COUNT)
    .map((c, index) => ({
      ...c,
      num: String(index + 1).padStart(2, '0'),
      isTop: index < 2 || c.f.Status === 'Топ',
    }));

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

  for (const cat of CATEGORIES) {
    fs.mkdirSync(path.join(DIST, cat.slug), { recursive: true });
    fs.writeFileSync(path.join(DIST, cat.slug, 'index.html'), renderCategoryPage(cat, concerts));
  }

  fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(DIST, 'styles.css'));
  fs.copyFileSync(path.join(SRC, 'client.js'), path.join(DIST, 'client.js'));
  for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'icon-32.png', 'icon-192.png', 'icon-512.png']) {
    fs.copyFileSync(path.join(SRC, asset), path.join(DIST, asset));
  }

  for (const c of concerts) {
    const dir = path.join(DIST, 'concert', c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderConcertPage(c));
  }

  console.log(`Done. Wrote ${concerts.length + 3 + CATEGORIES.length} HTML page(s) to dist/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
