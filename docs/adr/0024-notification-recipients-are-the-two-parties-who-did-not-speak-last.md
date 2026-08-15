---
status: accepted
---

# Notification reads gold current state, and notifies the two Conversation parties who did not speak last

Two decisions, recorded together because the second is what forced the first.

**Notification reads Sync's *gold* current state** — `case_current` and the gold
`conversation_message` Detail Table — not silver observations.

**A Conversation Message notifies the two of the three thread parties who did
not author the last Message** — *the two silent parties*.

Amends [ADR-0023](0023-sync-polls-hourly-publishes-gold-daily.md), whose
load-bearing premise was that Notification reads observations rather than
current state. That premise is now false. It carries no cadence consequence,
because Notification is cadence-agnostic by construction — see below.

## Decision 1 — Notification reads gold current state

The recipient rule needs three things at once: the **last** Message of a Case's
thread, the Case's **people** columns, and the Case's **status**. Gold gives all
three at one grain, already reduced.

Silver gives none of them without re-deriving the reduction. Silver
`conversation_message` is one row per *observation × message*, so the same
Message appears once per poll window it was visible in, and picking "the last
Message" means re-implementing
[ADR-0015](0015-detail-tables-reduce-to-the-parents-latest-observation.md)'s
observation-snapshot reduction a second time, in a second place, where it can
disagree with gold. Gold `conversation_message` already holds exactly one
observation's worth of Messages per Case, so `seq` totally orders the thread and
the last Message is one `idxmax`.

The `case_current` half is the same argument with no ambiguity at all: it is
already one row per Case, so Notification does not reduce it, does not re-derive
`case_id`, and does not carry a second, disagreeing latest-per-Case rule.

### Consequence: none. Notification is cadence-agnostic

Notification means *"emit whatever has been required since the last run"*, with
the first run emitting everything. Its dedupe is state-based rather than
clock-based — a recipient is emitted when their last-notified Message is older
than the Case's current last Message — so the pipeline holds however often it is
asked. Daily, twice daily, hourly, every ten minutes: the output is the same set
of notifications, just divided into more or fewer passes.

So reading gold imposes **no cadence obligation on Sync**. How stale a
notification is tracks how stale gold is, and that is a latency property to tune
against whatever Sync ends up doing, not a correctness debt this decision
incurs. ADR-0023's hourly poll loses the consumer that justified it, which is
worth knowing when Sync is next revisited — but it is a question about Sync's
own shape, not something Notification is waiting on. Nothing here schedules the
pipeline, and nothing here needs a particular schedule to be correct.

## Decision 2 — the two silent parties

A Conversation has three parties: the **Assigned Reviewer**, the **Responsible
Party**, and the **Responsible Party Manager**. On each pass, the two who did
not author the last Message are notified.

| Sequence | Last author | Notified |
| --- | --- | --- |
| Reviewer posts | Reviewer | Responsible Party + Manager |
| Reviewer posts, Responsible Party replies | Responsible Party | Reviewer + Manager |
| Reviewer posts, Manager replies | Manager | Reviewer + **Responsible Party** |
| Two Responsible Party Messages in one window | Responsible Party | Reviewer + Manager |

The third row is the whole point of the rule. An earlier candidate — "notify
everyone who has not posted since the Reviewer did", or any rule that treats a
party as *dealt with* once someone on their side replies — leaves the
Responsible Party never told that the Reviewer wants something, because the
Manager's post consumed the notification. Under this rule the Manager's post
re-notifies the Responsible Party.

**The accepted cost is over-notification**, and it is the safe direction: a
Manager's courtesy post after the Responsible Party has already replied tells
the Responsible Party about a Message they have effectively seen. A missed
notification stalls a remediation; a redundant one is a redundant email.

The rule also *is* the whole of the "do not notify someone who has already
replied" requirement — whoever spoke last is by definition the party who does
not need telling — so there is no separate suppression step to look for.

### The ledger key is `(case_id, recipient, message_at)`

`message_at` is the triggering Message's own `posted_at`. A recipient is
notified only when the Case's last Message is newer than the one they were last
notified about, so the ledger row *is* its key and carries nothing else.

**Not `source_observation_id`.** A Case gets a new observation for any edit —
a status change, an Answer, a re-allocation — and keying on it would re-notify
every party of a Message nobody added.

