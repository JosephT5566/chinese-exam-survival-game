# 國文段考生存戰：命運大富翁 — Product & Engineering Specification

> Status: Core classroom/gameplay decisions confirmed; secondary product decisions pending / Codex handoff  
> Version: 0.4 — 2026-11-18
> Language: Traditional Chinese (zh-TW)  
> Deployment target: Firebase Hosting  
> IMPORTANT: Open decisions are explicitly marked `[待確認]`. Do not silently assume them.

## 0. Instructions for Codex Agent

You are implementing a production-minded, tablet-first classroom quiz game. **First inspect the repository**, summarize existing implementation and gaps, then present a short implementation plan. **Do not deploy, enable billing, change production security rules, or create external resources without explicit user approval.**

- Preserve useful existing behavior when possible; refactor rather than rewrite blindly.
- If an existing prototype is present, inspect its `index.html`, question bank, README, and Firebase integration. The earlier prototype may use Firebase Realtime Database and a `firebaseConfig = null` placeholder. The target architecture is **Cloud Firestore**, not Realtime Database.
- The core decisions in §13 are RESOLVED, including scoring, randomization, teacher-controlled start, full-class leaderboard, and manual retention. Ask only about remaining unresolved choices before implementing dependent features. You may implement independent scaffolding, UI, tests, and local emulator support while awaiting answers.
- Use TypeScript, strict typing, maintainable modules, and automated tests. Prefer a lightweight SPA; do not introduce SSR or paid infrastructure without justification.
- All user-facing copy is in Traditional Chinese appropriate for Taiwan's ninth-grade students.
- Never commit service account keys, access tokens, credentials, `.env.local`, or student personal data. Firebase Web SDK configuration is public client configuration, not a secret.
- If using Firebase CLI, provide commands that work in Windows PowerShell. GitHub is optional; local codebase + Firebase Hosting is supported.
- Explain tradeoffs and expected Firestore read/write behavior before implementing leaderboard synchronization.

## 1. Product Summary

**Name:** 國文段考生存戰：命運大富翁  
**Audience:** Taiwan 國三 students and their Chinese-language teacher  
**Session size:** approximately 30 concurrent students, each with an individual tablet  
**Session duration:** target 20–30 minutes, self-paced  
**Theme:** colorful, playful, party-board-game energy with random events and comeback mechanics; original artwork/UI only, **do not copy Mario characters, logos, music, or protected assets**.

### Product goals

1. Reinforce knowledge from 康軒國文第五冊第 4–6 課 and 語文天地一.
2. Give academically weaker students meaningful participation through luck, partial participation rewards, and readable explanations.
3. Let a teacher start a classroom session, project a live leaderboard, and inspect individual/class results.
4. Support 30 simultaneous tablets without paid infrastructure under typical classroom usage, if feasible.
5. Make future question-bank replacement straightforward without rebuilding the whole app.

### Non-goals for initial release

- Multiplayer avatar movement or a fully animated 3D board.
- Real-money rewards, payments, or advertisements.
- Student email/password accounts.
- High-stakes exam-grade integrity unless trusted server-side scoring is approved.

## 2. Roles & User Journeys

### Student

1. Open shared URL or scan teacher-provided QR code.
2. Enter a classroom room code (or arrive via room-specific link), choose a nickname, and join without creating a conventional account.
3. Authenticate via Firebase Anonymous Authentication in the background.
4. Wait for teacher to start, then answer 40 multiple-choice questions at their own pace.
5. Immediately see answer feedback and an explanation; incorrect answers still earn a small **participation/explanation reward** after the explanation is viewed.
6. After every 3 completed questions, trigger a random luck event (unless a different cadence is confirmed).
7. See personal score/progress and periodically refreshed class ranking.
8. At the end, see results and review incorrect questions.

### Teacher

