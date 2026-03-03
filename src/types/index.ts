export interface ParsedContext {
    language: string;
    astSummary: any;
    rawSnippet: string;
    lineMap: Record<number, number>;
}

export interface Rule {
    id: string;
    description: string;
    languages: string[];
    pattern: (context: ParsedContext) => boolean;
}

export interface Finding {
    ruleId: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    lineStart: number;
    lineEnd: number;
    title: string;
    explanation: string;
    suggestion: string;
}

export interface PRReviewJob {
    owner: string;
    repo: string;
    prNumber: number;
    installationId: number;
}
