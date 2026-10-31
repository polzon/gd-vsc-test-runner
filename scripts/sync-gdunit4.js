const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'test', 'vendor', 'gdUnit4', 'addons', 'gdUnit4');
const destination = path.join(root, 'src', 'test', 'demo', 'gdunit4-adapter-demo', 'addons', 'gdUnit4');

if (!fs.existsSync(path.join(source, 'plugin.cfg'))) {
    console.error('GdUnit4 submodule is missing. Run: git submodule update --init --recursive');
    process.exit(1);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
// Without this, Godot imports GdUnit4's own test suites into the demo project.
fs.writeFileSync(path.join(destination, 'test', '.gdignore'), '');
