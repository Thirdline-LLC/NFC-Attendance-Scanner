import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, stripVersionPrefix } from '../src/version';

describe('stripVersionPrefix', () => {
  it('drops a leading v or V', () => {
    expect(stripVersionPrefix('v1.2.3')).toBe('1.2.3');
    expect(stripVersionPrefix('V1.2.3')).toBe('1.2.3');
  });

  it('leaves a version with no prefix alone', () => {
    expect(stripVersionPrefix('1.2.3')).toBe('1.2.3');
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.3', '1.2.9')).toBe(1);
  });

  it('tolerates a leading v on either side', () => {
    expect(compareVersions('v1.1.0', '1.0.0')).toBe(1);
  });
});

describe('isNewerVersion', () => {
  it('is true only when the candidate is strictly greater', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
  });
});
