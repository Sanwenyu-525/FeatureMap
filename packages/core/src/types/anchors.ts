/**
 * Feature anchors — ADR-0003 §1.
 *
 * An anchor is the declared entry point of a feature. Endpoint-derived
 * route anchors remain the automatic anchor source; file/symbol/component
 * anchors are user-declared (featuremap.yaml features.anchors) for
 * features without an HTTP surface.
 */
export const ANCHOR_TYPES = ['file', 'symbol', 'route', 'component'] as const;

export type AnchorType = (typeof ANCHOR_TYPES)[number];

export interface FeatureAnchor {
  type: AnchorType;
  /**
   * file   → repository-relative path
   * symbol → `symbol:<path>:<name>`
   * route  → endpoint name (`POST /api/login`)
   * component → `symbol:<path>:<ComponentName>`
   */
  target: string;
}

export function isAnchorType(value: string): value is AnchorType {
  return (ANCHOR_TYPES as readonly string[]).includes(value);
}
