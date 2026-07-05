import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

describe('production bundle includes foliate-js', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'pipe' });
  });

  it('does not leave a bare foliate-js import in dist assets', () => {
    const assetsDir = join(process.cwd(), 'dist', 'assets');
    const assetFiles = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
    const bareFoliateImport = assetFiles.some((name) =>
      readFileSync(join(assetsDir, name), 'utf8').includes('import("foliate-js/'),
    );

    expect(bareFoliateImport).toBe(false);
  });
});