1. Sign in using **Firebase Authentication Google provider**, with teacher privileges granted only through a trusted pre-provisioned allowlist / admin-owned teacher document; anonymous student auth must not grant teacher privileges.
2. Create a room with a short code and optional room-specific QR link.
3. Display a lobby with joined students and start/pause/end controls.
4. Project a leaderboard suitable for classroom viewing.
5. View participation, progress, scores, question-level statistics, and export results if approved.
6. Reset/archive a room without affecting other rooms.

## 3. Curriculum & Question Bank

Exactly **40 questions**, 10 questions per section:

| Section | Count | Notes |
|---|---:|---|
| 〈生於憂患，死於安樂〉 | 10 | Core meaning, vocabulary, argumentation, reading comprehension |
| 〈以粥養身〉 | 10 | **[待校對]** Teacher will provide source material later; verify official title and text (〈以粥養身〉 vs 〈以粥養生〉) before declaring questions curriculum-accurate |
| 〈獵人〉 | 10 | Text-specific comprehension, characterization, theme |
| 語文天地一：對聯 | 10 | Structure, tone, parallelism, application |

Each question must have:

```ts
type Question = {
  id: string;
  sectionId: string;
  stem: string;
  choices: [string, string, string, string];
  correctChoiceIndex: 0 | 1 | 2 | 3;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceReference?: string;
  verificationStatus: 'pending_source_review' | 'teacher_verified';
};
```

Requirements:

- Each question has exactly one unambiguous correct answer and a helpful explanation.
- Ensure topic coverage, age-appropriate wording, and accessible language.
- Do not treat the previous prototype's generic 〈以粥養身〉/〈獵人〉 questions as textbook-verified.
- Teacher will supply source material later. Until then, mark every item `verificationStatus: pending_source_review`, keep prototype questions as provisional, and do not claim fidelity to the exact 康軒 edition.
- Do not reproduce extensive copyrighted textbook passages in the UI or repository without permission; use original paraphrased questions and brief necessary references.
- Question-bank content should be separated from application logic and easily editable.
- **[已確認]** Each student receives an independently randomized order of all 40 questions and independently shuffled choices. Preserve exactly 10 questions per section; remap the correct answer index after choice shuffling. Persist the per-student question/choice permutation so refresh or reconnect does not reshuffle or invalidate answers.

## 4. Game Mechanics

### Core scoring — confirmed

- Correct answer: **+100 points**. No additional explanation-view reward for a correct answer.
- Incorrect answer: **0 correctness points**; award **+20 points exactly once after the student has viewed the answer explanation**. Simply submitting an incorrect answer must not award the +20 before the explanation-view condition is met.
- Luck event score adjustment: each triggered event awards an integer amount within **−30 to +80 inclusive**. Final event outcomes/probabilities are still `[待確認]`; do not introduce score-affecting mechanics outside this range without approval.
- After every score change, enforce **total score ≥ 0**: `newScore = Math.max(0, oldScore + delta)`.
- Keep score configuration centralized and show a clear score breakdown to students and teacher.
- Ensure duplicate submissions, repeated explanation views, page refresh, and retrying a network request cannot trivially claim points again. Explicitly document the limitations of client-side score trust.

### Luck events

- Trigger after questions 3, 6, 9, …, 39 (13 triggers per student).
- Offer multiple playful outcomes within the confirmed **−30 to +80** scoring bounds: bonus points, small setback, and catch-up boost. Non-point mechanics such as shields require a separately documented interpretation and must not silently violate the scoring bounds.
- Avoid humiliating outcomes or removing all earned progress.
- Avoid infinite re-roll or refresh-based exploitation.
- Show clear event animation and accessible text alternative; respect reduced-motion preference.
- **[待確認]** Whether events affect only the individual or can affect others; proposed default is individual-only to reduce complexity and disputes.

### Progress and leaderboard

