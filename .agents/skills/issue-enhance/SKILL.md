---
name: issue-enhance
description: Turn a raw chinese-exam-survival-game idea issue into a self-contained implementation spec an independent agent can execute, and get the owner's explicit approval. Use when an issue is titled "[idea]", lacks acceptance criteria, or the user asks to grill, refine, or approve an issue.
---

# Issue enhance

Precondition: a GitHub Issue exists. If the idea is only in chat, create it from `.github/ISSUE_TEMPLATE/idea.md` first. Do not implement anything.

1. Read the issue, then the sources the AGENTS.md "Context routing" table names for the affected area. Confirm claims against source, not docs.
2. Ask only questions whose answers change the implementation: goal, who is affected (teacher vs student vs administrator), boundaries, data and contract impact, alternatives. Ask them together, not one at a time. Skip questions the code already answers.
3. Rewrite the issue using `.github/ISSUE_TEMPLATE/implementation.md`: objective, current context with file paths, scope, out of scope, observable acceptance criteria, dependencies and overlapping issues, risks, validation plan from the AGENTS.md Validation table, decision log.
4. Flag these explicitly when touched: teacher authorization, anonymous student identity, private answers, scoring/rewards, room lifecycle, leaderboard publication, Firebase environment selection, and untrusted nicknames/question content. Emulator tests do not verify deployed rules or IAM.
5. If any UI behavior or appearance changes, run ui-design-gate before approval.
6. Show the owner the final spec and open uncertainties. Add the `ai-ready` label only after explicit confirmation, and record who approved in the decision log.

Never paste secrets, student data, or teacher credentials into an issue.
