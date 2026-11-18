import { describe, it, expect } from '@jest/globals';
import { aTexto, mensajeDe } from '../../src/domain/services/texto';

describe('texto de valores sin tipo', () => {
  it('convierte primitivos y descarta objetos y arreglos', () => {
    expect([aTexto('a'), aTexto(7), aTexto(true), aTexto(10n)]).toEqual(['a', '7', 'true', '10']);
    expect([aTexto(undefined), aTexto(null), aTexto({ a: 1 }), aTexto(['1', '2'])]).toEqual(['', '', '', '']);
  });

  it('mensaje de un error o de lo que se haya lanzado', () => {
    expect(mensajeDe(new Error('falló'))).toBe('falló');
    expect(mensajeDe('texto')).toBe('texto');
    expect(mensajeDe({ code: 1 })).toBe('');
  });
});
