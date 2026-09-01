import { LoginForm } from '@/app/login/LoginForm';
import { useLogin } from '@/hooks/useLogin';

export function LoginPage() {
  const session = useLogin();
  void session;
  return (
    <main>
      <LoginForm />
    </main>
  );
}
