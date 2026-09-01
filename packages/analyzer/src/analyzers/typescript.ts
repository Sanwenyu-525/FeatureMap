/**
 * TypeScript analyzer (docs/ANALYZER_PLUGIN_SPEC.md §4).
 *
 * Uses the TypeScript Compiler API to deterministically extract:
 * - symbols (functions, classes, methods, consts) with CONTAINS edges
 * - imports resolved to repository files
 * - resolved call expressions as symbol-level CALLS edges
 * - JSX component usage as REFERENCES edges (metadata.usage: 'component')
 *
 * No type checker is used (ADR-0003 §2): call resolution is
 * specifier-based and therefore explainable. Cross-file method calls
 * resolved through an imported binding are strong inference (0.9);
 * everything else is deterministic (1.0).
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
  EvidenceInput,
} from '@featuremap/plugin-sdk';
import { emptyResult } from '@featuremap/plugin-sdk';

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export const symbolId = (path: string, name: string): string => `symbol:${path}:${name}`;

function isScriptFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext)) && !lower.endsWith('.d.ts');
}

/**
 * TS/ESM style imports write `.js` while the on-disk file is `.ts`
 * (NodeNext resolution). Expand each candidate base into the
 * equivalent TypeScript and JavaScript spellings.
 */
function candidatePaths(base: string): string[] {
  const candidates: string[] = [base];
  if (base.endsWith('.js')) {
    candidates.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
  } else if (base.endsWith('.jsx')) {
    candidates.push(base.slice(0, -4) + '.tsx', base.slice(0, -4) + '.ts');
  } else if (!/\.[cm]?[jt]sx?$/.test(base)) {
    // Extensionless specifier (bundler-style TS): try explicit
    // TypeScript and JavaScript spellings.
    candidates.push(base + '.ts', base + '.tsx', base + '.js', base + '.jsx');
  }
  for (const suffix of ['/index.ts', '/index.tsx', '/index.js']) {
    candidates.push(base + suffix);
  }
  return candidates;
}

/** Resolve a relative import specifier to a scanned repository file. */
export function resolveSpecifier(
  fromPath: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = normalizePath(join(dirname(fromPath), specifier).replace(/\\/g, '/'));
  for (const candidate of candidatePaths(base)) {
    if (fileSet.has(candidate)) return candidate;
  }
  return undefined;
}

interface SymbolInfo {
  name: string;
  kind: string;
  isExported: boolean;
  /** Declaring class for methods, when identifiable. */
  className?: string;
  /** True when this declaration is the file's default export. */
  isDefaultExport?: boolean;
}

type Evidence = EvidenceInput;

/** Extract top-level symbols of one source file, incl. class methods. */
function extractSymbols(sourceFile: ts.SourceFile): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        kind: 'function',
        isExported: hasExport(node),
        isDefaultExport: hasDefaultModifier(node),
      });
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbols.push({
        name: node.name.text,
        kind: 'class',
        isExported: hasExport(node),
        isDefaultExport: hasDefaultModifier(node),
      });
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          symbols.push({
            name: member.name.text,
            kind: 'method',
            isExported: false,
            className: node.name.text,
          });
        }
      }
      return;
    } else if (ts.isVariableStatement(node) && hasExport(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          symbols.push({
            name: decl.name.text,
            kind: 'const',
            isExported: true,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, (node) => visit(node));
  return symbols;
}

function hasExport(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function hasDefaultModifier(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;
}

/** Named import bindings of one file: local name → imported target. */
interface NamedImport {
  localName: string;
  importedName: string;
  resolvedFile: string;
}

function extractNamedImports(
  sourceFile: ts.SourceFile,
  filePath: string,
  fileSet: Set<string>,
): NamedImport[] {
  const imports: NamedImport[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const resolved = resolveSpecifier(filePath, statement.moduleSpecifier.text, fileSet);
    if (!resolved) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) {
      imports.push({ localName: clause.name.text, importedName: 'default', resolvedFile: resolved });
    }
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        imports.push({
          localName: el.name.text,
          importedName: el.propertyName ? el.propertyName.text : el.name.text,
          resolvedFile: resolved,
        });
      }
    }
  }
  return imports;
}

