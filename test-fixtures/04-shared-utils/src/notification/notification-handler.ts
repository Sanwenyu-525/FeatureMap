import { notification } from './notification';

export function notificationHandler(): void {
  notification.dispatch('welcome');
}
