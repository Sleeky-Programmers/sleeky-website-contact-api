import {
  parseNumbers,
  templateText,
  WhatsAppService,
} from './whatsapp.service';

type Call = { url: string; method: string; body?: any; auth?: string };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function fakeMeta(senderNumber = '+234 815 000 1111') {
  const calls: Call[] = [];
  const fetchMock = jest.fn(
    async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        auth: (init.headers as Record<string, string>)?.Authorization,
      });
      if (url.includes('fields=display_phone_number'))
        return json({ display_phone_number: senderNumber });
      if (url.endsWith('/messages'))
        return json({ messages: [{ id: 'wamid.1' }] });
      return json({ error: { message: 'unexpected' } }, 404);
    },
  );
  return { calls, fetchMock };
}

const alert = {
  name: 'Ada Okafor (Acme)',
  channel: 'Email',
  contact: '+2348031234567 / ada@company.com',
  services: 'Website, Business automation',
  timeline: 'ASAP',
  fileUrl: 'https://api.cloudinary.com/v1_1/demo/image/download?signature=x',
};

describe('WhatsAppService', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1098765';
    process.env.WHATSAPP_ACCESS_TOKEN = 'token';
    process.env.WHATSAPP_TEAM_NUMBERS = '+234 803 123 4567, 08051234567';
    delete process.env.WHATSAPP_BUSINESS_NUMBER;
    delete process.env.WHATSAPP_TEMPLATE_NAME;
    delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is only enabled with a sender, a token and at least one team number', () => {
    expect(new WhatsAppService().enabled).toBe(true);
    process.env.WHATSAPP_TEAM_NUMBERS = 'not a number';
    expect(new WhatsAppService().enabled).toBe(false);
  });

  it('sends the template to each team number, from the separate sender', async () => {
    const meta = fakeMeta();
    global.fetch = meta.fetchMock as unknown as typeof fetch;

    expect(await new WhatsAppService().alertTeam(alert)).toBe(2);

    const messages = meta.calls.filter((call) =>
      call.url.endsWith('/messages'),
    );
    expect(messages.map((call) => call.body.to)).toEqual([
      '2348031234567',
      '2348051234567',
    ]);
    expect(messages[0].url).toBe(
      'https://graph.facebook.com/v21.0/1098765/messages',
    );
    expect(messages[0].auth).toBe('Bearer token');
    expect(messages[0].body).toEqual({
      messaging_product: 'whatsapp',
      to: '2348031234567',
      type: 'template',
      template: {
        name: 'new_website_brief',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              alert.name,
              alert.channel,
              alert.contact,
              alert.services,
              alert.timeline,
              alert.fileUrl,
            ].map((text) => ({ type: 'text', text })),
          },
        ],
      },
    });
  });

  it('adds the main business number only when asked (phone-call briefs)', async () => {
    const meta = fakeMeta();
    global.fetch = meta.fetchMock as unknown as typeof fetch;

    await new WhatsAppService().alertTeam(alert, {
      includeBusinessNumber: true,
    });
    const recipients = meta.calls
      .filter((call) => call.url.endsWith('/messages'))
      .map((call) => call.body.to);
    expect(recipients).toEqual([
      '2348031234567',
      '2348051234567',
      '2349160952000',
    ]);
  });

  it('refuses to send from the main business number', async () => {
    const meta = fakeMeta('+234 916 095 2000');
    global.fetch = meta.fetchMock as unknown as typeof fetch;

    await expect(new WhatsAppService().alertTeam(alert)).rejects.toThrow(
      /main WhatsApp Business number/,
    );
    expect(meta.calls.some((call) => call.url.endsWith('/messages'))).toBe(
      false,
    );
  });

  it('counts only the messages that went through', async () => {
    const meta = fakeMeta();
    const base = meta.fetchMock.getMockImplementation()!;
    meta.fetchMock.mockImplementation(async (input, init) => {
      if (
        String(input).endsWith('/messages') &&
        String(init?.body).includes('2348051234567')
      ) {
        return json({ error: { message: 'Recipient not on WhatsApp' } }, 400);
      }
      return base(input, init);
    });
    global.fetch = meta.fetchMock as unknown as typeof fetch;

    expect(await new WhatsAppService().alertTeam(alert)).toBe(1);
  });
});

describe('template helpers', () => {
  it('keeps template text on one line, as WhatsApp requires', () => {
    expect(templateText('Line one\nLine\ttwo     spaced')).toBe(
      'Line one Line two spaced',
    );
    expect(templateText('   ')).toBe('-');
    expect(templateText('x'.repeat(300), 200)).toHaveLength(200);
  });

  it('reads team numbers in any common format and drops invalid ones', () => {
    expect(
      parseNumbers('+234 803 123 4567, 2348051234567, 0803 123 4567, nope'),
    ).toEqual(['2348031234567', '2348051234567']);
    expect(parseNumbers(undefined)).toEqual([]);
  });
});
