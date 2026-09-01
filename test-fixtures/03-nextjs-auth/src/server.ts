import express from 'express';
import { loginRoute } from './app/api/login/route';

const app = express();

app.post('/api/login', loginRoute);

app.listen(3000);
