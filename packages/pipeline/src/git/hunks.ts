/**
 * Diff hunk collection (ADR-0004 §1–§2) — Milestone 10.
 *
 * Hunks are computed **on demand** through the native git CLI and only
 * hunk *headers* (file, new-file line numbers, change type) are used.
 * Full diff content is never persisted or logged (AGENTS.md §13).
 *
 * `--unified=0` keeps each hunk minimal (no context lines), so the
 * collected new-side line numbers are the lines actually changed — the
 * input for changed-symbol extraction.
 */
import { $ } from 'execa';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffHunk {
  path: string;
  changeType: ChangeType;
  /** Changed lines on the new-file side (1-based). Empty when deleted. */
  newLines: number[];
}

/** Parse raw `git diff --unified=0` output (pure, testable). */
export function parseDiffHunks(raw: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | undefined;
  /** New-side line number at the start of the current hunk body. */
  let newSideLine = 0;

  const pushFile = (): void => {
    if (current) hunks.push(current);
    current = undefined;
    newSideLine = 0;
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      pushFile();
      // `diff --git a/src/auth.ts b/src/auth.ts` → new-side path.
      const newPath = (line.split(/ b\//).pop() ?? '').replace(/^"|"$/g, '');
      current = { path: newPath, changeType: 'modified', newLines: [] };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode ')) {
      current.changeType = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      current.changeType = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      current.changeType = 'renamed';
      continue;
    }

    // `@@ -oldStart[,oldCount] +newStart[,newCount] @@`
    if (line.startsWith('@@ ')) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) newSideLine = Number(match[1]);
      continue;
    }

    // Header markers carry the file path, not changed rows.
    if (line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('index ')) {
      continue;
    }

    if (line.startsWith('+')) {
      current.newLines.push(newSideLine);
      newSideLine += 1;
    } else if (line.startsWith('-')) {
      // Deletion: the new file has no row, so new-side line does not advance.
      // A modification under --unified=0 renders as `-` followed by `+`,
      // so the subsequent `+` row records the changed line.
    } else if (line.startsWith(' ')) {
      // Context row (only appears with --unified>0; defensive).
      newSideLine += 1;
    }
    // Empty lines and `\ No newline at end of file` markers are ignored.
  }
  pushFile();
  return hunks;
}

/**
 * Diff hunks for a single commit (`git show` handles root commits,
 * which `git diff` cannot express as `<sha>^ <sha>`).
 */
export async function hunksForCommit(repoRoot: string, sha: string): Promise<DiffHunk[]> {
  const { stdout } = await $`git -C ${repoRoot} show ${sha} --format= --unified=0 --no-color`;
  return parseDiffHunks(stdout);
}

/** Diff hunks for a from..to snapshot pair (`git diff <from> <to>`). */
export async function hunksForRange(repoRoot: string, from: string, to: string): Promise<DiffHunk[]> {
  const { stdout } = await $`git -C ${repoRoot} diff --unified=0 --no-color ${from} ${to}`;
  return parseDiffHunks(stdout);
}

/** Parsed range change row: new-side path and change type. */
export interface RangeChangeFile {
  path: string;
  changeType: ChangeType;
}

function mapDiffStatus(code: string): ChangeType | undefined {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    default:
      return undefined;
  }
}

/** Changed files for a from..to snapshot pair (`git diff --name-status`). */
export function parseNameStatus(raw: string): RangeChangeFile[] {
  const files: RangeChangeFile[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const [status, ...rest] = line.split('\t');
    const changeType = mapDiffStatus(status?.charAt(0) ?? '');
    if (!changeType) continue;
    const path = changeType === 'renamed' ? rest[1] ?? rest[0] : rest[0];
    if (!path) continue;
    files.push({ path: path.replace(/\\/g, '/'), changeType });
  }
  return files;
}

/** Changed files for a from..to snapshot pair (native git CLI, on demand). */
export async function filesForRange(repoRoot: string, from: string, to: string): Promise<RangeChangeFile[]> {
  const { stdout } = await $`git -C ${repoRoot} diff --name-status --no-color ${from} ${to}`;
  return parseNameStatus(stdout);
}