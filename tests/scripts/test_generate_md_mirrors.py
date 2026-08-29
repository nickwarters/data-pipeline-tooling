"""Test orphan cleaning and generated-mirror overwrite refusal."""

from pathlib import Path

import pytest

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

    # Relocate one source and delete another to exercise both stale-file cases.
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


def test_generate_refuses_to_overwrite_hand_written_markdown(tmp_path):
    """Refuse a generated-mirror path occupied by handwritten Markdown."""
    runbook = tmp_path / "deploy.md"
    runbook.write_text("# Deploy runbook\n\nHand-written prose.\n", encoding="utf-8")
    (tmp_path / "deploy.py").write_text("x = 1\n", encoding="utf-8")

    with pytest.raises(gen.MirrorCollisionError) as excinfo:
        gen.generate(tmp_path)

    assert "deploy.md" in str(excinfo.value)
    assert _read(runbook).startswith("# Deploy runbook")


def test_generate_writes_nothing_when_any_path_collides(tmp_path):
    """The refusal is atomic: one collision leaves every other mirror unwritten."""
    (tmp_path / "fine.py").write_text("a = 1\n", encoding="utf-8")
    (tmp_path / "clash.py").write_text("b = 2\n", encoding="utf-8")
    (tmp_path / "clash.md").write_text("prose\n", encoding="utf-8")

    with pytest.raises(gen.MirrorCollisionError):
        gen.generate(tmp_path)

    assert not (tmp_path / "fine.md").exists()


def test_generate_overwrites_its_own_mirror(tmp_path):
    """A stale *mirror* at the path is the normal case and is rewritten."""
    source = tmp_path / "mod.py"
    source.write_text("current = True\n", encoding="utf-8")
    (tmp_path / "mod.md").write_text(
        gen._render_mirror("stale = True\n"), encoding="utf-8"
    )

    assert gen.generate(tmp_path) == 1
    assert "current = True" in _read(tmp_path / "mod.md")


def test_find_collisions_reports_only_hand_written_markdown(tmp_path):
    (tmp_path / "prose.py").write_text("a = 1\n", encoding="utf-8")
    (tmp_path / "prose.md").write_text("# Not a mirror\n", encoding="utf-8")
    (tmp_path / "mirrored.py").write_text("b = 2\n", encoding="utf-8")
    (tmp_path / "mirrored.md").write_text(
        gen._render_mirror("b = 2\n"), encoding="utf-8"
    )
    (tmp_path / "bare.py").write_text("c = 3\n", encoding="utf-8")

    assert gen.find_collisions(tmp_path) == [tmp_path / "prose.py"]


def test_node_modules_is_not_scanned(tmp_path):
    """Exclude dependency trees from mirror discovery."""
    pkg = tmp_path / "node_modules" / "flatted" / "python"
    pkg.mkdir(parents=True)
    (pkg / "flatted.py").write_text("x = 1\n", encoding="utf-8")
    (pkg / "flatted.md").write_text("# Third-party prose\n", encoding="utf-8")

    assert gen.find_collisions(tmp_path) == []
    assert gen.generate(tmp_path) == 0
    assert not (pkg / "flatted.py").with_suffix(".md").read_text().startswith("```")


def test_main_refuses_before_cleaning(tmp_path, monkeypatch, capsys):
    """Detect collisions before cleaning so refusal preserves existing mirrors."""
    (tmp_path / "clash.py").write_text("a = 1\n", encoding="utf-8")
    (tmp_path / "clash.md").write_text("# Prose\n", encoding="utf-8")
    survivor = tmp_path / "other.md"
    survivor.write_text(gen._render_mirror("b = 2\n"), encoding="utf-8")
    (tmp_path / "other.py").write_text("b = 2\n", encoding="utf-8")

    monkeypatch.setattr(gen, "REPO_ROOT", tmp_path)
    monkeypatch.setattr("sys.argv", ["generate_md_mirrors.py"])

    with pytest.raises(SystemExit) as excinfo:
        gen.main()

    assert "clash.md" in str(excinfo.value)
    assert survivor.exists(), "an unrelated mirror was deleted by a refused run"
    assert _read(tmp_path / "clash.md") == "# Prose\n"
    assert "Removed" not in capsys.readouterr().out


def test_is_generated_mirror_recognises_generated_shape(tmp_path):
    mirror = tmp_path / "m.md"
    mirror.write_text(gen._render_mirror(""), encoding="utf-8")
    assert gen.is_generated_mirror(mirror)

    prose = tmp_path / "p.md"
    prose.write_text("just words\n", encoding="utf-8")
    assert not gen.is_generated_mirror(prose)
