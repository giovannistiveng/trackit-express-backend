import { Request, Response } from 'express';
import { UploadDriverDocumentUseCase } from '../../../application/use-cases/drivers/upload-driver-document.use-case';
import { UploadDocumentoDTO } from '../../../application/dtos/documento-conductor.dto';
import { File } from 'multer';

export class DocumentoConductorController {
  constructor(private uploadDriverDocumentUseCase: UploadDriverDocumentUseCase) {}

  async upload(req: Request & { file: File }, res: Response): Promise<void> {
    const dto: UploadDocumentoDTO = {
      tipo_documento: req.body.tipo_documento,
      id_conductor: parseInt(req.body.id_conductor, 10),
    };

    if (!req.file) {
      res.status(400).json({ error: 'No se proporcionó ningún archivo' });
      return;
    }

    const result = await this.uploadDriverDocumentUseCase.execute(
      dto,
      req.file.buffer,
      req.file.originalname,
    );

    res.status(201).json({
      message: 'Documento subido exitosamente',
      documento: result,
    });
  }
}