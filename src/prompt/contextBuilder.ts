import { ParsedContext, Rule, RuleMatch, Finding, CodeContext, ASTSummary } from '../types';
import { summarizeASTForLLM, LLMReadyAST } from '../parser/astParser';
import { RuleExecutionResult } from '../rules/ruleEngine';

// ============ System Prompt ============

export function buildSystemPrompt(): string {
    return `You are an expert code security and logic reviewer specializing in bug detection.
Your task is to analyze provided code changes (diffs) and identify HIGH-CONFIDENCE bugs only.

FOCUS AREAS:
1. Security vulnerabilities (injection, authentication bypass, data exposure)
2. Memory safety issues (leaks, use-after-free, buffer overflows)
3. Concurrency bugs (race conditions, deadlocks)
4. Logic errors (null dereferences, infinite loops, incorrect conditions)
5. Resource management (unclosed handles, connection leaks)

DO NOT FLAG:
- Style issues or formatting
- Minor performance optimizations
- Subjective "best practices" without clear correctness impact
- Issues already flagged by the static rule hints

OUTPUT FORMAT:
You MUST return a valid JSON array of findings. No text outside the JSON.
Return an empty array [] if no bugs found.

Each finding must match this schema:
{
  "file": string,         // filename
  "line": number,         // primary line number (positive integer)
  "severity": "critical" | "high" | "medium" | "low" | "info",
  "bug_type": string,     // category e.g. "SQL_INJECTION", "NULL_DEREF"
  "title": string,        // max 120 chars
  "description": string,  // max 500 chars, explain the bug
  "suggestion": string,   // max 500 chars, how to fix
  "confidence": number    // 0.0 to 1.0, your certainty
}

Only report findings with confidence >= 0.6.
`;
}

export function buildEnhancedSystemPrompt(language: string): string {
    const basePrompt = buildSystemPrompt();
    
    // Add language-specific guidance
    const languageGuidance: Record<string, string> = {
        javascript: `
JAVASCRIPT-SPECIFIC CHECKS:
- Prototype pollution vulnerabilities
- XSS through innerHTML/document.write
- eval() with user input
- Async/await error handling
- Callback hell leading to lost errors
- 'this' binding issues in callbacks`,
        
        typescript: `
TYPESCRIPT-SPECIFIC CHECKS:
- Type assertion abuse (as any, as unknown)
- Non-null assertion (!) on potentially null values  
- Type guard correctness
- Unsafe type narrowing
- Missing discriminated union checks`,
        
        python: `
PYTHON-SPECIFIC CHECKS:
- pickle/marshal deserialization of untrusted data
- eval/exec with user input
- SQL injection via string formatting
- Path traversal in file operations
- YAML/XML parsing vulnerabilities
- Mutable default arguments`,
        
        c: `
C-SPECIFIC CHECKS:
- Buffer overflows (strcpy, sprintf, gets)
- Format string vulnerabilities
- Integer overflow in size calculations
- Double-free and use-after-free
- Uninitialized memory usage
- NULL pointer dereference
- Off-by-one errors in array access`,
        
        cpp: `
C++-SPECIFIC CHECKS:
- Smart pointer misuse (unique_ptr/shared_ptr cycles)
- Exception safety (RAII violations)
- Virtual destructor missing in base class
- Slicing in polymorphic copies
- Iterator invalidation
- Move semantics errors`,
    };
    
    const langSpecific = languageGuidance[language] || '';
    
    return basePrompt + langSpecific;
}

// ============ User Prompt Building ============

export interface PromptContext {
    filename: string;
    language: string;
    rawDiff: string;
    parsedContext: ParsedContext;
    staticRuleResults: RuleExecutionResult[];
    surroundingContext?: string;
}

// Minimal rule interface for prompt building (supports both legacy and new format)
export interface TriggeredRuleHint {
    id: string;
    description: string;
}

export function buildUserPrompt(
    filename: string,
    language: string,
    rawDiff: string,
    astSummary: any,
    triggeredRules: TriggeredRuleHint[]
): string {
    // Legacy compatibility wrapper
    let astString = JSON.stringify(astSummary, null, 2);
    if (astString.length > 8000) {
        astString = astString.substring(0, 8000) + '\n... (truncated)';
    }

    let rulesHint = triggeredRules.map(r => `- ${r.id}: ${r.description}`).join('\n');
    if (!rulesHint) {
        rulesHint = "No specific static rules triggered. Perform a general review.";
    }

    return `File: ${filename}
Language: ${language}

--- RAW DIFF ---
${rawDiff}

--- AST SUMMARY ---
${astString}

--- TRIGGERED RULE HINTS ---
The following patterns matched statically. Consider if they apply:
${rulesHint}

Analyze the raw diff, cross-reference with the AST if helpful, and return the required JSON array of findings.
`;
}

export function buildEnhancedUserPrompt(context: PromptContext): string {
    const { filename, language, rawDiff, parsedContext, staticRuleResults, surroundingContext } = context;
    
    // Build AST summary for LLM
    const llmAST = summarizeASTForLLM(parsedContext);
    const astSection = formatASTForPrompt(llmAST);
    
    // Build rule hints from static analysis
    const ruleHints = formatStaticRuleHints(staticRuleResults);
    
    // Build the prompt
    let prompt = `## FILE UNDER REVIEW
**Filename:** ${filename}
**Language:** ${language}
**Complexity:** ${llmAST.complexity}

## CODE CHANGES (DIFF)
\`\`\`diff
${truncateWithEllipsis(rawDiff, 15000)}
\`\`\`
`;
    
    // Add surrounding context if provided
    if (surroundingContext) {
        prompt += `
## SURROUNDING CONTEXT (±5 lines)
\`\`\`${language}
${truncateWithEllipsis(surroundingContext, 5000)}
\`\`\`
`;
    }
    
    // Add AST section
    prompt += astSection;
    
    // Add static rule hints
    prompt += `
## STATIC ANALYSIS HINTS
${ruleHints}
`;
    
    prompt += `
## INSTRUCTIONS
1. Analyze the diff for security vulnerabilities and logic bugs
2. Cross-reference with AST summary for context
3. Consider static analysis hints but verify independently
4. Return ONLY a JSON array of findings
`;
    
    return prompt;
}

