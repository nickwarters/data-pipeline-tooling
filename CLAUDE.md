# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository is **empty** at the time of writing — no source code, build files, or commits exist yet. It is being initialized to hold a **data pipeline framework**.

When the codebase takes shape, update this file with the build/lint/test commands and the architecture overview. Until then, the notes below are the only fixed constraints.

## Core constraint: cross-platform (Windows-first, macOS-compatible)

The framework's primary deployment target is **Windows**, but it must also run on **macOS** (the main development environment here — see git config and `darwin` platform). Treat this as a hard requirement that affects most design decisions:

- Use OS-agnostic path handling everywhere; never hardcode path separators or drive-letter / POSIX assumptions.
- Avoid shelling out to platform-specific commands without a cross-platform fallback.
- Be mindful of line endings (CRLF vs LF), case-sensitivity differences (Windows is case-insensitive, macOS default is case-insensitive but can be sensitive), and file-locking semantics, which differ between the two.
- Prefer dependencies and runtimes that are first-class on both platforms.

## Working in this repo

The framework's language, runtime, and tooling have not been chosen yet. Before scaffolding anything substantial, confirm those decisions with the user rather than assuming — they have indicated the details will be defined collaboratively ("We'll dive into the details next").
