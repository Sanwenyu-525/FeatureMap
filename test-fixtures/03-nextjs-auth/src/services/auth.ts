import { userRepository } from '@/repositories/user';
import { logger } from '@/lib/logger';

export class AuthService {
  login(email: string, _password: string): boolean {
    logger.info('login');
    return userRepository.findByEmail(email) !== undefined;
  }
}

export const authService = new AuthService();
