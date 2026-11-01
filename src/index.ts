import * as core from '@actions/core';
import * as github from '@actions/github';

const COMMENT_MARKER = '<!-- deps-diff-action:comment -->';

type DepSection =
  | 'dependencies'
  | 'devDependencies'
  | 'peerDependencies'
  | 'optionalDependencies';

const SECTIONS: DepSection[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Change {
  name: string;
  from: string;
  to: string;
  bump: 'major' | 'minor' | 'patch' | 'other';
}

interface SectionDiff {
  section: DepSection;
  added: Array<{ name: string; version: string }>;
  removed: Array<{ name: string; version: string }>;
  upgraded: Change[];
  downgraded: Change[];
}

interface Totals {
  added: number;
  removed: number;
  upgraded: number;
  downgraded: number;
  majorBumps: number;
}

function parseSemver(raw: string): [number, number, number] | null {
  const cleaned = raw.replace(/^[\^~>=<\s]+/, '').trim();
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function classifyBump(from: string, to: string): Change['bump'] {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return 'other';
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'other';
}

function compareVersions(from: string, to: string): number {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function diffSection(
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
        result.upgraded.push(change);
      }
    }
  }

  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  result.added.sort(byName);
  result.removed.sort(byName);
  result.upgraded.sort(byName);
  result.downgraded.sort(byName);
  return result;
}

function bumpBadge(bump: Change['bump']): string {
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

function renderBody(
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

  if (
    totals.added +
      totals.removed +
      totals.upgraded +
      totals.downgraded ===
    0
  ) {
    lines.push('_No dependency changes detected._');
    return lines.join('\n');
  }

  lines.push(
    `**Summary:** ${totals.added} added · ${totals.removed} removed · ${totals.upgraded} upgraded · ${totals.downgraded} downgraded` +
      (totals.majorBumps > 0 ? ` · ⚠️ ${totals.majorBumps} major` : ''),
  );
  lines.push('');

  for (const diff of diffs) {
    const nonEmpty =
      diff.added.length +
      diff.removed.length +
      diff.upgraded.length +
      diff.downgraded.length;
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
    lines.push('');
  }

  lines.push('');
  lines.push(
    '<sub>Posted by [deps-diff-action](https://github.com/marketplace/actions/dependency-diff).</sub>',
  );
  return lines.join('\n');
}

async function fetchManifest(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<Manifest | null> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    const data = res.data as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== 'base64') return null;
    const raw = Buffer.from(data.content, 'base64').toString('utf8');
    return JSON.parse(raw) as Manifest;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return null;
    throw err;
  }
}

async function upsertComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  const comments = await octokit.paginate(
    octokit.rest.issues.listComments,
    { owner, repo, issue_number: issueNumber, per_page: 100 },
  );
  const existing = comments.find(
    (c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER),
  );
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated existing comment #${existing.id}`);
  } else {
    const created = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Created comment #${created.data.id}`);
  }
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const manifestPath = core.getInput('manifest-path') || 'package.json';
    const header = core.getInput('comment-header') || '📦 Dependency changes';
    const failOnMajor = core.getBooleanInput('fail-on-major');
    const includeDev = core.getBooleanInput('include-dev');

    const context = github.context;
    if (context.eventName !== 'pull_request') {
      core.info(
        `Event is '${context.eventName}', not 'pull_request'. Skipping.`,
      );
      return;
    }

    const pr = context.payload.pull_request;
    if (!pr) {
      core.setFailed('No pull_request payload available.');
      return;
    }

    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const baseRef = pr.base.sha as string;
    const headRef = pr.head.sha as string;

    const octokit = github.getOctokit(token);

    core.info(`Fetching ${manifestPath} @ ${baseRef.slice(0, 7)} (base)`);
    core.info(`Fetching ${manifestPath} @ ${headRef.slice(0, 7)} (head)`);

    const [beforeManifest, afterManifest] = await Promise.all([
      fetchManifest(octokit, owner, repo, baseRef, manifestPath),
      fetchManifest(octokit, owner, repo, headRef, manifestPath),
    ]);

    if (!beforeManifest && !afterManifest) {
      core.info(`No ${manifestPath} on either side. Nothing to diff.`);
      return;
    }

    const sectionsToDiff: DepSection[] = includeDev
      ? SECTIONS
      : SECTIONS.filter((s) => s !== 'devDependencies');

    const diffs: SectionDiff[] = [];
    const totals: Totals = {
      added: 0,
      removed: 0,
      upgraded: 0,
      downgraded: 0,
      majorBumps: 0,
    };

    for (const section of sectionsToDiff) {
      const before = (beforeManifest?.[section] ?? {}) as Record<
        string,
        string
      >;
      const after = (afterManifest?.[section] ?? {}) as Record<string, string>;
      const diff = diffSection(section, before, after);
      diffs.push(diff);
      totals.added += diff.added.length;
      totals.removed += diff.removed.length;
      totals.upgraded += diff.upgraded.length;
      totals.downgraded += diff.downgraded.length;
      for (const change of [...diff.upgraded, ...diff.downgraded]) {
        if (change.bump === 'major') totals.majorBumps++;
      }
    }

    core.setOutput('added', totals.added);
    core.setOutput('removed', totals.removed);
    core.setOutput('upgraded', totals.upgraded);
    core.setOutput('downgraded', totals.downgraded);
    core.setOutput('major-bumps', totals.majorBumps);

    const body = renderBody(header, diffs, totals, manifestPath);
    await upsertComment(octokit, owner, repo, pr.number, body);

    if (failOnMajor && totals.majorBumps > 0) {
      core.setFailed(
        `Found ${totals.majorBumps} major-version bump(s) and fail-on-major is enabled.`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(message);
  }
}

void run();
