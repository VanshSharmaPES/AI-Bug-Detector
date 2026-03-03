# AI Bug Detector

AI Bug Detector is a GitHub App that integrates directly into Pull Request workflows to perform automated, AI-powered code review. It detects deep logical flaws — including memory leaks, race conditions, null dereferences, and injection vulnerabilities — and posts inline comments on the exact lines of code where issues are found.

## Features

- **Automated Code Review**: Analyzes code changes in Pull Requests automatically via GitHub Webhooks.
- **Deep Logical Analysis**: Uses Abstract Syntax Trees (AST) via `tree-sitter` and `typescript-estree` to thoroughly understand code structure (supports C, C++, Python, JavaScript, and TypeScript).
- **AI-Powered Insights**: Powered by Anthropic's Claude 3.5 Sonnet (with OpenAI GPT-4o fallback) to accurately find complex bugs with high confidence.
- **Inline Feedback**: Posts actionable review comments directly on the affected lines in the GitHub Pull Request.
- **Robust Queueing**: Uses BullMQ and Redis for reliable asynchronous job processing and retry mechanisms.

## Tech Stack

- **Framework**: Next.js (App Router)
- **Runtime**: Node.js 20
- **GitHub API**: Octokit (`@octokit/rest`, `@octokit/webhooks`, `@octokit/auth-app`)
- **Queue**: BullMQ & Redis
- **AI Providers**: Anthropic SDK, OpenAI SDK
- **Validation**: Zod (for LLM output validation)

## Setup & Local Development

### Prerequisites

- Node.js (v20+)
- Docker & Docker Compose (for Redis and isolated execution)
- A GitHub App registered with necessary permissions (Pull Requests: Read & Write, Metadata: Read).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/VanshSharmaPES/AI-Bug-Detector.git
   cd AI-Bug-Detector
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Setup environment variables by copying the example file:
   ```bash
   cp .env.example .env
   ```
   Fill in your `.env` with the GitHub App credentials, Webhook Secret, Anthropic/OpenAI keys, etc.

4. Add your GitHub App private key:
   Save your `private-key.pem` in the root directory.

### Running the Application

Using Docker Compose (Recommended):
```bash
docker-compose up --build
```
This will start:
- Redis server on port 6379
- Next.js API server on port 3000
- The BullMQ worker process

Running locally (without Docker for app/worker):
1. Start a local Redis instance.
2. Run the Next.js app:
   ```bash
   npm run dev
   ```
3. Run the BullMQ worker in a separate terminal:
   ```bash
   npm run worker
   ```

## Architecture

The system uses a Next.js API route (`/api/webhook/route.ts`) to receive and rigorously validate the HMAC signature of incoming GitHub webhooks. Valid events are enqueued in a BullMQ queue backed by Redis. A separate worker process pulls these jobs, fetches the Pull Request diffs, parses the AST, matched static rules, and feeds everything into Claude/GPT-4o to get high-confidence inline comments.

## License

MIT
