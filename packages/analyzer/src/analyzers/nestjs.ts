/**
 * NestJS analyzer (docs/ANALYZER_PLUGIN_SPEC.md §8).
 *
 * Deterministic evidence example:
 *
 *   POST /auth/login
 *   HANDLED_BY
 *   AuthController.login
 *   confidence = 1.0
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
import { symbolId } from './typescript.js';

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All']);

function getDecorators(node: ts.Node): readonly ts.Decorator[] | undefined {
  return ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
}

function decoratorName(node: ts.Decorator): string | undefined {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
  return undefined;
}

function decoratorArgument(node: ts.Decorator): string | undefined {
  const expr = node.expression;
  if (ts.isCallExpression(expr)) {
    const first = expr.arguments[0];
    if (first && ts.isStringLiteral(first)) return first.text;
  }
  return undefined;
}

export const nestjsAnalyzer: AnalyzerPlugin = {
  id: 'nestjs',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some(
      (f) => f.path.endsWith('package.json') && context.readFile(f.path)?.includes('"@nestjs/'),
    );
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    const scriptFiles = context.files.filter(
      (f) => ['.ts', '.tsx', '.js'].some((ext) => f.path.endsWith(ext)) && !f.path.endsWith('.d.ts'),
    );

    for (const file of scriptFiles) {
      const content = context.readFile(file.path);
      if (content === undefined) continue;
      const sourceFile = ts.createSourceFile(file.path, content, ts.ScriptTarget.ESNext, true);

      for (const statement of sourceFile.statements) {
        if (!ts.isClassDeclaration(statement) || !statement.name) continue;
        const controllerDec = getDecorators(statement)?.find(
          (d) => decoratorName(d) === 'Controller',
        );
        if (!controllerDec) continue;
        const prefix = decoratorArgument(controllerDec) ?? '';

        for (const member of statement.members) {
          if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
          const methodDec = getDecorators(member)?.find((d) =>
            HTTP_DECORATORS.has(decoratorName(d) ?? ''),
          );
          if (!methodDec) continue;
          const httpMethod = decoratorName(methodDec)!.toUpperCase();
          const subPath = decoratorArgument(methodDec) ?? '';
          const fullPath = normalizeRoute(prefix, subPath);
          const endpointName = `${httpMethod} ${fullPath}`;
          const asset: CodeAssetInput = {
            type: 'endpoint',
            path: file.path,
            name: endpointName,
            language: 'TypeScript',
            metadata: { method: httpMethod, routePath: fullPath, controller: statement.name.text },
          };
          result.assets.push(asset);
          result.evidence.push({
            sourceType: 'endpoint',
            sourceId: `endpoint:${endpointName}`,
            relationType: 'HANDLED_BY',
            targetType: 'symbol',
            targetId: symbolId(file.path, `${statement.name.text}.${member.name.text}`),
            confidence: 1.0,
          });
        }
      }
    }

    return result;
  },
};

function normalizeRoute(prefix: string, subPath: string): string {
  const joined = [prefix, subPath]
    .map((p) => p.replace(/^\//, '').replace(/\/$/, ''))
    .filter((p) => p !== '')
    .join('/');
  return `/${joined}`;
}
