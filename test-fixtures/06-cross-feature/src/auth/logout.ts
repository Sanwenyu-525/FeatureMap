import { sessionService } from './session-service';

export function logout(token: string): boolean {
  return sessionService.destroy(token);
}
