import { Octokit } from '@octokit/rest';
import {
    RepoConfig,
    RuleConfig,
    RuleSeverity,
} from '../types';

// ============ Default Configuration ============

export const DEFAULT_CONFIG: RepoConfig = {
    enabled: true,
    ignorePaths: [
        'node_modules/**',
        'vendor/**',
        'dist/**',
        'build/**',
        '.git/**',
        '*.min.js',
        '*.bundle.js',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
    ],
    rules: {
        'MEM_LEAK': { enabled: true, severity: 'critical' },
        'RACE_COND': { enabled: true, severity: 'high' },
        'NULL_DEREF': { enabled: true, severity: 'high' },
        'SQL_INJ': { enabled: true, severity: 'critical' },
        'CMD_INJ': { enabled: true, severity: 'critical' },
        'HARDCODED_SECRET': { enabled: true, severity: 'critical' },
        'INF_LOOP': { enabled: true, severity: 'high' },
        'UNCHECKED_ERR': { enabled: true, severity: 'medium' },
        'TYPE_COERCE': { enabled: true, severity: 'medium' },
        'DEPRECATED_API': { enabled: true, severity: 'low' },
    },
    ai: {
        minConfidence: 0.6,
        maxFindingsPerFile: 10,
    },
    review: {
        postSummary: true,
        createCheckRun: true,
    },
};

// ============ Configuration Cache ============

interface CacheEntry {
    config: RepoConfig;
    timestamp: number;
}

const configCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(owner: string, repo: string): string {
    return `${owner}/${repo}`;
}

export function clearConfigCache(owner?: string, repo?: string): void {
    if (owner && repo) {
        configCache.delete(getCacheKey(owner, repo));
    } else {
        configCache.clear();
    }
}

// ============ Config Parsing ============

interface RawYamlConfig {
    enabled?: boolean;
    ignore_paths?: string[];
    rules?: Record<string, {
        enabled?: boolean;
        severity?: string;
    }>;
    ai?: {
        min_confidence?: number;
        max_findings_per_file?: number;
    };
    review?: {
        post_summary?: boolean;
        create_check_run?: boolean;
    };
}

/**
 * Parse YAML configuration content
 * Uses a simple parser since we control the schema
 */
function parseYamlConfig(content: string): RawYamlConfig {
    const config: RawYamlConfig = {};
    const lines = content.split('\n');
    
    let currentSection: string | null = null;
    let currentRule: string | null = null;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip comments and empty lines
        if (trimmed.startsWith('#') || trimmed === '') continue;
        
        // Detect indentation level
        const indent = line.search(/\S/);
        
        // Top-level keys
        if (indent === 0) {
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmed.substring(0, colonIndex).trim();
                const value = trimmed.substring(colonIndex + 1).trim();
                
                if (key === 'enabled') {
                    config.enabled = value.toLowerCase() === 'true';
                } else if (key === 'ignore_paths') {
                    config.ignore_paths = [];
                    currentSection = 'ignore_paths';
                } else if (key === 'rules') {
                    config.rules = {};
                    currentSection = 'rules';
                } else if (key === 'ai') {
                    config.ai = {};
                    currentSection = 'ai';
                } else if (key === 'review') {
                    config.review = {};
                    currentSection = 'review';
                }
            }
            continue;
        }
        
        // Array items (ignore_paths)
        if (trimmed.startsWith('-') && currentSection === 'ignore_paths') {
            const value = trimmed.substring(1).trim().replace(/^['"]|['"]$/g, '');
            if (!config.ignore_paths) config.ignore_paths = [];
            config.ignore_paths.push(value);
            continue;
        }
        
        // Nested keys
        if (indent > 0 && currentSection) {
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmed.substring(0, colonIndex).trim();
                const value = trimmed.substring(colonIndex + 1).trim();
                
                if (currentSection === 'rules') {
                    if (indent === 2) {
                        // Rule ID
                        currentRule = key;
                        if (!config.rules) config.rules = {};
                        config.rules[key] = {};
                    } else if (indent === 4 && currentRule) {
                        // Rule property
                        if (key === 'enabled') {
                            config.rules![currentRule].enabled = value.toLowerCase() === 'true';
                        } else if (key === 'severity') {
                            config.rules![currentRule].severity = value.toLowerCase();
                        }
                    }
                } else if (currentSection === 'ai') {
                    if (key === 'min_confidence') {
                        config.ai!.min_confidence = parseFloat(value) || 0.6;
                    } else if (key === 'max_findings_per_file') {
                        config.ai!.max_findings_per_file = parseInt(value, 10) || 10;
                    }
                } else if (currentSection === 'review') {
                    if (key === 'post_summary') {
                        config.review!.post_summary = value.toLowerCase() === 'true';
                    } else if (key === 'create_check_run') {
                        config.review!.create_check_run = value.toLowerCase() === 'true';
                    }
                }
            }
        }
    }
    
    return config;
}

/**
 * Validate severity value
 */
