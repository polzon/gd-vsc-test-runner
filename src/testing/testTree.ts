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
    | { kind: 'folder'; project: GodotProject }
    | { kind: 'file'; project: GodotProject; file: string }
    | {
          kind: 'test';
          project: GodotProject;
          file: string;
          name: string;
          runName?: string;
      }
    | {
          kind: 'testGroup';
          project: GodotProject;
          file: string;
          name: string;
          runName: string;
      };

/** Directories that never hold the project's own tests (addons ship their own suites). */
const IGNORED_DIRS = ['addons', '.godot'];
const IGNORED_GLOB = `**/{${IGNORED_DIRS.join(',')},node_modules}/**`;

function isIgnored(projectRoot: string, file: string): boolean {
    const segments = path.relative(projectRoot, file).split(path.sep);
    return segments.slice(0, -1).some((s) => IGNORED_DIRS.includes(s));
}

function toRange(range: SourceRange): vscode.Range {
    return new vscode.Range(
        range.startLine,
        range.startCharacter,
        range.endLine,
        range.endCharacter,
    );
}

/**
 * The Test Discovery Engine: finds Godot projects, asks their adapter which files hold tests, and
 * maintains the file → test case TestItem tree. Test cases are parsed lazily per file.
 */
export class TestTree implements vscode.Disposable {
    private readonly data = new WeakMap<vscode.TestItem, ItemData>();
    private readonly itemsById = new Map<string, vscode.TestItem>();
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
        this.walk(this.controller.items, (item) => {
            const data = this.data.get(item);
            if (data?.kind === 'file' && (!project || data.project === project)) {
                items.push(item);
            }
        });
        return items;
    }

    /** File items represented by an item: itself, a test's file, or every file in a folder. */
    fileItemsIn(item: vscode.TestItem): vscode.TestItem[] {
        const data = this.data.get(item);
        if (data?.kind === 'file') {
            return [item];
        }
        if (data?.kind === 'test' || data?.kind === 'testGroup') {
            let parent = item.parent;
            while (parent) {
                const parentData = this.data.get(parent);
                if (parentData?.kind === 'file') {
                    return [parent];
                }
                if (!parentData) {
                    return [];
                }
                parent = parent.parent;
            }
            return [];
        }
        if (data?.kind !== 'folder') {
            return [];
        }
        const files: vscode.TestItem[] = [];
        this.walk(item.children, (child) => {
            if (this.data.get(child)?.kind === 'file') {
                files.push(child);
            }
        });
        return files;
    }

    findTest(file: string, name: string): vscode.TestItem | undefined {
        const fileItem = this.itemsById.get(vscode.Uri.file(file).toString());
        if (!fileItem) {
            return undefined;
        }
        let found: vscode.TestItem | undefined;
        const visit = (collection: vscode.TestItemCollection): void => {
            collection.forEach((item) => {
                const data = this.data.get(item);
                if (data?.kind === 'test' && data.name === name) {
                    found = item;
                } else if (item.children.size > 0) {
                    visit(item.children);
                }
            });
        };
        visit(fileItem.children);
        return found;
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
        this.refreshQueue = this.refreshQueue.then(
            () => this.rebuild(),
            () => this.rebuild(),
        );
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
            .forEach((item) => this.removeFile(item));
        this.pruneEmptyFolders(this.controller.items);
        for (const doc of vscode.workspace.textDocuments) {
            this.onDocument(doc);
        }
    }

    /**
     * Parse a file item's test cases, from the open editor if there is one,
     * otherwise from disk.
     */
    async resolveFile(item: vscode.TestItem, content?: string): Promise<void> {
        const data = this.data.get(item);
        if (data?.kind !== 'file' || !item.uri) {
            return;
        }
        try {
            const text = content ?? (await readText(item.uri));
            const cases = await data.project.adapter.discovery.parseTestCases(text, {
                projectRoot: data.project.root,
                file: data.file,
            });
            const children: vscode.TestItem[] = [];
            const groups = new Map<string, vscode.TestItem>();
            for (const c of cases) {
                const child = this.controller.createTestItem(
                    testId(item, c.name),
                    c.label ?? c.name,
                    item.uri,
                );
                child.range = toRange(c.range);
                this.data.set(child, {
                    kind: 'test',
                    project: data.project,
                    file: data.file,
                    name: c.name,
                    runName: c.runName,
                });
                if (!c.parentName) {
                    children.push(child);
                    continue;
                }
                let parent = groups.get(c.parentName);
                if (!parent) {
                    parent = this.controller.createTestItem(
                        testId(item, c.parentName),
                        c.parentName,
                        item.uri,
                    );
                    parent.range = toRange(c.range);
                    this.data.set(parent, {
                        kind: 'testGroup',
                        project: data.project,
                        file: data.file,
                        name: c.parentName,
                        runName: c.runName ?? c.parentName,
                    });
                    groups.set(c.parentName, parent);
                    children.push(parent);
                }
                parent.children.add(child);
            }
            item.children.replace(children);
            item.error = undefined;
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            item.error = `Failed to read test file: ${detail}`;
        }
        item.canResolveChildren = false;
    }

    /** Make sure the given file items (or every file item) have parsed children. */
    async ensureResolved(items: readonly vscode.TestItem[] = this.fileItems()): Promise<void> {
        await Promise.all(
            items.filter((i) => i.canResolveChildren).map((i) => this.resolveFile(i)),
        );
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
                const label = `${adapter.displayName}${version ? ` ${version}` : ''}`;
                this.log(`Found ${label} in Godot project: ${root}`);
                // Keep project identity stable across refreshes; items reference it.
                const existing = this.projects.find(
                    (p) => p.root === root && p.adapter === adapter,
                );
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
        const pattern = new vscode.RelativePattern(
            project.root,
            project.adapter.discovery.fileFilter,
        );
        const files = await vscode.workspace.findFiles(pattern, IGNORED_GLOB);
        return files
            .map((uri) => this.getOrCreateFile(project, uri))
            .filter((item): item is vscode.TestItem => item !== undefined);
    }

    private watch(project: GodotProject): void {
        const pattern = new vscode.RelativePattern(
            project.root,
            project.adapter.discovery.fileFilter,
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const invalidate = (): void => project.adapter.discovery.invalidate?.(project.root);
        watcher.onDidCreate((uri) => {
            invalidate();
            const item = this.getOrCreateFile(project, uri);
            if (item) {
                void this.resolveFile(item);
            }
        });
        watcher.onDidChange((uri) => {
            invalidate();
            const item = this.itemsById.get(uri.toString());
            if (item) {
                void this.resolveFile(item);
            }
        });
        watcher.onDidDelete((uri) => {
            invalidate();
            this.removeFileById(uri.toString());
        });
        this.watchers.push(watcher);

        const sources = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(project.root, '**/*.gd'),
        );
        const onSourceChange = (uri: vscode.Uri): void => {
            if (this.itemsById.get(uri.toString())) {
                return;
            }
            invalidate();
            void this.revalidate(project);
        };
        sources.onDidCreate(onSourceChange);
        sources.onDidChange(onSourceChange);
        sources.onDidDelete(onSourceChange);
        this.watchers.push(sources);
    }

    /** Re-parse this project's test files after a source script changes. */
    private async revalidate(project: GodotProject): Promise<void> {
        for (const item of this.fileItems(project)) {
            await this.resolveFile(item);
        }
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
        const id = uri.toString();
        const existing = this.itemsById.get(id);
        if (existing) {
            return existing;
        }
        const item = this.controller.createTestItem(id, path.basename(uri.fsPath), uri);
        item.canResolveChildren = true;
        this.data.set(item, { kind: 'file', project, file: uri.fsPath });
        this.itemsById.set(id, item);

        const dir = path.dirname(uri.fsPath);
        if (dir === project.root) {
            this.controller.items.add(item);
        } else {
            this.getOrCreateFolder(project, dir).children.add(item);
        }
        return item;
    }

    /** Create a directory node (and its ancestors) so files display in a tree. */
    private getOrCreateFolder(project: GodotProject, dir: string): vscode.TestItem {
        const id = folderId(project, dir);
        const existing = this.itemsById.get(id);
        if (existing) {
            return existing;
        }
        const item = this.controller.createTestItem(id, path.basename(dir));
        this.data.set(item, { kind: 'folder', project });
        this.itemsById.set(id, item);

        const parentDir = path.dirname(dir);
        if (parentDir === project.root || !isWithin(project.root, parentDir)) {
            this.controller.items.add(item);
        } else {
            this.getOrCreateFolder(project, parentDir).children.add(item);
        }
        return item;
    }

    private removeFile(item: vscode.TestItem): void {
        (item.parent?.children ?? this.controller.items).delete(item.id);
        this.itemsById.delete(item.id);
    }

    private removeFileById(id: string): void {
        const item = this.itemsById.get(id);
        if (!item) {
            return;
        }
        const parent = item.parent;
        this.removeFile(item);
        this.pruneEmptyFoldersUp(parent);
    }

    /** Delete folders left empty by a removal, walking up the ancestor chain. */
    private pruneEmptyFoldersUp(start: vscode.TestItem | undefined): void {
        let folder = start;
        while (folder && this.data.get(folder)?.kind === 'folder' && folder.children.size === 0) {
            const parent = folder.parent;
            (parent?.children ?? this.controller.items).delete(folder.id);
            this.itemsById.delete(folder.id);
            folder = parent;
        }
    }

    private pruneEmptyFolders(collection: vscode.TestItemCollection): void {
        const folders: vscode.TestItem[] = [];
        collection.forEach((item) => {
            if (this.data.get(item)?.kind === 'folder') {
                this.pruneEmptyFolders(item.children);
                folders.push(item);
            }
        });
        for (const folder of folders) {
            if (folder.children.size === 0) {
                collection.delete(folder.id);
                this.itemsById.delete(folder.id);
            }
        }
    }

    private walk(
        collection: vscode.TestItemCollection,
        visit: (item: vscode.TestItem) => void,
    ): void {
        collection.forEach((item) => {
            visit(item);
            if (this.data.get(item)?.kind === 'folder') {
                this.walk(item.children, visit);
            }
        });
    }

    private disposeWatchers(): void {
        this.watchers.splice(0).forEach((w) => w.dispose());
    }
}

function folderId(project: GodotProject, dir: string): string {
    return `folder:${project.root}::${dir}`;
}

function isWithin(root: string, dir: string): boolean {
    const relative = path.relative(root, dir);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
    );
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
