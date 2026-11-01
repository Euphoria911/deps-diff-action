import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  COMMENT_MARKER,
  DepSection,
  Manifest,
  SECTIONS,
  SectionDiff,
  computeTotals,
  diffSection,
  renderBody,
} from './diff';

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
    for (const section of sectionsToDiff) {
      const before = (beforeManifest?.[section] ?? {}) as Record<string, string>;
      const after = (afterManifest?.[section] ?? {}) as Record<string, string>;
      diffs.push(diffSection(section, before, after));
    }

    const totals = computeTotals(diffs);

    core.setOutput('added', totals.added);
    core.setOutput('removed', totals.removed);
    core.setOutput('upgraded', totals.upgraded);
    core.setOutput('downgraded', totals.downgraded);
    core.setOutput('changed', totals.changed);
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
