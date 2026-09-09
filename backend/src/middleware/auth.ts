import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

function secret(): string {
  if (!process.env.JWT_SECRET) {
    console.warn('[auth] JWT_SECRET not set — using insecure dev secret. Set one in production.');
    return 'dev-insecure-secret-change-me';
  }
  return process.env.JWT_SECRET;
}

export function signToken(user: { id: string; email: string }): string {
  return jwt.sign({ id: user.id, email: user.email }, secret(), { expiresIn: '30d' });
}

// Strict: every caller must present a valid token.
export function authenticate(req: Request & { user?: any }, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Lenient (chat/speech): attach the user when a token is present,
// otherwise continue as a device-local anonymous user.
export function optionalAuth(req: Request & { user?: any }, _res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, secret());
      return next();
    } catch {}
  }
  req.user = { id: 'local-user', email: null };
  next();
}
