// Decode once, after collecting bytes: a network chunk can end inside a letter.
export async function readJSONObject(stream, limit = 12000) {
  const parts = [];
  let size = 0;
  for await (const part of stream) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error('Слишком большой запрос.'), { status: 413 });
    parts.push(part);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw Object.assign(new Error('Ожидался JSON.'), { status: 400 }); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Ожидался объект JSON.'), { status: 400 });
  }
  return value;
}
