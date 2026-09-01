import { login } from '@/lib/auth';

export function useLogin() {
  return { submit: login };
}
