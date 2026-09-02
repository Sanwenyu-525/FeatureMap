/**
 * ImpactRefreshScheduler tests (v0.6.3 plan §34–§35).
 *
 * Debounce aggregation, duplicate dedup via Set, and no event loss
 * while a refresh is in flight.
 */
import { describe, expect, it } from 'vitest';
import { ImpactRefreshScheduler } from '../src/providers/save-adapter';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('ImpactRefreshScheduler', () => {
  it('aggregates rapid saves into a single refresh', async () => {
    const calls: string[][] = [];
    const scheduler = new ImpactRefreshScheduler((files) => calls.push(files), 50);
    scheduler.push('a.ts');
    await wait(20);
    scheduler.push('b.ts');
    await wait(20);
    scheduler.push('c.ts');
    await wait(120);
    expect(calls).toEqual([['a.ts', 'b.ts', 'c.ts']]);
    scheduler.dispose();
  });

  it('deduplicates the same file saved twice', async () => {
    const calls: string[][] = [];
    const scheduler = new ImpactRefreshScheduler((files) => calls.push(files), 50);
    scheduler.push('a.ts');
    scheduler.push('a.ts');
    await wait(120);
    expect(calls).toEqual([['a.ts']]);
    scheduler.dispose();
  });

  it('does not drop saves that arrive while a refresh is in flight', async () => {
    const calls: string[][] = [];
    let resolveRefresh: (() => void) | undefined;
    const scheduler = new ImpactRefreshScheduler(
      (files) =>
        new Promise<void>((resolve) => {
          calls.push(files);
          resolveRefresh = resolve;
        }),
      30,
    );
    scheduler.push('a.ts');
    await wait(60); // first refresh starts, awaiting resolveRefresh
    expect(calls).toEqual([['a.ts']]);
    scheduler.push('b.ts');
    scheduler.push('c.ts');
    resolveRefresh!(); // first refresh completes
    await wait(100); // drained batch 2
    expect(calls).toEqual([['a.ts'], ['b.ts', 'c.ts']]);
    scheduler.dispose();
  });

  it('flushes one batch at a time (single in-flight)', async () => {
    const calls: string[][] = [];
    let release = (): void => undefined;
    const scheduler = new ImpactRefreshScheduler(
      (files) =>
        new Promise<void>((resolve) => {
          calls.push(files);
          release = resolve;
        }),
      20,
    );
    scheduler.push('1.ts');
    await wait(40);
    scheduler.push('2.ts');
    scheduler.push('3.ts');
    await wait(40);
    // Still one in-flight batch; pending accumulated.
    expect(calls).toHaveLength(1);
    release();
    await wait(80);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['2.ts', '3.ts']);
    scheduler.dispose();
  });

  it('exposes the pending count', () => {
    const scheduler = new ImpactRefreshScheduler(() => undefined, 1000);
    scheduler.push('a.ts');
    scheduler.push('b.ts');
    expect(scheduler.pendingCount()).toBe(2);
    scheduler.dispose();
  });
});
