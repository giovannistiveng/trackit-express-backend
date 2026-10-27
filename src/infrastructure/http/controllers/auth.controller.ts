import { Request, Response } from 'express';
import { RegisterUserUseCase } from '../../../application/use-cases/auth/register-user.use-case';
import { LoginUserUseCase } from '../../../application/use-cases/auth/login-user.use-case';
import { RegisterUserDTO, LoginDTO } from '../../../application/dtos/auth.dto';

export class AuthController {
  constructor(
    private registerUserUseCase: RegisterUserUseCase,
    private loginUserUseCase: LoginUserUseCase,
  ) {}

  async register(req: Request, res: Response): Promise<void> {
    const dto: RegisterUserDTO = req.body;
    const result = await this.registerUserUseCase.execute(dto);
    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: result,
    });
  }

  async login(req: Request, res: Response): Promise<void> {
    const dto: LoginDTO = req.body;
    const result = await this.loginUserUseCase.execute(dto);
    res.status(200).json({
      message: 'Inicio de sesión exitoso',
      ...result,
    });
  }
}