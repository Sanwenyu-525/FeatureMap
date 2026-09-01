import { login } from './auth';

export function loginHandler(
  _req: unknown,
  res: { json: (body: unknown) => void },
): void {
  const result = login('user@example.com', 'secret');
  res.json(result);
}
