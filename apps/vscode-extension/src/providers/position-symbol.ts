/**
 * Position → Symbol adapter (v0.6.2 plan §6, Phase D).
 *
 * The only "logic" in the extension is turning a VS Code cursor into a
 * `SymbolRef`: it consumes the host language service via
 * `vscode.executeDocumentSymbolProvider` and falls back to a plain
 * file + line hint. The 0-based → 1-based line conversion happens
 * exactly here (plan §A1) — never again inside packages.
 *
 * The vscode API is imported as types for the pure helpers so they stay
 * unit-testable in a plain Node environment; the runtime API is pulled
 * lazily only inside `resolveSymbolRef`.
 */
import type * as vscode from 'vscode';
import type { IdeSymbolRef } from '../client/featuremap-client';

/** Smallest DocumentSymbol whose range contains the position (deepest node wins). */
export function findSmallestContainingSymbol(
  symbols: readonly vscode.DocumentSymbol[],
  position: vscode.Position,
): vscode.DocumentSymbol | undefined {
  let best: vscode.DocumentSymbol | undefined;
  const span = (s: vscode.DocumentSymbol): number =>
    (s.range.end.line - s.range.start.line) * 1e6 + (s.range.end.character - s.range.start.character);
  const visit = (sym: vscode.DocumentSymbol): void => {
    if (!sym.range.contains(position)) return;
    if (!best || span(sym) < span(best)) best = sym;
    for (const child of sym.children) visit(child);
  };
  for (const sym of symbols) visit(sym);
  return best;
}

/**
 * Convert a resolved host symbol (or fallback) into a 1-based SymbolRef.
 * When no symbol resolved, only `filePath + startLine` is sent and the
 * service does stored-symbol line matching (plan §6.3).
 */
export function toSymbolRef(
  filePath: string,
  symbol: vscode.DocumentSymbol | undefined,
  position: vscode.Position,
): IdeSymbolRef {
  if (symbol) {
    return {
      filePath,
      name: symbol.name,
      startLine: symbol.range.start.line + 1,
      endLine: symbol.range.end.line + 1,
    };
  }
  return { filePath, startLine: position.line + 1 };
}

/** Resolve the cursor to a SymbolRef using the host language service. */
export async function resolveSymbolRef(
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<IdeSymbolRef> {
  const filePath = document.uri.fsPath.replace(/\\/g, '/');
  // Lazy runtime import keeps the pure helpers Node-testable.
  const runtime = await import('vscode');
  try {
    const symbols = (await runtime.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
    )) ?? [];
    const symbol = findSmallestContainingSymbol(symbols, position);
    return toSymbolRef(filePath, symbol, position);
  } catch {
    return toSymbolRef(filePath, undefined, position);
  }
}
