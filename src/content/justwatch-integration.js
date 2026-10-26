// JustWatch title pages use localized route names and visible title metadata.
// Provider availability stays on JustWatch, where it reflects the chosen country.
class JustWatchIntegration extends BaseIntegration {
  constructor() {
    super('JustWatch', { uiTheme: 'flyout' });
    this.init();
  }

  getNavigationKey() {
    return `${window.location.origin}${window.location.pathname.replace(/\/+$/, '')}`;
  }

  async extractMediaData() {
    const current = new URL(window.location.href);
    if (!['www.justwatch.com', 'justwatch.com', 'br.justwatch.com'].includes(current.hostname)) return null;
    const segments = current.pathname.replace(/\/+$/, '').split('/').slice(1);
    // A season/episode, search, list, or provider page cannot identify a title.
    if (segments.length !== 3 || !/^[a-z]{2}$/i.test(segments[0]) || !segments[2]) return null;
    let kind;
    try { kind = decodeURIComponent(segments[1]).toLowerCase(); } catch (_) { return null; }
    const movies = ['movie', 'film', 'filme', 'pelicula', 'elokuva', '映画', '영화', 'фильм'];
    const shows = ['tv-show', 'serie', 'serial', 'sarja', 'tv-series', 'tv-sorozat', 'serie-tv',
      'テレビ番組', 'tv-프로그램', 'seriale', 'сериал', 'tv-sovu'];
    const mediaType = movies.includes(kind) ? 'movie' : shows.includes(kind) ? 'tv' : null;
    if (!mediaType) return null;

    // During client-side navigation the old heading may outlive the URL.
    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical) {
      try {
        const url = new URL(canonical, current);
        if (url.origin !== current.origin || url.pathname.replace(/\/+$/, '') !== current.pathname.replace(/\/+$/, '')) return null;
      } catch (_) { return null; }
    }
    const heading = document.querySelector('h1.title-detail-hero__details__title, .title-block h1');
    if (!heading) return null;
    const year = this.extractor.parseReleaseYear(heading.querySelector('.release-year, .text-muted')?.textContent);
    const titleNode = heading.cloneNode(true);
    titleNode.querySelectorAll('.release-year, .text-muted').forEach(node => node.remove());
    const title = titleNode.textContent.replace(/\s+/g, ' ').trim();
    if (!title || /^(?:JustWatch|Access Denied|Forbidden|Just a moment\.*)$/i.test(title)) return null;
    // Never treat JustWatch's own numeric identifiers as TMDB IDs, or copy an
    // external ID from a recommendation elsewhere on the page.
    return this.extractor.createMediaData({ title, year, mediaType }, 'justwatch');
  }
}

function initializeJustWatchIntegration() {
  new JustWatchIntegration();
}
initializeJustWatchIntegration();
