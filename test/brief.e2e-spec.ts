import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { BriefModule } from './../src/brief/brief.module';
import { BriefFilesService } from './../src/brief-files/brief-files.service';
import { EmailService } from './../src/email/email.service';
import { WhatsAppService } from './../src/whatsapp/whatsapp.service';
import { ZohoService } from './../src/zoho/zoho.service';

describe('BriefController (e2e)', () => {
  let app: INestApplication;
  const emailService = { verifyCaptcha: jest.fn(), send: jest.fn() };
  const zohoService = { enabled: true, createLead: jest.fn() };
  const briefFiles = { enabled: true, store: jest.fn() };
  const whatsapp = { enabled: true, alertTeam: jest.fn() };
  const FILE_URL =
    'https://api.cloudinary.com/v1_1/demo/image/download?signature=abc';

  const brief = (channel: 'whatsapp' | 'email' | 'phone' = 'whatsapp') =>
    request(app.getHttpServer())
      .post('/brief')
      .field('services', 'website')
      .field('services', 'business-automation')
      .field('goal', 'We want customers to book online.')
      .field('timeline', 'asap')
      .field('name', 'Ada Okafor')
      .field('company', 'Acme')
      .field('email', 'ada@company.com')
      .field('phone', '0803 123 4567')
      .field('channel', channel)
      .field('captchaToken', 'token');

  const pdf = { filename: 'brief.pdf', contentType: 'application/pdf' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [BriefModule],
    })
      .overrideProvider(EmailService)
      .useValue(emailService)
      .overrideProvider(ZohoService)
      .useValue(zohoService)
      .overrideProvider(BriefFilesService)
      .useValue(briefFiles)
      .overrideProvider(WhatsAppService)
      .useValue(whatsapp)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  beforeEach(() => {
    emailService.verifyCaptcha.mockReset().mockResolvedValue(undefined);
    emailService.send.mockReset().mockResolvedValue({});
    zohoService.enabled = true;
    zohoService.createLead.mockReset().mockResolvedValue('5725767000000123001');
    briefFiles.enabled = true;
    briefFiles.store.mockReset().mockResolvedValue({
      url: FILE_URL,
      expiresAt: new Date('2026-12-05T00:00:00Z'),
    });
    whatsapp.enabled = true;
    whatsapp.alertTeam.mockReset().mockResolvedValue(2);
  });

  afterAll(() => app.close());

  describe('WhatsApp briefs', () => {
    it('saves the lead with the file and returns the file link for the message', async () => {
      await brief('whatsapp')
        .field('pageUri', 'https://sleekyprogrammers.com/start-a-project')
        .attach('file', Buffer.from('%PDF-1.4 test'), pdf)
        .expect(200, { message: 'Brief sent successfully', fileUrl: FILE_URL });

      expect(briefFiles.store).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'brief.pdf',
          mimetype: 'application/pdf',
        }),
      );
      expect(zohoService.createLead).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Ada Okafor',
          phone: '+2348031234567',
          channel: 'whatsapp',
          file: expect.objectContaining({ name: 'brief.pdf' }),
          fileLink: expect.objectContaining({ url: FILE_URL }),
        }),
      );
      // The client sends the WhatsApp message themselves; no API alert.
      expect(whatsapp.alertTeam).not.toHaveBeenCalled();
    });

    it('still saves the lead (with the file attached in Zoho) if Cloudinary fails', async () => {
      briefFiles.store.mockRejectedValue(new Error('Cloudinary down'));
      const res = await brief('whatsapp')
        .attach('file', Buffer.from('%PDF-1.4 test'), pdf)
        .expect(200);

      expect(res.body.fileUrl).toBeUndefined();
      expect(zohoService.createLead).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.objectContaining({ name: 'brief.pdf' }),
          fileLink: undefined,
        }),
      );
    });

    it('returns no file link without an attachment', async () => {
      await brief('whatsapp').expect(200, {
        message: 'Brief sent successfully',
      });
      expect(briefFiles.store).not.toHaveBeenCalled();
    });
  });

  describe('team WhatsApp alerts', () => {
    it('alerts the team numbers for email briefs, after saving the lead', async () => {
      await brief('email')
        .attach('file', Buffer.from('%PDF-1.4 test'), pdf)
        .expect(200);

      expect(whatsapp.alertTeam).toHaveBeenCalledWith(
        {
          name: 'Ada Okafor (Acme)',
          channel: 'Email',
          contact: '+2348031234567 / ada@company.com',
          services: 'Website, Business automation',
          timeline: 'ASAP',
          fileUrl: FILE_URL,
        },
        { includeBusinessNumber: false },
      );
      expect(zohoService.createLead.mock.invocationCallOrder[0]).toBeLessThan(
        whatsapp.alertTeam.mock.invocationCallOrder[0],
      );
    });

    it('also alerts the main business number for phone-call briefs', async () => {
      await brief('phone').expect(200);
      expect(whatsapp.alertTeam).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'Phone call' }),
        { includeBusinessNumber: true },
      );
    });

    it("doesn't fail the brief when the alert fails or isn't set up", async () => {
      whatsapp.alertTeam.mockRejectedValue(new Error('WhatsApp API 401'));
      await brief('email').expect(200);

      whatsapp.enabled = false;
      whatsapp.alertTeam.mockClear();
      await brief('email').expect(200);
      expect(whatsapp.alertTeam).not.toHaveBeenCalled();
    });

    it('sends no alert when the lead could not be saved', async () => {
      zohoService.createLead.mockRejectedValue(new Error('Zoho down'));
      await brief('email').expect(500);
      expect(whatsapp.alertTeam).not.toHaveBeenCalled();
    });
  });

  describe('phone numbers', () => {
    it.each([
      ['0803 123 4567', '+2348031234567'],
      ['+234 803 123 4567', '+2348031234567'],
      ['(0803) 123-4567', '+2348031234567'],
      ['+44 7911 123456', '+447911123456'],
    ])('accepts %s as %s', async (typed, saved) => {
      await request(app.getHttpServer())
        .post('/brief')
        .field('services', 'website')
        .field('goal', 'A site')
        .field('timeline', 'asap')
        .field('name', 'Ada')
        .field('phone', typed)
        .field('channel', 'whatsapp')
        .field('captchaToken', 'token')
        .expect(200);
      expect(zohoService.createLead).toHaveBeenCalledWith(
        expect.objectContaining({ phone: saved }),
      );
    });

    it.each(['12345', '0803 123', '+234 000 000 0000', 'call me'])(
      'rejects %s',
      async (typed) => {
        const res = await request(app.getHttpServer())
          .post('/brief')
          .field('services', 'website')
          .field('goal', 'A site')
          .field('timeline', 'asap')
          .field('name', 'Ada')
          .field('phone', typed)
          .field('channel', 'whatsapp')
          .field('captchaToken', 'token')
          .expect(400);
        expect(res.body.message).toEqual([
          'Enter a valid WhatsApp number, e.g. 0803 123 4567 or +44 7911 123456',
        ]);
        expect(zohoService.createLead).not.toHaveBeenCalled();
      },
    );
  });

  it('sends no email itself (Zoho workflows do that)', async () => {
    await brief('email').expect(200);
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('still accepts the old HubSpot field from earlier website builds', async () => {
    await brief().field('hutk', 'abc123').expect(200);
  });

  it('asks the visitor to try again when Zoho fails', async () => {
    zohoService.createLead.mockRejectedValue(new Error('Zoho down'));
    const res = await brief().expect(500);
    expect(res.body.message).toEqual([
      "We couldn't send your brief just now. Please try again in a moment, or message us on WhatsApp.",
    ]);
  });

  it('refuses briefs when Zoho is not set up, rather than losing them', async () => {
    zohoService.enabled = false;
    await brief().expect(500);
    expect(zohoService.createLead).not.toHaveBeenCalled();
  });

  it('does not touch Zoho, Cloudinary or WhatsApp when the captcha fails', async () => {
    emailService.verifyCaptcha.mockRejectedValue(
      new BadRequestException([
        'Captcha verification failed, please try again',
      ]),
    );
    await brief('email')
      .attach('file', Buffer.from('%PDF-1.4 test'), pdf)
      .expect(400);
    expect(briefFiles.store).not.toHaveBeenCalled();
    expect(zohoService.createLead).not.toHaveBeenCalled();
    expect(whatsapp.alertTeam).not.toHaveBeenCalled();
  });

  it('rejects a brief with no services', async () => {
    const res = await request(app.getHttpServer())
      .post('/brief')
      .field('goal', 'Something')
      .field('timeline', 'asap')
      .field('name', 'Ada')
      .field('phone', '08031234567')
      .field('channel', 'whatsapp')
      .field('captchaToken', 'token')
      .expect(400);
    expect(res.body.message).toContain('Pick at least one service');
  });

  it('requires an email or phone number', async () => {
    const res = await request(app.getHttpServer())
      .post('/brief')
      .field('services', 'website')
      .field('goal', 'Something')
      .field('timeline', 'asap')
      .field('name', 'Ada')
      .field('channel', 'whatsapp')
      .field('captchaToken', 'token')
      .expect(400);
    expect(res.body.message).toEqual([
      'Add an email address or WhatsApp number so we can reply',
    ]);
  });

  it('rejects disallowed file types', async () => {
    const res = await brief()
      .attach('file', Buffer.from('MZ'), {
        filename: 'setup.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);
    expect(res.body.message).toEqual([
      'Attach a PDF, Word document or image (PNG or JPG)',
    ]);
    expect(briefFiles.store).not.toHaveBeenCalled();
  });

  it('rejects files over 4 MB', async () => {
    await brief()
      .attach('file', Buffer.alloc(4 * 1024 * 1024 + 1), pdf)
      .expect(413);
    expect(zohoService.createLead).not.toHaveBeenCalled();
  });
});
