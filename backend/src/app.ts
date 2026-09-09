import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import auth from './routes/auth';
import chat from './routes/chat';
import speech from './routes/speech';
import memory from './routes/memory';
import conversations from './routes/conversations';
import sync from './routes/sync';
import digest from './routes/digest';
import reminders from './routes/reminders';
import user from './routes/user';

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '20mb' }));

app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
app.use('/api/auth', auth);
app.use('/api/chat', chat);
app.use('/api/speech', speech);
app.use('/api/memory', memory);
app.use('/api/conversations', conversations);
app.use('/api/sync', sync);
app.use('/api/digest', digest);
app.use('/api/reminders', reminders);
app.use('/api/user', user);

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'onebrain-backend' }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
});

export default app;
