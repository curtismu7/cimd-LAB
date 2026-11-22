// The vendored run-observability files (rule 27) match run-observability.sha256 byte for byte. They come from curtismu7/AI-DEMO-Standalone
// shared/run-observability: change them there, re-vendor (every file, the pin and scripts/run-observability-checkPin.mjs together); never edit
// them here. The one pin check is the shared helper, itself vendored byte for byte; no hash and no file list is hard-coded in this test.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { checkPin } from '../../scripts/run-observability-checkPin.mjs';

describe('vendored run-observability', () => {
  it('the pin check finds no problem (an edited, missing-from-the-pin or unreadable file fails)', () => {
    expect(checkPin(path.join(process.cwd(), '..'))).toEqual([]);
  });
});
