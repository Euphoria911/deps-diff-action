export type DepSection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

export const SECTIONS: DepSection[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export type Bump = 'major' | 'minor' | 'patch' | 'other';

export interface Change {
  name: string;
  from: string;
  to: string;
  bump: Bump;
}

export interface SectionDiff {
  section: DepSection;
  added: Array<{ name: string; version: string }>;
  removed: Array<{ name: string; version: string }>;
  upgraded: Change[];
  downgraded: Change[];
  changed: Change[];
}

export interface Totals {
  added: number;
  removed: number;
  upgraded: number;
  downgraded: number;
  changed: number;
  majorBumps: number;
}

export function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.replace(/^[\^~>=<\s]+/, '').trim();
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function classifyBump(from: string, to: string): Bump {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return 'other';
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'other';
}

export function compareVersions(from: string, to: string): number {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function diffSection(
  section: DepSection,
  before: Record<string, string>,
  after: Record<string, string>,
): SectionDiff {
  const result: SectionDiff = {
    section,
    added: [],
    removed: [],
    upgraded: [],
    downgraded: [],
    changed: [],
  };

  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of names) {
    const from = before[name];
    const to = after[name];
    if (from === undefined && to !== undefined) {
      result.added.push({ name, version: to });
    } else if (from !== undefined && to === undefined) {
      result.removed.push({ name, version: from });
    } else if (from !== undefined && to !== undefined && from !== to) {
      const direction = compareVersions(from, to);
      const change: Change = { name, from, to, bump: classifyBump(from, to) };
      if (direction < 0) {
        result.upgraded.push(change);
      } else if (direction > 0) {
        result.downgraded.push(change);
      } else {
        result.changed.push(change);
      }
    }
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  result.added.sort(byName);
  result.removed.sort(byName);
  result.upgraded.sort(byName);
  result.downgraded.sort(byName);
  result.changed.sort(byName);
  return result;
}

export function bumpBadge(bump: Bump): string {
  switch (bump) {
    case 'major':
      return '🔴 major';
    case 'minor':
      return '🟡 minor';
    case 'patch':
      return '🟢 patch';
    default:
      return '⚪ other';
  }
}

export const COMMENT_MARKER = '<!-- deps-diff-action:comment -->';

export function renderBody(
  header: string,
  diffs: SectionDiff[],
  totals: Totals,
  manifestPath: string,
): string {
  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push(`## ${header}`);
  lines.push('');
  lines.push(`\`${manifestPath}\``);
  lines.push('');

  const totalChanges =
    totals.added +
    totals.removed +
    totals.upgraded +
    totals.downgraded +
    totals.changed;

  if (totalChanges === 0) {
    lines.push('_No dependency changes detected._');
    return lines.join('\n');
  }

  const summaryParts = [
    `${totals.added} added`,
    `${totals.removed} removed`,
    `${totals.upgraded} upgraded`,
    `${totals.downgraded} downgraded`,
  ];
  if (totals.changed > 0) summaryParts.push(`${totals.changed} changed`);
  let summary = `**Summary:** ${summaryParts.join(' · ')}`;
  if (totals.majorBumps > 0) summary += ` · ⚠️ ${totals.majorBumps} major`;
  lines.push(summary);
  lines.push('');

  for (const diff of diffs) {
    const nonEmpty =
      diff.added.length +
      diff.removed.length +
      diff.upgraded.length +
      diff.downgraded.length +
      diff.changed.length;
    if (nonEmpty === 0) continue;

    lines.push(`### \`${diff.section}\``);
    lines.push('');
    lines.push('| Change | Package | From | To | Bump |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const a of diff.added) {
      lines.push(`| ➕ added | \`${a.name}\` | — | \`${a.version}\` | — |`);
    }
    for (const r of diff.removed) {
      lines.push(`| ➖ removed | \`${r.name}\` | \`${r.version}\` | — | — |`);
    }
    for (const u of diff.upgraded) {
      lines.push(
        `| ⬆️ upgraded | \`${u.name}\` | \`${u.from}\` | \`${u.to}\` | ${bumpBadge(u.bump)} |`,
      );
    }
    for (const d of diff.downgraded) {
      lines.push(
        `| ⬇️ downgraded | \`${d.name}\` | \`${d.from}\` | \`${d.to}\` | ${bumpBadge(d.bump)} |`,
      );
    }
    for (const c of diff.changed) {
      lines.push(
        `| 🔄 changed | \`${c.name}\` | \`${c.from}\` | \`${c.to}\` | ${bumpBadge(c.bump)} |`,
      );
    }
    lines.push('');
  }

  lines.push('');
  lines.push(
    '<sub>Posted by [deps-diff-action](https://github.com/Euphoria911/deps-diff-action).</sub>',
  );
  return lines.join('\n');
}

export function computeTotals(diffs: SectionDiff[]): Totals {
  const totals: Totals = {
    added: 0,
    removed: 0,
    upgraded: 0,
    downgraded: 0,
    changed: 0,
    majorBumps: 0,
  };
  for (const diff of diffs) {
    totals.added += diff.added.length;
    totals.removed += diff.removed.length;
    totals.upgraded += diff.upgraded.length;
    totals.downgraded += diff.downgraded.length;
    totals.changed += diff.changed.length;
    for (const change of [...diff.upgraded, ...diff.downgraded, ...diff.changed]) {
      if (change.bump === 'major') totals.majorBumps++;
    }
  }
  return totals;
}
