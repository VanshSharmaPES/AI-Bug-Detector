import {
    Rule,
    RuleMatch,
    RuleSeverity,
    SupportedLanguage,
    ASTNode,
    CodeContext,
    Finding,
    RuleConfig,
    RepoConfig,
} from '../types';

// ============ Rule Implementations ============

/**
 * Rule 1: Memory Leak Detection (MEM_LEAK)
 * Detects unfreed allocations in C/C++ (malloc/new without corresponding free/delete)
 */
export const memoryLeakRule: Rule = {
    id: 'MEM_LEAK',
    name: 'Memory Leak Detection',
    severity: 'critical',
    languages: ['c', 'cpp'],
    description: 'Detects unfreed allocations in C/C++ (malloc/new without corresponding free/delete)',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        
        // Track allocations
        const allocPatterns = [
            /\b(malloc|calloc|realloc)\s*\(/g,
            /\bnew\s+\w+/g,
            /\bnew\s*\[\s*\d*\s*\]/g,
        ];
        
        const freePatterns = [
            /\bfree\s*\(/g,
            /\bdelete\s+/g,
            /\bdelete\s*\[\s*\]/g,
        ];
        
        let allocCount = 0;
        let freeCount = 0;
        const allocLines: number[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            for (const pattern of allocPatterns) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    allocCount++;
                    allocLines.push(i + 1);
                }
            }
            for (const pattern of freePatterns) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    freeCount++;
                }
            }
        }
        
        // If there are more allocations than frees, potential memory leak
        if (allocCount > freeCount && allocLines.length > 0) {
            for (const line of allocLines) {
                matches.push({
                    ruleId: 'MEM_LEAK',
                    line,
                    matchedText: lines[line - 1]?.trim() || '',
                    context: `Found memory allocation without corresponding deallocation. Allocations: ${allocCount}, Deallocations: ${freeCount}`,
                });
            }
        }
        
        return matches;
    },
};

/**
 * Rule 2: Race Condition Detection (RACE_COND)
 * Identifies shared mutable state accessed across async boundaries without synchronization
 */
