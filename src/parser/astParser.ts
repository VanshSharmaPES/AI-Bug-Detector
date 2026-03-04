import { parse as parseESTree, AST_NODE_TYPES } from '@typescript-eslint/typescript-estree';
import { createHash } from 'crypto';
import {
    ParsedContext,
    ASTSummary,
    FunctionSignature,
    ClassHierarchy,
    VariableScope,
    ImportInfo,
    ControlFlowBranch,
    CallGraphEntry,
    SupportedLanguage,
    LanguageMapping,
} from '../types';

// ============ Language Detection ============

const LANGUAGE_MAPPINGS: LanguageMapping[] = [
    { extensions: ['.js', '.mjs', '.cjs'], language: 'javascript', treeSitterGrammar: 'javascript' },
    { extensions: ['.jsx'], language: 'javascript', treeSitterGrammar: 'javascript' },
    { extensions: ['.ts', '.mts', '.cts'], language: 'typescript', treeSitterGrammar: 'typescript' },
    { extensions: ['.tsx'], language: 'typescript', treeSitterGrammar: 'tsx' },
    { extensions: ['.py', '.pyw', '.pyi'], language: 'python', treeSitterGrammar: 'python' },
    { extensions: ['.c', '.h'], language: 'c', treeSitterGrammar: 'c' },
    { extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh'], language: 'cpp', treeSitterGrammar: 'cpp' },
];

export function detectLanguage(filename: string): SupportedLanguage {
    const ext = '.' + (filename.split('.').pop()?.toLowerCase() || '');
    for (const mapping of LANGUAGE_MAPPINGS) {
        if (mapping.extensions.includes(ext)) {
            return mapping.language;
        }
    }
    return 'unknown';
}

export function getLanguageMapping(filename: string): LanguageMapping | undefined {
    const ext = '.' + (filename.split('.').pop()?.toLowerCase() || '');
    return LANGUAGE_MAPPINGS.find(m => m.extensions.includes(ext));
}

// ============ AST Caching Layer ============

interface CacheEntry {
    parsedContext: ParsedContext;
    timestamp: number;
}

const astCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function getCacheKey(filename: string, content: string): string {
    return `${filename}:${computeHash(content)}`;
}

export function getCachedAST(filename: string, content: string): ParsedContext | null {
    const key = getCacheKey(filename, content);
    const entry = astCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.parsedContext;
    }
    if (entry) {
        astCache.delete(key);
    }
    return null;
}

function cacheAST(filename: string, content: string, parsedContext: ParsedContext): void {
    const key = getCacheKey(filename, content);
    astCache.set(key, { parsedContext, timestamp: Date.now() });
    
    // Cleanup old entries if cache grows too large
    if (astCache.size > 1000) {
        const now = Date.now();
        for (const [k, v] of astCache.entries()) {
            if (now - v.timestamp > CACHE_TTL_MS) {
                astCache.delete(k);
            }
        }
    }
}

export function clearASTCache(): void {
    astCache.clear();
}

export function getASTCacheStats(): { size: number; keys: string[] } {
    return { size: astCache.size, keys: Array.from(astCache.keys()) };
}

// ============ Tree-sitter WASM Support ============

let TreeSitter: any = null;
let treeSitterInitialized = false;
const languageParsers: Map<string, any> = new Map();

async function initTreeSitter(): Promise<boolean> {
    if (treeSitterInitialized) return TreeSitter !== null;
    
    try {
        TreeSitter = await import('web-tree-sitter');
        await TreeSitter.default.init();
        treeSitterInitialized = true;
        return true;
    } catch (error) {
        console.warn('Failed to initialize web-tree-sitter:', error);
        treeSitterInitialized = true;
        TreeSitter = null;
        return false;
    }
}

async function getTreeSitterParser(grammar: string): Promise<any> {
    if (languageParsers.has(grammar)) {
        return languageParsers.get(grammar);
    }
    
    if (!TreeSitter) return null;
    
    try {
        const parser = new TreeSitter.default();
        // Load WASM grammars - paths need to be configured for deployment
        const wasmPath = `node_modules/tree-sitter-${grammar}/tree-sitter-${grammar}.wasm`;
        const Lang = await TreeSitter.default.Language.load(wasmPath);
        parser.setLanguage(Lang);
        languageParsers.set(grammar, parser);
        return parser;
    } catch (error) {
        console.warn(`Failed to load tree-sitter grammar for ${grammar}:`, error);
        return null;
    }
}

