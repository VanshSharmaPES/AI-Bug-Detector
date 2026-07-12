# AI Bug Detector

A GitHub App that performs automated, AI-powered code review on Pull Requests. It parses code structurally (not just as text), reasons about it using an LLM, and posts inline review comments on the exact lines where issues are found.

**Live:** Deployed on Vercel · **Languages supported:** C, C++, Python, JavaScript, TypeScript

---

## What it does

When a Pull Request is opened or updated, AI Bug Detector:

1. Receives the event via a GitHub webhook (signature-verified)
2. Parses the changed files into an Abstract Syntax Tree (AST) using `tree-sitter`
3. Runs a lightweight rule engine over the AST to surface structural hints (e.g. suspicious patterns worth flagging to the model)
4. Builds a prompt combining the raw diff, AST context, and rule hints
5. Sends it to an LLM (Groq / Llama 3.3 70B, with OpenAI-compatible fallback) and validates the structured JSON response against a schema (Zod)
6. Maps each finding back to its exact line in the diff and posts an inline PR comment

Detected issue types include memory leaks, race conditions, null dereferences, and injection vulnerabilities.

## Why structural parsing instead of pattern matching

Regex-based review tools match text, not code. A rule like "flag `strcpy` calls" using regex has no way to know if that call is inside a comment, a string literal, or genuinely reachable code — it just matches the substring. Parsing into an AST means the tool understands actual code structure: scope, control flow, and where a given variable is declared versus used. That's the difference between a lint rule that fires on real bugs and one that mostly produces noise.

## Why an async job queue instead of handling requests synchronously

GitHub expects a webhook response within a few seconds, or it treats the delivery as failed and retries — which would trigger duplicate analysis of the same PR. An LLM call over AST + diff context can easily take longer than that window. So the webhook handler does the minimum needed to acknowledge receipt (verify signature, enqueue the job, return 200 immediately), and a separate BullMQ worker processes the job asynchronously against Redis. This also provides retry-on-failure without re-triggering the webhook, and a natural point to add backpressure if many PRs arrive at once.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | Next.js (App Router), Node.js 20+ |
| GitHub integration | Octokit (`@octokit/rest`, `@octokit/webhooks`, `@octokit/auth-app`) |
| Structural parsing | tree-sitter, `@typescript-eslint/typescript-estree` |
| AI | Groq SDK (Llama 3.3 70B), OpenAI SDK (fallback) |
| Queue | BullMQ + Redis |
| Validation | Zod (strict schema validation on LLM output) |
| Deployment | Vercel, Docker Compose (local) |

## Architecture

```
GitHub PR event
     │
     ▼
Webhook handler (HMAC-verified) ──► enqueue job ──► return 200
                                          │
                                          ▼
                                   BullMQ worker (async)
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
              AST parsing          Rule engine hints      Diff context
              (tree-sitter)                                    │
                     └────────────────────┬────────────────────┘
                                          ▼
                              Prompt → LLM (Groq/OpenAI)
                                          │
                                          ▼
                        Zod-validated structured findings
                                          │
                                          ▼
                     Map findings to diff lines → post inline PR comments
```

## Running locally

```bash
git clone https://github.com/VanshSharmaPES/AI-Bug-Detector.git
cd AI-Bug-Detector
npm install
cp .env.example .env   # fill in GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET, GROQ_API_KEY, REDIS_URL
```

Requires a registered GitHub App (Pull requests: Read & Write, Metadata: Read-only, Webhooks subscribed to PR events) with its private key saved as `private-key.pem` in the project root.

```bash
docker-compose up --build   # Redis + Next.js server + worker, containerized
```

or run components separately: `redis-server`, `npm run dev`, `npm run worker`.

## Roadmap

- Interactive "Suggested Changes" (auto-fix commits, not just comments)
- Codebase-aware RAG — semantic cross-file context so findings account for related code beyond the diff
- Web dashboard for review history and telemetry

## License

MIT
