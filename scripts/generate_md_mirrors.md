```python
#!/usr/bin/env python3
"""Generate (or clean up) Markdown mirrors of every Python source file.

For each ``<name>.py`` in the repo a sibling ``<name>.md`` is written whose body
is the Python source wrapped in a fenced ``python`` code block. Running the
script first removes any existing mirrors and then regenerates them, so it is
safe to re-run after files are added, renamed, or deleted.

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


def _is_excluded(path: Path) -> bool:
    return any(part in EXCLUDED_DIRS for part in path.relative_to(REPO_ROOT).parts)


def iter_python_files(root: Path) -> list[Path]:
    """Return every ``*.py`` file under *root*, skipping excluded directories."""
    return sorted(p for p in root.rglob("*.py") if not _is_excluded(p))


def mirror_path(py_file: Path) -> Path:
    """Path of the Markdown mirror that corresponds to *py_file*."""
    return py_file.with_suffix(".md")


def clean(root: Path) -> int:
    """Delete the Markdown mirror sitting next to each Python file."""
    removed = 0
    for py_file in iter_python_files(root):
        md = mirror_path(py_file)
        if md.exists():
            md.unlink()
            removed += 1
    return removed


def generate(root: Path) -> int:
    """Write a fenced-code Markdown mirror for each Python file."""
    written = 0
    for py_file in iter_python_files(root):
        source = py_file.read_text(encoding="utf-8")
        body = f"```python\n{source}\n```\n"
        mirror_path(py_file).write_text(body, encoding="utf-8")
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
