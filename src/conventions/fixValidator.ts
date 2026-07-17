import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { evaluateProfile } from './evaluator';
import { extractFileFeatures } from './extractor';
import { safeJoin } from './paths';
import { ConventionProfile, FixResult } from './types';

interface Range { path: string; startLine: number; endLine: number; kind: 'added'; }
function parseRanges(diff: string): Range[] {
  const ranges: Range[] = []; let target = ''; let line = 0;
  for (const entry of diff.replace(/\r\n/g, '\n').split('\n')) {
    if (entry.startsWith('+++ b/')) { target = entry.slice(6).trim(); continue; }
    const hunk = entry.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!target || entry.startsWith('\\')) continue;
    if (entry.startsWith('+')) { ranges.push({ path: target, startLine: line, endLine: line, kind: 'added' }); line++; }
    else if (!entry.startsWith('-')) line++;
  }
  return ranges;
}
function validateHeaders(diff: string, expectedPath: string): void {
  const headers = [...diff.matchAll(/^(?:--- a\/|\+\+\+ b\/)(.+)$/gm)].map(match => match[1].trim());
  if (headers.length !== 2 || headers.some(header => header !== expectedPath)) throw new Error('Generated diff must contain exactly one matching file.');
  if (diff.includes('/dev/null') || expectedPath.includes('..') || expectedPath.includes('\\')) throw new Error('Generated diff contains an unsafe path.');
}

export function validateFix(fix: FixResult, repoRoot: string, profile: ConventionProfile): FixResult {
  if (fix.status !== 'generated' || !fix.unifiedDiff) return fix;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'convention-fix-')); const working = path.join(temp, 'repo');
  try {
    validateHeaders(fix.unifiedDiff, fix.violation.path);
    fs.cpSync(repoRoot, working, { recursive: true, filter: value => !value.includes(`${path.sep}.git${path.sep}`) });
    const patchFile = path.join(temp, 'fix.patch'); fs.writeFileSync(patchFile, fix.unifiedDiff);
    execFileSync('git', ['apply', '--check', '--recount', '--unidiff-zero', '--whitespace=nowarn', patchFile], { cwd: working, stdio: 'pipe' });
    execFileSync('git', ['apply', '--recount', '--unidiff-zero', '--whitespace=nowarn', patchFile], { cwd: working, stdio: 'pipe' });
    const ranges = parseRanges(fix.unifiedDiff);
    if (!ranges.some(range => range.path === fix.violation.path && range.startLine <= fix.violation.line && range.endLine >= fix.violation.line)) throw new Error('Generated diff does not overlap the reported violation.');
    const source = fs.readFileSync(safeJoin(working, fix.violation.path), 'utf8');
    const features = extractFileFeatures(fix.violation.path, source);
    if (features.parseError) throw new Error(`Fixed file does not parse: ${features.parseError}`);
    const remaining = evaluateProfile(profile, [features], ranges).violations;
    if (remaining.some(violation => violation.ruleId === fix.violation.ruleId && violation.path === fix.violation.path)) throw new Error('Generated diff did not remove the original violation.');
    if (remaining.length) throw new Error('Generated diff introduces another convention violation.');
    return { ...fix, status: 'validated' };
  } catch (error) { return { ...fix, status: 'rejected', reason: error instanceof Error ? error.message : 'Generated diff failed validation.' }; }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export function validateFixes(fixes: FixResult[], repoRoot: string, profile: ConventionProfile): FixResult[] { return fixes.map(fix => validateFix(fix, repoRoot, profile)); }
