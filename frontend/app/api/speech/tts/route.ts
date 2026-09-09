import { NextRequest, NextResponse } from 'next/server';

// Cloud TTS passthrough (ElevenLabs/OpenAI) — falls back to browser speechSynthesis client-side
export async function POST(req: NextRequest) {
  const { text } = await req.json();
  const key = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  if (key && text) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text: text.slice(0, 1000), model_id: 'eleven_monolingual_v1' }),
      });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        return new NextResponse(buf, { headers: { 'Content-Type': 'audio/mpeg' } });
      }
    } catch {}
  }
  return NextResponse.json({ fallback: true }, { status: 200 });
}
