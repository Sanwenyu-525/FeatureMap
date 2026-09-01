import { login } from '../auth/login';

export function loginHandler(
  _req: unknown,
  res: { json: (body: unknown) => void },
): void {
  const result = login('user@example.com', 'secret');
  res.json(result);
}
