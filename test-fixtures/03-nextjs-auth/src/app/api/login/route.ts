import { login } from '@/lib/auth';

export function loginRoute(
  _req: unknown,
  res: { json: (body: unknown) => void },
): void {
  const result = login('user@example.com', 'secret');
  res.json(result);
}