- Each student sees their own progress instantly.
- Teacher screen shows room ranking, total joined, active, and completed counts.
- **All 30 students must be able to view the full-class ranking**, not just top 10 or personal rank. Teacher also sees the full ranking. Display nickname, score, and rank; preserve readability on tablets (e.g., scrollable list).
- Class ranking should feel live, but **do not attach 30 clients to a rapidly changing 30-document collection without estimating read costs**.
- Target roughly 10-second leaderboard freshness as a product goal, **not** an instruction to implement polling blindly.
- A single compact leaderboard snapshot document per room, updated at a controlled rate by a trusted actor, is one possible architecture; it requires a clear authority model. Compare alternatives before choosing.
- Display nickname, score, and rank; avoid exposing student UID or other personal information.
- Provide deterministic tie-breaking (e.g., same rank for equal score, then completion time for display order) and document the policy.

## 5. Architecture

### Required Firebase services

- **Firebase Hosting:** deploy static SPA via project default `*.web.app` / `*.firebaseapp.com` domain.
- **Firebase Authentication:** anonymous sign-in for students.
- **Cloud Firestore:** rooms, membership, answer progress, scores, and leaderboard data.
- **Firebase Security Rules:** enforce per-room and per-role access.

### Optional service (decision required)

- **Cloud Functions / trusted backend:** NOT part of initial Spark MVP. A future upgrade may provide authoritative scoring and luck generation and may require Blaze billing. **Do not enable billing without permission.**

### Suggested project structure (adapt to existing repository)

```text
/
  public/                   # static assets and icons
  src/
    app/                    # routing, app shell
    student/                # join, lobby, quiz, results
    teacher/                # auth, room control, dashboard
    components/             # accessible shared UI
    game/                   # rules, scoring, event definitions
    questions/              # curriculum question bank
    firebase/               # SDK init, typed repositories
    types/                  # shared schemas
  tests/
  firestore.rules
  firestore.indexes.json
  firebase.json
  .firebaserc.example       # no hardcoded sensitive project selection
  README.md
  .gitignore
```

Use a current, supported Firebase modular Web SDK. Build must be deployable to Firebase Hosting. Add a local Firebase Emulator workflow for testing rules and room flows if practical.

## 6. Firestore Data Model (Proposed, not final)

```text
rooms/{roomId}
  code, status, createdAt, startedAt, endedAt, ownerUid, questionSetVersion
rooms/{roomId}/players/{studentUid}
  nickname, joinedAt, lastSeenAt, completedCount, score, finishedAt
rooms/{roomId}/players/{studentUid}/answers/{questionId}
  selectedChoice, answeredAt, explanationViewed, awardedPoints
rooms/{roomId}/players/{studentUid}/events/{eventIndex}
  eventType, awardedPoints, createdAt
rooms/{roomId}/public/leaderboard
  updatedAt, entries[]
teachers/{teacherUid}
  authorized: true, createdAt  # provisioned by project owner/admin only; clients cannot create/update
```

**MVP integrity decision (confirmed):** Spark/free-first, formative/fun practice; client-side scoring and luck are acceptable with explicit non-cheat-proof labeling. Do not implement Cloud Functions or require Blaze for v1.

**Security caveat:** In a client-only architecture, a malicious client can falsify answer outcomes, scores, and luck results unless those values are validated by a trusted backend. Firestore rules can restrict who writes which documents and validate field shapes/ranges, but cannot fully verify arbitrary quiz scoring and randomness. Do not label client-only scores as cheat-proof.

**Answer-key caveat:** Any correct answers shipped to browser JavaScript can be inspected by a determined student. A truly authoritative assessment needs server-side answer verification and a protected question bank.

**Teacher auth decision (confirmed):** Use Google sign-in for teachers; require a pre-provisioned `teachers/{uid}` allowlist entry or equivalent admin-owned claim. Do not let a signed-in user self-register as teacher or write `authorized: true`. Document the one-time console bootstrap (find teacher UID after Google login, project owner manually creates allowlist record). Firestore rules must prevent clients from changing allowlist entries.

