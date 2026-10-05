import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Opens the demo Godot project so the extension activates and discovers its GdUnit4 suite.
	workspaceFolder: './src/demo/gdunit4-adapter-demo',
	// Required on headless CI (Xvfb): the GPU process otherwise hangs the CodeWindow.
	launchArgs: ['--disable-gpu', '--disable-dev-shm-usage'],
	mocha: {
		timeout: 120000,
	},
});
