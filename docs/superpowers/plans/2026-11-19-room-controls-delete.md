# Room controls and deletion implementation plan

Goal: implement issue #8 with consistent 房間 wording, focused teacher controls, running-state restrictions, and resumable deletion in cloud/demo.

Spec: https://github.com/JosephT5566/chinese-exam-survival-game/issues/8

Execution: native in this session, authorized by owner. Independent review waits for explicit owner instruction. No merge, deployment, production writes, or paid backend.

Architecture: mark rooms deleting with an atomic retired-code record and join-index removal. Drain known collections in bounded batches, children before parents, then atomically remove the room and mark its retired code completed. The permanent marker contains room ID, owner UID and deletion state, no student data, and permits confirmed retries after the room disappears. Demo uses its existing per-room Web Lock with a persistent tombstone. Shared teacher controls render status, actions and a stable native confirmation dialog.

Implementation choices, not claims of prior owner selection: use option B, deletion at the bottom of room details, to match the request for important information only; retire codes indefinitely to prevent old links entering new rooms. Existing issue approvals for unrelated unresolved proposals are not fabricated.

Constraints: Node 24, Java 21, demo-chinese-exam emulators only. Preserve verified Google/email allowlist, anonymous students, private answers, rewards, timers, ranking, separate Auth storage, storage keys and question bank. Browser cleanup guarantees discoverable schema paths under the normal owner workflow; rules do not prove subcollection emptiness against a malicious owner. Unknown pre-existing orphan paths require admin tooling.

## Tasks

- [x] 1. Cloud lifecycle and rules. Add failing rules and SDK tests for authorized ownership, allowed states, atomic index retirement, interrupted/concurrent cleanup, missing data, legacy rooms, stale writers and other-room isolation. Implement deleting parsing, bounded raw cleanup and durable completion markers. Verify rules/integration.
- [x] 2. Demo deletion. Add tests for tombstone and DEMO01 create fallback, queued writers, scoped identity cleanup and new-code creation. Implement using existing Web Lock. Verify units.
- [x] 3. Teacher UX. Add browser coverage for running disabled controls, student continuity, pause/resume/end, destructive confirmation, retry, reload and mobile layout. Implement option B with collapsed secondary information, native dialog, status colors and busy feedback. Keep dialog DOM outside rerendered content and stop only room subscriptions on deletion. Verify browser suite.
- [x] 4. Documentation and evidence. Update README, SPEC, firestore-contract, pixel-frontend and architecture. Run check, rules, integration, browser and diff checks. Inspect desktop/mobile/tablet screenshots. Report actual results and pending review.

## Review focus

- Missing or mismatched index must never delete another room's mapping.
- Revoked authorization during cleanup stops the next write and preserves recovery.
- Deleting/missing/malformed rooms must not break the owner's other room list.
- Lost final response and concurrent deletion must converge using the durable marker, not permission errors.
- Timer expiry, pending target-score operations and stale publisher callbacks must not recreate deleted data.

## Progress

Starting commit: fa92c59a1b1451180f23487fa0752003923fad4d. Clean working directory before branch creation. Dependency installation initially failed in the restricted network and succeeded on the authorized retry. Initial unit run confirmed the new deletion test failed because deleteRoom did not exist; initial rules run confirmed the missing retirement transition. No clean-main full-suite baseline was completed before adding tests.


## Validation evidence

Final branch: `codex/issue-8-room-controls-delete`.

- `npm run check`: passed, strict types, generated rules consistency, 56 unit tests and production build. Vite retains a large cloud-chunk advisory.
- `npm run test:rules`: 79 passed.
- `npm run test:integration`: 16 passed.
- `PLAYWRIGHT_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser`: 5 passed. Downloaded Playwright Chromium was unavailable, so the documented installed-browser option was used.
- `git diff --check`: passed.
- Visual verification: inspected final 1024px cloud running screenshot and 390px cloud/demo deletion dialogs; no horizontal overflow in asserted mobile cases. Artifacts are under git-ignored `test-results/`.
- Browser cases cover normal student answers and rewards while teacher controls are restricted, pause/resume/end, cancel and typed delete confirmation, another room remaining intact, student termination, reload and demo tombstone behavior. SDK/rules cover authorization, batches, concurrency, legacy and missing/mismatched indexes.
- A full browser run during live source edits encountered a popup login failure. The isolated case passed, and the final full run without source edits passed all five cases.
- Independent review: not started, explicitly waiting for owner instruction. No deployment, production data writes, merge or live teacher authorization. Auth and rules tests use demo-chinese-exam only.

Implementation decisions remain visible for owner review: option B, permanent retired codes, and normal-client cleanup of discoverable schema paths rather than a claim that rules prove zero descendants. Formal A/B selection and any broader security guarantee are not fabricated. No global room lock was added.


## PR #11 review fixes

Owner requested fixing both independent review findings. Browser regressions first reproduced duration reset from 37 to 20 after a student joined, and false completion after failures removing either the room save or shared identity key.

- Persist demo tombstones as deleting before cleanup and completed only after every step succeeds. Old deleted markers are classified by remaining raw room/identity keys. Pending state and Continue survive reload; the retirement barrier remains active. Unit tests also cover failure writing the final completion marker.
- Keep the teacher's unsaved duration draft and focused input across roster renders. Clear the draft after successful application or leaving the lobby. Browser assertions verify focus, value and persisted duration after reload.
- Final local checks: check passed with 58 unit tests and production build; rules 79 passed; integration 16 passed; browser 8 passed with installed Chrome. Added focused browser tests went RED then GREEN. Diff whitespace check passed. Mobile pending-deletion feedback was inspected.
- No new independent review, merge, deployment or production data mutation was performed as part of these fixes. Original review threads receive commit/test evidence for reviewer confirmation.
