import { describe, expect, it } from 'vitest';
import { classifyDocument, detectTechnologies, isDocumentPath, languageForExtension } from '../src/scanner.js';

describe('languageForExtension', () => {
  it('maps common extensions', () => {
    expect(languageForExtension('.ts')).toBe('TypeScript');
    expect(languageForExtension('.tsx')).toBe('TypeScript');
    expect(languageForExtension('.vue')).toBe('Vue');
    expect(languageForExtension('.prisma')).toBe('Prisma');
    expect(languageForExtension('.md')).toBe('Markdown');
  });

  it('returns undefined for unknown extensions', () => {
    expect(languageForExtension('.xyz')).toBeUndefined();
  });
});

describe('document classification (docs/MVP_SPEC.md §10)', () => {
  it('classifies first-class instruction documents', () => {
    expect(classifyDocument('AGENTS.md')).toBe('agents');
    expect(classifyDocument('CLAUDE.md')).toBe('claude');
    expect(classifyDocument('CONTRIBUTING.md')).toBe('contributing');
    expect(classifyDocument('README.md')).toBe('readme');
    expect(classifyDocument('docs/ADR/0001-decision.md')).toBe('adr');
    expect(classifyDocument('docs/guide.md')).toBe('docs');
    expect(classifyDocument('.github/copilot-instructions.md')).toBe('other');
    expect(classifyDocument('src/notes.md')).toBe('other');
  });

  it('accepts only scoped knowledge documents', () => {
    expect(isDocumentPath('README.md')).toBe(true);
    expect(isDocumentPath('docs/guide.md')).toBe(true);
    expect(isDocumentPath('.cursor/rules/main.md')).toBe(true);
    expect(isDocumentPath('src/component.tsx')).toBe(false);
    expect(isDocumentPath('random.md')).toBe(false);
  });
});

describe('detectTechnologies', () => {
  it('detects technologies from marker files', () => {
    const techs = detectTechnologies('d:/Develop/FeatureMap');
    expect(techs.some((t) => t.id === 'typescript')).toBe(true);
  });

  it('returns an empty list for a directory without markers', () => {
    const techs = detectTechnologies('d:/Develop/__featuremap_nonexistent__');
    expect(techs).toEqual([]);
  });
});
