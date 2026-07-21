# SPA shell with hash routing

## Status

Accepted. Route isolation and lazy page loading are reaffirmed by
[ADR-0034](./0034-store-driven-views-supersede-component-owned-state.md).

The framework runs as a single-page application hosted in **one Content Editor on one SharePoint `.aspx` page**, with all view changes driven by a tiny client-side router that reads `location.hash`. Hash routing was chosen over `pushState` paths or query strings because the URL fragment is never sent to the server, sidestepping SharePoint's habit of mangling query strings (`Source=`, `IsDlg=`, etc.) and 404-ing on synthetic paths. SPA shell was chosen over multi-page (one `.aspx` per logical page) primarily because SharePoint's full-page reload is slow (master page, ribbon, suite bar all re-render), and an SPA keeps dashboard state warm as reviewers drill in and out of cases. Per-view code splitting is preserved via dynamic `import()`, so the question engine isn't downloaded on the dashboard.
