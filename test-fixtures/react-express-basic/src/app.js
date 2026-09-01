import express from 'express';
import { loginHandler } from './auth/login.js';

const app = express();

app.post('/api/login', loginHandler);
app.get('/api/users', listUsers);

function listUsers(req, res) {
  res.json([]);
}

app.listen(3000);
