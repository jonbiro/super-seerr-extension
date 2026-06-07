# Seerr Request Button

A browser extension that seamlessly integrates with popular movie and TV sites, allowing you to request content directly to your Seerr server. Adds Rotten Tomatoes context on Seerr browse cards and detail pages so you can evaluate titles without leaving Seerr.

![Version](https://img.shields.io/badge/version-3.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Chrome](https://img.shields.io/badge/Chrome-Compatible-brightgreen)
![Firefox](https://img.shields.io/badge/Firefox-Compatible-brightgreen)

## Supported Sites

- **IMDb** — Movie and TV show pages
- **Rotten Tomatoes** — Movie and TV show reviews
- **TheMovieDB** — Comprehensive movie database (most accurate matching)
- **Letterboxd** — Film community platform
- **Metacritic** — Professional reviews and scores
- **Trakt** — Movie and TV tracking platform
- **Filmweb** — Polish movie and TV database

## Features

### Core
- **Unified Flyout Interface** — Consistent design across all supported sites with brand-matched theming
- **Smart Media Detection** — Automatically extracts title, year, media type, and TMDb ID from page content
- **Real-time Status** — Shows current request status with color indicators and monitoring info
- **Convenience** — Play button opens Jellyfin directly when content is available

### Seerr Overlay (runs on your Seerr instance)
- **Browse-Card Rating Badges** — Compact RT critics and audience scores on discover/search cards
- **Detail-Page Ratings Row** — RT critics → audience → IMDb → TMDB scores near the request action
- **Pre-Request Quality Summary** — One-line heuristic: "Critics love it", "Strong reviews", "Mixed reviews"
- **RT Sorting & Filtering** — Sort by critics/audience score; filter by minimum thresholds
- **Bulk List Actions** — Multi-select titles, review in confirmation modal, submit as batch

### Flyout Panel (runs on supported review sites)
- **Add to Watchlist** — Save media to your Seerr watchlist without immediately requesting
- **In-Library Badge** — Green checkmark shows when content is already on Jellyfin

## Installation

### Chrome/Edge
1. **Download** the latest release from the repository
2. **Extract** the downloaded ZIP file to a folder on your computer
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" in the top right corner
5. Click "Load unpacked" and select the extracted `seerr-browser-extension` folder
6. The extension will be installed and ready to configure

### Firefox
1. **Download** the latest release from the repository
2. **Extract** the downloaded ZIP file to a folder on your computer
3. Open Firefox and navigate to `about:debugging`
4. Click "This Firefox" in the left sidebar
5. Click "Load Temporary Add-on"
6. Navigate to the extracted folder and select the `manifest.json` file

## Setup

1. Click the extension icon in your browser toolbar
2. Click "Settings" to open the options page
3. Enter your Seerr server URL (e.g., `https://seerr.yourdomain.com`)
4. Enter your Seerr API key (found in Settings → General → API Key)
5. Click "Test Connection" to verify your settings
6. Click "Save Settings"

## Usage

### External Sites
1. **Navigate** to any movie or TV show page on supported sites
2. **Look for** the Seerr flyout tab on the right side of your screen
3. **Click the tab** to expand the flyout panel
4. **View status** and click the action button to request content

### Seerr Itself
1. **Browse** your Seerr discover, search, or detail pages
2. **See** RT scores on cards and detail pages automatically
3. **Sort** and **filter** using the extension-provided controls
4. **Select multiple titles** and submit as a batch request

### Status Indicators
- 🟢 **Green**: Available to request or ready to watch
- 🟡 **Orange**: Request pending approval
- 🔵 **Blue**: Currently downloading/processing
- 🔴 **Red**: Error or connection issue

## Architecture

```
src/
├── shared/                       # Shared Libraries
│   ├── BaseIntegration.js        # Base class for all site integrations
│   ├── SeerrClient.js            # API communication (MV3 Promise-based)
│   ├── MediaExtractor.js         # Title/year/TMDb extraction
│   ├── UIComponents.js           # Flyout interface, notifications, badges
│   ├── RatingsModel.js           # Typed ratings bundle (partial-data safe)
│   └── RatingsConfig.js          # Centralized thresholds and summary rules
├── content/                      # Site Integrations
│   ├── imdb-integration.js       # IMDb (Yellow theme)
│   ├── rt-integration.js         # Rotten Tomatoes (Red theme)
│   ├── tmdb-integration.js       # TheMovieDB (Blue theme)
│   ├── letterboxd-integration.js # Letterboxd (Green theme)
│   ├── metacritic-integration.js # Metacritic (Yellow theme)
│   ├── trakt-integration.js      # Trakt (Purple theme)
│   ├── filmweb-integration.js    # Filmweb (Yellow/Black theme)
│   ├── seerr-integration.js      # Seerr overlay (ratings, sort, bulk)
│   └── seerr-overlay.css         # Overlay stylesheet (dark/light themes)
├── background/
│   └── background.js             # Service worker (ES module, top-level await)
├── options/
│   └── options.{html,js,css}     # Settings page
└── popup/
    └── popup.{html,js,css}       # Extension popup
```

## Development

### Build

```bash
make build          # Build Chrome + Firefox (unpacked)
make build-chrome   # Chrome only
make build-firefox  # Firefox only
make release        # Create .zip / .xpi for distribution
```

The build process merges `manifest.base.json` with platform-specific overrides (`manifest.chrome.json` / `manifest.firefox.json`) to produce the final manifest for each browser.

### Test

```bash
npm install         # Install test dependencies (fast-check)
npm test            # Run all 33 tests
npm run test:watch  # Watch mode
```

Tests cover storage migration, branding, debug namespace, watchlist visibility, badge idempotence, ratings model, cache coalescing, summary heuristics, overlay injection, and SPA navigation regression.

### Feature Flags

The Seerr overlay uses feature flags in `seerr-integration.js` (all enabled by default):

```js
const FEATURE_FLAGS = {
  cardBadges: true,           // RT scores on browse cards
  detailRatingsRow: true,     // Ratings row on detail pages
  preRequestSummary: true,    // Quality summary text
  sortFilter: true,           // Sort & filter controls
  bulkActions: true,          // Multi-select & bulk requests
};
```

Set any to `false` to disable that feature without code changes.

### Chrome Load

```bash
make build-chrome
# Then: chrome://extensions → Developer Mode → Load unpacked → select dist/chrome/
```

## Support

For issues or feature requests, please open an issue on the repository.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