/** Enclosing symbol name for calls inside function-like bodies. */
function enclosingName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return node.name.text;
  }
  return undefined;
}

interface FileAnalysis {
  sourceFile: ts.SourceFile;
  symbols: SymbolInfo[];
  namedImports: NamedImport[];
}

/**
 * Second pass per file: emit CONTAINS, CALLS and component-usage
 * evidence. Edges are deduplicated per (source, relation, target).
 */
function collectGraphEvidence(
  filePath: string,
  analysis: FileAnalysis,
  registries: Map<string, Map<string, SymbolInfo>>,
): Evidence[] {
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const push = (ev: Evidence): void => {
    const key = `${ev.sourceType}:${ev.sourceId}|${ev.relationType}|${ev.targetType}:${ev.targetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push(ev);
  };

  // CONTAINS: file → symbol for every declared symbol; class → method
  // when the method name is unambiguous within the file.
  const fileSymbolIds = new Map<string, number>();
  for (const sym of analysis.symbols) fileSymbolIds.set(sym.name, (fileSymbolIds.get(sym.name) ?? 0) + 1);
  for (const sym of analysis.symbols) {
    push({
      sourceType: 'file',
      sourceId: filePath,
      relationType: 'CONTAINS',
      targetType: 'symbol',
      targetId: symbolId(filePath, sym.name),
      confidence: 1.0,
      metadata: { kind: sym.kind },
    });
    if (sym.kind === 'method' && sym.className && fileSymbolIds.get(sym.name) === 1) {
      push({
        sourceType: 'symbol',
        sourceId: symbolId(filePath, sym.className),
        relationType: 'CONTAINS',
        targetType: 'symbol',
        targetId: symbolId(filePath, sym.name),
        confidence: 1.0,
        metadata: { kind: 'method', member: true },
      });
    }
  }

  const namedByLocal = new Map(analysis.namedImports.map((n) => [n.localName, n]));
  const localSymbols = registries.get(filePath) ?? new Map<string, SymbolInfo>();

  /** Resolve a default import to the target file's default symbol name. */
  const defaultSymbolOf = (file: string): string | undefined =>
    [...(registries.get(file)?.values() ?? [])].find((s) => s.isDefaultExport)?.name;
  const importedTargetName = (imp: NamedImport): string =>
    imp.importedName === 'default'
      ? (defaultSymbolOf(imp.resolvedFile) ?? 'default')
      : imp.importedName;

  /** Source node for edges emitted at the current scope. */
  const sourceOf = (scope: string[]): { sourceType: 'symbol' | 'file'; sourceId: string } => {
    const current = scope.at(-1);
    return current !== undefined
      ? { sourceType: 'symbol', sourceId: symbolId(filePath, current) }
      : { sourceType: 'file', sourceId: filePath };
  };

  const resolveCallTarget = (
    callee: ts.Expression,
  ): { targetId: string; confidence: number } | undefined => {
    if (ts.isIdentifier(callee)) {
      const name = callee.text;
      const imported = namedByLocal.get(name);
      if (imported) {
        return {
          targetId: symbolId(imported.resolvedFile, importedTargetName(imported)),
          confidence: 1.0,
        };
      }
      if (localSymbols.has(name)) {
        return { targetId: symbolId(filePath, name), confidence: 1.0 };
      }
      return undefined;
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      // Cross-file method call through an imported binding: strong
      // inference, no type checker involved (ADR-0003 §2).
      const imported = namedByLocal.get(callee.expression.text);
      if (imported) {
        const target = registries.get(imported.resolvedFile)?.get(callee.name.text);
        if (target) {
          return { targetId: symbolId(imported.resolvedFile, target.name), confidence: 0.9 };
        }
        return undefined;
      }
      const local = localSymbols.get(callee.expression.text);
      if (local?.kind === 'class') {
        const target = localSymbols.get(callee.name.text);
        if (target?.kind === 'method') {
          return { targetId: symbolId(filePath, target.name), confidence: 0.9 };
        }
      }
    }
    return undefined;
  };

  const tsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
  const scope: string[] = [];
  const visit = (node: ts.Node): void => {
    const pushed = enclosingName(node);
    if (pushed) scope.push(pushed);

    if (ts.isCallExpression(node)) {
      const target = resolveCallTarget(node.expression);
      if (target) {
        const src = sourceOf(scope);
        push({
          sourceType: src.sourceType,
          sourceId: src.sourceId,
          relationType: 'CALLS',
          targetType: 'symbol',
          targetId: target.targetId,
          confidence: target.confidence,
        });
      }
    }

    if (tsx && (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))) {
      const tag = node.tagName;
      if (ts.isIdentifier(tag)) {
        const name = tag.text;
        const imported = namedByLocal.get(name);
        const targetId = imported
          ? symbolId(imported.resolvedFile, importedTargetName(imported))
          : localSymbols.has(name)
            ? symbolId(filePath, name)
            : undefined;
        if (targetId) {
          const src = sourceOf(scope);
          push({
            sourceType: src.sourceType,
            sourceId: src.sourceId,
            relationType: 'REFERENCES',
            targetType: 'symbol',
            targetId,
            confidence: 1.0,
            metadata: { usage: 'component' },
          });
        }
      }
    }

    ts.forEachChild(node, visit);
    if (pushed) scope.pop();
  };
  ts.forEachChild(analysis.sourceFile, visit);

  return evidence;
}

export const typescriptAnalyzer: AnalyzerPlugin = {
  id: 'typescript',
  version: '0.2.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some((f) => isScriptFile(f.path));
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    const scriptFiles = context.files.filter((f) => isScriptFile(f.path));
    const fileSet = new Set(context.files.map((f) => f.path));

    // Pass 1: parse and collect per-file symbol registries so calls and
    // JSX usage can resolve against any scanned file.
    const analyses: Array<{ path: string; analysis: FileAnalysis }> = [];
    const registries = new Map<string, Map<string, SymbolInfo>>();
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
      const symbols = extractSymbols(sourceFile);
      const analysis: FileAnalysis = {
        sourceFile,
        symbols,
        namedImports: extractNamedImports(sourceFile, file.path, fileSet),
      };
      analyses.push({ path: file.path, analysis });
      registries.set(file.path, new Map(symbols.map((s) => [s.name, s])));
    }

    // Pass 2: assets and graph evidence.
    for (const { path: filePath, analysis } of analyses) {
      const tsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
      for (const sym of analysis.symbols) {
        const asset: CodeAssetInput = {
          type: 'symbol',
          path: filePath,
          name: sym.name,
          language: tsx ? 'TypeScript' : 'JavaScript',
          metadata: { kind: sym.kind, exported: sym.isExported },
        };
        result.assets.push(asset);
        if (sym.isExported) {
          result.evidence.push({
            sourceType: 'file',
            sourceId: filePath,
            relationType: 'REFERENCES',
            targetType: 'symbol',
            targetId: symbolId(filePath, sym.name),
            confidence: 1.0,
            metadata: { kind: sym.kind },
          });
        }
      }

      // Imports resolved to repository files
      for (const statement of analysis.sourceFile.statements) {
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
        const resolved = resolveSpecifier(filePath, specifier, fileSet);
        if (resolved) {
          result.evidence.push({
            sourceType: 'file',
            sourceId: filePath,
            relationType: 'IMPORTS',
            targetType: 'file',
            targetId: resolved,
            confidence: 1.0,
            metadata: { specifier },
          });
        }
      }

      result.evidence.push(...collectGraphEvidence(filePath, analysis, registries));
    }

    return result;
  },
};
