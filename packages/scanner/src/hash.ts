import { createHash } from 'node:crypto';

/** Content hash used as incremental cache key (docs/ARCHITECTURE.md §5). */
export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
