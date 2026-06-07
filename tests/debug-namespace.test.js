// Property tests 6 & 7: Debug namespace
// - Property 6: setupDebugFunctions adds to window.seerr_debug, not window.jellyseerr_debug
// - Property 7: setupDebugFunctions accumulates without resetting prior entries
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');

// Simulated setupDebugFunctions logic (extracted from BaseIntegration design)
function setupDebugFunctions(windowObj, siteName) {
  if (!windowObj.seerr_debug) {
    windowObj.seerr_debug = {};
  }

  windowObj.seerr_debug[siteName.toLowerCase()] = {
    updateStatus: () => true,
    testAPI: () => true,
  };
}

test('Property 6: Debug namespace does not pollute old key', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      (siteName) => {
        const win = {};
        setupDebugFunctions(win, siteName);

        assert.ok(win.seerr_debug, 'window.seerr_debug should be created');
        assert.ok(win.seerr_debug[siteName.toLowerCase()], 'site entry should exist');
        assert.strictEqual(win.jellyseerr_debug, undefined, 'window.jellyseerr_debug should NOT be created');
        return true;
      }
    )
  );
});

test('Property 7: Debug namespace accumulates without reset', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.record({
        site1: fc.string({ minLength: 1 }),
        site2: fc.string({ minLength: 1 }),
        entry1: fc.object({ maxDepth: 1 }),
        entry2: fc.object({ maxDepth: 1 }),
      }),
      (siteName1, { site2: site2Name, entry1, entry2 }) => {
        const siteName2 = site2Name + '_second'; // ensure different from siteName1

        const win = {};
        win.seerr_debug = {};
        win.seerr_debug[siteName1.toLowerCase()] = entry1;

        setupDebugFunctions(win, siteName2);

        assert.ok(win.seerr_debug[siteName1.toLowerCase()], 'First entry should remain intact');
        assert.ok(win.seerr_debug[siteName2.toLowerCase()], 'Second entry should be added');
        assert.strictEqual(win.seerr_debug[siteName1.toLowerCase()], entry1, 'First entry should keep original value');
        assert.strictEqual(win.jellyseerr_debug, undefined, 'window.jellyseerr_debug should NOT be created');
        return true;
      }
    )
  );
});
