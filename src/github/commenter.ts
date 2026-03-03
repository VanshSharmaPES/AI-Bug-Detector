import { Octokit } from '@octokit/rest';
import pino from 'pino';
import { DiffFile } from './diffFetcher';
import { Finding } from '../types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export async function postReviewComments(
    octokit: Octokit,
    owner: string,
    repo: string,
    prNumber: number,
    diffFiles: DiffFile[],
    allFindings: { file: DiffFile, findings: Finding[] }[]
) {
    const comments: any[] = [];

    for (const { file, findings } of allFindings) {
        if (!file.patch || findings.length === 0) continue;

        const lineToPositionMap = buildDiffPositionMap(file.patch);

        for (const finding of findings) {
            const position = lineToPositionMap.get(finding.lineStart);
            if (position) {
                comments.push({
                    path: file.filename,
                    position: position,
                    body: `**[${finding.severity}] ${finding.ruleId}: ${finding.title}**\n\n${finding.explanation}\n\n**Suggestion:**\n${finding.suggestion}`
                });
            } else {
                logger.warn(`Could not map line ${finding.lineStart} to diff position in ${file.filename}`);
            }
        }
    }

    if (comments.length === 0) {
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: '✅ AI Bug Detector found no high-confidence issues in this PR.'
        });
        return;
    }

    await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: 'COMMENT',
        comments
    });
}

function buildDiffPositionMap(patch: string): Map<number, number> {
    const map = new Map<number, number>();
    const lines = patch.split('\n');
    let currentLineInFile = 0;
    let positionInDiff = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const hunkHeaderMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunkHeaderMatch) {
            currentLineInFile = parseInt(hunkHeaderMatch[1], 10) - 1;
            positionInDiff++;
            continue;
        }

        if (line.startsWith(' ')) {
            currentLineInFile++;
            map.set(currentLineInFile, positionInDiff);
        } else if (line.startsWith('+')) {
            currentLineInFile++;
            map.set(currentLineInFile, positionInDiff);
        } else if (line.startsWith('-')) {
            // Deletions don't advance the new file line counter
        }

        positionInDiff++;
    }

    return map;
}
