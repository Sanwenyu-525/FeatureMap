import { authService } from '@/services/auth';

export function login(email: string, password: string): boolean {
  return authService.login(email, password);
}