// ============ Helper Functions ============

function formatASTForPrompt(llmAST: LLMReadyAST): string {
    let section = `
## CODE STRUCTURE SUMMARY
${llmAST.summary}

`;
    
    // Functions
    if (llmAST.functions.length > 0) {
        section += `### Functions (${llmAST.functions.length})
`;
        for (const func of llmAST.functions.slice(0, 20)) {
            section += `- Line ${func.line}: \`${func.signature}\`
`;
        }
        if (llmAST.functions.length > 20) {
            section += `  ... and ${llmAST.functions.length - 20} more\n`;
        }
    }
    
    // Classes
    if (llmAST.classes.length > 0) {
        section += `
### Classes (${llmAST.classes.length})
`;
        for (const cls of llmAST.classes.slice(0, 10)) {
            section += `- Line ${cls.line}: \`${cls.name}\` (${cls.members})
`;
        }
    }
    
    // Call graph (condensed)
    if (llmAST.callGraphText) {
        section += `
### Call Graph
${truncateWithEllipsis(llmAST.callGraphText, 2000)}
`;
    }
    
    // Control flow summary
    section += `
### Control Flow
${llmAST.controlFlowSummary || 'No complex control flow detected'}
`;
    
    return section;
}

function formatStaticRuleHints(results: RuleExecutionResult[]): string {
    if (!results || results.length === 0) {
        return 'No static analysis rules triggered. Perform a general review focusing on the areas mentioned in the system prompt.';
    }
    
    const matchedRules = results.filter(r => r.matches.length > 0);
    
    if (matchedRules.length === 0) {
        return 'Static analysis completed with no issues detected. Focus on logic errors and security vulnerabilities that require deeper analysis.';
    }
    
    let hints = `The following issues were detected by static analysis. Verify these and look for related problems:\n\n`;
    
    for (const result of matchedRules) {
        hints += `### ${result.ruleName} (${result.severity.toUpperCase()})
`;
        for (const match of result.matches.slice(0, 5)) {
            hints += `- **Line ${match.line}:** ${match.context}
`;
        }
        if (result.matches.length > 5) {
            hints += `  ... and ${result.matches.length - 5} more occurrences\n`;
        }
        hints += '\n';
    }
    
    return hints;
}

function truncateWithEllipsis(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '\n... [truncated]';
}

// ============ Context Assembly ============

export interface AssembledContext {
    systemPrompt: string;
    userPrompt: string;
    estimatedTokens: number;
}

/**
 * Assemble complete prompts for LLM analysis
 */
export function assembleContext(
    files: PromptContext[],
    maxTokens: number = 200000 // Claude default
): AssembledContext[] {
    const results: AssembledContext[] = [];
    
    for (const file of files) {
        const systemPrompt = buildEnhancedSystemPrompt(file.language);
        const userPrompt = buildEnhancedUserPrompt(file);
        
        // Rough token estimation (4 chars per token)
        const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
        
        results.push({
            systemPrompt,
            userPrompt,
            estimatedTokens,
        });
    }
    
    return results;
}

/**
 * Chunk large PRs into batches that fit within token limits
 */
export function chunkForBatchProcessing(
    contexts: AssembledContext[],
    maxTokensPerBatch: number = 150000 // Leave room for response
): AssembledContext[][] {
    const batches: AssembledContext[][] = [];
    let currentBatch: AssembledContext[] = [];
    let currentTokens = 0;
    
    for (const ctx of contexts) {
        if (currentTokens + ctx.estimatedTokens > maxTokensPerBatch && currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [];
            currentTokens = 0;
        }
        
        currentBatch.push(ctx);
        currentTokens += ctx.estimatedTokens;
    }
    
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    
    return batches;
}

// ============ Diff Context Extraction ============

/**
 * Extract surrounding context from code given diff line numbers
 */
export function extractSurroundingContext(
    fullContent: string,
    diffLines: number[],
    contextLines: number = 5
): string {
    const lines = fullContent.split('\n');
    const includedLines = new Set<number>();
    
    for (const line of diffLines) {
        const start = Math.max(0, line - contextLines - 1);
        const end = Math.min(lines.length - 1, line + contextLines - 1);
        
        for (let i = start; i <= end; i++) {
            includedLines.add(i);
        }
    }
    
    const sortedLines = Array.from(includedLines).sort((a, b) => a - b);
    const segments: string[] = [];
    let currentSegment: string[] = [];
    let lastLine = -2;
    
    for (const lineNum of sortedLines) {
        if (lineNum - lastLine > 1 && currentSegment.length > 0) {
            segments.push(currentSegment.join('\n'));
            currentSegment = [];
        }
        
        currentSegment.push(`${lineNum + 1}: ${lines[lineNum]}`);
        lastLine = lineNum;
    }
    
    if (currentSegment.length > 0) {
        segments.push(currentSegment.join('\n'));
    }
    
    return segments.join('\n...\n');
}

