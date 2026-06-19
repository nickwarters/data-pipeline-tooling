```python
#!/usr/bin/env python3
"""Generate (or clean up) Markdown mirrors of every Python source file.

For each ``<name>.py`` in the repo a sibling ``<name>.md`` is written whose body
is the Python source wrapped in a fenced ``python`` code block. Running the
script first removes any existing mirrors and then regenerates them, so it is
safe to re-run after files are added, renamed, or deleted.

Cleaning is driven by the *mirrors themselves*, not by the current set of ``.py``
files: any Markdown file whose content has the generated mirror shape is pruned,
including mirrors *orphaned* when their source was renamed, moved, or deleted.
Hand-written Markdown (which does not match the mirror shape) is never touched.

Usage (from the repo root)::

    python -m scripts.generate_md_mirrors          # clean + regenerate
    python -m scripts.generate_md_mirrors --clean  # remove mirrors only

Path handling is OS-agnostic (pathlib) so the script runs on Windows and macOS.
"""

from __future__ import annotations

import argparse
from pathlib import Path

# Directories we never descend into when discovering source or mirror files.
EXCLUDED_DIRS = {
    ".git",
    ".venv",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    ".antigravitycli",
    ".claude",
    "docs",
    "reports",
}

REPO_ROOT = Path(__file__).resolve().parent.parent

# The opening fence every generated mirror starts with. A Markdown file is
# treated as a prunable mirror only when its content matches this shape (a
# single fenced ``python`` block), so hand-written Markdown is left alone.
_FENCE_OPEN = "```python\n"
_FENCE_CLOSE = "```"


def _is_excluded(path: Path, root: Path) -> bool:
    return any(part in EXCLUDED_DIRS for part in path.relative_to(root).parts)


def iter_python_files(root: Path) -> list[Path]:
    """Return every ``*.py`` file under *root*, skipping excluded directories."""
    return sorted(p for p in root.rglob("*.py") if not _is_excluded(p, root))


def iter_markdown_files(root: Path) -> list[Path]:
    """Return every ``*.md`` file under *root*, skipping excluded directories."""
    return sorted(p for p in root.rglob("*.md") if not _is_excluded(p, root))


def mirror_path(py_file: Path) -> Path:
    """Path of the Markdown mirror that corresponds to *py_file*."""
    return py_file.with_suffix(".md")


def _render_mirror(source: str) -> str:
    """Wrap Python *source* in the fenced code block stored in a mirror."""
    return f"{_FENCE_OPEN}{source}\n{_FENCE_CLOSE}\n"


def is_generated_mirror(md_file: Path) -> bool:
    """Whether *md_file* looks like a generated mirror (a single ``python`` block).

    Used to distinguish prunable mirrors from hand-written Markdown so that only
    files this script produced are ever deleted.
    """
    try:
        text = md_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False
    return text.startswith(_FENCE_OPEN) and text.rstrip().endswith(_FENCE_CLOSE)


def clean(root: Path) -> int:
    """Delete every generated Markdown mirror under *root*.

    Discovery is driven by the Markdown files themselves, so a mirror is removed
    whether or not its ``.py`` source still exists — this prunes mirrors orphaned
    by a renamed, moved, or deleted source. Markdown that does not match the
    generated mirror shape is never touched.
    """
    removed = 0
    for md in iter_markdown_files(root):
        if is_generated_mirror(md):
            md.unlink()
            removed += 1
    return removed


def generate(root: Path) -> int:
    """Write a fenced-code Markdown mirror for each Python file."""
    written = 0
    for py_file in iter_python_files(root):
        source = py_file.read_text(encoding="utf-8")
        mirror_path(py_file).write_text(_render_mirror(source), encoding="utf-8")
        written += 1
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--clean",
        action="store_true",
        help="remove existing Markdown mirrors without regenerating them",
    )
    args = parser.parse_args()

    removed = clean(REPO_ROOT)
    print(f"Removed {removed} existing Markdown mirror(s).")

    if args.clean:
        return

    written = generate(REPO_ROOT)
    print(f"Wrote {written} Markdown mirror(s).")


if __name__ == "__main__":
    main()

```
