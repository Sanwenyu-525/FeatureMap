/**
 * Relation vocabulary from docs/DATA_MODEL.md §3.
 *
 * Keep this list small and avoid near-duplicate relation names unless
 * the semantics truly differ.
 */
export const RELATION_TYPES = [
  'IMPORTS',
  'CALLS',
  'CONTAINS',
  'REFERENCES',
  'ROUTES_TO',
  'HANDLED_BY',
  'READS',
  'WRITES',
  'VERIFIED_BY',
  'DESCRIBED_BY',
  'CONSTRAINED_BY',
  'IMPLEMENTS',
  'DEPENDS_ON',
  'MODIFIED_BY',
  'AFFECTS',
  'BELONGS_TO_FEATURE',
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export function isRelationType(value: string): value is RelationType {
  return (RELATION_TYPES as readonly string[]).includes(value);
}