export const raceConditionRule: Rule = {
    id: 'RACE_COND',
    name: 'Race Condition Detection',
    severity: 'high',
    languages: ['javascript', 'typescript'],
    description: 'Detects shared mutable state accessed across async boundaries without synchronization',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        
        // Look for patterns that suggest race conditions
        const patterns = [
            // Promise.all with shared state modification
            { regex: /Promise\.all\s*\(\s*\[[\s\S]*?\]\s*\)/g, context: 'Promise.all with potential shared state' },
            // Multiple await in sequence modifying same variable
            { regex: /let\s+(\w+)[\s\S]*?await[\s\S]*?\1\s*=/g, context: 'Variable modified after await' },
            // Parallel async operations without mutex/lock
            { regex: /\.map\s*\(\s*async/g, context: 'Parallel async operations in map' },
        ];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for Promise.all with modifications inside
            if (/Promise\.all/.test(line)) {
                // Look for assignment operators within the surrounding context
                const surroundingCode = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join('\n');
                if (/\w+\s*[+\-*\/]?=/.test(surroundingCode) && !/const\s+\w+\s*=/.test(line)) {
                    matches.push({
                        ruleId: 'RACE_COND',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Promise.all with shared state modification detected. Consider using mutex or atomic operations.',
                    });
                }
            }
            
            // Check for async callbacks that modify outer scope
            if (/\.map\s*\(\s*async/.test(line) || /\.forEach\s*\(\s*async/.test(line)) {
                matches.push({
                    ruleId: 'RACE_COND',
                    line: i + 1,
                    matchedText: line.trim(),
                    context: 'Parallel async operations detected. If shared state is modified, this may cause race conditions.',
                });
            }
        }
        
        return matches;
    },
};

/**
 * Rule 3: Null/Undefined Dereference (NULL_DEREF)
 * Detects property access on potentially null/undefined values without guards
 */
export const nullDerefRule: Rule = {
    id: 'NULL_DEREF',
    name: 'Null/Undefined Dereference',
    severity: 'high',
    languages: ['javascript', 'typescript', 'c', 'cpp', 'python'],
    description: 'Detects property access on potentially null/undefined values without guards',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        const language = context.parsedContext.language;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (language === 'javascript' || language === 'typescript') {
                // Variables that might be null/undefined being accessed
                // Pattern: possible null assignment followed by property access
                if (/\w+\s*=\s*(null|undefined|.*\?\s*.*:.*null)/.test(line)) {
                    const varMatch = line.match(/(\w+)\s*=\s*(null|undefined)/);
                    if (varMatch) {
                        const varName = varMatch[1];
                        // Check following lines for unsafe access
                        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                            const nextLine = lines[j];
                            // Check if accessing without null check
                            const accessPattern = new RegExp(`${varName}\\s*\\.\\s*\\w+`);
                            const guardPattern = new RegExp(`(if\\s*\\(\\s*${varName}|${varName}\\s*\\?\\.|${varName}\\s*&&|${varName}\\s*!==?\\s*(null|undefined))`);
                            
                            if (accessPattern.test(nextLine) && !guardPattern.test(lines.slice(i, j + 1).join('\n'))) {
                                matches.push({
                                    ruleId: 'NULL_DEREF',
                                    line: j + 1,
                                    matchedText: nextLine.trim(),
                                    context: `Potential null/undefined dereference of '${varName}'. Consider adding null check or using optional chaining (?.)`,
                                });
                            }
                        }
                    }
                }
                
                // Direct access on find/querySelector result (often null)
                if (/\.(find|querySelector|getElementById)\s*\([^)]*\)\s*\./.test(line) && !/\?\s*\./.test(line)) {
                    matches.push({
                        ruleId: 'NULL_DEREF',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Direct property access on method that may return null. Use optional chaining (?.) or null check.',
                    });
                }
            }
            
            if (language === 'c' || language === 'cpp') {
                // Pointer dereference without null check
                if (/\*\s*\w+\s*=/.test(line) || /->\s*\w+/.test(line)) {
                    // Look back for null check
                    const prevLines = lines.slice(Math.max(0, i - 5), i).join('\n');
                    const ptrMatch = line.match(/\*?\s*(\w+)\s*->/);
                    if (ptrMatch) {
                        const ptrName = ptrMatch[1];
                        if (!new RegExp(`if\\s*\\(\\s*${ptrName}\\s*(!=|==)\\s*(NULL|nullptr|0)`).test(prevLines)) {
                            matches.push({
                                ruleId: 'NULL_DEREF',
                                line: i + 1,
                                matchedText: line.trim(),
                                context: `Potential null pointer dereference of '${ptrName}'. Consider adding null check.`,
                            });
                        }
                    }
                }
            }
            
            if (language === 'python') {
                // Access on variable that might be None
                if (/=\s*None/.test(line)) {
                    const varMatch = line.match(/(\w+)\s*=\s*None/);
                    if (varMatch) {
                        const varName = varMatch[1];
                        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                            const nextLine = lines[j];
                            const accessPattern = new RegExp(`${varName}\\s*\\.\\s*\\w+`);
                            const guardPattern = new RegExp(`if\\s+${varName}(\\s+is\\s+not\\s+None)?:`);
                            
                            if (accessPattern.test(nextLine) && !guardPattern.test(lines.slice(i, j + 1).join('\n'))) {
                                matches.push({
                                    ruleId: 'NULL_DEREF',
                                    line: j + 1,
                                    matchedText: nextLine.trim(),
                                    context: `Potential None dereference of '${varName}'. Consider adding 'if ${varName} is not None' check.`,
                                });
                            }
                        }
                    }
                }
            }
        }
        
        return matches;
    },
};

/**
 * Rule 4: SQL Injection (SQL_INJ)
 * Flags raw string concatenation in SQL query construction
 */