## 7. Security & Privacy

- Students can join only open rooms; enforce room status and membership checks.
- A student can read/write only their own private answer data, subject to allowed transitions.
- Teacher can access only rooms they own or are explicitly authorized to manage.
- Public leaderboard exposes nickname and score only; no private answers, email, IP, or UID in UI.
- Validate nickname length and disallow HTML injection; render as text, not raw HTML.
- Prevent duplicate answers and repeated event claims to the extent supported by selected architecture.
- Rate-limit or mitigate abuse where feasible; identify limits of anonymous authentication.
- Do not collect legal names, student numbers, emails, or other unnecessary personal data.
- **[已確認]** Teacher manually deletes room data, with a recommended cleanup within **30 days**. Do not implement automatic TTL/automatic deletion for MVP. Provide a teacher-visible reminder or instructions; manual deletion must cover nested student answers/events as well as room metadata, with a tested safe deletion workflow.
- Firestore production mode defaults to restrictive rules; never publish `allow read, write: if true` as a shortcut.
- Test rules with Firebase Emulator before production deployment.

## 8. Cost & Capacity Targets

- Target 30 concurrent tablets, 40 answers each, approximately 13 events per student, 20–30 minutes per session.
- Prefer Firebase Spark free plan for initial MVP if the accepted security model permits it.
- Firestore reads are billed per document delivery; real-time listeners may incur a read for each changed document delivered to each listener. Initial loads/reconnections also count.
- Provide a cost worksheet estimating reads/writes per session and per day, including teacher dashboard and 30 clients, and identify worst-case patterns.
- Optimize subscriptions and batch/aggregate where appropriate; do not assume that 10-second refresh alone makes Firestore reads cheap.
- No guaranteed NT$0 claim: actual billing depends on usage, enabled services, and quotas.

## 9. UX & Accessibility

- Responsive portrait-first tablet layout, also functional on phones and teacher projector/desktop.
- Large touch targets, readable Chinese typography, strong contrast, clear progress feedback.
- Visually fun, board-game-inspired style with original assets and animations.
- Provide loading/error/empty states, reconnection notices, and a safe refresh/resume path.
- Avoid exposing correct answer before the student submits.
- Disable double submission; recover safely after network interruption.
- Keep ranking celebratory rather than shaming; consider displaying progress or achievement badges in addition to rank.
- Respect `prefers-reduced-motion` and keyboard navigation where possible.

## 10. Functional Acceptance Criteria

### Student flow

- [ ] A student opens the room URL/QR, chooses a nickname, and joins anonymously.
- [ ] 30 distinct students can join the same room without account creation.
- [ ] Student cannot join a closed/ended room as a new participant.
- [ ] Student answers 40 questions, receives explanations, and sees accurate local progress.
- [ ] Correct answer gives exactly +100; incorrect answer gives +20 only after viewing explanation; each explanation reward can be claimed only once.
- [ ] Luck event delta is between −30 and +80 inclusive; score never falls below zero.
- [ ] Each student gets a stable, independently shuffled question order and choice order, including correct-answer remapping; reload preserves the order.
- [ ] Exactly 13 luck events are available per completed 40-question run; refresh cannot trivially claim the same event twice.
- [ ] Refresh/reconnect restores the student's progress without duplicate scoring.
- [ ] Student can review incorrect answers after completion.

### Teacher flow

- [ ] Unauthorized users cannot access teacher controls or private class results.
- [ ] Teacher creates a room and obtains a short join code and shareable link.
- [ ] All 30 students can see the full-class ranking; teacher sees the full-class ranking as well.
- [ ] Teacher can manually delete room data and all nested records, with a recommended 30-day cleanup reminder.
- [ ] Teacher must explicitly press Start before any student can begin answering; after Start, students answer independently at their own pace.
- [ ] Teacher can start, pause, end, and archive a room; students receive appropriate state updates.
- [ ] Teacher can display ranking and see individual progress and class summary.
- [ ] Ranking updates at the approved freshness target and stays correct under simultaneous answers.
- [ ] Teacher can distinguish incomplete from completed runs.

