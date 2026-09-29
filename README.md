# GDScript Test Runner

Runs GDScript unit tests from the VS Code Testing view. This extension only runs tests. Editing, linting and
language support are handled by the Godot executable and extensions like `godot-tools`.

## Features

- Finds every Godot project (`project.godot`) in the workspace and detects its test framework.
- Lists test files and their test cases in the Test Explorer, with run buttons in the editor gutter.
- Runs a whole project, a single file or a single test, then shows pass/fail/skip results, failure messages with
  source locations, and the full Godot output.
- Updates the test tree when you create, edit or delete test files.
- Stops the Godot process when you cancel a run.

### Supported frameworks

| Framework                                       | Detection                          | Test files   | Test cases            |
| ----------------------------------------------- | ---------------------------------- | ------------ | --------------------- |
| [GdUnit4](https://github.com/godot-gdunit-labs/gdUnit4) (6.x) | `addons/gdUnit4/` in the project | `test_*.gd` that `extends GdUnitTestSuite` | top-level `func test_*` |

Anything under `addons/` and `.godot/` is ignored during discovery.

## Requirements

- The Godot 4 editor executable (GdUnit4 6.x needs Godot 4.5+).
- A supported test framework installed in the Godot project.

## Extension Settings

- `gdscriptTestRunner.godotExecutable`: absolute path to the Godot executable. When empty, `godot` (`godot.exe` on
  Windows) is looked up on `PATH`. If you set a path that doesn't exist, you get an error. The extension does not
  fall back to `PATH` in that case.

## Known Issues

- GdUnit4 rejects headless mode, so every run briefly opens a Godot window, just like GdUnit4's own `runtest`
  scripts.
- Parameterized tests are not discovered separately.
- There is no debug profile yet.
- GdUnit4 HTML/XML reports are written to the OS temp directory instead of the project's `reports/` folder.

## Development

- `npm run compile`: type-check, lint and bundle.
- `npm test`: runs the unit and integration tests in a VS Code test host opened on
  `src/demo/gdunit4-adapter-demo`. The integration tests need `godot` on `PATH`.
- `F5`: launches the Extension Development Host with the demo project open.
