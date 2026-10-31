import * as vscode from 'vscode';
import { TestResult } from '../adapters/types';
import {
    getConfiguredGodotPath,
    CONFIG_SECTION,
    GODOT_EXECUTABLE_KEY,
} from '../godot/configuration';
import { resolveGodot } from '../godot/godotResolver';
import { runGodot } from '../godot/runGodot';
import { DebuggerServer } from '../godot/debuggerServer';
import { toResPath } from '../godot/resPath';
import { addCoverage, FileCoverageInput } from '../coverage/coverageStore';
import { executableLines } from '../coverage/executableLines';
import { collectLineHits } from '../coverage/lineCollector';
import { buildRunPlan, Selection } from './runPlan';
import { GodotProject, TestTree } from './testTree';

type Log = (message: string) => void;

/** What a coverage run needs to keep alive between spawning Godot and publishing results. */
interface CoverageSession {
    server: DebuggerServer;
    port: number;
    files: { resPath: string; uri: vscode.Uri; source: string; executable: number[] }[];
    collecting: Promise<Map<string, Set<number>>>;
}

export interface RunOptions {
    coverage?: boolean;
}

/** Terminal output in the Test Results view needs CRLF line endings. */
function toTerminal(text: string): string {
    return text.replace(/\r?\n/g, '\r\n');
}

/**
 * Case/separator-insensitive key (via the file URI) for matching reported
 * results to planned tests.
 */
function testKey(file: string, name: string): string {
    return `${vscode.Uri.file(file).toString()}::${name}`;
}

/**
 * The Test Run Orchestrator: turns a TestRunRequest into one framework invocation per Godot
 * project and publishes the parsed results into the TestRun.
 */
export class RunOrchestrator {
    constructor(
        private readonly controller: Pick<vscode.TestController, 'createTestRun'>,
        private readonly tree: TestTree,
        private readonly log: Log,
    ) {}

    async run(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken,
        options: RunOptions = {},
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        try {
            await this.execute(request, run, token, options);
        } finally {
            run.end();
        }
    }

    private async execute(
        request: vscode.TestRunRequest,
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        options: RunOptions,
    ) {
        const include = request.include ? [...request.include] : undefined;
        await this.tree.ensureResolved(this.fileItemsOf(include));

        const godot = resolveGodot(getConfiguredGodotPath());
        if (!godot.ok) {
            this.reportGodotFailure(godot.error.message, include, run);
            return;
        }
        this.log(`Using Godot ${godot.godot.version} at ${godot.godot.path}`);

        const exclude = this.toSelections(request.exclude ?? []);
        for (const project of this.tree.getProjects()) {
            if (token.isCancellationRequested) {
                break;
            }
            const projectInclude =
                include && this.toSelections(include.filter((i) => this.projectOf(i) === project));
            if (projectInclude?.length === 0) {
                continue;
            }
            await this.runProject(
                project,
                projectInclude,
                exclude,
                godot.godot.path,
                run,
                token,
                options.coverage === true,
            );
        }
    }

