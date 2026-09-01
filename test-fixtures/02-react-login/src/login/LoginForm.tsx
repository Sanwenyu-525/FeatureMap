import { Button } from '../components/Button';
import { PasswordInput } from '../components/PasswordInput';
import { login } from '../api/auth';

export function LoginForm() {
  return (
    <form onSubmit={() => login('user@example.com', 'secret')}>
      <PasswordInput name="password" />
      <Button type="submit">Sign in</Button>
    </form>
  );
}
