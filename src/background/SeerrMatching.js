// Focused worker methods; composed onto SeerrAPI by background.js.
(function (root) {
  root.SeerrMatching = {
    generateSearchTerms(originalTitle) {
      this.log('🔍 [Background] generateSearchTerms called with:', originalTitle);
      const terms = [originalTitle];

      // Digit/word swaps target standalone numerals such as "Toy Story 2".
      // Without the word boundaries these rewrote digits inside numbers, turning
      // "Blade Runner 2049" into "Blade Runner Two0Four9" — a wasted request that
      // could also fuzzy-match the wrong title.
      const numberWords = [['2', 'Two'], ['3', 'Three'], ['4', 'Four']];
      const variations = [
        originalTitle.replace(/Se7en/gi, 'Seven'),
        originalTitle.replace(/Seven/gi, 'Se7en'),
        ...numberWords.flatMap(([digit, word]) => [
          originalTitle.replace(new RegExp(`\\b${digit}\\b`, 'g'), word),
          originalTitle.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit)
        ]),
        originalTitle.replace(/[^a-zA-Z0-9\s]/g, ''),
        originalTitle.replace(/^(The|A|An)\s+/i, ''),
        originalTitle.split(':')[0].trim(),
        originalTitle.split(' - ')[0].trim(),
        originalTitle.split(' –')[0].trim(),
        originalTitle.replace(/\s*\(\d{4}\)\s*$/, ''),
        originalTitle.replace(/'/g, "'"),
        originalTitle.replace(/′/g, "'"),  // prime → straight quote (TMDb specific)
        originalTitle.replace(/\s+for\s+/gi, ' '),
        originalTitle.replace(/\s+(for|of|the|and|in|on|at|to)\s+/gi, ' ').replace(/\s+/g, ' ').trim()
      ];

      this.log('🔍 [Background] Initial variations generated:', variations.length);

      variations.forEach((variation, index) => {
        const cleaned = variation.trim();
        this.log(`🔍 [Background] Variation ${index}: "${variation}" -> cleaned: "${cleaned}"`);
        if (cleaned && cleaned !== originalTitle && !terms.includes(cleaned)) {
          terms.push(cleaned);
          this.log('🔍 [Background] Added variation:', cleaned);
        }
      });

      this.log('🔍 [Background] Final search terms:', terms);
      return terms;
    },

    async matchingMediaChoices(mediaData) {
      for (const query of this.generateSearchTerms(mediaData.title)) {
        const results = await this.searchMedia(query, mediaData.mediaType);
        // A query variant is only a discovery aid, not a different identity.
        const candidates = this.matchingCandidates(results, mediaData);
        this.log('Seerr title match:', { query, candidates: candidates.length });
        // Once ambiguity is known, a later query must not hide one contender.
        if (candidates.length) return candidates;
      }
      return [];
    },

    async resolveMediaMatch(mediaData) {
      const candidates = await this.matchingMediaChoices(mediaData);
      return candidates.length === 1 ? candidates[0] : null;
    },

    async getMediaCandidates(data) {
      const media = root.MediaValidation.media(data);
      const candidates = await this.matchingMediaChoices(media);
      return candidates.filter(candidate => Number.isSafeInteger(Number(candidate.id)) && Number(candidate.id) > 0)
        .slice(0, 20).map(candidate => ({
          tmdbId: Number(candidate.id), mediaType: media.mediaType,
          title: String(candidate.title || candidate.name || media.title).slice(0, 300),
          year: this.extractYear(candidate.releaseDate || candidate.firstAirDate),
          overview: typeof candidate.overview === 'string' ? candidate.overview.slice(0, 500) : ''
        }));
    },

    findBestMatch(searchResults, mediaData) {
      const candidates = this.matchingCandidates(searchResults, mediaData);
      return candidates.length === 1 ? candidates[0] : null;
    },

    matchingCandidates(searchResults, mediaData) {
      // Writes demand stronger evidence than a ratings badge. Never fall back
      // to search ordering, year alone, a substring, or another media type.
      const candidates = (searchResults || []).filter(result => {
        if (!result || result.mediaType !== mediaData.mediaType) return false;
        try { root.MediaValidation.tmdbId(result.id); } catch (_) { return false; }
        const titles = [result.title, result.originalTitle, result.name, result.originalName].filter(Boolean);
        if (!titles.some(title => this.areTitlesSimilar(title, mediaData.title))) return false;
        if (mediaData.year) {
          const year = this.extractYear(result.releaseDate || result.firstAirDate);
          if (!year || Math.abs(year - mediaData.year) > 1) return false;
        }
        return true;
      });
      return [...new Map(candidates.map(candidate => [String(candidate.id), candidate])).values()];
    },

    areTitlesSimilar(title1, title2) {
      const normalize = title => String(title).toLowerCase().normalize('NFKD')
        .replace(/\p{M}/gu, '').replace(/\bse7en\b/g, 'seven')
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const left = normalize(title1), right = normalize(title2);
      return !!left && left === right;
    },

    extractYear(dateString) {
      if (typeof dateString !== 'string' || !dateString) return null;
      const year = parseInt(dateString.substring(0, 4));
      return isNaN(year) ? null : year;
    },

    // A page-supplied TMDB id is trusted only while nothing contradicts it.
    // External pages resolve the id from whichever link comes first, which is
    // occasionally another title's. Distrust needs positive evidence: an
    // unrelated title with a different year. A translated title keeps its
    // year, so this never punishes localisation, and an id Seerr cannot look
    // up stays trusted — Seerr itself judges the write.
    async tmdbIdentityMatches(mediaData) {
      if (!mediaData || !mediaData.title || !mediaData.tmdbId) return true;
      let details;
      try {
        const endpoint = mediaData.mediaType === 'tv'
          ? `/api/v1/tv/${mediaData.tmdbId}`
          : `/api/v1/movie/${mediaData.tmdbId}`;
        details = await this.makeAPIRequest('GET', endpoint);
      } catch (_) {
        return true;
      }
      if (!details || typeof details !== 'object') return true;
      const known = [details.title, details.originalTitle, details.name, details.originalName]
        .filter(title => typeof title === 'string' && title.trim());
      if (known.some(title => this.areTitlesSimilar(title, mediaData.title))) return true;
      const detailYear = parseInt(String(details.releaseDate || details.firstAirDate || '').slice(0, 4), 10);
      if (!mediaData.year || !Number.isFinite(detailYear) || Math.abs(detailYear - mediaData.year) <= 1) return true;
      this.log('TMDB id names a different title; resolving by search instead:', {
        provided: mediaData.tmdbId, detailTitle: known[0], detailYear
      });
      return false;
    },
  };
})(globalThis);
