import { v2 as cloudinary } from 'cloudinary';
import { BriefFilesService } from './brief-files.service';

describe('BriefFilesService', () => {
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = '123456';
    process.env.CLOUDINARY_API_SECRET = 'secret';
    delete process.env.BRIEF_FILE_LINK_DAYS;
  });
  afterEach(() => jest.restoreAllMocks());

  /** Pretends Cloudinary stored the upload, and records the options it was sent. */
  function fakeUpload(result: Record<string, unknown>) {
    const options: Record<string, unknown>[] = [];
    jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation(((
      opts: Record<string, unknown>,
      callback: (error: unknown, result: unknown) => void,
    ) => {
      options.push(opts);
      return { end: () => callback(undefined, result) };
    }) as never);
    return options;
  }

  it('is only enabled with all three Cloudinary settings', () => {
    expect(new BriefFilesService().enabled).toBe(true);
    delete process.env.CLOUDINARY_API_SECRET;
    expect(new BriefFilesService().enabled).toBe(false);
  });

  it('uploads the file as private and returns a signed, expiring download link', async () => {
    const options = fakeUpload({
      public_id: 'sleeky-website/briefs/brief_ab12',
      format: 'pdf',
      resource_type: 'image',
    });
    const before = Date.now();

    const stored = await new BriefFilesService().store({
      name: 'brief.pdf',
      buffer: Buffer.from('%PDF'),
      mimetype: 'application/pdf',
    });

    expect(options[0]).toMatchObject({
      type: 'private',
      resource_type: 'auto',
      folder: 'sleeky-website/briefs',
      filename_override: 'brief.pdf',
    });
    const url = new URL(stored.url);
    expect(url.origin + url.pathname).toBe(
      'https://api.cloudinary.com/v1_1/demo/image/download',
    );
    expect(url.searchParams.get('public_id')).toBe(
      'sleeky-website/briefs/brief_ab12',
    );
    expect(url.searchParams.get('type')).toBe('private');
    expect(url.searchParams.get('signature')).toBeTruthy();
    // Valid for 30 days by default.
    const expiresAt = Number(url.searchParams.get('expires_at')) * 1000;
    expect(expiresAt - before).toBeGreaterThan(29.9 * 86_400_000);
    expect(expiresAt - before).toBeLessThan(30.1 * 86_400_000);
    expect(stored.expiresAt.getTime()).toBe(expiresAt);
  });

  it('links Word documents as raw files, keeping their extension', async () => {
    fakeUpload({
      public_id: 'sleeky-website/briefs/brief_cd34.docx',
      resource_type: 'raw',
    });
    const stored = await new BriefFilesService().store({
      name: 'brief.docx',
      buffer: Buffer.from('PK'),
      mimetype:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const url = new URL(stored.url);
    expect(url.pathname).toBe('/v1_1/demo/raw/download');
    expect(url.searchParams.get('public_id')).toBe(
      'sleeky-website/briefs/brief_cd34.docx',
    );
  });
});
