/**
 * FeatureMap MCP server — docs/MCP_SPEC.md.
 *
 * Transport priority (MCP_SPEC §2): stdio first, local HTTP only if
 * needed. Gives coding agents focused, evidence-backed context
 * organized by product feature instead of raw repository dumps.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getFeature,
  getFeatureContext,
  getApplicableInstructions,
  getAffectedFeatures,
  listFeatures,
  type ToolContext,
} from './tools.js';

export { getFeature, getFeatureContext, getApplicableInstructions, getAffectedFeatures, listFeatures } from './tools.js';
export type { ToolContext } from './tools.js';

const TOOL_DEFINITIONS = [
  {
    name: 'list_features',
    description: 'List product features discovered in the repository, with pattern and confidence.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional name/description/pattern filter' },
        changedOnly: { type: 'boolean', description: 'Only features affected by current changes' },
      },
    },
  },
  {
    name: 'get_feature',
    description: 'Get concise metadata for one feature (pattern, confidence, derived health).',
    inputSchema: {
      type: 'object' as const,
      properties: { featureId: { type: 'string' } },
      required: ['featureId'],
    },
  },
  {
    name: 'get_feature_context',
    description:
      'Primary context tool: bounded, ranked implementation context for a feature (code, APIs, data, tests, documents, changes).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        featureId: { type: 'string' },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['flow', 'code', 'apis', 'data', 'tests', 'documents', 'instructions', 'changes'],
          },
        },
        maxItemsPerSection: { type: 'number' },
      },
      required: ['featureId'],
    },
  },
  {
    name: 'get_affected_features',
    description: 'Features affected by the current Git diff, with evidence-backed confidence.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        base: { type: 'string', description: 'Base branch override' },
        minimumConfidence: { type: 'number' },
      },
    },
  },
  {
    name: 'get_applicable_instructions',
    description: 'Repository instructions scoped to a feature, to read before modifying it.',
    inputSchema: {
      type: 'object' as const,
      properties: { featureId: { type: 'string' } },
      required: ['featureId'],
    },
  },
];

export function buildMcpServer(ctx: ToolContext): Server {
  const server = new Server(
    { name: 'featuremap', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as Record<string, unknown>;
    try {
      let result: unknown;
      switch (name) {
        case 'list_features':
          result = await listFeatures(ctx, input as { query?: string; changedOnly?: boolean });
          break;
        case 'get_feature':
          result = await getFeature(ctx, input as { featureId: string });
          break;
        case 'get_feature_context':
          result = await getFeatureContext(
            ctx,
            input as { featureId: string; include?: never[]; maxItemsPerSection?: number },
          );
          break;
        case 'get_affected_features':
          result = await getAffectedFeatures(ctx, input as { base?: string; minimumConfidence?: number });
          break;
        case 'get_applicable_instructions':
          result = await getApplicableInstructions(ctx, input as { featureId: string });
          break;
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        isError: true,
      };
    }
  });

  return server;
}

/** Start the MCP server over stdio (MCP_SPEC §2). */
export async function startMcpStdio(ctx: ToolContext): Promise<void> {
  const server = buildMcpServer(ctx);
  await server.connect(new StdioServerTransport());
}
