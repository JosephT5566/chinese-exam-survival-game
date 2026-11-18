import type { FirebaseOptions } from 'firebase/app';

export function readConfig(env: Record<string, string | undefined>): (FirebaseOptions & { emulators: boolean }) | null {
  const emulators = env.VITE_FIREBASE_EMULATORS === 'true';
  if (emulators) {
    if (env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_PROJECT_ID !== 'demo-chinese-exam')
      throw new Error('模擬器只能使用 demo-chinese-exam。');
    return { apiKey: 'demo-key', authDomain: 'demo-chinese-exam.firebaseapp.com',
      projectId: 'demo-chinese-exam', appId: 'demo-app', emulators: true };
  }
  const apiKey = env.VITE_FIREBASE_API_KEY, authDomain = env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId = env.VITE_FIREBASE_PROJECT_ID, appId = env.VITE_FIREBASE_APP_ID;
  if (![apiKey, authDomain, projectId, appId].some(Boolean)) return null;
  if (!apiKey || !authDomain || !projectId || !appId) throw new Error('Firebase 設定不完整，請檢查環境設定。');
  return { apiKey, authDomain, projectId, appId, emulators: false };
}
