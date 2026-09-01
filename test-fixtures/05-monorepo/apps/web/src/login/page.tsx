import { login } from '@company/auth/login';

export function LoginPage() {
  return (
    <form onSubmit={() => login('user@example.com', 'secret')}>
      <button type="submit">Sign in</button>
    </form>
  );
}
