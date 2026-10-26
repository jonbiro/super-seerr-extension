// Simkl catalog IDs identify Simkl records, never TMDB records.
class SimklIntegration extends BaseIntegration {
  constructor() {
    super('Simkl', { uiTheme: 'flyout', debug: false });
    this.init();
  }

  getNavigationKey() {
    return `${window.location.origin}${window.location.pathname.replace(/\/+$/, '')}`;
  }

  async extractMediaData() {
    const route = this.simklRoute(window.location.href);
    if (!route) return null;
    if (this.isBlockedProviderPage()) return null;
    if (/^(?:just a moment\.*|403 forbidden|access denied|attention required!?)(?:\s|$)/i.test(document.title.trim())) return null;
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    if (canonical && !this.sameRecord(canonical, route)) return null;
    const heading = document.querySelector('main h1, h1');
    const headingTitle = heading?.textContent.trim();
    const sameTitle = value => typeof value === 'string' && headingTitle &&
      value.normalize('NFC').trim().toLowerCase() === headingTitle.normalize('NFC').trim().toLowerCase();
    const nodes = [];
    const collect = value => {
      if (Array.isArray(value)) return value.forEach(collect);
      if (!value || typeof value !== 'object') return;
      const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
      const mediaType = types.includes('Movie') ? 'movie' : types.includes('TVSeries') ? 'tv' : null;
      if (mediaType && typeof value.name === 'string' && value.name.trim()) {
        const references = [value.url, value['@id'], value.mainEntityOfPage].flat()
          .map(item => typeof item === 'string' ? item : item?.['@id'] || item?.url).filter(Boolean);
        // An explicit different title URL is stale/recommended content. A
        // URL-less record must agree with this page's visible title instead.
        const belongs = references.length ? references.some(url => this.sameRecord(url, route)) : sameTitle(value.name);
        if (belongs) nodes.push({ value, mediaType });
      }
      collect(value['@graph']);
      collect(value.mainEntity);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { collect(JSON.parse(script.textContent)); } catch (_) { /* Other scripts may contain valid metadata. */ }
    }
    const matching = nodes.filter(node => route.category === 'anime' || node.mediaType === (route.category === 'movies' ? 'movie' : 'tv'));
    if (nodes.length && !matching.length) return null;
    // Contradictory records cannot decide whether anime is a film or a series.
    if (new Set(matching.map(node => `${node.mediaType}:${node.value.name.trim()}`)).size > 1) return null;
    let record = matching[0];
    if (!record) {
      const scope = heading?.closest('[itemscope][itemtype]');
      const types = scope?.getAttribute('itemtype')?.split(/\s+/) || [];
      const mediaType = types.some(type => /^https?:\/\/schema\.org\/Movie\/?$/.test(type)) ? 'movie'
        : types.some(type => /^https?:\/\/schema\.org\/TVSeries\/?$/.test(type)) ? 'tv' : null;
      if (mediaType && headingTitle) {
        const date = scope.querySelector('[itemprop="datePublished"], [itemprop="startDate"]');
        record = { mediaType, value: { name: headingTitle, datePublished: date?.getAttribute('content') || date?.getAttribute('datetime') || date?.textContent } };
      }
    }
    if (record && route.category !== 'anime' && record.mediaType !== (route.category === 'movies' ? 'movie' : 'tv')) return null;
    const mediaType = record?.mediaType || (route.category === 'movies' ? 'movie' : route.category === 'tv' ? 'tv' : null);
    const title = record?.value.name.trim() || headingTitle;
    if (!mediaType || !title || /^(?:403 forbidden|access denied|just a moment\.*|simkl|(?:www\.)?simkl\.com)$/i.test(title)) return null;
    const year = this.extractor.parseReleaseYear(record?.value.datePublished || record?.value.startDate || '') ??
      this.extractor.extractYearFromFallbacks();
    // Recommendations can expose unrelated external links. Only IDs attached
    // to this page's bound metadata record can strengthen its identity.
    const external = [record?.value.sameAs || []].flat(2);
    const tmdb = new Set(), imdb = new Set();
    for (const link of external) {
      if (typeof link !== 'string') continue;
      try {
        const url = new URL(link);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
        const tmdbMatch = url.pathname.match(/^\/(movie|tv)\/(\d+)(?:-[^/]+)?\/?$/);
        if (['themoviedb.org', 'www.themoviedb.org'].includes(url.hostname) && tmdbMatch?.[1] === mediaType) {
          const id = Number(tmdbMatch[2]);
          if (Number.isSafeInteger(id) && id > 0) tmdb.add(id);
        }
        const imdbMatch = url.pathname.match(/^\/title\/(tt\d+)\/?$/);
        if (['imdb.com', 'www.imdb.com'].includes(url.hostname) && imdbMatch) imdb.add(imdbMatch[1]);
      } catch (_) { /* A malformed/untrusted external link supplies no identity. */ }
    }
    return this.createMediaData({ title, year, mediaType,
      tmdbId: tmdb.size === 1 ? [...tmdb][0] : null,
      imdbId: imdb.size === 1 ? [...imdb][0] : null,
      overview: typeof record?.value.description === 'string' ? record.value.description : null });
  }

  simklRoute(value) {
    try {
      const url = new URL(value, window.location.href);
      if (url.protocol !== 'https:' || !['simkl.com', 'www.simkl.com'].includes(url.hostname)) return null;
      const match = url.pathname.match(/^\/(movies|tv|anime)\/([1-9]\d*)\/([^/]+)\/?$/);
      if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
      return { category: match[1], id: match[2] };
    } catch (_) { return null; }
  }

  sameRecord(value, route) {
    const candidate = this.simklRoute(value);
    return candidate?.category === route.category && candidate.id === route.id;
  }
}

function initializeSimklIntegration() {
  new SimklIntegration();
}

initializeSimklIntegration();
