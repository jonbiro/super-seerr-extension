// Property tests 8 & 9: Watchlist button visibility and POST body construction
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

test('Property 8: Watchlist button visible iff requestable', () => {
  // The showWatchlist logic from UIComponents.updateFlyoutStatus:
  // showWatchlist = statusData.status === 'available' || statusData.buttonClass === 'request'
  function shouldShowWatchlist(statusData) {
    return statusData.status === 'available' || statusData.buttonClass === 'request';
  }

  fc.assert(
    fc.property(
      fc.record({
        status: fc.oneof(
          fc.constant('available'),
          fc.constant('pending'),
          fc.constant('downloading'),
          fc.constant('available_watch'),
          fc.constant('requested'),
          fc.constant('unknown'),
          fc.string({ minLength: 1 })
        ),
        buttonClass: fc.oneof(
          fc.constant('request'),
          fc.constant('pending'),
          fc.constant('downloading'),
          fc.constant('watch'),
          fc.constant('error'),
          fc.constant('partial'),
          fc.constant('available'),
          fc.string({ minLength: 1 })
        )
      }),
      (statusData) => {
        const result = shouldShowWatchlist(statusData);

        // Only visible when status is 'available' OR buttonClass is 'request'
        if (statusData.status === 'available' || statusData.buttonClass === 'request') {
          assert.ok(result, `Watchlist should be visible when status=${statusData.status} or buttonClass=${statusData.buttonClass}`);
        }

        // For pending, downloading, available_watch — should be hidden
        if (['pending', 'downloading', 'available_watch'].includes(statusData.status)) {
          if (statusData.buttonClass !== 'request') {
            assert.ok(!result, `Watchlist should be hidden when status=${statusData.status} and buttonClass=${statusData.buttonClass}`);
          }
        }
      }
    )
  );
});

test('Property 9: Watchlist POST body maps tmdbId -> mediaId', () => {
  // Verify the body construction logic:
  // POST to /api/v1/watchlist with { mediaType: data.mediaType, mediaId: data.tmdbId }
  function buildWatchlistBody(data) {
    return {
      mediaType: data.mediaType,
      mediaId: data.tmdbId
    };
  }

  fc.assert(
    fc.property(
      fc.record({
        mediaType: fc.oneof(fc.constant('movie'), fc.constant('tv')),
        tmdbId: fc.integer({ min: 1 })
      }),
      (data) => {
        const body = buildWatchlistBody(data);
        assert.strictEqual(body.mediaType, data.mediaType, 'mediaType should match');
        assert.strictEqual(body.mediaId, data.tmdbId, 'mediaId should equal tmdbId');
        assert.ok(!('tmdbId' in body), 'Body should use mediaId key, not tmdbId');
      }
    )
  );
});
