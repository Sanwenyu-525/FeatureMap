/**
 * Renderer dispatch — maps a request format to a renderer.
 * Renderers must stay pure over the FeatureContext model so any future
 * consumer (HTTP, IDE) can reuse them.
 */
import type { ContextFormat, FeatureContext } from './types.js';
import { renderMarkdown } from './renderers/markdown.js';
import { renderJson } from './renderers/json.js';
import { renderAgent } from './renderers/agent.js';

export type RenderedContext = string | Record<string, unknown>;

/** Render a FeatureContext in the requested format. */
export function renderContext(context: FeatureContext, format: ContextFormat = 'markdown'): RenderedContext {
  switch (format) {
    case 'json':
      return renderJson(context);
    case 'agent':
      return renderAgent(context);
    case 'markdown':
      return renderMarkdown(context);
  }
}