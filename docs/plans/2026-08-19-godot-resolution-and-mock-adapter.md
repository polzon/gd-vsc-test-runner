# Godot Resolution & Mock Adapter Implementation Plan

**Goal:** Build the first two concrete pieces of the extension: (1) Godot binary resolution (PATH fallback + settings override) and (2) a deterministic mock `TestFrameworkAdapter` that returns fixed tests for use in unit tests.

**Architecture:** Introduce a host-agnostic adapter contract (`types.ts`) so adapters stay free of a `vscode` dependency and are trivially unit-testable. Add a pure Godot resolver that probes `--version`, and a `configuration` module that reads VS Code settings. Wire resolution into activation to prove the setting → resolve → log path end-to-end.

**Tech Stack:** TypeScript 5.9 (strict), VS Code extension API, Node `child_process`/`fs`, `@vscode/test-cli` (vscode-test) + mocha, esbuild bundling.

**Assumptions:**

- Source convention: adapter code under `src/adapters/`, Godot-related code under `src/godot/`.
- Tests use the existing vscode-test harness only (per decision), compiled `tsc` → `out/`, run via `npm test`. New tests live in `src/test/*.test.ts`.
- The Godot executable is available on the dev machine as `godot.exe` (4.7.1) — one test relies on PATH resolution.

---

## Context notes (verified against `third_party/gdUnit4`)

These are captured here for future tasks; they inform the resolver design but the GdUnit4 adapter is **not** built in this plan.

- **Godot version string format** (from `godot.exe --version`): `4.7.1.stable.official.a13da4feb` — a dot-separated, non-semver string we treat as an opaque blob for now.
- **GdUnit4 headless is rejected by default.** `GdUnitTestCIRunner` explicitly errors out in `headless` mode unless `--ignoreHeadlessMode` is passed. The official `runtest.cmd/.sh` scripts run **non-headless with a minimized window** and pass `--remote-debug tcp://127.0.0.1:0` to suppress the interactive debug loop.
- **`runtest.cmd/.sh` accept `--godot_binary <path>`** (takes precedence over the `GODOT_BIN` env var) — cleaner than relying on the env var when we build the GdUnit4 adapter.
- **GdUnit4 stdout** (from `GdUnitConsoleTestReporter.gd`): per-test lines `suite > test` with a right-padded `PASSED`/`FAILED`/`SKIPPED`/`WARNING`/`FLAKY` status (column 86, ANSI-colored), then `Overall Summary:`, `Executed test suites:`, `Executed test cases :`, `Total execution time:`. Exit codes `0` success / `100` failures / `101` warnings.

---

### Task 1: Adapter contract types

**Files:**

- Create: `src/adapters/types.ts`

**Step 1: Create the types module**

```ts
/**
 * Source span of a discovered test case, expressed in plain 0-based
 * line/character coordinates. The discovery engine converts these to
 * vscode.Range when building TestItems, keeping adapters free of a vscode
 * dependency so they stay trivially unit-testable.
 */
export interface SourceRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** A single test case discovered from a source file. */
export interface TestCaseDescriptor {
  name: string;
  range: SourceRange;
}

/** Outcome of a single test after a run. */
export type TestStatus = "passed" | "failed" | "skipped";

/** A single test result reported by an adapter. */
export interface TestResult {
  name: string;
  status: TestStatus;
  message?: string;
  duration?: number;
}

/** Adapter-agnostic description of a run request. */
export interface RunRequestInfo {
  /** Absolute paths of test files to include. Empty = all. */
  includeFiles: string[];
  /** Names of tests to exclude. */
  excludeTests: string[];
}

/** Discovery rules supplied by each adapter. */
export interface DiscoveryRules {
  /** Glob identifying this framework's test files. */
  fileFilter: string;
  /** Extract test cases from file contents. */
  parseTestCases(content: string): TestCaseDescriptor[];
}

/**
 * The seam between the extension core and a specific test framework.
 * One implementation per framework library.
 */
export interface TestFrameworkAdapter {
  /** Unique id, e.g. "gdUnit4". */
  readonly id: string;
  /** Human-readable name. */
  readonly displayName: string;
  /** Discovery rules for this framework. */
  readonly discovery: DiscoveryRules;
  /** Is this framework present in the given workspace root? */
  detect(workspaceRoot: string): Promise<boolean>;
  /** Parse the framework version, if supported. Optional. */
  detectVersion(workspaceRoot: string): Promise<string | undefined>;
  /** Translate a run request into CLI args for the framework tool. */
  buildRunArgs(request: RunRequestInfo): string[];
  /** Parse raw CLI output into structured per-test results. */
  parseResults(rawOutput: string): TestResult[];
}
```

