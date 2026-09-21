// Synthetic contract fixtures, not snapshots or evidence of live-site compatibility.
const SITES = [
  {
    site: 'imdb',
    url: 'https://www.imdb.com/title/tt0111161/',
    html: `<h1 data-testid="hero__pageTitle"><span>The Shawshank Redemption</span></h1>
           <div data-testid="hero-title-block__metadata"><a href="/title/tt0111161/releaseinfo">1994</a></div>`,
    expect: { title: 'The Shawshank Redemption', year: 1994, mediaType: 'movie', imdbId: 'tt0111161' }
  },
  {
    site: 'tmdb',
    url: 'https://www.themoviedb.org/movie/550-fight-club',
    html: '<h2 data-testid="original-title">Fight Club</h2>',
    expect: { title: 'Fight Club', mediaType: 'movie', tmdbId: 550 }
  },
  {
    site: 'tmdb',
    url: 'https://www.themoviedb.org/tv/1396-breaking-bad',
    html: '<h2 data-testid="original-title">Breaking Bad</h2>',
    expect: { title: 'Breaking Bad', mediaType: 'tv', tmdbId: 1396 }
  },
  {
    site: 'letterboxd',
    url: 'https://letterboxd.com/film/fight-club/',
    html: `<h1 class="headline-1 prettify">Fight Club</h1>
           <a href="https://www.themoviedb.org/movie/550/">TMDb</a>`,
    expect: { title: 'Fight Club', mediaType: 'movie', tmdbId: 550 }
  },
  {
    site: 'rt',
    url: 'https://www.rottentomatoes.com/m/fight_club',
    html: '<h1 data-qa="score-panel-movie-title">Fight Club</h1>',
    expect: { title: 'Fight Club', mediaType: 'movie' }
  },
  {
    site: 'rt',
    url: 'https://www.rottentomatoes.com/tv/breaking_bad',
    html: '<h1 data-qa="score-panel-series-title">Breaking Bad</h1>',
    expect: { title: 'Breaking Bad', mediaType: 'tv' }
  },
  {
    site: 'metacritic',
    url: 'https://www.metacritic.com/movie/fight-club',
    html: '<h1 data-testid="product-title">Fight Club</h1>',
    expect: { title: 'Fight Club', mediaType: 'movie' }
  },
  {
    site: 'trakt',
    url: 'https://trakt.tv/movies/fight-club-1999',
    html: '<h1 itemprop="name">Fight Club</h1>',
    expect: { title: 'Fight Club', mediaType: 'movie' }
  },
  {
    site: 'trakt',
    url: 'https://trakt.tv/shows/breaking-bad',
    html: '<h1 itemprop="name">Breaking Bad</h1>',
    expect: { title: 'Breaking Bad', mediaType: 'tv' }
  },
  {
    site: 'filmweb',
    url: 'https://www.filmweb.pl/film/Podziemny+kr%C4%85g-1999-1237',
    html: '<h1 class="filmTitle__title">Podziemny krąg</h1>',
    expect: { title: 'Podziemny krąg', mediaType: 'movie' }
  },
  {
    site: 'filmweb',
    url: 'https://www.filmweb.pl/serial/Breaking+Bad-2008-388834',
    html: '<h1 class="serialTitle__title">Breaking Bad</h1>',
    expect: { title: 'Breaking Bad', mediaType: 'tv' }
  }
];
module.exports = { SITES };
