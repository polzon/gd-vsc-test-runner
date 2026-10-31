import { TestFrameworkAdapter, TestResult } from '../types';
import { detect, detectVersion } from './detect';
import { discovery } from './discovery';
import { parseGdUnit4Output } from './output';
import { buildRunArgs } from './runArgs';

function parseResults(rawOutput: string, projectRoot: string): TestResult[] {
    return parseGdUnit4Output(rawOutput, projectRoot);
}

export const gdunit4Adapter: TestFrameworkAdapter = {
    id: 'gdunit4',
    displayName: 'GDUnit 4 Adapter',
    discovery,
    detect,
    detectVersion,
    buildRunArgs,
    parseResults,
};
