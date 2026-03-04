import {
    Rule,
    RuleMetadata,
    RuleRegistryStats,
    RuleSeverity,
    SupportedLanguage,
} from '../types';
import { builtInRules } from './ruleEngine';

// ============ Rule Registry ============

class RuleRegistry {
    private rules: Map<string, Rule> = new Map();
    private metadata: Map<string, RuleMetadata> = new Map();
    
    constructor() {
        // Auto-register all built-in rules
        this.registerBuiltInRules();
    }
    
    private registerBuiltInRules(): void {
        for (const rule of builtInRules) {
            this.register(rule);
        }
    }
    
    /**
     * Register a rule in the registry
     */
    register(rule: Rule, category: string = 'security'): void {
        this.rules.set(rule.id, rule);
        
        this.metadata.set(rule.id, {
            id: rule.id,
            name: rule.name,
            description: rule.description,
            severity: rule.severity,
            languages: rule.languages,
            category,
            examples: this.getExamplesForRule(rule.id),
        });
    }
    
    /**
     * Unregister a rule
     */
    unregister(ruleId: string): boolean {
        const deleted = this.rules.delete(ruleId);
        this.metadata.delete(ruleId);
        return deleted;
    }
    
    /**
     * Get a rule by ID
     */
    get(ruleId: string): Rule | undefined {
        return this.rules.get(ruleId);
    }
    
    /**
     * Get all registered rules
     */
    getAll(): Rule[] {
        return Array.from(this.rules.values());
    }
    
    /**
     * Get rules for a specific language
     */
    getByLanguage(language: SupportedLanguage): Rule[] {
        return Array.from(this.rules.values()).filter(rule =>
            rule.languages.includes(language)
        );
    }
    
    /**
     * Get rules by severity
     */
    getBySeverity(severity: RuleSeverity): Rule[] {
        return Array.from(this.rules.values()).filter(rule =>
            rule.severity === severity
        );
    }
    
    /**
     * Get rule metadata
     */
    getMetadata(ruleId: string): RuleMetadata | undefined {
        return this.metadata.get(ruleId);
    }
    
    /**
     * Get all rule metadata for dashboard display
     */
    getAllMetadata(): RuleMetadata[] {
        return Array.from(this.metadata.values());
    }
    
    /**
     * Get registry statistics
     */
    getStats(): RuleRegistryStats {
        const rules = this.getAll();
        
        const bySeverity: Record<RuleSeverity, number> = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
        };
        
        const byLanguage: Record<SupportedLanguage, number> = {
            javascript: 0,
            typescript: 0,
            python: 0,
            c: 0,
            cpp: 0,
            unknown: 0,
        };
        
        const byCategory: Record<string, number> = {};
        
        for (const rule of rules) {
            bySeverity[rule.severity]++;
            
            for (const lang of rule.languages) {
                byLanguage[lang]++;
            }
            
            const meta = this.metadata.get(rule.id);
            if (meta) {
                byCategory[meta.category] = (byCategory[meta.category] || 0) + 1;
            }
        }
        