function validateSeverity(severity: string | undefined): RuleSeverity | undefined {
    const validSeverities: RuleSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    if (severity && validSeverities.includes(severity as RuleSeverity)) {
        return severity as RuleSeverity;
    }
    return undefined;
}

/**
 * Deep merge repo config with defaults
 */
function mergeConfig(rawConfig: RawYamlConfig): RepoConfig {
    const merged: RepoConfig = { ...DEFAULT_CONFIG };
    
    // Top-level enabled
    if (typeof rawConfig.enabled === 'boolean') {
        merged.enabled = rawConfig.enabled;
    }
    
    // Ignore paths (append to defaults)
    if (rawConfig.ignore_paths && Array.isArray(rawConfig.ignore_paths)) {
        merged.ignorePaths = [
            ...DEFAULT_CONFIG.ignorePaths,
            ...rawConfig.ignore_paths.filter(p => !DEFAULT_CONFIG.ignorePaths.includes(p)),
        ];
    }
    
    // Rules (merge with defaults)
    if (rawConfig.rules) {
        merged.rules = { ...DEFAULT_CONFIG.rules };
        
        for (const [ruleId, ruleConfig] of Object.entries(rawConfig.rules)) {
            if (!merged.rules[ruleId]) {
                merged.rules[ruleId] = { enabled: true };
            }
            
            if (typeof ruleConfig.enabled === 'boolean') {
                merged.rules[ruleId].enabled = ruleConfig.enabled;
            }
            
            const validatedSeverity = validateSeverity(ruleConfig.severity);
            if (validatedSeverity) {
                merged.rules[ruleId].severity = validatedSeverity;
            }
        }
    }
    
    // AI settings
    if (rawConfig.ai) {
        merged.ai = { ...DEFAULT_CONFIG.ai };
        
        if (typeof rawConfig.ai.min_confidence === 'number') {
            merged.ai.minConfidence = Math.max(0, Math.min(1, rawConfig.ai.min_confidence));
        }
        
        if (typeof rawConfig.ai.max_findings_per_file === 'number') {
            merged.ai.maxFindingsPerFile = Math.max(1, Math.min(100, rawConfig.ai.max_findings_per_file));
        }
    }
    
    // Review settings
    if (rawConfig.review) {
        merged.review = { ...DEFAULT_CONFIG.review };
        
        if (typeof rawConfig.review.post_summary === 'boolean') {
            merged.review.postSummary = rawConfig.review.post_summary;
        }
        
        if (typeof rawConfig.review.create_check_run === 'boolean') {
            merged.review.createCheckRun = rawConfig.review.create_check_run;
        }
    }
    
    return merged;
}

// ============ Config Fetching ============

/**
 * Fetch and parse repo configuration from .aibugs.yml
 */
export async function fetchRepoConfig(
    octokit: Octokit,
    owner: string,
    repo: string,
    ref?: string
): Promise<RepoConfig> {
    const cacheKey = getCacheKey(owner, repo);
    
    // Check cache first
    const cached = configCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.config;
    }
    
    try {
        // Try fetching .aibugs.yml from the repo
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: '.aibugs.yml',
            ref,
        });
        
        // Ensure we got a file, not a directory
        if ('content' in data && data.type === 'file') {
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            const rawConfig = parseYamlConfig(content);
            const mergedConfig = mergeConfig(rawConfig);
            
            // Cache the result
            configCache.set(cacheKey, {
                config: mergedConfig,
                timestamp: Date.now(),
            });
            
            return mergedConfig;
        }
    } catch (error: any) {
        // 404 means no config file - use defaults
        if (error.status !== 404) {
            console.warn(`Error fetching config for ${owner}/${repo}:`, error.message);
        }
    }
    
    // Return and cache defaults
    configCache.set(cacheKey, {
        config: DEFAULT_CONFIG,
        timestamp: Date.now(),
    });
    
    return DEFAULT_CONFIG;
}

/**
 * Fetch config synchronously from cache only
 * Returns defaults if not cached
 */
export function getConfigFromCache(owner: string, repo: string): RepoConfig {
    const cacheKey = getCacheKey(owner, repo);
    const cached = configCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.config;
    }
    
    return DEFAULT_CONFIG;
}

// ============ Config Validation ============

