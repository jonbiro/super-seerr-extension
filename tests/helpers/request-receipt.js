// Canonical Seerr request/worker fixtures, using the MediaRequest fields
// returned by seerr-team/seerr's POST /api/v1/request (v3.5.1).
function receipt(data, overrides = {}) {
  const type = data.mediaType || 'movie';
  return { id: 7, type, status: 1, is4k: false,
    media: { tmdbId: data.mediaId ?? data.tmdbId, mediaType: type },
    ...(type === 'tv' ? { seasons: data.seasons.map(seasonNumber => ({ seasonNumber, status: 1 })) } : {}),
    ...overrides };
}
function result(data, overrides = {}) {
  const row = receipt(data);
  return { id: row.id, mediaType: row.type, status: row.status, tmdbId: row.media.tmdbId,
    ...(row.type === 'tv' ? { confirmedSeasons: data.seasons.slice() } : {}), ...overrides };
}
module.exports = { receipt, result };
