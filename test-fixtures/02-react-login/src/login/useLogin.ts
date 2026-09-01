import { login } from '../api/auth';

export function useLogin() {
  return { submit: login };
}
