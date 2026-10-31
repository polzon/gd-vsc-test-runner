# GDScript Test Runner

Runs GDScript unit tests from the VS Code Testing view. This extension only runs tests. Editing, linting and
language support are handled by the Godot executable and extensions like `godot-tools`.

## Features

- Finds every Godot project (`project.godot`) in the workspace and detects its test framework.
- Lists test files and their test cases in the Test Explorer, with run buttons in the editor gutter.
- Runs a whole project, a single file or a single test, then shows pass/fail/skip results, failure messages with
  source locations, and the full Godot output.
- Runs tests with line coverage: the extension acts as Godot's remote debugger, so covered and uncovered lines
  appear in the Test Coverage view. Coverage covers the project's scripts but not its test files or `addons/`.
- Updates the test tree when you create, edit or delete test files.
- Stops the Godot process when you cancel a run.

### Supported frameworks

| Framework                                                     | Detection                        | Test files                                 | Test cases              |
| ------------------------------------------------------------- | -------------------------------- | ------------------------------------------ | ----------------------- |
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

- Parameterized tests are not discovered separately.
- There is no debug profile yet.
- Coverage records whether a line ran, not how many times, because each line's breakpoint is removed after
  its first hit.
- Coverage pauses Godot on each newly hit line, so runs are slower than plain test runs.
- Coverage skips lines inside `addons/` and test files, and only sees lines the GDScript compiler emits
  breakpoints for.

## Development

- `npm run compile`: type-check, lint and bundle.
- `npm test`: runs the unit and integration tests in a VS Code test host opened on
  `src/demo/gdunit4-adapter-demo`. The integration tests need `godot` on `PATH`.
- `F5`: launches the Extension Development Host with the demo project open.

## Build & Install

- `npm install`
- `npm run compile`
- `npx @vscode/vsce package`
- `code --install-extension .\gdscript-test-runner-0.0.1.vsix`
