#!/usr/bin/env node
// Administrator-only, dry-run by default. Credentials never enter stdout or files.
import { execFileSync } from 'node:child_process';

async function main() {
  const args = process.argv.slice(2), emails = [];
  let project = '', apply = false, emulator = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) emails.push(args[++i].trim().toLowerCase());
    else if (arg === '--project' && args[i + 1]) project = args[++i];
    else if (arg === '--apply') apply = true;
    else if (arg === '--emulator') emulator = true;
    else throw new Error('Usage: node scripts/authorize-teachers.mjs --project PROJECT --email EMAIL [--email EMAIL] [--apply] [--emulator]');
  }
  if (!/^[a-z][a-z0-9-]+$/.test(project) || !emails.length || emails.length > 10 || emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
    throw new Error('Supply an explicit project and 1–10 valid teacher emails.');
  if (emulator && project !== 'demo-chinese-exam') throw new Error('Emulator access requires demo-chinese-exam.');
  const token = emulator ? 'owner' : execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project };
  const authOrigin = emulator ? 'http://127.0.0.1:9099/identitytoolkit.googleapis.com' : 'https://identitytoolkit.googleapis.com';
  const storeOrigin = emulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
  const lookup = await fetch(`${authOrigin}/v1/projects/${project}/accounts:lookup`, {
    method: 'POST', headers, body: JSON.stringify({ email: [...new Set(emails)] }),
  });
  if (!lookup.ok) throw new Error(`Auth lookup failed (${lookup.status}). Check administrator IAM access.`);
  const data = await lookup.json();
  let pending = false;
  for (const email of new Set(emails)) {
    const user = data.users?.find(u => u.email?.toLowerCase() === email);
    if (!user || !user.localId || user.disabled || !user.emailVerified || !user.providerUserInfo?.some(p => p.providerId === 'google.com')) {
      console.log(`${email}: pending. Sign in with Google in the teacher UI first.`); pending = true; continue;
    }
    const path = `${storeOrigin}/v1/projects/${project}/databases/(default)/documents/teachers/${encodeURIComponent(user.localId)}`;
    if (apply) {
      const result = await fetch(`${path}?updateMask.fieldPaths=authorized`, { method: 'PATCH', headers,
        body: JSON.stringify({ fields: { authorized: { booleanValue: true } } }) });
      if (!result.ok) throw new Error(`Teacher authorization failed (${result.status}).`);
      const verified = await fetch(path, { headers });
      if (!verified.ok || (await verified.json()).fields?.authorized?.booleanValue !== true) throw new Error('Authorization read-back failed.');
    }
    console.log(`${email}: ${user.localId}, ${apply ? 'authorized and verified' : 'dry-run, no changes'}.`);
  }
  if (pending) process.exitCode = 2;
}
main().catch(error => {
  // Do not print subprocess output, which could contain credentials.
  console.error(error instanceof Error && !('stderr' in error) ? error.message : 'Administrator authentication failed. Run gcloud auth login.');
  process.exitCode = 1;
});
