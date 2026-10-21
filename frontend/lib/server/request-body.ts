import { NextResponse } from 'next/server';

export class RequestBodyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Bound bytes while reading, not after allocating an arbitrarily large request. */
export async function readBody(request: Request, limit = 64_000): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit) throw new RequestBodyError('Request is too large.', 413);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  // A slow client cannot keep a route waiting forever for another chunk.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RequestBodyError('Request body timed out.', 408));
      void reader.cancel().catch(() => {});
    }, 10_000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new RequestBodyError('Request is too large.', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function readJsonBody(request: Request, limit = 64_000): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new RequestBodyError('Use application/json.', 415);
  const text = await readBody(request, limit);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new RequestBodyError('Supply a valid JSON object.', 400); }
}

export function bodyError(error: unknown): NextResponse {
  return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : 'Invalid request body.' },
    { status: error instanceof RequestBodyError ? error.status : 400 });
}
