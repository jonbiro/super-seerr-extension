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
      let tmdbId = media.tmdbId;
      if (!tmdbId || !(await this.tmdbIdentityMatches(media))) {
        const match = await this.resolveMediaMatch(media);
        if (!match) throw new Error('No unambiguous match. Choose the correct title first.');
        tmdbId = root.MediaValidation.tmdbId(match.id);
      }
      const server = this.baseUrl;
      const key = this.apiKey;
      // Always refresh before presenting availability or approving a write.
      const details = await this.sendAPIRequest('GET', `/api/v1/tv/${tmdbId}`);
      if (this.baseUrl !== server || this.apiKey !== key) throw new Error('Settings changed. Review seasons again.');
      if (!Array.isArray(details?.seasons)) throw new Error('Season information is unavailable. Try again before requesting.');
      const info = details.mediaInfo || {};
      const availability = new Map((info.seasons || []).map(season => [season.seasonNumber, season.status]));
      const requested = new Set((info.requests || []).filter(request => !request.is4k && ![3, 5].includes(request.status))
        .flatMap(request => (request.seasons || []).map(season => season.seasonNumber)));
      const labels = { 1: 'Not available', 2: 'Pending', 3: 'Processing', 4: 'Partially available', 5: 'Available', 6: 'Blocked', 7: 'Deleted' };
      const seasons = [...new Map(details.seasons.filter(season => Number.isSafeInteger(season.seasonNumber) && season.seasonNumber >= 0)
        .map(season => {
          const number = season.seasonNumber;
          const status = availability.get(number) ?? 1;
          const pending = requested.has(number);
          const blocked = info.status === 6;
          return [number, { number, name: String(season.name || (number ? `Season ${number}` : 'Specials')).slice(0, 200),
            episodeCount: Number.isSafeInteger(season.episodeCount) ? season.episodeCount : 0,
            availability: blocked ? 'Blocked' : pending ? 'Already requested' : (labels[status] || 'Status unknown'),
            requestable: !blocked && !pending && [1, 7].includes(status) && season.episodeCount > 0 }];
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
