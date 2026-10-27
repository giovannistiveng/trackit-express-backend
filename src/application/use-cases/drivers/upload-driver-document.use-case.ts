import { DocumentoConductorRepositoryPort } from '../../../domain/repositories/documento-conductor.repository.port';
import { CloudinaryAdapter } from '../../../infrastructure/external/cloudinary.adapter';
import { UploadDocumentoDTO } from '../../dtos/documento-conductor.dto';
import { ValidationError, NotFoundError } from '../../../shared/errors';

export class UploadDriverDocumentUseCase {
  constructor(
    private documentoRepository: DocumentoConductorRepositoryPort,
    private cloudinary: CloudinaryAdapter,
  ) {}

  async execute(
    dto: UploadDocumentoDTO,
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ id: number; url_archivo: string; tipo_documento: string }> {
    const tiposValidos = ['Cédula', 'SOAT', 'Licencia'];
    if (!tiposValidos.includes(dto.tipo_documento)) {
      throw new ValidationError('Tipo de documento inválido. Debe ser: Cédula, SOAT o Licencia');
    }

    const urlArchivo = await this.cloudinary.upload(fileBuffer, `trackit/documentos/${dto.id_conductor}`);

    const documento = await this.documentoRepository.create({
      tipo_documento: dto.tipo_documento as any,
      url_archivo: urlArchivo,
      id_conductor: dto.id_conductor,
    });

    return {
      id: documento.id!,
      url_archivo: documento.url_archivo,
      tipo_documento: documento.tipo_documento,
    };
  }
}