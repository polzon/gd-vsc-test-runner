import { promises as fs } from 'fs';
import * as path from 'path';
import { fromResPath } from './resPath';

/** Classes that end a chain when a class does not map to a project `class_name`. */
const ROOT_CLASSES = new Set(['Object', 'RefCounted', 'Node', 'Resource']);

const TARGET = '("(?:[^"\\\\]|\\\\.)*"|\'[^\']*\'|[^\\s#]+)';

/** A top-level `extends Foo`, `class_name Foo extends Bar` or path-based `extends "res://...gd"`. */
const CLASS_NAME_EXTENDS = new RegExp(
    `^(?:@[A-Za-z_]\\w*\\s+)*class_name\\s+\\w+\\s+extends\\s+${TARGET}`,
    'm',
);
const EXTENDS = new RegExp(`^(?:@[A-Za-z_]\\w*\\s+)*extends\\s+${TARGET}`, 'm');
const CLASS_NAME = /^(?:@[A-Za-z_]\w*\s+)*class_name\s+(\w+)/m;

const READ_CONCURRENCY = 16;

function unquote(token: string): string {
    return token.replace(/^["']|["']$/g, '');
}

/** The direct base class or script path declared at the top level of a GDScript file. */
export function baseTarget(content: string): string | undefined {
    const match = CLASS_NAME_EXTENDS.exec(content) ?? EXTENDS.exec(content);
    return match ? unquote(match[1]) : undefined;
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function readText(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf-8');
    } catch {
        return undefined;
    }
}

/**
 * Resolves GDScript `extends` chains across a Godot project by following `class_name`
 * declarations and script paths. One instance caches the project's class index.
 */
export class GdScriptClassResolver {
    private index?: Promise<Map<string, string>>;
    private readonly misses = new Set<string>();
    private readonly contents = new Map<string, string | undefined>();

    constructor(private readonly projectRoot: string) { }

    /**
     * Names and paths in the inheritance chain, from the script's direct base upward.
     * Stops at a Godot root class, a missing declaration, a cycle, or the end of the chain.
     */
    async lineage(content: string, file: string): Promise<string[]> {
        const chain: string[] = [];
        const visited = new Set<string>();
        let currentFile = file;
        let target = baseTarget(content);
        while (target && !visited.has(target)) {
            visited.add(target);
            chain.push(target);
            if (ROOT_CLASSES.has(target)) {
                break;
            }
            const nextFile = await this.targetFile(target, currentFile);
            if (!nextFile) {
                break;
            }
            const nextContent = await this.read(nextFile);
            if (nextContent === undefined) {
                break;
            }
            currentFile = nextFile;
            target = baseTarget(nextContent);
        }
        return chain;
    }

    /** Absolute path of the project file that declares `className`, if there is one. */
    async find(className: string): Promise<string | undefined> {
        const found = await this.findIn(await this.getClassIndex(), className);
        if (found || this.misses.has(className)) {
            return found;
        }
        const rebuilt = await this.rebuild();
        const foundAfterRebuild = await this.findIn(rebuilt, className);
        if (!foundAfterRebuild) {
            this.misses.add(className);
        }
        return foundAfterRebuild;
    }

    /** Drop cached lookups after `.gd` files are added, changed, or deleted. */
    invalidate(): void {
        this.index = undefined;
        this.misses.clear();
        this.contents.clear();
    }

    private async findIn(index: Map<string, string>, className: string): Promise<string | undefined> {
        const file = index.get(className);
        if (!file || !(await pathExists(file))) {
            return undefined;
        }
        const content = await this.read(file);
        return content !== undefined && CLASS_NAME.exec(content)?.[1] === className ? file : undefined;
    }

    private async rebuild(): Promise<Map<string, string>> {
        this.contents.clear();
        this.misses.clear();
        this.index = this.buildIndex();
        return this.index;
    }

    private async targetFile(target: string, fromFile: string): Promise<string | undefined> {
        if (target.startsWith('res://')) {
            return this.withinProject(fromResPath(this.projectRoot, target));
        }
        if (target.endsWith('.gd') || target.includes('/')) {
            const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(fromFile), target);
            return this.withinProject(resolved);
        }
        return this.find(target);
    }

    /** Keep inheritance lookups inside the project, even for `..` or absolute targets. */
    private withinProject(file: string | undefined): string | undefined {
        if (!file) {
            return undefined;
        }
        const relative = path.relative(this.projectRoot, file);
        if (
            relative === ''
            || relative === '..'
            || relative.startsWith(`..${path.sep}`)
            || path.isAbsolute(relative)
        ) {
            return undefined;
        }
        return file;
    }

    private async read(file: string): Promise<string | undefined> {
        if (this.contents.has(file)) {
            return this.contents.get(file);
        }
        const content = await readText(file);
        this.contents.set(file, content);
        return content;
    }

    private getClassIndex(): Promise<Map<string, string>> {
        this.index ??= this.buildIndex();
        return this.index;
    }

    private async buildIndex(): Promise<Map<string, string>> {
        const index = new Map<string, string>();
        const files = await this.collectScripts();
        for (let start = 0; start < files.length; start += READ_CONCURRENCY) {
            const batch = files.slice(start, start + READ_CONCURRENCY);
            const contents = await Promise.all(batch.map(async (file) => [file, await readText(file)] as const));
            for (const [file, content] of contents) {
                const name = content ? CLASS_NAME.exec(content)?.[1] : undefined;
                if (name) {
                    index.set(name, file);
                }
            }
        }
        return index;
    }

    private async collectScripts(): Promise<string[]> {
        const files: string[] = [];
        const pending = [this.projectRoot];
        while (pending.length > 0) {
            const dir = pending.pop()!;
            let entries;
            try {
                entries = await fs.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.name === '.godot' || entry.name === '.git' || entry.name === 'node_modules') {
                    continue;
                }
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    pending.push(full);
                } else if (entry.isFile() && entry.name.endsWith('.gd')) {
                    files.push(full);
                }
            }
        }
        return files;
    }
}

const resolvers = new Map<string, GdScriptClassResolver>();

/** Shared resolver for a project root, so its class index is reused across parses. */
export function classResolver(projectRoot: string): GdScriptClassResolver {
    let resolver = resolvers.get(projectRoot);
    if (!resolver) {
        resolver = new GdScriptClassResolver(projectRoot);
        resolvers.set(projectRoot, resolver);
    }
    return resolver;
}