export const sqlInjectionRule: Rule = {
    id: 'SQL_INJ',
    name: 'SQL Injection',
    severity: 'critical',
    languages: ['javascript', 'typescript', 'python'],
    description: 'Detects raw string concatenation in SQL query construction',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        
        const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE'];
        const sqlPattern = new RegExp(`(${sqlKeywords.join('|')})\\s+`, 'i');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            if (sqlPattern.test(line)) {
                // Check for string concatenation with variables
                const hasConcatenation = /\+\s*\w+|\$\{[^}]+\}|%s|%d|\{\s*\w+\s*\}|f["'].*\{/.test(line);
                const hasParameterized = /\?\s*,|\$\d+|:\w+|%\(\w+\)s/.test(line);
                
                if (hasConcatenation && !hasParameterized) {
                    matches.push({
                        ruleId: 'SQL_INJ',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'SQL query constructed with string concatenation. Use parameterized queries instead.',
                    });
                }
            }
            
            // Check for raw query methods with string interpolation
            if (/\.(query|execute|raw)\s*\(\s*[`'"]/.test(line)) {
                const hasInterpolation = /\$\{|\+ *\w+|\+ *['"]/.test(line);
                if (hasInterpolation) {
                    matches.push({
                        ruleId: 'SQL_INJ',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Database query with string interpolation detected. Use prepared statements.',
                    });
                }
            }
        }
        
        return matches;
    },
};

/**
 * Rule 5: Command Injection (CMD_INJ)
 * Detects unsanitized input passed to exec, spawn, os.system, etc.
 */
export const cmdInjectionRule: Rule = {
    id: 'CMD_INJ',
    name: 'Command Injection',
    severity: 'critical',
    languages: ['javascript', 'typescript', 'python', 'c', 'cpp'],
    description: 'Detects unsanitized input passed to command execution functions',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        const language = context.parsedContext.language;
        
        const dangerousFunctions: Record<string, string[]> = {
            javascript: ['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'],
            typescript: ['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'],
            python: ['os.system', 'os.popen', 'subprocess.call', 'subprocess.run', 'subprocess.Popen', 'eval', 'exec'],
            c: ['system', 'popen', 'execl', 'execle', 'execlp', 'execv', 'execve', 'execvp'],
            cpp: ['system', 'popen', 'execl', 'execle', 'execlp', 'execv', 'execve', 'execvp'],
        };
        
        const funcs = dangerousFunctions[language] || [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            for (const func of funcs) {
                const funcPattern = new RegExp(`\\b${func.replace('.', '\\.')}\\s*\\(`);
                if (funcPattern.test(line)) {
                    // Check if using variables/concatenation (potential user input)
                    const hasDynamicInput = /\+\s*\w+|\$\{[^}]+\}|%s|f["'].*\{|\w+\s*\)/.test(line);
                    const hasHardcodedOnly = /\(\s*['"][^'"]*['"]\s*\)/.test(line);
                    
                    if (hasDynamicInput && !hasHardcodedOnly) {
                        matches.push({
                            ruleId: 'CMD_INJ',
                            line: i + 1,
                            matchedText: line.trim(),
                            context: `Command execution function '${func}' with dynamic input. Validate and sanitize input, or use safer alternatives.`,
                        });
                    }
                }
            }
        }
        
        return matches;
    },
};

/**
 * Rule 6: Hardcoded Secrets (HARDCODED_SECRET)
 * Regex-based detection of API keys, tokens, passwords in source code
 */
export const hardcodedSecretRule: Rule = {
    id: 'HARDCODED_SECRET',
    name: 'Hardcoded Secrets',
    severity: 'critical',
    languages: ['javascript', 'typescript', 'python', 'c', 'cpp'],
    description: 'Detects hardcoded API keys, tokens, and passwords in source code',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        
        const secretPatterns = [
            // API Keys
            { pattern: /['"`](?:api[_-]?key|apikey)\s*['"`:=]\s*['"`]([a-zA-Z0-9_\-]{20,})['"`]/i, name: 'API Key' },
            // AWS Keys
            { pattern: /['"`]?(AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}['"`]?/g, name: 'AWS Access Key' },
            { pattern: /['"`][a-zA-Z0-9/+=]{40}['"`]/g, name: 'Potential AWS Secret Key' },
            // Generic tokens
            { pattern: /['"`](?:token|auth[_-]?token|bearer)\s*['"`:=]\s*['"`]([a-zA-Z0-9_\-\.]{20,})['"`]/i, name: 'Auth Token' },
            // Passwords
            { pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"`]([^'"` ]{8,})['"`]/i, name: 'Password' },
            // Private keys
            { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, name: 'Private Key' },
            // GitHub tokens
            { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub Personal Access Token' },
            { pattern: /gho_[a-zA-Z0-9]{36}/g, name: 'GitHub OAuth Token' },
            // JWT tokens
            { pattern: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g, name: 'JWT Token' },
            // Generic secrets
            { pattern: /['"`](?:secret|client[_-]?secret)\s*['"`:=]\s*['"`]([a-zA-Z0-9_\-]{16,})['"`]/i, name: 'Secret' },
            // Database connection strings
            { pattern: /(?:mongodb|mysql|postgres|redis):\/\/[^@]+:[^@]+@/gi, name: 'Database Connection String' },
        ];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip comments and test files
            if (/^\s*(\/\/|#|\/\*|\*|<!--)/.test(line)) continue;
            if (/\.(test|spec)\.[jt]sx?$/.test(context.parsedContext.filename)) continue;
            
            // Skip environment variable references
            if (/process\.env\.|os\.environ|getenv|ENV\[/.test(line)) continue;
            
            for (const { pattern, name } of secretPatterns) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    matches.push({
                        ruleId: 'HARDCODED_SECRET',
                        line: i + 1,
                        matchedText: line.trim().substring(0, 100) + (line.length > 100 ? '...' : ''),
                        context: `Potential hardcoded ${name} detected. Use environment variables or a secrets manager instead.`,
                    });
                    break; // Only one match per line
                }
            }
        }
        
        return matches;
    },
};

/**
 * Rule 7: Infinite Loop Risk (INF_LOOP)
 * Detects loops with missing or unreachable termination conditions
 */
export const infiniteLoopRule: Rule = {
    id: 'INF_LOOP',
    name: 'Infinite Loop Risk',
    severity: 'high',
    languages: ['javascript', 'typescript', 'python', 'c', 'cpp'],
    description: 'Detects loops with missing or unreachable termination conditions',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // while(true) or while(1) without break
            if (/while\s*\(\s*(true|1)\s*\)/.test(line)) {
                // Look ahead for break statement
                let hasBreak = false;
                let braceCount = 0;
                let started = false;
                
                for (let j = i; j < Math.min(i + 50, lines.length); j++) {
                    const checkLine = lines[j];
                    if (checkLine.includes('{')) {
                        braceCount += (checkLine.match(/{/g) || []).length;
                        started = true;
                    }
                    if (checkLine.includes('}')) {
                        braceCount -= (checkLine.match(/}/g) || []).length;
                    }
                    if (/\bbreak\s*;/.test(checkLine) || /\breturn\b/.test(checkLine)) {
                        hasBreak = true;
                        break;
                    }
                    if (started && braceCount === 0) break;
                }
                
                if (!hasBreak) {
                    matches.push({
                        ruleId: 'INF_LOOP',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Infinite loop detected (while true/1) without visible break or return statement.',
                    });
                }
            }
            
            // for(;;) without break
            if (/for\s*\(\s*;\s*;\s*\)/.test(line)) {
                matches.push({
                    ruleId: 'INF_LOOP',
                    line: i + 1,
                    matchedText: line.trim(),
                    context: 'Infinite loop detected (for(;;)). Ensure there is a break or return condition.',
                });
            }
            
            // Python: while True without break
            if (/while\s+True\s*:/.test(line)) {
                let hasBreak = false;
                let indentLevel = line.search(/\S/);
                
                for (let j = i + 1; j < Math.min(i + 50, lines.length); j++) {
                    const checkLine = lines[j];
                    const currentIndent = checkLine.search(/\S/);
                    
                    // Check if we're still inside the loop
                    if (checkLine.trim() && currentIndent <= indentLevel) break;
                    
                    if (/\bbreak\b/.test(checkLine) || /\breturn\b/.test(checkLine)) {
                        hasBreak = true;
                        break;
                    }
                }
                
                if (!hasBreak) {
                    matches.push({
                        ruleId: 'INF_LOOP',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Infinite loop detected (while True) without visible break or return statement.',
                    });
                }
            }
            
            // Loop variable not modified
            const forMatch = line.match(/for\s*\(\s*(?:let|var|int|)\s*(\w+)\s*=\s*\d+\s*;\s*\1\s*[<>!=]+\s*\d+\s*;\s*\)/);
            if (forMatch) {
                matches.push({
                    ruleId: 'INF_LOOP',
                    line: i + 1,
                    matchedText: line.trim(),
                    context: `Loop variable '${forMatch[1]}' is not modified in the increment expression.`,
                });
            }
        }
        
        return matches;
    },
};

/**
 * Rule 8: Unchecked Error Handling (UNCHECKED_ERR)
 * Empty catch blocks, unhandled Promise rejections, ignored return codes
 */
export const uncheckedErrorRule: Rule = {
    id: 'UNCHECKED_ERR',
    name: 'Unchecked Error Handling',
    severity: 'medium',
    languages: ['javascript', 'typescript', 'python', 'c', 'cpp'],
    description: 'Detects empty catch blocks, unhandled Promise rejections, and ignored return codes',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        const language = context.parsedContext.language;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Empty catch block in JS/TS
            if ((language === 'javascript' || language === 'typescript')) {
                if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
                    matches.push({
                        ruleId: 'UNCHECKED_ERR',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Empty catch block. Errors should be logged or handled appropriately.',
                    });
                }
                
                // Check for catch block on next lines
                if (/catch\s*\([^)]*\)\s*\{?\s*$/.test(line)) {
                    const nextLine = lines[i + 1]?.trim();
                    if (nextLine === '}' || nextLine === '} catch' || /^\}\s*$/.test(nextLine)) {
                        matches.push({
                            ruleId: 'UNCHECKED_ERR',
                            line: i + 1,
                            matchedText: line.trim(),
                            context: 'Empty catch block. Errors should be logged or handled appropriately.',
                        });
                    }
                }
                
                // Unhandled promise (no await, no .catch, no .then)
                if (/(?:new\s+Promise|async\s+function|\basync\s)/.test(code)) {
                    if (/\w+\([^)]*\)\s*;?\s*$/.test(line) && !line.includes('await') && !line.includes('.catch') && !line.includes('.then')) {
                        // Check if the function is async
                        const funcMatch = line.match(/(\w+)\s*\(/);
                        if (funcMatch && context.parsedContext.astSummary?.functions.some(f => f.name === funcMatch[1] && f.async)) {
                            matches.push({
                                ruleId: 'UNCHECKED_ERR',
                                line: i + 1,
                                matchedText: line.trim(),
                                context: 'Async function called without await or .catch(). Promise rejection may be unhandled.',
                            });
                        }
                    }
                }
            }
            
            // Python empty except
            if (language === 'python') {
                if (/except\s*:/.test(line) || /except\s+\w+\s*:/.test(line)) {
                    const nextLine = lines[i + 1]?.trim();
                    if (nextLine === 'pass' || nextLine === '') {
                        matches.push({
                            ruleId: 'UNCHECKED_ERR',
                            line: i + 1,
                            matchedText: line.trim(),
                            context: 'Empty except block (or only pass). Exceptions should be logged or handled.',
                        });
                    }
                }
                
                // Bare except
                if (/except\s*:/.test(line) && !/except\s+\w+/.test(line)) {
                    matches.push({
                        ruleId: 'UNCHECKED_ERR',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Bare except clause catches all exceptions including KeyboardInterrupt. Specify exception type.',
                    });
                }
            }
            
            // C/C++ ignored return value of error-prone functions
            if (language === 'c' || language === 'cpp') {
                const errorFuncs = ['malloc', 'calloc', 'realloc', 'fopen', 'open', 'read', 'write', 'recv', 'send'];
                for (const func of errorFuncs) {
                    const pattern = new RegExp(`^\\s*${func}\\s*\\(`);
                    if (pattern.test(line) && !/=/.test(line.split(func)[0])) {
                        matches.push({
                            ruleId: 'UNCHECKED_ERR',
                            line: i + 1,
                            matchedText: line.trim(),
                            context: `Return value of '${func}' is ignored. Check for errors (NULL, -1, etc.).`,
                        });
                    }
                }
            }
        }
        
        return matches;
    },
};

