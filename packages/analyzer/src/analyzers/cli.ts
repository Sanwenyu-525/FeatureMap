/**
 * CLI command analyzer — dogfooding finding (docs/reports/dogfooding-mvp-2026-09-01.md P1):
 * library and CLI features were invisible because only HTTP endpoints
 * anchored features. CLI entry points (`program.command('scan')`-style
 * registrations) now anchor features the same way endpoints do.
 */
import * as ts from 'typescript';
import type {
  AnalyzerPlugin,
  AnalyzerResult,
  AnalyzeContext,
  CodeAssetInput,
  DetectContext,
  DetectionResult,
} from '@featuremap/plugin-sdk';
import { emptyResult } from '@featuremap/plugin-sdk';

const RECEIVER_PATTERN = /^(program|cli)$/;

function isScriptFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].some((ext) => lower.endsWith(ext)) &&
    !lower.endsWith('.d.ts')
  );
}

export const cliAnalyzer: AnalyzerPlugin = {
  id: 'cli',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some(
      (f) =>
        isScriptFile(f.path) &&
        context.readFile(f.path)?.includes('.command('),
    );
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();

    for (const file of context.files.filter((f) => isScriptFile(f.path))) {
      const content = context.readFile(file.path);
      if (content === undefined) continue;
      const sourceFile = ts.createSourceFile(file.path, content, ts.ScriptTarget.ESNext, true);

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const { expression } = node;
          if (
            ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            RECEIVER_PATTERN.test(expression.expression.text) &&
            expression.name.text === 'command'
          ) {
            const firstArg = node.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg)) {
              const commandToken = firstArg.text.split(' ')[0];
              if (commandToken === undefined || commandToken === '') return;
              const command = commandToken.replace(/[<[]$/, '');
              const asset: CodeAssetInput = {
                type: 'cli_command',
                path: file.path,
                name: `featuremap ${command}`,
                metadata: { command },
              };
              result.assets.push(asset);
              result.evidence.push({
                sourceType: 'cli_command',
                sourceId: `cli_command:featuremap ${command}`,
                relationType: 'ROUTES_TO',
                targetType: 'file',
                targetId: file.path,
                confidence: 1.0,
              });
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    return result;
  },
};
