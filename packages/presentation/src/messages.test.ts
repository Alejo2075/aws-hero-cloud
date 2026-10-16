import { describe, expect, it } from 'vitest';
import { Messages, interpolate, localeChain, placeholders } from './messages.js';

describe('localeChain', () => {
  it('goes from the exact locale to the language to the fallback', () => {
    expect(localeChain('es-MX', 'en')).toEqual(['es-MX', 'es', 'en']);
    expect(localeChain('es_ES', 'en')).toEqual(['es-ES', 'es', 'en']);
    expect(localeChain('en', 'en')).toEqual(['en']);
  });
});

describe('interpolate and placeholders', () => {
  it('fills known parameters and leaves unknown ones visible', () => {
    expect(interpolate('Hello {name}, you have {count}', { name: 'Ada', count: 3 })).toBe(
      'Hello Ada, you have 3',
    );
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
  });

  it('does not treat parameter values as templates', () => {
    expect(interpolate('Hi {name}', { name: '{count}' })).toBe('Hi {count}');
  });

  it('lists the placeholders of a template', () => {
    expect(placeholders('a {x} b {y.z} c {x}')).toEqual(['x', 'y.z', 'x']);
  });
});

describe('Messages', () => {
  const messages = new Messages([
    {
      locale: 'en',
      messages: {
        hello: 'Hello',
        level: { simple: 'S', guided: 'G', expert: 'E' },
        onlyEn: 'English only',
      },
    },
    {
      locale: 'es',
      messages: { hello: 'Hola', level: { simple: 'Sí', guided: 'Gí', expert: 'Eí' } },
    },
  ]);

  it('finds a message in the requested locale and level', () => {
    expect(messages.text('hello', 'simple', 'es')).toBe('Hola');
    expect(messages.text('level', 'guided', 'es')).toBe('Gí');
    expect(messages.text('level', 'expert', 'en')).toBe('E');
  });

  it('falls back from a regional locale to its language, and then to English', () => {
    expect(messages.text('hello', 'simple', 'es-MX')).toBe('Hola');
    expect(messages.text('onlyEn', 'simple', 'es')).toBe('English only');
    expect(messages.text('hello', 'simple', 'fr')).toBe('Hello');
  });

  it('shows the code itself when no locale has a message, never an empty string', () => {
    expect(messages.text('missing.code', 'simple', 'en')).toBe('missing.code');
    expect(messages.find('missing.code', 'simple', 'en')).toBeUndefined();
  });

  it('reports which levels a message defines', () => {
    expect(messages.levelsOf('hello', 'en')).toBe('all');
    expect(messages.levelsOf('level', 'en')).toEqual(['expert', 'guided', 'simple']);
    expect(messages.levelsOf('nope', 'en')).toBeUndefined();
  });
});
