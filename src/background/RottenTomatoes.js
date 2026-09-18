// Focused worker methods; composed onto SeerrAPI by background.js.
(function (root) {
  const RatingsConfig = root.RatingsConfig;
  root.RottenTomatoes = {
    // Titles are matched against Rotten Tomatoes by text, so what survives here
    // decides whether a score can be found. Restricting to a-z turned an accent
    // into a space, splitting the word it sat in, and reduced a title in any
    // non-Latin script to an empty string that could never match anything.
    normalizeTitleForMatch(title = '') {
      return String(title)
        .toLowerCase()
        .replace(/&amp;/g, '&')
        // Latin letters carrying no combining mark, so NFD leaves them alone.
        .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
        .replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ð/g, 'd').replace(/þ/g, 'th')
        // Split the rest into base letter plus mark, then drop the marks.
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        // Keep letters of any script rather than only a-z.
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\b(the|a|an)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    decodeHtml(text = '') {
      return String(text)
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
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

    // Whether another candidate is as good a match as the best one, which means
    // the choice between them rests on Rotten Tomatoes' own ordering.
    rtMatchIsAmbiguous(candidates, best) {
      return candidates.some(candidate =>
        candidate !== best &&
        candidate.confidence >= best.confidence &&
        this.normalizeTitleForMatch(candidate.title) === this.normalizeTitleForMatch(best.title));
    },

    parseRtScorecard(html) {
      const scriptMatch = html.match(/<script[^>]+id="media-scorecard-json"[^>]*>([\s\S]*?)<\/script>/i);
      if (!scriptMatch) return {};

      try {
        const data = JSON.parse(scriptMatch[1].trim());
        return {
          rtCriticsScore: this.parseRtPercent(data.criticsScore?.score),
          rtAudienceScore: this.parseRtPercent(data.audienceScore?.score)
        };
      } catch (error) {
        this.warn('Could not parse Rotten Tomatoes scorecard:', error);
        return {};
      }
    },

    parseRtPercent(value) {
      if (value === null || value === undefined || String(value).trim() === '') return null;
      const score = Number(String(value).replace(/%$/, ''));
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
      const response = await this.withRtSlot(() => fetch(target.href, {
        redirect: 'error',
        signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
        credentials: 'omit',
        headers: {
          Accept: 'text/html,application/xhtml+xml'
        }
      }));
      if (!response.ok) {
        // Which page was refused decides what to do about it: the search page
        // and a title's own page are protected differently, and without the
        // path every refusal reads the same in the error log.
        throw new Error(`Rotten Tomatoes returned HTTP ${response.status} for ${target.pathname}${target.search}`);
      }
      return response.text();
    },

    async getRottenTomatoesRatings(data) {
      const title = typeof data?.title === 'string' ? data.title.trim() : '';
      if (!title) return null;
      const refresh = data?.refresh === true;
      const originalTitle = typeof data?.originalTitle === 'string' ? data.originalTitle.trim() : null;
      const normalized = { ...data, title, originalTitle, mediaType: data.mediaType || 'movie', refresh };
      // A refresh coalesces with other refreshes but must not join an ordinary
      // lookup already in flight, which would hand back the stale value.
      const key = `${refresh ? 'refresh:' : ''}${normalized.mediaType}:${title}:${normalized.year || ''}`;
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
    async rtBestMatchFor(query, titles, year, mediaType) {
      const searchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`;
      const candidates = this.parseRtSearchResults(await this.fetchRtHtml(searchUrl), mediaType)
        .map(result => ({
          ...result,
          confidence: Math.max(...titles.map(title => this.scoreRtSearchResult(result, { title, year })))
        }))
        .sort((a, b) => b.confidence - a.confidence);

      const best = candidates[0];
      if (!best) return null;
      // Several films can share a title exactly. With no year to choose between
      // them, taking whichever Rotten Tomatoes ranked first is a guess, and a
      // wrong score presented as fact is worse than none. Another query may
      // still be unambiguous.
      if (!year && this.rtMatchIsAmbiguous(candidates, best)) {
        this.log(`Rotten Tomatoes has more than one "${best.title}" and no year was known; not guessing`);
        return null;
      }
      return best.confidence >= RatingsConfig.confidenceThreshold ? best : null;
    },

    async resolveRottenTomatoesRatings({ title, originalTitle = null, year = null, mediaType = 'movie', refresh = false }) {
      if (!title) return null;

      if (this.cacheClearPending) await this.cacheClearPending;
      const generation = this.rtCacheGeneration;
      await this.loadRtCache();

      const cacheKey = `${mediaType}:${title}:${year || ''}`;
      // Scores move as reviews arrive, so a refresh discards what we hold and
      // refetches; the new value then becomes the cached one.
      if (refresh) this.rtCache.delete(cacheKey);
      const cached = this.rtCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) return cached.value;

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
      try {
        for (const query of queries) {
          best = await this.rtBestMatchFor(query, queries, year, mediaType);
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
        this.cacheRottenTomatoesResult(cacheKey, empty, RatingsConfig.rtNegativeCacheTtlMs, generation);
        return empty;
      }

      let detailScores = {};
      try {
        detailScores = this.parseRtScorecard(await this.fetchRtHtml(best.href));
      } catch (error) {
        this.warn('Could not fetch Rotten Tomatoes detail page:', error);
      }

      const result = {
        rtCriticsScore: detailScores.rtCriticsScore ?? best.rtCriticsScore ?? null,
        rtAudienceScore: detailScores.rtAudienceScore ?? null,
        confidence: best.confidence,
        source: 'rotten-tomatoes',
        url: best.href,
        matchedTitle: best.title,
        matchedYear: best.year
      };

      const ttl = result.rtCriticsScore === null && result.rtAudienceScore === null
        ? RatingsConfig.rtNegativeCacheTtlMs : RatingsConfig.rtCacheTtlMs;
      this.cacheRottenTomatoesResult(cacheKey, result, ttl, generation);
      return result;
    },
  };
})(globalThis);