**Step 2: Verify it type-checks**

Run: `npm run check-types`
Expected: PASS (no output; `tsc --noEmit` exits 0).

**Step 3: Commit**

```bash
git add src/adapters/types.ts
git commit -m "chore(adapters): define TestFrameworkAdapter contract types"
```

---

### Task 2: Mock adapter

**Files:**

- Create: `src/adapters/mockAdapter.ts`
- Test: `src/test/mockAdapter.test.ts`

**Step 1: Write the failing test**

Create `src/test/mockAdapter.test.ts`:

```ts
import * as assert from "assert";
import { mockAdapter } from "../adapters/mockAdapter";

suite("mockAdapter", () => {
  test("exposes expected identity", () => {
    assert.strictEqual(mockAdapter.id, "mock");
    assert.strictEqual(mockAdapter.displayName, "Mock Adapter");
  });

  test("detects itself in any workspace", async () => {
    assert.strictEqual(await mockAdapter.detect("/any/path"), true);
    assert.strictEqual(
      await mockAdapter.detectVersion("/any/path"),
      "0.0.0-mock",
    );
  });

  test("discovery returns the fixed set of test cases", () => {
    const cases = mockAdapter.discovery.parseTestCases("ignored");
    assert.strictEqual(cases.length, 3);
    assert.strictEqual(cases[0].name, "test_addition");
    assert.strictEqual(cases[1].name, "test_subtraction");
    assert.strictEqual(cases[2].name, "test_multiplication");
  });

  test("parseResults returns the fixed set and returns copies", () => {
    const first = mockAdapter.parseResults("ignored");
    assert.strictEqual(first.length, 3);
    assert.strictEqual(first[1].status, "failed");
    assert.strictEqual(first[1].message, "expected 5, got 4");

    // Mutation of a returned result must not corrupt the shared fixture.
    first[0].name = "corrupted";
    const second = mockAdapter.parseResults("ignored");
    assert.strictEqual(second[0].name, "test_addition");
  });

  test("buildRunArgs maps include files and exclude tests", () => {
    const args = mockAdapter.buildRunArgs({
      includeFiles: ["/proj/test_1.gd", "/proj/test_2.gd"],
      excludeTests: ["test_addition"],
    });
    assert.deepStrictEqual(args, [
      "--file",
      "/proj/test_1.gd",
      "--file",
      "/proj/test_2.gd",
      "--exclude",
      "test_addition",
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `error TS2307: Cannot find module '../adapters/mockAdapter'`.

**Step 3: Write the implementation**

Create `src/adapters/mockAdapter.ts`:

```ts
import {
  DiscoveryRules,
  RunRequestInfo,
  TestCaseDescriptor,
  TestFrameworkAdapter,
  TestResult,
} from "./types";

const MOCK_TEST_CASES: TestCaseDescriptor[] = [
  {
    name: "test_addition",
    range: { startLine: 3, startCharacter: 0, endLine: 5, endCharacter: 0 },
  },
  {
    name: "test_subtraction",
    range: { startLine: 7, startCharacter: 0, endLine: 9, endCharacter: 0 },
  },
  {
    name: "test_multiplication",
    range: { startLine: 11, startCharacter: 0, endLine: 13, endCharacter: 0 },
  },
];

const MOCK_RESULTS: TestResult[] = [
  { name: "test_addition", status: "passed", duration: 12 },
  {
    name: "test_subtraction",
    status: "failed",
    message: "expected 5, got 4",
    duration: 9,
  },
  { name: "test_multiplication", status: "skipped" },
];

const discovery: DiscoveryRules = {
  fileFilter: "**/test_*.gd",
  parseTestCases(_content: string): TestCaseDescriptor[] {
    return MOCK_TEST_CASES.map((t) => ({ ...t, range: { ...t.range } }));
  },
};

/**
 * A deterministic adapter used to exercise the extension core in unit tests
 * without depending on the real GdUnit4 addon or a Godot binary.
 */
