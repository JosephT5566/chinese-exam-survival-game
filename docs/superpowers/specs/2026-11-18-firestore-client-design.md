# Firestore classroom client

The user approved implementing the complete classroom flow and opening a PR.
Use the existing TypeScript/Vite app and published Firestore contract. Retain
the offline demo via `?demo=1`; configured builds default to the cloud client.
No production rules, hosting, billing, or teacher authorization is changed by
this PR. Initial teacher Google login creates a UID; an administrator then uses
a bounded provisioning tool to authorize that UID after checking its email.

## Approach

Use the modular browser SDK directly under the existing rules. A server would
add hosting/operations without providing value for this formative game. Reusing
the localStorage room object would expose other students' private records;
instead use separate room, own-player/answers, teacher-player, and public-rank
subscriptions. Keep demo storage separate. Teacher and student Auth use named
Firebase apps so logging in as a teacher cannot replace a student's anonymous
identity in another tab. Never automatically sign out a student.

## Behavior

- Teacher Google login, authorization state including UID, own-room list,
  atomic room/code creation, lobby/running/paused/ended/archived transitions.
- Anonymous student joins by exact code, resumes the same UID, keeps fixed
  shuffled question/choice order, and sees only their own answers and progress.
- Transactions implement answer and incorrect-explanation awards exactly once.
  Server acknowledgement is required before showing saved progress. No offline
  queued answers. Events remain informational and award nothing.
- Rehydrate the last answered question so refresh cannot skip an unclaimed
  incorrect explanation, including question 40. Next-question UI state is local.
- Teacher watches player documents, sorts deterministically, publishes two
  private-data-free snapshots on change at most every 10 seconds. Student merges
  only matching timestamps and shows the last update time.
- Surface loading, permission, connection, and malformed/unsupported question
  set errors. Unsubscribe and stop publishers on room/identity changes.
- Emulator verification uses the real client adapter and published local rules.
  No frontend email list grants access. No migration of local demo records.

## Constraints

Anonymous sessions do not provide cross-device recovery. Capacity is advisory
under the existing rules; warn teachers above 30 and show at most 30 ranks.
There is no client delete flow. Correctness is calculated by the frontend as
already documented, so this remains a classroom practice game.
