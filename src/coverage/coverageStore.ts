import * as vscode from 'vscode';

export interface FileCoverageInput {
    uri: vscode.Uri;
    /** File text, used for line lengths. */
    source: string;
    /** Executable lines, 1-based. */
    executable: readonly number[];
    /** Lines that broke at least once, 1-based. */
    hits: ReadonlySet<number>;
}

/** Detailed coverage is looked up by the exact FileCoverage instance given to addCoverage. */
const detailsByCoverage = new WeakMap<vscode.FileCoverage, vscode.StatementCoverage[]>();

/** Publish covered/uncovered lines to the Test Coverage view. */
export function addCoverage(run: vscode.TestRun, inputs: readonly FileCoverageInput[]): void {
    for (const input of inputs) {
        const lines = input.source.split(/\r?\n/);
        const reported = [...new Set([...input.executable, ...input.hits])].sort((a, b) => a - b);
        if (reported.length === 0) {
            continue;
        }
        const details = reported.map((line) => {
            const text = lines[line - 1] ?? '';
            return new vscode.StatementCoverage(
                input.hits.has(line),
                new vscode.Range(line - 1, 0, line - 1, text.length),
            );
        });
        const coverage = vscode.FileCoverage.fromDetails(input.uri, details);
        detailsByCoverage.set(coverage, details);
        run.addCoverage(coverage);
    }
}

/** Detailed coverage for a FileCoverage previously published by `addCoverage`. */
export function getDetailedCoverage(file: vscode.FileCoverage): vscode.StatementCoverage[] {
    return detailsByCoverage.get(file) ?? [];
}
