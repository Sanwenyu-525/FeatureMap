/**
 * Built-in analyzer registry (docs/ANALYZER_PLUGIN_SPEC.md §3).
 */
import type { AnalyzerPlugin } from '@featuremap/plugin-sdk';
import { typescriptAnalyzer } from './typescript.js';
import { expressAnalyzer } from './express.js';
import { nestjsAnalyzer } from './nestjs.js';
import { prismaAnalyzer } from './prisma.js';
import { markdownAnalyzer } from './markdown.js';
import { gitAnalyzer } from './git.js';
import { cliAnalyzer } from './cli.js';

export const builtInAnalyzers: AnalyzerPlugin[] = [
  typescriptAnalyzer,
  expressAnalyzer,
  nestjsAnalyzer,
  prismaAnalyzer,
  markdownAnalyzer,
  gitAnalyzer,
  cliAnalyzer,
];

export {
  typescriptAnalyzer,
  expressAnalyzer,
  nestjsAnalyzer,
  prismaAnalyzer,
  markdownAnalyzer,
  gitAnalyzer,
  cliAnalyzer,
};
export { loadModuleResolution, resolveSpecifier, symbolId } from './typescript.js';
export type { TsconfigModuleResolution } from './typescript.js';
