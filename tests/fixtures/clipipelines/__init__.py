"""Throwaway pipeline packages for exercising the operator CLI in isolation.

These exist so the CLI tests (`tests/framework/_cli/`) can drive the
`python -m cli run <path>` machinery -- path -> module resolution, run
recording, freshness gating, exit codes -- without depending on the behaviour of
the real application pipelines under `pipelines/` (whose own coverage lives in
`tests/pipelines/` and `tests/integration/`). The tests put this package's
parent (`tests/fixtures/`) on PYTHONPATH for the subprocess and address these
pipelines by path, e.g. `clipipelines/_source`.

The package is named `clipipelines` (not `pipelines`) so it can never collide
with the repo's real `pipelines` package on `sys.path`.
"""
