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

/** Identifies one test case: the absolute path of its file plus its name. */
export interface TestRef {
    file: string;
    name: string;
}

/** Outcome of a single test after a run. */
export type TestStatus = 'passed' | 'failed' | 'skipped';

/** A position in a source file, as an absolute path and a 0-based line. */
export interface SourceLocation {
    file: string;
    line: number;
}

/** A single test result reported by an adapter. */
export interface TestResult {
    name: string;
    /** Absolute path of the file the test lives in, when the framework reports it. */
    file?: string;
    status: TestStatus;
    message?: string;
    /** Where the failure happened, when the framework reports it. */
    location?: SourceLocation;
    /** Duration in milliseconds. */
    duration?: number;
}

/** Adapter-agnostic description of a run request. */
export interface RunRequestInfo {
    /** Absolute path of the Godot project root (the directory holding `project.godot`). */
    projectRoot: string;
    /** Absolute paths of test files to include. Empty = all. */
    includeFiles: string[];
    /** Tests to exclude from the included files. */
    excludeTests: TestRef[];
}

/** Discovery rules supplied by each adapter. */
export interface DiscoveryRules {
    /** Glob, relative to the project root, identifying this framework's test files. */
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
    /** Is this framework present in the given project root? */
    detect(projectRoot: string): Promise<boolean>;
    /** Parse the framework version, if supported. Optional. */
    detectVersion(projectRoot: string): Promise<string | undefined>;
    /** Translate a run request into the arguments passed to the Godot executable. */
    buildRunArgs(request: RunRequestInfo): string[];
    /** Parse raw CLI output into structured per-test results with absolute file paths. */
    parseResults(rawOutput: string, projectRoot: string): TestResult[];
}
