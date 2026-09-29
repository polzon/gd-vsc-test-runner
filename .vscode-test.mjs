import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Opens the demo Godot project so the extension activates and discovers its GdUnit4 suite.
	workspaceFolder: './src/demo/gdunit4-adapter-demo',
	mocha: {
		timeout: 120000,
	},
});
