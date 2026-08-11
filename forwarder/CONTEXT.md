# Forwarder glossary

The Forwarder is a separate project that delivers the pipeline's local
artifacts. This slice defines its vocabulary and package boundaries only; it
has no Forwarder runtime behavior.

## Language

**Route**:
The declaration of one delivery destination and the handler responsible for
it. A route names the outbox destination and its handler settings.

**Handler**:
The destination-specific delivery seam behind a Route. A handler understands
how its destination receives a file; handler behavior is not implemented in
this slice.

**Archive**:
The Forwarder-owned location in the base directory, beside the outbox, for a
file after successful delivery. It is distinct from the pending deliverable
outbox, whose canonical layout is defined by the root glossary's
[Deliverable outbox](../CONTEXT.md#deliverable-outbox).

**Dead letter**:
The Forwarder-owned location in the base directory, beside the archive, for a
file that has exhausted the Forwarder's retry allowance. The mechanics for
deciding or moving a dead letter are not implemented in this slice.

**Tick**:
One planned pass of the Forwarder's long-running delivery loop. A Tick is a
future runtime concept only; this package currently has no loop or delivery
behavior.

The Forwarder handles root-glossary [Deliverables](../CONTEXT.md#deliverable),
including a [Report Feed](../CONTEXT.md#report-feed), after a pipeline writes
them to the [Deliverable outbox](../CONTEXT.md#deliverable-outbox). The root
delivery boundary is recorded in [ADR-0018](../docs/adr/0018-report-feeds-published-locally-delivered-outside-the-framework.md).
The Forwarder's local decision record is
[ADR-0001](docs/adr/0001-the-forwarder-drains-declared-routes-and-keeps-its-own-log.md).

No behavior is defined here beyond this vocabulary and the import-only
package/test shell. The Forwarder imports nothing from `framework/`.
