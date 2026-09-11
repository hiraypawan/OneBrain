import { Router } from 'express';
const router = Router();
// Retained compatibility routes never spend a host speech-provider key.
router.post('/stt', (_req, res) => res.status(501).json({ transcript: '', error: 'Server transcription is not enabled in the free-only build. Browser speech may process audio remotely; typing remains available.' }));
router.post('/tts', (_req, res) => res.json({ fallback: true }));
export default router;
