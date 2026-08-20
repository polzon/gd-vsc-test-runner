import {
    DiscoveryRules,
    RunRequestInfo,
    TestCaseDescriptor,
    TestFrameworkAdapter,
    TestResult,
} from './types';

const MOCK_TEST_CASES: TestCaseDescriptor[] = [
    { name: 'test_addition', range: { startLine: 3, startCharacter: 0, endLine: 5, endCharacter: 0 } },
    { name: 'test_subtraction', range: { startLine: 7, startCharacter: 0, endLine: 9, endCharacter: 0 } },
    { name: 'test_multiplication', range: { startLine: 11, startCharacter: 0, endLine: 13, endCharacter: 0 } },
];

const MOCK_RESULTS: TestResult[] = [
    { name: 'test_addition', status: 'passed', duration: 12 },
    { name: 'test_subtraction', status: 'failed', message: 'expected 5, got 4', duration: 9 },
    { name: 'test_multiplication', status: 'skipped' },
];

const discovery: DiscoveryRules = {
    fileFilter: '**/test_*.gd',
    parseTestCases(_content: string): TestCaseDescriptor[] {
        return MOCK_TEST_CASES.map((t) => ({ ...t, range: { ...t.range } }));
    },
};

/**
 * A deterministic adapter used to exercise the extension core in unit tests
 * without depending on the real GdUnit4 addon or a Godot binary.
 */
export const mockAdapter: TestFrameworkAdapter = {
    id: 'mock',
    displayName: 'Mock Adapter',
    discovery,
    async detect(_workspaceRoot: string): Promise<boolean> {
        return true;
    },
    async detectVersion(_workspaceRoot: string): Promise<string | undefined> {
        return '0.0.0-mock';
    },
    buildRunArgs(request: RunRequestInfo): string[] {
        const args: string[] = [];
        for (const file of request.includeFiles) {
            args.push('--file', file);
        }
        for (const name of request.excludeTests) {
            args.push('--exclude', name);
        }
        return args;
    },
    parseResults(_rawOutput: string): TestResult[] {
        return MOCK_RESULTS.map((r) => ({ ...r }));
    },
};
