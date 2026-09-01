import { userRepository } from './user-repository';
import { logger } from '../shared/logger';
import { HttpClient } from '../shared/http-client';

export class AuthService {
  login(email: string, _password: string): boolean {
    logger.info('login attempt');
    new HttpClient().post('/sessions', { email });
    return userRepository.findByEmail(email) !== undefined;
  }
}

export const authService = new AuthService();
