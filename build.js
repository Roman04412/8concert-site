#!/usr/bin/env node
/**
 * Static-site generator for 8concert.com
 *
 * Runs at build time (locally, or as Netlify's "build command"). Fetches the
 * concert list from Airtable using a token that lives ONLY in the build
 * environment (env var), then writes plain HTML into dist/ — nothing is
 * fetched from the browser, so nothing sensitive ships to visitors.
 *
 * Output:
 *   dist/index.html                    – homepage, concerts already baked in
 *   dist/concert/<slug>/index.html     – one SEO page per concert (JSON-LD Event)
 *   dist/jazz|klasika|trybuti/         – category landing pages
 *   dist/about/, dist/contacts/
 *   dist/sitemap.xml, dist/robots.txt
 *   dist/styles.css, dist/client.js    – copied from src/
 *   dist/favicon.ico, dist/*.png       – copied from assets/
 *   dist/images/<slug>.<ext>           – concert images, downloaded from
 *                                         Airtable's (temporary) attachment
 *                                         URLs and self-hosted so they don't
 *                                         expire between deploys
 *
 * Env vars required:
 *   AIRTABLE_TOKEN
 *   AIRTABLE_BASE_ID
 *   AIRTABLE_TABLE_ID
 * Optional:
 *   SITE_URL       (default https://8concert.com)
 *   DISPLAY_COUNT  (default 8 — how many upcoming concerts to feature)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const SITE_URL = (process.env.SITE_URL || 'https://8concert.com').replace(/\/$/, '');
const GA_MEASUREMENT_ID = 'G-W5L8STRVBJ'; // 8CONCERT GA4 property
// Plerdy — heatmaps/click tracking/session recordings, complements GA4
// (which only tells you traffic counts, not what people actually do on the
// page: do they scroll past the first 3 cards, do the genre pills get used,
// does the share button get clicked). Public site-verification snippet,
// same category as the GA4 ID above — fine to have in page source.
const PLERDY_SNIPPET = `<!-- BEGIN PLERDY CODE -->
<script data-plerdy_code='1'>
(function(w,d){
  if(w.__plerdyCode)return;
  w.__plerdyCode=1;
  w._protocol=w.location.protocol=="https:"?"https://":"http://";
  w._site_hash_code="135a92626586c1b939bc5c828ac957ac";
  w._suid=80057;
  var s=d.createElement("script");
  s.async=true;
  s.referrerPolicy="strict-origin-when-cross-origin";
  s.src="https://a.plerdy.com/public/js/click/main.js?v="+Math.random();
  d.head.appendChild(s);
})(window,document);
</script>
<!-- END PLERDY CODE -->`;
const DISPLAY_COUNT = Number(process.env.DISPLAY_COUNT || 8);
const FETCH_LIMIT = 100; // Airtable's max per request without pagination — plenty of headroom

const DIST = path.join(__dirname, 'dist');
const SRC = path.join(__dirname, 'src');       // styles.css, client.js
const ASSETS = path.join(__dirname, 'assets'); // favicon + touch icons

// Persistent, git-committed history — NOT wiped between builds like dist/ is.
// archive.json accumulates every concert record we've ever fetched from
// Airtable (keyed by record id). images/ holds the self-hosted copy of each
// one's picture. Both exist so that once a concert falls out of this week's
// curated 8 (because its date has passed), its page and image keep working
// forever instead of 404ing — see renderConcertPage's "past event" handling.
const ARCHIVE_PATH = path.join(__dirname, 'data', 'archive.json');
const IMAGE_ARCHIVE_DIR = path.join(__dirname, 'data', 'images');

function loadArchive() {
  try {
    const raw = fs.readFileSync(ARCHIVE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveArchive(archiveMap) {
  fs.mkdirSync(path.dirname(ARCHIVE_PATH), { recursive: true });
  // Sort by key so the diff is stable/readable in git history.
  const sorted = Object.fromEntries(Object.keys(archiveMap).sort().map((k) => [k, archiveMap[k]]));
  fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

// TODO: замініть на реальні контакти/соцмережі — зараз це чернетка-заглушка,
// сторінки /about/ і /contacts/ вже підключені й попадуть у sitemap.
const SITE = {
  contactEmail: 'hello@8concert.com',
  telegramUrl: 'https://t.me/Roman0044',
  instagramUrl: 'https://www.instagram.com/8_concert/',
  // TODO: заміните на реальну сторінку 8CONCERT у Facebook, коли вона буде —
  // зараз тут загальний https://www.facebook.com, який Rocky попросив
  // поставити як тимчасове посилання.
  facebookUrl: 'https://www.facebook.com/profile.php?id=100070742635481',
  // Multi-paragraph — blank lines mark paragraph breaks, same convention as
  // the Airtable "Snippet" field. renderAboutPage() feeds this straight into
  // renderBodyParagraphs() so it gets the same magazine-style lead+body
  // treatment as concert pages (first paragraph highlighted, rest as plain
  // body copy) instead of a flat list of identical-looking paragraphs.
  aboutText: `Ми не публікуємо повну афішу Києва — це зробили б за нас десятки інших сайтів. Натомість ми постійно відбираємо лише вісім концертів: джаз, класика, триб'юти улюбленим музикантам і виконавцям — ті події, які, на нашу думку, справді варті вашого вечора.

8concert — це редакційна добірка, а не каталог. Кожен концерт у списку хтось із команди особисто прослухав, перевірив і вважає вартим уваги. Ми не женемось за кількістю — обираємо якість. Тому що музика — найкоротший шлях між двома серцями, і провести вечір варто там, де це відчувається по-справжньому.

Наразі ми зосереджені на Києві — місті з дивовижною концертною сценою, яку легко проґавити серед сотень афіш і реклами. Ми допомагаємо не проґавити.

Якщо ви цінуєте особливі моменти, живу музику і не хочете гортати нескінченні списки в пошуках "того самого" концерту — просто заглядайте до нас регулярно. Повна афіша і квитки — завжди на 8concert.com.

Зроблено з любов'ю до музики. 🎵`,
};

// Static category landing pages (/jazz/, /klasika/, /trybuti/) — the genre
// filter on the homepage is client-side JS only, so without these pages
// Google has no crawlable URL to rank for "джаз Київ" / "класика Київ" /
// "триб'юти Київ" style queries.
// Normalizes category names for matching so a spelling difference
// (e.g. Airtable still has the old "Трибьюти" spelling while the site
// now displays the correct "Триб'юти") never breaks category filtering.
function normalizeCategoryKey(s) {
  return String(s || '').toLowerCase().replace(/[\u0027\u2019\u02bc\u044c]/g, '');
}

// Maps a raw Airtable Category value to the canonical, correctly-spelled
// display name (matched via normalizeCategoryKey so an old/misspelled
// Airtable value still renders correctly everywhere it's shown). Falls
// back to the raw value for any category not in CATEGORIES.
function displayCategory(raw) {
  const norm = normalizeCategoryKey(raw);
  const match = CATEGORIES.find((cat) => normalizeCategoryKey(cat.name) === norm);
  return match ? match.name : (raw || '');
}

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
    name: "Триб'юти",
    slug: 'trybuti',
    emoji: '🎤',
    title: "Триб'юти в Києві — афіша концертів",
    intro: "Триб'ют-шоу та концерти на честь легендарних виконавців у Києві — від симфонічних програм до клубних вечорів.",
  },
];

// Venue ("Місця") pages — a curated guide to Kyiv's recurring open-air /
// rooftop / terrace concert spots. Distinct from CATEGORIES (genre) pages:
// these are location-focused landing pages meant to rank for "концерти на
// [venue] Київ" queries and to give past/future concert pages at a given
// spot somewhere real to link from. locationMatch is matched against each
// concert's Airtable "Location" field (substring, case-insensitive) to
// auto-pull related concerts — no manual tagging needed.
const VENUES = [
  {
    slug: 'dah-tsum',
    name: 'Дах ЦУМ',
    image: 'dah-tsum.png',
    category: 'Концертний зал просто неба',
    tagline: 'Джаз і оркестрові шоу з панорамою центру Києва',
    seoTitle: 'Концерти на даху ЦУМ у Києві — афіша та огляд майданчика',
    metaDescription: "Концерти на даху ЦУМ: джазові вечори, Kyiv Mozart Orchestra та біг-бенди з панорамою центру Києва. Афіша, ціни, плюси й мінуси майданчика.",
    paragraphs: [
      'Дах ЦУМ — один із найвпізнаваніших форматів літніх концертів у центрі Києва: невелика сцена просто неба на даху центрального універмагу, з видом на дахи і шпилі історичного центру. Формат камерний, тому атмосфера тут завжди ближча до джаз-клубу, ніж до великого відкритого майданчика.',
      'У програмі — як джазові вечори, так і виступи Kyiv Mozart Orchestra та біг-бендів: тут звучали Jazz in Kyiv Band, Kyiv Jazz Quintet, Aniko Dolidze Big Band і оркестрові програми на честь популярних виконавців.',
    ],
    pros: ['Панорама центру Києва', 'Атмосферний захід сонця', 'Зручне розташування в центрі'],
    cons: ['Відкритий простір залежить від погоди', 'На популярних концертах може бути багато людей'],
    locationMatch: ['дах цум'],
    setting: 'outdoor',
  },
  {
    slug: 'terasa-river-mall',
    name: 'Тераса River Mall',
    image: 'terasa-river-mall.png',
    category: 'Торговий центр',
    tagline: 'Симфонічні кавери просто неба з видом на Дніпро',
    seoTitle: 'Тераса River Mall — концерти просто неба з видом на Дніпро',
    metaDescription: 'Симфонічні концерти на терасі River Mall: кавер-програми Coldplay, Imagine Dragons, Michael Jackson та інших з панорамою Дніпра. Афіша, плюси й мінуси.',
    paragraphs: [
      'Тераса River Mall — один із найпопулярніших майданчиків Києва для симфонічних концертів просто неба. Простору тут вистачає навіть для великих програм, а вид на Дніпро додає видовищності будь-якому вечору.',
      'Тут регулярно проходять оркестрові програми з музикою Coldplay, Imagine Dragons, Michael Jackson, Metallica, Nirvana та інших популярних виконавців — формат розрахований радше на широку публіку, ніж на академічних цінителів класики.',
    ],
    pros: ['Вид на Дніпро', 'Сучасна простора тераса', 'Великий вибір концертних програм'],
    cons: ['Далі від історичного центру', 'Формат більше про симфонічні кавери, ніж академічну класику'],
    address: 'Торговий центр River Mall',
    phone: '044 299 0007',
    locationMatch: ['river mall'],
    setting: 'outdoor',
  },
  {
    slug: 'terasa-gulliver',
    name: 'Тераса Gulliver',
    image: 'terasa-gulliver.png',
    category: 'Концертний зал',
    tagline: 'Симфонічні та джазові вечори в самому центрі міста',
    seoTitle: 'Тераса Gulliver — концерти в центрі Києва',
    metaDescription: 'Концерти на терасі ТРЦ Gulliver: симфонічні й джазові вечори, програми з музикою Vivaldi, Sting, Lady Gaga, Adele. Афіша, плюси й мінуси майданчика.',
    paragraphs: [
      'Тераса Gulliver — ще одна ключова літня сцена в самому центрі Києва. Локація регулярно приймає як симфонічні, так і джазові вечори, тому афіша тут оновлюється частіше, ніж на багатьох інших відкритих майданчиках.',
      'У програмі трапляються як класичні композитори на кшталт Vivaldi, так і кросовер-версії світових хітів — Sting, Lady Gaga, Adele.',
    ],
    pros: ['У самому центрі Києва', 'Панорама міста', 'Регулярна концертна програма'],
    cons: ['Міський шум', 'Залежність від погоди', 'Частина програм — радше кросовер, ніж академічна класика'],
    address: 'Тераса ТРЦ Gulliver',
    locationMatch: ['gulliver'],
    setting: 'outdoor',
  },
  {
    slug: 'terasa-d12',
    name: 'Тераса Д12',
    image: 'terasa-d12.png',
    category: 'Музей / галерея',
    tagline: 'Камерні концерти з видом на історичний Київ',
    seoTitle: "Тераса Д12 — камерні концерти з видом на історичний Київ",
    metaDescription: 'Камерні концерти класики та джазу на терасі Галереї Д12 з видом на історичний центр Києва. Афіша, плюси й мінуси майданчика.',
    paragraphs: [
      'Тераса Д12 при однойменній галереї — цікава локація для камерних концертів з видом на історичний Київ. Формат тут менш масовий, ніж на великих терасах ТРЦ, тому це хороший варіант для тих, хто шукає інтимнішу атмосферу вечора.',
      'Майданчик особливо добре підходить для романтичних літніх вечорів із класичною музикою або джазом — невеликий простір і краєвид працюють на камерність програми.',
    ],
    pros: ['Історичний центр Києва', 'Краєвид на старе місто', 'Камерна атмосфера'],
    cons: ['Програма менш регулярна, ніж на Gulliver чи River Mall', 'Афішу варто перевіряти заздалегідь'],
    address: 'Галерея Д12',
    phone: '093 973 3373',
    locationMatch: ['д12', 'd12', 'галерея д12'],
    setting: 'outdoor',
  },
  {
    slug: 'terasa-toronto-kyiv',
    name: 'Тераса Toronto-Kyiv',
    image: 'terasa-toronto-kyiv.png',
    category: 'Бізнес-парк',
    tagline: 'Сучасна тераса з панорамою міста для вечірніх концертів',
    seoTitle: 'Тераса Toronto-Kyiv — концерти в комплексі Toronto-Kyiv',
    metaDescription: 'Концерти на терасі Toronto-Kyiv Complex: музика Ludovico Einaudi, Yann Tiersen, Coldplay, Imagine Dragons, Michael Jackson, Bruno Mars. Афіша, плюси й мінуси.',
    paragraphs: [
      'Тераса комплексу Toronto-Kyiv — ще один помітний майданчик літнього концертного сезону в Києві, з сучасною атмосферою та панорамою міста, яка добре працює у форматі вечірнього концерту.',
      'У афіші тут з\'являються як неокласика — Ludovico Einaudi, Yann Tiersen, — так і оркестрові версії Coldplay, Imagine Dragons, Michael Jackson та Bruno Mars.',
    ],
    pros: ['Сучасна локація', 'Гарний формат для вечірнього концерту', 'Поєднання музики й панорами міста'],
    cons: ['Це не класична концертна зала — акустика й атмосфера залежать від конкретної програми'],
    address: 'Toronto-Kyiv Complex',
    phone: '063 992 9029',
    locationMatch: ['toronto-kyiv', 'toronto kyiv', 'торонто-київ'],
    setting: 'outdoor',
  },
  {
    slug: 'kontserty-bilya-lavry',
    name: 'Концерти біля Лаври',
    image: 'kontserty-bilya-lavry.png',
    category: 'Музей-заповідник',
    tagline: 'Найбільш мальовничі оркестрові вечори Києва',
    seoTitle: 'Концерти біля Києво-Печерської лаври — афіша',
    metaDescription: 'Літні та ранньоосінні оркестрові концерти біля Києво-Печерської лаври — один із найбільш мальовничих форматів open-air музики в Києві.',
    paragraphs: [
      'Літні та ранньоосінні концерти біля Києво-Печерської лаври — один із найбільш мальовничих варіантів для оркестрової музики в Києві: історична архітектура лаври робить будь-яку програму видовищною сама по собі.',
      'Особливо варто стежити за вересневими концертами: початок осені зазвичай дає комфортнішу температуру для open-air заходів, ніж розпал літа.',
    ],
    pros: ['Історична атмосфера', 'Архітектура Лаври', 'Дуже фотогенічна локація'],
    cons: ['Події проходять не щодня — потрібно стежити за афішею', 'Погода залишається фактором'],
    address: 'Києво-Печерська лавра',
    phone: '044 406 6300',
    locationMatch: ['лавра', 'печерська лавра', 'києво-печерська'],
    setting: 'outdoor',
  },
  {
    slug: 'unit-city',
    name: 'UNIT.City',
    image: 'unit-city.png',
    category: 'Інноваційний парк',
    tagline: 'Класика в сучасному просторі інноваційного парку',
    seoTitle: 'Концерти в UNIT.City — афіша та огляд майданчика',
    metaDescription: "Концерти класичної музики в UNIT.City: сучасна архітектура, відкритий простір і молодіжна атмосфера інноваційного парку на Дорогожицькій. Афіша, плюси й мінуси.",
    paragraphs: [
      "UNIT.City — сучасний інноваційний парк на Дорогожицькій, який влітку перетворюється не лише на простір для бізнесових і технологічних подій, а й на майданчик для культурних заходів. У афіші тут з'являються концерти класичної музики — наприклад, Great Summer Classic — що робить локацію цікавою для поціновувачів академічної музики в нетиповому форматі.",
      'Формат UNIT.City відрізняється від традиційних концертних залів: класична музика тут поєднується із сучасною архітектурою, відкритим простором і молодіжною атмосферою інноваційного парку.',
    ],
    pros: ['Сучасна та незвичайна атмосфера', 'Хороший варіант для тих, кому класика в залах здається занадто формальною', 'Можна поєднати концерт із прогулянкою сучасним міським простором', 'Підходить для молодої аудиторії'],
    cons: ['Це не традиційний концертний майданчик', 'Акустика може відрізнятися від спеціалізованої концертної зали', 'Кількість музичних подій залежить від актуальної програми'],
    address: 'UNIT.City, вул. Дорогожицька, Київ',
    locationMatch: ['unit.city', 'unit.\u0441ity', 'unit city', 'unit \u0441ity'],
    setting: 'outdoor',
  },
  {
    slug: 'kyivska-troyanda',
    name: "Молодіжний павільйон «Київська троянда»",
    image: 'kyivska-troyanda.png',
    category: 'Камерний майданчик',
    tagline: 'Камерні концерти в центрі, поруч із Маріїнським парком',
    seoTitle: "Концерти в «Київській троянді» — камерний майданчик у центрі Києва",
    metaDescription: "Камерні музичні події в Молодіжному павільйоні «Київська троянда» на Грушевського — поруч із Маріїнським парком, у центрі Києва. Афіша, плюси й мінуси.",
    paragraphs: [
      "Молодіжний павільйон «Київська троянда» розташований у самому центрі Києва, на вулиці Михайла Грушевського, 1В, поруч із Маріїнським парком — і добре підходить для камерних культурних та музичних подій.",
      'Головна перевага локації — поєднання центрального розташування і зеленого оточення: після концерту вечір легко продовжити прогулянкою Маріїнським парком або центром Києва.',
    ],
    pros: ['Центральне розташування', 'Зелена зона поруч', 'Камерний формат', 'Зручний варіант для літнього вечора', 'Можна поєднати концерт із прогулянкою центром Києва'],
    cons: ['Невеликий майданчик — кількість місць обмежена', 'Не всі музичні події проходять регулярно', 'Формат більше для камерних концертів, ніж масштабних оркестрових шоу'],
    address: 'вул. Михайла Грушевського, 1В, Київ',
    locationMatch: ["ки\u0457вська троянда"],
    setting: 'indoor',
  },
  {
    slug: 'botanichnyi-sad-hryshka',
    name: "Національний ботанічний сад ім. М. М. Гришка",
    image: 'botanichnyi-sad-hryshka.png',
    category: 'Парк / сад',
    tagline: 'Джаз і оркестр серед троянд і зелені',
    seoTitle: "Концерти в Ботанічному саду ім. Гришка — Сад троянд, афіша",
    metaDescription: "Концерти просто неба в Ботанічному саду ім. М.М. Гришка: джаз, оркестр і камерна музика в Саду троянд. Афіша, плюси й мінуси open-air формату.",
    paragraphs: [
      'Національний ботанічний сад імені М. М. Гришка НАН України — одна з найвідоміших літніх локацій Києва для концертів просто неба. Особливо популярне місце проведення музичних подій — Сад троянд, де влітку проходять джазові, оркестрові та камерні концерти.',
      'У програмі тут трапляються як тематичні джазові вечори, так і оркестрові версії Sade, Sting, Queen, Depeche Mode та музики з кіно — поєднання живої музики, троянд, зелені й вечірнього світла робить сад одним із найатмосферніших варіантів для літнього концерту в Києві.',
    ],
    pros: ['Природа і велика зелена територія', 'Атмосферний формат open air', 'Сад троянд створює особливу атмосферу для джазу', 'Багато концертних програм у літній сезон', 'Хороший варіант для побачення чи вечора з друзями', 'Можна поєднати концерт із прогулянкою садом'],
    cons: ['Залежність від погоди', 'До окремих концертних зон потрібно йти територією саду', 'На популярні події краще брати квитки заздалегідь', 'Акустика open air не така, як у спеціалізованій залі'],
    address: 'Національний ботанічний сад ім. М. М. Гришка, Тимірязєвська, 1, Київ',
    locationMatch: ['ботан\u0456чний сад', 'сад троянд', 'гришка'],
    setting: 'outdoor',
  },
  {
    slug: 'peppers-club',
    name: "Pepper's Club",
    image: 'peppers-club.png',
    category: 'Музичний паб',
    tagline: "Культовий блюз-рок паб у центрі Києва — концерти, джеми та жива музика щотижня.",
    seoTitle: "Pepper's Club Київ — афіша концертів, адреса, відгуки",
    metaDescription: "Pepper's Club у Києві: культовий музичний паб для любителів блюзу, року та джазу. Адреса, афіша концертів і джем-сейшенів, плюси й мінуси закладу.",
    paragraphs: [
      "Pepper's Club — культовий музичний паб у центрі Києва, який зібрав навколо себе шанувальників блюзу, року та живої музики загалом. Заклад розташований на вул. Князів Острозьких, 8, корпус 7 — у будівлі, де колись були приміщення заводу «Арсенал», тож історична промислова атмосфера тут поєднується з сучасною клубною сценою.",
      "Формат — не лише блюз і рок: тут регулярно проходять джазові вечори, поп-концерти, джем-сейшени, стендап-шоу і навіть трансляції спортивних подій. Понад 40 столиків на 4-10 місць і простора fan-зона дозволяють вмістити чималу компанію, а на сцені — професійний звук d&b audiotechnik і мікрофони Shure, тож про якість звучання тут дбають серйозно.",
      "Влітку у Pepper's Club працює ще й літня сцена просто неба — тож частина подій може проходити не в основному залі, а на вулиці. Формат конкретного концерту (зала чи літня сцена) варто уточнювати в афіші події або в організаторів перед візитом.",
    ],
    pros: ['Культовий статус і насичена афіша щотижня', 'Професійне звукове обладнання', 'Джем-сейшени та можливість почути живу імпровізацію', 'Затишна клубна атмосфера в історичній будівлі', 'Багато столиків — легше знайти місце компанією', 'Кухня та бар прямо в залі'],
    cons: ['У розпал вечора може бути гучно й людно', 'Формат клубу, не концертної зали — акустика відповідна', 'На популярні події краще бронювати столик заздалегідь', 'Центр міста — з парковкою можуть бути складнощі'],
    address: "Pepper's Club, вул. Князів Острозьких, 8, корпус 7, Київ",
    locationMatch: ["pepper's club", 'peppers club', 'pepper club', 'pepper s club'],
    setting: 'indoor',
  },
];

// Season toggle: two SEO-distinct entry points into the same venue set,
// filtered by `setting`. Rocky wanted this indexable as real separate
// pages (own <title>/H1), not a client-side JS tab — mirrors how the
// genre categories already get their own /jazz/, /klasika/, /trybuti/
// pages instead of being a filter on one page.
const SEASONS = [
  {
    slug: 'litni-maidanchyky',
    setting: 'outdoor',
    icon: '\u2600\ufe0f',
    navLabel: 'Літні',
    heroLabel: 'Літній сезон',
    seoTitle: "Літні майданчики Києва — де слухати музику просто неба | 8CONCERT",
    metaDescription: "Дахи, тераси і сади Києва, де влітку регулярно проходять концерти: дах ЦУМ, тераси River Mall, Gulliver, Toronto-Kyiv, Сад троянд, UNIT.City та концерти біля Лаври. Афіша, плюси й мінуси кожного майданчика.",
    h1: 'Де в Києві слухають музику просто неба',
    intro: 'Поки погода дозволяє, найкращі концерти в Києві відбуваються не в залах, а під відкритим небом — на дахах, терасах і в парках. Ось усі майданчики з нашої добірки, де влітку регулярно грає жива музика.',
  },
  {
    slug: 'zymovi-maidanchyky',
    setting: 'indoor',
    icon: '\u2744\ufe0f',
    navLabel: 'Зимові',
    heroLabel: 'Холодна пора року',
    seoTitle: "Де слухати музику взимку в Києві — затишні зали та паби | 8CONCERT",
    metaDescription: "Затишні концертні майданчики Києва для холодної пори року: музичний паб Pepper's Club, камерний павільйон «Київська троянда» та інші зали в приміщенні. Афіша, плюси й мінуси.",
    h1: 'Де в Києві слухають музику взимку',
    intro: 'Коли на вулиці холодно, концерти переїжджають у приміщення — у затишні зали й паби, де тепло, є барна карта і можна сидіти близько до сцени. Ці майданчики з нашої добірки працюють цілий рік, незалежно від погоди за вікном.',
  },
];

function renderSeasonToggle(activeSlug) {
  return `
<div class="season-toggle">${SEASONS.map((s) => `
  <a href="/mistsya/${s.slug}/" class="season-toggle-pill${s.slug === activeSlug ? ' active' : ''}">${s.icon} ${escapeHtml(s.navLabel)}</a>`).join('')}
</div>`;
}

function findVenueConcerts(venue, allConcerts) {
  const keys = venue.locationMatch.map((k) => k.toLowerCase());
  return allConcerts.filter((c) => {
    const loc = (c.f.Location || '').toLowerCase();
    return keys.some((k) => loc.includes(k));
  });
}

function findVenueForLocation(location) {
  const loc = (location || '').toLowerCase();
  if (!loc) return null;
  return VENUES.find((v) => v.locationMatch.some((k) => loc.includes(k.toLowerCase()))) || null;
}

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

// og:image / twitter:image / JSON-LD "image" all require an ABSOLUTE url per
// spec — our own images are stored as root-relative paths (/images/foo.jpg),
// so this turns them into full https://8concert.com/images/foo.jpg URLs.
function absUrl(p) {
  if (!p) return '';
  return /^https?:\/\//.test(p) ? p : `${SITE_URL}${p}`;
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

// Google's structured-data check for Event/MusicEvent flags a missing
// endDate as a (non-critical) recommendation. Airtable never records a real
// end time, so — only when we actually know a specific start time, never
// for a bare date — we estimate a typical concert length. This mirrors what
// most ticketing/aggregator sites do when the true end time isn't
// published; we deliberately skip it rather than invent a time-of-day we
// don't have.
const TYPICAL_CONCERT_DURATION_MS = 2.5 * 60 * 60 * 1000;
function estimateEndDateTime(startDateTime, timeDisplay) {
  if (!timeDisplay) return undefined;
  const m = String(startDateTime).match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2})$/);
  if (!m) return undefined;
  const offset = m[1];
  const start = new Date(startDateTime);
  if (isNaN(start.getTime())) return undefined;
  const om = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  const offsetMin = om ? (om[1] === '-' ? -1 : 1) * (parseInt(om[2], 10) * 60 + parseInt(om[3], 10)) : 0;
  // Shift into "local time represented via UTC getters" so we can read
  // Y/M/D/H/M/S directly without a second timezone-database lookup.
  const local = new Date(start.getTime() + TYPICAL_CONCERT_DURATION_MS + offsetMin * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${offset}`;
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

const IMAGE_EXT_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Airtable's attachment URLs (v5.airtableusercontent.com/...) are SIGNED and
// expire a few hours after Airtable generates them — hotlinking them means
// images silently break on the live site well before the next scheduled
// rebuild. Download each image once at build time and self-host it in
// dist/images/ instead, so the URL baked into the HTML is our own domain's
// and never expires between deploys.
// Airtable's attachment URLs are temporary signed links that expire a few
// hours after being issued, and dist/ is wiped and rebuilt from scratch on
// every deploy — so a naive "download into dist/images/" would work on the
// build right after an image is added, then silently break on every build
// after that. To survive rebuilds (and to keep working once a concert is
// past and no longer being fetched from Airtable at all), downloaded images
// are cached once in the git-committed data/images/ folder and just copied
// from there on every subsequent build; the network fetch only ever happens
// the first time a given concert's image is seen.
async function resolveImage(url, slug, destDir) {
  fs.mkdirSync(IMAGE_ARCHIVE_DIR, { recursive: true });

  const cached = fs.existsSync(IMAGE_ARCHIVE_DIR)
    ? fs.readdirSync(IMAGE_ARCHIVE_DIR).find((f) => f.startsWith(`${slug}.`))
    : null;
  if (cached) {
    fs.copyFileSync(path.join(IMAGE_ARCHIVE_DIR, cached), path.join(destDir, cached));
    return `/images/${cached}`;
  }

  if (!url) return '';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const ext = IMAGE_EXT_BY_CONTENT_TYPE[contentType] || 'jpg';
    const filename = `${slug}.${ext}`;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(IMAGE_ARCHIVE_DIR, filename), buf); // persists across builds
    fs.writeFileSync(path.join(destDir, filename), buf);           // this build's dist/
    return `/images/${filename}`;
  } catch (err) {
    console.warn(`Warning: couldn't get image for "${slug}" (${err.message}). Card will render without an image.`);
    return '';
  }
}

// Airtable's "Time" field can be either plain text ("19:00") or, if it was
// set up as a Duration field type (which is what "19:00" looks like when you
// just start typing a time into a new column — Airtable defaults new time-ish
// columns to Duration, not Time-of-day, since it has no dedicated
// time-only field type), the API returns a NUMBER of total seconds instead
// of the string. Handle both rather than silently dropping the number case.
function parseTimeField(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const totalMinutes = Math.round(raw / 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  const match = String(raw).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

// Google requires Offer.price to be a plain number for structured data to be
// valid — our Price field is free text like "450 грн" or "від 650 грн"
// ("from 650 UAH", used when a ticket tier starts at that price). Rather
// than asking the editor to keep a second numeric field in sync, pull the
// first number out of whatever's already there. Returns undefined (key
// omitted from the JSON-LD) if the text has no digits at all, instead of
// emitting a wrong/fake price.
function parsePriceValue(priceStr) {
  if (!priceStr) return undefined;
  const match = String(priceStr).replace(/\u00A0/g, ' ').match(/\d[\d\s]*/);
  if (!match) return undefined;
  const digits = match[0].replace(/\s/g, '');
  return digits || undefined;
}

