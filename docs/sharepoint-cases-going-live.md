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
| `SITE` / `LIST_ID` are placeholders | same file, near the top | Nothing to point a client at |
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
python -m pipelines.sharepoint_cases.pipeline --base-dir /tmp/rehearsal --sample --describe
```

`--sample` replays the bundled fixture pages through the real pipeline;
`--describe` prints each hop's plan first. Then read the result back with the
operator commands you will use in anger:

```sh
python -m cli status --base-dir /tmp/rehearsal
python -m cli runs   --base-dir /tmp/rehearsal --pipeline sharepoint_cases
python -m cli log    sharepoint_cases --base-dir /tmp/rehearsal --pipeline-run-id <prefix>
```

The point of stage 0 is that the only thing you are still learning at stage 4 is
the tenant's behaviour, not this feed's.

## Stage 1 — get the two tenant facts

`SITE` is the site collection holding the Case lists. `LIST_ID` is the list's
GUID, from its own settings page.

Neither can be copied from the review application: it derives its site from the
page it is served from and addresses lists by title, so the GUID exists nowhere
in this repository or the frontend.

**Take care over the GUID.** The watermark is keyed on `site|list_id`, so a wrong
GUID does not fail — it silently addresses a different feed's place in the source
and looks exactly like a first load. This is the one value in the whole sequence
where a mistake is quiet.

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

`prod` has no fallback — it raises a clear error until the variable is set, by
design, so a production run can never quietly land in `./data`. Confirm the root
resolves before you put data in it.

## Stage 4 — the first live run, by hand

Run it yourself, once, deliberately. Not through the scheduler.

```sh
python -m cli run pipelines/sharepoint_cases --env prod --dry-run
```

Under a dry run every hop's writes are previewed and **the watermark is not
committed** — the checkpoint is not a pipeline step, so it is guarded explicitly
rather than inheriting the ambient skip. This is the real rehearsal: it reaches
the tenant, exercises the client, and leaves no trace. Check the columns, dtypes
and row counts it prints against what you expect the list to hold.

Then commit for real:

```sh
python -m cli run pipelines/sharepoint_cases --env prod
```

Expect a **first load**: with no committed watermark the window has no start, so
this run takes the whole current list up to the safe upper boundary, not a
window of recent changes. On a list of any size this is the slowest run the feed
will ever do. Verify it before going further:

```sh
python -m cli status --env prod
python -m cli log sharepoint_cases --env prod --pipeline-run-id <prefix>
```

Check the four gold tables are populated, the quarantine is empty or explicable,
and the run succeeded. **A successful run has committed the watermark**, which
means stage 1's GUID is now baked into the feed's history — see Rollback.

## Stage 5 — back it up before you rely on it

Two places hold system-of-record state and must be backed up **together**:

- `<base>/sharepoint_cases/{raw,silver,gold}.db` — accumulated history that
  cannot be re-fetched, because a `Modified` window only returns what the list
  holds now.
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

Weekends skip. **Holidays do not** — `python -m cli orchestrate` builds its
calendar with no holidays seeded ([#407](https://github.com/nickwarters/data-pipeline-tooling/issues/407)),
so a bank holiday polls like any other weekday. That is harmless for this feed
(a quiet poll is cheap and convergent) but it will not stay harmless for
schedules like "first working day of the month".

From here, [sharepoint-rest-ingest.md](sharepoint-rest-ingest.md) is the
document you operate from.

## Go / no-go

Do not proceed past stage 4 unless all of these hold:

- [ ] `SITE` and `LIST_ID` verified against the list's own settings page, GUID
      double-checked by a second pair of eyes.
- [ ] `Modified` indexed, or the list is comfortably under 5,000 rows and someone
      owns watching that.
- [ ] `_resolve_client` returns a real client whose `server_time()` reads the
      list server's clock.
- [ ] No credential appears in a command line, a parameter, or a committed file.
- [ ] `PIPELINE_DATA_DIR_PROD` set and resolving.
- [ ] The dry run at stage 4 produced the columns and row counts you expected.
- [ ] A backup covers the medallion **and** the checkpoint.

## Rollback

Honest about what is and is not reversible.

**Reversible.** Stages 0–4's dry run leave nothing behind. Unpointing the
scheduler at stage 6 stops the feed immediately and cleanly; the accumulated data
and watermark simply sit there, and a later run resumes from the watermark and
covers the gap in one wider window.

**Not cleanly reversible: the first committing run.** It seeds the watermark
under the `site|list_id` key and writes append-only history. If the GUID turns
out to be wrong, the feed has accumulated observations against the wrong list and
its watermark points into that list's timeline. There is no in-place correction —
raw and silver are append-only by design. The recovery is to stop, take a copy
for evidence, and start the feed's medallion and checkpoint fresh with the right
GUID.

This is why stage 4 is run by hand and verified before stage 6 exists.

## Explicitly not part of going live

Hard-delete reconciliation. A `Modified` window cannot see a deleted item, so
deleted Cases sit in the accumulated history indefinitely; the operational signal
is a business status, and reconciliation is separate work — see
[the canonical statement](adding-a-feed.md#sharepointmodifiedreadersite-list_name-columns-window).
Going live does not solve it and should not wait for it.
