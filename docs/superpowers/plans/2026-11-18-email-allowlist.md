# Email allowlist implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans, then use a fresh reviewer for the completed branch.

**Goal:** Authorize teachers by verified Google email and reconcile the allowlist from GitHub vars during main deployments.

**Architecture:** Firestore `teacherEmails/{lowercase-email}` holds `authorized: true`. Google token email selects the authorization record while UID still owns classroom data. The administrator CLI supports additive email grants and authoritative environment reconciliation; deployment synchronizes data, publishes rules, then Hosting.

**Tech stack:** Existing TypeScript/Firebase client, Firestore rules, Node.js built-ins, GitHub Actions OIDC.

**Spec:** [Issue #4](https://github.com/JosephT5566/chinese-exam-survival-game/issues/4), approved by JosephT5566 on 2026-11-18 in chat.

## Global constraints

- Preserve student identity, private data, room ownerUid, scoring, lifecycle, and local demo behavior.
- Verified Google tokens only; clients cannot write or enumerate the allowlist.
- `TEACHER_EMAILS` is a JSON array, passed via step env, never VITE\_\* or shell interpolation.
- Missing/malformed config fails before production changes; explicit `[]` revokes all email grants.
- Do not change production IAM, rules, or data during implementation. Never merge automatically.

## Review focus

- Mixed-case emails resolve identically in rules, client, CLI, and deployment.
- New accounts can be preauthorized; an old UID document alone grants nothing.
- Sync revokes removed addresses, handles pagination and repeat runs, and commits atomically.
- Unverified/non-Google users and other-address reads remain denied.
- Deployment is main-only; config validation precedes production mutations; cross-service failures are documented.

## Task 1: Email authorization contract

Files: `firestore.rules`, `src/firebase/classroom.ts`, `src/app/cloud.ts`, `tests/rules/classroom.test.ts`, `tests/rules/unprivileged.test.ts`, `tests/integration/classroom.test.ts`, `tests/browser/classroom.spec.ts`.

- [x] Add failing rules coverage for verified email, casing, other providers, missing claims, old UID grants, and private allowlist access.
- [x] Change Classroom to accept `{ uid, email }` from Firebase Auth instead of a UID primitive; normalize only the authorization key. Update every caller.
- [x] Route rules and client authorization to teacherEmails; retain ownerUid and other contracts.
- [x] Run rules tests and integration/browser checks with updated synthetic email fixtures.

## Task 2: Administrator CLI and deployment

Files: `scripts/authorize-teachers.mjs`, `scripts/setup-hosting-identity.sh`, `.github/workflows/ci.yml`, `tests/unit/teacher-config.test.ts`, `tests/integration/classroom.test.ts`.

- [x] Add failing configuration tests and emulator reconciliation coverage for pre-login grants, removal, dry-run, explicit clear, invalid values, repeated runs, and size limits.
- [x] Keep existing additive `--email` mode; add `--sync-env` and offline `--validate-env`. Bound desired/existing sets to 100. Validate project, mode, and email document IDs before network access.
- [x] Read and reconcile the complete collection in a Firestore transaction with one atomic commit. Use OIDC access token in CI, local gcloud token otherwise, and owner token only with the fixed demo emulator project. Print counts, not email lists or credentials, in sync mode.
- [x] Validate vars before authentication/mutations; add sync and rules deployment before Hosting, preserving concurrency/latest-main guards. Extend the administrator-run identity setup script with the documented permissions.
- [x] Run unit and emulator reconciliation tests, inspect workflow structure, and shell-check the setup script.

## Task 3: Handoff and verification

Files: README.md, docs/firestore-contract.md, docs/architecture.md, docs/firebase-setup.md, docs/hosting-auto-deploy.md, src/firebase/README.md, AGENTS.md, and affected skill guidance.

- [x] Document vars setup, preauthorization, collection change, ignored UID records, authoritative removal, IAM scope, rollout failures, and separate rollback of rules/data.
- [x] Run npm run check, npm run test:rules, npm run test:integration, npm run test:browser; inspect browser artifacts.
- [x] Format/check changed Markdown and run git diff --check.
- [x] Obtain independent review and fix supported findings.
- [ ] Open an evidence-backed PR linked to #4 and leave issue status. Do not merge.

## Verification and handoff

- Independent review found no correctness/security blockers. Fixed the identified dangling phrase in the Firebase guide.
- Scripted browser checks captured the waiting screen showing email, the preauthorized teacher console, and existing teacher/student outcomes in git-ignored `test-results/`.
- Formal IAM, production rules/data, real OAuth, and classroom load remain unverified and unchanged by this task.
