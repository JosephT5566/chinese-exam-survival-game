import { readFileSync } from 'node:fs';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-chinese-exam',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

afterAll(async () => {
  await environment?.cleanup();
});

describe('未登入或沒有成員及老師權限的身分', () => {
  for (const identity of ['unauthenticated', 'student', 'teacher']) {
    for (const path of [
      'rooms/example',
      'rooms/example/players/student',
      'rooms/example/players/student/answers/q1',
      'rooms/example/players/student/events/1',
      'rooms/example/public/leaderboard',
      'teachers/teacher',
      'teacherEmails/teacher@example.test',
    ]) {
      it(`${identity} 無法讀寫 ${path}`, async () => {
        const context = identity === 'unauthenticated'
          ? environment.unauthenticatedContext()
          : environment.authenticatedContext(identity);
        const reference = doc(context.firestore(), path);
        await assertFails(getDoc(reference));
        await assertFails(setDoc(reference, { authorized: true }));
      });
    }
  }
});
