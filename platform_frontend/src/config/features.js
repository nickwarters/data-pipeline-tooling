// @ts-check
/**
 * Build-time feature switches: hard-coded booleans, not runtime configuration.
 *
 * A switch here is a temporary state, not a supported mode. There is no URL
 * param, no SharePoint column and no per-environment override behind it — the
 * value in this file is the value everywhere, and turning a feature on means
 * editing the source and deploying it.
 *
 * That is deliberate. A switch with a runtime toggle acquires two live code
 * paths and has to keep both working forever. A hard-coded one has a single
 * live path and a stated end: when the feature ships, the flag and every `if`
 * that reads it are **deleted**, not flipped to `true`. Flipping leaves the
 * conditional standing, which is how a switch outlives the decision it was
 * hiding.
 *
 * See `docs/guide/feature-switches.md` for the enable-and-remove procedure.
 */

/**
 * The Appeals journey: a completed Case's Outcome being appealed by the
 * frontline, resolved by Controls, and counted as outstanding work on the
 * Controls dashboard.
 *
 * Off because the operating model for appeals is not settled — who raises one,
 * what Controls owes in response, and how long they have. The code is complete
 * and tested; what it lacks is a decision. It stays in the tree so the decision
 * can be taken against something real rather than reconstructed from scratch.
 *
 * With this `false`, no Appeal can be raised, so no Case ever carries one, and
 * every surface below it is empty rather than merely hidden. The five readers:
 *
 * - `services/section-access.js` — the Appeal and Appeal Review tabs on a Case
 * - `pages/dashboard/panel-descriptors.js` — the Controls Appeals panel
 * - `pages/cora-dashboard.js` — the fetch behind that panel
 * - `evaluators/kpi-strip-model.js` — the "Appeals to work" KPI lane
 * - `services/action-centre-model.js` — the "Appeals to work" Action Centre reason
 *
 * The Amend Outcome tab is deliberately **not** gated: Controls amends a
 * reportable Case's Outcome whether or not an Appeal prompted it.
 */
export const APPEALS_ENABLED = false;
