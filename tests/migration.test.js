// Property test 1 & 2: Storage migration round-trip and idempotence
const { test } = require('node:test');
const assert = require('node:assert');
const fc = require('fast-check');
const { createStorageMock } = require('../tests/helpers/chrome-mock');

// Minimal migrateStorage implementation for testing (extracted from background.js design)
async function migrateStorage(storage) {
  try {
    const old = await storage.get(['jellyseerrUrl', 'jellyseerrApiKey']);
    const updates = {};
    const removals = [];

    if (old.jellyseerrUrl) {
      updates.seerrUrl = old.jellyseerrUrl;
      removals.push('jellyseerrUrl');
    }
    if (old.jellyseerrApiKey) {
      updates.seerrApiKey = old.jellyseerrApiKey;
      removals.push('jellyseerrApiKey');
    }

    if (removals.length > 0) {
      await storage.set(updates);
      await storage.remove(removals);
    }
  } catch (error) {
    // Non-fatal
  }
}

// loadSettings after migration
async function loadSettings(storage) {
  const settings = await storage.get(['seerrUrl', 'seerrApiKey']);
  return { baseUrl: settings.seerrUrl, apiKey: settings.seerrApiKey };
}

test('Property 1: Storage migration is a round trip', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 100 }),
      fc.string({ minLength: 1, maxLength: 100 }),
      async (url, apiKey) => {
        const storage = createStorageMock({
          jellyseerrUrl: url,
          jellyseerrApiKey: apiKey
        });

        await migrateStorage(storage);
        const settings = await loadSettings(storage);

        assert.strictEqual(settings.baseUrl, url, 'URL should round-trip');
        assert.strictEqual(settings.apiKey, apiKey, 'API key should round-trip');

        // Old keys should be removed
        const oldCheck = await storage.get(['jellyseerrUrl', 'jellyseerrApiKey']);
        assert.strictEqual(oldCheck.jellyseerrUrl, undefined, 'Old jellyseerrUrl should be deleted');
        assert.strictEqual(oldCheck.jellyseerrApiKey, undefined, 'Old jellyseerrApiKey should be deleted');
      }
    )
  );
});

test('Property 2: Migration is idempotent (no-op when only new keys present)', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1, maxLength: 100 }),
      fc.string({ minLength: 1, maxLength: 100 }),
      async (url, apiKey) => {
        const storage = createStorageMock({
          seerrUrl: url,
          seerrApiKey: apiKey
        });

        await migrateStorage(storage);

        // New keys should be untouched
        const settings = await loadSettings(storage);
        assert.strictEqual(settings.baseUrl, url, 'URL should be unchanged');
        assert.strictEqual(settings.apiKey, apiKey, 'API key should be unchanged');

        // No old keys should appear
        const all = storage._dump();
        const keys = Object.keys(all);
        assert.ok(keys.includes('seerrUrl'), 'seerrUrl should exist');
        assert.ok(keys.includes('seerrApiKey'), 'seerrApiKey should exist');
        assert.ok(!keys.includes('jellyseerrUrl'), 'jellyseerrUrl should not appear');
        assert.ok(!keys.includes('jellyseerrApiKey'), 'jellyseerrApiKey should not appear');
      }
    )
  );
});
