import { TestRef } from '../adapters/types';

/** A user selection: a whole file, or a single test within it. */
export interface Selection {
    file: string;
    test?: string;
}

/** What to ask the adapter for, plus the tests we expect results for. */
export interface RunPlan {
    includeFiles: string[];
    excludeTests: TestRef[];
    tests: TestRef[];
}

function matches(selection: Selection, test: TestRef): boolean {
    return selection.file === test.file && (selection.test === undefined || selection.test === test.name);
}

/**
 * Resolve include/exclude selections against the known tests of one project.
 *
 * Frameworks typically run whole files, so a partial selection within a file is expressed as
 * "include the file, exclude its unselected tests".
 *
 * @param known   every discovered test in the project
 * @param include selections to run; undefined means everything in `known`
 * @param exclude selections to leave out
 */
export function buildRunPlan(known: TestRef[], include: Selection[] | undefined, exclude: Selection[]): RunPlan {
    const tests = known.filter((t) =>
        (include === undefined || include.some((s) => matches(s, t))) && !exclude.some((s) => matches(s, t)),
    );
    const includeFiles = [...new Set(tests.map((t) => t.file))];
    const selected = new Set(tests);
    const excludeTests = known.filter((t) => includeFiles.includes(t.file) && !selected.has(t));
    return { includeFiles, excludeTests, tests };
}
