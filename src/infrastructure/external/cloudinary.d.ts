declare module 'cloudinary' {
  export interface UploadApiResponse {
    secure_url: string;
    [key: string]: any;
  }

  export interface CloudinaryOptions {
    cloud_name: string;
    api_key: string;
    api_secret: string;
  }

  export function config(options: CloudinaryOptions): void;

  export const v2: {
    config(options: CloudinaryOptions): void;
    uploader: {
      upload_stream(
        options: any,
        callback: (error: any, result?: UploadApiResponse) => void
      ): any;
    };
  };

  export const uploader: {
    upload_stream(
      options: any,
      callback: (error: any, result?: UploadApiResponse) => void
    ): any;
  };
}
