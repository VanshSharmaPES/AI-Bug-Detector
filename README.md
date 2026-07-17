# Codex Reviewer

Codex Reviewer is a repository-aware TypeScript/JavaScript convention reviewer. It learns evidence-backed conventions from a base repository, evaluates only lines introduced by a unified patch, explains violations with supporting examples, and can propose fixes that are validated in an isolated copy.

**Primary focus:** deterministic, explainable repository convention review for the Developer Tools category.

## Repository Convention Reviewer CLI

The CLI profiles a base repository, compares a post-change repository against a patch, and reports only newly introduced convention deviations. It supports deterministic naming style, import order, function length, and exported-code documentation rules. Optional LLM patterns are advisory evidence and never create ungrounded violations.

```bash
npm install
npm run demo:conventions
```

The demo profiles the included fixtures, reviews a deliberately problematic patch, and validates a mocked model-generated fix end-to-end. The model response is mocked for determinism, but the real fix validator applies the diff in isolation, reparses the changed file, and re-evaluates the original convention. It requires no Redis, GitHub credentials, or AI provider.

For the individual commands:

```bash
npm run conventions:profile -- --repo fixtures/convention-base --out fixtures/profile.json
npm run conventions:review -- --base fixtures/convention-base --repo fixtures/convention-change --profile fixtures/profile.json --patch fixtures/convention-change.patch
```

Use `--fixes auto` to request up to three structured AI-generated diffs. Every diff is applied in an isolated temporary copy, reparsed, checked against the original rule, and rejected if it touches unrelated code or introduces another convention violation.

The review command compares `--base`, `--repo`, and `--patch` so pre-existing violations outside the changed ranges are not reported as new findings. Use `--llm-patterns` during profiling to add optional evidence-grounded advisory patterns.

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

## Running locally

```bash
git clone https://github.com/VanshSharmaPES/codex-reviewer.git
cd codex-reviewer
npm install
```

The convention CLI and demo need no environment variables. The optional GitHub worker requires the values in `.env.example`, a registered GitHub App, and Redis available at `REDIS_URL`.

`GET /api/health` reports `queue.redisConfigured` and `queue.redisReachable`. Queue clients are initialized lazily, so the static frontend build does not require Redis.

## License

MIT
