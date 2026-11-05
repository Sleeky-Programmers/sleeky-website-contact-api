import { Injectable } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

const FOLDER = 'sleeky-website/briefs';
const DEFAULT_LINK_DAYS = 30;

export type StoredBriefFile = {
  /** Private, signed download link that stops working at `expiresAt`. */
  url: string;
  expiresAt: Date;
};

/**
 * Keeps brief attachments in Cloudinary as *private* files (not reachable by a
 * public URL) and hands out signed download links that expire, for the
 * client's WhatsApp message and the Zoho CRM note.
 */
@Injectable()
export class BriefFilesService {
  private get credentials() {
    return {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    };
  }

  get enabled() {
    const { cloud_name, api_key, api_secret } = this.credentials;
    return Boolean(cloud_name && api_key && api_secret);
  }

  private get linkDays() {
    const days = Number(process.env.BRIEF_FILE_LINK_DAYS);
    return Number.isFinite(days) && days > 0 ? days : DEFAULT_LINK_DAYS;
  }

  async store(file: {
    name: string;
    buffer: Buffer;
    mimetype: string;
  }): Promise<StoredBriefFile> {
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          ...this.credentials,
          type: 'private',
          // PNG/JPG as images; PDFs and Word documents as plain files, which
          // Cloudinary stores as they are (it rejects PDFs it can't render).
          resource_type: file.mimetype.startsWith('image/') ? 'image' : 'raw',
          folder: FOLDER,
          use_filename: true,
          unique_filename: true,
          filename_override: file.name,
        },
        (error, result) =>
          error || !result
            ? reject(error ?? new Error('Cloudinary returned no result'))
            : resolve(result),
      );
      stream.end(file.buffer);
    });

    // Whole seconds, as in the link itself.
    const expiresAt = new Date(
      Math.floor((Date.now() + this.linkDays * 86_400_000) / 1000) * 1000,
    );
    // Raw files keep their extension in the public id, so they take no format.
    const format =
      uploaded.resource_type === 'raw' ? '' : (uploaded.format ?? '');
    const url = cloudinary.utils.private_download_url(
      uploaded.public_id,
      format,
      {
        ...this.credentials,
        resource_type: uploaded.resource_type,
        type: 'private',
        expires_at: Math.floor(expiresAt.getTime() / 1000),
        attachment: true,
      },
    );
    return { url, expiresAt };
  }
}
