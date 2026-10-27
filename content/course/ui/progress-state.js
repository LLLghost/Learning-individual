export const newProgress = () => ({
  schema: 'course-journey-v7', version: 7, lessons: {}, results: {}, reports: {},
  history: [], legacy: {}, last: null, focus: null,
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const records = value => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([, entry]) => object(entry)));

// localStorage is an input boundary, just like an imported backup.
// Keep the original bytes if repair is needed; keep every usable note/result.
export function loadProgress(raw) {
  if (raw === null) return { state: newProgress(), recovery: false };
  let data;
  try { data = JSON.parse(raw); }
  catch { return { state: newProgress(), recovery: true }; }
  if (!object(data) || data.schema !== 'course-journey-v7') return { state: newProgress(), recovery: true };
  const state = { ...newProgress(), ...data };
  for (const key of ['lessons', 'results', 'reports']) state[key] = records(data[key]);
  state.history = Array.isArray(data.history) ? data.history : [];
  state.legacy = object(data.legacy) ? data.legacy : {};
  return { state, recovery: JSON.stringify(state) !== JSON.stringify(data) };
}
