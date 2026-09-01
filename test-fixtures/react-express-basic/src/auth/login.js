import { findUserByEmail } from './user.js';

export function loginHandler(req, res) {
  const user = findUserByEmail(req.body.email);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({ token: 'ok' });
}
