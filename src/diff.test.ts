import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  classifyBump,
  compareVersions,
  computeTotals,
  diffSection,
  parseSemver,
  renderBody,
} from './diff';

describe('parseSemver', () => {
  it('parses plain semver', () => {
    assert.deepEqual(parseSemver('1.2.3'), [1, 2, 3]);
  });

  it('strips caret and tilde ranges', () => {
    assert.deepEqual(parseSemver('^1.2.3'), [1, 2, 3]);
    assert.deepEqual(parseSemver('~4.5.6'), [4, 5, 6]);
  });

  it('strips comparison operators', () => {
    assert.deepEqual(parseSemver('>=10.0.0'), [10, 0, 0]);
    assert.deepEqual(parseSemver('> 2.1.0'), [2, 1, 0]);
  });

  it('parses prerelease versions by taking the numeric core', () => {
    assert.deepEqual(parseSemver('1.2.3-beta.1'), [1, 2, 3]);
  });

  it('returns null for non-semver strings', () => {
    assert.equal(parseSemver('workspace:*'), null);
    assert.equal(parseSemver('npm:alias@1.2.3'), null);
    assert.equal(parseSemver('git+https://github.com/x/y'), null);
    assert.equal(parseSemver('file:../local'), null);
    assert.equal(parseSemver('latest'), null);
    assert.equal(parseSemver('1.2.x'), null);
  });
});

describe('classifyBump', () => {
  it('detects major', () => {
    assert.equal(classifyBump('1.2.3', '2.0.0'), 'major');
  });
  it('detects minor', () => {
    assert.equal(classifyBump('1.2.3', '1.3.0'), 'minor');
  });
  it('detects patch', () => {
    assert.equal(classifyBump('1.2.3', '1.2.4'), 'patch');
  });
  it('treats identical as other', () => {
    assert.equal(classifyBump('1.2.3', '1.2.3'), 'other');
  });
  it('returns other for unparseable inputs', () => {
    assert.equal(classifyBump('workspace:*', '1.2.3'), 'other');
    assert.equal(classifyBump('git+https://a', 'git+https://b'), 'other');
  });
});

describe('compareVersions', () => {
  it('returns -1 when upgrading', () => {
    assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
    assert.equal(compareVersions('^1.0.0', '^2.0.0'), -1);
  });
  it('returns 1 when downgrading', () => {
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  });
  it('returns 0 when equal', () => {
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  });
  it('returns 0 when either side is unparseable', () => {
    assert.equal(compareVersions('workspace:*', '1.2.3'), 0);
    assert.equal(compareVersions('git+https://a', 'git+https://b'), 0);
  });
});

describe('diffSection', () => {
  it('finds added entries', () => {
    const d = diffSection('dependencies', {}, { react: '^19.0.0' });
    assert.deepEqual(d.added, [{ name: 'react', version: '^19.0.0' }]);
    assert.equal(d.removed.length, 0);
    assert.equal(d.upgraded.length, 0);
  });

  it('finds removed entries', () => {
    const d = diffSection('dependencies', { lodash: '^4.17.21' }, {});
    assert.deepEqual(d.removed, [{ name: 'lodash', version: '^4.17.21' }]);
  });

  it('classifies an upgrade', () => {
    const d = diffSection(
      'dependencies',
      { react: '^18.2.0' },
      { react: '^19.0.0' },
    );
    assert.equal(d.upgraded.length, 1);
    assert.equal(d.upgraded[0].bump, 'major');
    assert.equal(d.downgraded.length, 0);
  });

  it('classifies a downgrade', () => {
    const d = diffSection(
      'dependencies',
      { react: '^19.0.0' },
      { react: '^18.2.0' },
    );
    assert.equal(d.downgraded.length, 1);
    assert.equal(d.downgraded[0].bump, 'major');
    assert.equal(d.upgraded.length, 0);
  });

  it('routes unparseable-but-different versions to changed, not upgraded', () => {
    const d = diffSection(
      'dependencies',
      { pkg: 'git+https://github.com/a/x#abc' },
      { pkg: 'git+https://github.com/a/x#def' },
    );
    assert.equal(d.changed.length, 1);
    assert.equal(d.upgraded.length, 0);
    assert.equal(d.downgraded.length, 0);
    assert.equal(d.changed[0].bump, 'other');
  });

  it('ignores identical entries', () => {
    const d = diffSection(
      'dependencies',
      { react: '^19.0.0' },
      { react: '^19.0.0' },
    );
    assert.equal(d.added.length, 0);
    assert.equal(d.removed.length, 0);
    assert.equal(d.upgraded.length, 0);
    assert.equal(d.downgraded.length, 0);
    assert.equal(d.changed.length, 0);
  });

  it('sorts output alphabetically', () => {
    const d = diffSection(
      'dependencies',
      {},
      { zod: '^3.0.0', axios: '^1.0.0', react: '^19.0.0' },
    );
    assert.deepEqual(
      d.added.map((a) => a.name),
      ['axios', 'react', 'zod'],
    );
  });
});

describe('computeTotals', () => {
  it('aggregates across sections and counts major bumps', () => {
    const diffs = [
      diffSection(
        'dependencies',
        { react: '^18.2.0', express: '^4.19.0' },
        { react: '^19.0.0', express: '^4.20.0', zod: '^3.0.0' },
      ),
      diffSection(
        'devDependencies',
        { typescript: '^5.4.0' },
        { typescript: '^5.5.0' },
      ),
    ];
    const totals = computeTotals(diffs);
    assert.equal(totals.added, 1);
    assert.equal(totals.removed, 0);
    assert.equal(totals.upgraded, 3);
    assert.equal(totals.downgraded, 0);
    assert.equal(totals.changed, 0);
    assert.equal(totals.majorBumps, 1);
  });
});

describe('renderBody', () => {
  it('renders a no-change body when nothing changed', () => {
    const diffs = [
      diffSection('dependencies', { react: '^19.0.0' }, { react: '^19.0.0' }),
    ];
    const totals = computeTotals(diffs);
    const body = renderBody('📦 Dependency changes', diffs, totals, 'package.json');
    assert.match(body, /No dependency changes detected/);
  });

  it('renders summary with a major-bump warning', () => {
    const diffs = [
      diffSection(
        'dependencies',
        { react: '^18.2.0' },
        { react: '^19.0.0' },
      ),
    ];
    const totals = computeTotals(diffs);
    const body = renderBody('📦 Dependency changes', diffs, totals, 'package.json');
    assert.match(body, /1 upgraded/);
    assert.match(body, /⚠️ 1 major/);
    assert.match(body, /🔴 major/);
  });

  it('renders a changed row for unparseable version changes', () => {
    const diffs = [
      diffSection(
        'dependencies',
        { pkg: 'git+https://github.com/a/x#abc' },
        { pkg: 'git+https://github.com/a/x#def' },
      ),
    ];
    const totals = computeTotals(diffs);
    const body = renderBody('📦 Dependency changes', diffs, totals, 'package.json');
    assert.match(body, /🔄 changed/);
    assert.doesNotMatch(body, /⬆️ upgraded/);
  });

  it('includes the hidden marker so comments can be upserted', () => {
    const diffs = [diffSection('dependencies', {}, { zod: '^3.0.0' })];
    const totals = computeTotals(diffs);
    const body = renderBody('h', diffs, totals, 'package.json');
    assert.match(body, /<!-- deps-diff-action:comment -->/);
  });
});
