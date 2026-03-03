import { Worker, Job } from 'bullmq';
import pRetry from 'p-retry';
import pino from 'pino';
import dotenv from 'dotenv';
import { PRReviewJob } from '../types';
import { redisConnection } from './prQueue';
import { getOctokitClient } from '../github/client';
import { fetchPRDiff } from '../github/diffFetcher';
import { parseCode } from '../parser/astParser';
import { getTriggeredRules } from '../rules/ruleEngine';
import { buildSystemPrompt, buildUserPrompt } from '../prompt/contextBuilder';
import { analyzeCode } from '../ai/analyzer';
import { postReviewComments } from '../github/commenter';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export const prWorker = new Worker<PRReviewJob>('pr-analysis', async (job: Job<PRReviewJob>) => {
    const { owner, repo, prNumber, installationId } = job.data;
    logger.info(`Processing PR analysis for ${owner}/${repo}#${prNumber}`);

    let octokit;
    try {
        octokit = getOctokitClient(installationId);
    } catch (err) {
        logger.error({ err }, 'Failed to init Octokit client');
        throw err;
    }

    const diffFiles = await pRetry(() => fetchPRDiff(octokit, owner, repo, prNumber), {
        retries: 3,
        onFailedAttempt: error => {
            logger.warn(`Diff fetch failed, attempt ${error.attemptNumber}`);
        }
    });

    const allFindings: any[] = [];

    for (const file of diffFiles) {
        if (!file.patch) continue;

        const parsedContext = parseCode(file.filename, file.patch);
        const rules = getTriggeredRules(parsedContext);

        const systemPrompt = buildSystemPrompt();
        const userPrompt = buildUserPrompt(
            file.filename,
            parsedContext.language,
            file.patch,
            parsedContext.astSummary,
            rules
        );

        const findings = await pRetry(() => analyzeCode(systemPrompt, userPrompt), {
            retries: 3,
            onFailedAttempt: error => {
                logger.warn(`AI analysis failed for ${file.filename}, attempt ${error.attemptNumber}`);
            }
        });

        if (findings.length > 0) {
            allFindings.push({ file, findings });
        }
    }

    await pRetry(() => postReviewComments(octokit, owner, repo, prNumber, diffFiles, allFindings), {
        retries: 3,
        onFailedAttempt: error => {
            logger.warn(`Posting comments failed, attempt ${error.attemptNumber}`);
        }
    });

    logger.info(`Successfully processed PR ${owner}/${repo}#${prNumber}`);

}, {
    connection: redisConnection,
    concurrency: 5,
    autorun: false
});

prWorker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, 'Job failed');
});

if (require.main === module) {
    logger.info('Starting PR Analysis worker...');
    prWorker.run().catch((err: any) => {
        logger.fatal({ err }, 'Worker crashed');
        process.exit(1);
    });
}
