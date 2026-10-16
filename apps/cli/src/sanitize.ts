/**
 * Text that came from the analyzed project (dependency names, file paths, spec values) is
 * untrusted. Printed raw, it could carry terminal escape sequences that rewrite the screen, change
 * the title, or write to the clipboard. This keeps printable text and newlines, and replaces
 * everything else with a visible placeholder.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function sanitizeForTerminal(text: string): string {
  return text.replace(UNSAFE, '�');
}
