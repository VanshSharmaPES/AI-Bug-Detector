import OpenAI from 'openai';
import { z } from 'zod';
import pino from 'pino';
import pRetry from 'p-retry';
import { Finding, RuleSeverity } from '../types';
import dotenv from 'dotenv';
dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ============ Provider Configuration ============

// Primary: Groq (fast & free tier available)
const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY || '',
    baseURL: 'https://api.groq.com/openai/v1',
});

// Fallback: OpenAI-compatible endpoint (can be OpenAI, Together, etc.)
const fallbackClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1',
});

// ============ Model Configuration ============

// Groq-supported models (as of 2024)
const GROQ_MODELS = {
    // Best for code analysis - fast and capable
    primary: 'llama-3.3-70b-versatile',
    // Faster fallback
    fast: 'llama-3.1-8b-instant',
    // Alternative large model
    mixtral: 'mixtral-8x7b-32768',
};

// ============ Schema Definitions ============

const FindingSchema = z.object({
    file: z.string().optional(),
    ruleId: z.string().optional(),
    bug_type: z.string().optional(),
    severity: z.enum(["critical", "high", "medium", "low", "info", "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]),
    line: z.number().optional(),
    lineStart: z.number().optional(),
    lineEnd: z.number().optional(),
    title: z.string(),
    description: z.string().optional(),
    explanation: z.string().optional(),
    suggestion: z.string(),
    confidence: z.number().min(0).max(1).optional(),
});

const FindingsArraySchema = z.array(FindingSchema);

// ============ Token Usage Tracking ============

interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    model: string;
    provider: string;
    costEstimate: number;
}

let sessionTokenUsage: TokenUsage[] = [];

export function getSessionTokenUsage(): TokenUsage[] {
    return sessionTokenUsage;
}

export function getTotalTokensUsed(): number {
    return sessionTokenUsage.reduce((sum, u) => sum + u.totalTokens, 0);
}

export function clearSessionTokenUsage(): void {
    sessionTokenUsage = [];
}

function trackTokenUsage(
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined,
    model: string,
    provider: string
): void {
    if (!usage) return;
    
    // Groq pricing is very low, estimate in USD
    const costPerMillion: Record<string, number> = {
        'llama-3.3-70b-versatile': 0.59,
        'llama-3.1-8b-instant': 0.05,
        'mixtral-8x7b-32768': 0.24,
    };
    
    const rate = costPerMillion[model] || 0.5;
    const totalTokens = usage.total_tokens || 0;
    const costEstimate = (totalTokens / 1_000_000) * rate;
    
    sessionTokenUsage.push({
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens,
        model,
        provider,
        costEstimate,
    });
    
    logger.debug({ model, provider, tokens: totalTokens, cost: costEstimate.toFixed(6) }, 'Token usage tracked');
}

// ============ Main Analysis Function ============

export async function analyzeCode(systemPrompt: string, userPrompt: string): Promise<Finding[]> {
    const startTime = Date.now();
    
    try {
        // Try Groq primary model first
        if (process.env.GROQ_API_KEY) {
            logger.info('Starting analysis with Groq (Llama 3.3 70B)');
            return await callGroqWithRetry(systemPrompt, userPrompt, GROQ_MODELS.primary);
        }
        
        // Fallback to any configured OpenAI-compatible endpoint
        if (process.env.OPENAI_API_KEY) {
            logger.info('Starting analysis with fallback provider');
            return await callFallbackProvider(systemPrompt, userPrompt);
        }
        
        throw new Error('No AI provider configured. Set GROQ_API_KEY or OPENAI_API_KEY.');
    } catch (error) {
        logger.error({ err: error, duration: Date.now() - startTime }, 'AI analysis failed');
        return [];
    }
}

// ============ Groq API Call ============

async function callGroqWithRetry(
    systemPrompt: string, 
    userPrompt: string, 
    model: string
): Promise<Finding[]> {
    return pRetry(
        async () => callGroq(systemPrompt, userPrompt, model),
        {
            retries: 3,
            onFailedAttempt: async (error) => {
                logger.warn(
                    { attempt: error.attemptNumber, retriesLeft: error.retriesLeft, err: error.message },
                    'Groq call failed, retrying...'
                );
                
                // If primary model fails after 2 attempts, try faster model
                if (error.attemptNumber === 2 && model === GROQ_MODELS.primary) {
                    logger.info('Switching to faster model for retry');
                    model = GROQ_MODELS.fast;
                }
            },
            minTimeout: 1000,
            maxTimeout: 10000,
        }
    );
}

async function callGroq(
    systemPrompt: string, 
    userPrompt: string, 
    model: string
): Promise<Finding[]> {
    const startTime = Date.now();
    
    const response = await groq.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.1, // Low temperature for more deterministic code analysis
        max_tokens: 4096,
        response_format: { type: 'json_object' },
    });
    
    const duration = Date.now() - startTime;
    trackTokenUsage(response.usage, model, 'groq');
    
    logger.info({ model, duration, tokens: response.usage?.total_tokens }, 'Groq response received');
    
    const content = response.choices[0]?.message?.content || '[]';
    return parseFindings(content);
}