function buildConcertData(record) {
  const f = record.fields;
  const price = f.Price || '';
  const link = f.Link || '#';
  const isFree = price.toLowerCase().includes('вільний') || price.toLowerCase().includes('безкоштовн');
  const priceNumeric = isFree ? '0' : parsePriceValue(price);
  const snippet = f.Snippet || '';
  const desc = snippet ? snippet.slice(0, 90) + (snippet.length > 90 ? '...' : '') : '';
  const title = f.Title || 'Назва уточнюється';
  const slug = `${slugify(title)}-${record.id.slice(-6).toLowerCase()}`;
  const isoDate = parseUkrainianDate(f.Date);
  const timeDisplay = parseTimeField(f.Time) || '';
  const dateDisplay = (isoDate ? formatDateDisplay(isoDate) : (f.Date || '')) + (timeDisplay ? `, ${timeDisplay}` : '');
  // Full ISO datetime with Kyiv's correct UTC offset for that specific date —
  // used as Event startDate in JSON-LD. Falls back to date-only when there's
  // no time, and to nothing at all when there's no date either (existing
  // isoDate-null behaviour is unchanged).
  const startDateTime = isoDate && timeDisplay ? `${isoDate}T${timeDisplay}:00${kyivOffset(isoDate)}` : isoDate;
  const endDateTime = estimateEndDateTime(startDateTime, timeDisplay);
  // validFrom: the date our archive first saw this record — see main()'s
  // _firstSeenDate tracking. Not the same as a real on-sale date (we don't
  // have that), but it's real data about our own listing, not a guess.
  const validFrom = record._firstSeenDate;
  const image = extractImageUrl(f.Image);

  return { record, f, price, priceNumeric, link, isFree, snippet, desc, title, slug, isoDate, dateDisplay, startDateTime, endDateTime, validFrom, image };
}

