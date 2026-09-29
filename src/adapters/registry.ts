import { gdunit4Adapter } from './gdunit4Adapter';
import { TestFrameworkAdapter } from './types';

/** Adapters tried, in order, when detecting a project's test framework. */
export const ADAPTERS: readonly TestFrameworkAdapter[] = [gdunit4Adapter];