export const mockAdapter: TestFrameworkAdapter = {
  id: "mock",
  displayName: "Mock Adapter",
  discovery,
  async detect(_workspaceRoot: string): Promise<boolean> {
    return true;
  },
  async detectVersion(_workspaceRoot: string): Promise<string | undefined> {
    return "0.0.0-mock";
  },
  buildRunArgs(request: RunRequestInfo): string[] {
    const args: string[] = [];
    for (const file of request.includeFiles) {
      args.push("--file", file);
    }
    for (const name of request.excludeTests) {
      args.push("--exclude", name);
    }
    return args;
  },
  parseResults(_rawOutput: string): TestResult[] {
    return MOCK_RESULTS.map((r) => ({ ...r }));
  },
};
```

**Step 4: Run tests and verify they pass**

Run: `npm test`
Expected: `compile-tests` succeeds; the mockAdapter suite reports 5 passing tests.

**Step 5: Commit**

```bash
git add src/adapters/mockAdapter.ts src/test/mockAdapter.test.ts
git commit -m "feat(adapters): add deterministic mock adapter for unit tests"
```

---

### Task 3: Godot binary resolver

**Files:**

- Create: `src/godot/godotResolver.ts`
- Test: `src/test/godotResolver.test.ts`

**Step 1: Write the failing test**

Create `src/test/godotResolver.test.ts`:

```ts
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GodotProbe, resolveGodot } from "../godot/godotResolver";

const okProbe: GodotProbe = () => ({ ok: true, version: "9.9.9.test" });

