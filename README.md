# Codex Reviewer

Codex Reviewer is a repository-aware TypeScript/JavaScript convention reviewer. It learns evidence-backed conventions from a base repository, evaluates only lines introduced by a unified patch, explains violations with supporting examples, and can propose fixes that are validated in an isolated copy.

**Primary focus:** deterministic, explainable repository convention review for the Developer Tools category.

## Getting Started

```bash
git clone https://github.com/VanshSharmaPES/codex-reviewer.git
cd codex-reviewer
npm install
```

**To see it work, using the bundled fixtures:**

```bash
npm run demo:conventions
```

This runs a fixed, self-contained walkthrough: it profiles a small sample repo checked into this project (`fixtures/convention-base`), reviews a bundled patch that deliberately breaks a naming convention, and validates a fix for it. The model's fix suggestion is mocked in this demo for deterministic output, but the fix validator itself is real: it applies the diff in an isolated copy, reparses the changed file, and re-checks it against the original rule. No Redis, GitHub credentials, or AI provider key are needed for this command.

**To run it on your own repository or patch:**

The demo above always uses the same bundled fixtures. To review real code, use the underlying commands directly:

```bash
npm run conventions:profile -- --repo /path/to/your/repo --out profile.json
npm run conventions:review -- --base /path/to/your/repo --repo /path/to/your/changed/repo --profile profile.json --patch your-changes.patch
```

- `profile` learns conventions from `--repo` and writes them to `--out`.
- `review` compares `--base` (before), `--repo` (after), and `--patch` (the diff), and reports only violations introduced by the patch, not pre-existing issues elsewhere in the repo.
- Add `--fixes auto` to request up to three AI-generated diffs (this calls a real AI provider, unlike the demo above). Every diff is applied in an isolated temporary copy, reparsed, checked against the original rule, and rejected if it touches unrelated code or introduces another convention violation.
- Add `--llm-patterns` during profiling to include optional, evidence-grounded advisory patterns (see "How Codex and GPT-5.6 were used" below). These are advisory only and never create a violation on their own.

### CLI exit codes

- `0`: completed without enforceable violations.
- `1`: completed with one or more violations.
- `2`: invalid arguments, profile, patch, or output path.
- `3`: no eligible source file could be analyzed.

### Development checks

```bash
npm run lint
npm run test:conventions
npx tsc --noEmit
npm run build
```

## Related Experiment: PR Bug-Detection App

This repository also contains an earlier GitHub App exploration for AST- and LLM-assisted pull-request bug detection. It experimented with webhook processing, Redis-backed jobs, inline comments, and Vercel deployment, but it is separate from the convention-reviewer submission focus and is not being extended in the current milestone. The convention CLI is the primary project workflow and the recommended path for evaluation.

## Profiles, GitHub integration, and history

Repository profiles are validated against a versioned schema and stored atomically under `.codex-reviewer/profiles/<owner>__<repo>.json`. The optional GitHub worker path can fetch base/head trees, run convention reviews, publish Check Runs and inline comments, and persist review history at `.codex-reviewer/reviews.json`.

The dashboard is available at `/dashboard`; it shows persisted review status, violations, duration, files analyzed, and provider telemetry. These runtime integrations require a configured GitHub App and Redis, while the local fixture workflow remains independent of them.

## How Codex and GPT-5.6 were used

Codex, using GPT-5.6, was used as a development collaborator specifically for the repository-convention CLI: architecture review, implementation planning, typed module design, fixture creation, test generation, demo validation, and documentation. It was not used to expand the earlier bug-detection experiment described above.

GPT-5.6 is also called directly at runtime, separately from its role in Codex during development. When `--llm-patterns` is enabled, it reviews a sampled set of functions and returns a structured, confidence-scored judgment on patterns a parser can't reliably classify on its own, such as error-handling shape. This output is advisory evidence only: every example the model cites is checked against the real candidates it was shown, and any pattern is discarded if it cites evidence it wasn't actually given. It can never create a violation on its own.

## Optional: environment variables

The convention CLI and demo need no environment variables. The optional GitHub worker requires the values in `.env.example`, a registered GitHub App, and Redis available at `REDIS_URL`.

`GET /api/health` reports `queue.redisConfigured` and `queue.redisReachable`. Queue clients are initialized lazily, so the static frontend build does not require Redis.

## License

MIT
