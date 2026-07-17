import fs from 'fs';
import path from 'path';
import { selectSourceFiles } from './fileSelector';
import { extractFileFeatures } from './extractor';
import { buildProfile } from './profileBuilder';
import { writeProfile } from './profileStore';
import { readProfile } from './profileStore';
import { renderProfile, renderReview } from './reporter';
import { safeJoin } from './paths';
import { resolvePatch } from './patchResolver';
import { evaluateProfile } from './evaluator';
import { fingerprint } from './profileBuilder';
import { extractLlmPatterns } from './llmPatterns';
import { generateFixes } from './fixGenerator';
import { validateFixes } from './fixValidator';

function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function has(args: string[], name: string): boolean { return args.includes(name); }
function usage() { return 'Usage:\n  conventions profile --repo <base-repo> [--out <profile.json>] [--max-files 50] [--include-tests] [--llm-patterns]\n  conventions review --base <base-repo> --repo <post-change-repo> --profile <profile.json> --patch <change.patch> [--fixes off|auto]'; }
function collectSources(root: string) {
  const selection = selectSourceFiles(root);
  const sources = selection.paths.map(repoPath => { const source = fs.readFileSync(safeJoin(root, repoPath), 'utf8'); return { path: repoPath, source, features: extractFileFeatures(repoPath, source) }; });
  return { selection, sources, parsedSources: sources.filter(source => !source.features.parseError) };
}

export async function runCli(args: string[]): Promise<number> {
  const command = args[0];
  if (command === 'review') return review(args);
  if (command !== 'profile') { console.error(usage()); return 2; }
  const repo = option(args, '--repo');
  if (!repo || !fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) { console.error('--repo must be an existing directory.'); return 2; }
  const maxFiles = option(args, '--max-files');
  if (maxFiles && (!/^\d+$/.test(maxFiles) || Number(maxFiles) < 1)) { console.error('--max-files must be a positive integer.'); return 2; }
  try {
    const root = path.resolve(repo);
    const selection = selectSourceFiles(root, { maxFiles: maxFiles ? Number(maxFiles) : undefined, includeTests: has(args, '--include-tests') });
    const sources = selection.paths.map(repoPath => { const source = fs.readFileSync(safeJoin(root, repoPath), 'utf8'); return { path: repoPath, source, features: extractFileFeatures(repoPath, source) }; });
    const parsedSources = sources.filter(source => !source.features.parseError);
    if (!parsedSources.length) { console.error('No eligible source file could be parsed.'); return 3; }
    const llm = has(args, '--llm-patterns') ? await extractLlmPatterns(parsedSources) : { patterns: [], diagnostics: [] };
    const profile = buildProfile(root, parsedSources, llm.patterns);
    const output = option(args, '--out') ?? path.join(root, '.ai-bug-detector', 'conventions.profile.json');
    writeProfile(path.resolve(output), profile);
    console.log(renderProfile(profile, selection.skips.length + sources.length - parsedSources.length));
    for (const diagnostic of llm.diagnostics) console.warn(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
    console.log(`\nProfile written to ${path.resolve(output)}`);
    return 0;
  } catch (error) { console.error(error instanceof Error ? error.message : 'Unable to create profile.'); return 2; }
}

async function review(args: string[]): Promise<number> {
  const base = option(args, '--base'), repo = option(args, '--repo'), profilePath = option(args, '--profile'), patch = option(args, '--patch');
  if (!base || !repo || !profilePath || !patch) { console.error(usage()); return 2; }
  const fixes = option(args, '--fixes') ?? 'off';
  if (fixes !== 'off' && fixes !== 'auto') { console.error('--fixes must be off or auto.'); return 2; }
  try {
    const profile = readProfile(path.resolve(profilePath)); const baseRoot = path.resolve(base), postRoot = path.resolve(repo);
    if (!fs.statSync(baseRoot).isDirectory() || !fs.statSync(postRoot).isDirectory()) throw new Error('--base and --repo must be directories.');
    const baseSources = collectSources(baseRoot).parsedSources;
    if (fingerprint(baseRoot, baseSources) !== profile.repository.fingerprint) throw new Error('Base repository does not match the profile fingerprint.');
    const resolution = resolvePatch(baseRoot, postRoot, path.resolve(patch));
    const touched = [...new Set(resolution.ranges.map(range => range.path))];
    const sourceByPath = new Map(touched.map(repoPath => [repoPath, fs.readFileSync(safeJoin(postRoot, repoPath), 'utf8')]));
    const files = touched.map(repoPath => extractFileFeatures(repoPath, sourceByPath.get(repoPath)!));
    const result = evaluateProfile(profile, files, resolution.ranges); result.skips.push(...resolution.skips); result.diagnostics.push(...resolution.diagnostics); result.partial ||= result.skips.length > 0;
    if (fixes === 'auto') result.fixes = validateFixes(await generateFixes(result.violations, sourceByPath), postRoot, profile);
    console.log(renderReview(result));
    return result.violations.length ? 1 : 0;
  } catch (error) { console.error(error instanceof Error ? error.message : 'Unable to review changes.'); return 2; }
}
