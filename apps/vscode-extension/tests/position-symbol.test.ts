/**
 * Position → Symbol adapter tests (v0.6.2 plan §13.1).
 *
 * Host symbols are plain structural fakes; the functions are pure and
 * only use the vscode API types (erased at runtime).
 */
import { describe, expect, it } from 'vitest';
import { findSmallestContainingSymbol, toSymbolRef } from '../src/providers/position-symbol';

// Minimal structural fakes (types only — no vscode runtime needed).
type Pos = { line: number; character: number };
type Range = { start: Pos; end: Pos; contains: (p: Pos) => boolean };
type DocSym = { name: string; range: Range; children: DocSym[] };

const pos = (line: number, character = 0): Pos => ({ line, character });

function range(sl: number, sc: number, el: number, ec: number): Range {
  return {
    start: pos(sl, sc),
    end: pos(el, ec),
    contains: (p) =>
      (p.line > sl || (p.line === sl && p.character >= sc)) &&
      (p.line < el || (p.line === el && p.character <= ec)),
  };
}

const sym = (name: string, r: Range, children: DocSym[] = []): DocSym => ({ name, range: r, children });

describe('findSmallestContainingSymbol', () => {
  it('returns undefined for an unmatched position', () => {
    expect(findSmallestContainingSymbol([sym('UserService', range(1, 0, 20, 0))], pos(99))).toBeUndefined();
  });

  it('picks the deepest (smallest-range) symbol when nested', () => {
    const symbols = [sym('UserService', range(1, 0, 20, 0), [sym('createUser', range(2, 2, 6, 1))])];
    expect(findSmallestContainingSymbol(symbols, pos(5))?.name).toBe('createUser');
  });

  it('falls back to the parent when no child contains the position', () => {
    const symbols = [sym('UserService', range(1, 0, 20, 0), [sym('createUser', range(2, 2, 6, 1))])];
    // Position on the class header, outside any method body.
    expect(findSmallestContainingSymbol(symbols, pos(1, 3))?.name).toBe('UserService');
  });

  it('handles sibling symbols', () => {
    const symbols = [sym('login', range(1, 0, 4, 0)), sym('logout', range(5, 0, 8, 0))];
    expect(findSmallestContainingSymbol(symbols, pos(6))?.name).toBe('logout');
  });
});

describe('toSymbolRef', () => {
  it('converts 0-based host lines to 1-based wire lines', () => {
    const ref = toSymbolRef('src/app.ts', sym('login', range(1, 0, 4, 0)), pos(0));
    expect(ref).toEqual({ filePath: 'src/app.ts', name: 'login', startLine: 2, endLine: 5 });
  });

  it('falls back to a line-only hint when no symbol resolved', () => {
    const ref = toSymbolRef('src/app.ts', undefined, pos(6));
    expect(ref).toEqual({ filePath: 'src/app.ts', startLine: 7 });
  });
});
