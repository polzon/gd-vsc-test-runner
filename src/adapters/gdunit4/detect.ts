import { promises as fs } from 'fs';
import * as path from 'path';

const ADDON_DIR = path.join('addons', 'gdUnit4');

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

export async function detect(projectRoot: string): Promise<boolean> {
    return pathExists(path.join(projectRoot, ADDON_DIR, 'bin', 'GdUnitCmdTool.gd'));
}

export async function detectVersion(projectRoot: string): Promise<string | undefined> {
    try {
        const config = await fs.readFile(path.join(projectRoot, ADDON_DIR, 'plugin.cfg'), 'utf-8');
        return /^version\s*=\s*"([^"]+)"/m.exec(config)?.[1];
    } catch {
        return undefined;
    }
}
