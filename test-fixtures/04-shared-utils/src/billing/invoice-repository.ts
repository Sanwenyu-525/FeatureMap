import { log } from '../shared/logger';

export class InvoiceRepository {
  save(amount: number): string {
    log(`persisting invoice ${amount}`);
    return `invoice-${amount}`;
  }
}

export const invoiceRepository = new InvoiceRepository();