// Fallback to native tree-sitter modules
let NativeTreeSitter: any = null;
const nativeLanguages: Record<string, any> = {};

function initNativeTreeSitter(): boolean {
    if (NativeTreeSitter !== null) return true;
    
    try {
        NativeTreeSitter = require('tree-sitter');
        nativeLanguages['python'] = require('tree-sitter-python');
        nativeLanguages['c'] = require('tree-sitter-c');
        nativeLanguages['javascript'] = require('tree-sitter-javascript');
        nativeLanguages['typescript'] = require('tree-sitter-typescript').typescript;
        nativeLanguages['tsx'] = require('tree-sitter-typescript').tsx;
        return true;
    } catch (error) {
        NativeTreeSitter = null;
        return false;
    }
}

function getNativeParser(grammar: string): any {
    if (!NativeTreeSitter || !nativeLanguages[grammar]) return null;
    
    const parser = new NativeTreeSitter();
    parser.setLanguage(nativeLanguages[grammar]);
    return parser;
}

// ============ Main Parse Function ============

export async function parseCodeAsync(filename: string, snippet: string): Promise<ParsedContext> {
    // Check cache first
    const cached = getCachedAST(filename, snippet);
    if (cached) return cached;
    
    const language = detectLanguage(filename);
    const hash = computeHash(snippet);
    
    let astSummary: ASTSummary | null = null;
    let parseError: string | undefined;
    
    try {
        if (language === 'javascript' || language === 'typescript') {
            astSummary = parseWithESTree(snippet, language);
        } else if (language === 'python' || language === 'c' || language === 'cpp') {
            astSummary = await parseWithTreeSitter(snippet, language);
        }
    } catch (error) {
        parseError = error instanceof Error ? error.message : 'Unknown parse error';
    }
    
    const result: ParsedContext = {
        language,
        filename,
        astSummary,
        rawSnippet: snippet,
        lineMap: buildLineMap(snippet),
        parseError,
        hash,
    };
    
    cacheAST(filename, snippet, result);
    return result;
}

// Synchronous version for backward compatibility
export function parseCode(filename: string, snippet: string): ParsedContext {
    const cached = getCachedAST(filename, snippet);
    if (cached) return cached;
    
    const language = detectLanguage(filename);
    const hash = computeHash(snippet);
    
    let astSummary: ASTSummary | null = null;
    let parseError: string | undefined;
    
    try {
        if (language === 'javascript' || language === 'typescript') {
            astSummary = parseWithESTree(snippet, language);
        } else if (language === 'python' || language === 'c' || language === 'cpp') {
            astSummary = parseWithNativeTreeSitter(snippet, language);
        }
    } catch (error) {
        parseError = error instanceof Error ? error.message : 'Unknown parse error';
    }
    
    const result: ParsedContext = {
        language,
        filename,
        astSummary,
        rawSnippet: snippet,
        lineMap: buildLineMap(snippet),
        parseError,
        hash,
    };
    
    cacheAST(filename, snippet, result);
    return result;
}

function buildLineMap(content: string): Record<number, number> {
    const lineMap: Record<number, number> = {};
    let offset = 0;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        lineMap[i + 1] = offset;
        offset += lines[i].length + 1;
    }
    return lineMap;
}

// ============ ESTree Parser (JS/TS) ============

function parseWithESTree(code: string, language: SupportedLanguage): ASTSummary {
    const isTypescript = language === 'typescript';
    const ast = parseESTree(code, {
        loc: true,
        range: true,
        jsx: true,
        ...(isTypescript && { 
            // TypeScript-specific options handled automatically
        }),
    });
    
    return extractESTreeSummary(ast, code);
}