    private async runProject(
        project: GodotProject,
        include: Selection[] | undefined,
        exclude: Selection[],
        executable: string,
        run: vscode.TestRun,
        token: vscode.CancellationToken,
        coverage: boolean,
    ): Promise<void> {
        const known = this.tree.fileItems(project).flatMap((fileItem) => {
            const tests: { file: string; name: string }[] = [];
            fileItem.children.forEach((child) => {
                const data = this.tree.getData(child);
                if (data?.kind === 'test') {
                    tests.push({ file: data.file, name: data.name });
                }
            });
            return tests;
        });
        const plan = buildRunPlan(known, include, exclude);
        if (plan.tests.length === 0) {
            return;
        }

        // Captured up front: results must go to these items even if the tree is re-parsed mid-run.
        const byKey = new Map(
            plan.tests.flatMap((t) => {
                const item = this.tree.findTest(t.file, t.name);
                return item ? [[testKey(t.file, t.name), item] as const] : [];
            }),
        );
        const items = [...byKey.values()];
        items.forEach((item) => run.started(item));

        let session: CoverageSession | undefined;
        if (coverage) {
            try {
                session = await this.prepareCoverage(project);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                this.log(`Coverage unavailable: ${detail}`);
            }
        }
        let processExiting = false;
        let disconnectedEarly = false;
        if (session) {
            session.server.onClose(() => {
                if (!processExiting) {
                    disconnectedEarly = true;
                }
            });
        }

        try {
            let args: string[];
            try {
                args = project.adapter.buildRunArgs({
                    projectRoot: project.root,
                    includeFiles: plan.includeFiles,
                    excludeTests: plan.excludeTests,
                    debuggerUri: session ? `tcp://127.0.0.1:${session.port}` : undefined,
                });
            } catch (err) {
                const message = new vscode.TestMessage(
                    err instanceof Error ? err.message : String(err),
                );
                items.forEach((item) => run.errored(item, message));
                return;
            }

            const commandLine = `${executable} ${args.join(' ')}`;
            this.log(`Running: ${commandLine}`);
            run.appendOutput(toTerminal(`> ${commandLine}\n`));

            const abort = new AbortController();
            const cancellation = token.onCancellationRequested(() => abort.abort());
            const result = await runGodot(executable, args, {
                cwd: project.root,
                signal: abort.signal,
                onOutput: (chunk) => run.appendOutput(toTerminal(chunk)),
                onExit: () => {
                    processExiting = true;
                },
            });
            cancellation.dispose();
            processExiting = true;

            let coverageHits: Map<string, Set<number>> | undefined;
            if (session) {
                session.server.close();
                coverageHits = await session.collecting;
            }

            if (result.spawnError) {
                const message = new vscode.TestMessage(
                    `Failed to start Godot: ${result.spawnError.message}`,
                );
                items.forEach((item) => run.errored(item, message));
                return;
            }
            this.log(`${project.adapter.displayName} exited with code ${result.exitCode ?? 'n/a'}`);

            const reported = new Set<vscode.TestItem>();
            for (const testResult of project.adapter.parseResults(result.stdout, project.root)) {
                const item =
                    testResult.file && byKey.get(testKey(testResult.file, testResult.name));
                if (item) {
                    this.publish(run, item, testResult);
                    reported.add(item);
                }
            }

            for (const item of items.filter((i) => !reported.has(i))) {
                if (token.isCancellationRequested) {
                    run.skipped(item);
                } else {
                    run.errored(
                        item,
                        new vscode.TestMessage(
                            `${project.adapter.displayName} reported no result for this test ` +
                                `(exit code ${result.exitCode ?? 'n/a'}). See the test output ` +
                                'for details.',
                        ),
                    );
                }
            }

            if (session && coverageHits) {
                this.publishCoverage(session, coverageHits, disconnectedEarly, run);
            }
        } finally {
            session?.server.close();
        }
    }

    /** Discover project scripts, start the debugger server, and begin collecting hits. */
    private async prepareCoverage(project: GodotProject): Promise<CoverageSession | undefined> {
        const files = await this.coverageFiles(project);
        if (files.length === 0) {
            this.log('No project scripts to cover.');
            return undefined;
        }
        const server = new DebuggerServer(this.log);
        let port: number;
        try {
            port = await server.listen();
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.log(`Cannot listen for the Godot debugger: ${detail}`);
            return undefined;
        }
        const targets = new Map<string, number[]>(
            files.map((file) => [file.resPath, file.executable]),
        );
        this.log(`Collecting coverage for ${files.length} scripts.`);
        return { server, port, files, collecting: collectLineHits(server, targets) };
    }

