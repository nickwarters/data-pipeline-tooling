// @ts-check
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isolateBrowserGlobals } from './helpers/browser-globals.js';

import {
  loadReportFeed,
  loadReportFile,
} from '../src/services/report-feed-loader.js';

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

test('Report Feed loader lower-cases and encodes its filename, scopes it to the site, and forwards the signal', async () => {
  const controller = new AbortController();
  const globals = /** @type {Record<string, unknown>} */ (globalThis);
  /** @type {string | undefined} */
  let requestedUrl;
  /** @type {RequestInit | undefined} */
  let requestedOptions;

  globals._spPageContextInfo = { webServerRelativeUrl: '/sites/cora' };
  try {
    const result = await loadReportFeed('Mi XeD', {
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
      '/sites/cora/Shared%20Documents/cora_report_feeds/my-stats/mi%20xed.txt'
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

const reportEnvelope = {
  schema_version: 1,
  report: 'case-type',
  generated_at: '2026-10-07T04:15:00+00:00',
  complete_through: '2026-10-06',
  datasets: { backlog_daily: [] },
};

test('a report file is read from its own path under the report-feed library, with the signal forwarded', async () => {
  const controller = new AbortController();
  /** @type {string | undefined} */
  let requestedUrl;
  /** @type {RequestInit | undefined} */
  let requestedOptions;

  const result = await loadReportFile('case-types/Two Words/case-type.txt', {
    schemaVersion: 1,
    fetch: async (url, options) => {
      requestedUrl = String(url);
      requestedOptions = options;
      return response(200, reportEnvelope);
    },
    search: '',
    signal: controller.signal,
    hostWebUrl: '/sites/cora/',
  });

  assert.equal(
    requestedUrl,
    '/sites/cora/Shared%20Documents/cora_report_feeds/case-types/Two%20Words/case-type.txt'
  );
  assert.equal(requestedOptions?.signal, controller.signal);
  assert.deepEqual(result, { status: 'loaded', envelope: reportEnvelope });
});

test('a report file resolves against the host site when no site URL is given', async () => {
  const globals = /** @type {Record<string, unknown>} */ (globalThis);
  /** @type {string | undefined} */
  let requestedUrl;
  globals._spPageContextInfo = { webServerRelativeUrl: '/sites/cora' };
  try {
    await loadReportFile('case-types/complaints/case-type.txt', {
      schemaVersion: 1,
      fetch: async (url) => {
        requestedUrl = String(url);
        return response(200, reportEnvelope);
      },
      search: '',
    });
  } finally {
    delete globals._spPageContextInfo;
  }
  assert.equal(
    requestedUrl,
    '/sites/cora/Shared%20Documents/cora_report_feeds/case-types/complaints/case-type.txt'
  );
});

test('a report file that has not been published is missing, not a failure', async () => {
  const result = await loadReportFile('case-types/complaints/case-type.txt', {
    schemaVersion: 1,
    fetch: async () => response(404),
    search: '',
    hostWebUrl: '/sites/cora',
  });
  assert.deepEqual(result, { status: 'missing' });
});

for (const status of [401, 403]) {
  test(`a report file in a folder the viewer cannot read (HTTP ${status}) is forbidden, not a failure`, async () => {
    const result = await loadReportFile('case-types/complaints/case-type.txt', {
      schemaVersion: 1,
      fetch: async () => response(status),
      search: '',
      hostWebUrl: '/sites/cora',
    });
    assert.deepEqual(result, { status: 'forbidden' });
  });
}

test('a report file request that fails any other way rejects', async () => {
  await assert.rejects(
    loadReportFile('case-types/complaints/case-type.txt', {
      schemaVersion: 1,
      fetch: async () => response(500),
      search: '',
      hostWebUrl: '/sites/cora',
    }),
    /HTTP 500/
  );
});

test('a report file written for another schema version is refused', async () => {
  await assert.rejects(
    loadReportFile('case-types/complaints/case-type.txt', {
      schemaVersion: 2,
      fetch: async () => response(200, reportEnvelope),
      search: '',
      hostWebUrl: '/sites/cora',
    }),
    /schema version/
  );
});

for (const datasets of [undefined, null, [], 'rows']) {
  test(`a report file whose datasets are ${JSON.stringify(datasets) ?? 'absent'} is refused`, async () => {
    await assert.rejects(
      loadReportFile('case-types/complaints/case-type.txt', {
        schemaVersion: 1,
        fetch: async () => response(200, { ...reportEnvelope, datasets }),
        search: '',
        hostWebUrl: '/sites/cora',
      }),
      /no datasets/
    );
  });
}

for (const path of [
  '/case-types/complaints/case-type.txt',
  'case-types/../my-stats/123456.txt',
  'case-types//case-type.txt',
]) {
  test(`a report file path that is not a plain relative path (${path}) is refused before any request`, async () => {
    let requested = false;
    await assert.rejects(
      loadReportFile(path, {
        schemaVersion: 1,
        fetch: async () => {
          requested = true;
          return response(200, reportEnvelope);
        },
        search: '',
        hostWebUrl: '/sites/cora',
      }),
      TypeError
    );
    assert.equal(requested, false);
  });
}

test('in mock mode a report file is read from the same path under the dev fixtures', async () => {
  /** @type {string | undefined} */
  let requestedUrl;
  await loadReportFile('case-types/complaints/case-type.txt', {
    schemaVersion: 1,
    fetch: async (url) => {
      requestedUrl = String(url);
      return response(200, reportEnvelope);
    },
    search: '?mock=1',
  });
  if (!requestedUrl) throw new Error('the mock fetch did not receive a URL');
  assert.equal(
    fileURLToPath(requestedUrl),
    fileURLToPath(
      new URL(
        '../dev/fixtures/reports/case-types/complaints/case-type.txt',
        import.meta.url
      )
    )
  );
  assert.ok(existsSync(fileURLToPath(requestedUrl)));
});

test('a report file is read with the page’s own fetch and URL when none are given', async () => {
  isolateBrowserGlobals(['fetch', 'location']);
  const globals = /** @type {Record<string, any>} */ (globalThis);
  /** @type {string | undefined} */
  let requestedUrl;
  globals.fetch = async (/** @type {string} */ url) => {
    requestedUrl = String(url);
    return response(200, reportEnvelope);
  };
  globals.location = { search: '?mock=1' };
  const result = await loadReportFile('case-types/complaints/case-type.txt', {
    schemaVersion: 1,
  });
  assert.equal(result.status, 'loaded');
  assert.match(
    String(requestedUrl),
    /dev\/fixtures\/reports\/case-types\/complaints\/case-type\.txt$/
  );

  delete globals.location;
  await loadReportFile('case-types/complaints/case-type.txt', {
    schemaVersion: 1,
    hostWebUrl: '/sites/cora',
  });
  assert.match(String(requestedUrl), /^\/sites\/cora\/Shared%20Documents\//);
});