suite("resolveGodot", () => {
  test("returns not-found for a non-existent explicit path", () => {
    const result = resolveGodot(
      path.join("C:\\does\\not\\exist", "godot.exe"),
      okProbe,
    );
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error.code, "not-found");
    }
  });

  test("resolves an explicit path and reports its probed version", () => {
    const tmp = path.join(os.tmpdir(), `fake-godot-${Date.now()}.exe`);
    fs.writeFileSync(tmp, "");
    try {
      const result = resolveGodot(tmp, okProbe);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.godot.path, tmp);
        assert.strictEqual(result.godot.version, "9.9.9.test");
        assert.strictEqual(result.godot.source, "setting");
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("returns version-failed when the probe fails on an existing path", () => {
    const tmp = path.join(os.tmpdir(), `fake-godot-${Date.now()}.exe`);
    fs.writeFileSync(tmp, "");
    try {
      const result = resolveGodot(tmp, () => ({ ok: false, message: "boom" }));
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error.code, "version-failed");
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  test("falls back to PATH when no explicit path is configured", () => {
    // Requires `godot` on PATH; present in the development environment.
    const result = resolveGodot(undefined);
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.godot.source, "path");
      assert.match(result.godot.version, /^\d+\.\d+/);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run compile-tests`
Expected: FAIL — `error TS2307: Cannot find module '../godot/godotResolver'`.

**Step 3: Write the implementation**

Create `src/godot/godotResolver.ts`:

```ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import * as path from "path";

export interface ResolvedGodot {
  path: string;
  version: string;
  source: "setting" | "path";
}

export type GodotResolutionError =
  | { code: "not-found"; message: string }
  | { code: "version-failed"; message: string };

export type GodotResolutionResult =
  | { ok: true; godot: ResolvedGodot }
  | { ok: false; error: GodotResolutionError };

export type GodotProbeResult =
  | { ok: true; version: string }
  | { ok: false; message: string };

/**
 * Runs `<executable> --version` and captures the version string.
 * Injectable so tests can avoid spawning a real Godot process.
 */
export type GodotProbe = (executable: string) => GodotProbeResult;

function defaultProbe(executable: string): GodotProbeResult {
  const result = spawnSync(executable, ["--version"], { encoding: "utf-8" });
  if (result.error) {
    return {
      ok: false,
      message: `Failed to execute '${executable}': ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message: `'${executable} --version' exited with code ${result.status}.`,
    };
  }
  const version = (result.stdout ?? "").trim();
  if (version === "") {
    return {
      ok: false,
      message: `'${executable} --version' produced no output.`,
    };
  }
  return { ok: true, version };
}

function executableName(): string {
  return process.platform === "win32" ? "godot.exe" : "godot";
}

function isExecutableFile(candidate: string): boolean {
  return existsSync(candidate);
}

/**
 * Resolve the Godot executable.
 *
 * Precedence:
 *   1. An explicit configured path (non-empty), which must already exist.
 *   2. Otherwise, the first `godot` on `PATH` that reports a version.
 *
 * A configured path that does not exist is reported as an error (we do not
 * silently fall back to PATH, to avoid masking user misconfiguration).
 */
export function resolveGodot(
  configuredPath: string | undefined,
  probe: GodotProbe = defaultProbe,
): GodotResolutionResult {
  const explicit = configuredPath?.trim();
  if (explicit) {
    if (!isExecutableFile(explicit)) {
      return {
        ok: false,
        error: {
          code: "not-found",
          message: `Configured Godot executable not found: ${explicit}`,
        },
      };
    }
    const result = probe(explicit);
    if (!result.ok) {
      return {
        ok: false,
        error: { code: "version-failed", message: result.message },
      };
    }
    return {
      ok: true,
      godot: { path: explicit, version: result.version, source: "setting" },
    };
  }

  const name = executableName();
  const dirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((d) => d.length > 0);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (!isExecutableFile(candidate)) {
      continue;
    }
    const result = probe(candidate);
    if (result.ok) {
      return {
        ok: true,
        godot: { path: candidate, version: result.version, source: "path" },
      };
    }
  }
  return {
    ok: false,
    error: {
      code: "not-found",
      message: `Godot executable ('${name}') not found on PATH.`,
    },
  };
}
```

**Step 4: Run tests and verify they pass**

Run: `npm test`
Expected: `resolveGodot` suite reports 4 passing tests (the PATH-fallback test resolves `godot.exe` 4.7.1 in this environment).

**Step 5: Commit**

```bash
git add src/godot/godotResolver.ts src/test/godotResolver.test.ts
git commit -m "feat(godot): add Godot binary resolver with PATH fallback"
```

---

### Task 4: Settings contribution

**Files:**

- Modify: `package.json` (add `contributes.configuration`)
- Create: `src/godot/configuration.ts`

**Step 1: Add the setting**

In `package.json`, add a `configuration` block inside `contributes` (alongside `commands`):

```json
"configuration": {
	"title": "GDScript Test Runner",
	"properties": {
		"gdscriptTestRunner.godotExecutable": {
			"type": "string",
			"default": "",
			"description": "Absolute path to the Godot executable. Leave empty to resolve 'godot' from PATH."
		}
	}
}
```

**Step 2: Create the settings reader**

Create `src/godot/configuration.ts`:

```ts
import * as vscode from "vscode";

export const CONFIG_SECTION = "gdscriptTestRunner";
export const GODOT_EXECUTABLE_KEY = "godotExecutable";

/**
 * Read the configured Godot executable path from VS Code settings.
 * Returns undefined when empty/unset (meaning "resolve from PATH").
 */
export function getConfiguredGodotPath(): string | undefined {
  const value = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>(GODOT_EXECUTABLE_KEY);
  if (!value || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}
```

**Step 3: Verify type-check and lint**

Run: `npm run check-types && npm run lint`
Expected: PASS (no errors).

**Step 4: Commit**

```bash
git add package.json src/godot/configuration.ts
git commit -m "feat(config): add godotExecutable setting"
```

---

### Task 5: Wire resolution into activation

**Files:**

- Modify: `src/extension.ts`

**Step 1: Import the new modules**

Add to the top of `src/extension.ts`:

```ts
import { getConfiguredGodotPath } from "./godot/configuration";
import { resolveGodot } from "./godot/godotResolver";
```

**Step 2: Resolve and log in `activate`**

Replace the body of `activate` so that, after `setupOutputChannel()`, it resolves Godot and logs the result:

```ts
setupOutputChannel();
const output = getOutputChannel();
output.appendLine("GDScript Test Runner activated.");

const configured = getConfiguredGodotPath();
const result = resolveGodot(configured);
if (result.ok) {
  output.appendLine(
    `Godot resolved (${result.godot.source}): ${result.godot.path}`,
  );
  output.appendLine(`Godot version: ${result.godot.version}`);
} else {
  output.appendLine(
    `Godot resolution failed [${result.error.code}]: ${result.error.message}`,
  );
}
```

**Step 3: Build and verify**

Run: `npm run compile`
Expected: PASS (esbuild bundles the new modules into `dist/extension.js` with no errors).

**Step 4: Manual verification (F5)**

Press `F5` to launch the Extension Development Host, then open the "GDScript Test Runner" output channel.
Expected log (in this environment):

```
GDScript Test Runner activated.
Godot resolved (path): C:\Users\Zack\AppData\Roaming\godotenv\godot\bin\godot.exe
Godot version: 4.7.1.stable.official.a13da4feb
```

---

## Out of scope (future tasks)

- Discovery engine wiring (`TestController`, `TestItem` tree, file watcher).
- Test run orchestration (`TestRunProfile`, `TestRunRequest` → adapter invocation, result publishing).
- The real GdUnit4 adapter (detection, version parsing, `runtest` invocation, stdout parsing).
- Debug-in-test.

## Notes for the engineer

- **PATH-fallback test caveat:** `godotResolver.test.ts` has one test that depends on `godot` being on `PATH`. It will pass in this dev environment but is environment-sensitive. If we later want CI-hermetic tests, inject the `probe` (already done) and also inject the existence check/PATH list; revisit only if it becomes a problem (YAGNI for now).
- **No-fallback decision:** a configured-but-missing executable returns `not-found` rather than silently falling back to `PATH`. This is intentional so a typo in the setting is surfaced, not masked.
