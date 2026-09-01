import { sessionService } from './session-service';

export function login(email: string, password: string): string {
  return sessionService.create(email, password);
}