### Quality / operational

- [ ] App builds successfully and can deploy to Firebase Hosting.
- [ ] Firestore rules tests cover unauthorized access, cross-student access, teacher access, duplicate answer attempts, and room state transitions.
- [ ] Simulate 30 concurrent clients or equivalent load to assess write contention and leaderboard behavior.
- [ ] No service account key or other secret appears in client bundle/repository.
- [ ] README includes Windows PowerShell setup, emulator, build, deployment, rollback, and troubleshooting steps.
- [ ] Teacher has a simple first-classroom test checklist.

## 11. Implementation Phases

**Phase 0 — Audit and decisions**
- Inspect current code and Firebase project assumptions.
- Use all confirmed decisions in §13; resolve only remaining blocking dependencies. Do not re-propose scoring, question order, start control, full-class leaderboard visibility, or manual retention.
- Produce a short architecture and Firestore cost estimate.

**Phase 1 — Offline/local game**
- Refactor question bank, student flow, explanations, score rules, luck events, and responsive UI.
- Add unit tests for scoring and question validation.

**Phase 2 — Firebase integration**
- Add Firebase modular SDK, anonymous auth, teacher auth, rooms, Firestore data model, resumable progress, and rules tests.
- Use local emulator and test accounts first.

**Phase 3 — Live classroom experience**
- Implement lobby, teacher controls, leaderboard, completion summary, and reconnection handling.
- Validate 30-client behavior and estimated read volume.

**Phase 4 — Launch**
- Teacher approves security rules and deployment target.
- Deploy to Firebase Hosting using CLI or another explicitly approved deployment path.
- Verify HTTPS URL, generate room join QR, and test with 2–3 devices before 30-device rehearsal.

**Phase 5 — Content and iteration**
- Teacher supplies source material and verifies all 40 questions against the intended edition before curriculum-verified release; provisional game can be tested earlier.
- Tune event probabilities, scoring, UI, and classroom flow based on testing.

## 12. Deliverables

1. Working source repository with TypeScript app and modular components.
2. All 40 questions in structured, editable format, with verification status per section.
3. `firestore.rules` and automated security rule tests.
4. `firebase.json`, deployment configuration, and Windows setup instructions.
5. Teacher/admin dashboard and student gameplay UI.
6. Cost/read-write estimate and a short security limitations document.
7. QA checklist for 30 tablets and an example classroom facilitation script.
8. Once deployed, actual Hosting URL and generated QR image (not a placeholder URL).

## 13. Decision Register — Confirmed vs Pending

### Confirmed by teacher (2026-11-18)

1. **Teacher sign-in: DECIDED.** Firebase Authentication Google provider. Teacher authorization is separate: an admin-owned UID allowlist (e.g. `teachers/{uid}`), never self-service elevation. Codex must document manual bootstrap in Firebase Console and test denial for unapproved Google accounts.
2. **Integrity and billing: DECIDED.** Initial release is a **Spark-first, no-paid-backend, formative/fun MVP**. Client-side score and luck calculations are acceptable despite cheating risk. Prevent casual duplicate submissions with Firestore rules and transactions where possible; clearly document remaining vulnerabilities. No Cloud Functions, Blaze upgrade, or billing activation without new approval.
3. **Curriculum source: DECIDED.** Teacher will provide textbook/handout material **later**. All 40 questions are provisional and flagged `pending_source_review`; do not claim 康軒 edition accuracy. Preserve a simple review workflow for later teacher approval, especially disputed title 〈以粥養身〉/〈以粥養生〉.
4. **Deployment: DECIDED.** Firebase Hosting, Cloud Firestore, Firebase Auth. GitHub is optional, not a prerequisite. Windows + Firebase CLI is a supported default deployment route; do not deploy without approval.
5. **Scale: DECIDED.** Target 30 concurrent students, ~40 questions, ~20–30 minute session, ~13 luck events per student.
6. **Scoring: DECIDED.** Correct +100; wrong +20 **only after viewing explanation**; each luck event delta is **−30 to +80**; total score never below 0. Award each reward at most once.
7. **Randomization: DECIDED.** Randomize question order and choice order independently per student; persist stable permutations across refresh and remap answer keys.
8. **Start control: DECIDED.** Teacher presses Start to begin the session; afterward students answer independently at their own pace.
9. **Leaderboard visibility: DECIDED.** Students and teacher can see **all 30 players' rankings**. Design for readable tablet display and cost-efficient updates; do not revert to top 10.
10. **Retention: DECIDED.** Teacher manually deletes room data; recommend cleanup within 30 days. No automatic deletion requirement in MVP; deletion must include nested data.

