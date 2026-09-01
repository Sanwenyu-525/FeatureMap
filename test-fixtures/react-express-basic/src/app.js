import express from 'express';
import { loginHandler } from './auth/login.js';

const app = express();

app.post('/api/login', loginHandler);
app.get('/api/users', listUsers);
app.post('/api/session', (req, res) => {
  res.json({ token: 'demo-session' });
});

function listUsers(req, res) {
  res.json([]);
}

app.listen(3000);
