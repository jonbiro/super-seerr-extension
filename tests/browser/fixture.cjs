const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const root = path.resolve(__dirname, '../..');

async function createExtension(browser, { ref } = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `super-seerr-${browser}-`));
  const extension = path.join(temporary, 'extension');
  await fs.mkdir(extension);
  if (ref) {
    const archive = await exec('git', ['archive', '--format=tar', ref, 'src', 'icons', 'manifest.base.json', 'manifest.chrome.json', 'manifest.firefox.json'], { cwd: root, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
    const archivePath = path.join(temporary, 'baseline.tar');
    await fs.writeFile(archivePath, archive.stdout);
    await exec('tar', ['-xf', archivePath, '-C', extension]);
  } else {
    for (const directory of ['src', 'icons']) await fs.cp(path.join(root, directory), path.join(extension, directory), { recursive: true });
    for (const file of ['manifest.base.json', `manifest.${browser}.json`]) await fs.copyFile(path.join(root, file), path.join(extension, file));
  }
  const read = async file => JSON.parse(await fs.readFile(path.join(extension, file), 'utf8'));
  const manifest = { ...await read('manifest.base.json'), ...await read(`manifest.${browser}.json`) };
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  return { temporary, extension, manifest };
}

async function startServer() {
  // Real HTTP responses also reach extension background fetches, unlike page
  // route mocks. All fixtures are local; no real API key or Seerr is needed.
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/v1/search?') && new URL(request.url, 'http://fixture').searchParams.get('query') === 'The Thing') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ results: [
        { id: 910, title: 'The Thing', mediaType: 'movie', releaseDate: '1982-06-25', overview: 'Antarctica, 1982' },
        { id: 911, title: 'The Thing', mediaType: 'movie', releaseDate: '2011-10-14', overview: 'The prequel' }
      ] })); return;
    }
    if (/^\/api\/v1\/movie\/91[01]$/.test(request.url)) {
      const id = Number(request.url.split('/').pop());
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ id, title: 'The Thing', releaseDate: id === 910 ? '1982-06-25' : '2011-10-14', mediaInfo: null })); return;
    }
    if (request.url === '/api/v1/tv/920') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ id: 920, name: 'Example Series', seasons: [1,2,3].map(seasonNumber => ({ seasonNumber, name: `Season ${seasonNumber}`, episodeCount: 8 })),
        mediaInfo: { status: 4, seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 3, status: 2 }] } })); return;
    }
    if (request.url.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url.includes('/settings/public') ? { mediaServerType: 2 }
        : request.url.includes('/auth/me') ? { displayName: 'Smoke test' }
        : request.url.includes('/ratings') ? { criticsScore: 85, audienceScore: 90, imdbRating: 8 }
        : { id: 550, title: 'Fight Club', voteAverage: 8, mediaInfo: null, results: [] }));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><title>Seerr</title></head><body>
      <main><h1>Discover</h1><div class="grid"><article data-testid="title-card">
      <a href="/movie/550"><img alt="Fight Club" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">Fight Club</a>
      </article></div></main>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"results":[{"id":550,"mediaType":"movie","title":"Fight Club","releaseDate":"1999-10-15","rtCriticsScore":85,"rtAudienceScore":90,"imdbRating":8,"voteAverage":8}]}}}</script>
      </body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { createExtension, startServer };
