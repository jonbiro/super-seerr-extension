// Standard-quality seasons, matching Seerr's per-season availability rules.
(function (root) {
  root.SeasonRequests = {
    validateSeasonSelection(value) {
      if (!Array.isArray(value) || !value.length || value.length > 500 ||
          value.some(number => !Number.isSafeInteger(number) || number < 0)) {
        throw new Error('Choose at least one valid TV season before requesting');
      }
      return [...new Set(value)].sort((a, b) => a - b);
    },
    async getSeasonOptions(data) {
      const media = root.MediaValidation.media(data);
      if (media.mediaType !== 'tv') throw new Error('Season selection is only available for TV');
      const server = this.baseUrl;
      const key = this.apiKey;
      const connectionToken = this.connectionToken();
      const assertCurrent = () => {
        if (this.baseUrl !== server || this.apiKey !== key || this.connectionToken() !== connectionToken) throw new Error('Settings changed. Review seasons again.');
      };
      let tmdbId = media.tmdbId;
      const identityMatches = tmdbId && await this.tmdbIdentityMatches(media);
      assertCurrent();
      if (!identityMatches) {
        const match = await this.resolveMediaMatch(media);
        assertCurrent();
        if (!match) throw new Error('No unambiguous match. Choose the correct title first.');
        tmdbId = root.MediaValidation.tmdbId(match.id);
      }
      // Always refresh before presenting availability or approving a write.
      const details = await this.sendAPIRequest('GET', `/api/v1/tv/${tmdbId}`);
      assertCurrent();
      // Availability is evidence for this title only. Never approve a request
      // using another detail response, even if its season numbers look valid.
      let detailsId;
      try { detailsId = root.MediaValidation.tmdbId(details?.id); } catch (_) { /* Invalid identity is unavailable. */ }
      if (detailsId !== tmdbId) throw new Error('Season information is unavailable for this title. Try again before requesting.');
      if (!Array.isArray(details?.seasons)) throw new Error('Season information is unavailable. Try again before requesting.');
      const unavailable = () => { throw new Error('Season availability is unavailable. Try again before requesting.'); };
      const list = value => value == null ? [] : Array.isArray(value) ? value : unavailable();
      const validSeason = season => season && Number.isSafeInteger(season.seasonNumber) && season.seasonNumber >= 0;
      const info = details.mediaInfo ?? {};
      if (typeof info !== 'object' || Array.isArray(info)) unavailable();
      if (info.status != null && ![1, 2, 3, 4, 5, 6, 7].includes(info.status)) unavailable();
      const availability = new Map();
      for (const season of list(info.seasons)) {
        if (!validSeason(season)) unavailable();
        // A present record with no usable status is unknown, not unrequested.
        const status = [1, 2, 3, 4, 5, 6, 7].includes(season.status) ? season.status : 0;
        const previous = availability.get(season.seasonNumber);
        availability.set(season.seasonNumber, previous !== undefined && previous !== status ? 0 : status);
      }
      const requested = new Set();
      for (const request of list(info.requests)) {
        if (!request || typeof request !== 'object' || Array.isArray(request)) unavailable();
        if (request.is4k === true) continue;
        if (request.is4k != null && request.is4k !== false) unavailable();
        if (![1, 2, 3, 4, 5].includes(request.status)) unavailable();
        // Only pending/approved requests reserve seasons. Failed requests can
        // be retried; fresh per-season availability still protects existing media.
        if (![1, 2].includes(request.status)) continue;
        if (!Array.isArray(request.seasons)) unavailable();
        for (const season of request.seasons) {
          if (!validSeason(season)) unavailable();
          requested.add(season.seasonNumber);
        }
      }
      const labels = { 1: 'Not available', 2: 'Pending', 3: 'Processing', 4: 'Partially available', 5: 'Available', 6: 'Blocked', 7: 'Deleted' };
      const seasons = [...new Map(details.seasons.filter(validSeason)
        .map(season => {
          const number = season.seasonNumber;
          const status = availability.get(number) ?? 1;
          const pending = requested.has(number);
          const blocked = info.status === 6;
          return [number, { number, name: String(season.name || (number ? `Season ${number}` : 'Specials')).slice(0, 200),
            episodeCount: Number.isSafeInteger(season.episodeCount) && season.episodeCount > 0 ? season.episodeCount : 0,
            availability: blocked ? 'Blocked' : pending ? 'Already requested' : (labels[status] || 'Status unknown'),
            requestable: !blocked && !pending && [1, 7].includes(status) && Number.isSafeInteger(season.episodeCount) && season.episodeCount > 0 }];
        })).values()].sort((a, b) => a.number - b.number);
      return { tmdbId, mediaType: 'tv', title: String(details.name || media.title), server, seasons };
    },
    async validateRequestSeasons(media, tmdbId) {
      const selected = this.validateSeasonSelection(media.seasons);
      if (media.seasonServer && media.seasonServer !== this.baseUrl) throw new Error('Server changed. Review seasons again.');
      if (media.tmdbId && media.tmdbId !== tmdbId) throw new Error('Title changed. Review seasons again.');
      const options = await this.getSeasonOptions({ ...media, tmdbId });
      if (options.tmdbId !== tmdbId) throw new Error('Title changed. Review seasons again.');
      const allowed = new Set(options.seasons.filter(season => season.requestable).map(season => season.number));
      if (selected.some(number => !allowed.has(number))) throw new Error('Season availability changed or a selected season cannot be requested. Review seasons again.');
      return selected;
    }
  };
})(globalThis);
