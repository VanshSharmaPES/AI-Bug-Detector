import { Webhooks } from '@octokit/webhooks';
import { NextRequest, NextResponse } from 'next/server';
import pino from 'pino';
import { prQueue } from '@/queue/prQueue';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

const webhooks = new Webhooks({
    secret: webhookSecret || 'missing-secret',
});

// We need to trigger the enqueueing from the event
webhooks.on('pull_request.opened', handlePRWebhook);
webhooks.on('pull_request.synchronize', handlePRWebhook);

async function handlePRWebhook(event: any) {
    const { action, pull_request, repository, installation } = event.payload;

    logger.info({
        event: 'PR_WEBHOOK_RECEIVED',
        action,
        prNumber: pull_request.number,
        repo: repository.full_name,
    }, `Received PR webhook for ${repository.full_name}#${pull_request.number}`);

    if (!installation || !installation.id) {
        logger.error('Webhook payload is missing installation ID');
        return;
    }

    try {
        await prQueue.add('review-pr', {
            owner: repository.owner.login,
            repo: repository.name,
            prNumber: pull_request.number,
            installationId: installation.id,
        });

        logger.info(`Queued PR review job for ${repository.full_name}#${pull_request.number}`);
    } catch (error) {
        logger.error({ err: error }, 'Failed to queue PR review job');
    }
}

export async function POST(req: NextRequest) {
    if (!webhookSecret) {
        logger.error('GITHUB_WEBHOOK_SECRET is not set');
        return NextResponse.json({ error: 'Config error' }, { status: 500 });
    }

    const signature = req.headers.get('x-hub-signature-256');
    const id = req.headers.get('x-github-delivery');
    const name = req.headers.get('x-github-event');

    if (!signature || !id || !name) {
        logger.warn('Webhook request missing identifying headers');
        return NextResponse.json({ error: 'Missing headers' }, { status: 401 });
    }

    try {
        const textBody = await req.text();

        await webhooks.verifyAndReceive({
            id,
            name: name as any,
            payload: textBody,
            signature,
        });

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error) {
        logger.error({ err: error }, 'Webhook signature verification failed');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
}
