// Shared boundary validation. Do not silently truncate or coerce missing IDs.
(function (root) {
  const MediaValidation = {
    tmdbId(value) {
      if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) {
        throw new Error('A positive integer TMDB id is required');
      }
      const id = Number(value);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('A positive integer TMDB id is required');
      return id;
    },
    mediaType(value) {
      if (value !== 'movie' && value !== 'tv') throw new Error('Media type must be movie or tv');
      return value;
    },
    releaseYear(value) {
      if (value == null) return null;
      if ((typeof value !== 'number' && typeof value !== 'string') ||
          !/^\d{4}$/.test(String(value)) || Number(value) < 1800) {
        throw new Error('A valid release year is required');
      }
      return Number(value);
    },
    seerrTitleUrl(server, mediaType, tmdbId) {
      const url = new URL(server);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('Use a Seerr URL without credentials, query parameters, or fragments');
      }
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/${this.mediaType(mediaType)}/${this.tmdbId(tmdbId)}`;
      return url.href;
    },
    requestReceipt(response, requested) {
      if (response?.message === 'No seasons available to request') {
        throw new Error('Seerr did not confirm a new request: the selected seasons are already requested or unavailable. Review this title in Seerr.');
      }
      const invalid = () => { throw new Error('Seerr did not return a valid request confirmation. Check Seerr before requesting again; the request may already exist.'); };
      let id, tmdbId, status;
      try {
        if (!response || typeof response !== 'object' || Array.isArray(response) ||
            !response.media || typeof response.media !== 'object' || Array.isArray(response.media)) invalid();
        id = this.tmdbId(response.id);
        tmdbId = this.tmdbId(response.media.tmdbId);
        status = this.tmdbId(response.status);
      } catch (_) { invalid(); }
      if (response.type !== requested.mediaType || tmdbId !== requested.mediaId || ![1, 2, 3, 4, 5].includes(status) ||
          (response.is4k !== undefined && response.is4k !== false) ||
          (response.media.mediaType !== undefined && response.media.mediaType !== requested.mediaType)) invalid();
      const result = { id, tmdbId, mediaType: requested.mediaType, status };
      if (requested.mediaType === 'tv') {
        if (!Array.isArray(response.seasons) || !response.seasons.length || response.seasons.length > 500) invalid();
        const selected = new Set(requested.seasons);
        const confirmed = new Set();
        for (const season of response.seasons) {
          if (!season || !Number.isSafeInteger(season.seasonNumber) || season.seasonNumber < 0 || !selected.has(season.seasonNumber)) invalid();
          confirmed.add(season.seasonNumber);
        }
        result.confirmedSeasons = [...confirmed].sort((a, b) => a - b);
      }
      return this.requestResult(result, requested);
    },
    requestResult(result, requested) {
      const invalid = () => { throw new Error('Request confirmation unavailable. Check Seerr before requesting again.'); };
      if (!result || typeof result !== 'object' || Array.isArray(result) ||
          !Number.isSafeInteger(result.id) || result.id <= 0 || !Number.isSafeInteger(result.tmdbId) || result.tmdbId <= 0 ||
          !['movie', 'tv'].includes(result.mediaType) || (requested.mediaType && result.mediaType !== requested.mediaType) ||
          ![1, 2, 3, 4, 5].includes(result.status)) {
        invalid();
      }
      const normalized = { ...result };
      delete normalized.notice;
      const notices = [];
      if (result.mediaType === 'tv') {
        const validSeasons = seasons => Array.isArray(seasons) && seasons.length > 0 && seasons.length <= 500 &&
          seasons.every(number => Number.isSafeInteger(number) && number >= 0);
        if (!validSeasons(requested.seasons) || !validSeasons(result.confirmedSeasons)) invalid();
        const selected = new Set(requested.seasons);
        const confirmed = new Set(result.confirmedSeasons);
        if ([...confirmed].some(number => !selected.has(number))) invalid();
        normalized.confirmedSeasons = [...confirmed].sort((a, b) => a - b);
        if (confirmed.size !== selected.size) notices.push(`Seerr confirmed only these seasons: ${normalized.confirmedSeasons.map(number => number === 0 ? 'Specials' : number).join(', ')}. Other selected seasons were not included. Review the request in Seerr.`);
      }
      if (result.status === 3) notices.push('Seerr created the request, but it is declined. Review the request in Seerr.');
      if (result.status === 4) notices.push('The request was created but failed in Seerr. Review it there before trying again.');
      if (result.status === 5) notices.push('Seerr reports this request as completed. Review its availability in Seerr.');
      if (notices.length) normalized.notice = notices.join(' ');
      return normalized;
    },
    media(data, { requireId = false } = {}) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Media data is required');
      const mediaType = this.mediaType(data.mediaType);
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const tmdbId = data.tmdbId == null && !requireId ? undefined : this.tmdbId(data.tmdbId);
      if (tmdbId === undefined && !title) throw new Error('A title or TMDB id is required');
      return { ...data, title, mediaType, tmdbId, year: this.releaseYear(data.year) };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MediaValidation;
  else root.MediaValidation = MediaValidation;
})(typeof window !== 'undefined' ? window : globalThis);
