import { userRepository } from './user-repository';
import { logger } from '../shared/logger';

export class AuthService {
  authenticate(email: string, password: string): boolean {
    logger.info('authenticate');
    return userRepository.findByEmail(email) !== undefined && password.length > 0;
  }
}

export const authService = new AuthService();
