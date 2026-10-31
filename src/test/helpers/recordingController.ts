import * as vscode from 'vscode';

export type Outcome = 'started' | 'passed' | 'failed' | 'errored' | 'skipped';

/** A TestController whose runs record what the orchestrator publishes, keyed by label and id. */
export function recordingController() {
    const outcomes = new Map<string, Outcome>();
    const outcomesById = new Map<string, Outcome>();
    const messages = new Map<string, vscode.TestMessage>();
    const coverages: vscode.FileCoverage[] = [];
    const set =
        (outcome: Outcome) =>
        (item: vscode.TestItem, message?: vscode.TestMessage | readonly vscode.TestMessage[]) => {
            outcomes.set(item.label, outcome);
            outcomesById.set(item.id, outcome);
            if (message) {
                messages.set(
                    item.label,
                    Array.isArray(message) ? message[0] : (message as vscode.TestMessage),
                );
            }
        };
    const run = {
        started: set('started'),
        passed: set('passed'),
        failed: set('failed'),
        errored: set('errored'),
        skipped: set('skipped'),
        enqueued: () => {},
        appendOutput: () => {},
        addCoverage: (coverage: vscode.FileCoverage) => coverages.push(coverage),
        end: () => {},
    } as unknown as vscode.TestRun;
    return {
        controller: { createTestRun: () => run },
        outcomes,
        outcomesById,
        messages,
        coverages,
    };
}