// Only filters out events we're CONFIDENT have already happened (a successfully
// parsed date that's strictly before today). Records with an unparseable date
// are kept visible rather than risk hiding something that's actually upcoming.
function isPastEvent(concert, todayStr) {
  return Boolean(concert.isoDate) && concert.isoDate < todayStr;
}

function renderConcertCard(c, { linkTitle, extra = false }) {
  const { f, num, price, link, isTop, isFree, desc, title, slug, image, dateDisplay } = c;
  const titleHtml = linkTitle
    ? `<a class="concert-title" href="/concert/${slug}/">${escapeHtml(title)}</a>`
    : `<div class="concert-title">${escapeHtml(title)}</div>`;

  // "extra" cards are the genre-filter backfill pool (see client.js
  // refreshVisibility): concerts beyond the curated 8, baked into the page
  // already-hidden, revealed by JS when an isolated genre filter would
  // otherwise leave fewer than 8 cards on screen. Same markup as a normal
  // card, just starts hidden and flagged so JS can find it.
  return `
      <div class="concert-item${image ? ' has-image' : ''}${extra ? ' concert-item-extra' : ''}" data-category="${escapeHtml(displayCategory(f.Category))}"${extra ? ' style="display:none"' : ''}>
        <div class="concert-num">${num}</div>
        <div class="concert-info">
          ${image ? `<img class="concert-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">` : ''}
          <div class="concert-tags">
            ${isTop ? '<span class="tag tag-warm">Вибір редакції</span>' : ''}
            ${f.Category ? `<span class="tag">${escapeHtml(displayCategory(f.Category))}</span>` : ''}
          </div>
          ${titleHtml}
          ${desc ? `<div class="concert-desc">${escapeHtml(desc)}</div>` : ''}
          <div class="concert-meta">
            ${dateDisplay ? `<span>📅 ${escapeHtml(dateDisplay)}</span>` : ''}
            ${f.Location ? (() => {
              const venue = findVenueForLocation(f.Location);
              return venue
                ? `<span>📍 <a href="/mistsya/${venue.slug}/" class="venue-link">${escapeHtml(f.Location)}</a></span>`
                : `<span>📍 ${escapeHtml(f.Location)}</span>`;
            })() : ''}
          </div>
        </div>
        <div class="concert-right">
          ${isFree ? '<div class="concert-price-label">Вхід</div>' : ''}
          <div class="concert-price">${isFree ? 'Вільний' : escapeHtml(price) || '—'}</div>
          <a href="${escapeHtml(link)}" class="${isFree ? 'btn-ticket btn-free' : 'btn-ticket'}" target="_blank" rel="noopener sponsored"
             data-ticket-link data-concert-id="${c.record.id}" data-concert-title="${escapeHtml(title)}"
             data-concert-category="${escapeHtml(displayCategory(f.Category))}" data-concert-price="${escapeHtml(price)}">
            ${isFree ? 'Деталі' : 'Квитки →'}
          </a>
        </div>
      </div>`;
}