function extractESTreeSummary(ast: any, code: string): ASTSummary {
    const summary: ASTSummary = {
        functions: [],
        classes: [],
        variables: [],
        imports: [],
        controlFlow: [],
        callGraph: [],
        nodeCount: 0,
        maxDepth: 0,
        complexity: 1, // Base complexity
    };
    
    let currentFunction = 'global';
    let depth = 0;
    
    const traverse = (node: any, scope: string = 'global', parentFunc: string = 'global') => {
        if (!node || typeof node !== 'object') return;
        
        summary.nodeCount++;
        depth++;
        if (depth > summary.maxDepth) summary.maxDepth = depth;
        
        // Functions
        if (node.type === 'FunctionDeclaration' || 
            node.type === 'FunctionExpression' || 
            node.type === 'ArrowFunctionExpression') {
            const funcName = node.id?.name || 
                            (node.parent?.type === 'VariableDeclarator' ? node.parent.id?.name : null) ||
                            `anonymous_${node.loc?.start?.line || 0}`;
            
            const funcSig: FunctionSignature = {
                name: funcName,
                params: extractParams(node.params),
                returnType: node.returnType?.typeAnnotation?.type,
                async: node.async || false,
                generator: node.generator || false,
                line: node.loc?.start?.line || 0,
                endLine: node.loc?.end?.line,
            };
            summary.functions.push(funcSig);
            currentFunction = funcName;
            
            // Increment complexity for functions
            summary.complexity += 1;
        }
        
        // Classes
        if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
            const classInfo: ClassHierarchy = {
                name: node.id?.name || `anonymous_class_${node.loc?.start?.line}`,
                extends: node.superClass?.name,
                implements: node.implements?.map((i: any) => i.expression?.name).filter(Boolean) || [],
                methods: [],
                properties: [],
                line: node.loc?.start?.line || 0,
            };
            
            // Extract class body
            if (node.body?.body) {
                for (const member of node.body.body) {
                    if (member.type === 'MethodDefinition') {
                        classInfo.methods.push(member.key?.name || 'unknown');
                    } else if (member.type === 'PropertyDefinition') {
                        classInfo.properties.push(member.key?.name || 'unknown');
                    }
                }
            }
            summary.classes.push(classInfo);
        }
        
        // Variables
        if (node.type === 'VariableDeclarator') {
            const variable: VariableScope = {
                name: node.id?.name || 'unknown',
                kind: (node.parent?.kind as 'var' | 'let' | 'const') || 'var',
                type: node.id?.typeAnnotation?.typeAnnotation?.type,
                line: node.loc?.start?.line || 0,
                scope,
            };
            summary.variables.push(variable);
        }
        
        // Imports
        if (node.type === 'ImportDeclaration') {
            const importInfo: ImportInfo = {
                source: node.source?.value || '',
                specifiers: node.specifiers?.map((s: any) => s.local?.name || s.imported?.name).filter(Boolean) || [],
                isDefault: node.specifiers?.some((s: any) => s.type === 'ImportDefaultSpecifier') || false,
                isNamespace: node.specifiers?.some((s: any) => s.type === 'ImportNamespaceSpecifier') || false,
                line: node.loc?.start?.line || 0,
            };
            summary.imports.push(importInfo);
        }
        
        // Control flow
        if (node.type === 'IfStatement') {
            summary.controlFlow.push({
                type: 'if',
                line: node.loc?.start?.line || 0,
                hasReturn: containsReturn(node.consequent),
                hasBreak: containsBreak(node.consequent),
                hasContinue: containsContinue(node.consequent),
            });
            summary.complexity += 1;
        }
        
        if (node.type === 'ForStatement' || node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
            summary.controlFlow.push({
                type: 'for',
                line: node.loc?.start?.line || 0,
                hasReturn: containsReturn(node.body),
                hasBreak: containsBreak(node.body),
                hasContinue: containsContinue(node.body),
            });
            summary.complexity += 1;
        }
        
        if (node.type === 'WhileStatement') {
            summary.controlFlow.push({
                type: 'while',
                line: node.loc?.start?.line || 0,
                hasReturn: containsReturn(node.body),
                hasBreak: containsBreak(node.body),
                hasContinue: containsContinue(node.body),
            });
            summary.complexity += 1;
        }
        
        if (node.type === 'DoWhileStatement') {
            summary.controlFlow.push({
                type: 'do-while',
                line: node.loc?.start?.line || 0,
                hasReturn: containsReturn(node.body),
                hasBreak: containsBreak(node.body),
                hasContinue: containsContinue(node.body),
            });
            summary.complexity += 1;
        }
        
        if (node.type === 'SwitchStatement') {
            summary.controlFlow.push({
                type: 'switch',
                line: node.loc?.start?.line || 0,
                hasReturn: false,
                hasBreak: false,
                hasContinue: false,
            });
            summary.complexity += node.cases?.length || 1;
        }
        
        if (node.type === 'TryStatement') {
            summary.controlFlow.push({
                type: 'try',
                line: node.loc?.start?.line || 0,
                hasReturn: containsReturn(node.block),
                hasBreak: false,
                hasContinue: false,
            });
        }
        
        if (node.type === 'CatchClause') {
            summary.controlFlow.push({
                type: 'catch',
                line: node.loc?.start?.line || 0,
                hasReturn: containsReturn(node.body),
                hasBreak: false,
                hasContinue: false,
            });
            summary.complexity += 1;
        }
        
        // Call graph
        if (node.type === 'CallExpression') {
            const callee = getCalleeName(node.callee);
            if (callee) {
                summary.callGraph.push({
                    caller: currentFunction,
                    callee,
                    line: node.loc?.start?.line || 0,
                    isAsync: node.parent?.type === 'AwaitExpression',
                });
            }
        }
        
        // Logical operators increase complexity
        if (node.type === 'LogicalExpression') {
            summary.complexity += 1;
        }
        
        // Conditional expression
        if (node.type === 'ConditionalExpression') {
            summary.complexity += 1;
        }
        
        // Traverse children
        for (const key in node) {
            if (key === 'parent') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && item.type) {
                        item.parent = node;
                        traverse(item, scope, currentFunction);
                    }
                }
            } else if (child && typeof child === 'object' && child.type) {
                child.parent = node;
                traverse(child, scope, currentFunction);
            }
        }
        
        depth--;
    };
    
    traverse(ast);
    return summary;
}

