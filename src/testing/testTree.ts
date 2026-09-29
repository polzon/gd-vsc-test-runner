import * as path from 'path';
import * as vscode from 'vscode';
import { ADAPTERS } from '../adapters/registry';
import { SourceRange, TestFrameworkAdapter } from '../adapters/types';

/** A Godot project (directory holding `project.godot`) and the framework detected in it. */
export interface GodotProject {
    root: string;
    adapter: TestFrameworkAdapter;
}

export type ItemData =
    | { kind: 'file'; project: GodotProject; file: string }
    | { kind: 'test'; project: GodotProject; file: string; name: string };

/** Directories that never hold the project's own tests (addons ship their own suites). */
const IGNORED_DIRS = ['addons', '.godot'];
const IGNORED_GLOB = `**/{${IGNORED_DIRS.join(',')},node_modules}/**`;

function isIgnored(projectRoot: string, file: string): boolean {
    const segments = path.relative(projectRoot, file).split(path.sep);
    return segments.slice(0, -1).some((s) => IGNORED_DIRS.includes(s));
}

function toRange(range: SourceRange): vscode.Range {
    return new vscode.Range(range.startLine, range.startCharacter, range.endLine, range.endCharacter);
}

/**
 * The Test Discovery Engine: finds Godot projects, asks their adapter which files hold tests, and
 * maintains the file → test case TestItem tree. Test cases are parsed lazily per file.
 */
