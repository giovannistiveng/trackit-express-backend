import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { config } from '../../config';

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
});

export class CloudinaryAdapter {
  async upload(fileBuffer: Buffer, folder: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            reject(error ?? new Error('Error subiendo archivo a Cloudinary'));
            return;
          }
          resolve(result.secure_url);
        }
      );
      uploadStream.end(fileBuffer);
    });
  }
}