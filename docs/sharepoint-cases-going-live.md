# Taking `sharepoint_cases` live

The one-time path from where this feed is today — scheduled, tested, and unable
to reach a tenant — to a feed an external scheduler drives every working day.
Read it once, in order. Steady-state operation is
[sharepoint-rest-ingest.md](sharepoint-rest-ingest.md); this is how you get to
the point where that document applies.

## Where the feed stands today

Everything except the tenant is done. Source → raw → silver → gold runs
end-to-end against fixture pages, the watermark and its window rule are built and
tested, and `case_review/schedules.py` puts the feed on `Schedule.daily()`.

What is missing is the ability to reach a real list, and it is missing in three
separate places:

| Gap | Where | Effect today |
| --- | --- | --- |
| No organisational client | `_resolve_client` in `pipelines/sharepoint_cases/pipeline.py` | An unattended run raises `NoClientError` (`config` category) |
| `SITE` and every `CaseList`'s `list_id` are placeholders | `pipelines/sharepoint_cases/schema.py` | No site to point a client at; no identity to key each list's watermark on |
| `Modified` is not indexed on the list | the tenant, not this repository | Works while the list is small; degrades past 5,000 rows |

The feed is scheduled with `enabled=True` despite that. This is deliberate: a
disabled item short-circuits before its schedule is ever evaluated, so disabling
it would have made the working-day gating untestable. **Nothing invokes the
schedule on a timer yet** — this project ships no scheduler, so a run only
happens when a person or an external scheduler runs the command. Until stage 6
below, the daily failure is hypothetical rather than real.

## Stage 0 — rehearse offline (available now)

Nothing here touches a tenant, and none of it needs the stages below.

```sh
python -m pipelines.sharepoint_cases.pipeline --base-dir /tmp/rehearsal --sample
```

`--sample` replays the bundled fixture pages through the real pipeline. There is
no plan to print ahead of it: the steps are eager, so the run log *is* the plan,
one record per step, each named for the table it was building. `cli run
pipelines/sharepoint_cases --dry-run` — every step running, only the commits and
the watermarks held back — is the preview, and it needs a client, so it becomes
available at stage 4 rather than here.

Read the result back with the operator commands you will use in anger:

```sh
python -m cli status --base-dir /tmp/rehearsal
python -m cli runs   --base-dir /tmp/rehearsal --pipeline sharepoint_cases
python -m cli log    sharepoint_cases --base-dir /tmp/rehearsal --pipeline-run-id <prefix>
```

The point of stage 0 is that the only thing you are still learning at stage 4 is
the tenant's behaviour, not this feed's.

## Stage 1 — get the tenant facts, one `CaseList` entry per list

`SITE` is the site collection holding the Case lists. Then fill in one
`CASE_LISTS` entry per provisioned list: its Case Type slug, its list name, that
site, and the list's **GUID** from its own settings page.

Neither can be copied from the review application: it derives its site from the
page it is served from and addresses lists by title, so the GUIDs exist nowhere
in this repository or the frontend.

**Take care over each GUID.** It never reaches the fetch — the list is addressed
by title — so a wrong one does not fail, and does not fetch the wrong rows
either. It keys that list's watermark, so a wrong GUID misfiles the feed's place
in the source and looks exactly like a first load. **Two entries sharing a
`(site, list_id)` share one watermark**, which is the same quiet failure twice
over: while the GUIDs are placeholders they are all the nil UUID, so this is a
real mistake to make. Rollback covers what to do about it.

