import express from 'express';
import { loginHandler } from './api/login-handler';
import { logoutHandler } from './api/logout-handler';

const app = express();

app.post('/api/login', loginHandler);
app.post('/api/logout', logoutHandler);

app.listen(3000);
