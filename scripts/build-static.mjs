import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist', 'site');
const indexSource = resolve(root, 'static-src', 'index.html');
const courseSource = resolve(root, 'public', 'course.html');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(indexSource, resolve(output, 'index.html'));
await cp(courseSource, resolve(output, 'course.html'));

const [index, course] = await Promise.all([
  readFile(resolve(output, 'index.html')),
  readFile(resolve(output, 'course.html')),
]);

const requiredCourseMarkers = [
  'id="study-app"',
  'server-infrastructure-selfstudy-v6',
  'window.CourseQA',
  'course_checks.py',
];
for (const marker of requiredCourseMarkers) {
  if (!course.includes(Buffer.from(marker))) throw new Error(`Missing course marker: ${marker}`);
}
for (const marker of ['get_course_progress', 'open_course_module', '/course.html']) {
  if (!index.includes(Buffer.from(marker))) throw new Error(`Missing shell marker: ${marker}`);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const manifest = {
  generatedAt: new Date().toISOString(),
  files: {
    'index.html': { bytes: index.length, sha256: sha256(index) },
    'course.html': { bytes: course.length, sha256: sha256(course) },
  },
};
await writeFile(resolve(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Static site built: ${output}`);
console.log(JSON.stringify(manifest.files));
