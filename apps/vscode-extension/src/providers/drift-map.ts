/**
 * Drift → diagnostic mapping (v0.6.4 plan §39–§42) — pure, testable.
 *
 * 1-based RPC lines become 0-based VS Code lines here (the only
 * conversion point); issues without a resolvable location never become
 * Problems (plan §23).
 */
import type { IdeDriftIssue } from '../client/featuremap-client';

export interface MappedDiagnostic {
  filePath: string;
  message: string;
  severity: 'warning' | 'information';
  code: string;
  /** 0-based line. */
  line: number;
}

export function mapDriftToDiagnostics(issues: IdeDriftIssue[]): MappedDiagnostic[] {
  const out: MappedDiagnostic[] = [];
  for (const issue of issues) {
    if (!issue.location) continue; // no resolvable anchor → no Problem (plan §23)
    const who = issue.featureName ?? issue.featureId;
    out.push({
      filePath: issue.location.filePath,
      message:
        issue.kind === 'relation_broken'
          ? `Confirmed Feature relation is broken: ${who} → ${issue.targetId}`
          : `New Feature candidate: ${who} → ${issue.targetId}`,
      severity: issue.kind === 'relation_broken' ? 'warning' : 'information',
      code: issue.kind,
      line: Math.max(0, issue.location.startLine - 1),
    });
  }
  return out;
}
