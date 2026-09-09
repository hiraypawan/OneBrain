import { Router } from 'express';
import { optionalAuth } from '../middleware/auth';

const router = Router();
router.use(optionalAuth);

// STT: expects multipart audio; requires Whisper key — client uses Web Speech API by default
router.post('/stt', async (_req, res) => res.json({ transcript: '', note: 'Use client Web Speech API or set OPENAI_API_KEY with Whisper.' }));
// TTS: ElevenLabs passthrough
router.post('/tts', async (req, res) => {
  const { text } = req.body;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(200).json({ fallback: true });
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
    body: JSON.stringify({ text: String(text).slice(0, 1000), model_id: 'eleven_monolingual_v1' }),
  });
  if (!r.ok) return res.status(502).json({ error: 'TTS failed' });
  const buf = Buffer.from(await r.arrayBuffer());
  res.set('Content-Type', 'audio/mpeg').send(buf);
});

export default router;