**Not a time window.** Sync's poll windows deliberately overlap by
`OVERLAP = 5 minutes`, so a "Messages in the last N minutes" rule re-emits the
same Message on consecutive passes *by design*. The domain event's own timestamp
is the only key that is stable across re-reads and re-drives.

### The Responsible Party Manager is resolved from the directory

Not from `responsible_party_manager_name` on the Case row.
`platform_frontend/CONTEXT.md`'s **Responsible Party Manager** entry records that
nothing writes that column today, and that live directory resolution is the
correct authority for this role precisely because it is an access-control input
that must be current. Notification resolves the manager the same way — through a
`users` reference feed carrying `login → email` and that person's manager — so
the pipeline and the review platform agree about who the Manager is, and neither
depends on a column nothing populates.

### Terminal Cases do not notify

A Case whose `status` is in `TERMINAL_STATUSES` (Completed, Void) is filtered
out. Its review is over, so a Message on it needs nobody's attention.

### Cold start does nothing

The first run has an empty ledger, so it emits a notification for every
non-terminal Case with a Conversation. This is accepted rather than engineered
around: the pipeline writes a JSON file into an outbox, it does not send mail,
and the operator drains or discards that first file deliberately. A seed flag or
a cutoff instant would be a one-use mechanism that has to be correct forever;
see the go-live checklist in
[`sharepoint-cases-going-live.md`](../sharepoint-cases-going-live.md).

## Considered options

- **Read silver observations** (what ADR-0023 assumed). Rejected: it duplicates
  the observation-snapshot reduction in a second place, and Notification needs
  `case_current`'s person and status columns anyway, which silver observations
  do not carry at one-row-per-Case grain. It would have kept Notification able
  to run ahead of a publish, which is a latency gain and not a correctness one.
- **Strip the Responsible Party Manager's posting rights so the thread has two
  parties.** Rejected. It genuinely simplifies the rule — with two parties,
  "notify whoever did not speak last" is one recipient and the third row of the
  table above never arises. But the Manager's posting is their *interface* for
  chasing remediation with the Reviewer, and withdrawing a shipped access right
  to simplify a downstream pipeline is the wrong trade in the wrong direction.
  Note also that it buys nothing in output: with the Manager silent, the
  three-party rule produces exactly the same recipients the two-party rule
  would. The shipped `platform_frontend/src/services/section-access.js` matrix
  keeps the Manager's posting rights unchanged.
- **Key the ledger on `source_observation_id`.** Rejected — see above; it
  re-notifies on unrelated edits.
- **Dedupe on a time window.** Rejected — the poll's five-minute `OVERLAP`
  re-emits by design.
- **Notify only the party the Message was addressed to.** Rejected: a Message
  has no addressee. The app writes an author and a body, and inventing an
  addressee would mean guessing from the text.

## Consequences

- **Notification is a gold consumer**, so it runs after the publish and sees
  whatever that publish left. Any cadence is correct; the cadence chosen only
  decides how promptly a Message is reported. Nothing schedules it in this
  change.
- **The two schedules are independent, coupled only by same-day freshness.**
  `UPSTREAMS` declares Sync at the default `max_age_days=0`, so a run before
  today's Sync has landed fails its freshness check rather than notifying from
  yesterday's gold, and every run after it that owes nobody anything writes no
  file. That is the intended shape: Sync may be made more frequent — including
  by splitting the aggregations out of its publish — without Notification's
  schedule having to know, and vice versa. The floor is *at least once a day,
  before Notification runs*. Widening the window would buy a quieter run log at
  the price of notifying from stale state.
- **A party who is absent or unresolvable is skipped, never substituted.** A
  Case with no Responsible Party, or a Responsible Party with no directory row,
  yields fewer recipients — never a fallback recipient, and never an
  `(unassigned)` placeholder in a `To:` line. An unresolvable recipient is also
  **not ledgered**, because recording that they were told would be a lie; they
  are notified once the directory learns them.
- **The Notified ledger is domain state, not run metadata.** It records what a
  person was told, so it lives in its own subject's gold, not in the Run store.
- **One person in two roles collapses to one recipient**, because recipients are
  a set of resolved email addresses rather than a list of roles.
