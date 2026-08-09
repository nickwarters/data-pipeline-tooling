// @ts-check
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { loadReportFeed } from '../src/services/report-feed-loader.js';

const envelope = {
  schema_version: 1,
  reviewer_account: '123456',
  generated_at: '2026-08-09T04:15:00+00:00',
  complete_through: '2026-08-08',
  rows: [],
};

/** @param {number} status @param {unknown} [body] */
function response(status, body = envelope) {
  return /** @type {Response} */ ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

test('Report Feed loader lower-cases its filename, scopes it to the site, and forwards the signal', async () => {
  const controller = new AbortController();
  const globals = /** @type {Record<string, unknown>} */ (globalThis);
  /** @type {string | undefined} */
  let requestedUrl;
  /** @type {RequestInit | undefined} */
  let requestedOptions;

  globals._spPageContextInfo = { webServerRelativeUrl: '/sites/cora' };
  try {
    const result = await loadReportFeed('MiXeD', {
      fetch: async (url, options) => {
        requestedUrl = String(url);
        requestedOptions = options;
        return response(200);
      },
      search: '',
      signal: controller.signal,
    });

    assert.equal(
      requestedUrl,
      '/sites/cora/Shared%20Documents/cora_report_feeds/my-stats/mixed.txt'
    );
    assert.equal(requestedOptions?.signal, controller.signal);
    assert.equal(result, envelope);
    assert.ok(!requestedUrl?.includes('Style%20Library'));
  } finally {
    delete globals._spPageContextInfo;
  }
});

test('Report Feed loader returns null for a missing feed', async () => {
  const result = await loadReportFeed('reviewer', {
    fetch: async () => response(404),
    hostWebUrl: '/sites/cora',
    search: '',
  });

  assert.equal(result, null);
});

test('Report Feed loader rejects non-404 HTTP failures', async () => {
  await assert.rejects(
    loadReportFeed('reviewer', {
      fetch: async () => response(500),
      hostWebUrl: '/sites/cora',
      search: '',
    }),
    /HTTP 500/
  );
});

test('Report Feed loader propagates network failures', async () => {
  const failure = new TypeError('network unavailable');

  await assert.rejects(
    loadReportFeed('reviewer', {
      fetch: async () => {
        throw failure;
      },
      hostWebUrl: '/sites/cora',
      search: '',
    }),
    (error) => error === failure
  );
});

test('Report Feed loader rejects malformed JSON', async () => {
  await assert.rejects(
    loadReportFeed('reviewer', {
      fetch: async () =>
        /** @type {Response} */ (
          /** @type {unknown} */ ({
            status: 200,
            ok: true,
            json: async () => {
              throw new SyntaxError('Unexpected token');
            },
          })
        ),
      hostWebUrl: '/sites/cora',
      search: '',
    }),
    SyntaxError
  );
});

test('Report Feed loader rejects an unsupported schema version', async () => {
  await assert.rejects(
    loadReportFeed('reviewer', {
      fetch: async () => response(200, { schema_version: 2 }),
      hostWebUrl: '/sites/cora',
      search: '',
    }),
    /Unsupported Report Feed schema version/
  );
});

test('Report Feed loader propagates an aborted fetch', async () => {
  const abort = Object.assign(new Error('navigation'), { name: 'AbortError' });

  await assert.rejects(
    loadReportFeed('reviewer', {
      fetch: async () => {
        throw abort;
      },
      hostWebUrl: '/sites/cora',
      search: '',
    }),
    (error) => error === abort
  );
});

test('Report Feed loader selects the canonical mock fixture regardless of account', async () => {
  /** @type {string | undefined} */
  let requestedUrl;

  await loadReportFeed('SomeoneElse', {
    fetch: async (url) => {
      requestedUrl = String(url);
      return response(200);
    },
    hostWebUrl: '/sites/cora',
    search: '?mock=1',
  });

  if (!requestedUrl) throw new Error('the mock fetch did not receive a URL');
  assert.equal(
    fileURLToPath(requestedUrl),
    fileURLToPath(
      new URL('../dev/fixtures/my-stats/123456.txt', import.meta.url)
    )
  );
  assert.ok(existsSync(fileURLToPath(requestedUrl)));
});
