import { parse as parseESTree } from '@typescript-eslint/typescript-estree';
import { ParsedContext } from '../types';

let TreeSitterParser: any;
let Python: any;
let C: any;

try {
    TreeSitterParser = require('tree-sitter');
    Python = require('tree-sitter-python');
    C = require('tree-sitter-c');
} catch (e) {
    // Graceful degradation if native modules fail to build/load
    TreeSitterParser = null;
}

export function parseCode(filename: string, snippet: string): ParsedContext {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    let language = 'unknown';
    let astSummary: any = null;

    try {
        if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') {
            language = ext === 'ts' || ext === 'tsx' ? 'typescript' : 'javascript';
            const ast = parseESTree(snippet, { loc: true, range: true });
            astSummary = summarizeESTree(ast);
        } else if (ext === 'py' && TreeSitterParser) {
            language = 'python';
            const parser = new TreeSitterParser();
            parser.setLanguage(Python);
            const tree = parser.parse(snippet);
            astSummary = summarizeTreeSitter(tree.rootNode);
        } else if ((ext === 'c' || ext === 'cpp' || ext === 'h') && TreeSitterParser) {
            language = 'c';
            const parser = new TreeSitterParser();
            parser.setLanguage(C);
            const tree = parser.parse(snippet);
            astSummary = summarizeTreeSitter(tree.rootNode);
        } else {
            language = ext || 'text';
        }
    } catch (error) {
        astSummary = { error: 'Failed to parse AST' };
    }

    return {
        language,
        astSummary,
        rawSnippet: snippet,
        lineMap: {}
    };
}

function summarizeESTree(ast: any): any {
    const summary: any = { functions: [], variables: [], imports: [], blocks: [] };

    const traverse = (node: any) => {
        if (!node || typeof node !== 'object') return;

        if (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression') {
            summary.functions.push({ type: node.type, id: node.id?.name || 'anonymous', async: node.async });
        }
        if (node.type === 'VariableDeclarator') {
            summary.variables.push(node.id?.name);
        }
        if (node.type === 'ImportDeclaration') {
            summary.imports.push(node.source.value);
        }
        if (node.type === 'TryStatement' || node.type === 'IfStatement' || node.type === 'ForStatement' || node.type === 'WhileStatement') {
            summary.blocks.push(node.type);
        }

        for (const key in node) {
            if (node[key] && typeof node[key] === 'object') {
                traverse(node[key]);
            }
        }
    };

    traverse(ast);
    return summary;
}

function summarizeTreeSitter(rootNode: any): any {
    const summary: any = { functions: [], nodes: [] };
    const traverse = (node: any) => {
        if (!node) return;
        if (node.type === 'function_definition' || node.type === 'function_declarator') {
            summary.functions.push(node.text.split('\n')[0]);
        }
        if (['if_statement', 'for_statement', 'while_statement', 'try_statement', 'pointer_expression', 'call_expression'].includes(node.type)) {
            summary.nodes.push(node.type);
        }
        for (let i = 0; i < node.childCount; i++) {
            traverse(node.child(i));
        }
    };
    traverse(rootNode);
    return summary;
}
