import { Octokit } from '@octokit/rest';

export interface DiffFile {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string;
    rawUrl: string;
}

export async function fetchPRDiff(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<DiffFile[]> {
    const { data: files } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
    });

    return files.map((file: any) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        rawUrl: file.raw_url,
    }));
}
