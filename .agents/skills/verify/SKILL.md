---
name: verify
description: Verify Chinese exam survival game UI flows using the existing Playwright and Firebase Emulator harness or exploratory Chrome browser-client sessions, and report scoped browser evidence.
---

# Verify

Use this repository's existing Firebase Emulator and Playwright harness. Source paths below are relative to the repository root.

## Scripted browser checks

1. Read `playwright.config.ts` and `tests/browser/classroom.spec.ts`. Use Node.js 24, Java 21+, and `npm ci` dependencies.
2. Install Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROME_PATH` to an installed browser executable.
3. Run `npm run test:browser`. It starts Auth/Firestore Emulators with `demo-chinese-exam`; Playwright starts Vite on `127.0.0.1:5174` with emulator environment variables and `reuseExistingServer: false`.
4. Current coverage includes distinct teacher/student identities, emulator-only teacher authorization, 40-question classroom progression, refresh/recovery, final explanation reward, ranking, and offline demo navigation. Read assertions before claiming coverage of an acceptance criterion. Add focused coverage for changed behavior when needed.
5. Inspect failures and retained traces in `test-results/`. For visual changes capture affected tablet screens too; functional tests alone do not establish visual quality. Report commands, assertions exercised, actual artifact paths, and remaining gaps.

Do not launch duplicate emulators or reuse an unrelated server. Diagnose occupied ports before retrying. Stop only processes started for this verification. Use synthetic data and never target production with tests or teacher authorization tools.

## Exploratory browser checks

Use the Chrome plugin's `browser-client` runtime per AGENTS.md. If unavailable, use a permitted fallback and report the limitation. The repository Playwright suite remains the scripted check.

For demo checks launch Vite locally and open `?demo=1`. For cloud checks explicitly set `VITE_FIREBASE_EMULATORS=true` and `VITE_FIREBASE_PROJECT_ID=demo-chinese-exam`, start `npm run emulators`, then Vite. Confirm local Auth 9099 and Firestore 8080 before signing in or writing. Never use real Google accounts or production classroom data for this workflow.

Drive visible controls; confirm persisted outcomes after reload. Use separate contexts for different anonymous students; ordinary student tabs share identity. Teacher/student flows intentionally use separate Auth storage. Use only the README's emulator authorization command for synthetic teacher accounts.

## Evidence and limits

Capture affected states after user actions, expected/actual outcomes, browser errors, and screenshot/trace paths. Use `repository-verified` only for observed behavior. For Firebase mutations and authorization also run AGENTS.md's rules/integration checks.

Emulators do not prove real Google OAuth, deployed rules/IAM, recovery on real tablets, classroom load, or question accuracy. Report those gaps without using production as an unrequested test target. Keep artifacts in git-ignored `test-results/`; clean up only this run's processes.
