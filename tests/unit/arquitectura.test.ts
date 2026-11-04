import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

/**
 * Reglas de la arquitectura hexagonal (las dependencias solo apuntan hacia adentro):
 *
 *   domain          entidades, reglas puras y puertos (interfaces)      → no depende de nada
 *   application     casos de uso y servicios de aplicación              → solo de domain y shared
 *   infrastructure  adaptadores: HTTP, PostgreSQL, Nequi, correo, push… → puede usar las demás capas
 *   config          lectura del entorno                                 → solo la usa infrastructure
 *   shared          errores y logger                                    → no depende de capas internas
 */
const SRC = resolve(__dirname, '../../src');

const PROHIBIDO: Record<string, string[]> = {
  domain: ['application', 'infrastructure', 'config'],
  application: ['infrastructure', 'config'],
  shared: ['domain', 'application', 'infrastructure'],
  config: ['domain', 'application', 'infrastructure'],
};

/** Paquetes externos permitidos en las capas internas (nada de Express, pg, Nequi, etc.). */
const PAQUETES_PERMITIDOS: Record<string, string[]> = {
  domain: [],
  application: ['crypto'],
};

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const capa = (archivo: string) => relative(SRC, archivo).split(sep)[0];

function importaciones(archivo: string): string[] {
  const codigo = readFileSync(archivo, 'utf8');
  return [...codigo.matchAll(/(?:import|export)\s[^;]*?from\s+'([^']+)'/gs)].map((m) => m[1]);
}

describe('Arquitectura hexagonal', () => {
  const todos = archivos(SRC);

  it.each(Object.keys(PROHIBIDO))('la capa "%s" no depende de capas externas', (origen) => {
    const violaciones = todos
      .filter((a) => capa(a) === origen)
      .flatMap((a) =>
        importaciones(a)
          .filter((r) => r.startsWith('.'))
          .map((r) => ({ archivo: relative(SRC, a), destino: capa(resolve(dirname(a), r)) }))
          .filter((x) => PROHIBIDO[origen].includes(x.destino)),
      );
    expect(violaciones).toEqual([]);
  });

  it.each(Object.keys(PAQUETES_PERMITIDOS))('la capa "%s" no usa librerías de infraestructura', (origen) => {
    const externos = todos
      .filter((a) => capa(a) === origen)
      .flatMap((a) =>
        importaciones(a)
          .filter((r) => !r.startsWith('.') && !PAQUETES_PERMITIDOS[origen].includes(r))
          .map((r) => `${relative(SRC, a)} → ${r}`),
      );
    expect(externos).toEqual([]);
  });

  it('los puertos del dominio son solo contratos (sin clases concretas)', () => {
    const conClases = archivos(join(SRC, 'domain', 'ports')).filter((a) =>
      /^export class /m.test(readFileSync(a, 'utf8')),
    );
    expect(conClases).toEqual([]);
  });

  it('solo el contenedor de dependencias construye los adaptadores', () => {
    const fuera = todos
      .filter((a) => capa(a) === 'infrastructure' && !a.endsWith('container.ts'))
      .filter((a) => /new \w+RepositoryPostgres\(/.test(readFileSync(a, 'utf8')))
      .map((a) => relative(SRC, a));
    expect(fuera).toEqual([]);
  });
});