function extractParams(params: any[]): string[] {
    return params?.map(p => {
        if (p.type === 'Identifier') return p.name;
        if (p.type === 'AssignmentPattern') return p.left?.name || 'unknown';
        if (p.type === 'RestElement') return `...${p.argument?.name || 'rest'}`;
        return 'unknown';
    }) || [];
}

function getCalleeName(callee: any): string | null {
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') {
        const obj = callee.object?.name || callee.object?.type;
        const prop = callee.property?.name || callee.property?.value;
        return `${obj}.${prop}`;
    }
    return null;
}

function containsReturn(node: any): boolean {
    if (!node) return false;
    if (node.type === 'ReturnStatement') return true;
    for (const key in node) {
        if (key === 'parent') continue;
        const child = node[key];
        if (Array.isArray(child)) {
            if (child.some(c => containsReturn(c))) return true;
        } else if (child && typeof child === 'object') {
            if (containsReturn(child)) return true;
        }
    }
    return false;
}

function containsBreak(node: any): boolean {
    if (!node) return false;
    if (node.type === 'BreakStatement') return true;
    for (const key in node) {
        if (key === 'parent') continue;
        const child = node[key];
        if (Array.isArray(child)) {
            if (child.some(c => containsBreak(c))) return true;
        } else if (child && typeof child === 'object') {
            if (containsBreak(child)) return true;
        }
    }
    return false;
}

function containsContinue(node: any): boolean {
    if (!node) return false;
    if (node.type === 'ContinueStatement') return true;
    for (const key in node) {
        if (key === 'parent') continue;
        const child = node[key];
        if (Array.isArray(child)) {
            if (child.some(c => containsContinue(c))) return true;
        } else if (child && typeof child === 'object') {
            if (containsContinue(child)) return true;
        }
    }
    return false;
}

// ============ Tree-sitter Parser (Python/C/C++) ============

async function parseWithTreeSitter(code: string, language: SupportedLanguage): Promise<ASTSummary | null> {
    const grammarMap: Record<string, string> = {
        'python': 'python',
        'c': 'c',
        'cpp': 'cpp',
    };
    
    const grammar = grammarMap[language];
    if (!grammar) return null;
    
    await initTreeSitter();
    const parser = await getTreeSitterParser(grammar);
    
    if (!parser) {
        // Fallback to native
        return parseWithNativeTreeSitter(code, language);
    }
    
    const tree = parser.parse(code);
    return extractTreeSitterSummary(tree.rootNode, language, code);
}

