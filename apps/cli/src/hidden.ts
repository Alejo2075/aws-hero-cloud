/** The part of a terminal input that reading a hidden answer needs. */
export interface HiddenInput {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
}

export class PromptAborted extends Error {
  constructor() {
    super('prompt aborted');
    this.name = 'PromptAborted';
  }
}

/**
 * Reads one line without echoing it, for passwords and keys. Nothing typed is written to the
 * terminal, and the answer goes only to the caller. Ctrl-C aborts and Backspace edits.
 */
export function readHidden(
  question: string,
  input: HiddenInput,
  output: { write(text: string): unknown },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let value = '';
    output.write(question);
    input.setRawMode?.(true);
    input.resume();

    const finish = (): void => {
      input.removeListener('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString('utf8')) {
        const code = char.codePointAt(0) ?? 0;
        if (char === '\r' || char === '\n' || code === 4) {
          finish();
          resolve(value);
          return;
        }
        if (code === 3) {
          finish();
          reject(new PromptAborted());
          return;
        }
        if (code === 127 || code === 8) value = Array.from(value).slice(0, -1).join('');
        else if (code >= 32) value += char;
      }
    };
    input.on('data', onData);
  });
}