        return {
            totalRules: rules.length,
            bySeverity,
            byLanguage,
            byCategory,
        };
    }
    
    /**
     * Search rules by keyword (searches name, description)
     */
    search(keyword: string): Rule[] {
        const lowerKeyword = keyword.toLowerCase();
        return Array.from(this.rules.values()).filter(rule =>
            rule.name.toLowerCase().includes(lowerKeyword) ||
            rule.description.toLowerCase().includes(lowerKeyword) ||
            rule.id.toLowerCase().includes(lowerKeyword)
        );
    }
    
    /**
     * Get examples for a specific rule
     */
    private getExamplesForRule(ruleId: string): { bad: string; good: string } | undefined {
        const examples: Record<string, { bad: string; good: string }> = {
            'MEM_LEAK': {
                bad: `char* ptr = malloc(100);\n// No free() call`,
                good: `char* ptr = malloc(100);\n// ... use ptr ...\nfree(ptr);`,
            },
            'RACE_COND': {
                bad: `let count = 0;\nawait Promise.all(items.map(async item => {\n  count++; // Race condition!\n}));`,
                good: `const results = await Promise.all(items.map(async item => {\n  return processItem(item);\n}));\nconst count = results.length;`,
            },
            'NULL_DEREF': {
                bad: `const user = users.find(u => u.id === id);\nconsole.log(user.name); // May be undefined!`,
                good: `const user = users.find(u => u.id === id);\nif (user) {\n  console.log(user.name);\n}`,
            },
            'SQL_INJ': {
                bad: `db.query("SELECT * FROM users WHERE id = " + userId);`,
                good: `db.query("SELECT * FROM users WHERE id = ?", [userId]);`,
            },
            'CMD_INJ': {
                bad: `exec("ls " + userInput);`,
                good: `execFile("ls", [sanitizedInput]);`,
            },
            'HARDCODED_SECRET': {
                bad: `const apiKey = "sk-abc123xyz456";`,
                good: `const apiKey = process.env.API_KEY;`,
            },
            'INF_LOOP': {
                bad: `while (true) {\n  processItem();\n}`,
                good: `while (true) {\n  if (!processItem()) break;\n}`,
            },
            'UNCHECKED_ERR': {
                bad: `try {\n  riskyOperation();\n} catch (e) {}`,
                good: `try {\n  riskyOperation();\n} catch (e) {\n  console.error('Operation failed:', e);\n}`,
            },
            'TYPE_COERCE': {
                bad: `if (value == null) { }`,
                good: `if (value === null || value === undefined) { }`,
            },
            'DEPRECATED_API': {
                bad: `document.write('<h1>Hello</h1>');`,
                good: `document.body.innerHTML = '<h1>Hello</h1>';`,
            },
        };
        
        return examples[ruleId];
    }
    
    /**
     * Check if a rule exists
     */
    has(ruleId: string): boolean {
        return this.rules.has(ruleId);
    }
    
    /**
     * Get rule count
     */
    get count(): number {
        return this.rules.size;
    }
}

// Export singleton instance
export const ruleRegistry = new RuleRegistry();

// ============ Rule Discovery ============

/**
 * Dynamically discover and register rules from a directory
 * This is a placeholder for future dynamic rule loading capability
 */
export async function discoverRules(rulesDir: string): Promise<number> {
    // In a full implementation, this would:
    // 1. Scan the directory for rule files
    // 2. Dynamically import each file
    // 3. Validate that exports match the Rule interface
    // 4. Register each rule with the registry
    
    // For now, all rules are statically registered via builtInRules
    console.log(`Rule discovery from ${rulesDir} - using built-in rules`);
    return ruleRegistry.count;
}

// ============ Rule Export Functions ============

/**
 * Export rule metadata in JSON format for dashboard
 */
export function exportRulesForDashboard(): {
    rules: RuleMetadata[];
    stats: RuleRegistryStats;
} {
    return {
        rules: ruleRegistry.getAllMetadata(),
        stats: ruleRegistry.getStats(),
    };
}

/**
 * Export rules in markdown format for documentation
 */
export function exportRulesAsMarkdown(): string {
    const rules = ruleRegistry.getAllMetadata();
    const stats = ruleRegistry.getStats();
    
    let markdown = `# AI Bug Detector - Rule Reference\n\n`;
    markdown += `Total Rules: ${stats.totalRules}\n\n`;
    
    markdown += `## Severity Breakdown\n\n`;
    markdown += `| Severity | Count |\n|----------|-------|\n`;
    for (const [severity, count] of Object.entries(stats.bySeverity)) {
        if (count > 0) {
            markdown += `| ${severity} | ${count} |\n`;
        }
    }
    markdown += `\n`;
    
    markdown += `## Language Coverage\n\n`;
    markdown += `| Language | Rules |\n|----------|-------|\n`;
    for (const [lang, count] of Object.entries(stats.byLanguage)) {
        if (count > 0) {
            markdown += `| ${lang} | ${count} |\n`;
        }
    }
    markdown += `\n`;
    
    markdown += `## Rules\n\n`;
    
    // Group by severity
    const severityOrder: RuleSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    
    for (const severity of severityOrder) {
        const severityRules = rules.filter(r => r.severity === severity);
        if (severityRules.length === 0) continue;
        
        markdown += `### ${severity.charAt(0).toUpperCase() + severity.slice(1)} Severity\n\n`;
        
        for (const rule of severityRules) {
            markdown += `#### ${rule.id}: ${rule.name}\n\n`;
            markdown += `${rule.description}\n\n`;
            markdown += `**Languages:** ${rule.languages.join(', ')}\n\n`;
            
            if (rule.examples) {
                markdown += `**Bad Example:**\n\`\`\`\n${rule.examples.bad}\n\`\`\`\n\n`;
                markdown += `**Good Example:**\n\`\`\`\n${rule.examples.good}\n\`\`\`\n\n`;
            }
        }
    }
    
    return markdown;
}

// ============ Default Export ============

export default ruleRegistry;
