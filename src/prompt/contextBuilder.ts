import { ParsedContext, Rule } from '../types';

export function buildSystemPrompt(): string {
    return `You are an expert strict code security and logic reviewer.
Your task is to analyze the provided code change (diff) and identify only HIGH-CONFIDENCE bugs (>= 85% certainty).
You must always cite specific line numbers that contain the issue.
Do not flag stylistic issues or nitpicks, only flag real bugs, security vulnerabilities, or logic errors.

OUTPUT FORMAT:
You must STRICTLY return a JSON array of findings. Do not include any text outside the JSON array.
If there are no findings, return an empty array: []

Format each finding exactly as:
{
  "ruleId": "ID_OF_RULE_OR_CUSTOM",
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "lineStart": number,
  "lineEnd": number,
  "title": "Short title of the issue",
  "explanation": "Detailed explanation of why this is a bug",
  "suggestion": "How to fix the issue"
}
`;
}

export function buildUserPrompt(
    filename: string,
    language: string,
    rawDiff: string,
    astSummary: any,
    triggeredRules: Rule[]
): string {
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