/**
 * Rule 9: Type Coercion Bugs (TYPE_COERCE)
 * Loose equality (==) comparisons in JS/TS leading to unexpected behavior
 */
export const typeCoercionRule: Rule = {
    id: 'TYPE_COERCE',
    name: 'Type Coercion Bugs',
    severity: 'medium',
    languages: ['javascript', 'typescript'],
    description: 'Detects loose equality (==) comparisons that may cause unexpected behavior',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Skip strict equality and assignment
            // Match == but not === and not ===(anything after)
            const looseEqualityPattern = /[^!=><]={2}[^=]/g;
            
            if (looseEqualityPattern.test(line)) {
                // Check for common dangerous comparisons
                const dangerous = [
                    /==\s*null(?!\s*=)/,
                    /==\s*undefined/,
                    /==\s*0[^.]/, // == 0 but not == 0.
                    /==\s*['"`]['"`]/, // == ""
                    /==\s*false/,
                    /==\s*true/,
                ];
                
                const hasDangerous = dangerous.some(p => p.test(line));
                
                if (hasDangerous) {
                    matches.push({
                        ruleId: 'TYPE_COERCE',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Loose equality (==) used with null/undefined/falsy value. Use strict equality (===) to avoid type coercion bugs.',
                    });
                } else if (/[^!=<>]={2}[^=]/.test(line)) {
                    matches.push({
                        ruleId: 'TYPE_COERCE',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Loose equality (==) detected. Consider using strict equality (===) to prevent type coercion.',
                        metadata: { severity: 'low' }, // Lower severity for general ==
                    });
                }
            }
            
            // != instead of !==
            if (/[^!]=!\s*[^=]/.test(line) || /!=[^=]/.test(line)) {
                if (!/!==/.test(line)) {
                    matches.push({
                        ruleId: 'TYPE_COERCE',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: 'Loose inequality (!=) detected. Consider using strict inequality (!==).',
                    });
                }
            }
        }
        
        return matches;
    },
};

