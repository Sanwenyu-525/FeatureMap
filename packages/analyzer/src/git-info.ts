/**
 * Git info collection via native git CLI (README stack table: "native
 * git CLI via execa"; AGENTS.md §4).
 *
 * Never throws — unavailable git degrades the scan instead of failing
 * it (AGENTS.md §3.5).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { $ } from 'execa';

export interface CommitInfo {
  sha: string;
  author: string;
  email: string;
  committedAt: string;
  message: string;
}

export interface CommitFileChange {
  commitSha: string;
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface GitInfo {
  available: boolean;
  currentBranch?: string;
  baseBranchExists?: boolean;
  commits: CommitInfo[];
  /** Per-commit file changes for collected commits. */
  commitChanges: CommitFileChange[];
  /** Working-tree changes (git status --porcelain); pseudo-sha WORKING_TREE. */
  workingChanges: CommitFileChange[];
  /** Committed changes on the branch vs base (base...HEAD); pseudo-sha BRANCH_DIFF. */
  branchChanges: CommitFileChange[];
  error?: string;
}

const WORKING_TREE = 'WORKING_TREE';
const BRANCH_DIFF = 'BRANCH_DIFF';

function mapStatus(code: string): CommitFileChange['changeType'] | undefined {
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

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Collect Git facts: current branch, recent commits with per-commit
 * file changes, and working-tree changes.
 */
export async function collectGitInfo(repoRoot: string, baseBranch: string): Promise<GitInfo> {
  const info: GitInfo = {
    available: false,
    commits: [],
    commitChanges: [],
    workingChanges: [],
    branchChanges: [],
  };
  if (!existsSync(join(repoRoot, '.git'))) {
    info.error = 'no .git directory';
    return info;
  }

  try {
    await $`git --version`;
    info.available = true;
  } catch {
    info.error = 'git CLI unavailable';
    return info;
  }

  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await $`git -C ${repoRoot} ${args}`;
    return stdout;
  };

  try {
    info.currentBranch = (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim();
  } catch {
    info.currentBranch = undefined;
  }

  try {
    const baseVerify = await $`git -C ${repoRoot} rev-parse --verify --quiet ${baseBranch}`;
    info.baseBranchExists = baseVerify.exitCode === 0 && baseVerify.stdout.trim() !== '';
  } catch {
    info.baseBranchExists = false;
  }

  // Single log pass: header record (sha/author/email/date/subject)
  // followed by --name-status lines for each commit.
  try {
    const log = await git(
      'log',
      '-n',
      '50',
      '--name-status',
      '--pretty=format:%H%x1f%an%x1f%ae%x1f%ci%x1f%s%x1e',
    );
    for (const record of log.split('\x1e')) {
      const trimmed = record.replace(/^\n+/, '');
      if (trimmed.trim() === '') continue;
      const lines = trimmed.split('\n');
      const [sha, author, email, committedAt, message] = (lines.shift() ?? '').split('\x1f');
      if (!sha) continue;
      info.commits.push({
        sha,
        author: author ?? '',
        email: email ?? '',
        committedAt: committedAt ?? '',
        message: message ?? '',
      });
      for (const line of lines) {
        if (line.trim() === '') continue;
        const parts = line.split('\t');
        const changeType = mapStatus(parts[0]?.charAt(0) ?? '');
        if (!changeType) continue;
        const path = changeType === 'renamed' ? (parts[2] ?? parts[1]) : parts[1];
        if (!path) continue;
        info.commitChanges.push({ commitSha: sha, path: toPosix(path), changeType });
      }
    }
  } catch {
    // Empty repository; commits simply remain empty.
  }

  try {
    const status = await git('status', '--porcelain');
    for (const line of status.split('\n')) {
      if (line.trim() === '') continue;
      const code = line.charAt(0) === ' ' ? line.charAt(1) : line.charAt(0);
      const path = line.slice(3).trim();
      const changeType = mapStatus(code.trim().charAt(0));
      if (!changeType || path === '') continue;
      info.workingChanges.push({ commitSha: WORKING_TREE, path: toPosix(path), changeType });
    }
  } catch {
    // Degrade without working-tree changes.
  }

  if (info.baseBranchExists) {
    try {
      const diff = await git('diff', '--name-status', `${baseBranch}...HEAD`);
      for (const line of diff.split('\n')) {
        if (line.trim() === '') continue;
        const parts = line.split('\t');
        const changeType = mapStatus(parts[0]?.charAt(0) ?? '');
        if (!changeType) continue;
        const path = changeType === 'renamed' ? (parts[2] ?? parts[1]) : parts[1];
        if (!path) continue;
        info.branchChanges.push({ commitSha: BRANCH_DIFF, path: toPosix(path), changeType });
      }
    } catch {
      info.branchChanges = [];
    }
  }

  return info;
}

export const WORKING_TREE_SHA = WORKING_TREE;
export const BRANCH_DIFF_SHA = BRANCH_DIFF;
