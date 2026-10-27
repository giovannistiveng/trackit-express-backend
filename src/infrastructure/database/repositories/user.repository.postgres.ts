import { Pool } from 'pg';
import { User } from '../../../domain/entities/user.entity';
import { UserRepositoryPort } from '../../../domain/repositories/user.repository.port';

export class UserRepositoryPostgres implements UserRepositoryPort {
  constructor(private pool: Pool) {}

  async create(user: Omit<User, 'id'>): Promise<User> {
    const query = `
      INSERT INTO Usuario (nombre, correo, password_hash, id_rol)
      VALUES ($1, $2, $3, $4)
      RETURNING id_usuario, nombre, correo, password_hash, id_rol
    `;
    const values = [user.nombre, user.correo, user.password_hash, user.id_rol];
    const result = await this.pool.query(query, values);
    const row = result.rows[0];
    return this.mapRow(row);
  }

  async findByEmail(correo: string): Promise<User | null> {
    const query = 'SELECT * FROM Usuario WHERE correo = $1';
    const result = await this.pool.query(query, [correo]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  async findById(id: number): Promise<User | null> {
    const query = 'SELECT * FROM Usuario WHERE id_usuario = $1';
    const result = await this.pool.query(query, [id]);
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }



  private mapRow(row: any): User {
    return {
      id: row.id_usuario,
      nombre: row.nombre,
      correo: row.correo,
      password_hash: row.password_hash,
      id_rol: row.id_rol,
    };
  }
}