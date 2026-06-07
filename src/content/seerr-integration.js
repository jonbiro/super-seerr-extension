// Seerr Pre-Request Ratings Overlay
// Injects Rotten Tomatoes context on Seerr browse cards and detail pages.
// Prefers Seerr-native ratings data; falls back to confidence-aware resolution.
// The request flow remains visually primary throughout.

(function () {
  if (window.__seerr_overlay_installed) return;
  window.__seerr_overlay_installed = true;

  // Verify we are inside a Seerr instance
  if (!document.querySelector('[data-testid="navbar"]') && !document.querySelector('#__next')) {
    // Not a Seerr page — bail silently
    return;
  }

  const Model = window.RatingsModel;
  const Config = window.RatingsConfig;
  if (!Model || !Config) return;

  let debugMode = false;
  function log(...args) { if (debugMode) console.log('🍅 [Seerr Overlay]', ...args); }

  const FEATURE_FLAGS = {
    cardBadges: true,
    detailRatingsRow: true,
    preRequestSummary: true,
    sortFilter: true,
    bulkActions: true,
  };

  const ratingsCache = new Map(); // key: tmdbId (string), value: { bundle, expiresAt }

  // ──────────────── Route Detection ────────────────

  function detectRoute() {
    const path = window.location.pathname;
    if (/^\/movie\/\d+/.test(path)) return { type: 'movie-detail', id: path.match(/\/movie\/(\d+)/)[1] };
    if (/^\/tv\/\d+/.test(path))    return { type: 'tv-detail',    id: path.match(/\/tv\/(\d+)/)[1] };
    if (/^\/search/.test(path))     return { type: 'search' };
    if (path === '/')               return { type: 'discover' };
    return null;
  }

  // ──────────────── SPA Navigation ────────────────

  let currentPath = window.location.pathname;
  if (!history.__seerrOverlayPatched) {
    history.__seerrOverlayPatched = true;
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(history, args);
      setTimeout(handleRouteChange, 150);
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(history, args);
      setTimeout(handleRouteChange, 150);
    };
  }
  window.addEventListener('popstate', () => setTimeout(handleRouteChange, 150));

  function handleRouteChange() {
    if (window.location.pathname === currentPath) return;
    currentPath = window.location.pathname;
    cleanupOverlay();
    injectOverlay();
  }

  // ──────────────── Idempotency ────────────────

  function isAlreadyInjected() {
    // Check per-route type to allow re-injection on new pages (e.g., infinite scroll)
    const route = detectRoute();
    const selector = route?.type === 'discover' || route?.type === 'search'
      ? '[data-seerr-overlay="true"].seerr-card-badge'
      : '[data-seerr-overlay="true"]';
    return document.querySelector(selector);
  }

  function cleanupOverlay() {
    document.querySelectorAll('[data-seerr-overlay="true"]').forEach(el => el.remove());
    // Reset pending badge flags so cards can be re-injected after navigation
    document.querySelectorAll('[class*="card"], [class*="Card"]').forEach(c => { c.__seerrBadgesResolving = false; });
    // Clear the per-card in-progress flag so a future re-injection isn't
    // permanently blocked by a stale marker.
    document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"], [class*="MediaCard"]').forEach(card => {
      card.__seerrBadgesResolving = false;
      card.__seerrBadgesCleared = true;
    });
  }

  // ──────────────── Ratings Resolution ────────────────

  function extractSeerrNativeRatings() {
    const bundle = {};

    // Look for embedded JSON data (e.g., __NEXT_DATA__ or similar)
    const scripts = document.querySelectorAll('script[type="application/json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent);
        // Seerr typically embeds media data in various shapes
        if (data?.props?.pageProps?.media) {
          const m = data.props.pageProps.media;
          if (m.rtCriticsScore != null) bundle.rtCriticsScore = parseInt(m.rtCriticsScore);
          if (m.rtAudienceScore != null) bundle.rtAudienceScore = parseInt(m.rtAudienceScore);
          if (m.voteAverage != null) bundle.tmdbRating = parseFloat(m.voteAverage);
          if (m.imdbRating != null) bundle.imdbRating = parseFloat(m.imdbRating);
        }
      } catch (_) {}
    });

    // Try to extract from the DOM (ratings may be rendered as text)
    const rtElements = document.querySelectorAll('[data-rating], .rt-score');
    rtElements.forEach(el => {
      const text = el.textContent.trim();
      const scoreMatch = text.match(/(\d+)%/);
      if (scoreMatch && !bundle.rtCriticsScore) {
        bundle.rtCriticsScore = parseInt(scoreMatch[1]);
      }
    });

    if (Object.keys(bundle).length > 0) {
      bundle.confidence = 1.0;
      bundle.source = 'seerr-native';
      bundle.lastUpdated = Date.now();
    }

    return Object.keys(bundle).length > 0 ? Model.createRatingsBundle(bundle) : null;
  }

  async function resolveRatings(tmdbId, title, year) {
    log(`Resolving ratings for TMDB ${tmdbId}`);

    // 1. Check Seerr-native data first
    const native = extractSeerrNativeRatings();
    if (native && native.rtCriticsScore !== null) {
      log('Using Seerr-native ratings, confidence 1.0');
      return native;
    }

    // 2. If we have native data with some fields, use it as base
    if (native && Model.hasAnyScore(native)) {
      log('Using partial Seerr-native ratings');
      return native;
    }

    // 3. Fallback: try ID-based lookup (TMDB ID → RT slug via background proxy)
    // For now, since there's no RT API proxy in background.js, construct a
    // minimal fallback bundle based on available page data
    const fallback = Model.createRatingsBundle({
      confidence: native ? 1.0 : 0.0,
      source: native ? 'seerr-native' : 'unknown',
      lastUpdated: Date.now()
    });

    return fallback;
  }

  async function getRatings(tmdbId, title, year) {
    const key = String(tmdbId || title);
    const cached = ratingsCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      log(`Cache hit for ${key}`);
      return cached.bundle;
    }

    // Coalesce concurrent requests
    const pendingKey = `pending:${key}`;
    if (ratingsCache.has(pendingKey)) {
      log(`Coalescing request for ${key}`);
      return ratingsCache.get(pendingKey);
    }

    const promise = resolveRatings(tmdbId, title, year);
    ratingsCache.set(pendingKey, promise);

    try {
      const bundle = await promise;
      if (bundle) {
        ratingsCache.set(key, { bundle, expiresAt: Date.now() + Config.cacheTtlMs });
      }
      return bundle;
    } finally {
      ratingsCache.delete(pendingKey);
    }
  }

  // ──────────────── Quality Summary ────────────────

  function buildSummary(bundle) {
    const c = bundle.rtCriticsScore;
    const a = bundle.rtAudienceScore;
    if (c === null) return null;

    const cfg = Config.summary;
    if (c >= cfg.criticsCertifiedFresh) {
      if (a !== null && a - c >= Config.audienceCriticsDelta) {
        return 'Audience loves it even more than critics';
      }
      return 'Critics love it';
    }
    if (c >= cfg.criticsStrong)  return 'Strong reviews';
    if (c >= cfg.criticsMixed)   return 'Mixed reviews';
    if (a !== null && a - c >= Config.audienceCriticsDelta) {
      return 'Audience likes it more than critics';
    }
    return 'Mostly negative reviews';
  }

  // ──────────────── Injection ────────────────

  function injectCardBadges() {
    if (!FEATURE_FLAGS.cardBadges) return;

    // Find media cards on discover/search pages
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"], [class*="MediaCard"]');
    let injected = 0;

    cards.forEach(card => {
      if (card.querySelector('[data-seerr-overlay="true"][class*="card-badge"], [data-seerr-overlay="true"][class*="audience-badge"]')) return;
      if (card.__seerrBadgesResolving) return; // already resolving, skip this pass
      card.__seerrBadgesResolving = true;

      // Try to extract title/TMDB ID from card
      const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
      const title = titleEl?.textContent?.trim();
      if (!title) return;

      const link = card.querySelector('a[href]');
      const href = link?.getAttribute('href') || '';
      const tmdbMatch = href.match(/\/(movie|tv)\/(\d+)/);
      const tmdbId = tmdbMatch ? tmdbMatch[2] : null;

      // Ensure card has position relative for absolute positioning
      const computed = window.getComputedStyle(card);
      if (computed.position === 'static') {
        card.style.position = 'relative';
      }

      // Mark the card as "rating-resolution in progress" so a re-entrant
      // call (e.g. setTimeout 2s retry) doesn't queue a second
      // getRatings + DOM append for the same card.
      if (card.__seerrBadgesResolving) return;
      card.__seerrBadgesResolving = true;

      // Resolve ratings asynchronously
      if (tmdbId) {
        getRatings(tmdbId, title, null).then(bundle => {
          // Re-check: a cleanup could have removed any previously-rendered
          // badges since this promise was queued.
          if (card.__seerrBadgesCleared) {
            card.__seerrBadgesResolving = false;
            return;
          }
          if (!bundle || !Model.hasAnyScore(bundle)) {
            card.__seerrBadgesResolving = false;
            return;
          }

          if (bundle.rtCriticsScore !== null && bundle.confidence >= Config.confidenceThreshold) {
            const prefix = bundle.confidence < 1.0 && bundle.confidence >= Config.confidenceThreshold ? '~' : '';
            const badge = document.createElement('span');
            badge.className = 'seerr-card-badge';
            badge.setAttribute('data-seerr-overlay', 'true');
            badge.textContent = `🍅 ${prefix}${bundle.rtCriticsScore}%`;
            card.appendChild(badge);
          }
          if (bundle.rtAudienceScore !== null) {
            const audienceBadge = document.createElement('span');
            audienceBadge.className = 'seerr-card-badge seerr-card-audience-badge';
            audienceBadge.setAttribute('data-seerr-overlay', 'true');
            audienceBadge.textContent = `🍿 ${bundle.rtAudienceScore}%`;
            audienceBadge.style.top = '28px'; // stack below critics badge
            card.appendChild(audienceBadge);
          }
        }).catch(err => log('Card badge ratings failed:', err))
          .finally(() => { card.__seerrBadgesResolving = false; });
      } else {
        card.__seerrBadgesResolving = false;
      }
    });
  }

  function injectDetailRatings() {
    if (!FEATURE_FLAGS.detailRatingsRow && !FEATURE_FLAGS.preRequestSummary) return;

    const route = detectRoute();
    if (!route || (route.type !== 'movie-detail' && route.type !== 'tv-detail')) return;

    // Find the title/overview block near the request action
    const titleBlock = document.querySelector('[class*="title"], [class*="Title"], h1');
    if (!titleBlock) return;

    const container = titleBlock.closest('[class*="header"], [class*="Header"], [class*="detail"], [class*="Detail"]');
    if (!container) return;

    if (container.querySelector('[data-seerr-overlay="true"][class*="ratings-row"]')) return;

    // Extract TMDB ID from route
    const tmdbId = route.id;
    const title = document.querySelector('h1')?.textContent?.trim() || '';

    getRatings(tmdbId, title, null).then(bundle => {
      if (!bundle || !Model.hasAnyScore(bundle)) return;

      const row = document.createElement('div');
      row.className = 'seerr-ratings-row';
      row.setAttribute('data-seerr-overlay', 'true');

      let hasRowContent = false;

      if (FEATURE_FLAGS.detailRatingsRow) {
        if (bundle.rtCriticsScore !== null) {
          const prefix = bundle.confidence < Config.confidenceThreshold && bundle.confidence > 0 ? '~' : '';
          row.appendChild(makeRatingItem('🍅', `${prefix}${bundle.rtCriticsScore}%`, 'Tomatometer'));
          hasRowContent = true;
        }
        if (bundle.rtAudienceScore !== null) {
          row.appendChild(makeRatingItem('🍿', `${bundle.rtAudienceScore}%`, 'Audience'));
          hasRowContent = true;
        }
        if (bundle.imdbRating !== null) {
          row.appendChild(makeRatingItem('⭐', `${bundle.imdbRating}/10`, 'IMDb'));
          hasRowContent = true;
        }
        if (bundle.tmdbRating !== null) {
          row.appendChild(makeRatingItem('🎬', `${bundle.tmdbRating}/10`, 'TMDB'));
          hasRowContent = true;
        }
      }

      if (hasRowContent) {
        container.appendChild(row);
      }

      // Pre-request quality summary
      if (FEATURE_FLAGS.preRequestSummary) {
        const summary = buildSummary(bundle);
        if (summary) {
          const summaryEl = document.createElement('div');
          summaryEl.className = 'seerr-quality-summary';
          summaryEl.setAttribute('data-seerr-overlay', 'true');
          summaryEl.textContent = summary;
          container.appendChild(summaryEl);
        }
          }
        }).catch(err => log('Card badge ratings failed:', err)).finally(() => {
          card.__seerrBadgesResolving = false;
        });
      }

  function makeRatingItem(icon, value, label) {
    const item = document.createElement('span');
    item.className = 'seerr-rating-item';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const small = document.createElement('small');
    small.textContent = label;
    item.append(icon + ' ', strong, ' ', small);
    return item;
  }

  let injectionInProgress = false;

  function injectOverlay() {
    if (isAlreadyInjected()) return;
    if (injectionInProgress) return;
    injectionInProgress = true;

    try {
      const route = detectRoute();
      log(`Route detected: ${route ? route.type : 'unsupported'}`);

      if (!route) return;

      if (route.type === 'discover' || route.type === 'search') {
        injectCardBadges();
        setTimeout(() => injectCardBadges(), 2000); // retry for lazy-loaded cards
      } else if (route.type === 'movie-detail' || route.type === 'tv-detail') {
        injectDetailRatings();
      }
    } finally {
      injectionInProgress = false;
    }
  }

  // ──────────────── Sort & Filter ────────────────

  function countCardsWithRatings() {
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"]');
    if (cards.length === 0) return { total: 0, rated: 0 };
    let rated = 0;
    cards.forEach(c => { if (getCardScore(c) !== null) rated++; });
    return { total: cards.length, rated };
  }

  function injectSortFilterControls(retryCount = 0) {
    if (!FEATURE_FLAGS.sortFilter) return;

    const route = detectRoute();
    if (!route || (route.type !== 'discover' && route.type !== 'search')) return;

    if (document.querySelector('[data-seerr-overlay="true"][class*="sort-filter-bar"]')) return;

    const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"]');
    if (cards.length < 3) return;

    // Coverage check — need at least 30% of cards to have ratings
    const { total, rated } = countCardsWithRatings();
    if (rated / total < 0.3 && retryCount < 3) {
      // Ratings are still loading asynchronously — retry with increasing delays
      setTimeout(() => injectSortFilterControls(retryCount + 1), 1500 + retryCount * 1000);
      return;
    }
    if (rated === 0) return; // truly no ratings available after all retries

    const bar = document.createElement('div');
    bar.className = 'seerr-sort-filter-bar';
    bar.setAttribute('data-seerr-overlay', 'true');

    bar.innerHTML = `
      <span style="font-size:10px;opacity:0.5;margin-right:4px">🔌 Extension</span>
      <label>Sort</label>
      <select class="seerr-sort-select">
        <option value="default">Default</option>
        <option value="rt-critics-desc">🍅 Critics ↓</option>
        <option value="rt-critics-asc">🍅 Critics ↑</option>
        <option value="rt-audience-desc">🍿 Audience ↓</option>
        <option value="rt-audience-asc">🍿 Audience ↑</option>
      </select>
      <label>Critics ≥</label>
      <input type="number" class="seerr-min-critics" min="0" max="100" step="5" value="0" style="width:55px">
      <label>Audience ≥</label>
      <input type="number" class="seerr-min-audience" min="0" max="100" step="5" value="0" style="width:55px">
      <button class="seerr-reset-sort">Reset</button>
      ${FEATURE_FLAGS.bulkActions ? '<button class="seerr-toggle-select" data-seerr-overlay="true">Select titles</button>' : ''}
    `;

    const firstCard = cards[0];
    const grid = firstCard.parentElement;
    grid.insertBefore(bar, firstCard);

    // Wire toggle button immediately (BUG 5 fix)
    const toggleBtn = bar.querySelector('.seerr-toggle-select');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleBulkMode);
    }

    // ── Sort logic ──
    const sortSelect = bar.querySelector('.seerr-sort-select');
    sortSelect.addEventListener('change', () => {
      const val = sortSelect.value;
      const sorted = Array.from(cards).sort((a, b) => {
        let scoreA, scoreB;
        if (val.startsWith('rt-audience')) {
          scoreA = getCardAudienceScore(a);
          scoreB = getCardAudienceScore(b);
        } else {
          scoreA = getCardScore(a);
          scoreB = getCardScore(b);
        }
        // Unrated items go last (push to end with -1)
        const sa = scoreA ?? -Infinity;
        const sb = scoreB ?? -Infinity;
        if (sa === -Infinity && sb === -Infinity) return 0;
        if (sa === -Infinity) return 1;  // a unrated, push to end
        if (sb === -Infinity) return -1; // b unrated, push to end
        if (sa === sb) return (parseInt(a.getAttribute('data-seerr-card-index')) || 0) - (parseInt(b.getAttribute('data-seerr-card-index')) || 0);
        if (val.includes('desc')) return sb - sa;
        if (val.includes('asc')) return sa - sb;
        return 0;
      });
      sorted.forEach(c => grid.appendChild(c));
    });

    // ── Reset ──
    bar.querySelector('.seerr-reset-sort').addEventListener('click', () => {
      // Restore original order by re-appending in source order
      const allCards = Array.from(grid.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"]'));
      const ordered = allCards.sort((a, b) => {
        const idxA = parseInt(a.getAttribute('data-seerr-card-index') || '0');
        const idxB = parseInt(b.getAttribute('data-seerr-card-index') || '0');
        return idxA - idxB;
      });
      ordered.forEach(c => {
        c.style.display = '';
        grid.appendChild(c);
      });
      sortSelect.value = 'default';
      bar.querySelector('.seerr-min-critics').value = '0';
      bar.querySelector('.seerr-min-audience').value = '0';
    });

    // Store original index on each card
    Array.from(cards).forEach((c, i) => {
      c.setAttribute('data-seerr-card-index', String(i));
    });

    // ── Filter logic ──
    function applyFilters() {
      const minCritics = parseInt(bar.querySelector('.seerr-min-critics').value) || 0;
      const minAudience = parseInt(bar.querySelector('.seerr-min-audience').value) || 0;
      Array.from(grid.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"]')).forEach(c => {
        const cs = getCardScore(c);
        const as = getCardAudienceScore(c);
        const hidesForCritics = minCritics > 0 && (cs === null || cs < minCritics);
        const hidesForAudience = minAudience > 0 && (as === null || as < minAudience);
        c.style.display = (hidesForCritics || hidesForAudience) ? 'none' : '';
      });
    }

    bar.querySelector('.seerr-min-critics').addEventListener('input', applyFilters);
    bar.querySelector('.seerr-min-audience').addEventListener('input', applyFilters);
  }

  function getCardScore(card) {
    const badge = card.querySelector('.seerr-card-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🍅\s*~?(\d+)%/);
    return match ? parseInt(match[1]) : null;
  }

  function getCardAudienceScore(card) {
    const badge = card.querySelector('.seerr-card-audience-badge');
    if (!badge) return null;
    const match = badge.textContent.match(/🍿\s*~?(\d+)%/);
    return match ? parseInt(match[1]) : null;
  }

  // ──────────────── Bulk List Actions ────────────────

  let bulkMode = false;
  let selectedCards = new Set();

  function toggleBulkMode() {
    if (!FEATURE_FLAGS.bulkActions) return;

    bulkMode = !bulkMode;
    selectedCards.clear();

    const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"]');

    if (bulkMode) {
      cards.forEach(card => {
        if (card.querySelector('.seerr-select-checkbox')) return;

        const computed = window.getComputedStyle(card);
        if (computed.position === 'static') card.style.position = 'relative';

        const checkbox = document.createElement('div');
        checkbox.className = 'seerr-select-checkbox';
        checkbox.setAttribute('data-seerr-overlay', 'true');
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          const cardIdx = Array.from(cards).indexOf(card);
          if (selectedCards.has(cardIdx)) {
            selectedCards.delete(cardIdx);
            checkbox.classList.remove('checked');
          } else {
            selectedCards.add(cardIdx);
            checkbox.classList.add('checked');
          }
          updateBulkActionBar();
        });
        card.appendChild(checkbox);
      });

      showBulkActionBar();
      updateBulkActionBar();

      const toggleBtn = document.querySelector('.seerr-toggle-select');
      if (toggleBtn) toggleBtn.textContent = 'Cancel selection';
    } else {
      document.querySelectorAll('.seerr-select-checkbox').forEach(el => el.remove());
      hideBulkActionBar();

      const toggleBtn = document.querySelector('.seerr-toggle-select');
      if (toggleBtn) toggleBtn.textContent = 'Select titles';
    }
  }

  let bulkActionBar = null;

  function showBulkActionBar() {
    if (bulkActionBar) return;
    bulkActionBar = document.createElement('div');
    bulkActionBar.className = 'seerr-bulk-action-bar';
    bulkActionBar.setAttribute('data-seerr-overlay', 'true');
    bulkActionBar.innerHTML = `
      <span class="seerr-bulk-count">0 selected</span>
      <button class="seerr-bulk-review">Review & Request</button>
      <button class="seerr-bulk-cancel">Cancel</button>
    `;
    document.body.appendChild(bulkActionBar);

    bulkActionBar.querySelector('.seerr-bulk-review').addEventListener('click', openBulkConfirmation);
    bulkActionBar.querySelector('.seerr-bulk-cancel').addEventListener('click', toggleBulkMode);
  }

  function hideBulkActionBar() {
    if (bulkActionBar) { bulkActionBar.remove(); bulkActionBar = null; }
  }

  function updateBulkActionBar() {
    if (!bulkActionBar) return;
    const countEl = bulkActionBar.querySelector('.seerr-bulk-count');
    if (countEl) countEl.textContent = `${selectedCards.size} selected`;
  }

  function getSelectedTitles() {
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="media-item"]');
    const titles = [];
    selectedCards.forEach(idx => {
      const card = cards[idx];
      if (!card) return;
      const titleEl = card.querySelector('h2, h3, [class*="title"], [class*="Title"]');
      const title = titleEl?.textContent?.trim() || 'Unknown Title';
      const link = card.querySelector('a[href]');
      const href = link?.getAttribute('href') || '';
      const tmdbMatch = href.match(/\/(movie|tv)\/(\d+)/);
      const tmdbId = tmdbMatch ? tmdbMatch[2] : null;
      const mediaType = tmdbMatch ? tmdbMatch[1] : 'movie';
      const score = getCardScore(card);
      const confidence = score !== null ? 1.0 : 0.0;
      titles.push({ title, tmdbId, mediaType, score, confidence });
    });
    return titles;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function openBulkConfirmation() {
    if (selectedCards.size === 0) return;

    const titles = getSelectedTitles();
    // A title is only "ready" if it has BOTH a TMDB ID and a passing
    // confidence score — a high score alone is useless without an ID
    // because the API can't resolve the request.
    const readyTitles = titles.filter(t => t.tmdbId && t.confidence >= Config.confidenceThreshold);
    const excludedTitles = titles.filter(t => !t.tmdbId || t.confidence < Config.confidenceThreshold);

    const modal = document.createElement('div');
    modal.className = 'seerr-confirmation-modal';
    modal.setAttribute('data-seerr-overlay', 'true');
    modal.innerHTML = `
      <h3>Review your bulk request</h3>
      <div style="margin-bottom:12px">
        <strong style="color:#10b981">✅ ${readyTitles.length} titles ready to request</strong>
        ${excludedTitles.length > 0 ? `<br><strong style="color:#f59e0b">⚠️ ${excludedTitles.length} titles excluded</strong>` : ''}
      </div>
      <ul>
        ${readyTitles.map(t => `<li>• ${escapeHtml(t.title)}</li>`).join('')}
      </ul>
      ${excludedTitles.length > 0 ? `
        <details style="margin-bottom:12px;opacity:0.7">
          <summary>Excluded titles (${excludedTitles.length})</summary>
          <ul>
            ${excludedTitles.map(t => `<li class="excluded">• ${escapeHtml(t.title)}${!t.tmdbId ? ' (no TMDB ID)' : ` (~${Math.round(t.confidence * 100)}% conf.)`}</li>`).join('')}
          </ul>
        </details>
      ` : ''}
      <div class="modal-actions">
        <button class="cancel-btn">Cancel</button>
        <button class="confirm-btn">Request ${readyTitles.length} titles</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());

    modal.querySelector('.confirm-btn').addEventListener('click', async () => {
      const btn = modal.querySelector('.confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Requesting...';

      let succeeded = 0;
      let failed = 0;
      const BULK_REQUEST_DELAY_MS = 500;

      for (let i = 0; i < readyTitles.length; i++) {
        const t = readyTitles[i];
        btn.textContent = `Requesting ${i + 1}/${readyTitles.length}...`;
        const tmdbIdNum = parseInt(t.tmdbId, 10);
        if (!t.tmdbId || Number.isNaN(tmdbIdNum)) {
          failed++;
          continue;
        }
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'requestMedia',
            data: { title: t.title, mediaType: t.mediaType, tmdbId: tmdbIdNum }
          });
          if (response && response.success) {
            succeeded++;
          } else {
            failed++;
          }
        } catch (_) {
          failed++;
        }
        if (i < readyTitles.length - 1) {
          await new Promise(r => setTimeout(r, BULK_REQUEST_DELAY_MS));
        }
      }

      modal.remove();
      hideBulkActionBar();

      const summary = document.createElement('div');
      summary.className = 'seerr-notification success';
      summary.setAttribute('data-seerr-overlay', 'true');
      summary.innerHTML = `
        <div class="seerr-notification-title">Bulk Request Complete</div>
        <div class="seerr-notification-message">${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}</div>
      `;
      document.body.appendChild(summary);
      setTimeout(() => summary.remove(), 5000);

      bulkMode = false;
      selectedCards.clear();
      document.querySelectorAll('.seerr-select-checkbox').forEach(el => el.remove());
    });
  }

  // ──────────────── Bootstrap ────────────────

  // ──────────────── Debug ────────────────

  if (!window.seerr_debug) window.seerr_debug = {};
  window.seerr_debug.ratings = {
    enable:       () => { debugMode = true; console.log('🍅 [Seerr Overlay] Debug enabled'); },
    disable:      () => { debugMode = false; },
    cache:        () => ratingsCache,
    currentRoute: () => detectRoute(),
    clearCache:   () => ratingsCache.clear(),
    inject:       () => { cleanupOverlay(); injectOverlay(); },
    reInject:     () => { cleanupOverlay(); injectOverlay(); }
  };

  // ──────────────── Bootstrap ────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(injectOverlay, 500));
  } else {
    setTimeout(injectOverlay, 500);
  }

  // Retry for dynamic content
  setTimeout(() => {
    injectOverlay();
    injectSortFilterControls();
  }, 2000);
})();
