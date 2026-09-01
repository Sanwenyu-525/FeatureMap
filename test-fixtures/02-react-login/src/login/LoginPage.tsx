import { LoginForm } from './LoginForm';
import { useLogin } from './useLogin';

export function LoginPage() {
  const session = useLogin();
  void session;
  return (
    <main>
      <LoginForm />
    </main>
  );
}
