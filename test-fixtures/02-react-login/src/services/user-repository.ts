export class UserRepository {
  findByEmail(email: string): { email: string } | undefined {
    return { email };
  }
}

export const userRepository = new UserRepository();
