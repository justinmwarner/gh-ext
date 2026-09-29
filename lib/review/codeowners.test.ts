/**
 * Reading a CODEOWNERS file, and asking it whether the reviewer owns a path.
 *
 * The patterns worth pinning hardest are the ones GitHub documents as its own:
 * a CODEOWNERS file is gitignore-shaped but not gitignore, and the difference
 * shows exactly where a pattern ends in a wildcard. `docs/*` owns the files in
 * `docs/` and not the ones further down, where `**\/logs` owns everything
 * beneath any `logs` directory. Each example below is lifted from GitHub's own
 * documentation of the format, with the sentence it came with.
 */

import { describe, expect, it } from 'vitest';
import {
  CODEOWNERS_PATHS,
  codeownerGlobs,
  isOwnedBy,
  ownersOf,
  parseCodeowners,
} from './codeowners';
import { isNoise } from './filters';

const matches = (pattern: string, path: string): boolean =>
  isNoise(path, codeownerGlobs(pattern));

describe('where GitHub looks', () => {
  it('looks in .github/, then the root, then docs/, and uses the first it finds', () => {
    expect(CODEOWNERS_PATHS).toEqual(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']);
  });
});

describe('a pattern', () => {
  it('owns everything with a lone *', () => {
    expect(matches('*', 'README.md')).toBe(true);
    expect(matches('*', 'src/deep/app.ts')).toBe(true);
  });

  it('owns a type at any depth with *.js', () => {
    expect(matches('*.js', 'app.js')).toBe(true);
    expect(matches('*.js', 'web/static/app.js')).toBe(true);
    expect(matches('*.js', 'web/app.ts')).toBe(false);
  });

  it('owns a directory at the root, and everything beneath it, with /build/logs/', () => {
    expect(matches('/build/logs/', 'build/logs/today.txt')).toBe(true);
    expect(matches('/build/logs/', 'build/logs/2026/today.txt')).toBe(true);
    expect(matches('/build/logs/', 'src/build/logs/today.txt')).toBe(false);
  });

  it('owns the files in docs/ and not the ones nested further, with docs/*', () => {
    // "The docs/* pattern will match files like docs/getting-started.md but
    // not further nested files like docs/build-app/troubleshooting.md."
    expect(matches('docs/*', 'docs/getting-started.md')).toBe(true);
    expect(matches('docs/*', 'docs/build-app/troubleshooting.md')).toBe(false);
  });

  it('owns a directory named apps anywhere, with apps/', () => {
    // "@octocat owns any file in an apps directory anywhere in your repository."
    expect(matches('apps/', 'apps/web/main.ts')).toBe(true);
    expect(matches('apps/', 'services/apps/web/main.ts')).toBe(true);
    expect(matches('apps/', 'appsettings.json')).toBe(false);
  });

  it('owns everything beneath any logs directory, with **/logs', () => {
    // "@octocat owns any file in a /logs directory such as /build/logs,
    // /scripts/logs, and /deeply/nested/logs."
    expect(matches('**/logs', 'build/logs/a.txt')).toBe(true);
    expect(matches('**/logs', 'deeply/nested/logs/a.txt')).toBe(true);
    expect(matches('**/logs', 'logs/a.txt')).toBe(true);
    expect(matches('**/logs', 'build/logsheet.txt')).toBe(false);
  });

  it('reads a name with no wildcard as a file or a directory, since it could be either', () => {
    expect(matches('/apps/github', 'apps/github')).toBe(true);
    expect(matches('/apps/github', 'apps/github/main.ts')).toBe(true);
  });

  it('matches case as written, because GitHub’s file system does', () => {
    expect(matches('/Docs/', 'docs/readme.md')).toBe(false);
  });
});

describe('the file', () => {
  const FILE = [
    '# The default owners, for everything in the repository.',
    '*       @global-owner1 @global-owner2',
    '',
    '*.js    @js-owner #This is an inline comment.',
    '*.go docs@example.com',
    '/build/logs/ @doctocat',
    '/apps/ @octocat',
    '/apps/github',
    '/scripts/ @Acme/Platform',
  ].join('\n');
  const rules = parseCodeowners(FILE);

  it('keeps a line per pattern, skipping comments and blank lines', () => {
    expect(rules).toHaveLength(7);
  });

  it('stops reading owners at an inline comment', () => {
    expect(ownersOf('web/app.js', rules)).toEqual(['@js-owner']);
  });

  it('lets the last matching line win', () => {
    // A lone `*` matches everything; the later `/build/logs/` line takes the
    // files it names away from the default owners.
    expect(ownersOf('build/logs/a.txt', rules)).toEqual(['@doctocat']);
    expect(ownersOf('README.md', rules)).toEqual(['@global-owner1', '@global-owner2']);
  });

  it('un-owns a path whose last matching line names nobody', () => {
    // "@octocat owns any file in the /apps directory in the root of your
    // repository except for the /apps/github subdirectory, as its owners are
    // left empty."
    expect(ownersOf('apps/web/main.ts', rules)).toEqual(['@octocat']);
    expect(ownersOf('apps/github/main.ts', rules)).toEqual([]);
  });

  it('lowercases owners, because GitHub reads logins and team slugs without case', () => {
    expect(ownersOf('scripts/deploy.sh', rules)).toEqual(['@acme/platform']);
  });

  it('says nobody owns a path no line matches', () => {
    expect(ownersOf('anything.txt', parseCodeowners('/docs/ @writer'))).toBeNull();
  });

  it('skips a negated pattern, which GitHub does not support', () => {
    expect(parseCodeowners('!*.md @someone')).toHaveLength(0);
  });

  it('reads a backslash-escaped space as part of the pattern, not the end of it', () => {
    // gitignore's escape. GitHub's page on the format does not mention spaces
    // at all; split on every space, the pattern would be `/docs/My\` and its
    // "owners" the rest of the path.
    const rules = parseCodeowners('/docs/My\\ Guide/ @writer');

    expect(ownersOf('docs/My Guide/intro.md', rules)).toEqual(['@writer']);
  });

  it('reads Windows line endings as well as Unix ones', () => {
    expect(ownersOf('app.js', parseCodeowners('*.js @js-owner\r\n'))).toEqual(['@js-owner']);
  });
});

describe('whether the reviewer owns a path', () => {
  const rules = parseCodeowners(
    ['*.ts @someone-else', '/lib/ @Reviewer', '/api/ @acme/backend', '/apps/github'].join('\n'),
  );
  const me = { login: 'reviewer', teams: ['@acme/backend'] };

  it('does by login, whatever case either side is written in', () => {
    expect(isOwnedBy('lib/parse.ts', rules, me)).toBe(true);
  });

  it('does through a team they are on', () => {
    expect(isOwnedBy('api/routes.ts', rules, me)).toBe(true);
  });

  it('does not where somebody else owns it', () => {
    expect(isOwnedBy('src/app.ts', rules, me)).toBe(false);
  });

  it('does not where nobody owns it', () => {
    expect(isOwnedBy('apps/github/main.ts', rules, me)).toBe(false);
    expect(isOwnedBy('notes.txt', rules, me)).toBe(false);
  });
});
