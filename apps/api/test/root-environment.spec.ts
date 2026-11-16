import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('explicit root environment loading', () => {
  let root: string;
  let workspace: string;
  let wrapper: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aka-env-test-'));
    workspace = join(root, 'apps', 'child');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(root, 'scripts'));
    wrapper = join(root, 'scripts', 'with-env.mjs');
    copyFileSync(resolve(__dirname, '../../../scripts/with-env.mjs'), wrapper);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('loads the root file from a child workspace and preserves shell overrides', () => {
    writeFileSync(
      join(root, '.env'),
      'AKA_TEST_VALUE=root-file\nAKA_TEST_OVERRIDE=file\n',
    );
    const output = execFileSync(
      process.execPath,
      [
        wrapper,
        process.execPath,
        '-e',
        'console.log(JSON.stringify([process.env.AKA_TEST_VALUE, process.env.AKA_TEST_OVERRIDE]))',
      ],
      {
        cwd: workspace,
        env: { ...process.env, AKA_TEST_OVERRIDE: 'shell' },
        encoding: 'utf8',
      },
    );
    expect(JSON.parse(output)).toEqual(['root-file', 'shell']);
  });

  it('allows a missing .env and propagates the child exit code', () => {
    const result = spawnSync(
      process.execPath,
      [wrapper, process.execPath, '-e', 'process.exit(7)'],
      { cwd: workspace },
    );
    expect(result.status).toBe(7);
  });
});
