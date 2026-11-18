# Firestore client implementation plan

Execute inline under the user's instruction to proceed through PR creation.
Spec: `docs/superpowers/specs/2026-11-18-firestore-client-design.md`.

1. Add failing unit tests for config safety, remote data parsing, question-40
   recovery, and mixed-version leaderboard buffering. Implement validated cloud
   models and config. Verify with `npm test` and `npm run typecheck`.
2. Add real Emulator integration tests for room creation, join/resume, duplicate
   answer/explanation transactions, pause/end rejection, private-data isolation,
   and paired leaderboard publication. Implement `Classroom` in
   `src/firebase/classroom.ts`; verify with `npm run test:integration`.
3. Add role-isolated Firebase Auth initialization and cloud UI for the approved
   classroom flow. Keep the old client in `src/app/demo.ts` and choose the entry
   using validated config. Verify in a running browser against Auth/Firestore
   Emulators, including separate teacher/student sessions and refreshed progress.
4. Add a rerunnable admin teacher authorization tool with dry-run default and
   explicit apply, update deployment config inputs and docs. The tool must only
   act on explicitly supplied emails and existing Google-provider users, keeping
   the two personal teacher emails out of the public repository.
5. Run repository checks, all rules and client integration tests, browser QA,
   then independent branch review, resolve important findings, commit, push the
   feature branch, and open a PR. Do not merge or deploy.

## Review focus

Missing own-player reads before membership; resumed question 40 with unclaimed
explanation; duplicate submission from two tabs; independently delivered rank
pages and listeners after switching rooms; authorization revoked after login;
CI build must actually include public Firebase config.

## Execution record

- Baseline: `npm test`, 9 tests passed. Clean checkout on main.
- Decision: work in the existing checkout on a feature branch, preserving the
  user's instruction to proceed without another approval round.

- Task 1: complete. Unit boundaries and recovery tests, 13 total unit tests pass.
- Task 2: complete. Real Auth/Firestore SDK integration covers join, duplicate
  operations, final explanation and administrator provisioning.
- Task 3: browser tests exposed and verified a join-form event bug: generic
  button handling replaced the form before its native submit event. Submit
  buttons now reach the form handler. Full 40-question browser flow passed.
- Review: independent reviewer identified stale final ranks and multiple tab
  publishers. Both addressed with shared snapshot/status reads in a transaction.
- Decision: closing a classroom flushes final ranks outside the ordinary
  10-second interval. This costs at most one additional paired snapshot for a
  changed final result; it prevents freezing stale final standings.

- Task 4: complete. Dry-run/apply provisioning is covered by real Emulator
  tests, including repeated application and missing users. Public production
  Web config is included in CI builds; no privileged credentials are committed.
- Browser regression: rank delivery removed keyboard focus; reproduced in
  Chrome and fixed by restoring focus only for the same displayed question.
- Browser regression: dependent room listeners did not reliably refresh the UI
  on allowlist revocation. Added an explicit own-authorization subscription that
  tears down room listeners and hides controls when access is revoked.
- Final verification: `npm run check` passed, 13 unit tests and production
  build. Clean Emulator runs passed 62 rules tests, 4 client integration tests,
  and 2 Chrome browser tests including all 40 questions, offline recovery,
  keyboard focus, room switching and teacher authorization revocation. Visual
  inspection confirmed student summary and teacher archived-room layouts.
- Independent review's two important publication findings and focus issue are
  fixed; no review findings were deferred. Production Google interactive login
  and the two real teacher grants still require the teachers' first login.
