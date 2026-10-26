import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const [manifest,catalog,meta,readiness]=await Promise.all(['content/course/manifest.json','scripts/practice/catalog.json','build/assets/course-data.json','quality/practice-readiness.json'].map(read));
const required=manifest.lessons.filter(l=>['vm','stand'].includes(l.environment)).map(l=>l.id).sort();
assert.deepEqual(Object.keys(meta.practiceLabs).sort(),required);
assert.deepEqual([...Object.keys(catalog.labs),'vm-backup'].sort(),required);
for(const [id,l] of Object.entries(catalog.labs)){
 for(const key of ['goal','task','prepare','solve','check','restore'])assert.ok(typeof l[key]==='string'&&l[key].trim(),`${id}/${key}`);
 assert.ok(l.requires.includes('python3'),id);
 assert.equal(l.acceptance,'pending-live');
}
const sha=s=>createHash('sha256').update(s).digest('hex');
const canonical=async path=>(await readFile(path,'utf8')).replace(/\r\n/g,'\n');
assert.equal(readiness.sourceHashNormalization,'LF');
assert.equal(readiness.runnerSha256,sha(await canonical('scripts/practice/runner.py')),'Stale runner fixture evidence');
assert.equal(readiness.catalogFileSha256,sha(await canonical('scripts/practice/catalog.json')),'Stale recipe fixture evidence');
assert.equal(meta.practiceRunnerSha256,sha(await readFile('build/downloads/course-practice.py')));
assert.equal(meta.practiceLabs['vm-backup'].runnerSha256,sha(await readFile('build/downloads/proxmox-backup.py')));
assert.equal(readiness.results.filter(r=>r.status==='failed').length,0);
console.log(`Practice registry: ${required.length} outcomes, 45 guest recipes + native Proxmox restore; artifact hashes match.`);
