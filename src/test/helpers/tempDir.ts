import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Create a temp directory, run `fn` with it, then remove it even when `fn` throws. */
export async function withTempDir<T>(prefix: string, fn: (root: string) => Promise<T>): Promise<T> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    try {
        return await fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

/** Create a temp directory holding `files`, run `fn` with it, then remove it. */
export async function withTempProject(
    prefix: string,
    files: Record<string, string>,
    fn: (root: string) => Promise<void>,
): Promise<void> {
    await withTempDir(prefix, async (root) => {
        for (const [relative, content] of Object.entries(files)) {
            const file = path.join(root, relative);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
        await fn(root);
    });
}
