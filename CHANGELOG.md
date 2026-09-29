# Change Log

All notable changes to the "gdscript-test-runner" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added

- Godot executable resolution (`gdscriptTestRunner.godotExecutable` setting, falling back to `PATH`).
- GdUnit4 adapter: addon/version detection, `test_*.gd` / `func test_*` discovery, CLI invocation and console
  output parsing.
- Test Explorer integration: project and file discovery, lazy per-file parsing, file watching and live re-parsing
  of open editors.
- Run profile for whole projects, files and single tests, with cancellation, failure messages and locations.
