import { ParsedContext, Rule } from '../types';

export const rulesRegistry: Rule[] = [
    {
        id: 'MEMORY_LEAK_001',
        description: 'C: malloc without free in same scope',
        languages: ['c', 'cpp'],
        pattern: (ctx) => {
            return ctx.rawSnippet.includes('malloc') && !ctx.rawSnippet.includes('free');
        }
    },
    {
        id: 'RACE_CONDITION_001',
        description: 'JS/TS: shared mutable state accessed in concurrent async functions',
        languages: ['javascript', 'typescript'],
        pattern: (ctx) => {
            return ctx.rawSnippet.includes('Promise.all') && ctx.rawSnippet.includes('=');
        }
    },
    {
        id: 'NULL_DEREF_001',
        description: 'C/Python: pointer/variable used before null check',
        languages: ['c', 'cpp', 'python'],
        pattern: (ctx) => {
            return ctx.rawSnippet.includes('->') || ctx.rawSnippet.includes('None');
        }
    },
    {
        id: 'UNHANDLED_PROMISE_001',
        description: 'JS/TS: async function called without await or .catch()',
        languages: ['javascript', 'typescript'],
        pattern: (ctx) => {
            return ctx.rawSnippet.includes('async') && !ctx.rawSnippet.includes('await') && !ctx.rawSnippet.includes('.catch');
        }
    },
    {
        id: 'RESOURCE_LEAK_001',
        description: 'Python: file/socket opened without context manager or explicit close',
        languages: ['python'],
        pattern: (ctx) => {
            return ctx.rawSnippet.includes('open(') && !ctx.rawSnippet.includes('with open') && !ctx.rawSnippet.includes('.close()');
        }
    },
    {
        id: 'SQL_INJECTION_001',
        description: 'Python/JS: string concatenation used to build SQL queries',
        languages: ['javascript', 'typescript', 'python'],
        pattern: (ctx) => {
            const lower = ctx.rawSnippet.toLowerCase();
            const hasSql = lower.includes('select ') || lower.includes('update ') || lower.includes('insert ');
            const hasConcat = ctx.rawSnippet.includes('+') || ctx.rawSnippet.includes('${');
            return hasSql && hasConcat;
        }
    },
    {
        id: 'IPC_DEADLOCK_001',
        description: 'C: semaphore acquire without matching release path',
        languages: ['c', 'cpp'],
        pattern: (ctx) => {
            return ctx.rawSnippet.includes('sem_wait') && !ctx.rawSnippet.includes('sem_post');
        }
    }
];

export function getTriggeredRules(context: ParsedContext): Rule[] {
    return rulesRegistry.filter(rule =>
        rule.languages.includes(context.language) && rule.pattern(context)
    );
}
