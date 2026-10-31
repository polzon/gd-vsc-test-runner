# Line coverage through the Godot remote debugger

Add a "Run with Coverage" profile. During that run the extension acts as the Godot remote debugger:
it listens on a local TCP port, starts Godot with `--remote-debug` pointed at that port, sets a
breakpoint on every executable line of the project's scripts, and records each line the first time
it breaks there. Then it removes that breakpoint and continues. Results then go to VS Code's Test
Coverage view through `TestRun.addCoverage` and `TestRunProfile.loadDetailedCoverage`.

There is no addon in the project and no rewriting of scripts. The stock Godot editor binary is enough.

## Protocol facts (Godot `master`; the spike checks them on 4.5+)

- Framing: each packet is a little-endian `uint32` length, then one Godot binary-encoded Variant
  (`core/debugger/remote_debugger_peer.cpp`, `_write_out` / `_read_in`). Max packet 8 MiB.
- Every message is an Array `[command: String, thread_id: int, data: Array]` in both directions
  (`RemoteDebugger::_put_msg`, `_poll_messages`). Godot drops messages whose thread id it does not know.
- Godot connects to us as a client and retries for about 3 s (`_try_connect`). Listen before spawning.
- `breakpoint` with data `[source: "res://…", line: int (1-based), set: bool]` adds or removes a
  breakpoint. It works both while paused and while running (`debug()` loop and `_core_capture`).
- On a breakpoint hit Godot sends `debug_enter` with data `[can_continue, reason, has_stack, thread_id]`.
  For breakpoints, `reason` is `"Breakpoint"`. It then blocks until it gets `continue`, `step`, `next`
  or `out`. Godot sleeps 10 ms whenever its queue is empty.
- `get_stack_dump` answers with `stack_dump`, data `[n*3, file, line, func, …]`. Frame 0 is the hit
  line (`DebuggerMarshalls::ScriptStackDump`).
- The GDScript VM checks breakpoints only at line opcodes. The compiler emits one for each statement's
  `start_line` in every block, and one for each `match` branch (`gdscript_compiler.cpp`, `write_newline`).
  A breakpoint on any other line never fires.
- `--ignore-error-breaks` stops runtime script errors from pausing the run.
  `-b/--breakpoints source:line,…` exists, but Windows command lines are too short to list every line.

## Spike findings (Godot 4.7.2, demo project)

- Every envelope used thread id `1`; `debug_enter` data was `[true, "Breakpoint", true, 1]`.
  Godot's `Thread::MAIN_ID` is `1`, and that is the only thread registered at startup.
- Breakpoints sent immediately after connect, before `set_pid`, applied before the first test ran.
- `get_stack_dump` and `continue` sent back to back work; `stack_dump` frame 0 was
  `res://test/test_example_test.gd`, line 5 for a breakpoint on line 5 (1-based).
- A breakpoint on a line inside brackets (line 11) never fired, matching the compiler rule.
- Each break round trip took about 15-20 ms; GdUnit4 reported 27 ms for a test that normally
  takes 29 ms, so pauses do not threaten the test timeout.
- GdUnit4 results still appeared on stdout while the debugger was connected.
- `--ignore-error-breaks` must go before the script path, next to the other engine flags.

## Run flow (coverage profile)

1. Collect the in-scope scripts: every `.gd` under the project root, except `addons/`, `.godot/`, and
   files that match the adapter's `discovery.fileFilter`. For each script, `executableLines` lists its
   executable lines.
2. `DebuggerServer.listen()` on `127.0.0.1:0` and read the port.
3. `buildRunArgs({ ..., debuggerUri: 'tcp://127.0.0.1:<port>' })`. The GdUnit4 adapter uses this URI
   in place of `tcp://127.0.0.1:0` and adds `--ignore-error-breaks`.
4. Spawn Godot with `runGodot`. stdout parsing for test results does not change.
5. When Godot connects, send `breakpoint [res, line, true]` for every executable line. The thread id
   comes from the first envelope Godot sends; the spike checks whether it is always the main thread id.
6. On `debug_enter` with reason `"Breakpoint"`, send `get_stack_dump`, then `continue`, without
   waiting in between. On `stack_dump`, mark frame 0 as hit and send `breakpoint [file, line, false]`.
   If a loop breaks on the same line again before the removal arrives, record it again and continue.
   For any other reason, send `continue`.
7. When the process closes, build one report entry per in-scope file: its executable lines, plus any
   hit line the scanner missed, each marked hit or not hit.
8. For each file, call `run.addCoverage(FileCoverage.fromDetails(uri, details))`. `details` is one
   `StatementCoverage(hit, new Range(line-1, 0, line-1, lineLength))` per line. A `WeakMap` keyed by
   the `FileCoverage` object keeps `details`, and `loadDetailedCoverage` reads them from there.

## Files

