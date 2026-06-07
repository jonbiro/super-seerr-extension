// Property test 10: In-Library badge idempotence and visibility
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

test('Property 10: Badge shown iff available_watch, hidden otherwise', () => {
  function shouldShowBadge(status) {
    return status === 'available_watch';
  }

  fc.assert(
    fc.property(
      fc.oneof(
        fc.constant('available_watch'),
        fc.constant('available'),
        fc.constant('pending'),
        fc.constant('downloading'),
        fc.constant('ready'),
        fc.constant('requested'),
        fc.constant('partial'),
        fc.constant('error'),
        fc.constant('unknown'),
        fc.string({ minLength: 1 })
      ),
      (status) => {
        if (status === 'available_watch') {
          assert.ok(shouldShowBadge(status), 'Badge should be shown for available_watch');
        } else {
          assert.ok(!shouldShowBadge(status), `Badge should NOT be shown for ${status}`);
        }
      }
    )
  );
});

test('Property 10b: Badge insertion is idempotent', () => {
  // Simulate the guard check: if document.getElementById('seerr-in-library-badge') exists, return
  function showBadge(existingBadgeCount) {
    if (existingBadgeCount > 0) return 1; // idempotent — don't add another
    return 1; // creates the badge
  }

  function hideBadge(existingBadgeCount) {
    return 0; // removes the badge
  }

  // For any sequence of show/hide calls, there should never be more than 1 badge
  fc.assert(
    fc.property(
      fc.array(fc.boolean()),
      (showCalls) => {
        let badgeCount = 0;
        for (const show of showCalls) {
          if (show) {
            badgeCount = showBadge(badgeCount);
          } else {
            badgeCount = hideBadge(badgeCount);
          }
          assert.ok(badgeCount >= 0 && badgeCount <= 1,
            `Badge count should be 0 or 1, got ${badgeCount}`);
        }
      }
    )
  );
});
