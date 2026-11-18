import { initializeApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { readConfig } from './config';

export function createRuntime(role: 'teacher' | 'student') {
  const config = readConfig(import.meta.env);
  if (!config) throw new Error('尚未設定 Firebase，請使用本機示範。');
  // Separate app names give each role its own persisted Auth identity.
  const app = initializeApp(config, `classroom-${role}`);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver });
  const db = getFirestore(app);
  if (config.emulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  return { auth, db, emulators: config.emulators };
}
