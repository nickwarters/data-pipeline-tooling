# JSDoc + `tsc --checkJs` for type safety

All framework code uses **JSDoc type annotations** with `// @ts-check` at the top of every file. CI runs `tsc --noEmit --checkJs --allowJs` against the source tree. No `.ts` files, no transpilation — the deployed JS is the source JS, preserving the no-build-toolchain rule.

Shared types live in `/types/*.d.ts` (declaration-only files are valid in a JSDoc-typed JS project) and are referenced from JSDoc via `@typedef` `import`s. This gives us type-safe boundaries for: Case Type configs, Question Definitions, Answers, the signal primitive, and the SharePoint REST client surface.

`tsc` is a dev/CI dependency only. It does not run in the browser, does not transform code, and is not required to _run_ the framework — only to verify it. Editors (VS Code, JetBrains) get the same checks live via the bundled TypeScript service.

Chosen over plain JS (no checking) because the question engine's conditional logic and the Case Type config schema are exactly the kind of structural code where silent type drift causes bad bugs. Chosen over `.ts` files because TypeScript-as-source would require either a build step (violates the architecture decision) or browser-loaded transpilation (slow, fragile).
