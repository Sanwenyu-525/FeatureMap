import { log } from '../shared/logger';
import { config } from '../shared/config';
import { notificationService } from './notification-service';

export class Notification {
  dispatch(message: string): void {
    log(`dispatch via ${config.notificationEndpoint}`);
    notificationService.send(message);
  }
}

export const notification = new Notification();
