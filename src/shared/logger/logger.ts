import fs from 'fs';
import path from 'path';

/**
 * Logger de TrackIt Express.
 *
 * Escribe cada evento en archivos de texto plano (.txt) dentro de la carpeta de logs:
 *   - trackit-AAAA-MM-DD.txt  → todos los eventos del día (según el nivel configurado)
 *   - errores-AAAA-MM-DD.txt  → solo WARN y ERROR, para revisarlos rápido
 *
 * Los archivos rotan por día y los que superan los días de retención se borran al arrancar.
 * Los datos sensibles (contraseñas, PIN, tokens, secretos) se reemplazan por [OCULTO].
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_WEIGHT: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

/** Campos que se ocultan si el nombre coincide exactamente (sin importar mayúsculas). */
const SENSITIVE_EXACT = ['pin', 'pin_seguridad', 'pinseguridad', 'apikey', 'api_key', 'authtoken', 'auth_token'];
/** Campos que se ocultan si el nombre contiene alguno de estos fragmentos. */
const SENSITIVE_PARTS = ['password', 'contrasena', 'contraseña', 'token', 'secret', 'authorization'];

export interface LoggerOptions {
  dir: string;
  level: LogLevel;
  retentionDays: number;
  toConsole: boolean;
  /** Prefijo del archivo principal (por defecto "trackit" → trackit-AAAA-MM-DD.txt). */
  filePrefix?: string;
  /** Prefijo del archivo de WARN/ERROR; null para no generar ese archivo (por defecto "errores"). */
  errorFilePrefix?: string | null;
  /** Permite fijar la fecha en pruebas. */
  now?: () => Date;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

/** Fecha local AAAA-MM-DD (para el nombre del archivo). */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fecha y hora local AAAA-MM-DD HH:mm:ss.SSS (para cada línea). */
export function formatTimestamp(d: Date): string {
  return (
    `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}`
  );
}

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_EXACT.includes(k) || SENSITIVE_PARTS.some((part) => k.includes(part));
}

