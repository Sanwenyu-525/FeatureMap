/**
 * Prisma analyzer (docs/ANALYZER_PLUGIN_SPEC.md §9).
 *
 * Parses `schema.prisma` and emits data model assets, model names and
 * deterministic model-to-model REFERENCES relations.
 */
import type {
  AnalyzerPlugin,
  AnalyzerResult,
  AnalyzeContext,
  CodeAssetInput,
  DetectContext,
  DetectionResult,
} from '@featuremap/plugin-sdk';
import { emptyResult } from '@featuremap/plugin-sdk';

const MODEL_RE = /^model\s+([A-Za-z0-9_]+)\s*\{/gm;

interface ParsedModel {
  name: string;
  fields: Array<{ name: string; type: string }>;
}

export function parsePrismaSchema(content: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const starts: Array<{ name: string; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(MODEL_RE.source, 'gm');
  while ((match = re.exec(content)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    starts.push({ name, bodyStart: match.index + match[0].length });
  }
  for (const start of starts) {
    const closeIdx = content.indexOf('}', start.bodyStart);
    if (closeIdx === -1) continue;
    const body = content.slice(start.bodyStart, closeIdx);
    const fields: ParsedModel['fields'] = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('//') || line.startsWith('@')) continue;
      const parts = line.split(/\s+/);
      const name = parts[0];
      const type = parts[1];
      if (name === undefined || type === undefined) continue;
      // Skip attributes-only or block attributes lines.
      if (name.startsWith('@@')) continue;
      fields.push({ name, type });
    }
    models.push({ name: start.name, fields });
  }
  return models;
}

/** Scalar primitive types in Prisma schemas. */
const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes',
]);

export const prismaAnalyzer: AnalyzerPlugin = {
  id: 'prisma',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.some((f) => f.path.endsWith('.prisma'));
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    for (const file of context.files.filter((f) => f.path.endsWith('.prisma'))) {
      const content = context.readFile(file.path);
      if (content === undefined) continue;
      const models = parsePrismaSchema(content);

      for (const model of models) {
        const asset: CodeAssetInput = {
          type: 'data_entity',
          path: file.path,
          name: model.name,
          metadata: { fieldCount: model.fields.length },
        };
        result.assets.push(asset);
      }

      // Deterministic model REFERENCES model relations from relation fields.
      const modelNames = new Set(models.map((m) => m.name));
      for (const model of models) {
        for (const field of model.fields) {
          const targetType = field.type.replace(/\[\]$/, '').replace(/^\?/, '');
          if (SCALARS.has(targetType)) continue;
          if (!modelNames.has(targetType)) continue;
          result.evidence.push({
            sourceType: 'data_entity',
            sourceId: `data_entity:${model.name}`,
            relationType: 'REFERENCES',
            targetType: 'data_entity',
            targetId: `data_entity:${targetType}`,
            confidence: 1.0,
            metadata: { field: field.name },
          });
        }
      }
    }
    return result;
  },
};
