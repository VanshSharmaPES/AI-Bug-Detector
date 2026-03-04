// ============ AST & Parsing Types ============

export interface FunctionSignature {
    name: string;
    params: string[];
    returnType?: string;
    async: boolean;
    generator: boolean;
    line: number;
    endLine?: number;
}

export interface ClassHierarchy {
    name: string;
    extends?: string;
    implements?: string[];
    methods: string[];
    properties: string[];
    line: number;
}

export interface VariableScope {
    name: string;
    kind: 'var' | 'let' | 'const' | 'parameter' | 'function' | 'class';
    type?: string;
    line: number;
    scope: string;
}

export interface ImportInfo {
    source: string;
    specifiers: string[];
    isDefault: boolean;
    isNamespace: boolean;
    line: number;
}

export interface ControlFlowBranch {
    type: 'if' | 'else' | 'switch' | 'case' | 'for' | 'while' | 'do-while' | 'try' | 'catch' | 'finally';
    line: number;
    hasReturn: boolean;
    hasBreak: boolean;
    hasContinue: boolean;
}

export interface CallGraphEntry {
    caller: string;
    callee: string;
    line: number;
    isAsync: boolean;
}

export interface ASTSummary {
    functions: FunctionSignature[];
    classes: ClassHierarchy[];
    variables: VariableScope[];
    imports: ImportInfo[];
    controlFlow: ControlFlowBranch[];
    callGraph: CallGraphEntry[];
    nodeCount: number;
    maxDepth: number;
    complexity: number;
}

export interface ParsedContext {
    language: string;
    filename: string;
    astSummary: ASTSummary | null;
    rawSnippet: string;
    lineMap: Record<number, number>;
    parseError?: string;
    hash: string;
}

export type SupportedLanguage = 'javascript' | 'typescript' | 'python' | 'c' | 'cpp' | 'unknown';

export interface LanguageMapping {
    extensions: string[];
    language: SupportedLanguage;
    treeSitterGrammar?: string;
}

// ============ Rule Engine Types ============

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ASTNode {
    type: string;
    text?: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    children?: ASTNode[];
    parent?: ASTNode;
}

export interface CodeContext {
    parsedContext: ParsedContext;
    fileContent: string;
    diffLines?: number[];
    surroundingLines: number;
}

export interface RuleMatch {
    ruleId: string;
    line: number;
    endLine?: number;
    column?: number;
    endColumn?: number;
    matchedText: string;
    context: string;
    metadata?: Record<string, unknown>;
}

export interface Rule {
    id: string;
    name: string;
    severity: RuleSeverity;
    languages: SupportedLanguage[];
    description: string;
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[];
}

export interface RuleConfig {
    enabled: boolean;
    severity?: RuleSeverity;
    options?: Record<string, unknown>;
}

export interface RepoConfig {
    enabled: boolean;
    ignorePaths: string[];
    rules: Record<string, RuleConfig>;
    ai: {
        minConfidence: number;
        maxFindingsPerFile: number;
    };
    review: {
        postSummary: boolean;
        createCheckRun: boolean;
    };
}

// ============ Findings Types ============

export interface Finding {
    ruleId: string;
    severity: RuleSeverity;
    lineStart: number;
    lineEnd: number;
    column?: number;
    title: string;
    explanation: string;
    suggestion: string;
    confidence: number;
    source: 'static' | 'ai' | 'merged';
    file: string;
}

export interface RuleMetadata {
    id: string;
    name: string;
    description: string;
    severity: RuleSeverity;
    languages: SupportedLanguage[];
    category: string;
    examples?: {
        bad: string;
        good: string;
    };
}

export interface RuleRegistryStats {
    totalRules: number;
    bySeverity: Record<RuleSeverity, number>;
    byLanguage: Record<SupportedLanguage, number>;
    byCategory: Record<string, number>;
}

// ============ Job & PR Types ============

export interface PRReviewJob {
    owner: string;
    repo: string;
    prNumber: number;
    installationId: number;
}

export interface DiffFile {
    filename: string;
    status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';
    patch?: string;
    additions: number;
    deletions: number;
    changes: number;
}

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    content: string;
}

export interface PullRequestPayload {
    action: string;
    number: number;
    pull_request: {
        number: number;
        title: string;
        head: { sha: string; ref: string };
        base: { sha: string; ref: string };
    };
    repository: {
        owner: { login: string };
        name: string;
        full_name: string;
    };
    installation?: { id: number };
}

export interface AnalysisResult {
    findings: Finding[];
    stats: {
        filesAnalyzed: number;
        totalFindings: number;
        bySeverity: Record<RuleSeverity, number>;
        processingTimeMs: number;
    };
}
