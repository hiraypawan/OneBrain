import { NextResponse } from 'next/server';

// No paid passthrough, even when a host OpenAI key happens to be configured.
// Browser recognition is not guaranteed on-device; its provider may process audio remotely.
export async function POST() {
  return NextResponse.json({ transcript: '', error: 'Server transcription is not enabled in the free-only build. Use browser recognition or type instead.' }, { status: 501 });
}
