import { logout } from '../auth/logout';

export function logoutHandler(
  _req: unknown,
  res: { json: (body: unknown) => void },
): void {
  const result = logout('session-token-1');
  res.json(result);
}
