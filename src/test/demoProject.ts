import * as path from 'path';

const DEMO_PROJECT_ROOT = path.resolve(__dirname, '../../src/demo/gdunit4-adapter-demo');

/** The demo Godot project opened by the extension test host (see `.vscode-test.mjs`). */
export const DEMO_PROJECT = DEMO_PROJECT_ROOT;
export const SUITE_FILE = path.join(DEMO_PROJECT, 'test', 'test_example_test.gd');
export const CALCULATOR_TEST = path.join(DEMO_PROJECT, 'test', 'test_calculator.gd');
export const CALCULATOR_SCRIPT = path.join(DEMO_PROJECT, 'src', 'calculator.gd');
export const CALCULATOR_RES = 'res://src/calculator.gd';
