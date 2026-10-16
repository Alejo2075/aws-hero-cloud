import type { Block, View } from '@hero-cloud/presentation';
import { sanitizeForTerminal } from './sanitize.js';

export interface TextOptions {
  readonly color: boolean;
  readonly width: number;
}

const RESET = '\u001b[0m';
const STYLES = {
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
} as const;

function paint(options: TextOptions, style: keyof typeof STYLES, text: string): string {
  return options.color ? `${STYLES[style]}${text}${RESET}` : text;
}

/** Breaks text into lines of at most `width` characters, never splitting a word unless it must. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Splits a cell into lines of at most `width` characters, breaking long words if needed. */
function wrapCell(text: string, width: number): string[] {
  return wrap(text, Math.max(width, 1));
}

/**
 * Draws a table that fits the terminal without losing anything: when it is too wide, the widest
 * columns shrink and their cells continue on the next line, instead of being cut off.
 */
function renderTable(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  options: TextOptions,
): string[] {
  const gap = 2;
  const clean = (cell: string): string => sanitizeForTerminal(cell).replace(/\s+/g, ' ').trim();
  const table = [columns, ...rows].map((row) => row.map(clean));
  const widths = columns.map((_c, index) =>
    Math.max(1, ...table.map((row) => (row[index] ?? '').length)),
  );
  const available = Math.max(options.width - gap * (columns.length - 1), columns.length * 8);
  const minimum = 12;
  while (widths.reduce((sum, width) => sum + width, 0) > available) {
    const widest = widths.indexOf(Math.max(...widths));
    if ((widths[widest] ?? 0) <= minimum) break;
    widths[widest] = Math.max(minimum, (widths[widest] ?? 0) - 1);
  }

  const draw = (row: readonly string[], style?: keyof typeof STYLES): string[] => {
    const cells = widths.map((width, index) => wrapCell(row[index] ?? '', width));
    const height = Math.max(...cells.map((lines) => lines.length));
    return Array.from({ length: height }, (_unused, line) => {
      const text = cells
        .map((lines, index) => (lines[line] ?? '').padEnd(widths[index] ?? 0))
        .join(' '.repeat(gap))
        .trimEnd();
      return style === undefined ? text : paint(options, style, text);
    });
  };
  const [header = [], ...body] = table;
  return [...draw(header, 'bold'), ...body.flatMap((row) => draw(row))];
}

function renderBlock(block: Block, options: TextOptions): string[] {
  switch (block.type) {
    case 'paragraph':
      return wrap(sanitizeForTerminal(block.text), options.width);
    case 'list':
      return block.items.flatMap((item) => {
        const [first = '', ...rest] = wrap(sanitizeForTerminal(item), options.width - 4);
        return [`  • ${first}`, ...rest.map((line) => `    ${line}`)];
      });
    case 'table':
      return renderTable(block.columns, block.rows, options);
    case 'code':
      return sanitizeForTerminal(block.text)
        .split('\n')
        .map((line) => paint(options, 'dim', `  ${line}`));
    case 'callout': {
      const style = block.tone === 'danger' ? 'red' : block.tone === 'warning' ? 'yellow' : 'cyan';
      const mark = block.tone === 'info' ? 'i' : '!';
      const [first = '', ...rest] = wrap(sanitizeForTerminal(block.text), options.width - 4);
      return [
        paint(options, style, `  ${mark} ${first}`),
        ...rest.map((line) => paint(options, style, `    ${line}`)),
      ];
    }
  }
}

/** Draws a renderer-neutral view as plain text, with optional color. */
export function renderText(view: View, options: TextOptions): string {
  const out: string[] = [paint(options, 'bold', sanitizeForTerminal(view.title)), ''];
  for (const section of view.sections) {
    out.push(paint(options, 'bold', sanitizeForTerminal(section.heading)));
    for (const block of section.blocks) out.push(...renderBlock(block, options));
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
