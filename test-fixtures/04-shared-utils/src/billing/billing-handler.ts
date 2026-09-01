import { billing } from './billing';

export function billingHandler(): string {
  return billing.run(100);
}