function pageShell({ title, description, canonical, bodyExtraHead = '', headerHtml, contentHtml, jsonLd = null, ogImage = '' }) {
  return `<!DOCTYPE html>
<html lang="uk">
<head>
${GA_MEASUREMENT_ID ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_MEASUREMENT_ID}');
</script>` : ''}
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${canonical}">
${ogImage ? `<meta property="og:image" content="${escapeHtml(absUrl(ogImage))}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
${ogImage ? `<meta name="twitter:image" content="${escapeHtml(absUrl(ogImage))}">` : ''}
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
${bodyExtraHead}
</head>
<body>
${headerHtml}
${contentHtml}
<script src="/client.js" defer></script>
${PLERDY_SNIPPET}
</body>
</html>`;
}

function siteHeader() {
  return `<header>
  <a href="/" class="logo">8<span>CONCERT</span></a>
  <nav>
    <a href="/">Афіша</a>
    <a href="/#today" data-tab-link="today">Сьогодні</a>
    <a href="/mistsya/">Місця</a>
    <a href="/about/">Про нас</a>
    <a href="/" class="nav-city">Київ</a>
  </nav>
</header>`;
}

// Small inline monoline icons — no icon font/library dependency, no
// third-party embed/tracker (unlike Facebook's own share/like widgets).
const ICON_SHARE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><line x1="8.2" y1="10.7" x2="15.8" y2="6.3"/><line x1="8.2" y1="13.3" x2="15.8" y2="17.7"/></svg>`;
const ICON_INSTAGRAM = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>`;
const ICON_FACEBOOK = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12.06C22 6.53 17.52 2 12 2S2 6.53 2 12.06c0 5 3.66 9.13 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.81 8.44-4.94 8.44-9.94z"/></svg>`;

