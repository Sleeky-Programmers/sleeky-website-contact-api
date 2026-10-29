import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { BriefModule } from './../src/brief/brief.module';
import { EmailService } from './../src/email/email.service';
import { HubspotService } from './../src/hubspot/hubspot.service';

describe('BriefController (e2e)', () => {
  let app: INestApplication;
  const emailService = {
    verifyCaptcha: jest.fn(),
    send: jest.fn(),
  };
  const hubspotService = {
    enabled: true,
    syncBrief: jest.fn(),
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
    process.env.EMAIL_ADDRESS = 'team@example.com';
    process.env.EMAIL_USERNAME = 'website@example.com';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [BriefModule],
    })
      .overrideProvider(EmailService)
      .useValue(emailService)
      .overrideProvider(HubspotService)
      .useValue(hubspotService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  beforeEach(() => {
    emailService.verifyCaptcha.mockReset().mockResolvedValue(undefined);
    emailService.send.mockReset().mockResolvedValue({});
    hubspotService.enabled = true;
    hubspotService.syncBrief.mockReset().mockResolvedValue({
      contactId: '1',
      dealId: '2',
      dealUrl: 'https://app-eu1.hubspot.com/contacts/123/record/0-3/2',
    });
  });

  it('records the brief in HubSpot and links the deal in the team email', async () => {
    await validBrief()
      .field('hutk', 'abc123')
      .field('pageUri', 'https://sleekyprogrammers.com/start-a-project')
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'brief.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);

    expect(hubspotService.syncBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        services: ['website', 'business-automation'],
        name: 'Ada Okafor',
        email: 'ada@company.com',
        hutk: 'abc123',
        pageUri: 'https://sleekyprogrammers.com/start-a-project',
        file: expect.objectContaining({
          name: 'brief.pdf',
          mimetype: 'application/pdf',
        }),
      }),
    );
    const [teamEmail] = emailService.send.mock.calls[0];
    expect(teamEmail.html).toContain(
      'https://app-eu1.hubspot.com/contacts/123/record/0-3/2',
    );
  });

  it('still emails the brief when HubSpot fails, and flags it', async () => {
    hubspotService.syncBrief.mockRejectedValue(new Error('HubSpot down'));

    await validBrief().expect(200);

    const [teamEmail] = emailService.send.mock.calls[0];
    expect(teamEmail.html).toContain('could not be added to HubSpot');
    expect(emailService.send).toHaveBeenCalledTimes(2);
  });

  it('skips HubSpot when it is not configured', async () => {
    hubspotService.enabled = false;

    await validBrief().expect(200);

    expect(hubspotService.syncBrief).not.toHaveBeenCalled();
  });

  it('does not touch HubSpot when the captcha fails', async () => {
    emailService.verifyCaptcha.mockRejectedValue(
      new BadRequestException([
        'Captcha verification failed, please try again',
      ]),
    );

    await validBrief().expect(400);
    expect(hubspotService.syncBrief).not.toHaveBeenCalled();
  });

  afterAll(() => app.close());

  it('sends the team email with the attachment and a confirmation', async () => {
    await validBrief()
      .attach('file', Buffer.from('%PDF-1.4 test'), {
        filename: 'brief.pdf',
        contentType: 'application/pdf',
      })
      .expect(200, { message: 'Brief sent successfully' });

    expect(emailService.verifyCaptcha).toHaveBeenCalledWith(
      'token',
      expect.any(String),
    );
    expect(emailService.send).toHaveBeenCalledTimes(2);

    const [teamEmail] = emailService.send.mock.calls[0];
    expect(teamEmail.to).toBe('team@example.com');
    expect(teamEmail.replyTo).toBe('ada@company.com');
    expect(teamEmail.subject).toContain('Website, Business automation');
    expect(teamEmail.attachments[0].filename).toBe('brief.pdf');

    const [confirmation] = emailService.send.mock.calls[1];
    expect(confirmation.to).toBe('ada@company.com');
  });

  it('accepts a single service and no email, skipping the confirmation', async () => {
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

    expect(emailService.send).toHaveBeenCalledTimes(1);
  });

  it('escapes HTML in submitted fields', async () => {
    await request(app.getHttpServer())
      .post('/brief')
      .field('services', 'website')
      .field('goal', '<script>alert(1)</script>')
      .field('timeline', 'asap')
      .field('name', 'Ada')
      .field('phone', '08012345678')
      .field('channel', 'whatsapp')
      .field('captchaToken', 'token')
      .expect(200);

    const [teamEmail] = emailService.send.mock.calls[0];
    expect(teamEmail.html).not.toContain('<script>');
    expect(teamEmail.html).toContain('&lt;script&gt;');
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
    expect(emailService.send).not.toHaveBeenCalled();
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
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('rejects files over 4 MB', async () => {
    await validBrief()
      .attach('file', Buffer.alloc(4 * 1024 * 1024 + 1), {
        filename: 'big.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);

    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('does not send anything when the captcha fails', async () => {
    emailService.verifyCaptcha.mockRejectedValue(
      new BadRequestException([
        'Captcha verification failed, please try again',
      ]),
    );

    await validBrief().expect(400);
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('still succeeds if only the confirmation email fails', async () => {
    emailService.send
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('SMTP down'));

    await validBrief().expect(200);
  });
});
