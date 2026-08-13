# Deploy runbook: `scripts/deploy_to_sharepoint.py`

How to put this repository's bytes into SharePoint, what the script does for you,
and what it cannot do for you. There is no automated pipeline: a deploy is only
as verified as the commands someone ran first — which is why the script now runs
the most important one itself.

**Current reality:** `build_client()` raises `NotImplementedError`. Until a
concrete `SharePointDeployClient` exists (auth handshake + transport), only
`--dry-run` runs against a real site, and the actual file upload is a hand-upload.
Read the caveats at the bottom before doing one.

The upload half of that seam is now shaped to the organisation's field client:
`copy_or_move_local_file_to_sp(source_path, *, library_relative_path, dest_filename, raise_on_error, copy_or_move)`.
The engine hands `upload_file()` a local file and a target-relative path, so
implementing it is transcription — see the `build_client()` docstring for the
literal call. It assumes `library_relative_path` is relative to the document
library root, so the concrete client is what prefixes the target folder
(`CODE/CORA`); if the real argument turns out to be server-relative, that
assumption is the one line to change. The other four methods still need their
own transport work.

## 1. Pre-conditions

Run these, in this order, from the repository root:

```bash
npm run check          # tsc --noEmit --checkJs
npm run verify         # parses every module, resolves every reference, evaluates the config
npm run test:coverage  # the JS suite plus the 95% floor over src/ and case-types/
npm run test:deploy    # the Python suite for this script
```

The deploy **re-runs `npm run verify` itself** as a pre-flight gate and aborts
before touching SharePoint if it fails, so running it here is about hearing the
failure early, not about protecting the deploy. Everything else in that list is
on you: nothing else is enforced at deploy time.

The gate needs the dev dependencies installed (`npm install`) in the checkout this
script lives in.

### List columns this release needs

Nothing in the gate can see SharePoint, so column provisioning is on you and has
to be done **before** the upload, not after.

- **`AssignedAt`** (Date and Time, not indexed) on **every Case Type list** in
  the environment you are deploying to — the `uat_`-prefixed lists too. Reads
  degrade safely without it (the Case read is `$select=*`, so a list lacking the
  column simply answers without it), but the client writes `AssignedAt` on every
  PATCH that sets the Assigned Reviewer, and SharePoint answers a PATCH naming an
  unknown column with a **400**. The allocation claim is exactly such a write, so
  on a list without the column **"Request next Case" fails outright**.

See the [Case Type onboarding checklist](./case-type-onboarding.md) for
the full column schema.

## 2. Deploy to prod

```bash
python3 scripts/deploy_to_sharepoint.py \
  --site-url https://sp.example.com/sites/cora \
  --dry-run
```

Read two things in the output before going further:

- **the plan** — every add, update and delete, with a count. A delete you did not
  expect means the target folder holds a file this repository does not; see the
  drift caveat below.
- **the upload order** — numbered, dependencies before dependents, host page
  last. It is derived from the graph the gate just wrote, not from the alphabet.

Then run the same command without `--dry-run`.

## 3. Deploy to UAT

```bash
python3 scripts/deploy_to_sharepoint.py \
  --site-url https://sp.example.com/sites/cora \
  --env uat --dry-run
```

`--env uat` changes three things and nothing else:

- target folder `Style Library/CODE/CORA-UAT` (prod: `CODE/CORA`),
- the `{{CORA_ENV}}` substitution in the host page becomes `uat`, which is how the
  deployed page tells the app to use the `uat_`-prefixed lists,
- the host page is embedded in `SitePages/uat.app.aspx` (prod:
  `SitePages/app.aspx`) — a hand-maintained Content Editor page this script never
  touches.

Nothing else branches on the environment: the ordering, the verification and the
diff are identical.

## 4. What the pipeline does for you

