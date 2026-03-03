import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import pino from 'pino';
import { Finding } from '../types';
import dotenv from 'dotenv';
dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
});

const FindingSchema = z.object({
    ruleId: z.string(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    lineStart: z.number(),
    lineEnd: z.number(),
    title: z.string(),
    explanation: z.string(),
    suggestion: z.string()
});

const FindingsArraySchema = z.array(FindingSchema);

export async function analyzeCode(systemPrompt: string, userPrompt: string): Promise<Finding[]> {
    try {
        if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
        return await callAnthropic(systemPrompt, userPrompt);
    } catch (error) {
        logger.error({ err: error }, 'Anthropic analysis failed, falling back to OpenAI');
        return await callOpenAI(systemPrompt, userPrompt);
    }
}

async function callAnthropic(systemPrompt: string, userPrompt: string): Promise<Finding[]> {
    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
            { role: 'user', content: userPrompt }
        ]
    });

    const content = response.content.find(c => c.type === 'text');
    if (!content || content.type !== 'text') throw new Error('No text content in response');
    return parseFindings(content.text);
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<Finding[]> {
    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content || '[]';
    return parseFindings(content);
}

function parseFindings(rawText: string): Finding[] {
    try {
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        const jsonStr = jsonMatch ? jsonMatch[0] : rawText;
        const parsed = JSON.parse(jsonStr);

        const arrayToParse = Array.isArray(parsed) ? parsed : (parsed.findings || []);

        return FindingsArraySchema.parse(arrayToParse) as Finding[];
    } catch (error) {
        logger.error({ err: error, rawText }, 'Failed to parse LLM output');
        return [];
    }
}
