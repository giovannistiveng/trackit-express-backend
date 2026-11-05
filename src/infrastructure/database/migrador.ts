import { readdirSync, readFileSync } from 'fs';
import path from 'path';

/** Lo mínimo que el migrador necesita de un pool de PostgreSQL. */
export interface EjecutorSql {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Carpeta database/ del proyecto (igual desde src/ con ts-node que desde dist/ compilado). */
export const DIR_BASE_DATOS = path.resolve(__dirname, '..', '..', '..', 'database');

/**
 * Administra el esquema sin depender de psql (funciona igual en Windows, macOS, Linux y Docker).
 *  - setup:   crea las tablas (schema.sql), carga los datos iniciales (seed.sql) y marca las
 *             migraciones como aplicadas (una base nueva ya las trae).
 *  - migrate: aplica en orden las migraciones pendientes de database/migrations.
 *  - preparar: setup si la base está vacía, migrate si ya tiene tablas (arranque en Docker).
 */
export class Migrador {
  constructor(
    private readonly db: EjecutorSql,
    private readonly dir = DIR_BASE_DATOS,
    private readonly log: (m: string) => void = console.log,
  ) {}

  async setup(): Promise<void> {
    this.log('Creando esquema y datos iniciales…');
    await this.ejecutar(path.join(this.dir, 'schema.sql'));
    await this.ejecutar(path.join(this.dir, 'seed.sql'));
    await this.registrarTabla();
    for (const m of this.migraciones()) {
      await this.db.query('INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [m]);
    }
  }

  /** Devuelve las migraciones aplicadas en esta ejecución. */
  async migrate(): Promise<string[]> {
    await this.registrarTabla();
    const aplicadas = new Set(
      (await this.db.query<{ nombre: string }>('SELECT nombre FROM schema_migrations')).rows.map((r) => r.nombre),
    );
    const pendientes = this.migraciones().filter((m) => !aplicadas.has(m));
    if (pendientes.length === 0) {
      this.log('No hay migraciones pendientes.');
      return [];
    }
    this.log(`Aplicando ${pendientes.length} migración(es)…`);
    for (const m of pendientes) {
      await this.ejecutar(path.join(this.dir, 'migrations', m));
      await this.db.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [m]);
    }
    // El seed es idempotente: corrige el administrador sembrado en versiones anteriores
    await this.ejecutar(path.join(this.dir, 'seed.sql'));
    return pendientes;
  }

  async preparar(): Promise<'creada' | 'actualizada'> {
    const r = await this.db.query<{ existe: boolean }>("SELECT to_regclass('public.usuario') IS NOT NULL AS existe");
    if (r.rows[0]?.existe) {
      await this.migrate();
      return 'actualizada';
    }
    await this.setup();
    return 'creada';
  }

  migraciones(): string[] {
    return readdirSync(path.join(this.dir, 'migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
  }

  private async ejecutar(archivo: string): Promise<void> {
    await this.db.query(readFileSync(archivo, 'utf8'));
    this.log(`  ✔ ${path.relative(this.dir, archivo)}`);
  }

  private async registrarTabla(): Promise<void> {
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (nombre VARCHAR(200) PRIMARY KEY, aplicada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
  }
}
