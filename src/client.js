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
// Tapping a pill ISOLATES that genre (the other two turn off) — one tap to
// filter down to just "Джаз", not three. Tapping the only active pill again
// resets to "show everything" (all three active). Previously pills were
// independent toggles defaulting to all-active, so the first tap on a genre
// removed it instead of isolating it — backwards from what people expect
// and needed several taps to get a single-genre view.

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

function refreshVisibility() {
  const active = activeCategories();

  ['tab-top8', 'tab-week', 'tab-today'].forEach((id) => {
    const container = document.getElementById(id);
    if (!container) return;
    const items = container.querySelectorAll('.concert-item');
    let visibleCount = 0;
    items.forEach((item) => {
      const show = active.size > 0 && active.has(item.dataset.category || '');
      item.style.display = show ? '' : 'none';
      if (show) visibleCount += 1;
    });

    const emptyState = container.querySelector('.filter-empty');
    if (items.length > 0 && visibleCount === 0) {
      ensureEmptyState(container).style.display = 'block';
    } else if (emptyState) {
      emptyState.style.display = 'none';
    }
  });
}

const genrePills = Array.from(document.querySelectorAll('.genre-pill'));
genrePills.forEach((p) => {
  p.addEventListener('click', () => {
    const activeCount = genrePills.filter((x) => x.classList.contains('active')).length;
    const isSoleActive = p.classList.contains('active') && activeCount === 1;

    if (isSoleActive) {
      genrePills.forEach((x) => x.classList.add('active'));
    } else {
      genrePills.forEach((x) => x.classList.toggle('active', x === p));
    }
    refreshVisibility();
  });
});

refreshVisibility();

// --- Ad tracking placeholder -------------------------------------------
// Tickets are sold on a third-party site, so the closest thing we have to a
// "sale" signal on our own domain is a click on the ticket button. Once GTM /
// GA4 / Meta Pixel are installed (next step), this event is already wired up
// to become a Google Ads / Meta conversion — just create a trigger listening
// for "ticket_click" in GTM, no code changes needed here.
window.dataLayer = window.dataLayer || [];

document.querySelectorAll('[data-ticket-link]').forEach(el => {
  el.addEventListener('click', () => {
    window.dataLayer.push({
      event: 'ticket_click',
      concert_id: el.dataset.concertId || '',
      concert_title: el.dataset.concertTitle || '',
      concert_category: el.dataset.concertCategory || '',
      concert_price: el.dataset.concertPrice || ''
    });
  });
});
