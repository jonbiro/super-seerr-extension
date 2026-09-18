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
    media(data, { requireId = false } = {}) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Media data is required');
      const mediaType = this.mediaType(data.mediaType);
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      const tmdbId = data.tmdbId == null && !requireId ? undefined : this.tmdbId(data.tmdbId);
      if (tmdbId === undefined && !title) throw new Error('A title or TMDB id is required');
      if (data.year != null && (!/^\d{4}$/.test(String(data.year)) || Number(data.year) < 1800)) {
        throw new Error('A valid release year is required');
      }
      return { ...data, title, mediaType, tmdbId, year: data.year == null ? null : Number(data.year) };
    }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MediaValidation;
  else root.MediaValidation = MediaValidation;
})(globalThis);
