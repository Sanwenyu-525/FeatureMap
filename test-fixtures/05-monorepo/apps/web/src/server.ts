import express from 'express';
import { loginHandler } from './login/handler';

const app = express();

app.post('/api/login', loginHandler);

app.listen(3000);
