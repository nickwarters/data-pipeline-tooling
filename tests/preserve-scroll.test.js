// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scrollContainer,
  readScroll,
  writeScroll,
  withPreservedScroll,
} from '../src/lib/preserve-scroll.js';

test('scrollContainer: returns the app root when present', () => {
  const root = { getAttribute: () => '' };
  /** @type {any} */ (globalThis).document = {
    querySelector: (/** @type {string} */ sel) =>
      sel === '#app[data-cora-root]' ? root : null,
  };
  try {
    assert.equal(scrollContainer(), root);
  } finally {
    delete (/** @type {any} */ (globalThis).document);
  }
});

test('scrollContainer: falls back to window when there is no app root', () => {
  /** @type {any} */ (globalThis).document = {
    querySelector: () => null,
  };
  /** @type {any} */ (globalThis).window = { marker: 'window' };
  try {
    assert.equal(scrollContainer(), globalThis.window);
  } finally {
    delete (/** @type {any} */ (globalThis).document);
    delete (/** @type {any} */ (globalThis).window);
  }
});

test('scrollContainer: returns null outside a browser (no document, no window)', () => {
  const hadDocument = 'document' in globalThis;
  const hadWindow = 'window' in globalThis;
  const savedDocument = /** @type {any} */ (globalThis).document;
  const savedWindow = /** @type {any} */ (globalThis).window;
  delete (/** @type {any} */ (globalThis).document);
  delete (/** @type {any} */ (globalThis).window);
  try {
    assert.equal(scrollContainer(), null);
  } finally {
    if (hadDocument) /** @type {any} */ (globalThis).document = savedDocument;
    if (hadWindow) /** @type {any} */ (globalThis).window = savedWindow;
  }
});

test('readScroll/writeScroll: element shape uses scrollLeft/scrollTop', () => {
  const el = /** @type {any} */ ({ scrollLeft: 3, scrollTop: 7 });
  assert.deepEqual(readScroll(el), { left: 3, top: 7 });
  writeScroll(el, 10, 20);
  assert.equal(el.scrollLeft, 10);
  assert.equal(el.scrollTop, 20);
});

test('readScroll/writeScroll: window shape uses scrollX/scrollY/scrollTo', () => {
  let scrollX = 1;
  let scrollY = 2;
  const win = /** @type {any} */ ({
    get scrollX() {
      return scrollX;
    },
    get scrollY() {
      return scrollY;
    },
    scrollTo(/** @type {number} */ x, /** @type {number} */ y) {
      scrollX = x;
      scrollY = y;
    },
  });
  assert.deepEqual(readScroll(win), { left: 1, top: 2 });
  writeScroll(win, 5, 6);
  assert.equal(scrollX, 5);
  assert.equal(scrollY, 6);
});

test('withPreservedScroll: restores container scrollTop/scrollLeft when the wrapped fn changes them', () => {
  const container = {
    getAttribute: () => '',
    scrollLeft: 0,
    scrollTop: 500,
  };
  /** @type {any} */ (globalThis).document = {
    querySelector: (/** @type {string} */ sel) =>
      sel === '#app[data-cora-root]' ? container : null,
  };
  try {
    withPreservedScroll(() => {
      container.scrollLeft = 40;
      container.scrollTop = 0;
    });
    // Either coordinate changing triggers a full restore of both to their
    // original snapshot (see writeScroll — it always writes left and top
    // together), so scrollLeft goes back to 0 too.
    assert.equal(container.scrollTop, 500, 'top restored');
    assert.equal(container.scrollLeft, 0, 'left restored alongside top');
  } finally {
    delete (/** @type {any} */ (globalThis).document);
  }
});

test('withPreservedScroll: leaves scroll untouched when the wrapped fn does not change it', () => {
  const container = {
    getAttribute: () => '',
    scrollLeft: 0,
    scrollTop: 500,
  };
  let writeCalls = 0;
  const originalWriteLeft = Object.getOwnPropertyDescriptor(
    container,
    'scrollLeft'
  );
  Object.defineProperty(container, 'scrollTop', {
    get() {
      return 500;
    },
    set() {
      writeCalls++;
    },
  });
  /** @type {any} */ (globalThis).document = {
    querySelector: (/** @type {string} */ sel) =>
      sel === '#app[data-cora-root]' ? container : null,
  };
  try {
    withPreservedScroll(() => {
      // No-op: scroll offsets are unchanged.
    });
    assert.equal(writeCalls, 0, 'no write when nothing changed');
  } finally {
    delete (/** @type {any} */ (globalThis).document);
    if (originalWriteLeft)
      Object.defineProperty(container, 'scrollLeft', originalWriteLeft);
  }
});

test('withPreservedScroll: window fallback path restores scrollY via scrollTo', () => {
  /** @type {any} */ (globalThis).document = {
    querySelector: () => null,
  };
  let scrollY = 500;
  /** @type {any} */ (globalThis).window = {
    scrollX: 0,
    get scrollY() {
      return scrollY;
    },
    scrollTo(/** @type {number} */ _x, /** @type {number} */ y) {
      scrollY = y;
    },
  };
  try {
    withPreservedScroll(() => {
      scrollY = 0;
    });
    assert.equal(scrollY, 500, 'window scroll restored');
  } finally {
    delete (/** @type {any} */ (globalThis).document);
    delete (/** @type {any} */ (globalThis).window);
  }
});

test('withPreservedScroll: no-op outside a browser (no scroll container available)', () => {
  const hadDocument = 'document' in globalThis;
  const hadWindow = 'window' in globalThis;
  const savedDocument = /** @type {any} */ (globalThis).document;
  const savedWindow = /** @type {any} */ (globalThis).window;
  delete (/** @type {any} */ (globalThis).document);
  delete (/** @type {any} */ (globalThis).window);
  try {
    let ran = false;
    withPreservedScroll(() => {
      ran = true;
    });
    assert.equal(ran, true, 'the mutate function still runs');
  } finally {
    if (hadDocument) /** @type {any} */ (globalThis).document = savedDocument;
    if (hadWindow) /** @type {any} */ (globalThis).window = savedWindow;
  }
});
