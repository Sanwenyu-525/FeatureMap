/**
 * Markdown/document analyzer (docs/ANALYZER_PLUGIN_SPEC.md §10).
 *
 * Deterministic parsing only: titles, headings and explicit file
 * references. Semantic section→feature mapping is Milestone 2 work.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Root, Heading } from 'mdast';
import type {
  AnalyzerPlugin,
  AnalyzerResult,
  AnalyzeContext,
  CodeAssetInput,
  DetectContext,
  DetectionResult,
} from '@featuremap/plugin-sdk';
import { emptyResult } from '@featuremap/plugin-sdk';

function extractHeadings(content: string): Array<{ depth: number; text: string }> {
  const tree = unified().use(remarkParse).parse(content) as Root;
  const headings: Array<{ depth: number; text: string }> = [];
  for (const node of tree.children) {
    if (node.type === 'heading') {
      const h = node as Heading;
      headings.push({
        depth: h.depth,
        text: h.children
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .map((c) => c.value)
          .join(''),
      });
    }
  }
  return headings;
}

export const markdownAnalyzer: AnalyzerPlugin = {
  id: 'markdown',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some((f) => f.path.toLowerCase().endsWith('.md'));
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    const mdFiles = context.files.filter((f) => f.path.toLowerCase().endsWith('.md'));
    if (mdFiles.length === 0) return result;
    const filePaths = new Set(context.files.map((f) => f.path));

    for (const file of mdFiles) {
      const abs = join(context.repoRoot, file.path);
      let content: string;
      try {
        content = readFileSync(abs, 'utf8');
      } catch {
        result.diagnostics.push({
          level: 'warning',
          code: 'FILE_UNREADABLE',
          message: `Could not read ${file.path}`,
          path: file.path,
        });
        continue;
      }

      let headings: Array<{ depth: number; text: string }> = [];
      try {
        headings = extractHeadings(content);
      } catch {
        result.diagnostics.push({
          level: 'warning',
          code: 'MARKDOWN_PARSE_FAILED',
          message: `Failed to parse markdown: ${file.path}`,
          path: file.path,
        });
      }

      const title = headings.find((h) => h.depth === 1)?.text;
      const asset: CodeAssetInput = {
        type: 'file',
        path: file.path,
        language: 'Markdown',
        metadata: { title, headings: headings.map((h) => h.text) },
      };
      result.assets.push(asset);

      // Explicit file references: markdown describes repository files.
      for (const path of filePaths) {
        if (path === file.path) continue;
        if (content.includes(path)) {
          result.evidence.push({
            sourceType: 'file',
            sourceId: path,
            relationType: 'DESCRIBED_BY',
            targetType: 'document',
            targetId: file.path,
            confidence: 1.0,
            metadata: { documentType: 'markdown' },
          });
        }
      }
    }

    return result;
  },
};
