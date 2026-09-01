import { Button } from '@/components/ui/Button';
import { login } from '@/lib/auth';

export function LoginForm() {
  return (
    <form onSubmit={() => login('user@example.com', 'secret')}>
      <Button type="submit">Sign in</Button>
    </form>
  );
}