function siteFooter() {
  return `<footer>
  <div>
    <div class="footer-logo">8<span>CONCERT</span></div>
    <div class="footer-desc">Редакційна добірка концертів Києва для тих, хто цінує особливі вечори. Оновлюється щодня.</div>
    <div class="footer-genres">
      <span class="footer-genre">Джаз</span>
      <span class="footer-genre">Класика</span>
      <span class="footer-genre">Триб'юти</span>
    </div>
    <div class="footer-social">
      ${SITE.instagramUrl ? `<a href="${escapeHtml(SITE.instagramUrl)}" target="_blank" rel="noopener" aria-label="Instagram">${ICON_INSTAGRAM}</a>` : ''}
      ${SITE.facebookUrl ? `<a href="${escapeHtml(SITE.facebookUrl)}" target="_blank" rel="noopener" aria-label="Facebook">${ICON_FACEBOOK}</a>` : ''}
    </div>
  </div>
  <div>
    <div class="footer-col-title">Афіша</div>
    <div class="footer-links">
      <a href="/#week" data-tab-link="week">Цей тиждень</a>
      <a href="/#today" data-tab-link="today">Сьогодні</a>
      <a href="/mistsya/">Місця</a>
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

function renderHomepage(concerts, overflowPool = []) {
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

  // Genre-filter backfill pool: every fresh upcoming concert beyond the
  // curated 8, already numbered and rendered, but hidden by default (see
  // renderConcertCard's `extra` flag). When someone isolates a single genre
  // pill and the curated 8 doesn't have 8 concerts in that genre, client.js
  // reveals cards from here (chronological order, matching genre) until
  // either 8 cards are on screen or the pool runs out — so "Джаз" always
  // shows every upcoming jazz concert we know about, not just whichever
  // ones happened to make this week's front-page 8.
  const overflowHtml = overflowPool
    .map((c, index) => renderConcertCard(
      { ...c, num: String(DISPLAY_COUNT + index + 1).padStart(2, '0'), isTop: false },
      { linkTitle: true, extra: true },
    ))
    .join('');

  // One dedicated row for the genre pills, sitting between the quote strip
  // and the tabs — above "8 подій" rather than squeezed into the same row
  // as the tab labels (that was cramped on narrow/in-app viewports: 3 tab
  // labels + 3 pills fighting for one line never had a clean fallback) or
  // stuffed under the hero subtitle (worked but felt disconnected from the
  // list right below it). Single element, no responsive duplication needed.
  const genrePills = `
    <div class="genre-pill active">🎷 Джаз</div>
    <div class="genre-pill active">🎻 Класика</div>
    <div class="genre-pill active">🎤 Триб'юти</div>`;

  const content = `
<div class="hero">
  <div class="hero-left">
    <div class="hero-label">Редакційна добірка</div>
    <h1 class="hero-title">Концерти Києва —<br>вісім вечорів, які варто <em>прожити</em></h1>
    <p class="hero-sub">Щотижня обираємо вісім концертів джазу, класики та триб'ютів у Києві — для тих, хто цінує особливі моменти.</p>
  </div>
</div>

<div class="quote-strip">
  <div class="quote-line"></div>
  <div class="quote-text">«Музика — найкоротший шлях між двома серцями»</div>
</div>

<div class="filter-row">
  <div class="hero-genres">${genrePills}</div>
</div>

<div class="tabs-bar">
  <button class="tab active" onclick="switchTab(this,'top8')" id="top8">8 подій</button>
  <button class="tab" onclick="switchTab(this,'week')" id="week">Цей тиждень</button>
  <button class="tab" onclick="switchTab(this,'today')" id="today">Сьогодні ввечері</button>
</div>

<div id="tab-top8">${top8Html}${overflowHtml}</div>
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
    description: "Щотижнева редакційна добірка з восьми концертів джазу, класики та триб'ютів у Києві. Обираємо найкращі вечори для тих, хто цінує особливі моменти.",
    canonical: `${SITE_URL}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
    jsonLd,
    ogImage: (concerts.find((c) => c.image) || {}).image || '',
  });
}