/**
 * Rule 10: Deprecated API Usage (DEPRECATED_API)
 * Flags usage of known deprecated functions/methods in standard libraries
 */
export const deprecatedAPIRule: Rule = {
    id: 'DEPRECATED_API',
    name: 'Deprecated API Usage',
    severity: 'low',
    languages: ['javascript', 'typescript', 'python', 'c', 'cpp'],
    description: 'Detects usage of deprecated functions and APIs',
    match(ast: ASTNode | null, context: CodeContext): RuleMatch[] {
        const matches: RuleMatch[] = [];
        const code = context.fileContent;
        const lines = code.split('\n');
        const language = context.parsedContext.language;
        
        const deprecatedAPIs: Record<string, { pattern: RegExp; replacement: string }[]> = {
            javascript: [
                { pattern: /\bdocument\.write\s*\(/g, replacement: 'innerHTML or DOM manipulation' },
                { pattern: /\b__proto__\b/g, replacement: 'Object.getPrototypeOf/Object.setPrototypeOf' },
                { pattern: /\bescape\s*\(/g, replacement: 'encodeURIComponent' },
                { pattern: /\bunescape\s*\(/g, replacement: 'decodeURIComponent' },
                { pattern: /\.substr\s*\(/g, replacement: '.substring() or .slice()' },
                { pattern: /new\s+Buffer\s*\(/g, replacement: 'Buffer.from() or Buffer.alloc()' },
                { pattern: /\.then\s*\([^)]*\)\s*\.done\s*\(/g, replacement: 'async/await or .then().catch()' },
            ],
            typescript: [
                { pattern: /\bdocument\.write\s*\(/g, replacement: 'innerHTML or DOM manipulation' },
                { pattern: /\b__proto__\b/g, replacement: 'Object.getPrototypeOf/Object.setPrototypeOf' },
                { pattern: /\bescape\s*\(/g, replacement: 'encodeURIComponent' },
                { pattern: /\bunescape\s*\(/g, replacement: 'decodeURIComponent' },
                { pattern: /\.substr\s*\(/g, replacement: '.substring() or .slice()' },
                { pattern: /new\s+Buffer\s*\(/g, replacement: 'Buffer.from() or Buffer.alloc()' },
            ],
            python: [
                { pattern: /\bprint\s+[^(]/g, replacement: 'print() function (Python 3)' },
                { pattern: /\.has_key\s*\(/g, replacement: "'key in dict' syntax" },
                { pattern: /\bcmp\s*\(/g, replacement: 'comparison operators or functools.cmp_to_key' },
                { pattern: /\bexecfile\s*\(/g, replacement: 'exec(open().read())' },
                { pattern: /\braw_input\s*\(/g, replacement: 'input() (Python 3)' },
                { pattern: /from\s+__future__\s+import/g, replacement: 'native Python 3 syntax' },
                { pattern: /\.iteritems\s*\(/g, replacement: '.items()' },
                { pattern: /\.iterkeys\s*\(/g, replacement: '.keys()' },
                { pattern: /\.itervalues\s*\(/g, replacement: '.values()' },
            ],
            c: [
                { pattern: /\bgets\s*\(/g, replacement: 'fgets() - gets() is unsafe and removed in C11' },
                { pattern: /\bsprintf\s*\(/g, replacement: 'snprintf() for buffer safety' },
                { pattern: /\bstrcpy\s*\(/g, replacement: 'strncpy() or strlcpy() for buffer safety' },
                { pattern: /\bstrcat\s*\(/g, replacement: 'strncat() or strlcat() for buffer safety' },
                { pattern: /\bscanf\s*\(\s*"%s"/g, replacement: 'scanf with width specifier or fgets()' },
            ],
            cpp: [
                { pattern: /\bgets\s*\(/g, replacement: 'fgets() or std::getline()' },
                { pattern: /\bsprintf\s*\(/g, replacement: 'snprintf() or std::format' },
                { pattern: /\bstrcpy\s*\(/g, replacement: 'std::string or strncpy()' },
                { pattern: /\bstrcat\s*\(/g, replacement: 'std::string or strncat()' },
                { pattern: /\bauto_ptr\b/g, replacement: 'std::unique_ptr or std::shared_ptr' },
                { pattern: /\bregister\s+\w+/g, replacement: 'remove register keyword (deprecated in C++17)' },
            ],
        };
        
        const apis = deprecatedAPIs[language] || [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            for (const { pattern, replacement } of apis) {
                pattern.lastIndex = 0;
                if (pattern.test(line)) {
                    matches.push({
                        ruleId: 'DEPRECATED_API',
                        line: i + 1,
                        matchedText: line.trim(),
                        context: `Deprecated API detected. Consider using ${replacement} instead.`,
                    });
                }
            }
        }
        
        return matches;
    },
};

// ============ Rule Collection ============

export const builtInRules: Rule[] = [
    memoryLeakRule,
    raceConditionRule,
    nullDerefRule,
    sqlInjectionRule,
    cmdInjectionRule,
    hardcodedSecretRule,
    infiniteLoopRule,
    uncheckedErrorRule,
    typeCoercionRule,
    deprecatedAPIRule,
];

// ============ Rule Execution Pipeline ============

export interface RuleExecutionResult {
    ruleId: string;
    ruleName: string;
    severity: RuleSeverity;
    matches: RuleMatch[];
    executionTimeMs: number;
}

export interface PipelineResult {
    results: RuleExecutionResult[];
    totalMatches: number;
    executionTimeMs: number;
    findings: Finding[];
}

/**
 * Execute all applicable rules against parsed code
 */
export function executeRules(
    context: CodeContext,
    config?: Partial<RepoConfig>
): PipelineResult {
    const startTime = Date.now();
    const results: RuleExecutionResult[] = [];
    const language = context.parsedContext.language as SupportedLanguage;
    
    // Filter rules by language and config
    const applicableRules = builtInRules.filter(rule => {
        // Check language support
        if (!rule.languages.includes(language)) return false;
        
        // Check if disabled in config
        if (config?.rules?.[rule.id]?.enabled === false) return false;
        
        return true;
    });
    
    // Execute each rule
    for (const rule of applicableRules) {
        const ruleStart = Date.now();
        
        try {
            const matches = rule.match(null, context);
            
            // Apply severity override from config
            const configSeverity = config?.rules?.[rule.id]?.severity;
            const effectiveSeverity = configSeverity || rule.severity;
            
            results.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: effectiveSeverity,
                matches,
                executionTimeMs: Date.now() - ruleStart,
            });
        } catch (error) {
            console.error(`Error executing rule ${rule.id}:`, error);
            results.push({
                ruleId: rule.id,
                ruleName: rule.name,
                severity: rule.severity,
                matches: [],
                executionTimeMs: Date.now() - ruleStart,
            });
        }
    }
    
    // Convert matches to findings
    const findings: Finding[] = [];
    for (const result of results) {
        for (const match of result.matches) {
            findings.push({
                ruleId: result.ruleId,
                severity: result.severity,
                lineStart: match.line,
                lineEnd: match.endLine || match.line,
                column: match.column,
                title: result.ruleName,
                explanation: match.context,
                suggestion: getDefaultSuggestion(result.ruleId),
                confidence: 0.8, // Static analysis has high confidence
                source: 'static',
                file: context.parsedContext.filename,
            });
        }
    }
    
    // Sort findings by severity, then line number
    const severityOrder: Record<RuleSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
    };
    
    findings.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return a.lineStart - b.lineStart;
    });
    
    // Apply max findings per file limit
    const maxFindings = config?.ai?.maxFindingsPerFile || 50;
    const limitedFindings = findings.slice(0, maxFindings);
    
    return {
        results,
        totalMatches: findings.length,
        executionTimeMs: Date.now() - startTime,
        findings: limitedFindings,
    };
}

function getDefaultSuggestion(ruleId: string): string {
    const suggestions: Record<string, string> = {
        'MEM_LEAK': 'Ensure all allocated memory is freed before the function returns or the scope ends. Consider using RAII or smart pointers in C++.',
        'RACE_COND': 'Use proper synchronization primitives (mutex, semaphore) or restructure to avoid shared mutable state.',
        'NULL_DEREF': 'Add null checks before accessing object properties, or use optional chaining (?.) in JavaScript/TypeScript.',
        'SQL_INJ': 'Use parameterized queries or prepared statements instead of string concatenation.',
        'CMD_INJ': 'Validate and sanitize all user input before passing to command execution. Consider using safer alternatives or allowlisting.',
        'HARDCODED_SECRET': 'Move secrets to environment variables or a secure secrets management service.',
        'INF_LOOP': 'Add a proper termination condition or break statement to the loop.',
        'UNCHECKED_ERR': 'Handle errors appropriately: log them, propagate them, or take corrective action.',
        'TYPE_COERCE': 'Use strict equality (===) and strict inequality (!==) operators.',
        'DEPRECATED_API': 'Update to the recommended modern API for better security, performance, and future compatibility.',
    };
    
    return suggestions[ruleId] || 'Review and fix this issue.';
}

// ============ Legacy Compatibility ============

// Keep the old interface for backward compatibility
export const rulesRegistry = builtInRules.map(rule => ({
    id: rule.id,
    description: rule.description,
    languages: rule.languages as string[],
    pattern: (ctx: any) => {
        const codeContext: CodeContext = {
            parsedContext: ctx,
            fileContent: ctx.rawSnippet,
            surroundingLines: 5,
        };
        return rule.match(null, codeContext).length > 0;
    },
}));

export function getTriggeredRules(context: any): typeof rulesRegistry {
    return rulesRegistry.filter(rule =>
        rule.languages.includes(context.language) && rule.pattern(context)
    );
}
