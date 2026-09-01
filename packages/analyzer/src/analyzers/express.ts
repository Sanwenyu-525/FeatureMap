/**
 * Express analyzer (docs/ANALYZER_PLUGIN_SPEC.md §3 — framework analyzers).
 *
 * Deterministically extracts routes from `app.get('/path', handler)`
 * style registrations and emits endpoint assets plus ROUTES_TO /
 * HANDLED_BY evidence.
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
import { resolveSpecifier, symbolId } from './typescript.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all', 'use']);
const RECEIVER_PATTERN = /^(app|router|api)$/;

function isScriptFile(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].some((ext) => lower.endsWith(ext)) &&
    !lower.endsWith('.d.ts')
  );
}

export const expressAnalyzer: AnalyzerPlugin = {
  id: 'express',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some(
      (f) => f.path.endsWith('package.json') && context.readFile(f.path)?.includes('"express"'),
    );
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    const fileSet = new Set(context.files.map((f) => f.path));

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
            HTTP_METHODS.has(expression.name.text.toLowerCase())
          ) {
            const method = expression.name.text.toUpperCase();
            const firstArg = node.arguments[0];
            if (firstArg && ts.isStringLiteral(firstArg)) {
              const routePath = firstArg.text;
              const endpointName = `${method} ${routePath}`;
              const asset: CodeAssetInput = {
                type: 'endpoint',
                path: file.path,
                name: endpointName,
                metadata: { method, routePath },
              };
              result.assets.push(asset);

              const endpointId = `endpoint:${endpointName}`;
              result.evidence.push({
                sourceType: 'endpoint',
                sourceId: endpointId,
                relationType: 'ROUTES_TO',
                targetType: 'file',
                targetId: file.path,
                confidence: 1.0,
              });

              // Resolve a handler identifier to a symbol (same file or import).
              const handlerArg = node.arguments[1];
              if (handlerArg && ts.isIdentifier(handlerArg)) {
                const handlerName = handlerArg.text;
                const targetFile = findSymbolFile(handlerName, file.path, sourceFile, fileSet);
                if (targetFile) {
                  result.evidence.push({
                    sourceType: 'endpoint',
                    sourceId: endpointId,
                    relationType: 'HANDLED_BY',
                    targetType: 'symbol',
                    targetId: symbolId(targetFile, handlerName),
                    confidence: 1.0,
                  });
                }
              }
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

function findSymbolFile(
  name: string,
  currentFile: string,
  sourceFile: ts.SourceFile,
  fileSet: Set<string>,
): string | undefined {
  // Defined in the same file?
  const local = sourceFile.statements.some(
    (st) =>
      ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name?.text === name) ||
      (ts.isVariableStatement(st) &&
        st.declarationList.declarations.some(
          (d) => ts.isIdentifier(d.name) && d.name.text === name,
        )),
  );
  if (local) return currentFile;
  // Imported from another repository file?
  for (const st of sourceFile.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const resolved = resolveSpecifier(currentFile, st.moduleSpecifier.text, fileSet);
      if (!resolved) continue;
      const named = st.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        if (named.elements.some((el) => el.name.text === name)) return resolved;
      }
    }
  }
  return undefined;
}