// Splits a concert's Snippet text into a magazine-style layout: a larger
// italic "lead" paragraph up top, followed by normal body paragraphs. If the
// Airtable field has real blank-line paragraph breaks, we use those. If it's
// one unbroken block (the common case), we pull out just the first sentence
// as the lead so long snippets still get a "standfirst" instead of one grey
// wall of text.
function renderBodyParagraphs(snippet) {
  if (!snippet) return '';
  const paragraphs = snippet.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return '';

  let lead;
  let rest;
  if (paragraphs.length > 1) {
    [lead, ...rest] = paragraphs;
  } else {
    const single = paragraphs[0];
    const sentenceMatch = single.match(/^.+?[.!?…](?=\s|$)/);
    if (sentenceMatch && sentenceMatch[0].length < single.length) {
      lead = sentenceMatch[0].trim();
      rest = [single.slice(sentenceMatch[0].length).trim()].filter(Boolean);
    } else {
      lead = single;
      rest = [];
    }
  }

  const leadHtml = `<p class="concert-lead">${escapeHtml(lead)}</p>`;
  const restHtml = rest.map((p) => `<p class="concert-body-text">${escapeHtml(p)}</p>`).join('');
  return leadHtml + restHtml;
}

// Compact link-card for the "Інші концерти в Києві" strip shown at the
// bottom of past-event pages — deliberately much lighter than the full
// renderConcertCard (no image/desc/tags), just enough to give the visitor
// somewhere to go and to pass internal link equity to the current afisha.
function renderRelatedConcert(c) {
  return `
      <a class="related-item" href="/concert/${c.slug}/">
        <span class="related-item-title">${escapeHtml(c.title)}</span>
        ${c.dateDisplay ? `<span class="related-item-date">📅 ${escapeHtml(c.dateDisplay)}</span>` : ''}
      </a>`;
}

function renderConcertPage(c, { isPast = false, otherConcerts = [] } = {}) {
  const { f, title, desc, snippet, price, priceNumeric, isFree, link, slug, isoDate, dateDisplay, startDateTime, endDateTime, validFrom, record, image } = c;

  // MusicEvent (a subtype of Event) — every listing on this site is a
  // concert, so the more specific type is accurate and Google explicitly
  // supports it for the same Event rich result. "Performer" is only
  // included when the Airtable "Performer" field has an actual name —
  // guessing it from the title would be wrong for tribute nights (the
  // performer is the local tribute act, not the artist being covered), and
  // some rows use the literal placeholder "Без імені" instead of leaving
  // the field blank, which needs the same "skip it" treatment as empty.
  const performerName = f.Performer && f.Performer.trim().toLowerCase() !== 'без імені'
    ? f.Performer.trim()
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: title,
    description: snippet || desc || title,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    ...(startDateTime ? { startDate: startDateTime } : {}),
    ...(endDateTime ? { endDate: endDateTime } : {}),
    location: {
      '@type': 'Place',
      name: f.Location || 'Київ',
      address: { '@type': 'PostalAddress', addressLocality: 'Київ', addressCountry: 'UA' },
    },
    ...(f.Category ? { genre: displayCategory(f.Category) } : {}),
    ...(image ? { image: [absUrl(image)] } : {}),
    ...(performerName ? { performer: { '@type': 'PerformingGroup', name: performerName } } : {}),
    // Real organizer data isn't tracked in Airtable yet — we're not going
    // to fabricate a promoter/organizer name just to satisfy the "missing
    // field" recommendation, since a wrong organizer is worse than an
    // absent one. Add an "Organizer" column in Airtable and this picks it
    // up automatically, no code change needed.
    ...(f.Organizer && f.Organizer.trim() ? { organizer: { '@type': 'Organization', name: f.Organizer.trim() } } : {}),
    offers: {
      '@type': 'Offer',
      url: link,
      ...(priceNumeric ? { price: priceNumeric } : {}),
      priceCurrency: 'UAH',
      availability: 'https://schema.org/InStock',
      ...(validFrom ? { validFrom } : {}),
    },
  };

  // Past events keep their page (never 404 — see main()'s pastPages), but
  // swap the "buy tickets" CTA for an honest "this already happened" notice
  // plus a way back into the current afisha, instead of pointing people at a
  // ticket link that's no longer valid.
  const ctaHtml = isPast
    ? `
  <div class="concert-ended">
    <span class="tag tag-ended">Подія завершена</span>
    <p class="concert-ended-note">Ця подія вже відбулася. Актуальну афішу дивіться нижче.</p>
  </div>`
    : `
  <p class="concert-price" style="margin-top:24px">${isFree ? 'Вхід вільний' : escapeHtml(price) || ''}</p>
  <a href="${escapeHtml(link)}" class="btn-ticket" style="margin-top:16px" target="_blank" rel="noopener sponsored"
     data-ticket-link data-concert-id="${record.id}" data-concert-title="${escapeHtml(title)}"
     data-concert-category="${escapeHtml(displayCategory(f.Category))}" data-concert-price="${escapeHtml(price)}">
    ${isFree ? 'Деталі та реєстрація →' : 'Купити квитки →'}
  </a>`;

  const related = otherConcerts.filter((oc) => oc.slug !== slug).slice(0, 4);
  const relatedHtml = isPast && related.length
    ? `
<section class="related-concerts">
  <h2 class="related-title">Інші концерти в Києві</h2>
  <div class="related-list">${related.map(renderRelatedConcert).join('')}
  </div>
</section>`
    : '';

  // Web Share API on supporting browsers (mostly mobile — opens the native
  // share sheet), "copy link" fallback everywhere else. See src/client.js.
  // No third-party share SDK/pixel — just the browser's own API.
  const shareHtml = `
  <button type="button" class="btn-share" data-share
     data-share-title="${escapeHtml(title)}" data-share-url="${SITE_URL}/concert/${slug}/">
    ${ICON_SHARE}<span class="btn-share-label">Поділитися</span>
  </button>`;

  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / ${escapeHtml(title)}</nav>
