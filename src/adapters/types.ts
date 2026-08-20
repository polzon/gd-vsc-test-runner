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
export type TestStatus = 'passed' | 'failed' | 'skipped';

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
