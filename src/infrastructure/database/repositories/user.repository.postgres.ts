import { Pool } from 'pg';
import { ROLES } from '../../../domain/entities/actor.entity';
import { User } from '../../../domain/entities/user.entity';
import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';

interface UsuarioRow {
  id_usuario: number;
  nombre: string;
  correo: string;
  password_hash: string;
  id_rol: number;
}

export class UserRepositoryPostgres implements UserRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async create(user: Omit<User, 'id'>): Promise<User> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<UsuarioRow>(
        `INSERT INTO Usuario (nombre, correo, password_hash, id_rol)
         VALUES ($1, $2, $3, $4)
         RETURNING id_usuario, nombre, correo, password_hash, id_rol`,
        [user.nombre, user.correo, user.password_hash, user.id_rol],
      );
      const row = result.rows[0];
      // Un usuario Conductor nace con su perfil en estado Pendiente
      if (user.id_rol === ROLES.CONDUCTOR) {
        await client.query(`INSERT INTO Conductor (id_usuario, estado_aprobacion) VALUES ($1, 'Pendiente')`, [row.id_usuario]);
      }
      await client.query('COMMIT');
      return this.mapRow(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findByEmail(correo: string): Promise<User | null> {
    const result = await this.pool.query<UsuarioRow>('SELECT * FROM Usuario WHERE LOWER(correo) = LOWER($1)', [correo]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async findById(id: number): Promise<User | null> {
    const result = await this.pool.query<UsuarioRow>('SELECT * FROM Usuario WHERE id_usuario = $1', [id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: UsuarioRow): User {
    return { id: row.id_usuario, nombre: row.nombre, correo: row.correo, password_hash: row.password_hash, id_rol: row.id_rol };
  }
}