    /**
     * Every `.gd` under the project, except addons, Godot's cache and the framework's test files.
     * Reads from disk, which is what Godot compiles and runs.
     */
    private async coverageFiles(project: GodotProject): Promise<CoverageSession['files']> {
        const exclude = new vscode.RelativePattern(project.root, '**/{addons,.godot}/**');
        const testUris = new Set(
            (
                await vscode.workspace.findFiles(
                    new vscode.RelativePattern(project.root, project.adapter.discovery.fileFilter),
                    exclude,
                )
            ).map((uri) => uri.toString()),
        );
        const uris = (
            await vscode.workspace.findFiles(
                new vscode.RelativePattern(project.root, '**/*.gd'),
                exclude,
            )
        ).filter((uri) => !testUris.has(uri.toString()));

        const files: CoverageSession['files'] = [];
        for (const uri of uris) {
            const resPath = toResPath(project.root, uri.fsPath);
            if (!resPath) {
                continue;
            }
            let source: string;
            try {
                source = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                this.log(`Skipping ${uri.fsPath} for coverage: ${detail}`);
                continue;
            }
            const executable = executableLines(source);
            if (executable.length > 0) {
                files.push({ resPath, uri, source, executable });
            }
        }
        return files;
    }

    private publishCoverage(
        session: CoverageSession,
        hits: Map<string, Set<number>>,
        disconnectedEarly: boolean,
        run: vscode.TestRun,
    ): void {
        if (!session.server.hasConnected) {
            this.log('Debugger did not connect; no coverage.');
            return;
        }
        if (disconnectedEarly) {
            this.log('Debugger disconnected mid-run; coverage is partial.');
        }
        const inputs: FileCoverageInput[] = session.files.map((file) => ({
            uri: file.uri,
            source: file.source,
            executable: file.executable,
            hits: hits.get(file.resPath) ?? new Set<number>(),
        }));
        addCoverage(run, inputs);
        this.log(`Published coverage for ${inputs.length} scripts.`);
    }

    private publish(run: vscode.TestRun, item: vscode.TestItem, result: TestResult): void {
        switch (result.status) {
            case 'passed':
                run.passed(item, result.duration);
                break;
            case 'skipped':
                run.skipped(item);
                break;
            case 'failed': {
                const message = new vscode.TestMessage(result.message ?? 'Test failed.');
                if (result.location) {
                    message.location = new vscode.Location(
                        vscode.Uri.file(result.location.file),
                        new vscode.Position(result.location.line, 0),
                    );
                } else if (item.uri && item.range) {
                    message.location = new vscode.Location(item.uri, item.range);
                }
                run.failed(item, message, result.duration);
                break;
            }
        }
    }

    private reportGodotFailure(
        reason: string,
        include: vscode.TestItem[] | undefined,
        run: vscode.TestRun,
    ): void {
        this.log(`Cannot run tests: ${reason}`);
        const message = new vscode.TestMessage(`Cannot run tests: ${reason}`);
        for (const fileItem of this.fileItemsOf(include)) {
            fileItem.children.forEach((child) => run.errored(child, message));
        }
        const openSettings = 'Open Settings';
        void vscode.window
            .showErrorMessage(`GDScript Test Runner: ${reason}`, openSettings)
            .then((choice) => {
                if (choice === openSettings) {
                    void vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        `${CONFIG_SECTION}.${GODOT_EXECUTABLE_KEY}`,
                    );
                }
            });
    }

    /** File items covering the request: the files themselves, or the parent of a selected test. */
    private fileItemsOf(include: vscode.TestItem[] | undefined): vscode.TestItem[] {
        if (!include) {
            return this.tree.fileItems();
        }
        return [...new Set(include.flatMap((item) => this.tree.fileItemsIn(item)))];
    }

    private projectOf(item: vscode.TestItem): GodotProject | undefined {
        return this.tree.getData(item)?.project;
    }

    private toSelections(items: readonly vscode.TestItem[]): Selection[] {
        return items.flatMap((item): Selection[] => {
            const data = this.tree.getData(item);
            if (!data) {
                return [];
            }
            if (data.kind === 'test') {
                return [{ file: data.file, test: data.name }];
            }
            if (data.kind === 'file') {
                return [{ file: data.file }];
            }
            return this.tree.fileItemsIn(item).flatMap((fileItem): Selection[] => {
                const fileData = this.tree.getData(fileItem);
                return fileData?.kind === 'file' ? [{ file: fileData.file }] : [];
            });
        });
    }
}