function parseWithNativeTreeSitter(code: string, language: SupportedLanguage): ASTSummary | null {
    const grammarMap: Record<string, string> = {
        'python': 'python',
        'c': 'c',
        'cpp': 'c', // Use C grammar for C++
    };
    
    const grammar = grammarMap[language];
    if (!grammar) return null;
    
    initNativeTreeSitter();
    const parser = getNativeParser(grammar);
    
    if (!parser) return null;
    
    const tree = parser.parse(code);
    return extractTreeSitterSummary(tree.rootNode, language, code);
}

function extractTreeSitterSummary(rootNode: any, language: SupportedLanguage, code: string): ASTSummary {
    const summary: ASTSummary = {
        functions: [],
        classes: [],
        variables: [],
        imports: [],
        controlFlow: [],
        callGraph: [],
        nodeCount: 0,
        maxDepth: 0,
        complexity: 1,
    };
    
    let currentFunction = 'global';
    let depth = 0;
    
    const traverse = (node: any) => {
        if (!node) return;
        
        summary.nodeCount++;
        depth++;
        if (depth > summary.maxDepth) summary.maxDepth = depth;
        
        const nodeType = node.type;
        const startLine = (node.startPosition?.row ?? 0) + 1;
        const endLine = (node.endPosition?.row ?? 0) + 1;
        
        // Python-specific handling
        if (language === 'python') {
            if (nodeType === 'function_definition') {
                const nameNode = node.childForFieldName?.('name') || findChildByType(node, 'identifier');
                const funcName = nameNode?.text || 'anonymous';
                const params = extractPythonParams(node);
                
                summary.functions.push({
                    name: funcName,
                    params,
                    async: node.text?.startsWith('async'),
                    generator: node.text?.includes('yield'),
                    line: startLine,
                    endLine,
                });
                currentFunction = funcName;
                summary.complexity += 1;
            }
            
            if (nodeType === 'class_definition') {
                const nameNode = node.childForFieldName?.('name') || findChildByType(node, 'identifier');
                const className = nameNode?.text || 'anonymous';
                
                summary.classes.push({
                    name: className,
                    extends: extractPythonSuperclass(node),
                    methods: [],
                    properties: [],
                    line: startLine,
                });
            }
            
            if (nodeType === 'import_statement' || nodeType === 'import_from_statement') {
                summary.imports.push({
                    source: extractPythonImportSource(node),
                    specifiers: extractPythonImportNames(node),
                    isDefault: false,
                    isNamespace: nodeType === 'import_statement',
                    line: startLine,
                });
            }
        }
        
        // C/C++ specific handling
        if (language === 'c' || language === 'cpp') {
            if (nodeType === 'function_definition' || nodeType === 'function_declarator') {
                const declarator = nodeType === 'function_definition' 
                    ? findChildByType(node, 'function_declarator') 
                    : node;
                const nameNode = declarator ? findChildByType(declarator, 'identifier') : null;
                const funcName = nameNode?.text || 'anonymous';
                
                summary.functions.push({
                    name: funcName,
                    params: extractCParams(declarator),
                    async: false,
                    generator: false,
                    line: startLine,
                    endLine,
                });
                currentFunction = funcName;
                summary.complexity += 1;
            }
            
            if (nodeType === 'struct_specifier' || nodeType === 'class_specifier') {
                const nameNode = findChildByType(node, 'type_identifier');
                summary.classes.push({
                    name: nameNode?.text || 'anonymous',
                    methods: [],
                    properties: [],
                    line: startLine,
                });
            }
            
            if (nodeType === 'preproc_include') {
                const pathNode = findChildByType(node, 'string_literal') || findChildByType(node, 'system_lib_string');
                summary.imports.push({
                    source: pathNode?.text?.replace(/[<>"]/g, '') || '',
                    specifiers: [],
                    isDefault: false,
                    isNamespace: true,
                    line: startLine,
                });
            }
        }
        
        // Common control flow detection
        if (['if_statement', 'elif_clause'].includes(nodeType)) {
            summary.controlFlow.push({
                type: 'if',
                line: startLine,
                hasReturn: nodeContains(node, ['return_statement']),
                hasBreak: nodeContains(node, ['break_statement']),
                hasContinue: nodeContains(node, ['continue_statement']),
            });
            summary.complexity += 1;
        }
        
        if (['for_statement', 'for_in_clause'].includes(nodeType)) {
            summary.controlFlow.push({
                type: 'for',
                line: startLine,
                hasReturn: nodeContains(node, ['return_statement']),
                hasBreak: nodeContains(node, ['break_statement']),
                hasContinue: nodeContains(node, ['continue_statement']),
            });
            summary.complexity += 1;
        }
        
        if (nodeType === 'while_statement') {
            summary.controlFlow.push({
                type: 'while',
                line: startLine,
                hasReturn: nodeContains(node, ['return_statement']),
                hasBreak: nodeContains(node, ['break_statement']),
                hasContinue: nodeContains(node, ['continue_statement']),
            });
            summary.complexity += 1;
        }
        
        if (nodeType === 'try_statement') {
            summary.controlFlow.push({
                type: 'try',
                line: startLine,
                hasReturn: nodeContains(node, ['return_statement']),
                hasBreak: false,
                hasContinue: false,
            });
        }
        
        if (['except_clause', 'catch_clause'].includes(nodeType)) {
            summary.controlFlow.push({
                type: 'catch',
                line: startLine,
                hasReturn: nodeContains(node, ['return_statement']),
                hasBreak: false,
                hasContinue: false,
            });
            summary.complexity += 1;
        }
        
        if (['switch_statement', 'match_statement'].includes(nodeType)) {
            summary.controlFlow.push({
                type: 'switch',
                line: startLine,
                hasReturn: false,
                hasBreak: false,
                hasContinue: false,
            });
            summary.complexity += 2;
        }
        
        // Call expressions for call graph
        if (nodeType === 'call_expression' || nodeType === 'call') {
            const funcNode = findChildByType(node, 'identifier') || 
                            findChildByType(node, 'attribute') ||
                            findChildByType(node, 'field_expression');
            const callee = funcNode?.text?.split('(')[0] || 'unknown';
            
            summary.callGraph.push({
                caller: currentFunction,
                callee,
                line: startLine,
                isAsync: false,
            });
        }
        
        // Traverse children
        for (let i = 0; i < (node.childCount || 0); i++) {
            traverse(node.child(i));
        }
        
        depth--;
    };
    
    traverse(rootNode);
    return summary;
}

// ============ Helper Functions for Tree-sitter ============

function findChildByType(node: any, type: string): any {
    if (!node) return null;
    for (let i = 0; i < (node.childCount || 0); i++) {
        const child = node.child(i);
        if (child?.type === type) return child;
    }
    return null;
}

function nodeContains(node: any, types: string[]): boolean {
    if (!node) return false;
    if (types.includes(node.type)) return true;
    for (let i = 0; i < (node.childCount || 0); i++) {
        if (nodeContains(node.child(i), types)) return true;
    }
    return false;
}

function extractPythonParams(funcNode: any): string[] {
    const params: string[] = [];
    const paramsNode = findChildByType(funcNode, 'parameters');
    if (paramsNode) {
        for (let i = 0; i < paramsNode.childCount; i++) {
            const param = paramsNode.child(i);
            if (param?.type === 'identifier' || param?.type === 'typed_parameter') {
                const nameNode = param.type === 'typed_parameter' 
                    ? findChildByType(param, 'identifier') 
                    : param;
                if (nameNode?.text) params.push(nameNode.text);
            }
        }
    }
    return params;
}

function extractPythonSuperclass(classNode: any): string | undefined {
    const argList = findChildByType(classNode, 'argument_list');
    if (argList) {
        const firstArg = findChildByType(argList, 'identifier');
        return firstArg?.text;
    }
    return undefined;
}

function extractPythonImportSource(node: any): string {
    const moduleNode = findChildByType(node, 'dotted_name');
    return moduleNode?.text || '';
}

function extractPythonImportNames(node: any): string[] {
    const names: string[] = [];
    const traverse = (n: any) => {
        if (!n) return;
        if (n.type === 'aliased_import' || n.type === 'dotted_name') {
            const nameNode = findChildByType(n, 'identifier') || n;
            if (nameNode?.text) names.push(nameNode.text);
        }
        for (let i = 0; i < (n.childCount || 0); i++) {
            traverse(n.child(i));
        }
    };
    traverse(node);
    return names;
}

function extractCParams(declarator: any): string[] {
    const params: string[] = [];
    const paramList = findChildByType(declarator, 'parameter_list');
    if (paramList) {
        for (let i = 0; i < paramList.childCount; i++) {
            const param = paramList.child(i);
            if (param?.type === 'parameter_declaration') {
                const nameNode = findChildByType(param, 'identifier');
                if (nameNode?.text) params.push(nameNode.text);
            }
        }
    }
    return params;
}

// ============ AST Summarizer for LLM ============

export interface LLMReadyAST {
    language: string;
    summary: string;
    functions: { name: string; signature: string; line: number }[];
    classes: { name: string; members: string; line: number }[];
    imports: string[];
    controlFlowSummary: string;
    complexity: number;
    callGraphText: string;
}

export function summarizeASTForLLM(parsedContext: ParsedContext): LLMReadyAST {
    const { language, astSummary } = parsedContext;
    
    if (!astSummary) {
        return {
            language,
            summary: 'Unable to parse AST',
            functions: [],
            classes: [],
            imports: [],
            controlFlowSummary: 'Unknown',
            complexity: 0,
            callGraphText: '',
        };
    }
    
    const functions = astSummary.functions.map(f => ({
        name: f.name,
        signature: `${f.async ? 'async ' : ''}${f.name}(${f.params.join(', ')})${f.returnType ? `: ${f.returnType}` : ''}`,
        line: f.line,
    }));
    
    const classes = astSummary.classes.map(c => ({
        name: c.name,
        members: `extends: ${c.extends || 'none'}, methods: [${c.methods.join(', ')}], props: [${c.properties.join(', ')}]`,
        line: c.line,
    }));
    
    const imports = astSummary.imports.map(i => i.source);
    
    const cfCounts: Record<string, number> = {};
    for (const cf of astSummary.controlFlow) {
        cfCounts[cf.type] = (cfCounts[cf.type] || 0) + 1;
    }
    const controlFlowSummary = Object.entries(cfCounts)
        .map(([type, count]) => `${count} ${type}`)
        .join(', ') || 'none';
    
    // Build call graph text
    const callsByFunction: Record<string, string[]> = {};
    for (const call of astSummary.callGraph) {
        if (!callsByFunction[call.caller]) callsByFunction[call.caller] = [];
        callsByFunction[call.caller].push(call.callee);
    }
    const callGraphText = Object.entries(callsByFunction)
        .map(([caller, callees]) => `${caller} -> [${[...new Set(callees)].join(', ')}]`)
        .join('; ');
    
    const summary = [
        `Language: ${language}`,
        `Functions: ${functions.length}`,
        `Classes: ${classes.length}`,
        `Imports: ${imports.length}`,
        `Cyclomatic Complexity: ${astSummary.complexity}`,
        `Max Nesting Depth: ${astSummary.maxDepth}`,
        `Total AST Nodes: ${astSummary.nodeCount}`,
    ].join(', ');
    
    return {
        language,
        summary,
        functions,
        classes,
        imports,
        controlFlowSummary,
        complexity: astSummary.complexity,
        callGraphText,
    };
}

// ============ Batch Parsing ============

export async function parseFilesInParallel(
    files: { filename: string; content: string }[]
): Promise<Map<string, ParsedContext>> {
    const results = new Map<string, ParsedContext>();
    
    // First, check cache and separate cached from uncached
    const uncached: { filename: string; content: string }[] = [];
    for (const file of files) {
        const cached = getCachedAST(file.filename, file.content);
        if (cached) {
            results.set(file.filename, cached);
        } else {
            uncached.push(file);
        }
    }
    
    // Parse uncached files in parallel
    const parsePromises = uncached.map(async file => {
        const parsed = await parseCodeAsync(file.filename, file.content);
        return { filename: file.filename, parsed };
    });
    
    const parsed = await Promise.all(parsePromises);
    for (const { filename, parsed: context } of parsed) {
        results.set(filename, context);
    }
    
    return results;
}