export class TestTree implements vscode.Disposable {
    private readonly data = new WeakMap<vscode.TestItem, ItemData>();
    private readonly watchers: vscode.Disposable[] = [];
    private readonly listeners: vscode.Disposable[] = [];
    private projects: GodotProject[] = [];
    private initialDiscovery?: Promise<void>;
    private refreshQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly controller: vscode.TestController,
        private readonly log: (message: string) => void,
    ) {
        controller.resolveHandler = async (item) => {
            if (item) {
                await this.resolveFile(item);
            } else {
                await this.discover();
            }
        };
        controller.refreshHandler = () => this.refresh();

        this.listeners.push(
            vscode.workspace.onDidOpenTextDocument((doc) => this.onDocument(doc)),
            vscode.workspace.onDidChangeTextDocument((e) => this.onDocument(e.document)),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
        );
    }

    getData(item: vscode.TestItem): ItemData | undefined {
        return this.data.get(item);
    }

    getProjects(): readonly GodotProject[] {
        return this.projects;
    }

    fileItems(project?: GodotProject): vscode.TestItem[] {
        const items: vscode.TestItem[] = [];
        this.controller.items.forEach((item) => {
            if (!project || this.data.get(item)?.project === project) {
                items.push(item);
            }
        });
        return items;
    }

    findTest(file: string, name: string): vscode.TestItem | undefined {
        const fileItem = this.controller.items.get(vscode.Uri.file(file).toString());
        return fileItem?.children.get(testId(fileItem, name));
    }

    /** Discover projects and test files once; later calls wait for that first discovery. */
    discover(): Promise<void> {
        this.initialDiscovery ??= this.refresh();
        return this.initialDiscovery;
    }

    /**
     * Re-discover projects and test files. Refreshes are serialized and update the tree in place,
     * so existing items (and their results) survive and runs in progress keep valid items.
     */
    refresh(): Promise<void> {
        this.refreshQueue = this.refreshQueue.then(() => this.rebuild(), () => this.rebuild());
        return this.refreshQueue;
    }

    private async rebuild(): Promise<void> {
        this.projects = await this.discoverProjects();
        this.disposeWatchers();
        const found = new Set<string>();
        for (const project of this.projects) {
            for (const item of await this.discoverFiles(project)) {
                found.add(item.id);
                if (!item.canResolveChildren) {
                    await this.resolveFile(item);
                }
            }
            this.watch(project);
        }
        this.fileItems()
            .filter((item) => !found.has(item.id))
            .forEach((item) => this.controller.items.delete(item.id));
        for (const doc of vscode.workspace.textDocuments) {
            this.onDocument(doc);
        }
    }

    /** Parse a file item's test cases, from the open editor if there is one, otherwise from disk. */
    async resolveFile(item: vscode.TestItem, content?: string): Promise<void> {
        const data = this.data.get(item);
        if (data?.kind !== 'file' || !item.uri) {
            return;
        }
        try {
            const text = content ?? await readText(item.uri);
            const cases = data.project.adapter.discovery.parseTestCases(text);
            item.children.replace(cases.map((c) => {
                const child = this.controller.createTestItem(testId(item, c.name), c.name, item.uri);
                child.range = toRange(c.range);
                this.data.set(child, { kind: 'test', project: data.project, file: data.file, name: c.name });
                return child;
            }));
            item.error = undefined;
        } catch (err) {
            item.error = `Failed to read test file: ${err instanceof Error ? err.message : String(err)}`;
        }
        item.canResolveChildren = false;
    }

    /** Make sure the given file items (or every file item) have parsed children. */
    async ensureResolved(items: readonly vscode.TestItem[] = this.fileItems()): Promise<void> {
        await Promise.all(items.filter((i) => i.canResolveChildren).map((i) => this.resolveFile(i)));
    }

    dispose(): void {
        this.disposeWatchers();
        this.listeners.forEach((d) => d.dispose());
    }

    private async discoverProjects(): Promise<GodotProject[]> {
        const projectFiles = await vscode.workspace.findFiles('**/project.godot', IGNORED_GLOB);
        const projects: GodotProject[] = [];
        for (const uri of projectFiles) {
            const root = path.dirname(uri.fsPath);
            const adapter = await detectAdapter(root);
            if (adapter) {
                const version = await adapter.detectVersion(root);
                this.log(`Found ${adapter.displayName}${version ? ` ${version}` : ''} in Godot project: ${root}`);
                // Keep project identity stable across refreshes; items reference it.
                const existing = this.projects.find((p) => p.root === root && p.adapter === adapter);
                projects.push(existing ?? { root, adapter });
            } else {
                this.log(`No supported test framework found in Godot project: ${root}`);
            }
        }
        if (projectFiles.length === 0) {
            this.log('No Godot project (project.godot) found in the workspace.');
        }
        return projects;
    }

    private async discoverFiles(project: GodotProject): Promise<vscode.TestItem[]> {
        const pattern = new vscode.RelativePattern(project.root, project.adapter.discovery.fileFilter);
        const files = await vscode.workspace.findFiles(pattern, IGNORED_GLOB);
        return files
            .map((uri) => this.getOrCreateFile(project, uri))
            .filter((item): item is vscode.TestItem => item !== undefined);
    }

    private watch(project: GodotProject): void {
        const pattern = new vscode.RelativePattern(project.root, project.adapter.discovery.fileFilter);
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate((uri) => {
            const item = this.getOrCreateFile(project, uri);
            if (item) {
                void this.resolveFile(item);
            }
        });
        watcher.onDidChange((uri) => {
            const item = this.controller.items.get(uri.toString());
            if (item) {
                void this.resolveFile(item);
            }
        });
        watcher.onDidDelete((uri) => this.controller.items.delete(uri.toString()));
        this.watchers.push(watcher);
    }

    private onDocument(doc: vscode.TextDocument): void {
        if (doc.uri.scheme !== 'file') {
            return;
        }
        const project = this.projects.find((p) => {
            const pattern = new vscode.RelativePattern(p.root, p.adapter.discovery.fileFilter);
            return vscode.languages.match({ pattern }, doc) > 0;
        });
        if (!project) {
            return;
        }
        const item = this.getOrCreateFile(project, doc.uri);
        if (item) {
            void this.resolveFile(item, doc.getText());
        }
    }

    private getOrCreateFile(project: GodotProject, uri: vscode.Uri): vscode.TestItem | undefined {
        if (isIgnored(project.root, uri.fsPath)) {
            return undefined;
        }
        const existing = this.controller.items.get(uri.toString());
        if (existing) {
            return existing;
        }
        const item = this.controller.createTestItem(uri.toString(), vscode.workspace.asRelativePath(uri), uri);
        item.canResolveChildren = true;
        this.data.set(item, { kind: 'file', project, file: uri.fsPath });
        this.controller.items.add(item);
        return item;
    }

    private disposeWatchers(): void {
        this.watchers.splice(0).forEach((w) => w.dispose());
    }
}

function testId(fileItem: vscode.TestItem, name: string): string {
    return `${fileItem.id}::${name}`;
}

async function detectAdapter(root: string): Promise<TestFrameworkAdapter | undefined> {
    for (const adapter of ADAPTERS) {
        if (await adapter.detect(root)) {
            return adapter;
        }
    }
    return undefined;
}

async function readText(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) {
        return open.getText();
    }
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
}
