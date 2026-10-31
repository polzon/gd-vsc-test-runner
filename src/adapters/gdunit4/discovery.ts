import { baseTarget, classResolver } from '../../godot/classResolver';
import { DiscoveryContext, DiscoveryRules, TestCaseDescriptor } from '../types';
import { inlineParameterSets } from './parameters';

const SUITE_CLASS = 'GdUnitTestSuite';

/** A top-level `func test_*(` declaration. */
const TEST_FUNC = /^(?:static\s+)?func\s+(test_\w+)\s*\(/;

function isSuiteTarget(target: string): boolean {
    return target === SUITE_CLASS || target.endsWith(`/${SUITE_CLASS}.gd`);
}

async function extendsTestSuite(content: string, context?: DiscoveryContext): Promise<boolean> {
    const target = baseTarget(content);
    if (!target) {
        return false;
    }
    if (isSuiteTarget(target)) {
        return true;
    }
    if (!context) {
        return false;
    }
    const lineage = await classResolver(context.projectRoot).lineage(content, context.file);
    return lineage.some(isSuiteTarget);
}

export async function parseTestCases(
    content: string,
    context?: DiscoveryContext,
): Promise<TestCaseDescriptor[]> {
    if (!(await extendsTestSuite(content, context))) {
        return [];
    }
    const lines = content.split(/\r?\n/);
    const cases: TestCaseDescriptor[] = [];
    lines.forEach((line, index) => {
        const match = TEST_FUNC.exec(line);
        if (!match) {
            return;
        }
        const endLine = lastBodyLine(lines, index);
        const range = {
            startLine: index,
            startCharacter: 0,
            endLine,
            endCharacter: lines[endLine].length,
        };
        const parameters = inlineParameterSets(lines.slice(index).join('\n'), match[0].length - 1);
        if (parameters && parameters.length > 0) {
            parameters.forEach((parameter, parameterIndex) => {
                cases.push({
                    name: `${match[1]}:${parameterIndex} (${parameter})`,
                    label: parameter,
                    parentName: match[1],
                    runName: match[1],
                    range,
                });
            });
            return;
        }
        cases.push({ name: match[1], range });
    });
    return cases;
}

/** The last non-blank line of the indented block that follows the declaration at `start`. */
function lastBodyLine(lines: string[], start: number): number {
    let last = start;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            continue;
        }
        if (!/^\s/.test(line)) {
            break;
        }
        last = i;
    }
    return last;
}

export const discovery: DiscoveryRules = {
    fileFilter: '**/test_*.gd',
    parseTestCases,
    invalidate(projectRoot: string): void {
        classResolver(projectRoot).invalidate();
    },
};
