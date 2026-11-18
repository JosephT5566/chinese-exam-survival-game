---
name: review-pr
description: Independently review a chinese-exam-survival-game pull request against its issue's acceptance criteria and the repository's risk rules. Use when asked to review a PR, from a session that did not write it.
---

# Review PR

1. Read the linked issue first, then the diff. Do not rely on the PR description's claims.
2. Check: every acceptance criterion has evidence; changed files stay in scope; failure paths; scoring and explanation reward invariants; teacher/student identity and authorization; private answers, room lifecycle, leaderboard, and Firebase/Hosting behavior; docs updated when behavior changed.
3. Re-run or inspect CI for the checks the Validation table requires. Unit tests alone do not verify rules or SDK transactions; emulator tests do not verify deployed rules, real OAuth, IAM, or classroom load; say what still needs external verification.
4. Mark as needing owner approval any change in the AGENTS.md owner-approval list.
5. Post findings as review comments, ordered by severity, each with file and line. Use COMMENT only. Leave approve or request-changes and merging to the owner.
