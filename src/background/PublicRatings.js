// Only independently verified public-provider scores belong in this shared tier.
// Seerr-native/session bundles and catalogue indexes never enter it.
(function (root) {
  const Config = root.RatingsConfig;
  // TMDB IDs can arrive from page JSON as either numbers or digit strings.
  // Treat equivalent representations (including harmless leading zeroes) as
  // one identity so a shared score is not stranded under a different key.
  function canonicalTmdbId(value) {
    const text = String(value);
    if (!/^\d+$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  }

  root.PublicRatings = {
    publicRatingKey(data) {
      if (!data || (data.mediaType !== 'movie' && data.mediaType !== 'tv') ||
          (typeof data.tmdbId !== 'number' && typeof data.tmdbId !== 'string')) return null;
      const id = canonicalTmdbId(data.tmdbId);
      return id ? `${data.mediaType}:${id}` : null;
    },
    sanitizePublicRating(entry, mediaType = null) {
      if (!entry || entry.source !== 'rotten-tomatoes' || entry.value?.source !== 'rotten-tomatoes' ||
          entry.value.confidence !== 1 || !Number.isFinite(entry.checkedAt) || entry.checkedAt <= 0 ||
          entry.checkedAt > Date.now() + 60000 || !Number.isFinite(entry.expiresAt) ||
          entry.expiresAt <= Date.now() || entry.expiresAt > entry.checkedAt + Config.rtCacheTtlMs ||
          !Number.isInteger(entry.value.matchedYear) || entry.value.matchedYear < 1800 || entry.value.matchedYear > 9999 ||
          typeof entry.value.matchedTitle !== 'string' || !entry.value.matchedTitle.trim()) return null;
      let url;
      try {
        url = new URL(entry.value.url, 'https://www.rottentomatoes.com');
        if (url.origin !== 'https://www.rottentomatoes.com' || url.username || url.password ||
            url.href.length > 1000 || url.search || url.hash || !/^\/(m|tv)\/[^/]+\/?$/.test(url.pathname)) return null;
      } catch (_) { return null; }
      if (mediaType && !url.pathname.startsWith(mediaType === 'tv' ? '/tv/' : '/m/')) return null;
      const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
      const critics = percent(entry.value.rtCriticsScore), audience = percent(entry.value.rtAudienceScore);
      if (critics === null && audience === null) return null;
      return { source: 'rotten-tomatoes', checkedAt: entry.checkedAt, expiresAt: entry.expiresAt,
        value: { rtCriticsScore: critics, rtAudienceScore: audience, confidence: 1, source: 'rotten-tomatoes',
          url: url.href, matchedTitle: entry.value.matchedTitle.slice(0, 300), matchedYear: entry.value.matchedYear } };
    },
    cachedPublicRating(data) {
      const key = this.publicRatingKey(data);
      const entry = key && this.sanitizePublicRating(this.publicRatings.get(key));
      if (!entry || (data.year && Number(data.year) !== entry.value.matchedYear) ||
          !new URL(entry.value.url).pathname.startsWith(data.mediaType === 'tv' ? '/tv/' : '/m/')) return null;
      return entry;
    },
    sharePublicRating(data, result, cached, generation) {
      const key = this.publicRatingKey(data);
      // Displayable approximate matches stay in the title cache. Sharing by ID
      // requires an exact title (or original title), year and provider match.
      if (!key || generation !== this.rtCacheGeneration || cached?.diagnostic !== 'rated' || cached.value !== result ||
          !data.year || Number(data.year) !== result?.matchedYear ||
          !this.rtQueryTitles(data.title, data.originalTitle).some(title =>
            this.normalizeTitleForMatch(title) === this.normalizeTitleForMatch(result.matchedTitle))) return;
      const entry = this.sanitizePublicRating({ source: 'rotten-tomatoes', value: result,
        checkedAt: cached.checkedAt ?? cached.expiresAt - Config.rtCacheTtlMs, expiresAt: cached.expiresAt });
      if (!entry || !new URL(entry.value.url).pathname.startsWith(data.mediaType === 'tv' ? '/tv/' : '/m/')) return;
      if ((this.publicRatings.get(key)?.checkedAt ?? 0) > entry.checkedAt) return;
      this.publicRatings.delete(key);
      while (this.publicRatings.size >= Config.rtCacheMaxEntries) this.publicRatings.delete(this.publicRatings.keys().next().value);
      this.publicRatings.set(key, entry);
      this.scheduleRtCacheFlush();
    },
    publicRatingsPayload() {
      const entries = {};
      let remaining = 1_000_000;
      for (const [key, value] of [...this.publicRatings].sort((a, b) => b[1].checkedAt - a[1].checkedAt)) {
        const clean = this.sanitizePublicRating(value, key.split(':')[0]);
        if (!clean) continue;
        const size = new TextEncoder().encode(JSON.stringify({ [key]: clean })).length;
        if (size > remaining) continue;
        entries[key] = clean; remaining -= size;
      }
      return { matcher: Config.matcherVersion, entries };
    }
  };
})(globalThis);
