import { log } from '../shared/logger';
import { invoiceRepository } from './invoice-repository';

export class InvoiceService {
  createInvoice(amount: number): string {
    log(`creating invoice for ${amount}`);
    return invoiceRepository.save(amount);
  }
}

export const invoiceService = new InvoiceService();
