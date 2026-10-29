declare module 'cloudinary' {
  import { UploadApiResponse } from 'cloudinary';

  export function uploader(): {
    upload_stream(
      options: any,
      callback: (error: any, result?: UploadApiResponse) => void
    ): any;
  };

  export function config(options: {
    cloud_name: string;
    api_key: string;
    api_secret: string;
  }): void;

  export const v2: {
    config(options: {
      cloud_name: string;
      api_key: string;
      api_secret: string;
    }): void;
    uploader: {
      upload_stream(
        options: any,
        callback: (error: any, result?: UploadApiResponse) => void
      ): any;
    };
  };
}
