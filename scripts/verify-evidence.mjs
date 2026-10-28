import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export async function verifyEvidence(folder) {
  const root = resolve(folder);
  const summary = JSON.parse(await readFile(resolve(root, 'summary.json'), 'utf8'));
  const entries = Object.entries(summary.evidenceHashes);
  if (!entries.length) throw Error('Empty evidence hash registry');
  for (const [name, expected] of entries) {
    const path = resolve(root, name);
    if (!path.startsWith(root + sep)) throw Error(`Evidence path outside directory: ${name}`);
    const raw = await readFile(path);
    const bytes = /\.(?:tgz|tar|gz|zst)$/i.test(name) ? raw : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== expected) throw Error(`Evidence hash mismatch: ${name}`);
  }
  return entries.length;
}
