import { log } from '../shared/logger';

export class NotificationRepository {
  record(message: string): void {
    log(`recording ${message}`);
  }
}

export const notificationRepository = new NotificationRepository();
