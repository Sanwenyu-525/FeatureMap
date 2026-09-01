import { describe, expect, it } from 'vitest';
import {
  classifyConfidence,
  clampConfidence,
  confidenceLabel,
  isSurfaceable,
} from '../src/confidence.js';

describe('classifyConfidence', () => {
  it('classifies 1.0 as deterministic', () => {
    expect(classifyConfidence(1)).toBe('deterministic');
  });

  it('classifies 0.90–0.99 as very strong inference', () => {
    expect(classifyConfidence(0.9)).toBe('very_strong');
    expect(classifyConfidence(0.99)).toBe('very_strong');
  });

  it('classifies 0.80–0.89 as strong inference', () => {
    expect(classifyConfidence(0.8)).toBe('strong');
    expect(classifyConfidence(0.89)).toBe('strong');
  });

  it('classifies 0.50–0.79 as uncertain but potentially useful', () => {
    expect(classifyConfidence(0.5)).toBe('uncertain');
    expect(classifyConfidence(0.79)).toBe('uncertain');
  });

  it('classifies below 0.5 as below_threshold (docs/DATA_MODEL.md §4)', () => {
    expect(classifyConfidence(0.49)).toBe('below_threshold');
    expect(classifyConfidence(0)).toBe('below_threshold');
  });
});

describe('isSurfaceable', () => {
  it('surfaces at or above 0.5', () => {
    expect(isSurfaceable(0.5)).toBe(true);
    expect(isSurfaceable(1)).toBe(true);
  });

  it('keeps below-threshold evidence internal', () => {
    expect(isSurfaceable(0.49)).toBe(false);
  });
});

describe('clampConfidence', () => {
  it('clamps out-of-range values into [0, 1]', () => {
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(-0.2)).toBe(0);
    expect(clampConfidence(NaN)).toBe(0);
    expect(clampConfidence(0.87)).toBe(0.87);
  });
});

describe('confidenceLabel (docs/FEATURE_VISUALIZATION.md §6)', () => {
  it('labels deterministic facts as Confirmed', () => {
    expect(confidenceLabel(1)).toBe('Confirmed');
  });

  it('labels strong inference as Inferred', () => {
    expect(confidenceLabel(0.95)).toBe('Inferred');
    expect(confidenceLabel(0.85)).toBe('Inferred');
  });

  it('labels low confidence as Uncertain', () => {
    expect(confidenceLabel(0.6)).toBe('Uncertain');
    expect(confidenceLabel(0.3)).toBe('Uncertain');
  });
});
