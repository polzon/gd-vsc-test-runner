const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'test', 'vendor', 'gdUnit4', 'addons', 'gdUnit4');
const destination = path.join(root, 'src', 'test', 'demo', 'gdunit4-adapter-demo', 'addons', 'gdUnit4');

function submoduleReady() {
    return fs.existsSync(path.join(source, 'plugin.cfg'));
}

if (!submoduleReady()) {
    console.log('GdUnit4 submodule is not checked out; initializing it...');
    const result = spawnSync('git', ['submodule', 'update', '--init', '--recursive'], {
        cwd: root,
        stdio: 'inherit',
    });
    if (result.error) {
        console.error(`Could not run git: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

if (!submoduleReady()) {
    console.error(
        'GdUnit4 submodule is missing after `git submodule update --init --recursive`.',
    );
    process.exit(1);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
// Without this, Godot imports GdUnit4's own test suites into the demo project.
fs.writeFileSync(path.join(destination, 'test', '.gdignore'), '');
