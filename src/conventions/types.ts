import { z } from 'zod';

export const PROFILE_SCHEMA_VERSION = 1 as const;
export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
export type IdentifierStyle = 'camelCase' | 'PascalCase' | 'snake_case' | 'SCREAMING_SNAKE_CASE';
export type RuleId = 'function-name-style' | 'variable-name-style' | 'class-name-style' | 'import-order' | 'function-length' | 'export-doc-comment';

export interface SourceLocation { path: string; line: number; }
export interface RuleBase { kind: 'deterministic'; confidence: number; supportCount: number; eligibleCount: number; examples: SourceLocation[]; enforceable: boolean; }
export type ProfileRule =
  | (RuleBase & { id: 'function-name-style' | 'variable-name-style' | 'class-name-style'; expected: { style: IdentifierStyle } })
  | (RuleBase & { id: 'import-order'; expected: { groups: ['builtin', 'external', 'relative']; alphabetizedWithinGroups: true } })
  | (RuleBase & { id: 'function-length'; expected: { maxNonCommentBodyLines: number; medianNonCommentBodyLines: number } })
  | (RuleBase & { id: 'export-doc-comment'; expected: { required: true } });

export interface LlmPattern { id: 'error-handling-shape' | 'function-structure-shape'; kind: 'llm-advisory'; rule: string; confidence: number; examples: SourceLocation[]; }
export interface ConventionProfile { schemaVersion: typeof PROFILE_SCHEMA_VERSION; repository: { root: string; sampledPaths: string[]; createdAt: string; fingerprint: string }; rules: ProfileRule[]; llmPatterns: LlmPattern[]; }
export interface Diagnostic { code: string; path?: string; message: string; severity: 'warning' | 'error'; }
export interface AnalysisSkip { path: string; reason: 'unsupported' | 'parse-error' | 'deleted' | 'file-too-large' | 'function-limit'; }
export interface Violation { ruleId: RuleId; path: string; line: number; message: string; confidence: number; examples: SourceLocation[]; }
export interface FixResult { violation: Violation; status: 'generated' | 'validated' | 'rejected' | 'unavailable'; reason?: string; unifiedDiff?: string; }
export interface ReviewResult { violations: Violation[]; skips: AnalysisSkip[]; diagnostics: Diagnostic[]; partial: boolean; fixes: FixResult[]; }

export interface ImportFeature { line: number; source: string; group: 'builtin' | 'external' | 'relative'; }
export interface DeclarationFeature { kind: 'function' | 'variable' | 'class'; name: string; line: number; endLine: number; bodyStartLine?: number; bodyEndLine?: number; bodyLines?: number; exported: boolean; documented: boolean; }
export interface FileFeatures { path: string; imports: ImportFeature[]; declarations: DeclarationFeature[]; parseError?: string; }

const sourceLocationSchema = z.object({ path: z.string(), line: z.number().int().positive() });
const ruleBaseSchema = z.object({ kind: z.literal('deterministic'), confidence: z.number().min(0).max(1), supportCount: z.number().int().nonnegative(), eligibleCount: z.number().int().nonnegative(), examples: z.array(sourceLocationSchema), enforceable: z.boolean() });
export const conventionProfileSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  repository: z.object({ root: z.string(), sampledPaths: z.array(z.string()), createdAt: z.string(), fingerprint: z.string().length(64) }),
  rules: z.array(z.discriminatedUnion('id', [
    ruleBaseSchema.extend({ id: z.literal('function-name-style'), expected: z.object({ style: z.enum(['camelCase', 'PascalCase', 'snake_case', 'SCREAMING_SNAKE_CASE']) }) }),
    ruleBaseSchema.extend({ id: z.literal('variable-name-style'), expected: z.object({ style: z.enum(['camelCase', 'PascalCase', 'snake_case', 'SCREAMING_SNAKE_CASE']) }) }),
    ruleBaseSchema.extend({ id: z.literal('class-name-style'), expected: z.object({ style: z.enum(['camelCase', 'PascalCase', 'snake_case', 'SCREAMING_SNAKE_CASE']) }) }),
    ruleBaseSchema.extend({ id: z.literal('import-order'), expected: z.object({ groups: z.tuple([z.literal('builtin'), z.literal('external'), z.literal('relative')]), alphabetizedWithinGroups: z.literal(true) }) }),
    ruleBaseSchema.extend({ id: z.literal('function-length'), expected: z.object({ maxNonCommentBodyLines: z.number().int().positive(), medianNonCommentBodyLines: z.number().int().nonnegative() }) }),
    ruleBaseSchema.extend({ id: z.literal('export-doc-comment'), expected: z.object({ required: z.literal(true) }) }),
  ])),
  llmPatterns: z.array(z.object({ id: z.enum(['error-handling-shape', 'function-structure-shape']), kind: z.literal('llm-advisory'), rule: z.string(), confidence: z.number().min(0).max(1), examples: z.array(sourceLocationSchema) })),
});
