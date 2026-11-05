import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmailService } from './email.service';

describe('EmailService', () => {
  let service: EmailService;
  const env = { ...process.env };
  const fetchMock = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmailService],
    }).compile();

    service = module.get<EmailService>(EmailService);
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...env };
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('verifies the captcha with Google by default', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: false }) });

    await expect(service.verifyCaptcha('token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('skips verification when RECAPTCHA_DISABLED=true outside production', async () => {
    process.env.RECAPTCHA_DISABLED = 'true';
    process.env.VERCEL_ENV = 'preview';

    await expect(service.verifyCaptcha('anything')).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never skips verification on production deployments', async () => {
    process.env.RECAPTCHA_DISABLED = 'true';
    process.env.VERCEL_ENV = 'production';
    fetchMock.mockResolvedValue({ json: async () => ({ success: false }) });

    await expect(service.verifyCaptcha('anything')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).toHaveBeenCalled();
  });
});
