import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const [manifest,mapping,review]=await Promise.all(['content/course/manifest.json','quality/depth-map.json','quality/lesson-rewrite-review.json'].map(json));
const sha=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const bodies=new Map(),anchors=new Map();
for(const lesson of manifest.lessons){
 const body=await readFile(`content/course/${lesson.file}`,'utf8');bodies.set(lesson.id,body);
 for(const match of body.matchAll(/\bid="([^"]+)"/g))anchors.set(match[1],lesson.id);
 if(!lesson.depthRevision)continue;
 assert.equal(review.lessons[lesson.id]?.sha256,sha(body),`${lesson.id}: editorial evidence is stale`);
 for(const block of ['model','case','transfer'])assert.ok(body.includes(`id="${lesson.id}-depth-${block}"`),lesson.id);
 assert.ok(!body.includes('data-origin="v6"'),`${lesson.id}: unrevised old prose still embedded`);
 assert.ok(!body.includes('ещё проходят сверку'),`${lesson.id}: obsolete draft notice`);
}
assert.equal(Object.keys(review.lessons).length,76);
assert.equal(manifest.lessons.filter(l=>l.depthRevision).length,76);
for(const entry of mapping.entries){
 assert.equal(anchors.get(entry.id),entry.lesson,entry.id);
 assert.ok(anchors.has(entry.target),`${entry.id}: missing replacement ${entry.target}`);
 assert.ok(entry.sourceTitle.trim(),entry.id);
 assert.equal(entry.archive,`/archive/v6/book/#${entry.id}`);
}
assert.equal(mapping.entries.length,review.legacyAnchors);
assert.equal(review.mode,'author-self-review');
assert.equal(review.liveAcceptance,false);
console.log(`Editorial: 76 rewritten lessons match reviewed hashes; ${mapping.entries.length} legacy anchors have explicit new targets and archive links. Human learning and live labs remain separate.`);
