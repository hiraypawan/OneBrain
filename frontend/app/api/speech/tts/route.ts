import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, bodyError, RequestBodyError } from '@/lib/request-body';

// Compatibility response for older clients. Never spend host speech-provider keys.
export async function POST(req: NextRequest) {
  try {
    const { text } = await readJsonBody(req, 8000);
    if (typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw new RequestBodyError('Supply 1–4000 characters of text.', 400);
  } catch (error) { return bodyError(error); }
  return NextResponse.json({ fallback: true });
}
