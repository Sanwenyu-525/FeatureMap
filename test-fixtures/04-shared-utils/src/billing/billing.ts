import { log } from '../shared/logger';
import { config } from '../shared/config';
import { httpClient } from '../shared/http-client';
import { invoiceService } from './invoice-service';

export class Billing {
  run(amount: number): string {
    log(`billing run at rate ${config.billingRate}`);
    httpClient.post('/api/invoices', { amount });
    return invoiceService.createInvoice(amount);
  }
}

export const billing = new Billing();
