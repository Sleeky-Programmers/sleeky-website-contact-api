import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { BriefModule } from './../src/brief/brief.module';
import { EmailService } from './../src/email/email.service';
import { ZohoService } from './../src/zoho/zoho.service';

describe('BriefController (e2e)', () => {
  let app: INestApplication;
  const emailService = {
    verifyCaptcha: jest.fn(),
    send: jest.fn(),
  };
  const zohoService = {
    enabled: true,
    createLead: jest.fn(),
  };

  const validBrief = () =>
    request(app.getHttpServer())
      .post('/brief')
      .field('services', 'website')
      .field('services', 'business-automation')
      .field('goal', 'We want customers to book online.')
      .field('timeline', 'asap')
      .field('name', 'Ada Okafor')
      .field('email', 'ada@company.com')
      .field('phone', '0801 234 5678')
      .field('channel', 'whatsapp')
      .field('captchaToken', 'token');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [BriefModule],
    })
      .overrideProvider(EmailService)
      .useValue(emailService)
      .overrideProvider(ZohoService)
      .useValue(zohoService)
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
  });

  afterAll(() => app.close());

  it('records the brief as a Zoho CRM lead, with the attachment', async () => {
    await validBrief()
      .field('pageUri', 'https://sleekyprogrammers.com/start-a-project')
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'brief.pdf',
        contentType: 'application/pdf',
      })
      .expect(200, { message: 'Brief sent successfully' });

    expect(emailService.verifyCaptcha).toHaveBeenCalledWith(
      'token',
      expect.any(String),
    );
    expect(zohoService.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        services: ['website', 'business-automation'],
        name: 'Ada Okafor',
        email: 'ada@company.com',
        phone: '0801 234 5678',
        channel: 'whatsapp',
        pageUri: 'https://sleekyprogrammers.com/start-a-project',
        file: expect.objectContaining({
          name: 'brief.pdf',
          mimetype: 'application/pdf',
        }),
      }),
    );
  });

  it('sends no email itself (Zoho workflows do that)', async () => {
    await validBrief().expect(200);
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('still accepts the old HubSpot field from earlier website builds', async () => {
    await validBrief().field('hutk', 'abc123').expect(200);
  });

  it('asks the visitor to try again when Zoho fails, and logs the brief', async () => {
    zohoService.createLead.mockRejectedValue(new Error('Zoho down'));

    const res = await validBrief().expect(500);
    expect(res.body.message).toEqual([
      "We couldn't send your brief just now. Please try again in a moment, or message us on WhatsApp.",
    ]);
  });

  it('refuses briefs when Zoho is not set up, rather than losing them', async () => {
    zohoService.enabled = false;
    await validBrief().expect(500);
    expect(zohoService.createLead).not.toHaveBeenCalled();
  });

  it('does not touch Zoho when the captcha fails', async () => {
    emailService.verifyCaptcha.mockRejectedValue(
      new BadRequestException([
        'Captcha verification failed, please try again',
      ]),
    );
    await validBrief().expect(400);
    expect(zohoService.createLead).not.toHaveBeenCalled();
  });

  it('accepts a single service and no email', async () => {
    await request(app.getHttpServer())
      .post('/brief')
      .field('services', 'branding')
      .field('goal', 'A new logo')
      .field('timeline', 'flexible')
      .field('name', 'Ada')
      .field('phone', '+234 801 234 5678')
      .field('channel', 'phone')
      .field('captchaToken', 'token')
      .expect(200);

    expect(zohoService.createLead).toHaveBeenCalledWith(
      expect.objectContaining({ services: ['branding'], email: undefined }),
    );
  });

  it('rejects a brief with no services', async () => {
    const res = await request(app.getHttpServer())
      .post('/brief')
      .field('goal', 'Something')
      .field('timeline', 'asap')
      .field('name', 'Ada')
      .field('phone', '08012345678')
      .field('channel', 'whatsapp')
      .field('captchaToken', 'token')
      .expect(400);

    expect(res.body.message).toContain('Pick at least one service');
    expect(zohoService.createLead).not.toHaveBeenCalled();
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
    const res = await validBrief()
      .attach('file', Buffer.from('MZ'), {
        filename: 'setup.exe',
        contentType: 'application/x-msdownload',
      })
      .expect(400);

    expect(res.body.message).toEqual([
      'Attach a PDF, Word document or image (PNG or JPG)',
    ]);
    expect(zohoService.createLead).not.toHaveBeenCalled();
  });

  it('rejects files over 4 MB', async () => {
    await validBrief()
      .attach('file', Buffer.alloc(4 * 1024 * 1024 + 1), {
        filename: 'big.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);

    expect(zohoService.createLead).not.toHaveBeenCalled();
  });
});
