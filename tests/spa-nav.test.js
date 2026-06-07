// Regression test: SPA navigation does not duplicate injected overlay elements
const { test } = require('node:test');
const assert = require('node:assert');

// Mock DOM builder
function createMockDocument() {
  const elements = [];
  const doc = {
    elements,
    createElement(tag) {
      const el = createMockElement(tag);
      el._doc = doc;
      elements.push(el);
      return el;
    },
    querySelectorAll(selector) {
      const active = elements.filter(el => !el._removed);
      const matching = active.filter(el => {
        if (selector === '[data-seerr-overlay="true"]') {
          return el.hasAttribute('data-seerr-overlay');
        }
        return true; // fallback
      });
      return {
        length: matching.length,
        forEach(fn) { matching.forEach(fn); },
        [Symbol.iterator]: function* () { yield* matching; }
      };
    },
    querySelector(selector) {
      return elements.find(el => {
        if (el._removed) return false;
        if (selector === '[data-seerr-overlay="true"]') return el.hasAttribute('data-seerr-overlay');
        if (selector === '[data-seerr-overlay="true"][class*="sort-filter-bar"]') {
          return el.hasAttribute('data-seerr-overlay') && (el.className || '').includes('sort-filter-bar');
        }
        return false;
      }) || null;
    },
    body: {
      appendChild(el) { elements.push(el); return el; }
    }
  };
  return doc;
}

function createMockElement(name = 'div') {
  const children = [];
  const listeners = {};
  const self = {
    tagName: name,
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    children,
    _attrs: {},
    _removed: false,
    _doc: null,
    setAttribute(key, val) { this._attrs[key] = val; },
    getAttribute(key) { return this._attrs[key]; },
    hasAttribute(key) { return this._attrs[key] !== undefined; },
    appendChild(child) { children.push(child); return child; },
    remove() { this._removed = true; },
    querySelector(sel) { return null; },
    querySelectorAll(_) { return { length: 0, forEach() {}, [Symbol.iterator]: function* () {} }; },
    addEventListener(evt, fn) { listeners[evt] = fn; },
    closest(_) { return null; },
    get parentElement() { return null; },
    insertBefore(child, ref) { children.push(child); return child; },
    get textContent() { return this._text || ''; },
    set textContent(val) { this._text = val; }
  };
  return self;
}

test('SPA nav regression: forward-nav then back does not duplicate injected elements', () => {
  // Simulate: page load → inject → navigate forward → inject → navigate back → inject

  const MARKER = 'data-seerr-overlay';

  function isAlreadyInjected(doc) {
    return !!doc.querySelector('[data-seerr-overlay="true"]');
  }

  function cleanupOverlay(doc) {
    const els = [...doc.querySelectorAll('[data-seerr-overlay="true"]')].filter(Boolean);
    els.forEach(el => el.remove());
  }

  function injectOverlay(doc, elementCount) {
    if (isAlreadyInjected(doc)) return;
    for (let i = 0; i < elementCount; i++) {
      const el = createMockElement('div');
      el.className = 'seerr-card-badge';
      el.setAttribute(MARKER, 'true');
      doc.body.appendChild(el);
    }
  }

  // ── Initial page load: inject 3 badges ──
  const doc1 = createMockDocument();
  injectOverlay(doc1, 3);
  assert.strictEqual(
    doc1.elements.filter(el => !el._removed && el.hasAttribute(MARKER)).length,
    3,
    'Initial page load should have 3 overlay elements'
  );

  // ── Navigate forward (SPA): cleanup old + inject 5 badges ──
  cleanupOverlay(doc1);
  injectOverlay(doc1, 5);
  assert.strictEqual(
    doc1.elements.filter(el => !el._removed && el.hasAttribute(MARKER)).length,
    5,
    'After forward nav, should have 5 overlay elements (not 8)'
  );

  // ── Navigate back (SPA): cleanup old + inject 3 badges ──
  cleanupOverlay(doc1);
  injectOverlay(doc1, 3);
  assert.strictEqual(
    doc1.elements.filter(el => !el._removed && el.hasAttribute(MARKER)).length,
    3,
    'After back nav, should have 3 overlay elements (not 11)'
  );

  // ── Verify no duplicates: inject again without cleanup ──
  injectOverlay(doc1, 3);
  assert.strictEqual(
    doc1.elements.filter(el => !el._removed && el.hasAttribute(MARKER)).length,
    3,
    'Idempotent guard: re-inject without cleanup should not duplicate'
  );
});

test('SPA nav regression: rapid navigation does not leak elements', () => {
  const MARKER = 'data-seerr-overlay';

  function isAlreadyInjected(doc) {
    return !!doc.querySelector('[data-seerr-overlay="true"]');
  }

  function cleanupOverlay(doc) {
    const els = [...doc.querySelectorAll('[data-seerr-overlay="true"]')].filter(Boolean);
    els.forEach(el => el.remove());
  }

  function injectOverlay(doc, name) {
    if (isAlreadyInjected(doc)) return;
    const el = createMockElement('div');
    el.className = `seerr-${name}`;
    el.setAttribute(MARKER, 'true');
    doc.body.appendChild(el);
  }

  const doc = createMockDocument();

  // Simulate 10 rapid navigations between different routes
  for (let i = 0; i < 10; i++) {
    cleanupOverlay(doc);
    injectOverlay(doc, `route-${i}`);
    assert.strictEqual(
      doc.elements.filter(el => !el._removed && el.hasAttribute(MARKER)).length,
      1,
      `Navigation ${i}: should have exactly 1 overlay element`
    );
  }

  // No leaked elements
  const finalCount = doc.elements.filter(el => !el._removed && el.hasAttribute(MARKER)).length;
  assert.strictEqual(finalCount, 1, 'After 10 navigations, should still have exactly 1 overlay element');

  // Total elements (including removed ones) should be manageable
  assert.ok(doc.elements.length <= 20, 'Total element churn should be bounded');
});

test('SPA nav regression: cleanup removes only overlay elements', () => {
  const MARKER = 'data-seerr-overlay';

  function cleanupOverlay(doc) {
    const els = [...doc.querySelectorAll('[data-seerr-overlay="true"]')].filter(Boolean);
    els.forEach(el => el.remove());
  }

  const doc = createMockDocument();

  // Add non-overlay elements (simulating native Seerr UI)
  const nativeEl = createMockElement('div');
  nativeEl.className = 'seerr-native-card';
  doc.body.appendChild(nativeEl);

  // Add overlay element
  const overlayEl = createMockElement('span');
  overlayEl.className = 'seerr-card-badge';
  overlayEl.setAttribute(MARKER, 'true');
  doc.body.appendChild(overlayEl);

  assert.strictEqual(doc.elements.length, 2);

  cleanupOverlay(doc);

  // Native element should survive, overlay should be removed
  const overlaySurvivors = doc.elements.filter(el => !el._removed && el.hasAttribute(MARKER));
  assert.strictEqual(overlaySurvivors.length, 0, 'No overlay elements should survive cleanup');
  
  const nativeSurvivors = doc.elements.filter(el => !el._removed && !el.hasAttribute(MARKER));
  assert.strictEqual(nativeSurvivors.length, 1, 'Native element should survive cleanup');
});
