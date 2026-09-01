import { log } from '../shared/logger';
import { httpClient } from '../shared/http-client';
import { notificationRepository } from './notification-repository';

export class NotificationService {
  send(message: string): void {
    log(`sending ${message}`);
    httpClient.post('/api/notify', { message });
    notificationRepository.record(message);
  }
}

export const notificationService = new NotificationService();
