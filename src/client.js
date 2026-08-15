// Client-side interactivity only. All concert data is already baked into the
// HTML at build time (see build.js) — nothing is fetched from Airtable in
// the browser, so there is no API token exposed to visitors.

function switchTab(btn, tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-week').style.display = tab === 'week' ? 'block' : 'none';
  document.getElementById('tab-today').style.display = tab === 'today' ? 'block' : 'none';
  document.getElementById('tab-top8').style.display = tab === 'top8' ? 'block' : 'none';
  refreshVisibility();
}

// Header/footer links point to /#today, /#week, /#top8. The tab buttons
// share their id with the hash (id="today" <-> #today, etc), so on load —
// and whenever the hash changes, since clicking one of these links while
// already on the homepage only changes the hash and doesn't reload the
// page — switch to the matching tab automatically.
function applyHashTab() {
  const hashTab = window.location.hash.replace('#', '');
  if (!hashTab) return;
  const hashBtn = document.getElementById(hashTab);
  if (hashBtn && hashBtn.classList.contains('tab')) switchTab(hashBtn, hashTab);
}
applyHashTab();
window.addEventListener('hashchange', applyHashTab);

// --- Genre filter --------------------------------------------------------
// Each pill is its own independent on/off switch, all three start active
// (= show everything). Tap a pill to toggle just that genre — to get back
// to "show everything" you turn the others back on individually, same
// mechanism both directions. (Tried an "isolate on tap, tap again to reset
// all" version — turned out to be less predictable than this plain toggle,
// since the "tap again resets everything" part wasn't obvious.)

function pillCategory(el) {
  // strip the leading emoji, keep the Ukrainian genre word
  return el.textContent.replace(/^[^\p{L}]+/u, '').trim();
}

function activeCategories() {
  return new Set(
    Array.from(document.querySelectorAll('.genre-pill.active')).map(pillCategory)
  );
}

function ensureEmptyState(container) {
  let el = container.querySelector('.filter-empty');
  if (!el) {
    el = document.createElement('div');
    el.className = 'loading filter-empty';
    el.textContent = 'Оберіть хоча б один жанр вище, щоб побачити концерти.';
    container.appendChild(el);
  }
  return el;
}

// The homepage's "8 подій" tab carries a hidden backfill pool alongside its
// 8 curated cards (see build.js's overflowHtml / .concert-item-extra) — every
// other fresh upcoming concert, in date order. Plain show/hide-by-category
// works fine for "Цей тиждень"/"Сьогодні ввечері" (they're just filtering
// whatever's already on screen), but on "8 подій" isolating one genre could
// otherwise leave you with 2-3 cards even though we know of more upcoming
// concerts in that genre — this tops the visible set back up to 8 from the
// backfill pool before falling back to the empty state.
const TARGET_COUNT = 8;

function refreshVisibility() {
  const active = activeCategories();

  ['tab-week', 'tab-today'].forEach((id) => {
    const container = document.getElementById(id);
    if (!container) return;
    const items = container.querySelectorAll('.concert-item');
    let visibleCount = 0;
    items.forEach((item) => {
      const show = active.size > 0 && active.has(item.dataset.category || '');
      item.style.display = show ? '' : 'none';
      if (show) visibleCount += 1;
    });
    toggleEmptyState(container, items.length, visibleCount);
    renumberVisible(container);
  });

  const top8 = document.getElementById('tab-top8');
  if (top8) {
    const core = top8.querySelectorAll('.concert-item:not(.concert-item-extra)');
    const extra = top8.querySelectorAll('.concert-item-extra');

    let visibleCore = 0;
    core.forEach((item) => {
      const show = active.size > 0 && active.has(item.dataset.category || '');
      item.style.display = show ? '' : 'none';
      if (show) visibleCore += 1;
    });

    let needed = active.size > 0 ? Math.max(0, TARGET_COUNT - visibleCore) : 0;
    let visibleExtra = 0;
    extra.forEach((item) => {
      const matches = active.has(item.dataset.category || '');
      const show = matches && needed > 0;
      item.style.display = show ? '' : 'none';
      if (show) { visibleExtra += 1; needed -= 1; }
    });

    toggleEmptyState(top8, core.length + extra.length, visibleCore + visibleExtra);
    renumberVisible(top8);
  }
}

function toggleEmptyState(container, itemCount, visibleCount) {
  const emptyState = container.querySelector('.filter-empty');
  if (itemCount > 0 && visibleCount === 0) {
    ensureEmptyState(container).style.display = 'block';
  } else if (emptyState) {
    emptyState.style.display = 'none';
  }
}

// The "01/02/..." badge is baked in at build time assuming every card is
// visible. Once a genre filter hides some of them, those baked-in numbers
// leave gaps (03, 07, 08...) instead of counting the cards actually on
// screen. Renumber whatever's left, in DOM order, every time visibility
// changes — same numbers reappear when the filter is cleared, since this
// only ever touches the visible set.
function renumberVisible(container) {
  let n = 0;
  container.querySelectorAll('.concert-item').forEach((item) => {
    if (item.style.display === 'none') return;
    n += 1;
    const badge = item.querySelector('.concert-num');
    if (badge) badge.textContent = String(n).padStart(2, '0');
  });
}

document.querySelectorAll('.genre-pill').forEach((p) => {
  p.addEventListener('click', () => {
    p.classList.toggle('active');
    refreshVisibility();
  });
});

refreshVisibility();

// --- Ad tracking -----------------------------------------------------------
// Tickets are sold on a third-party site, so the closest thing we have to a
// "sale" signal on our own domain is a click on the ticket button.
//
// Two pushes on purpose: the plain dataLayer.push(object) is GTM's "custom
// event" convention, kept for if a GTM container gets added later. The
// gtag('event', ...) call is what GA4's own gtag.js (already installed in
// pageShell) actually listens for — without it, clicks would sit in
// dataLayer but never reach GA4's reports.
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }

document.querySelectorAll('[data-ticket-link]').forEach(el => {
  el.addEventListener('click', () => {
    const params = {
      concert_id: el.dataset.concertId || '',
      concert_title: el.dataset.concertTitle || '',
      concert_category: el.dataset.concertCategory || '',
      concert_price: el.dataset.concertPrice || ''
    };
    window.dataLayer.push({ event: 'ticket_click', ...params });
    gtag('event', 'ticket_click', params);
  });
});

// --- Share button (concert pages) ---------------------------------------
// Prefers the native share sheet (navigator.share — mobile Safari/Chrome,
// and Chrome desktop as of recent versions); falls back to "copy link" on
// browsers that don't support it (mainly desktop Safari/Firefox). No
// third-party share widget/SDK, so nothing external is loaded or tracked.
document.querySelectorAll('[data-share]').forEach((btn) => {
  const label = btn.querySelector('.btn-share-label');
  const defaultLabel = label ? label.textContent : '';

  btn.addEventListener('click', async () => {
    const title = btn.dataset.shareTitle || document.title;
    const url = btn.dataset.shareUrl || window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch (err) {
        // AbortError when the user just closes the native share sheet — not an error.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      if (label) {
        label.textContent = 'Посилання скопійовано ✓';
        setTimeout(() => { label.textContent = defaultLabel; }, 2000);
      }
    } catch (err) {
      window.prompt('Скопіюйте посилання:', url);
    }
  });
});
