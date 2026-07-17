import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProfile, fingerprint } from '../src/conventions/profileBuilder';
import { extractFileFeatures } from '../src/conventions/extractor';
import { generateFixes } from '../src/conventions/fixGenerator';
import { validateFixes } from '../src/conventions/fixValidator';
import { runCli } from '../src/conventions/cli';
import { selectSourceFiles } from '../src/conventions/fileSelector';
import { safeJoin } from '../src/conventions/paths';

const root = path.resolve('fixtures');
const base = path.join(root, 'convention-base');
const change = path.join(root, 'convention-change');
const patch = path.join(root, 'convention-change.patch');
const output = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-reviewer-demo-')), 'profile.json');

async function main() {
  console.log('Codex Reviewer convention demo');
  console.log('1. Learning conventions from the fixture repository');
  await runCli(['profile', '--repo', base, '--out', output]);
  console.log('\n2. Reviewing only lines introduced by the fixture patch');
  const reviewCode = await runCli(['review', '--base', base, '--repo', change, '--profile', output, '--patch', patch]);
  console.log(`Review exit code: ${reviewCode}`);

  const selection = selectSourceFiles(base);
  const profileSources = selection.paths.map(filePath => {
    const source = fs.readFileSync(safeJoin(base, filePath), 'utf8');
    return { path: filePath, source, features: extractFileFeatures(filePath, source) };
  }).filter(item => !item.features.parseError);
  const profile = buildProfile(base, profileSources);
  if (fingerprint(base, profileSources) !== profile.repository.fingerprint) throw new Error('Demo profile fingerprint mismatch.');

  const source = fs.readFileSync(path.join(change, 'src/helpers.ts'), 'utf8');
  const violation = { ruleId: 'function-name-style' as const, path: 'src/helpers.ts', line: 16, message: 'Use camelCase.', confidence: 1, examples: [] };
  const fixes = await generateFixes([violation], new Map([['src/helpers.ts', source]]), {
    complete: async () => JSON.stringify({
      path: 'src/helpers.ts',
      explanation: 'Rename the function to match the repository convention.',
      unifiedDiff: 'diff --git a/src/helpers.ts b/src/helpers.ts\nindex 1111111..2222222 100644\n--- a/src/helpers.ts\n+++ b/src/helpers.ts\n@@ -13,4 +13,4 @@ export function formatValueTwelve(value: string) { return value.trim(); }\n export function formatValueThirteen(value: string) { return value.trim(); }\n export function formatValueFourteen(value: string) { return value.trim(); }\n export function formatValueFifteen(value: string) { return value.trim(); }\n-export function format_value_sixteen(value: string) { return value.trim(); }\n+export function formatValueSixteen(value: string) { return value.trim(); }\n',
    }),
  });
  const validated = validateFixes(fixes, change, profile);
  console.log(`\n3. Mock model + real fix validation: ${validated[0]?.status ?? 'unavailable'}${validated[0]?.reason ? ` — ${validated[0].reason}` : ''}`);
  console.log('Demo complete. No GitHub credentials, Redis, or AI provider are required.');
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
