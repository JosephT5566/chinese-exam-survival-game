# 國文段考生存戰：命運大富翁 — Product & Engineering Specification

> Status: Core classroom/gameplay decisions confirmed; secondary product decisions pending / Codex handoff  
> Version: 0.5 — 2026-11-18 (Issue #6 rules v2)
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
**Session duration:** teacher-selected 1–60 integer minutes (default 20); classroom target 20–30 minutes, self-paced

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
5. See answer feedback and an optional explanation. A wrong answer earns no points and blocks the next question for 3 seconds; reading explanations earns no points.
6. After each correct answer, choose one of three visually identical blind treasure boxes, reveal its outcome, then settle it. Steal/swap outcomes require another player as a target when peers exist.
7. See personal score/progress and periodically refreshed class ranking.
8. At the end, see results and review incorrect questions.

### Teacher

1. Sign in using **Firebase Authentication Google provider**, with teacher privileges granted only through a trusted pre-provisioned allowlist / admin-owned teacher document; anonymous student auth must not grant teacher privileges.
2. Create a room with a short code, shareable URL and locally generated expandable QR. Set its duration in the lobby before starting.
3. Display a lobby with joined students and start/pause/end controls.
4. Project a leaderboard suitable for classroom viewing.
5. View participation, progress, scores, question-level statistics, for classroom review.
6. Reset/archive a room without affecting other rooms.

## 3. Curriculum & Question Bank

Exactly **40 questions**, 10 questions per section:

| Section                | Count | Notes                                                                                                                                                                 |
| ---------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 〈生於憂患，死於安樂〉 |    10 | Core meaning, vocabulary, argumentation, reading comprehension                                                                                                        |
| 〈以粥養身〉           |    10 | **[待校對]** Teacher will provide source material later; verify official title and text (〈以粥養身〉 vs 〈以粥養生〉) before declaring questions curriculum-accurate |
| 〈獵人〉               |    10 | Text-specific comprehension, characterization, theme                                                                                                                  |
| 語文天地一：對聯       |    10 | Structure, tone, parallelism, application                                                                                                                             |

Each question must have:

```ts
type Question = {
  id: string;
  sectionId: string;
  stem: string;
  choices: [string, string, string, string];
  correctChoiceIndex: 0 | 1 | 2 | 3;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  sourceReference?: string;
  verificationStatus: "pending_source_review" | "teacher_verified";
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

### Timed session — Issue #6 confirmed

- New rooms use `rulesVersion: 2`. Teacher selects an integer duration from **1–60 minutes**, default **20**, while the room is in the lobby.
- Teacher Start begins the countdown. Pause preserves remaining time; Resume continues it. Pause blocks answers, chest opening and chest settlement; submitted explanations remain readable.
- At zero remaining time, students become read-only even if the teacher is offline. An online teacher ends the room and publishes final ranking. An expired or ended room cannot restart.
- Existing cloud rooms without the v2 rules marker remain read-only for review; do not migrate or reinterpret their saved scores. Local v2 storage is separate from v1 storage and does not overwrite it.

### Answers and treasure boxes — Issue #6 confirmed

- Correct answers award **no immediate points**. Show **three visually identical blind boxes inline**. One selection reveals and persists one outcome; refreshing or retrying cannot redraw it.
- Incorrect answers award **0 points** and impose a **3-second freeze** before continuing. Explanation reading is optional and awards **0 points** for either correct or incorrect answers.
- The final correct answer completes only after its chest is settled. The final incorrect answer completes only after its freeze expires. Room expiry stops any still-pending action.
- Configuration lives in `src/game/config.ts`; `src/game/rewards.ts` supplies shared drawing, score settlement and timer calculations.

| Outcome | Probability | Effect                                                                      |
| ------- | ----------: | --------------------------------------------------------------------------- |
| Gain    |         50% | +20 / +50 / +80, with conditional weights 30% / 50% / 20%                   |
| Steal   |         20% | Choose another player; transfer `min(100, target score)` to self            |
| Swap    |         10% | Choose another player; exchange both players' current scores                |
| Loss    |         20% | −10 / −20 / −30, with conditional weights 50% / 30% / 20%; clamp score at 0 |

- With no other player, steal/swap becomes **+20**. A peer with zero points is still a valid target; zero score does not permit the solo fallback.
- Target effects use both scores at settlement time and atomically update both public score documents. Do not modify or expose the target's private player/answer data.
- Opening and settlement are separate persisted operations. A settled chest cannot pay twice; selecting another box, retrying or refreshing cannot change its saved outcome. Score bounds are **0–96,000** (30 × 40 × 80).
- Each correct answer offers one chest, up to 40 per player. The prior every-third-question event cadence and +100/+20 answer rewards are superseded.
- Randomness and answer correctness still run on the client. Transactions and rules prevent ordinary duplicate rewards; they do not make the game tamper-proof.

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

## 6. Firestore Data Model

The current schema and atomic transitions are defined in [Firestore contract](docs/firestore-contract.md). The high-level v2 separation is:

```text
rooms/{roomId}
  lifecycle, ownerUid, rulesVersion, duration and countdown timestamps, playerCount
rooms/{roomId}/players/{studentUid}
  PRIVATE nickname, stable permutations, progress, pending chest and cooldown state
rooms/{roomId}/players/{studentUid}/answers/{questionId}
  PRIVATE answer feedback and persisted chest reveal/settlement
rooms/{roomId}/scores/{studentUid}
  ROOM-MEMBER-READABLE nickname, score, lastOperation
rooms/{roomId}/public/leaderboard
rooms/{roomId}/public/leaderboard2
  teacher-published nickname/score snapshots (up to 15 entries each)
teacherEmails/{lowercaseEmail}
  authorized: true  # administrator-managed; clients cannot self-authorize
```

Joining atomically creates private progress plus a public score and increments `playerCount` once. Rules enforce the **30-player cap** and lobby-only joining. Existing members may restore their identity and progress later. Public scores support target selection; they do not grant access to peers' private data. Old cloud v1 rooms remain read-only without migration.

**MVP integrity decision (confirmed):** Spark/free-first, formative/fun practice; client-side scoring and luck are acceptable with explicit non-cheat-proof labeling. Do not implement Cloud Functions or require Blaze for v1.

**Security caveat:** In a client-only architecture, a malicious client can falsify answer outcomes, scores, and luck results unless those values are validated by a trusted backend. Firestore rules can restrict who writes which documents and validate field shapes/ranges, but cannot fully verify arbitrary quiz scoring and randomness. Do not label client-only scores as cheat-proof.

**Answer-key caveat:** Any correct answers shipped to browser JavaScript can be inspected by a determined student. A truly authoritative assessment needs server-side answer verification and a protected question bank.

**Teacher auth decision (confirmed):** Use verified Google sign-in plus administrator-managed `teacherEmails/{lowercaseEmail}.authorized == true`. Google sign-in alone grants no teacher permission. Clients cannot self-authorize or change allowlist entries; room ownership remains bound to UID. See [README](README.md#老師授權) for administrator setup.

## 7. Security & Privacy

- Students can join only open rooms; enforce room status and membership checks.
- A student can read/write only their own private answer data, subject to allowed transitions.
- Teacher can access only rooms they own or are explicitly authorized to manage.
- Public leaderboard exposes nickname and score only; no private answers, email, IP, or UID in UI.
- Validate nickname length and disallow HTML injection; render as text, not raw HTML.
- Prevent duplicate answers and repeated event claims to the extent supported by selected architecture.
- Rate-limit or mitigate abuse where feasible; identify limits of anonymous authentication.
- Do not collect legal names, student numbers, emails, or other unnecessary personal data.
- **[已確認]** Teacher manually deletes room data, with a recommended cleanup within **30 days**. Do not implement automatic TTL/automatic deletion for MVP. Provide a teacher-visible reminder or instructions; manual deletion must cover nested student answers/scores and public ranking snapshots as well as room metadata, with a tested safe deletion workflow.
- Firestore production mode defaults to restrictive rules; never publish `allow read, write: if true` as a shortcut.
- Test rules with Firebase Emulator before production deployment.

## 8. Cost & Capacity Targets

- Target 30 concurrent tablets, 40 answers each, up to 40 chest reveals/settlements per student, teacher-selected 1–60 minutes per session.
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
- [ ] Correct answers offer three blind boxes with the approved outcome probabilities; answers and explanation reading award no direct points.
- [ ] Incorrect answers freeze progression for 3 seconds. Final-question completion respects pending chest settlement or freeze expiry.
- [ ] Steal/swap settles current scores atomically, allows zero-score targets, rejects self-targets, and uses +20 fallback only when no peer exists.
- [ ] Loss clamps at zero; all scores stay within 0–96,000.
- [ ] Each student gets a stable, independently shuffled question order and choice order, including correct-answer remapping; reload preserves the order.
- [ ] Each correct answer allows one chest; refresh preserves the chosen box/outcome and cannot claim it twice.
- [ ] Refresh/reconnect restores the student's progress without duplicate scoring.
- [ ] Student can review incorrect answers after completion.

### Teacher flow

- [ ] Unauthorized users cannot access teacher controls or private class results.
- [ ] Teacher creates a room with a short join code, native share/copy actions, and an expandable QR generated locally without a remote QR service.
- [ ] Teacher can set 1–60 integer minutes in the lobby, pause/resume preserves remaining time, and timeout blocks further answers/chest actions even while the teacher is offline.
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

目前 repository 提供像素風本機示範與 Firebase 雲端流程。正式登入、部署、資料刪除與 30 台裝置效能需另行驗收；本文件的驗收清單不代表已通過。

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

1. **Teacher sign-in: DECIDED.** Firebase Authentication verified Google provider plus administrator-managed lowercase-email `teacherEmails` authorization, never self-service elevation. Preserve room UID ownership and denial for unapproved Google accounts.
2. **Integrity and billing: DECIDED.** Initial release is a **Spark-first, no-paid-backend, formative/fun MVP**. Client-side score and luck calculations are acceptable despite cheating risk. Prevent casual duplicate submissions with Firestore rules and transactions where possible; clearly document remaining vulnerabilities. No Cloud Functions, Blaze upgrade, or billing activation without new approval.
3. **Curriculum source: DECIDED.** Teacher will provide textbook/handout material **later**. All 40 questions are provisional and flagged `pending_source_review`; do not claim 康軒 edition accuracy. Preserve a simple review workflow for later teacher approval, especially disputed title 〈以粥養身〉/〈以粥養生〉.
4. **Deployment: DECIDED.** Firebase Hosting, Cloud Firestore, Firebase Auth. GitHub is optional, not a prerequisite. Windows + Firebase CLI is a supported default deployment route; do not deploy without approval.
5. **Scale: DECIDED.** Maximum 30 joined students, 40 questions; teacher selects 1–60 minutes (default 20), with classroom target 20–30 minutes.
6. **Scoring: SUPERSEDED BY ISSUE #6.** Follow §4 v2 chest probabilities, target transfers, 3-second wrong-answer freeze and no explanation rewards. Award each chest settlement at most once.
7. **Randomization: DECIDED.** Randomize question order and choice order independently per student; persist stable permutations across refresh and remap answer keys.
8. **Start control: DECIDED.** Teacher presses Start to begin the session; afterward students answer independently at their own pace.
9. **Leaderboard visibility: DECIDED.** Students and teacher can see **all 30 players' rankings**. Design for readable tablet display and cost-efficient updates; do not revert to top 10.
10. **Retention: DECIDED.** Teacher manually deletes room data; recommend cleanup within 30 days. No automatic deletion requirement in MVP; deletion must include nested data.

### Confirmed during Firestore rules design (2026-11-18)

- **Leaderboard synchronization: DECIDED.** Teacher aggregates changed player data at most every 10 seconds; students listen to the public snapshot and see all 30 players. Teacher must stay online; display the last update time. Personal score/progress remain immediate. Implementation uses two atomically updated documents of up to 15 entries each to stay within rules evaluation limits; frontend combines only matching timestamps and derives ranks from ordered nickname/score entries.
- **Student join format: DECIDED.** Six uppercase alphanumeric characters for room codes, nickname length 2–12 characters.
- **Late join: DECIDED.** New participants may join only while the room is in lobby. Existing participants can restore their saved state afterward.
- **Pause behavior: DECIDED.** Pause saves countdown remaining time and blocks new answers, chest opening and settlement. Submitted explanations remain readable; pending chest actions can continue after Resume while time remains.

### Pending — secondary decisions only; defaults are proposals, not approvals

| Priority | Topic                 | Proposed default                                                             | Why it matters           |
| -------- | --------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| 已決定   | Results export        | 本輪不提供 CSV 匯出                                                          | 2026-11-18 教師確認      |
| P1       | Room scope            | One teacher and one active room for MVP; design schema to allow future rooms | Complexity               |
| P2       | Music / sound effects | Muted by default; original/license-cleared only                              | Accessibility, licensing |

### Implementation clarification: Firestore cost and trust model

- Avoid presenting a periodically updated shared leaderboard snapshot as free/automatic: a trusted aggregation actor is required to prevent student score manipulation; client-side room snapshots must not permit students to overwrite other students' ranking data.
- For the Spark MVP, prefer a simple, explicitly costed approach: students write their own private progress/answers and atomically settle authorized public scores (including a target score for steal/swap); teachers read progress and scores, while members read scores for target selection and the published ranking snapshots. Re-estimate read amplification for 30 clients, up to 40 chests each, target transfers, reconnects and rules-dependent reads. If this exceeds target, propose a safe, low-cost alternative before coding it.
- Firebase Security Rules can enforce field allowlists, ownership, document immutability for answers, score bounds and room status, but **cannot prove that a client selected the correct answer or received a random event honestly**. Do not imply otherwise.
- The initial leaderboard is motivational, not an exam-grade authoritative score report. Do not expose answer keys through private teacher-only Firestore documents to anonymous users; if answer keys ship in the client bundle, document their visibility.

## 14. Immediate Next Action for Codex

1. Request the existing project/repository or ZIP and Firebase Web SDK `firebaseConfig` if not yet supplied; never request service-account private keys.
2. **Do not re-ask any of the ten confirmed decisions.** Consult the latest Firestore contract for pause, join, and leaderboard behavior. Issue #6 resolves chest distribution/effects and duration in §4. Open decisions include room scope and audio. CSV export is excluded.
3. Inspect the existing prototype, report current implementation vs requirements, and produce an incremental plan with Firestore rule tests and estimated per-session read/write costs.
4. Implement independent scaffolding and tests while waiting for remaining choices. Require explicit approval before deployment, changing live security rules, or enabling any paid service.
5. Do not claim real-time sync, secure teacher authorization, or Hosting deployment is complete until tested and verified.


## 房間管理補充，issue #8

老師控制台採「房間」用語。當前房間 running 時，老師只可暫停或結束活動，其他房間管理操作停用；學生作答、寶箱及排名照常。主要資訊為房間碼、狀態、計時、人數與玩家進度，其他管理資訊與排名可展開。

v2 只在 lobby、ended、archived 提供永久刪除，paused／running 必須先結束。舊 v1 只讀房間可直接清理，不恢復遊戲或補發排名。刪除需輸入房間碼，清除已知房間子資料，支援刷新後續刪。永久退役碼避免舊連結加入日後的新房間；匿名 Auth 帳號保留。瀏覽器不保證發現既存未知孤兒；完整信任邊界見 [Firestore 契約](docs/firestore-contract.md#可重試的房間刪除)。無自動清理與 TTL。