While you are in the list's settings, index `Modified`. It can only be indexed
while the list is under the 5,000-row List View Threshold, so this gets harder,
not easier, with time — see
[data-dictionary-sharepoint-cases.md](data-dictionary-sharepoint-cases.md#three-things-to-know-before-this-feed-reaches-a-tenant).

## Stage 2 — wire the client

`_resolve_client` is the one function that changes. It must return a
`CaseListClient`: the `fetch_items(...)` that `SharePointListClient` declares,
plus a `server_time()` returning **the list server's** clock.

`server_time()` is not incidental. The window bounds a predicate the *list*
evaluates, so a skewed local clock would silently widen or narrow it rather than
fail. Do not substitute the local clock.

### Implementing `server_time()`

Read the `Date` response header from a small, authenticated, non-cached REST
request to the same SharePoint site. That header is an HTTP date representing
when the server originated the response; it is the clock this method needs. Do
not use `/_api/web/RegionalSettings/TimeZone`: that describes how the site
displays local dates, not SharePoint's current instant.

The exact request belongs to the organisational client's existing session and
transport. In outline only (adapt the response/error API to that transport):

```python
import datetime as dt
from dateutil.parser import parse as parse_http_date


def server_time(self) -> dt.datetime:
    response = self._session.get(
        f"{self._site}/_api/web?$select=Id",
        headers={"Cache-Control": "no-cache"},
    )
    response.raise_for_status()

    value = response.headers.get("Date")
    if value is None:
        raise SharePointClientError("SharePoint response has no Date header")

    try:
        moment = parse_http_date(value, fuzzy=False)
    except (TypeError, ValueError, OverflowError) as error:
        raise SharePointClientError(
            f"SharePoint returned an invalid HTTP Date header: {value!r}"
        ) from error
    if moment.tzinfo is None:
        raise SharePointClientError(
            f"SharePoint returned an HTTP Date without a time zone: {value!r}"
        )
    return moment.astimezone(dt.timezone.utc)
```

Use the approved `python-dateutil` dependency for this parsing; its import
package is named `dateutil`. Alias `dateutil.parser.parse` to
`parse_http_date` so the protocol role is explicit, and keep `fuzzy=False` so
unrelated text is not silently accepted. Do not use `isoparse`: an HTTP `Date`
header is an RFC-style date, not ISO 8601. When the live client is implemented,
add and pin `python-dateutil` directly in `requirements.txt`; do not rely on it
being installed transitively by pandas.

Treat a missing or malformed header as a client failure rather than silently
falling back to `datetime.now()`. Also ensure the response was not served stale
from a cache: request revalidation as above and inspect any `Age` header in the
live environment. If the organisational proxy can still return a cached
response, the client must either account for that age according to HTTP cache
semantics or reject it. The header has whole-second precision and is captured
just before the response travels back to the client; that small conservative
delay is expected and is well inside the feed's 30-second safety lag.

The client returns items as SharePoint returned them and owes the feed no
reshaping — an expanded person arrives as the nested `{"Name": ...}` object the
API answers with. Flattening is the feed's own doing.

**Credentials belong to the organisational session mechanism the client wraps.**
Never a `--param`, never a command line, never a committed file. The run summary
does redact `secret` / `token` / `password` / `credential` / `key` parameter
names, but that is a backstop against a mistake, not a supported route.

## Stage 3 — settle the production `base_dir`

Set `PIPELINE_DATA_DIR_PROD` on the machine that will run the feed, then address
it by name rather than by path:

```sh
python -m cli status --env prod
```

The committed production fallback is `~/pipelines_prod`; set
`PIPELINE_DATA_DIR_PROD` when the live machine uses another root. Confirm it
resolves to the intended location before you put data in it. If the variable is
unset, the resolver emits a warning to stderr so a run cannot silently hide
that it used the fallback; the go/no-go checklist below still requires the
explicit production variable for a live machine.

## Stage 4 — the first live run, by hand

Run it yourself, once, deliberately. Not through the scheduler.

```sh
python -m cli run pipelines/sharepoint_cases --env prod --dry-run
```

Under a dry run every write is previewed and **the watermark is not
committed** — the checkpoint is not a pipeline step, so it is guarded explicitly
rather than inheriting the ambient skip. This is the real rehearsal: it reaches
the tenant, exercises the client, and leaves no trace. Check the columns, dtypes
and row counts it prints against what you expect the list to hold.

Expect raw and silver only. Gold reduces the accumulated silver history, and on a
fresh directory the silver write was previewed rather than performed, so there is
nothing to reduce and no gold steps are previewed. That is correct, not a fault.

Then commit for real:

```sh
python -m cli run pipelines/sharepoint_cases --env prod
```

Expect a **first load per list**: with no committed watermark a list's window
has no start, so this run takes each whole current list up to the safe upper
boundary, not a window of recent changes. On lists of any size this is the
slowest run the feed will ever do. Verify it before going further:

```sh
python -m cli status --env prod
python -m cli log sharepoint_cases --env prod --pipeline-run-id <prefix>
```

Check the gold tables are populated, the quarantine is empty or explicable,
and the run succeeded. **A successful run has committed every polled list's
watermark**, which means stage 1's GUIDs are now baked into the feed's history —
see Rollback.

## Stage 5 — back it up before you rely on it

Two places hold system-of-record state and must be backed up **together**:

- `<base>/sharepoint_cases/` — the whole directory, not just
  `{raw,silver,gold}.db`: `quarantine.db` holds rejected observations that are
  equally un-re-fetchable. None of it can be recovered from the list, because a
  `Modified` window only returns what the list holds now.
- `<base>/_checkpoints/sharepoint.db` — the feed's place in the source.

Restoring one without the other forks the feed. Get this in place before the
feed has accumulated anything you would miss.

## Stage 6 — hand it to the scheduler

Only now point an external scheduler (Windows Task Scheduler, cron) at:

```sh
python -m cli orchestrate --app case_review.schedules --env prod --once
```

Run it as often in the day as you find useful — several times a working day is
the intended model, and why it is safe is
[the runbook's §2](sharepoint-rest-ingest.md#2-the-daily-command). Do not use
`--loop` as an hourly daemon; it settles the day's due work and stops.

Weekends skip. Holidays skip **when you seed them**: pass
`--calendar <file>`, a YAML calendar file of `holidays` and `weekend`
([working-day-calendar.md](working-day-calendar.md#from-a-calendar-file--workingdaycalendarfrom_yamlpath)).
Omit the flag and the calendar is weekends-only, so a bank holiday polls like
any other weekday — harmless for this feed (a quiet poll is cheap and
convergent), but seed the file before you add schedules like "first working day
of the month", which count their working days against the same calendar.

From here, [sharepoint-rest-ingest.md](sharepoint-rest-ingest.md) is the
document you operate from.

## Go / no-go

Do not proceed past stage 4 unless all of these hold:

- [ ] `SITE` and every `CaseList`'s `list_id` verified against that list's own
      settings page, each GUID double-checked by a second pair of eyes.
- [ ] No two `CaseList` entries share a `(site, list_id)`, a `list_name` or a
      `case_type`.
- [ ] `Modified` indexed, or the list is comfortably under 5,000 rows and someone
      owns watching that.
- [ ] `_resolve_client` returns a real client whose `server_time()` reads the
      list server's clock; a live request has confirmed that the site's REST
      response supplies a fresh, parseable `Date` header rather than a cached
      one.
- [ ] No credential appears in a command line, a parameter, or a committed file.
- [ ] `PIPELINE_DATA_DIR_PROD` set and resolving.
- [ ] The dry run at stage 4 produced the columns and row counts you expected.
- [ ] A backup covers the feed's whole directory **and** the checkpoint.

### If the `notifications` pipeline is going live alongside this feed

It reads this feed's gold, so it cannot be pointed at a tenant before this one
is. Three items, all in
[`data-dictionary-notifications.md`](data-dictionary-notifications.md):

- [ ] `CASE_LINK_TEMPLATE` in `pipelines/notifications/pipeline.py` has the real
      **site collection** and the real **host `.aspx` page** the review
      application is served from — one constant, shared by both triggers, so
      this is one edit. The `#/case/...` fragment after the base is the app's
      own route and stays as it is. A placeholder link is a notification the
      recipient cannot act on.
- [ ] `readers/sample_data/users.csv` points at a real directory
      extract, not the bundled `@example.invalid` fixture. The four columns are
      `login,email,manager_login,manager_email`; a duplicate `login` aborts the
      read on purpose.
- [ ] **The first run's file is drained or discarded deliberately, for both
      triggers.** Each of the two Notified ledgers starts empty, so the first
      pass emits a notification for *every* non-terminal Case that has a
      Conversation, **and** for every already-Reportable Case carrying
      remediation — not a defect, and not something to build a seed flag for.
      Decide before that run whether the backlog should be sent or dropped, and
      act on the file accordingly. Every pass after it emits only what has
      changed.

## Rollback

Honest about what is and is not reversible.

**Reversible.** Everything through stage 4's dry run leaves nothing behind.
Unpointing the scheduler at stage 6 stops the feed immediately and cleanly; the
accumulated data and watermark simply sit there, and a later run resumes from the
watermark and covers the gap in one wider window.

**Not cleanly reversible: the first run without `--dry-run`** — whether or not it
succeeds. Each step commits as it goes and only the checkpoint is held back to
last, so a run that fails between the raw write and the commit has already landed
append-only rows with no watermark seeded. Raw and silver are append-only by
design, so there is no in-place correction of what they hold.

**A wrong `list_id` is not that failure.** The list is addressed **by title** —
the reader is built with the entry's `list_name`, and `fetch_items` takes a list
name — so the GUID never reaches the fetch. Its only jobs are keying the
watermark and stamping batch provenance. A wrong GUID therefore ingests the
*right* list's rows and files the watermark under the wrong identity: the
medallion is sound, and only the checkpoint is misfiled. Correct the GUID and the
feed simply sees an unknown key and does one more first load; `AppendOnly` no-ops
every observation it has already stored. **Do not wipe the medallion for this** —
it is good data.

**Two entries sharing a `(site, list_id)` is the same shape, twice.** Both lists
advanced one shared watermark, so each saw only the windows the other did not
close, and the medallion holds a gap rather than wrong rows. Correct the GUIDs
and each list resumes from an unknown key with a first load, which re-fetches the
whole list and closes the gap; the re-reads no-op. Again, do not wipe the
medallion.

This is why stage 4 is run by hand and verified before stage 6 exists.

## Explicitly not part of going live

Hard-delete reconciliation. A `Modified` window cannot see a deleted item, so
deleted Cases sit in the accumulated history indefinitely; the operational signal
is a business status, and reconciliation is separate work — see
[the canonical statement](adding-a-feed.md#sharepointmodifiedreadersite-list_name-columns-window).
Going live does not solve it and should not wait for it.
