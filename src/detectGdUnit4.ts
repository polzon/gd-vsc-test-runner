import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { promises, existsSync } from 'fs';

// TODO:
// 1. Detect 'project.godot' file.
// 2. Search for gdUnit4 in relative res://addons/gdUnit4 path.

function detectGdUnit4(): boolean {
    const commonPaths = [
        'addons/gdUnit4/runtest.cmd',
        'addons/gdUnit4/runtest.sh',
        'addons/gdUnit4/bin/GdUnitCmdTool.gd',
    ];

    return commonPaths.some(path => existsSync(path));
}

function detectViaShell(fileName: string): boolean {
    const result = spawnSync('which', [fileName], { encoding: 'utf-8' });
    return result.status === 0;
}

async function fileExistsInWorkspace(relativePath: string): Promise<boolean> {
    try {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, relativePath);
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

async function fileExistsAsync(filePath: string): Promise<boolean> {
    try {
        await promises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function fileExists(filePath: string): boolean {
    return existsSync(filePath);
}