// ============ Fallback Provider ============

async function callFallbackProvider(
    systemPrompt: string, 
    userPrompt: string
): Promise<Finding[]> {
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    
    const response = await fallbackClient.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
    });
    
    trackTokenUsage(response.usage, model, 'openai-compatible');
    
    const content = response.choices[0]?.message?.content || '[]';
    return parseFindings(content);
}

// ============ Response Parsing ============

function parseFindings(rawText: string): Finding[] {
    try {
        // Try to extract JSON array from response
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
        
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch {
            // Try parsing as object with findings key
            const objMatch = rawText.match(/\{[\s\S]*\}/);
            if (objMatch) {
                parsed = JSON.parse(objMatch[0]);
            } else {
                throw new Error('No valid JSON found');
            }
        }

        const arrayToParse = Array.isArray(parsed) ? parsed : (parsed.findings || parsed.bugs || parsed.issues || []);
        
        // Validate and transform findings
        const validated = FindingsArraySchema.parse(arrayToParse);
        
        return validated.map(f => normalizeFinding(f));
    } catch (error) {
        logger.error({ err: error, rawText: rawText.substring(0, 500) }, 'Failed to parse LLM output');
        return [];
    }
}

function normalizeFinding(raw: z.infer<typeof FindingSchema>): Finding {
    const severityMap: Record<string, RuleSeverity> = {
        'CRITICAL': 'critical',
        'HIGH': 'high',
        'MEDIUM': 'medium',
        'LOW': 'low',
        'INFO': 'info',
        'critical': 'critical',
        'high': 'high',
        'medium': 'medium',
        'low': 'low',
        'info': 'info',
    };
    
    return {
        ruleId: raw.ruleId || raw.bug_type || 'AI_DETECTED',
        severity: severityMap[raw.severity] || 'medium',
        lineStart: raw.line || raw.lineStart || 1,
        lineEnd: raw.lineEnd || raw.line || raw.lineStart || 1,
        title: raw.title,
        explanation: raw.explanation || raw.description || '',
        suggestion: raw.suggestion,
        confidence: raw.confidence || 0.7,
        source: 'ai',
        file: raw.file || '',
    };
}

// ============ Batch Analysis ============

export async function analyzeCodeBatch(
    analyses: { systemPrompt: string; userPrompt: string; filename: string }[]
): Promise<Map<string, Finding[]>> {
    const results = new Map<string, Finding[]>();
    
    // Process in parallel with concurrency limit
    const concurrency = 3;
    const chunks: typeof analyses[] = [];
    
    for (let i = 0; i < analyses.length; i += concurrency) {
        chunks.push(analyses.slice(i, i + concurrency));
    }
    
    for (const chunk of chunks) {
        const chunkResults = await Promise.all(
            chunk.map(async ({ systemPrompt, userPrompt, filename }) => {
                const findings = await analyzeCode(systemPrompt, userPrompt);
                return { filename, findings };
            })
        );
        
        for (const { filename, findings } of chunkResults) {
            results.set(filename, findings);
        }
    }
    
    return results;
}

// ============ Health Check ============

export async function checkAIProviderHealth(): Promise<{
    groq: boolean;
    fallback: boolean;
    message: string;
}> {
    const health = { groq: false, fallback: false, message: '' };
    
    if (process.env.GROQ_API_KEY) {
        try {
            await groq.chat.completions.create({
                model: GROQ_MODELS.fast,
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5,
            });
            health.groq = true;
        } catch (e: any) {
            health.message += `Groq error: ${e.message}. `;
        }
    }
    
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== process.env.GROQ_API_KEY) {
        try {
            await fallbackClient.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 5,
            });
            health.fallback = true;
        } catch (e: any) {
            health.message += `Fallback error: ${e.message}. `;
        }
    }
    
    if (!health.groq && !health.fallback) {
        health.message = 'No AI providers available. ' + health.message;
    } else {
        health.message = 'AI providers healthy.';
    }
    
    return health;
}
