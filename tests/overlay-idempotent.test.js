// Property test 15: Overlay injection is idempotent
// Calling the injection function N times results in exactly the same number of elements as calling it once
const { test } = require('node:test');
const assert = require('node:assert');

function makeMockEl(attrs = {}) {
  return {
    tag: 'div',
    _attrs: { ...attrs },
    hasAttribute: function(attr) { return this._attrs[attr] !== undefined; },
    getAttribute: function(attr) { return this._attrs[attr]; },
    setAttribute: function(attr, val) { this._attrs[attr] = val; },
    remove: function() { /* noop */ }
  };
}

test('Property 15: Injection idempotence guard prevents duplicates', () => {
  const MARKER = 'data-seerr-overlay';

  function injectOverlay(domElements, markerAttr) {
    const existing = domElements.filter(el => el.hasAttribute(markerAttr));
    if (existing.length > 0) return domElements;

    const newEl = makeMockEl({ [markerAttr]: 'true' });
    return [...domElements, newEl];
  }

  let dom = [];
  dom = injectOverlay(dom, MARKER);
  assert.strictEqual(dom.length, 1, 'First injection should create 1 element');

  dom = injectOverlay(dom, MARKER);
  assert.strictEqual(dom.length, 1, 'Second injection should NOT create a duplicate');

  for (let i = 0; i < 10; i++) {
    dom = injectOverlay(dom, MARKER);
  }
  assert.strictEqual(dom.length, 1, 'After 11 injections, there should still be only 1 element');
});

test('Property 15b: Cleanup then re-injection works correctly', () => {
  const MARKER = 'data-seerr-overlay';

  function cleanupOverlay(domElements, markerAttr) {
    return domElements.filter(el => !el.hasAttribute(markerAttr));
  }

  function injectOverlay(domElements, markerAttr) {
    const existing = domElements.filter(el => el.hasAttribute(markerAttr));
    if (existing.length > 0) return domElements;
    const newEl = makeMockEl({ [markerAttr]: 'true' });
    return [...domElements, newEl];
  }

  let dom = [];
  dom = injectOverlay(dom, MARKER);
  assert.strictEqual(dom.length, 1);

  dom = cleanupOverlay(dom, MARKER);
  assert.strictEqual(dom.length, 0, 'Cleanup removes overlay elements');

  dom = injectOverlay(dom, MARKER);
  assert.strictEqual(dom.length, 1, 'Re-injection after cleanup creates a fresh element');
});
