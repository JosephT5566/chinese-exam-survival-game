---
name: chinese-exam-guide
description: Explain the Chinese exam survival game's modules and maintain documentation when behavior, game rules, Firebase contracts, setup, or validation changes.
---

# Chinese exam guide

Source paths below are relative to the repository root. Links resolve relative to this skill directory.

| Area                                    | Documentation and source                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Features, setup, scripts, limitations   | [README.md](../../../README.md), `package.json`                                                                                                            |
| Intended classroom behavior and scoring | [SPEC.md](../../../SPEC.md), `src/game/`, `src/types/question.ts`                                                                                          |
| UI and tablet pixel art                 | [Pixel frontend](../../../docs/pixel-frontend.md), `src/app/`                                                                                              |
| Modules                                 | [Architecture](../../../docs/architecture.md), `src/app/`, `src/game/`, `src/firebase/`                                                                    |
| Auth, data, transactions, leaderboard   | [Firestore contract](../../../docs/firestore-contract.md), `src/firebase/`, `firestore.rules`                                                              |
| Firebase and Hosting                    | [Firebase setup](../../../docs/firebase-setup.md), [Hosting deployment](../../../docs/hosting-auto-deploy.md), `firebase.json`, `.github/workflows/ci.yml` |
| Questions                               | [Question guide](../../../src/questions/README.md), `src/questions/bank.ts`                                                                                |
| Agent workflow                          | [AGENTS.md](../../../AGENTS.md), [Agent workflow](../../../docs/agent-workflow.md)                                                                         |

Trace screens through game logic, Firebase calls, types, rules, and tests. Confirm facts against current implementation. Some architecture/setup notes describe earlier stages; do not repeat those as current facts.

For code/configuration changes, identify inaccurate descriptions and update affected sections only. Keep each fact in its owning document and link elsewhere. Do not rewrite unrelated historical notes. Check links, source paths, formatting, and skill metadata before completion.

Distinguish local demo, emulator-tested cloud behavior, historical operator reports, and fresh production evidence. Local checks do not prove deployed rules, OAuth, IAM, or 30-tablet load. Documentation maintenance does not authorize production mutations or unrelated fixes.