### Confirmed during Firestore rules design (2026-11-18)

- **Leaderboard synchronization: DECIDED.** Teacher aggregates changed player data at most every 10 seconds; students listen to the public snapshot and see all 30 players. Teacher must stay online; display the last update time. Personal score/progress remain immediate. Implementation uses two atomically updated documents of up to 15 entries each to stay within rules evaluation limits; frontend combines only matching timestamps and derives ranks from ordered nickname/score entries.
- **Student join format: DECIDED.** Six uppercase alphanumeric characters for room codes, nickname length 2–12 characters.
- **Late join: DECIDED.** New participants may join only while the room is in lobby. Existing participants can restore their saved state afterward.
- **Pause behavior: DECIDED.** Pause blocks new answer submissions, explanation rewards and luck claims. Existing submitted explanations remain readable; pending rewards can be submitted after resume.

### Pending — secondary decisions only; defaults are proposals, not approvals

| Priority | Topic | Proposed default | Why it matters |
|---|---|---|---|
| P1 | Results export | Teacher CSV export in v1 | Teacher workflow, privacy |
| P1 | Room scope | One teacher and one active room for MVP; design schema to allow future rooms | Complexity |
| P2 | Music / sound effects | Muted by default; original/license-cleared only | Accessibility, licensing |

### Implementation clarification: Firestore cost and trust model

- Avoid presenting a periodically updated shared leaderboard snapshot as free/automatic: a trusted aggregation actor is required to prevent student score manipulation; client-side room snapshots must not permit students to overwrite other students' ranking data.
- For the Spark MVP, prefer a simple, explicitly costed approach: each student writes only their own progress/score document, teachers read room players, and students may subscribe to a limited leaderboard query. Test read amplification for 30 clients and 40 updates each. If this exceeds target, propose a safe, low-cost alternative before coding it.
- Firebase Security Rules can enforce field allowlists, ownership, document immutability for answers, score bounds and room status, but **cannot prove that a client selected the correct answer or received a random event honestly**. Do not imply otherwise.
- The initial leaderboard is motivational, not an exam-grade authoritative score report. Do not expose answer keys through private teacher-only Firestore documents to anonymous users; if answer keys ship in the client bundle, document their visibility.

## 14. Immediate Next Action for Codex

1. Request the existing project/repository or ZIP and Firebase Web SDK `firebaseConfig` if not yet supplied; never request service-account private keys.
2. **Do not re-ask confirmed decisions in §13, including the Firestore rules design additions.** Remaining secondary decisions include CSV export, room scope, luck-event distribution/effects, and audio.
3. Inspect the existing prototype, report current implementation vs requirements, and produce an incremental plan with Firestore rule tests and estimated per-session read/write costs.
4. Implement independent scaffolding and tests while waiting for remaining choices. Require explicit approval before deployment, changing live security rules, or enabling any paid service.
5. Do not claim real-time sync, secure teacher authorization, or Hosting deployment is complete until tested and verified.