/** Copia profunda del valor con los campos sensibles ocultos. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[...]';
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[OCULTO]' : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

function serializeMeta(meta: unknown): string {
  if (meta === undefined) return '';
  const clean = sanitize(meta);
  if (clean && typeof clean === 'object' && 'stack' in (clean as Record<string, unknown>)) {
    const { stack, ...rest } = clean as Record<string, unknown>;
    const restStr = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${restStr}${stack ? `\n${String(stack)}` : ''}`;
  }
  try {
    return ` ${JSON.stringify(clean)}`;
  } catch {
    return ' [meta no serializable]';
  }
}

export class Logger {
  private readonly opts: Required<LoggerOptions>;
  private currentDate = '';
  private mainStream: fs.WriteStream | null = null;
  private errorStream: fs.WriteStream | null = null;
  private fileWritingDisabled = false;

  constructor(options: LoggerOptions, private readonly context?: string, private readonly parent?: Logger) {
    this.opts = { now: () => new Date(), filePrefix: 'trackit', errorFilePrefix: 'errores', ...options };
    if (!parent) this.init();
  }

  /** Crea un logger hijo que antepone [contexto] a cada mensaje y comparte los archivos. */
  child(context: string): Logger {
    return new Logger(this.opts, context, this.root());
  }

  debug(message: string, meta?: unknown): void {
    this.log('DEBUG', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('INFO', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('WARN', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('ERROR', message, meta);
  }

  /**
   * Escritura síncrona para eventos justo antes de terminar el proceso
   * (por ejemplo, un error fatal antes de process.exit), donde un stream podría no vaciarse.
   */
  fatal(message: string, meta?: unknown): void {
    const root = this.root();
    const line = this.buildLine('ERROR', message, meta);
    root.writeConsole('ERROR', line);
    if (root.fileWritingDisabled) return;
    try {
      const date = formatDate(root.opts.now());
      fs.appendFileSync(path.join(root.opts.dir, `${root.opts.filePrefix}-${date}.txt`), line + '\n', 'utf8');
      if (root.opts.errorFilePrefix) {
        fs.appendFileSync(path.join(root.opts.dir, `${root.opts.errorFilePrefix}-${date}.txt`), line + '\n', 'utf8');
      }
    } catch {
      /* si no se puede escribir, al menos quedó en consola */
    }
  }

  /** Cierra los archivos abiertos (útil en pruebas y al apagar el servidor). */
  close(): Promise<void> {
    const root = this.root();
    const streams = [root.mainStream, root.errorStream].filter(Boolean) as fs.WriteStream[];
    root.mainStream = null;
    root.errorStream = null;
    root.currentDate = '';
    return Promise.all(streams.map((s) => new Promise<void>((resolve) => s.end(resolve)))).then(() => undefined);
  }

  get directory(): string {
    return this.opts.dir;
  }

  // ---------------------------------------------------------------------------

  private root(): Logger {
    return this.parent ?? this;
  }

  private init(): void {
    try {
      fs.mkdirSync(this.opts.dir, { recursive: true });
      this.purgeOldFiles();
    } catch (err) {
      this.fileWritingDisabled = true;
      // eslint-disable-next-line no-console
      console.error(`[logger] No se pudo preparar la carpeta de logs "${this.opts.dir}":`, err);
    }
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    const root = this.root();
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[root.opts.level]) return;
    const line = this.buildLine(level, message, meta);
    root.writeConsole(level, line);
    root.writeFile(level, line);
  }

  private buildLine(level: LogLevel, message: string, meta?: unknown): string {
    const ts = formatTimestamp(this.root().opts.now());
    const ctx = this.context ? ` [${this.context}]` : '';
    return `[${ts}] [${level.padEnd(5)}]${ctx} ${message}${serializeMeta(meta)}`;
  }

  private writeConsole(level: LogLevel, line: string): void {
    if (!this.opts.toConsole) return;
    /* eslint-disable no-console */
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
    /* eslint-enable no-console */
  }

  private writeFile(level: LogLevel, line: string): void {
    if (this.fileWritingDisabled) return;
    try {
      this.ensureStreams();
      this.mainStream?.write(line + '\n');
      if (LEVEL_WEIGHT[level] >= LEVEL_WEIGHT.WARN) this.errorStream?.write(line + '\n');
    } catch (err) {
      this.fileWritingDisabled = true;
      // eslint-disable-next-line no-console
      console.error('[logger] Se desactiva la escritura en archivo por un error:', err);
    }
  }

  /** Abre (o rota) los archivos del día actual. */
  private ensureStreams(): void {
    const today = formatDate(this.opts.now());
    if (today === this.currentDate && this.mainStream) return;

    this.mainStream?.end();
    this.errorStream?.end();
    this.currentDate = today;

    const onError = (err: Error) => {
      this.fileWritingDisabled = true;
      // eslint-disable-next-line no-console
      console.error('[logger] Error escribiendo el archivo de log:', err.message);
    };

    this.mainStream = fs.createWriteStream(path.join(this.opts.dir, `${this.opts.filePrefix}-${today}.txt`), {
      flags: 'a',
      encoding: 'utf8',
    });
    this.mainStream.on('error', onError);
    if (this.opts.errorFilePrefix) {
      this.errorStream = fs.createWriteStream(path.join(this.opts.dir, `${this.opts.errorFilePrefix}-${today}.txt`), {
        flags: 'a',
        encoding: 'utf8',
      });
      this.errorStream.on('error', onError);
    }
  }

  /** Borra los archivos de log más antiguos que la retención configurada. */
  private purgeOldFiles(): void {
    if (this.opts.retentionDays <= 0) return;
    const limit = new Date(this.opts.now());
    limit.setHours(0, 0, 0, 0);
    limit.setDate(limit.getDate() - this.opts.retentionDays);
    const limitStr = formatDate(limit);

    for (const file of fs.readdirSync(this.opts.dir)) {
      const match = /^(.+)-(\d{4}-\d{2}-\d{2})\.txt$/.exec(file);
      const own = match && (match[1] === this.opts.filePrefix || match[1] === this.opts.errorFilePrefix);
      if (match && own && match[2] < limitStr) {
        try {
          fs.unlinkSync(path.join(this.opts.dir, file));
        } catch {
          /* se ignora: se reintentará en el próximo arranque */
        }
      }
    }
  }
}
