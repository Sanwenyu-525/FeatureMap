import { userRepository } from '../services/user-repository';
import { logger } from '../shared/logger';

/**
 * Shared boundary file: create() belongs to login, destroy() belongs
 * to logout. File-level closure cannot separate them — symbol-level
 * candidates must.
 */
export class SessionService {
  create(email: string, _password: string): string {
    logger.info('create session');
    userRepository.findByEmail(email);
    return `session:${email}`;
  }

  destroy(token: string): boolean {
    logger.info('destroy session');
    return token.startsWith('session:');
  }
}

export const sessionService = new SessionService();
