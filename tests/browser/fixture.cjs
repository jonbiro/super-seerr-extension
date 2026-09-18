const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');

async function createExtension(browser) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), `super-seerr-${browser}-`));
  const extension = path.join(temporary, 'extension');
  await fs.mkdir(extension);
  for (const directory of ['src', 'icons']) await fs.cp(path.join(root, directory), path.join(extension, directory), { recursive: true });
  const manifest = { ...require('../../manifest.base.json'), ...require(`../../manifest.${browser}.json`) };
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  return { temporary, extension, manifest };
}

async function startServer() {
  // Real HTTP responses also reach extension background fetches, unlike page
  // route mocks. All fixtures are local; no real API key or Seerr is needed.
  const server = http.createServer((request, response) => {
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
