import { NextRequest, NextResponse } from 'next/server';

// Whisper STT passthrough — client primarily uses Web Speech API (free, on-device)
export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ transcript: '' });
  try {
    const form = await req.formData();
    const file = form.get('audio') as Blob;
    if (!file) return NextResponse.json({ transcript: '' });
    const out = new FormData();
    out.append('file', file, 'audio.webm');
    out.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: out,
    });
    const j = await r.json();
    return NextResponse.json({ transcript: j.text || '' });
  } catch {
    return NextResponse.json({ transcript: '' });
  }
}
