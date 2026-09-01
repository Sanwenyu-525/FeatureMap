import { logger } from '../shared/logger';

export class UserRepository {
  findByEmail(email: string): { email: string } | undefined {
    logger.debug('findByEmail');
    return { email };
  }
}

export const userRepository = new UserRepository();
