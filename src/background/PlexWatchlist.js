// Plex Watchlist integration; composed onto SeerrAPI by background.js.
// Seerr's own /api/v1/watchlist is Seerr-internal. Writing to the Plex
// Universal Watchlist requires a plex.tv token and the Discover provider API
// (python-plexapi uses PUT discover.provider.plex.tv/actions/addToWatchlist).
// The token is device-local like the Seerr API key and never crosses to
// content scripts: they only learn plexConfigured via getConfigState.
(function (root) {
  const RatingsConfig = root.RatingsConfig;
  const MediaValidation = root.MediaValidation;

  const PLEX_TV = 'https://plex.tv';
  const DISCOVER = 'https://discover.provider.plex.tv';
  const METADATA = 'https://metadata.provider.plex.tv';
  const PLEX_PRODUCT = 'Super Seerr';
  const PLEX_VERSION = '1.0';
  const PLEX_CLIENT_ID = 'super-seerr-extension';

  function normalizeTitle(value = '') {
    // Fold Latin accents while preserving meaningful marks in other scripts
    // (for example, Japanese ハ and バ are different characters).
    return String(value).toLowerCase().replace(/&amp;/g, '&').normalize('NFKD')
      .replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC')
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').replace(/(^| )(?:the|a|an)(?= |$)/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  root.PlexWatchlist = {
    plexHeaders(token) {
      return {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Version': PLEX_VERSION,
        'X-Plex-Client-Identifier': PLEX_CLIENT_ID
      };
    },

    async plexFetch(url, { token, method = 'GET', query = null } = {}) {
      if (!token) throw new Error('Plex token is required. Add it in the extension options.');
      const target = new URL(url);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
        }
      }
      const allowed = [new URL(PLEX_TV).origin, new URL(DISCOVER).origin, new URL(METADATA).origin];
      if (!allowed.includes(target.origin)) throw new Error('Plex request is outside the allowed origins');
      let response;
      try {
        response = await fetch(target.href, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(RatingsConfig.requestTimeoutMs),
          credentials: 'omit',
          headers: this.plexHeaders(token)
        });
      } catch (error) {
        // A missing host permission and an offline server both surface as a
        // bare TypeError, which tells the reader nothing about what to fix.
        if (error && error.name === 'TypeError') {
          throw new Error('Could not reach Plex. Check the Plex host permission grant and your network connection.');
        }
        throw error;
      }
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.text();
          detail = body.slice(0, 200);
        } catch (_) {}
        throw new Error(`Plex returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const contentType = response.headers.get('Content-Type') || '';
      if (response.status === 204) return null;
      if (contentType.includes('application/json')) return response.json();
      // Discover answers JSON when asked; fall back to text so callers can decide.
      try { return JSON.parse(await response.text()); }
      catch (_) { return null; }
    },

    // Test without saving: options passes { plexToken } like Seerr's test does.
    async plexTestConnection(data = null) {
      const token = (data && data.plexToken) || this.plexToken;
      if (!token) throw new Error('Plex token is required');
      const user = await this.plexFetch(`${PLEX_TV}/api/v2/user`, { token });
      const account = user || {};
      return {
        connected: true,
        user: account.username || account.email || account.title || 'Plex account'
      };
    },

    plexRatingKeyFromGuid(guid) {
      if (!guid) return null;
      const parts = String(guid).split('/');
      const last = parts[parts.length - 1];
      return /^[A-Za-z0-9]+$/.test(last) ? last : null;
    },

    asPlexList(value) {
      if (Array.isArray(value)) return value;
      return value && typeof value === 'object' ? [value] : [];
    },

    plexCollectSearchCandidates(searchJson) {
      const container = searchJson && searchJson.MediaContainer ? searchJson.MediaContainer : searchJson;
      const out = [];
      // Plex collapses single-element arrays to bare objects in JSON.
      const groups = this.asPlexList(container && container.SearchResults);
      for (const group of groups) {
        if (group && group.id && String(group.id).toLowerCase() !== 'external') continue;
        const results = this.asPlexList(group && group.SearchResult);
        for (const entry of results) {
          const metadata = entry && entry.Metadata ? entry.Metadata : entry;
          if (!metadata || typeof metadata !== 'object') continue;
          const ratingKey = metadata.ratingKey || this.plexRatingKeyFromGuid(metadata.guid);
          if (!ratingKey) continue;
          const type = metadata.type === 'show' ? 'tv' : metadata.type === 'movie' ? 'movie' : metadata.type;
          const year = metadata.year
            || (metadata.originallyAvailableAt ? Number(String(metadata.originallyAvailableAt).slice(0, 4)) : null);
          out.push({
            ratingKey: String(ratingKey),
            title: metadata.title || metadata.name || '',
            type,
            year: Number.isFinite(year) ? year : null,
            guid: metadata.guid || null
          });
        }
      }
      // Some responses return Metadata at the top level instead of grouped results.
      if (out.length === 0) {
        for (const metadata of this.asPlexList(container && container.Metadata)) {
          const ratingKey = metadata.ratingKey || this.plexRatingKeyFromGuid(metadata.guid);
          if (!ratingKey) continue;
          out.push({
            ratingKey: String(ratingKey),
            title: metadata.title || metadata.name || '',
            type: metadata.type === 'show' ? 'tv' : metadata.type,
            year: metadata.year || null,
            guid: metadata.guid || null
          });
        }
      }
      return out;
    },

    plexMetadataTmdbId(detailJson) {
      try {
        const container = detailJson.MediaContainer || detailJson;
        const list = this.asPlexList(container.Metadata || container.metadata);
        const first = list[0] || {};
        const guids = this.asPlexList(first.Guid || first.guid);
        for (const guid of guids) {
          const id = guid && (guid.id || guid.guid || '');
          const match = String(id).match(/^tmdb:\/\/(\d+)/i);
          if (match) return Number(match[1]);
        }
      } catch (_) {}
      return null;
    },

    async plexResolveRatingKey(mediaData, { token = null } = {}) {
      const media = MediaValidation.media(mediaData);
      const activeToken = token || this.plexToken;
      if (!activeToken) throw new Error('Plex token is required. Add it in the extension options.');
      if (mediaData && mediaData.ratingKey && /^[A-Za-z0-9]{5,}$/.test(String(mediaData.ratingKey))) {
        return { ratingKey: String(mediaData.ratingKey), title: media.title, type: media.mediaType };
      }
      if (!media.title) {
        // Seerr withholds a card's title until it is hovered, so grid buttons
        // often arrive with an id but no text. Resolve the title from Seerr
        // itself; Discover search is text-based and has nothing to ask without
        // one. GUID confirmation below still pins the exact TMDB id.
        if (Number.isInteger(media.tmdbId) && media.tmdbId > 0 && this.baseUrl && this.apiKey) {
          try {
            const endpoint = media.mediaType === 'tv' ? `/api/v1/tv/${media.tmdbId}` : `/api/v1/movie/${media.tmdbId}`;
            const details = await this.makeAPIRequest('GET', endpoint);
            const resolvedTitle = details && (details.title || details.name);
            if (typeof resolvedTitle === 'string' && resolvedTitle.trim()) {
              media.title = resolvedTitle.trim();
            }
          } catch (_) {}
        }
      }
      if (!media.title) {
        // Discover search is text-based: a bare TMDB id gives it nothing to ask.
        throw new Error('Plex lookup needs a title to search Discover. Provide a title along with the TMDB id.');
      }

      const searchTypes = media.mediaType === 'movie' ? 'movies' : media.mediaType === 'tv' ? 'tv' : 'movies,tv';
      const searchJson = await this.plexFetch(`${DISCOVER}/library/search`, {
        token: activeToken,
        query: {
          query: media.title,
          limit: 20,
          searchTypes,
          searchProviders: 'discover',
          includeMetadata: 1
        }
      });
      let candidates = this.plexCollectSearchCandidates(searchJson)
        .filter(candidate => !candidate.type || candidate.type === media.mediaType);
      if (candidates.length === 0) {
        throw new Error(`No Plex match for "${media.title}". Check the title in Plex Discover.`);
      }

      // An exact TMDB id decides: confirm via the metadata GUIDs, never by rank.
      if (Number.isInteger(media.tmdbId) && media.tmdbId > 0) {
        for (const candidate of candidates.slice(0, 10)) {
          try {
            const detail = await this.plexFetch(`${DISCOVER}/library/metadata/${encodeURIComponent(candidate.ratingKey)}`, {
              token: activeToken,
              query: { includeGuids: 1 }
            });
            if (this.plexMetadataTmdbId(detail) === media.tmdbId) return candidate;
          } catch (_) {}
        }
        throw new Error(`No Plex match for TMDB ${media.tmdbId} ("${media.title}"). Check the title in Plex Discover.`);
      }

      // Title-only: require a single normalized title/year match, never a guess.
      const wanted = normalizeTitle(media.title);
      const matching = candidates.filter(candidate => /[\p{L}\p{N}]/u.test(wanted) && normalizeTitle(candidate.title) === wanted
        && (media.year == null || candidate.year == null || candidate.year === media.year));
      if (matching.length === 0) {
        throw new Error(`No Plex match for "${media.title}". Check the title in Plex Discover.`);
      }
      if (matching.length > 1) {
        throw new Error(`No unambiguous Plex match for "${media.title}". Choose this title in Plex Discover.`);
      }
      return matching[0];
    },

    async plexUserState(ratingKey, token) {
      try {
        const state = await this.plexFetch(`${METADATA}/library/metadata/${encodeURIComponent(ratingKey)}/userState`, { token });
        const container = state && state.MediaContainer ? state.MediaContainer : state;
        const item = container && (container.UserState || container.userState);
        return this.asPlexList(item)[0] || null;
      } catch (_) {
        return null;
      }
    },

    // Read-only state for initial button labels. Never throws: an unknown
    // outcome keeps the Add button, which confirms on click anyway.
    async plexWatchlistState(data) {
      try {
        const media = MediaValidation.media(data);
        const token = this.plexToken;
        if (!token) return { onWatchlist: false, unknown: true };
        const resolved = await this.plexResolveRatingKey(media, { token });
        if (this.plexToken !== token) return { onWatchlist: false, unknown: true };
        const state = await this.plexUserState(resolved.ratingKey, token);
        if (this.plexToken !== token) return { onWatchlist: false, unknown: true };
        const onWatchlist = !!(state && (state.watchlistedAt || state.watchlisted || state.onWatchlist));
        return { onWatchlist, ratingKey: resolved.ratingKey, title: resolved.title || media.title };
      } catch (_) {
        return { onWatchlist: false, unknown: true };
      }
    },

    // Single PUT, never retried: a lost reply is an unknown outcome, and
    // resending a write risks a duplicate against a non-idempotent endpoint.
    async plexAddToWatchlist(data) {
      const media = MediaValidation.media(data);
      const token = this.plexToken;
      if (!token) throw new Error('Plex token is required. Add it in the extension options.');
      const assertCurrent = () => {
        if (this.plexToken !== token) throw new Error('Plex account changed. Review the title and add it again.');
      };
      const resolved = await this.plexResolveRatingKey(media, { token });
      assertCurrent();
      const state = await this.plexUserState(resolved.ratingKey, token);
      assertCurrent();
      const already = state && (state.watchlistedAt || state.watchlisted || state.onWatchlist);
      if (already) return { ratingKey: resolved.ratingKey, title: resolved.title || media.title, already: true };
      try {
        await this.plexFetch(`${DISCOVER}/actions/addToWatchlist`, {
          token,
          method: 'PUT',
          query: { ratingKey: resolved.ratingKey }
        });
      } catch (error) {
        if (/already/i.test(error.message)) {
          return { ratingKey: resolved.ratingKey, title: resolved.title || media.title, already: true };
        }
        throw error;
      }
      // Minimal shape: the raw Discover answer can be a large MediaContainer
      // that has no business crossing into the content script.
      return { ratingKey: resolved.ratingKey, title: resolved.title || media.title, already: false };
    }
  };
})(globalThis);
