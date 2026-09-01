/**
 * TypeScript analyzer (docs/ANALYZER_PLUGIN_SPEC.md §4).
 *
 * Uses the TypeScript Compiler API to deterministically extract:
 * - symbols (functions, classes, methods, consts)
 * - imports resolved to repository files
 * - exports
 *
 * All evidence is deterministic with confidence 1.0.
 */
import * as ts from 'typescript';
import { dirname, join } from 'node:path';
import { normalizePath } from '@featuremap/core';
import type {
  AnalyzerPlugin,
  AnalyzerResult,
  AnalyzeContext,
  CodeAssetInput,
  DetectContext,
  DetectionResult,
} from '@featuremap/plugin-sdk';
import { emptyResult } from '@featuremap/plugin-sdk';

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

export const symbolId = (path: string, name: string): string => `symbol:${path}:${name}`;

function isScriptFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext)) && !lower.endsWith('.d.ts');
}

/** Resolve a relative import specifier to a scanned repository file. */
export function resolveSpecifier(
  fromPath: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = normalizePath(join(dirname(fromPath), specifier).replace(/\\/g, '/'));
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (fileSet.has(candidate)) return candidate;
  }
  return undefined;
}

interface SymbolInfo {
  name: string;
  kind: string;
  isExported: boolean;
}

function extractSymbols(sourceFile: ts.SourceFile): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'function', isExported: hasExport(node) });
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({ name: node.name.text, kind: 'class', isExported: hasExport(node) });
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      symbols.push({ name: node.name.text, kind: 'method', isExported: false });
    } else if (
      ts.isVariableStatement(node) &&
      hasExport(node)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({ name: decl.name.text, kind: 'const', isExported: true });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return symbols;
}

function hasExport(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

export const typescriptAnalyzer: AnalyzerPlugin = {
  id: 'typescript',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some((f) => isScriptFile(f.path));
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    const scriptFiles = context.files.filter((f) => isScriptFile(f.path));
    const fileSet = new Set(context.files.map((f) => f.path));

    for (const file of scriptFiles) {
      const content = context.readFile(file.path);
      if (content === undefined) {
        result.diagnostics.push({
          level: 'warning',
          code: 'FILE_UNREADABLE',
          message: `Could not read ${file.path}`,
          path: file.path,
        });
        continue;
      }

      const sourceFile = ts.createSourceFile(file.path, content, ts.ScriptTarget.ESNext, true);
      const tsx = file.path.endsWith('.tsx') || file.path.endsWith('.jsx');

      // Symbols
      for (const sym of extractSymbols(sourceFile)) {
        const asset: CodeAssetInput = {
          type: 'symbol',
          path: file.path,
          name: sym.name,
          language: tsx ? 'TypeScript' : 'JavaScript',
          metadata: { kind: sym.kind, exported: sym.isExported },
        };
        result.assets.push(asset);
        if (sym.isExported) {
          result.evidence.push({
            sourceType: 'file',
            sourceId: file.path,
            relationType: 'REFERENCES',
            targetType: 'symbol',
            targetId: symbolId(file.path, sym.name),
            confidence: 1.0,
            metadata: { kind: sym.kind },
          });
        }
      }

      // Imports resolved to repository files
      for (const statement of sourceFile.statements) {
        let specifier: string | undefined;
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          specifier = statement.moduleSpecifier.text;
        } else if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          specifier = statement.moduleSpecifier.text;
        }
        if (!specifier) continue;
        const resolved = resolveSpecifier(file.path, specifier, fileSet);
        if (resolved) {
          result.evidence.push({
            sourceType: 'file',
            sourceId: file.path,
            relationType: 'IMPORTS',
            targetType: 'file',
            targetId: resolved,
            confidence: 1.0,
            metadata: { specifier },
          });
        }
      }
    }

    return result;
  },
};
