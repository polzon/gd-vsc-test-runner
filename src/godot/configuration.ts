import * as vscode from 'vscode';

export const CONFIG_SECTION = 'gdscriptTestRunner';
export const GODOT_EXECUTABLE_KEY = 'godotExecutable';

/**
 * Read the configured Godot executable path from VS Code settings.
 * Returns undefined when empty/unset (meaning "resolve from PATH").
 */
export function getConfiguredGodotPath(): string | undefined {
    const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>(GODOT_EXECUTABLE_KEY);
    if (!value || value.trim() === '') {
        return undefined;
    }
    return value.trim();
}
