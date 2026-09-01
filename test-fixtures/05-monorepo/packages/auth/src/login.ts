import { authService } from './auth-service';

export function login(email: string, password: string): boolean {
  return authService.login(email, password);
}