1. **Pre-flight gate.** Runs `npm run verify` in this script's own repository root
   (not `--root`), inherits its output so you see each failure line, and aborts
   the deploy on a non-zero exit, on a missing `npm`, and on a
   `.verify/import-graph.json` that is absent after a clean run. There is no
   `--skip-verify` flag: the only bypass is a
   hand-upload, and that is named as such below.
2. **Leaf-first upload order.** Adds and updates are ordered as one stream from
   the gate's graph, so a dependency uploads before anything that references it —
   including Question Bank `.txt` artifacts before the Case Type modules that await
   them, and stylesheets before the page that links them. A deployable file the
   gate produced no node for aborts the deploy — before any call to SharePoint —
   rather than being uploaded in a guessed position. Modules in an import cycle
   have no dependency-first order by definition, so they upload in an arbitrary
   but deterministic one.
3. **Templated host pages last.** The host page is what puts a new tree in front
   of users, so it uploads after everything it can reach.
4. **Staged uploads.** The transport creates files from local paths, so the bytes
   to upload — rendered, not the placeholders still on disk — are written into a
   temporary directory mirroring the target layout, removed when the run ends.
5. **Deletes after every upload.** Unchanged behaviour.
6. **Post-upload verification.** Every deployed file — not just the changed ones —
   is re-fetched from the target folder and compared by SHA-256 against the bytes
   that were uploaded (after token substitution, so the host page is compared
   against its rendered form). A residual in any class returns a non-zero exit.
   **Cost:** one GET per deployed file, about 140 today. That is deliberate: a hash
   the client volunteers is not evidence about what the library serves, and a run
   with nothing to change is exactly when a corrupted or hand-edited file otherwise
   goes unnoticed.

## 5. Failure playbook

The sync is idempotent, so **re-running is normally the fix**. A failure mid-plan
leaves a partial tree — leaf-first ordering shortens that window rather than
closing it, so a re-run is also how you close it.

| Reported class | What it means                                                  | What to do                                                                                                                              |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `missing`      | The file is not served at all after being uploaded.            | Re-run. If it persists, check the folder's permissions and whether the file name is one SharePoint blocks.                              |
| `mismatched`   | The library serves different bytes than were uploaded.         | Re-run. If it persists, confirm nobody edited the file in the library and that no checked-out version is being served.                  |
| `unreadable`   | The re-fetch itself failed (checked out, permission, 500).     | The path is named in the output; resolve it in SharePoint (check in, grant access) and re-run.                                          |
| `unexpected`   | The target folder serves a file this repository does not have. | Either a delete that did not take (re-run) or a hand-upload someone made. Decide which, then remove it or bring it into the repository. |

A pre-flight failure is not a deploy problem: fix the tree, commit, run the
pre-conditions again.

## 6. Caveats, stated bluntly

- **A hand-upload bypasses all of this.** No pre-flight gate, no upload order, no
  hash verification. A tree put into the Style Library by hand is unverified by
  construction, and nothing in this repository can tell you what it contains.
  Hand-uploading is the current normal path (see the top of this file), so this is
  the caveat that matters most today.
- **The sync reverts drive-by edits.** A file edited directly in the library is
  overwritten on the next run; a file added directly in the library is deleted.
  That is what a diff sync is, not a bug — post-upload verification now names both
  classes (`mismatched`, `unexpected`) so you find out before the next deploy
  silently undoes someone's change.
- **`--root` must be the checkout you are deploying from.** The gate can only run
  where the dev dependencies are installed — this script's own repository — so a
  `--root` pointing anywhere else would give an upload order describing a
  different tree. The script aborts rather than deploy one tree in another's
  order. Deploy a different checkout by running its own copy of this script.
- **Client-side caching bounds nothing.** A browser already holding an old module
  keeps using it whatever order the upload ran in. There is no cache-busting query,
  and adding one would be import rewriting, which ADR-0041 bans.
- **Ordering removes dangling references, not mixed-version graphs.** When a leaf
  and its importer both change, some order must exist, and every order leaves a
  window in which a user can load the new importer against the old leaf.
