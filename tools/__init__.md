```python
"""Cross-cutting utilities that sit beside the framework, not inside it.

``tools`` is a top-level sibling of ``framework``, not a fifth facade: retry,
working-day arithmetic, environment resolution, where a feed lands (``store`` /
``medallion``), orchestration, observability, and the remote integrations. Each
helper is imported by its own module path (``tools.store``, ``tools.retry``,
...); this package deliberately re-exports nothing, so adding a module here
makes no public-surface commitment on its own.
"""

```
