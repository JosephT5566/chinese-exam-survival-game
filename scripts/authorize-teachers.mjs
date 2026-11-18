#!/usr/bin/env node
// Administrator-only; dry-run by default. Never print credentials or the allowlist.
import { execFileSync } from 'node:child_process';

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('Each email must be a string.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\-=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email))
    throw new Error('Invalid email. Use a plain email address without path separators.');
  return email;
}
function environmentEmails() {
  let values;
  try { values = JSON.parse(process.env.TEACHER_EMAILS ?? ''); }
  catch { throw new Error('TEACHER_EMAILS must be an explicit JSON array; use [] only to revoke all teachers.'); }
  if (!Array.isArray(values) || values.length > 100) throw new Error('TEACHER_EMAILS must be a JSON array of at most 100 emails.');
  return [...new Set(values.map(normalizeEmail))];
}
async function main() {
  const args = process.argv.slice(2), supplied = [];
  let project = '', apply = false, emulator = false, sync = false, validate = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--email' && args[i + 1]) supplied.push(args[++i]);
    else if (arg === '--project' && args[i + 1]) project = args[++i];
    else if (arg === '--apply') apply = true;
    else if (arg === '--emulator') emulator = true;
    else if (arg === '--sync-env') sync = true;
    else if (arg === '--validate-env') validate = true;
    else throw new Error('Usage: --project PROJECT (--email EMAIL [--email EMAIL] | --sync-env | --validate-env) [--apply] [--emulator]');
  }
  if (!/^[a-z][a-z0-9-]+$/.test(project)) throw new Error('Supply an explicit project.');
  if ((sync && validate) || ((sync || validate) && supplied.length) || (validate && apply)
    || (!sync && !validate && (!supplied.length || supplied.length > 10)))
    throw new Error('Choose one email mode: 1–10 --email values, --sync-env, or --validate-env without --apply.');
  if (emulator && project !== 'demo-chinese-exam') throw new Error('Emulator access requires demo-chinese-exam.');
  if (!validate && !emulator && project.startsWith('demo-')) throw new Error('Demo projects require --emulator.');
  const emails = sync || validate ? environmentEmails() : [...new Set(supplied.map(normalizeEmail))];
  if (validate) { console.log(`TEACHER_EMAILS valid: ${emails.length} email(s).`); return; }
  let token;
  if (emulator) token = 'owner';
  else if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  else {
    if (process.env.GITHUB_ACTIONS === 'true') throw new Error('Missing deployment access token.');
    try { token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { throw new Error('Administrator authentication failed. Run gcloud auth login.'); }
  }
  const origin = emulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
  const database = `projects/${project}/databases/(default)`;
  const prefix = `${database}/documents/teacherEmails/`;
  const base = `${origin}/v1/${database}/documents`;
  async function request(url, body) {
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Firestore request failed (${response.status}). Check IAM access or rerun after a transaction conflict.`);
    return response.json();
  }
  const { transaction } = await request(`${base}:beginTransaction`, { options: { readWrite: {} } });
  let committed = false;
  try {
    const existing = [];
    let cursor;
    while (true) {
      const structuredQuery = { from: [{ collectionId: 'teacherEmails' }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 50,
        ...(cursor ? { startAt: { values: [{ referenceValue: cursor }], before: false } } : {}) };
      const page = await request(`${base}:runQuery`, { transaction, structuredQuery });
      const documents = page.flatMap(result => result.document ? [result.document] : []);
      existing.push(...documents);
      if (existing.length > 100) throw new Error('Existing email allowlist exceeds 100 documents. No changes applied.');
      if (documents.length < 50) break;
      cursor = documents.at(-1).name;
    }
    const desired = new Set(emails.map(email => prefix + email));
    const current = new Map(existing.map(document => [document.name, document]));
    if (!sync && new Set([...current.keys(), ...desired]).size > 100)
      throw new Error('Email allowlist would exceed 100 documents. No changes applied.');
    const writes = [];
    for (const name of desired) {
      if (current.get(name)?.fields?.authorized?.booleanValue !== true)
        writes.push({ update: { name, fields: { authorized: { booleanValue: true } } }, updateMask: { fieldPaths: ['authorized'] } });
    }
    const grants = writes.length;
    if (sync) for (const document of existing) if (!desired.has(document.name)) writes.push({ delete: document.name });
    if (apply) {
      await request(`${base}:commit`, { transaction, writes });
      committed = true;
    }
    console.log(`${apply ? 'Applied' : 'Dry-run, no changes'}: ${grants} email grant(s), ${writes.length - grants} removal(s).`);
  } finally {
    if (!committed) await request(`${base}:rollback`, { transaction }).catch(() => {});
  }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Teacher authorization failed.');
  process.exitCode = 1;
});
