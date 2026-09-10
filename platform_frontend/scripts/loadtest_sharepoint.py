#!/usr/bin/env python3
"""Drive concurrent Case edits against a real SharePoint site and find the knee.

Simulates N virtual users, each looping over its own disjoint slice of Case ids
and PATCHing a rotating field, the way the app does it: GET the item, then PATCH
it back with `If-Match` on the ETag it just read. Every request is timed and
classified, so the run answers one question — at what concurrency does the site
start returning something other than a 2xx, and how slow was it by then.

All traffic authenticates as *you*. This simulates concurrent editing, not
concurrent people: per-user permission caches, per-account throttle buckets and
row-level ACL evaluation all behave differently for one account issuing 20
parallel writes than for 20 accounts issuing one each. Read the result as a
ceiling on what your account plus the server can sustain, not as a user count.

Auth follows the same convention as ``uat_acl_smoke.js``: a JSON file of request
headers for an authenticated session (``{"Cookie": "FedAuth=..."}`` on SE, or
``{"Authorization": "Bearer ..."}``), kept outside the repository and named by
``--headers-file`` or ``$CORA_LOADTEST_HEADERS_FILE``.

The run mutates real rows. It writes only to free-text fields, records each
row's original value the first time it touches it, and restores those values at
the end unless ``--no-restore`` is passed. It refuses a list whose name lacks
the configured environment prefix, so a mistyped command cannot hit prod.

Standard library only, Windows and macOS alike.

Examples::

    python3 scripts/loadtest_sharepoint.py \\
        --site-url https://sharepoint.example/sites/cora \\
        --list uat_Cases-Complaints --discover 40 \\
        --users 8 --duration 120

    # Ramp 1 -> 40 users, adding one every 5s, stopping at the first hard error.
    python3 scripts/loadtest_sharepoint.py ... --ramp-to 40 --ramp-every 5 \\
        --stop-on-error --csv /tmp/loadtest.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ACCEPT_JSON = "application/json;odata=nometadata"
CONTENT_TYPE_JSON = "application/json;odata=nometadata;charset=utf-8"

# Free-text Case columns with no lifecycle meaning: churning them changes no
# state the app reasons about and no report reads. Any other column needs
# --allow-any-field and a moment's thought about what writes to it downstream.
SAFE_FIELDS = ("Notes", "CaseJustification")

# Non-production lists carry their environment's prefix (ADR-0033). Prod's are
# unprefixed, which is exactly why the default here is not empty.
DEFAULT_LIST_PREFIX = "uat_"

# Statuses that mean "the server asked you to slow down" rather than "the
# request was wrong". Counted apart from errors: a throttle is a healthy server
# defending itself, and it is usually the first thing you will see.
THROTTLE_STATUSES = (429, 503)
DEFAULT_THROTTLE_MS = 1000


# --- request plumbing ------------------------------------------------------


@dataclass
class Response:
    status: int  # 0 means the request never got a reply (timeout, reset, DNS)
    headers: dict[str, str]
    body: bytes

    def json(self) -> dict[str, Any]:
        try:
            return json.loads(self.body.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            return {}

    @property
    def detail(self) -> str:
        if self.status == 0:
            return self.body.decode("utf-8", "replace")[:200]
        payload = self.json()
        error = payload.get("error") or payload.get("odata.error") or {}
        message = error.get("message")
        if isinstance(message, dict):
            message = message.get("value")
        return str(message or "")[:200]


class Session:
    """One virtual user's connection to the site: its own digest, its own
    opener, and therefore its own connection reuse. Never shared between
    threads — sharing one would measure a lock, not the server."""

    def __init__(self, site_url: str, headers: dict[str, str], timeout: float):
        self._site = site_url.rstrip("/")
        self._headers = headers
        self._timeout = timeout
        self._opener = urllib.request.build_opener()
        self._digest = ""

    def send(
        self,
        url: str,
        method: str = "GET",
        extra: dict[str, str] | None = None,
        body: bytes | None = None,
    ) -> Response:
        request = urllib.request.Request(url, data=body, method=method)
        for name, value in {**self._headers, **(extra or {})}.items():
            request.add_header(name, value)
        try:
            with self._opener.open(request, timeout=self._timeout) as res:
                return Response(res.status, dict(res.headers), res.read())
        except urllib.error.HTTPError as err:
            return Response(err.code, dict(err.headers), err.read())
        except Exception as err:  # timeout, connection reset, DNS, TLS
            return Response(0, {}, f"{type(err).__name__}: {err}".encode())

    def digest(self, refresh: bool = False) -> str:
        """The `X-RequestDigest` every write carries. Fetched lazily and
        refreshed on 403, exactly as the browser client does."""
        if self._digest and not refresh:
            return self._digest
        res = self.send(
            f"{self._site}/_api/contextinfo",
            "POST",
            {"Accept": ACCEPT_JSON, "Content-Length": "0"},
            b"",
        )
        payload = res.json()
        value = payload.get("FormDigestValue") or (
            payload.get("d", {})
            .get("GetContextWebInformation", {})
            .get("FormDigestValue")
        )
        if not value:
            raise RuntimeError(
                f"Could not get a form digest (HTTP {res.status}). "
                f"{res.detail or 'Check the headers file is a live session.'}"
            )
        self._digest = value
        return value

    def get(self, url: str) -> Response:
        return self.send(url, "GET", {"Accept": ACCEPT_JSON})

    def patch(self, url: str, etag: str, payload: dict[str, Any]) -> Response:
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Accept": ACCEPT_JSON,
            "Content-Type": CONTENT_TYPE_JSON,
            "X-RequestDigest": self.digest(),
            "If-Match": etag or "*",
        }
        res = self.send(url, "PATCH", headers, body)
        if res.status == 403:
            # A stale digest and a genuine permission failure share a status;
            # refresh once and let the retry tell them apart.
            headers["X-RequestDigest"] = self.digest(refresh=True)
            res = self.send(url, "PATCH", headers, body)
        return res


def list_url(site_url: str, list_name: str) -> str:
    quoted = urllib.parse.quote(list_name.replace("'", "''"), safe="")
    return f"{site_url.rstrip('/')}/_api/web/lists/getbytitle('{quoted}')"


def item_url(site_url: str, list_name: str, item_id: int) -> str:
    return f"{list_url(site_url, list_name)}/items({int(item_id)})"


def read_etag(res: Response) -> str:
    header = res.headers.get("ETag") or res.headers.get("etag")
    if header:
        return header
    value = res.json().get("odata.etag")
    return value if isinstance(value, str) else ""


# --- the run ---------------------------------------------------------------


@dataclass
class Sample:
    at: float  # seconds since the run started
    user: int
    phase: str  # "read" or "write"
    item_id: int
    column: str
    status: int
    ms: float
    concurrency: int
    detail: str = ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def throttled(self) -> bool:
        return self.status in THROTTLE_STATUSES


@dataclass
class Run:
    started: float
    deadline: float
    max_errors: int
    stop_on_error: bool
    stop: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    samples: list[Sample] = field(default_factory=list)
    baselines: dict[tuple[int, str], Any] = field(default_factory=dict)
    active: int = 0
    peak_active: int = 0
    errors: int = 0
    throttles: int = 0
    first_error: Sample | None = None
    first_throttle: Sample | None = None

    def elapsed(self) -> float:
        return time.monotonic() - self.started

    def enter(self) -> None:
        with self.lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)

    def leave(self) -> None:
        with self.lock:
            self.active -= 1

    def record(self, sample: Sample) -> None:
        with self.lock:
            self.samples.append(sample)
            if sample.throttled:
                self.throttles += 1
                self.first_throttle = self.first_throttle or sample
            elif not sample.ok:
                self.errors += 1
                self.first_error = self.first_error or sample
                if self.stop_on_error or self.errors >= self.max_errors:
                    self.stop.set()

    def remember(self, item_id: int, column: str, value: Any) -> None:
        with self.lock:
            self.baselines.setdefault((item_id, column), value)

    def finished(self) -> bool:
        return self.stop.is_set() or time.monotonic() >= self.deadline


def worker(index: int, ids: list[int], columns: list[str], args, run: Run) -> None:
    """One virtual user. Owns its slice of ids, so two users never collide on
    the same row — a 412 in the results is then real contention, not this
    script racing itself."""
    delay = index * args.ramp_every
    if run.stop.wait(delay) or time.monotonic() >= run.deadline:
        return
    session = Session(args.site_url, args.headers, args.timeout)
    rng = random.Random(index)
    run.enter()
    try:
        iteration = 0
        while not run.finished():
            item_id = ids[iteration % len(ids)]
            # Offset by the user index so concurrent users are writing to
            # different columns of different rows at the same instant.
            column = columns[(iteration + index) % len(columns)]
            iteration += 1

            started = time.monotonic()
            res = session.get(
                f"{item_url(args.site_url, args.list_name, item_id)}"
                f"?$select=Id,{urllib.parse.quote(column)}"
            )
            run.record(
                Sample(
                    run.elapsed(),
                    index,
                    "read",
                    item_id,
                    column,
                    res.status,
                    (time.monotonic() - started) * 1000,
                    run.active,
                    res.detail,
                )
            )
            if not (200 <= res.status < 300):
                backoff(res, run, args)
                continue

            run.remember(item_id, column, res.json().get(column))

            if not args.dry_run:
                value = (
                    f"loadtest u{index} #{iteration} "
                    f"{time.strftime('%Y-%m-%dT%H:%M:%S')}"
                )
                started = time.monotonic()
                res = session.patch(
                    item_url(args.site_url, args.list_name, item_id),
                    read_etag(res),
                    {column: value},
                )
                run.record(
                    Sample(
                        run.elapsed(),
                        index,
                        "write",
                        item_id,
                        column,
                        res.status,
                        (time.monotonic() - started) * 1000,
                        run.active,
                        res.detail,
                    )
                )
                if not (200 <= res.status < 300):
                    backoff(res, run, args)
                    continue

            if args.think_time:
                run.stop.wait(rng.uniform(0, 2 * args.think_time))
    except Exception as err:  # a dead worker must not look like a quiet one
        run.record(
            Sample(
                run.elapsed(), index, "worker", 0, "", 0, 0.0, run.active, str(err)
            )
        )
    finally:
        run.leave()


def backoff(res: Response, run: Run, args) -> None:
    """Honour Retry-After on a throttle. The throttle is already recorded — the
    point of the pause is not to keep hammering a server that just said no."""
    if res.status not in THROTTLE_STATUSES:
        run.stop.wait(args.think_time)
        return
    header = res.headers.get("Retry-After", "")
    try:
        seconds = float(header)
    except ValueError:
        seconds = DEFAULT_THROTTLE_MS / 1000
    run.stop.wait(min(max(seconds, 0.0), 30.0))


def progress(run: Run, args) -> None:
    last = 0
    while not run.finished():
        run.stop.wait(1.0)
        with run.lock:
            total = len(run.samples)
            recent = run.samples[last:]
            active, errors, throttles = run.active, run.errors, run.throttles
        last = total
        rps = len(recent)
        oks = [s.ms for s in recent if s.ok]
        p95 = percentile(sorted(oks), 95) if oks else 0.0
        sys.stderr.write(
            f"\r{run.elapsed():6.0f}s  users={active:3d}  {rps:4d} req/s  "
            f"p95={p95:7.0f}ms  errors={errors:4d}  throttled={throttles:4d}   "
        )
        sys.stderr.flush()
    sys.stderr.write("\n")


def percentile(ordered: list[float], pct: float) -> float:
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, int(round((pct / 100) * (len(ordered) - 1))))
    return ordered[index]


# --- setup and reporting ---------------------------------------------------


def load_headers(path: str | None) -> dict[str, str]:
    source = path or os.environ.get("CORA_LOADTEST_HEADERS_FILE")
    if not source:
        raise SystemExit(
            "Pass --headers-file (or set CORA_LOADTEST_HEADERS_FILE) to a JSON "
            'file of session headers, e.g. {"Cookie": "FedAuth=..."}.'
        )
    raw = json.loads(Path(source).read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise SystemExit(f"{source} must be a non-empty JSON object of headers.")
    if not all(isinstance(v, str) for v in raw.values()):
        raise SystemExit(f"{source}: every header value must be a string.")
    return dict(raw)


def discover_ids(args, count: int) -> list[int]:
    session = Session(args.site_url, args.headers, args.timeout)
    url = (
        f"{list_url(args.site_url, args.list_name)}/items"
        f"?$select=Id&$top={int(count)}&$orderby=Id"
    )
    res = session.get(url)
    if not (200 <= res.status < 300):
        raise SystemExit(
            f"Could not list items (HTTP {res.status}). {res.detail}"
        )
    rows = res.json().get("value") or res.json().get("d", {}).get("results") or []
    ids = [int(row["Id"]) for row in rows if "Id" in row]
    if not ids:
        raise SystemExit(f"{args.list_name} returned no items to work on.")
    return ids


def restore(args, run: Run) -> None:
    """Put every touched row back the way it was found. Best effort and
    reported: a row this fails on is a row left carrying a marker."""
    if not run.baselines:
        return
    session = Session(args.site_url, args.headers, args.timeout)
    failures = 0
    for (item_id, column), value in run.baselines.items():
        res = session.patch(
            item_url(args.site_url, args.list_name, item_id), "*", {column: value}
        )
        if not (200 <= res.status < 300):
            failures += 1
            print(
                f"  restore FAILED item {item_id} {column}: "
                f"HTTP {res.status} {res.detail}"
            )
    print(
        f"Restored {len(run.baselines) - failures}/{len(run.baselines)} "
        "touched values."
    )


def report(run: Run, args) -> None:
    samples = run.samples
    if not samples:
        print("No requests were made.")
        return
    duration = max(samples[-1].at, 0.001)
    statuses: dict[int, int] = {}
    for sample in samples:
        statuses[sample.status] = statuses.get(sample.status, 0) + 1

    print()
    print(f"{'=' * 68}")
    print(f"list                {args.list_name}")
    print(f"duration            {duration:.1f}s")
    print(f"peak virtual users  {run.peak_active}")
    print(f"requests            {len(samples)}  ({len(samples) / duration:.1f}/s)")
    print(f"errors              {run.errors}")
    print(f"throttled           {run.throttles}")
    print()
    print("status codes        " + ", ".join(
        f"{'transport-fail' if code == 0 else code}={n}"
        for code, n in sorted(statuses.items())
    ))
    print()
    for phase in ("read", "write"):
        ok = sorted(s.ms for s in samples if s.phase == phase and s.ok)
        if not ok:
            continue
        print(
            f"{phase:<6} n={len(ok):<6} "
            f"p50={percentile(ok, 50):7.0f}ms  p90={percentile(ok, 90):7.0f}ms  "
            f"p95={percentile(ok, 95):7.0f}ms  p99={percentile(ok, 99):7.0f}ms  "
            f"max={ok[-1]:7.0f}ms"
        )
    print()
    if run.first_throttle:
        s = run.first_throttle
        print(
            f"first throttle      {s.at:.1f}s in, at {s.concurrency} concurrent "
            f"users — HTTP {s.status} on {s.phase}"
        )
    if run.first_error:
        s = run.first_error
        print(
            f"first error         {s.at:.1f}s in, at {s.concurrency} concurrent "
            f"users — HTTP {s.status} on {s.phase} of item {s.item_id}"
        )
        if s.detail:
            print(f"                    {s.detail}")
    if not run.first_error and not run.first_throttle:
        print(
            f"No errors at {run.peak_active} concurrent users — "
            "raise --users / --ramp-to and run it again."
        )
    print(f"{'=' * 68}")


def write_csv(path: str, samples: list[Sample]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            ["at_s", "user", "phase", "item_id", "column", "status", "ms",
             "concurrency", "detail"]
        )
        for s in samples:
            writer.writerow(
                [f"{s.at:.3f}", s.user, s.phase, s.item_id, s.column, s.status,
                 f"{s.ms:.1f}", s.concurrency, s.detail]
            )
    print(f"Per-request samples written to {path}")


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n")[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--site-url", required=True, help="e.g. https://host/sites/cora")
    parser.add_argument("--list", dest="list_name", required=True,
                        help="Full list title, prefix included (uat_Cases-Complaints)")
    parser.add_argument("--headers-file", help="JSON headers for an authenticated session")
    parser.add_argument("--ids", help="Comma-separated item ids to work over")
    parser.add_argument("--discover", type=int, default=0,
                        help="Read this many item ids from the list instead")
    parser.add_argument("--users", type=int, default=5, help="Virtual users (default 5)")
    parser.add_argument("--ramp-to", type=int, default=0,
                        help="Ramp from 1 to this many users instead of --users")
    parser.add_argument("--ramp-every", type=float, default=0.0,
                        help="Seconds between adding each user (default 0)")
    parser.add_argument("--duration", type=float, default=60.0, help="Seconds (default 60)")
    parser.add_argument("--field", dest="fields", action="append", default=[],
                        help=f"Column to write; repeatable. Default {list(SAFE_FIELDS)}")
    parser.add_argument("--allow-any-field", action="store_true",
                        help="Permit a column outside the free-text safe list")
    parser.add_argument("--think-time", type=float, default=1.0,
                        help="Mean pause between a user's iterations (default 1s)")
    parser.add_argument("--timeout", type=float, default=30.0, help="Per-request seconds")
    parser.add_argument("--require-prefix", default=DEFAULT_LIST_PREFIX,
                        help="Refuse a list without this prefix ('' to allow any)")
    parser.add_argument("--stop-on-error", action="store_true",
                        help="Stop at the first non-throttle error")
    parser.add_argument("--max-errors", type=int, default=50, help="Error budget")
    parser.add_argument("--no-restore", action="store_true",
                        help="Leave the marker values in place")
    parser.add_argument("--dry-run", action="store_true",
                        help="Reads only — measures GET capacity, writes nothing")
    parser.add_argument("--csv", help="Write every request to this CSV")
    args = parser.parse_args(argv)

    if args.require_prefix and not args.list_name.startswith(args.require_prefix):
        raise SystemExit(
            f"Refusing to load-test '{args.list_name}': it does not start with "
            f"'{args.require_prefix}'. Point at a non-production list, or pass "
            "--require-prefix '' if you really mean this one."
        )
    if not args.require_prefix:
        print(f"WARNING: no list prefix required — writing to {args.list_name}.")

    args.fields = args.fields or list(SAFE_FIELDS)
    unsafe = [f for f in args.fields if f not in SAFE_FIELDS]
    if unsafe and not args.allow_any_field:
        raise SystemExit(
            f"{', '.join(unsafe)} is outside the free-text safe list "
            f"{list(SAFE_FIELDS)}. Pass --allow-any-field if the column really "
            "has no lifecycle or reporting meaning."
        )
    if not args.ids and not args.discover:
        args.discover = 20
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.headers = load_headers(args.headers_file)

    ids = (
        [int(part) for part in args.ids.split(",") if part.strip()]
        if args.ids
        else discover_ids(args, args.discover)
    )
    users = args.ramp_to or args.users
    if args.ramp_to and not args.ramp_every:
        args.ramp_every = max(args.duration / (args.ramp_to + 1), 1.0)

    # Disjoint slices: user i works over ids[i::users], so two users never touch
    # the same row. Wrapped when there are fewer ids than users.
    slices = [ids[i % max(len(ids), 1)::users] or [ids[i % len(ids)]] for i in range(users)]

    print(
        f"{users} virtual users over {len(ids)} items in {args.list_name}, "
        f"columns {args.fields}, {args.duration:.0f}s"
        + (f", ramping one every {args.ramp_every:.1f}s" if args.ramp_every else "")
        + (" (dry run: reads only)" if args.dry_run else "")
    )

    run = Run(
        started=time.monotonic(),
        deadline=time.monotonic() + args.duration,
        max_errors=args.max_errors,
        stop_on_error=args.stop_on_error,
    )
    threads = [
        threading.Thread(target=worker, args=(i, slices[i], args.fields, args, run),
                         daemon=True)
        for i in range(users)
    ]
    reporter = threading.Thread(target=progress, args=(run, args), daemon=True)
    reporter.start()
    for thread in threads:
        thread.start()
    try:
        for thread in threads:
            while thread.is_alive():
                thread.join(0.5)
    except KeyboardInterrupt:
        print("\nStopping…")
        run.stop.set()
        for thread in threads:
            thread.join(args.timeout)
    run.stop.set()
    reporter.join(2)

    report(run, args)
    if args.csv:
        write_csv(args.csv, run.samples)
    if not args.dry_run and not args.no_restore:
        restore(args, run)
    return 1 if run.errors else 0


if __name__ == "__main__":
    sys.exit(main())