/**
 * Validate a configuration object
 */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (typeof config !== 'object' || config === null) {
        return { valid: false, errors: ['Configuration must be an object'] };
    }
    
    const cfg = config as Record<string, unknown>;
    
    // Validate enabled
    if ('enabled' in cfg && typeof cfg.enabled !== 'boolean') {
        errors.push('enabled must be a boolean');
    }
    
    // Validate ignore_paths
    if ('ignore_paths' in cfg) {
        if (!Array.isArray(cfg.ignore_paths)) {
            errors.push('ignore_paths must be an array');
        } else if (!cfg.ignore_paths.every(p => typeof p === 'string')) {
            errors.push('ignore_paths must contain only strings');
        }
    }
    
    // Validate rules
    if ('rules' in cfg) {
        if (typeof cfg.rules !== 'object' || cfg.rules === null) {
            errors.push('rules must be an object');
        } else {
            for (const [ruleId, ruleConfig] of Object.entries(cfg.rules as Record<string, unknown>)) {
                if (typeof ruleConfig !== 'object' || ruleConfig === null) {
                    errors.push(`rules.${ruleId} must be an object`);
                    continue;
                }
                
                const rc = ruleConfig as Record<string, unknown>;
                
                if ('enabled' in rc && typeof rc.enabled !== 'boolean') {
                    errors.push(`rules.${ruleId}.enabled must be a boolean`);
                }
                
                if ('severity' in rc) {
                    const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
                    if (typeof rc.severity !== 'string' || !validSeverities.includes(rc.severity)) {
                        errors.push(`rules.${ruleId}.severity must be one of: ${validSeverities.join(', ')}`);
                    }
                }
            }
        }
    }
    
    // Validate ai settings
    if ('ai' in cfg) {
        if (typeof cfg.ai !== 'object' || cfg.ai === null) {
            errors.push('ai must be an object');
        } else {
            const ai = cfg.ai as Record<string, unknown>;
            
            if ('min_confidence' in ai) {
                const val = ai.min_confidence;
                if (typeof val !== 'number' || val < 0 || val > 1) {
                    errors.push('ai.min_confidence must be a number between 0 and 1');
                }
            }
            
            if ('max_findings_per_file' in ai) {
                const val = ai.max_findings_per_file;
                if (typeof val !== 'number' || val < 1 || !Number.isInteger(val)) {
                    errors.push('ai.max_findings_per_file must be a positive integer');
                }
            }
        }
    }
    
    // Validate review settings
    if ('review' in cfg) {
        if (typeof cfg.review !== 'object' || cfg.review === null) {
            errors.push('review must be an object');
        } else {
            const review = cfg.review as Record<string, unknown>;
            
            if ('post_summary' in review && typeof review.post_summary !== 'boolean') {
                errors.push('review.post_summary must be a boolean');
            }
            
            if ('create_check_run' in review && typeof review.create_check_run !== 'boolean') {
                errors.push('review.create_check_run must be a boolean');
            }
        }
    }
    
    return { valid: errors.length === 0, errors };
}

// ============ Should Ignore File ============

/**
 * Check if a file should be ignored based on config
 */
export function shouldIgnoreFile(filePath: string, config: RepoConfig): boolean {
    for (const pattern of config.ignorePaths) {
        if (matchGlobPattern(filePath, pattern)) {
            return true;
        }
    }
    return false;
}

/**
 * Simple glob pattern matching
 */
function matchGlobPattern(filePath: string, pattern: string): boolean {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');
    
    // Convert glob pattern to regex
    let regexPattern = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except * and ?
        .replace(/\*\*/g, '{{GLOBSTAR}}')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\{\{GLOBSTAR\}\}/g, '.*');
    
    // Patterns without slashes match anywhere in path
    if (!normalizedPattern.includes('/')) {
        regexPattern = `(^|/)${regexPattern}$`;
    } else {
        regexPattern = `^${regexPattern}$`;
    }
    
    const regex = new RegExp(regexPattern);
    return regex.test(normalizedPath);
}

// ============ Generate Example Config ============

/**
 * Generate an example .aibugs.yml configuration
 */
export function generateExampleConfig(): string {
    return `# AI Bug Detector Configuration
# Place this file as .aibugs.yml in your repository root

# Enable or disable AI Bug Detector for this repository
enabled: true

# Paths to ignore (supports glob patterns)
# These paths will be skipped during analysis
ignore_paths:
  - "vendor/**"
  - "node_modules/**"
  - "*.test.ts"
  - "*.spec.js"
  - "__tests__/**"
  - "**/*.min.js"

# Rule configuration
# Each rule can be enabled/disabled and have its severity overridden
rules:
  MEM_LEAK:
    enabled: true
    severity: critical
  
  RACE_COND:
    enabled: true
    severity: high
  
  NULL_DEREF:
    enabled: true
    severity: high
  
  SQL_INJ:
    enabled: true
    severity: critical
  
  CMD_INJ:
    enabled: true
    severity: critical
  
  HARDCODED_SECRET:
    enabled: true
    severity: critical
  
  INF_LOOP:
    enabled: true
    severity: high
  
  UNCHECKED_ERR:
    enabled: true
    severity: medium
  
  TYPE_COERCE:
    enabled: false  # Disable if too noisy
    severity: low
  
  DEPRECATED_API:
    enabled: true
    severity: low

# AI analysis settings
ai:
  # Minimum confidence threshold (0.0 - 1.0)
  # Findings below this threshold will be filtered out
  min_confidence: 0.7
  
  # Maximum number of findings to report per file
  max_findings_per_file: 10

# Review comment settings
review:
  # Post a summary comment at the top of the review
  post_summary: true
  
  # Create a GitHub Check Run with results
  create_check_run: true
`;
}

export default {
    fetchRepoConfig,
    getConfigFromCache,
    clearConfigCache,
    validateConfig,
    shouldIgnoreFile,
    generateExampleConfig,
    DEFAULT_CONFIG,
};
