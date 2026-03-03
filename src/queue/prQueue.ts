import { Queue } from 'bullmq';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import pino from 'pino';
import { PRReviewJob } from '../types';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
export const redisConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
}) as any;

redisConnection.on('error', (err: any) => {
    logger.error({ err }, 'Redis connection error');
});

export const prQueue = new Queue<PRReviewJob>('pr-analysis', {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});