- `src/godot/variant.ts` — Godot binary Variant encode/decode. Covers nil, bool, int (32/64 flag),
  float (32/64), String, StringName, Array, Dictionary, and the packed arrays the debugger sends.
  Throws on any other type. Reference: `core/io/marshalls.cpp`. godot-tools'
  `src/debugger/godot4/variables/variant_decoder.ts` (MIT) is prior art.
- `src/godot/debuggerServer.ts` — `net` server that accepts one connection. It splits the stream into
  packets, handling packets split across or merged into chunks, and decodes each one. A packet that
  cannot be decoded is dropped and logged once. Emits `{ command, threadId, data }` and offers
  `send(command, data, threadId)` and `close()`.
- `src/coverage/executableLines.ts` — `executableLines(source: string): number[]` (1-based), following
  the compiler's rule. It counts statement start lines inside `func` bodies, including lambdas and
  inner-class methods, plus `elif` lines and `match` branch pattern lines. It skips blank lines,
  comments, `else:`, annotations, class-level declarations, the `func` line itself, and lines inside
  brackets, after a `\` continuation, or inside `"""`/`'''` strings.
- `src/coverage/lineCollector.ts` — `collectLineHits(server, targets: Map<res, number[]>): Promise<Map<res, Set<number>>>`,
  implementing steps 5–6.
- `src/coverage/coverageStore.ts` — turns hits into `FileCoverage` + details, and holds the `WeakMap`.
- `src/adapters/types.ts` — add `debuggerUri?: string` to `RunRequestInfo`.
- `src/adapters/gdunit4Adapter.ts` — apply `debuggerUri` and `--ignore-error-breaks` in `buildRunArgs`.
- `src/testing/runOrchestrator.ts` — add `run(request, token, { coverage: boolean })`. The coverage
  branch wraps the spawn in `runProject` with the server and collector, then publishes coverage.
- `src/extension.ts` — second profile `'Run with Coverage'`, `vscode.TestRunProfileKind.Coverage`,
  with `loadDetailedCoverage` set.
- Demo: add `src/demo/gdunit4-adapter-demo/src/calculator.gd` (a function with an `if`/`else` branch
  and a `match`) and `test/test_calculator.gd`. The tests cover one branch and leave the other uncovered.
- `README.md` — add coverage to Features, and note the limits under Known Issues.

## Key decisions

- Debugger breakpoints over rewriting scripts. Breakpoints leave the user's files and the compiled
  code unchanged. A scanner mistake only mislabels a line; it cannot break compilation.
- Each breakpoint is removed after its first hit. Cost grows with the number of executable lines,
  not with how often they run. Counting every hit would need `step` on every line, which is too slow.
  So VS Code shows covered/uncovered, not hit counts.
- Files no test touched are reported at 0%, so untested scripts show up in the Coverage view.
- Out of scope for v1: branch coverage, per-test coverage (`includesTests`), a Debug profile, and the
  LSP. The LSP runs inside the Godot editor process, and this flow does not need it.

## Tasks

1. **Spike (go/no-go).** Write a throwaway script against the demo project. It listens, launches
   Godot with the current GdUnit4 args plus our URI and `--ignore-error-breaks`, sets one breakpoint
   in `calculator.gd`, and prints every message. Confirm each of these:
   - `debug_enter` → `stack_dump` → `continue` works.
   - GdUnit4 results still appear on stdout while a debugger is connected.
   - Breakpoints sent right after connect apply before the first test runs.
   - Which thread id to use.
   - The time per hit, on a few hundred lines.
   - GdUnit4 test timeouts do not fire because of time spent paused.
   Record the findings in this plan before continuing.
2. `variant.ts` with unit tests: round-trips, plus byte fixtures captured in the spike.
3. `debuggerServer.ts` with unit tests: split and merged chunks, an undecodable packet, close.
4. `executableLines.ts` with fixture tests: if/elif/else, match, lambdas, inner classes, multi-line
   calls, strings containing `#` or `:`, `\` continuations, annotations.
5. `lineCollector.ts` with tests against a fake server.
6. Adapter `debuggerUri` support. Update the `buildRunArgs` assertions in
   `src/test/gdunit4Adapter.test.ts:125-158`.
7. `coverageStore.ts`, the orchestrator coverage branch, and the extension profile.
8. Demo files. Update `src/test/extension.test.ts:59-90`, which asserts there is exactly one test file
   with two tests. Add an integration test in the style of `src/test/gdunit4Run.test.ts`: a coverage
   run on the demo reports the taken branch of `calculator.gd` as covered and the other branch as
   uncovered.
9. README.

## Failure handling

- Godot never connects: it gives up after its retries and runs without a debugger. Tests still get
  results. The run logs "debugger did not connect; no coverage" and publishes no coverage.
- Cancel: close the server and kill the process, as the normal run already does.
- The debugger disconnects mid-run: publish the hits collected so far, and say in the log that
  coverage is partial.

## Validation

`npm run compile`, then `npm test` with `godot` on PATH. In the Extension Development Host (F5), run
"Run with Coverage" on the demo. The Test Coverage view should list `calculator.gd` with the
uncovered branch highlighted.
