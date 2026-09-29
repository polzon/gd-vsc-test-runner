import * as path from 'path';

const RES_PREFIX = 'res://';

/**
 * Convert an absolute file path inside a Godot project to its `res://` form.
 * Returns undefined when the file lies outside the project root.
 */
export function toResPath(projectRoot: string, absolutePath: string): string | undefined {
    const relative = path.relative(projectRoot, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return undefined;
    }
    return RES_PREFIX + relative.split(path.sep).join('/');
}

/**
 * Convert a `res://` path to an absolute file path under the project root.
 * Returns undefined when the input is not a `res://` path.
 */
export function fromResPath(projectRoot: string, resPath: string): string | undefined {
    if (!resPath.startsWith(RES_PREFIX)) {
        return undefined;
    }
    const segments = resPath.slice(RES_PREFIX.length).split('/').filter((s) => s.length > 0);
    return path.join(projectRoot, ...segments);
}
