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
      public_id: 'sleeky-website/briefs/mockup_ab12',
      format: 'png',
      resource_type: 'image',
    });
    const before = Date.now();

    const stored = await new BriefFilesService().store({
      name: 'mockup.png',
      buffer: Buffer.from('PNG'),
      mimetype: 'image/png',
    });

    expect(options[0]).toMatchObject({
      type: 'private',
      resource_type: 'image',
      folder: 'sleeky-website/briefs',
      filename_override: 'mockup.png',
    });
    const url = new URL(stored.url);
    expect(url.origin + url.pathname).toBe(
      'https://api.cloudinary.com/v1_1/demo/image/download',
    );
    expect(url.searchParams.get('public_id')).toBe(
      'sleeky-website/briefs/mockup_ab12',
    );
    expect(url.searchParams.get('format')).toBe('png');
    expect(url.searchParams.get('type')).toBe('private');
    expect(url.searchParams.get('signature')).toBeTruthy();
    // Valid for 30 days by default.
    const expiresAt = Number(url.searchParams.get('expires_at')) * 1000;
    expect(expiresAt - before).toBeGreaterThan(29.9 * 86_400_000);
    expect(expiresAt - before).toBeLessThan(30.1 * 86_400_000);
    expect(stored.expiresAt.getTime()).toBe(expiresAt);
  });

  it.each([
    ['brief.pdf', 'application/pdf'],
    [
      'brief.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  ])(
    'stores %s as a plain file (not inspected) and links it with its extension',
    async (name, mimetype) => {
      const extension = name.split('.').pop();
      const options = fakeUpload({
        public_id: `sleeky-website/briefs/brief_cd34.${extension}`,
        resource_type: 'raw',
      });
      const stored = await new BriefFilesService().store({
        name,
        buffer: Buffer.from('file'),
        mimetype,
      });
      expect(options[0]).toMatchObject({ resource_type: 'raw' });
      const url = new URL(stored.url);
      expect(url.pathname).toBe('/v1_1/demo/raw/download');
      expect(url.searchParams.get('public_id')).toBe(
        `sleeky-website/briefs/brief_cd34.${extension}`,
      );
    },
  );
});
