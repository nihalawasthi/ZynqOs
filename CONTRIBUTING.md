# Contributing to ZynqOS

Thank you for contributing to ZynqOS. This file explains the expectations for pull requests, commits, code style, and reviews.

## Pull Requests

- Use a short, descriptive title that explains the change.
- Include a summary of what changed, why it changed, and any follow-up work.
- Link the issue number when the PR closes or resolves an issue.
- Add screenshots or screen recordings for UI changes when practical.
- Call out any setup or migration steps reviewers need to know about.

## Commit Messages

- Keep commits focused on a single change when possible.
- Use imperative tense, for example: `fix terminal history wraparound`.
- Prefer concise subjects under 72 characters.
- Avoid noisy WIP commits in the final PR history.

## Code Style

- Keep TypeScript strict and prefer existing project patterns.
- Run `npm run lint` and `npm run format:check` before opening a PR.
- Keep changes small and avoid unrelated refactors.
- Match the current file style unless a lint or build issue requires a fix.

## Test Expectations

- Run `npm run test` for logic changes.
- Run `npm run build` before requesting review.
- Add or update tests when you change behavior in shared utilities or logic.
- Include manual verification steps for UI, WASM, sync, or auth changes when automated coverage is not practical.

## Review Timeline

- Maintainers aim to respond to new PRs and assignment requests within 24 hours when possible.
- Expect a review within a few days for active changes, depending on scope and release pressure.
- If more information is needed, respond quickly so the PR can keep moving.

## Merge and Branch Rules

- `main` is protected: no direct pushes, all changes must come through pull requests.
- Required status checks must pass before merge.
- Project admins do not self-merge; at least one additional reviewer approval is required.
- Reviewers may request an implementation walkthrough when changes are complex or unclear.

## Issue Labels

- Use `bug`, `feature`, `documentation`, `help wanted`, and `good first issue` for contributor-facing issues.
- Every labeled issue should include enough context for a contributor to start without extra clarification.
