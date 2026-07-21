# Target SharePoint Subscription Edition with Edge Chromium

## Status

Accepted. Still current.

The framework targets **SharePoint Subscription Edition (SE)** as the host and **Edge Chromium (last 2 versions)** as the only supported browser. This unlocks the full modern web platform — ES2020+ syntax, native `fetch`, ES modules via `<script type="module">`, Web Components, CSS Grid, CSS custom properties — without requiring any build/transpile step. We explicitly do **not** support IE11 or legacy Edge; doing so would force ES5, polyfills, and a fundamentally different framework design.
