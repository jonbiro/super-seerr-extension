// Focused worker methods; composed onto SeerrAPI by background.js.
(function (root) {
  const RatingsConfig = root.RatingsConfig;
  root.RottenTomatoes = {
    // Titles are matched against Rotten Tomatoes by text, so what survives here
    // decides whether a score can be found. Restricting to a-z turned an accent
    // into a space, splitting the word it sat in, and reduced a title in any
    // non-Latin script to an empty string that could never match anything.
    normalizeTitleForMatch(title = '') {
      const normalized = String(title)
        .toLowerCase()
        .replace(/&amp;/g, '&')
        // Latin letters carrying no combining mark, so NFD leaves them alone.
        .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
        .replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ð/g, 'd').replace(/þ/g, 'th')
        // Fold Latin accents while preserving marks that distinguish other scripts.
        .normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC')
        .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
        .replace(/\b(the|a|an)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return /[\p{L}\p{N}]/u.test(normalized) ? normalized : '';
    },

    decodeHtml(text = '') {
      const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
      // Decode the source once: an escaped ampersand must not introduce a
      // second entity to decode. Numeric references can span all of Unicode.
      return String(text).replace(/&(amp|quot|apos|lt|gt|#(?:[xX][\da-fA-F]+|\d+));/g, (_, reference) => {
        if (reference[0] !== '#') return named[reference];
        const hex = /^#x/i.test(reference);
        const code = parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code) : '\uFFFD';
      });
    },

    parseRtSearchResults(html, mediaType) {
      const rows = [];
      const rowRe = /<search-page-media-row\b([\s\S]*?)<\/search-page-media-row>/gi;
      let match;

      while ((match = rowRe.exec(html))) {
        const row = match[0];
        const attrs = match[1] || '';
        const hrefMatch = row.match(/<a[^>]+data-qa="info-name"[^>]+href="([^"]+)"/i) ||
          row.match(/<a[^>]+href="([^"]+)"[^>]+data-qa="info-name"/i);
        const titleMatch = row.match(/<a[^>]+data-qa="info-name"[^>]*>([\s\S]*?)<\/a>/i);
        const yearMatch = attrs.match(/(?:release-year|start-year)="(\d{4})"/i);
        const criticsMatch = attrs.match(/tomatometer-score="(\d{1,3})"/i);

        if (!hrefMatch || !titleMatch) continue;

        const href = this.decodeHtml(hrefMatch[1]);
        const resultType = href.includes('/tv/') ? 'tv' : 'movie';
        if (mediaType && resultType !== mediaType) continue;

        rows.push({
          href,
          title: this.decodeHtml(titleMatch[1].replace(/<[^>]*>/g, '')).trim(),
          year: yearMatch ? parseInt(yearMatch[1], 10) : null,
          mediaType: resultType,
          rtCriticsScore: criticsMatch ? this.parseRtPercent(criticsMatch[1]) : null
        });
      }

      return rows;
    },

    scoreRtSearchResult(result, requested) {
      const requestedTitle = this.normalizeTitleForMatch(requested.title);
      const resultTitle = this.normalizeTitleForMatch(result.title);
      if (!requestedTitle || !resultTitle) return 0;

      let score;
      if (requestedTitle === resultTitle) {
        score = 0.8;
      } else if (requestedTitle.includes(resultTitle) || resultTitle.includes(requestedTitle)) {
        score = 0.6;
      } else {
        const requestedWords = new Set(requestedTitle.split(' ').filter(Boolean));
        const resultWords = new Set(resultTitle.split(' ').filter(Boolean));
        const overlap = [...requestedWords].filter(word => resultWords.has(word)).length;
        score = overlap / Math.max(requestedWords.size, resultWords.size) * 0.6;
      }

      // An exact title in the right year is as sure as this method gets, so it
      // reaches 1. While the ceiling was below 1 every score ever shown was
      // marked approximate, which told the reader nothing.
      // No year to check against. The title tiers above all sit below 1 by
      // design, so a match nothing corroborates can never come back certain.
      if (!requested.year || !result.year) return Math.max(0, score);

      const delta = Math.abs(requested.year - result.year);
      if (delta === 0) score += 0.2;
      else if (delta === 1) score += 0.1;
      else if (delta >= 3) score -= 0.3;

      return Math.max(0, Math.min(1, score));
    },

    // Equally strong candidates can match different localized/original titles.
    // Distinct provider entries remain ambiguous regardless of their spelling;
    // search ordering supplies no evidence for choosing between them.
    rtMatchIsAmbiguous(candidates, best) {
      const pageKey = href => {
        try { return new URL(href, 'https://www.rottentomatoes.com').href; }
        catch (_) { return href; }
      };
      const bestPage = pageKey(best.href);
      return candidates.some(candidate =>
        candidate !== best && pageKey(candidate.href) !== bestPage &&
        candidate.confidence >= best.confidence);
    },

    parseRtScorecard(html) {
      const scriptMatch = html.match(/<script\b[^>]*\sid\s*=\s*(["'])media-scorecard-json\1[^>]*>([\s\S]*?)<\/script\s*>/i);
      if (!scriptMatch) throw new Error('Rotten Tomatoes scorecard is missing');

      // An unreadable scorecard is a failed detail read, not proof that the
      // title has no ratings. Let the resolver apply its short retry window
      // and retain any successful fallback instead of sharing this attempt.
      const data = JSON.parse(scriptMatch[2].trim());
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Rotten Tomatoes scorecard is not an object');
      }
      return {
        rtCriticsScore: this.parseRtPercent(data.criticsScore?.score),
        rtAudienceScore: this.parseRtPercent(data.audienceScore?.score)
      };
    },

    parseRtPercent(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      if (typeof value === 'string') {
        const text = value.trim().replace(/%$/, '').trim();
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
        value = Number(text);
      }
      const score = value;
      return Number.isFinite(score) && score >= 0 && score <= 100 ? Math.round(score) : null;
    },

    // At most rtMaxConcurrent page fetches are in flight at once; the rest wait
    // their turn rather than arriving together.
    async withRtSlot(run) {
      while (this.rtInFlight >= RatingsConfig.rtMaxConcurrent) {
        await new Promise(resolve => this.rtWaiting.push(resolve));
      }
      this.rtInFlight++;
      try {
        return await run();
      } finally {
        this.rtInFlight--;
        this.rtWaiting.shift()?.();
      }
    },

    async fetchRtHtml(url) {
      const target = new URL(url, 'https://www.rottentomatoes.com');
      if (target.origin !== 'https://www.rottentomatoes.com' || target.username || target.password) {
        throw new Error('Rotten Tomatoes URL is outside the allowed origin');
      }
      return this.withRtSlot(async () => {
        const response = await fetch(target.href, {
          redirect: 'error',
          signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
          credentials: 'omit',
          headers: {
            Accept: 'text/html,application/xhtml+xml'
          }
        });
        if (!response.ok) {
          // The unread body may still be downloading after headers arrive.
          // Stop it before freeing this slot; cancellation must not mask HTTP errors.
          try { await response.body?.cancel(); } catch (_) { /* Preserve the refusal below. */ }
          // Keep the refused page in the error so search and detail failures
          // can be distinguished without logging page contents.
          throw new Error(`Rotten Tomatoes returned HTTP ${response.status} for ${target.pathname}${target.search}`);
        }
        // fetch resolves at headers; the slot must also cover the body read.
        return response.text();
      });
    },

    rtTitleCacheKey(data) {
      const title = typeof data?.title === 'string' ? data.title.trim() : '';
      const original = typeof data?.originalTitle === 'string' ? data.originalTitle.trim() : '';
      // Escape field delimiters as well as literal escapes. Otherwise a title
      // containing ':original:' can address a different title/year tuple.
      const part = value => String(value).replace(/%/g, '%25').replace(/:/g, '%3A');
      return `${part(data.mediaType || 'movie')}:${part(title)}:${part(data.year || '')}${original && original !== title ? `:original:${part(original)}` : ''}`;
    },

    async getRottenTomatoesRatings(data) {
      const title = typeof data?.title === 'string' ? data.title.trim() : '';
      if (!title) return null;
      const refresh = data?.refresh === true;
      const originalTitle = typeof data?.originalTitle === 'string' ? data.originalTitle.trim() : null;
      const normalized = { ...data, title, originalTitle, mediaType: data.mediaType || 'movie', refresh,
        // A default lookup type is not verified identity for cross-site reuse.
        tmdbId: this.publicRatingKey(data) ? data.tmdbId : null };
      // A refresh coalesces with other refreshes but must not join an ordinary
      // lookup already in flight, which would hand back the stale value.
      const key = JSON.stringify([refresh, this.rtTitleCacheKey(normalized), this.publicRatingKey(normalized)]);
      if (this.rtPending.has(key)) return this.rtPending.get(key);
      const pending = this.resolveRottenTomatoesRatings(normalized);
      this.rtPending.set(key, pending);
      try { return await pending; }
      finally { if (this.rtPending.get(key) === pending) this.rtPending.delete(key); }
    },

    // The queries worth trying, in order. Rotten Tomatoes lists most films under
    // their English title, so where Seerr gives a localised one the original is
    // the way back. Deduped by the same normalisation used for matching, so a
    // title identical to its original is only searched once.
    rtQueryTitles(title, originalTitle) {
      const queries = [];
      for (const candidate of [title, originalTitle]) {
        const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
        if (!trimmed) continue;
        const normalized = this.normalizeTitleForMatch(trimmed);
        if (!normalized) continue;
        if (queries.some(existing => this.normalizeTitleForMatch(existing) === normalized)) continue;
        queries.push(trimmed);
      }
      return queries;
    },

    // The best candidate for one query, or null when there is none worth having.
    // Candidates are scored against every title we know the film by, not against
    // the query: searching a localised title returns the film under its English
    // one, and judging that result by the query would reject the right answer.
    async rtBestMatchFor(query, titles, year, mediaType, outcome = {}) {
      const searchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`;
      const candidates = this.parseRtSearchResults(await this.fetchRtHtml(searchUrl), mediaType)
        .map(result => ({
          ...result,
          confidence: Math.max(...titles.map(title => this.scoreRtSearchResult(result, { title, year })))
        }))
        .sort((a, b) => b.confidence - a.confidence);

      const best = candidates[0];
      if (!best) return null;
      // Several films can share a title exactly. Even an identical release year can leave
      // a tie; taking whichever Rotten Tomatoes ranked first is a guess, and a
      // wrong score presented as fact is worse than none. Another query may
      // still be unambiguous.
      if (this.rtMatchIsAmbiguous(candidates, best)) {
        outcome.uncertain = true;
        this.log(`Rotten Tomatoes has equally strong matches for "${query}"; not guessing`);
        return null;
      }
      if (best.confidence < RatingsConfig.confidenceThreshold) outcome.uncertain = true;
      return best.confidence >= RatingsConfig.confidenceThreshold ? best : null;
    },

    async resolveRottenTomatoesRatings({ title, originalTitle = null, year = null, mediaType = 'movie', refresh = false, tmdbId = null }) {
      if (!title) return null;

      if (this.cacheClearPending) await this.cacheClearPending;
      const generation = this.rtCacheGeneration;
      await this.loadRtCache();

      const identity = { title, originalTitle, year, mediaType, tmdbId };
      const shared = !refresh && this.cachedPublicRating(identity);
      if (shared) return { ...shared.value, lastUpdated: shared.checkedAt, diagnostic: 'rated' };
      const cacheKey = this.rtTitleCacheKey(identity);
      // Bypass the cached value for a refresh, but keep it available to other
      // tabs until a completed lookup replaces it. A transport failure says
      // nothing about the last unexpired score or its original expiry.
      const cached = !refresh && this.rtCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        this.sharePublicRating(identity, cached.value, cached, generation);
        return cached.value ? { ...cached.value, lastUpdated: cached.checkedAt, diagnostic: cached.diagnostic } : null;
      }
      const checkedAt = this.rtLookupClock = Math.max(Date.now(), this.rtLookupClock + 1);

      // Bound the worker cache during long browsing sessions. Insertion enforces
      // the hard limit; this only clears entries that have already expired.
      for (const [key, entry] of this.rtCache) if (Date.now() >= entry.expiresAt) this.rtCache.delete(key);
      const queries = this.rtQueryTitles(title, originalTitle);
      // Refusing to ask is still a failure to answer, so this throws rather
      // than returning null: a null would be cached as "this title is unrated".
      if (Date.now() < this.rtBackoffUntil) {
        throw new Error('Rotten Tomatoes refused recent requests; not asking again yet');
      }
      let best = null;
      const outcome = {};
      try {
        for (const query of queries) {
          best = await this.rtBestMatchFor(query, queries, year, mediaType, outcome);
          if (best) break;
        }
        this.rtTransportFailures = 0;
        this.rtBackoffUntil = 0;
      } catch (error) {
        this.rtTransportFailures++;
        if (this.rtTransportFailures >= RatingsConfig.rtFailureLimit) {
          this.rtBackoffUntil = Date.now() + RatingsConfig.rtBackoffMs;
          console.warn(`Rotten Tomatoes has refused ${this.rtTransportFailures} requests; pausing lookups`);
        }
        throw error;
      }

      if (!best) {
        const empty = null;
        this.cacheRottenTomatoesResult(cacheKey, empty, RatingsConfig.rtNegativeCacheTtlMs, generation, outcome.uncertain ? 'uncertain' : 'unrated', checkedAt);
        return empty;
      }

      let detailScores = {};
      try {
        detailScores = this.parseRtScorecard(await this.fetchRtHtml(best.href));
      } catch (error) {
        outcome.failed = true;
        this.warn('Could not read Rotten Tomatoes detail page:', error);
      }

      const result = {
        rtCriticsScore: detailScores.rtCriticsScore ?? best.rtCriticsScore ?? null,
        rtAudienceScore: detailScores.rtAudienceScore ?? null,
        confidence: best.confidence,
        source: 'rotten-tomatoes',
        url: best.href,
        matchedTitle: best.title,
        matchedYear: best.year,
        lastUpdated: checkedAt,
        diagnostic: outcome.failed ? 'failed' : 'rated'
      };

      const ttl = result.rtCriticsScore === null && result.rtAudienceScore === null
        ? RatingsConfig.rtNegativeCacheTtlMs : RatingsConfig.rtCacheTtlMs;
      // A partial transport failure must not replace an unexpired successful
      // result used by other tabs. Report this attempt to its caller, while
      // retaining the fallback's original timestamp and expiry.
      const previous = this.rtCache.get(cacheKey);
      const keepSuccessful = outcome.failed && previous?.diagnostic === 'rated'
        && previous.expiresAt > Date.now()
        && previous.value?.confidence >= RatingsConfig.confidenceThreshold
        && ['rtCriticsScore', 'rtAudienceScore'].some(field =>
          Number.isFinite(previous.value[field]) && previous.value[field] >= 0 && previous.value[field] <= 100);
      if (!keepSuccessful) this.cacheRottenTomatoesResult(cacheKey, result, outcome.failed ? RatingsConfig.inconclusiveRetryMs : ttl, generation, outcome.failed ? 'failed' : 'rated', checkedAt);
      this.sharePublicRating(identity, result, this.rtCache.get(cacheKey), generation);
      return result;
    },
  };
})(globalThis);
