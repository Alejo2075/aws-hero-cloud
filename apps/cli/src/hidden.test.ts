import { describe, expect, it } from 'vitest';
import { PromptAborted, readHidden } from './hidden.js';
import type { HiddenInput } from './hidden.js';

function terminal() {
  let listener: ((chunk: Buffer | string) => void) | undefined;
  const raw: boolean[] = [];
  let paused = false;
  const input: HiddenInput = {
    isTTY: true,
    setRawMode: (mode) => raw.push(mode),
    on: (_e, l) => {
      listener = l;
    },
    removeListener: () => {
      listener = undefined;
    },
    resume: () => {
      paused = false;
    },
    pause: () => {
      paused = true;
    },
  };
  let out = '';
  return {
    input,
    output: { write: (t: string) => (out += t) },
    type: (chunk: string) => listener?.(Buffer.from(chunk)),
    out: () => out,
    raw,
    paused: () => paused,
    listening: () => listener !== undefined,
  };
}

describe('readHidden', () => {
  it('returns what was typed and echoes none of it', async () => {
    const t = terminal();
    const answer = readHidden('Key: ', t.input, t.output);
    t.type('sk_');
    t.type('live_123');
    t.type('\r');
    expect(await answer).toBe('sk_live_123');
    expect(t.out()).toBe('Key: \n');
    expect(t.out()).not.toContain('sk_');
    expect(t.raw).toEqual([true, false]);
    expect(t.paused()).toBe(true);
    expect(t.listening()).toBe(false);
  });

  it('handles paste in one chunk, backspace, and ignores control characters', async () => {
    const t = terminal();
    const answer = readHidden('? ', t.input, t.output);
    t.type('abcd\u007f\u007fXY\u001b\u0000z\n');
    expect(await answer).toBe('abXYz');
  });

  it('aborts on Ctrl-C and restores the terminal', async () => {
    const t = terminal();
    const answer = readHidden('? ', t.input, t.output);
    t.type('abc\u0003');
    await expect(answer).rejects.toBeInstanceOf(PromptAborted);
    expect(t.raw).toEqual([true, false]);
    expect(t.listening()).toBe(false);
  });

  it('keeps multi-byte characters whole', async () => {
    const t = terminal();
    const answer = readHidden('? ', t.input, t.output);
    t.type('contraseña🔑\u007f\n');
    expect(await answer).toBe('contraseña');
  });
});
