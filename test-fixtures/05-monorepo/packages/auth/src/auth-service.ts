import { userRepository } from './user-repository';

export class AuthService {
  login(email: string, _password: string): boolean {
    return userRepository.findByEmail(email) !== undefined;
  }
}

export const authService = new AuthService();
