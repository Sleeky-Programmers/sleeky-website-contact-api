import { alertMessage, WhatsAppService } from './whatsapp.service';

const alert = {
  name: 'Ada Okafor (Acme)',
  channel: 'Email',
  contact: '+2348031234567 / ada@company.com',
  services: 'Website, Business automation',
  timeline: 'ASAP',
  goal: 'We want customers to book and pay online.',
  fileUrl: 'https://api.cloudinary.com/v1_1/demo/raw/download?signature=x',
};

const respond = (body: string, status = 200) =>
  jest.fn(async () => new Response(body, { status })) as jest.Mock;

describe('WhatsAppService (CallMeBot)', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.CALLMEBOT_API_KEY = '123456';
    delete process.env.WHATSAPP_ALERT_NUMBER;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is only enabled with a CallMeBot API key', () => {
    expect(new WhatsAppService().enabled).toBe(true);
    delete process.env.CALLMEBOT_API_KEY;
    expect(new WhatsAppService().enabled).toBe(false);
  });

  it("sends the alert to Sleeky's WhatsApp number by default", async () => {
    const fetchMock = respond(
      '<p>Message queued. You will receive it in a few seconds.</p>',
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await new WhatsAppService().alert(alert);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(
      'https://api.callmebot.com/whatsapp.php',
    );
    expect(url.searchParams.get('phone')).toBe('+2349160952000');
    expect(url.searchParams.get('apikey')).toBe('123456');
    expect(url.searchParams.get('text')).toBe(alertMessage(alert));
  });

  it('uses WHATSAPP_ALERT_NUMBER when set, in any common format', async () => {
    process.env.WHATSAPP_ALERT_NUMBER = '0803 123 4567';
    const fetchMock = respond('Message queued');
    global.fetch = fetchMock as unknown as typeof fetch;

    await new WhatsAppService().alert(alert);
    expect(
      new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('phone'),
    ).toBe('+2348031234567');
  });

  it("reports CallMeBot's reason when it refuses", async () => {
    global.fetch = respond(
      '<p>APIKey is invalid. Activate the API again.</p>',
      203,
    ) as unknown as typeof fetch;
    await expect(new WhatsAppService().alert(alert)).rejects.toThrow(
      /APIKey is invalid/,
    );
  });
});

describe('alertMessage', () => {
  it('lists the brief details, the file link and where the full brief is', () => {
    expect(alertMessage(alert)).toBe(
      [
        '*New project brief from the website*',
        '',
        'Name: Ada Okafor (Acme)',
        'Reply by: Email',
        'Contact: +2348031234567 / ada@company.com',
        'Services: Website, Business automation',
        'Timeline: ASAP',
        `File: ${alert.fileUrl}`,
        '',
        'Goal: We want customers to book and pay online.',
        '',
        'The full brief is in Zoho CRM.',
      ].join('\n'),
    );
  });

  it('leaves out the file line without a file, and trims long goals', () => {
    const message = alertMessage({
      ...alert,
      fileUrl: undefined,
      goal: 'x'.repeat(1000),
    });
    expect(message).not.toContain('File:');
    expect(message).toContain(`Goal: ${'x'.repeat(400)}…`);
  });
});