<article class="concert-page">
  ${image ? `<img class="concert-page-image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy">` : ''}
  <div class="concert-tags">
    ${f.Category ? `<span class="tag">${escapeHtml(displayCategory(f.Category))}</span>` : ''}
  </div>
  <h1 class="concert-title">${escapeHtml(title)}</h1>
  ${renderBodyParagraphs(snippet)}
  <div class="concert-meta">
    ${dateDisplay ? `<span>📅 ${escapeHtml(dateDisplay)}</span>` : ''}
    ${f.Location ? (() => {
      const venue = findVenueForLocation(f.Location);
      return venue
        ? `<span>📍 <a href="/mistsya/${venue.slug}/" class="venue-link">${escapeHtml(f.Location)}</a></span>`
        : `<span>📍 ${escapeHtml(f.Location)}</span>`;
    })() : ''}
  </div>
  ${ctaHtml}
  ${shareHtml}
</article>${relatedHtml}`;

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
  <h1 class="concert-title">8CONCERT — вісім вечорів, які варто прожити</h1>
  ${renderBodyParagraphs(SITE.aboutText)}
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
    .filter((c) => normalizeCategoryKey(c.f.Category) === normalizeCategoryKey(cat.name))
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

function renderVenueCard(venue) {
  return `
      <a href="/mistsya/${venue.slug}/" class="venue-card">
        <img class="venue-card-image" src="/images/venues/${venue.image}" alt="${escapeHtml(venue.name)}" loading="lazy">
        <div class="venue-card-body">
          <div class="venue-card-category">${escapeHtml(venue.category)}</div>
          <div class="venue-card-name">${escapeHtml(venue.name)}</div>
          <div class="venue-card-tagline">${escapeHtml(venue.tagline)}</div>
        </div>
      </a>`;
}

function renderVenuesIndexPage(venues) {
  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / Місця</nav>
<div class="hero" style="padding-bottom:24px">
  <div class="hero-left">
    <div class="hero-label">Гід по майданчиках</div>
    <h1 class="hero-title">Де в Києві слухають музику наживо</h1>
    <p class="hero-sub">Дахи, тераси, зали й паби, де регулярно проходять концерти з нашої добірки — з плюсами, мінусами і афішею кожного місця. Оберіть сезон або перегляньте весь список нижче.</p>
  </div>
</div>
${renderSeasonToggle(null)}
<div class="venue-grid">${venues.map(renderVenueCard).join('')}</div>
`;

  return pageShell({
    title: 'Місця — де в Києві слухають концерти наживо | 8CONCERT',
    description: 'Гід по концертних майданчиках Києва: дах ЦУМ, тераси River Mall, Gulliver, Д12, Toronto-Kyiv, концерти біля Києво-Печерської лаври та затишні зали й паби. Літні й зимові майданчики окремо.',
    canonical: `${SITE_URL}/mistsya/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
  });
}

function renderSeasonVenuesPage(season, allVenues) {
  const venues = allVenues.filter((v) => v.setting === season.setting);
  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / <a href="/mistsya/">Місця</a> / ${escapeHtml(season.navLabel)}</nav>
<div class="hero" style="padding-bottom:24px">
  <div class="hero-left">
    <div class="hero-label">${escapeHtml(season.heroLabel)}</div>
    <h1 class="hero-title">${escapeHtml(season.h1)}</h1>
    <p class="hero-sub">${escapeHtml(season.intro)}</p>
  </div>
</div>
${renderSeasonToggle(season.slug)}
<div class="venue-grid">${venues.map(renderVenueCard).join('')}</div>
<p class="concert-desc" style="font-size:14px;margin-top:28px"><a href="/mistsya/" class="venue-link">← Усі майданчики</a></p>
`;

  return pageShell({
    title: season.seoTitle,
    description: season.metaDescription,
    canonical: `${SITE_URL}/mistsya/${season.slug}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
  });
}

function renderVenuePage(venue, allConcerts) {
  // allConcerts is allPages (only concerts that actually got a /concert/
  // page written — see main()) sorted soonest-first by the caller. We only
  // ever show upcoming concerts here, never past ones: a venue page is
  // meant to help someone decide whether to go, and a list padded with
  // events that already happened isn't useful for that.
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = findVenueConcerts(venue, allConcerts)
    .filter((c) => !isPastEvent(c, todayStr))
    .slice(0, 8);

  const prosConsHtml = `
  <div class="venue-proscons">
    <div class="venue-pros">
      <div class="venue-proscons-title">Плюси</div>
      <ul>${venue.pros.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </div>
    <div class="venue-cons">
      <div class="venue-proscons-title">Мінуси</div>
      <ul>${venue.cons.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
    </div>
  </div>`;

  const infoLine = venue.address || '';

  const concertsHtml = upcoming.length
    ? `
  <section class="related-concerts" style="padding:0;max-width:none;margin-top:8px">
    <h2 class="related-title">Концерти тут</h2>
    <div class="related-list">${upcoming.map(renderRelatedConcert).join('')}
    </div>
  </section>`
    : `
  <div class="loading" style="margin-top:8px">Найближчим часом концертів тут у нашій добірці ще немає. Стежте за афішею — оновлюємо її щодня.</div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: venue.name,
    description: venue.tagline,
    ...(venue.address ? { address: { '@type': 'PostalAddress', name: venue.address, addressLocality: 'Київ', addressCountry: 'UA' } } : {}),
  };

  const content = `
<nav class="breadcrumb"><a href="/">Афіша</a> / <a href="/mistsya/">Місця</a> / ${escapeHtml(venue.name)}</nav>
<article class="concert-page">
  <img class="concert-page-image" src="/images/venues/${venue.image}" alt="${escapeHtml(venue.name)}" loading="lazy">
  <div class="concert-tags">
    <span class="tag">${escapeHtml(venue.category)}</span>
  </div>
  <h1 class="concert-title">${escapeHtml(venue.name)}</h1>
  ${venue.paragraphs.map((p) => `<p class="concert-desc" style="font-size:15px;line-height:1.7;margin-bottom:14px">${escapeHtml(p)}</p>`).join('')}
  ${infoLine ? `<div class="concert-meta"><span>📍 ${escapeHtml(infoLine)}</span></div>` : ''}
  ${prosConsHtml}
  ${concertsHtml}
</article>`;

  return pageShell({
    title: `${venue.seoTitle} | 8CONCERT`,
    description: venue.metaDescription,
    canonical: `${SITE_URL}/mistsya/${venue.slug}/`,
    headerHtml: siteHeader(),
    contentHtml: content + siteFooter(),
    jsonLd,
    ogImage: `/images/venues/${venue.image}`,
  });
}

function renderSitemap(concerts) {
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/about/`,
    `${SITE_URL}/contacts/`,
    `${SITE_URL}/mistsya/`,
    ...SEASONS.map((s) => `${SITE_URL}/mistsya/${s.slug}/`),
    ...CATEGORIES.map((cat) => `${SITE_URL}/${cat.slug}/`),
    ...VENUES.map((v) => `${SITE_URL}/mistsya/${v.slug}/`),
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

// llms.txt — informal convention some AI systems use to get a clean summary
// of a site's content instead of parsing full HTML. Not a strict standard
// (providers treat it as an optional hint, and it's aimed more at training
// crawlers than the live web-search agents that actually answer "де піти на
// концерт" in real time) — but it's cheap to provide and doesn't hurt.
// Regenerated every build, so "Поточна добірка" always reflects what's live.
function renderLlmsTxt(concerts) {
  const picks = concerts
    .map((c) => `- [${c.title}](${SITE_URL}/concert/${c.slug}/): ${c.dateDisplay || 'дата уточнюється'}${c.f.Location ? `, ${c.f.Location}` : ''}${c.price ? `, ${c.price}` : ''}`)
    .join('\n');

  return `# 8CONCERT

> Щотижнева редакційна добірка з восьми концертів джазу, класики та триб'ютів у Києві.

8CONCERT не публікує повну афішу міста — редакція постійно обирає лише вісім концертів (джаз, класика, триб'юти), які, на її думку, справді варті вечора. Це редакційний вибір, не каталог і не продавець квитків: посилання "Квитки" ведуть на офіційні майданчики продажу.

## Розділи

- [Афіша (головна)](${SITE_URL}/): поточна добірка тижня.
- [Джаз](${SITE_URL}/jazz/)
- [Класика](${SITE_URL}/klasika/)
- [Триб'юти](${SITE_URL}/trybuti/)
- [Про нас](${SITE_URL}/about/): хто ми і як обираємо концерти.
- [Контакти](${SITE_URL}/contacts/)

## Поточна добірка (оновлюється щодня)

${picks}

## Примітки

Кожна подія має власну сторінку /concert/<slug>/ з датою, локацією, ціною, посиланням на квитки та Event/MusicEvent structured data (schema.org). Сторінки минулих концертів не видаляються — після завершення події сторінка залишається доступною з позначкою "Подія завершена".
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

  // Merge this week's fetch into the permanent archive (keyed by Airtable
  // record id). Fresh data always wins for records still in Airtable; once a
  // record is removed from Airtable (or its date passes) it just keeps its
  // last-known fields here forever, instead of disappearing.
  const archiveMap = loadArchive();
  // _firstSeenDate is the one field on the archived record that isn't raw
  // Airtable data — it's the date this build first saw the record, kept
  // stable across every future overwrite. Used as Offer.validFrom: an
  // honest "we've had this listing since" instead of a fabricated
  // on-sale date we have no way of knowing. Records archived before this
  // feature existed get today's date as their first-seen date, since we
  // have no earlier record of them.
  for (const r of records) {
    const prevFirstSeen = archiveMap[r.id] && archiveMap[r.id]._firstSeenDate;
    archiveMap[r.id] = { ...r, _firstSeenDate: prevFirstSeen || todayStr };
  }
  saveArchive(archiveMap);

  const freshIds = new Set(records.map((r) => r.id));
  const allKnown = Object.values(archiveMap).map(buildConcertData);

  // Every fresh (still in Airtable), not-yet-past record with at least a
  // title — this is broader than the homepage's curated 8: Airtable can
  // (and often does) have more upcoming concerts than we feature on the
  // homepage at once. Records with no Title filled in yet are treated as
  // unfinished drafts (e.g. a row Rocky started adding in Airtable but
  // hasn't finished) and stay invisible on the site — no page, no
  // homepage slot, no "Назва уточнюється" placeholder card — until a
  // title is filled in.
  const freshUpcoming = allKnown
    .filter((c) => freshIds.has(c.record.id) && !isPastEvent(c, todayStr) && Boolean(c.f.Title))
    // Soonest first. allKnown's own order is just archive.json's key order
    // (alphabetical by Airtable record id, for stable git diffs — see
    // saveArchive), which has nothing to do with event date, so without an
    // explicit sort here the homepage's "curated 8" would appear in a
    // effectively random order instead of chronological.
    .sort((a, b) => {
      if (!a.isoDate) return 1;
      if (!b.isoDate) return -1;
      return a.isoDate < b.isoDate ? -1 : a.isoDate > b.isoDate ? 1 : 0;
    });

  // Curated homepage set: unchanged behaviour — the first DISPLAY_COUNT of
  // freshUpcoming, numbered for the homepage/category cards.
  const concerts = freshUpcoming
    .slice(0, DISPLAY_COUNT)
    .map((c, index) => ({
      ...c,
      num: String(index + 1).padStart(2, '0'),
      isTop: index < 2 || c.f.Status === 'Топ',
    }));

  // Everything fresh+upcoming beyond the curated 8 still gets a real
  // /concert/<slug>/ page (isPast: false) — just not a spot on the
  // homepage. Without this, a concert Rocky adds to Airtable that doesn't
  // make the top 8 has no page at all, so nothing (venue pages included)
  // can safely link to it. Not shown on the homepage/category pages —
  // those stay curated to exactly 8 — but real, crawlable, and linkable.
  const overflowConcerts = freshUpcoming.slice(DISPLAY_COUNT);

  // Every concert we've ever archived whose date has passed gets to keep its
  // page — "Не видаляти минулі концерти": no 404s, Google keeps whatever
  // authority/traffic the page earned by artist/event name. This includes
  // records still sitting in Airtable past their date AND ones already
  // removed from the table, as long as we archived them at some point.
  const pastPages = allKnown.filter((c) => isPastEvent(c, todayStr));

  console.log(`Curated this week: ${concerts.length}. Extra upcoming (not on homepage): ${overflowConcerts.length}. Past pages kept alive: ${pastPages.length}.`);

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

  const imagesDir = path.join(DIST, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const allPages = [...concerts, ...overflowConcerts, ...pastPages];
  for (const c of allPages) {
    c.image = await resolveImage(c.image, c.slug, imagesDir);
  }

  fs.writeFileSync(path.join(DIST, 'index.html'), renderHomepage(concerts, overflowConcerts));
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), renderSitemap(allPages));
  fs.writeFileSync(path.join(DIST, 'robots.txt'), renderRobots());
  fs.writeFileSync(path.join(DIST, 'llms.txt'), renderLlmsTxt(concerts));

  fs.mkdirSync(path.join(DIST, 'about'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'about', 'index.html'), renderAboutPage());

  fs.mkdirSync(path.join(DIST, 'contacts'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'contacts', 'index.html'), renderContactsPage());

  for (const cat of CATEGORIES) {
    fs.mkdirSync(path.join(DIST, cat.slug), { recursive: true });
    fs.writeFileSync(path.join(DIST, cat.slug, 'index.html'), renderCategoryPage(cat, concerts));
  }

  // "Місця" (venues): built from allPages, NOT allKnown/allConcerts — only
  // concerts allPages actually get a /concert/<slug>/ page written this
  // build (see the loops below and pastPages above). allKnown includes
  // every fresh Airtable record even ones beyond DISPLAY_COUNT that never
  // get a page, which was linking venue pages to concerts whose page
  // didn't exist (404). Sorted soonest-first so each venue page leads with
  // its next upcoming concert rather than an arbitrary archive order.
  const venueConcertPool = [...allPages].sort((a, b) => {
    if (!a.isoDate) return 1;
    if (!b.isoDate) return -1;
    return a.isoDate < b.isoDate ? -1 : a.isoDate > b.isoDate ? 1 : 0;
  });
  fs.mkdirSync(path.join(DIST, 'mistsya'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'mistsya', 'index.html'), renderVenuesIndexPage(VENUES));
  for (const season of SEASONS) {
    const seasonDir = path.join(DIST, 'mistsya', season.slug);
    fs.mkdirSync(seasonDir, { recursive: true });
    fs.writeFileSync(path.join(seasonDir, 'index.html'), renderSeasonVenuesPage(season, VENUES));
  }
  const venuesImagesDir = path.join(DIST, 'images', 'venues');
  fs.mkdirSync(venuesImagesDir, { recursive: true });
  for (const venue of VENUES) {
    fs.copyFileSync(path.join(ASSETS, 'venues', venue.image), path.join(venuesImagesDir, venue.image));
    const dir = path.join(DIST, 'mistsya', venue.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderVenuePage(venue, venueConcertPool));
  }

  fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(DIST, 'styles.css'));
  fs.copyFileSync(path.join(SRC, 'client.js'), path.join(DIST, 'client.js'));
  for (const asset of ['favicon.ico', 'apple-touch-icon.png', 'icon-32.png', 'icon-192.png', 'icon-512.png']) {
    fs.copyFileSync(path.join(ASSETS, asset), path.join(DIST, asset));
  }

  for (const c of concerts) {
    const dir = path.join(DIST, 'concert', c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderConcertPage(c, { isPast: false, otherConcerts: concerts }));
  }
  for (const c of overflowConcerts) {
    const dir = path.join(DIST, 'concert', c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderConcertPage(c, { isPast: false, otherConcerts: concerts }));
  }
  for (const c of pastPages) {
    const dir = path.join(DIST, 'concert', c.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderConcertPage(c, { isPast: true, otherConcerts: concerts }));
  }

  console.log(`Done. Wrote ${allPages.length + 3 + CATEGORIES.length + 1 + SEASONS.length + VENUES.length} HTML page(s) to dist/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
