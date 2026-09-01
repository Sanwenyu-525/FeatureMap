import { authService } from '../services/auth-service';

export function login(email: string, password: string): boolean {
  return authService.authenticate(email, password);
}
