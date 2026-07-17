import OpenAI from 'openai';
import { z } from 'zod';
import { FixResult, Violation } from './types';

const MAX_FIXES = 3;
const MAX_SOURCE_CHARS = 8_000;
const fixSchema = z.object({ path: z.string().min(1), unifiedDiff: z.string().min(1), explanation: z.string().min(1).max(1_000) });

export interface FixClient { complete(system: string, user: string): Promise<string>; }

function configuredClient(): FixClient | null {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : undefined) });
  const model = process.env.OPENAI_MODEL || (process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini');
  return { complete: async (system, user) => (await client.chat.completions.create({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })).choices[0]?.message?.content ?? '{}' };
}

function quotedPathMatches(diff: string, repoPath: string) {
  const paths = [...diff.matchAll(/^(?:--- a\/|\+\+\+ b\/)(.+)$/gm)].map(match => match[1].trim());
  return paths.length === 2 && paths.every(value => value === repoPath);
}

export async function generateFixes(violations: Violation[], sourceByPath: Map<string, string>, client: FixClient | null = configuredClient()): Promise<FixResult[]> {
  const targets = [...violations].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.ruleId.localeCompare(b.ruleId)).slice(0, MAX_FIXES);
  if (!client) return targets.map(violation => ({ violation, status: 'unavailable', reason: 'No AI provider key is configured.' }));
  const results: FixResult[] = [];
  for (const violation of targets) {
    const source = sourceByPath.get(violation.path);
    if (!source) { results.push({ violation, status: 'unavailable', reason: 'Source file is unavailable.' }); continue; }
    try {
      const raw = await client.complete(
        'Return JSON with path, unifiedDiff, and explanation. Preserve behavior. The diff must modify exactly the requested file and use --- a/path and +++ b/path headers.',
        JSON.stringify({ violation, source: source.slice(0, MAX_SOURCE_CHARS) }),
      );
      const parsed = fixSchema.parse(JSON.parse(raw));
      if (parsed.path !== violation.path || !quotedPathMatches(parsed.unifiedDiff, violation.path)) throw new Error('Generated diff does not target exactly the reported file.');
      results.push({ violation, status: 'generated', unifiedDiff: parsed.unifiedDiff, reason: parsed.explanation });
    } catch (error) { results.push({ violation, status: 'rejected', reason: error instanceof Error ? error.message : 'Unable to generate a structured fix.' }); }
  }
  return results;
}
