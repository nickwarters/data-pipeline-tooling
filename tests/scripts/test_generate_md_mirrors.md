```python
"""Tests for the Markdown-mirror generator.

The generator keeps a ``.md`` mirror beside every ``.py`` source. The behaviour
that needs guarding is the *clean* step: it must prune mirrors orphaned when a
source is renamed, moved, or deleted, while never touching hand-written Markdown.
"""

from pathlib import Path

from scripts import generate_md_mirrors as gen


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_generate_then_regenerate_leaves_no_orphans(tmp_path):
    """After a source moves and is deleted, regenerating prunes the stale mirrors."""
    src = tmp_path / "pkg"
    src.mkdir()
    (src / "keep.py").write_text("x = 1\n", encoding="utf-8")
    (src / "move_me.py").write_text("y = 2\n", encoding="utf-8")
    (src / "delete_me.py").write_text("z = 3\n", encoding="utf-8")

    assert gen.generate(tmp_path) == 3
    assert (src / "keep.md").exists()
    assert (src / "move_me.md").exists()
    assert (src / "delete_me.md").exists()

    # Relocate one source and delete another, as a branch merge would.
    (src / "move_me.py").rename(src / "renamed.py")
    (src / "delete_me.py").unlink()

    # A full clean + regenerate cycle must leave no orphaned mirrors behind.
    gen.clean(tmp_path)
    gen.generate(tmp_path)

    mirrors = {p.name for p in src.glob("*.md")}
    assert mirrors == {"keep.md", "renamed.md"}
    assert not (src / "move_me.md").exists()
    assert not (src / "delete_me.md").exists()


def test_clean_prunes_orphan_with_no_py_sibling(tmp_path):
    """An orphaned mirror is removed even though clean is not given its source."""
    orphan = tmp_path / "gone.md"
    orphan.write_text(gen._render_mirror("a = 1\n"), encoding="utf-8")

    assert gen.clean(tmp_path) == 1
    assert not orphan.exists()


def test_clean_leaves_hand_written_markdown_untouched(tmp_path):
    """Non-mirror Markdown (no single ``python`` fence) is never pruned."""
    prose = tmp_path / "README.md"
    prose.write_text("# Title\n\nSome prose, not a code mirror.\n", encoding="utf-8")
    mixed = tmp_path / "NOTES.md"
    mixed.write_text("Intro\n\n```python\nx = 1\n```\n\nOutro\n", encoding="utf-8")

    assert gen.clean(tmp_path) == 0
    assert prose.exists()
    assert mixed.exists()
    assert _read(prose).startswith("# Title")


def test_excluded_dirs_are_skipped(tmp_path):
    """Mirrors under excluded directories (e.g. ``docs/``) are not pruned."""
    docs = tmp_path / "docs"
    docs.mkdir()
    doc_mirror = docs / "snippet.md"
    doc_mirror.write_text(gen._render_mirror("kept = True\n"), encoding="utf-8")

    assert gen.clean(tmp_path) == 0
    assert doc_mirror.exists()


def test_is_generated_mirror_recognises_generated_shape(tmp_path):
    mirror = tmp_path / "m.md"
    mirror.write_text(gen._render_mirror(""), encoding="utf-8")
    assert gen.is_generated_mirror(mirror)

    prose = tmp_path / "p.md"
    prose.write_text("just words\n", encoding="utf-8")
    assert not gen.is_generated_mirror(prose)

```
