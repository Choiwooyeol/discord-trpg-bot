import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = ['README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md', 'PRIVACY.md', 'CONTRIBUTING.md', '.env.example', 'docs/SETUP.md', 'docs/GCP_DEPLOY.md', 'docs/OPERATIONS.md', '.github/workflows/test.yml'];
const excluded = new Set(['.git', '.omx', 'node_modules', 'data', 'logs', 'reports', 'coverage']);
const textExtensions = new Set(['', '.md', '.mjs', '.json', '.yml', '.yaml', '.sh', '.example']);
const errors = [];

for (const file of required) if (!existsSync(join(root, file))) errors.push(`Missing required public file: ${file}`);
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
for (const file of files(root)) {
  const name = relative(root, file).replaceAll('\\', '/');
  if (name === '.env' || !textExtensions.has(extname(file))) continue;
  const text = readFileSync(file, 'utf8');
  if (/\b(?:MTA|MTI|MTM|MTQ|MTU|MTY|MTc|MTg|MTk)[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/.test(text)) errors.push(`Possible Discord token: ${name}`);
  if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(text)) errors.push(`Possible OpenAI key: ${name}`);
  if (/instance-\d{8}-\d{6}/.test(text)) errors.push(`Personal VM identifier: ${name}`);
  if (/C:\\workspace\\/i.test(text)) errors.push(`Personal workspace path: ${name}`);
  if (extname(file) === '.md') for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '').split('#', 1)[0];
    if (target && !/^(?:https?:|mailto:)/i.test(target) && !existsSync(resolve(dirname(file), decodeURIComponent(target)))) errors.push(`Broken document link: ${name} -> ${target}`);
  }
}
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/);
  for (const forbidden of ['.env', 'token.txt']) if (tracked.includes(forbidden)) errors.push(`Forbidden tracked file: ${forbidden}`);
} catch { console.warn('Not a Git repository; tracked-file check skipped.'); }
if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exitCode = 1; }
else console.log('Public-release check passed.');
