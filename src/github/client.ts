import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export function getOctokitClient(installationId: number): Octokit {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH || './private-key.pem';

    if (!appId) {
        throw new Error('GITHUB_APP_ID environment variable is missing');
    }

    let privateKey: string;
    try {
        privateKey = fs.readFileSync(path.resolve(privateKeyPath), 'utf8');
    } catch (error) {
        logger.error({ err: error, path: privateKeyPath }, 'Failed to read GitHub App private key');
        throw new Error(`Could not read private key from ${privateKeyPath}`);
    }

    return new Octokit({
        authStrategy: createAppAuth,
        auth: {
            appId,
            privateKey,
            installationId,
        },
    });
}
