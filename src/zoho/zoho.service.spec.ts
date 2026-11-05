import { BRIEF_FIELDS, ZohoService } from './zoho.service';

// Runs the service against a fake Zoho CRM API, checking what it sends.

type Call = { url: string; method: string; body?: unknown };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function fakeZoho(
  options: { existingFields?: boolean; leadSources?: string[] } = {},
) {
  const calls: Call[] = [];
  let fieldsCreated = options.existingFields ?? false;
  const customFields = () =>
    Object.values(BRIEF_FIELDS).map((field) => ({
      api_name: field.field_label.replace(/\W+/g, '_'),
      field_label: field.field_label,
    }));

  const fetchMock = jest.fn(
    async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      let body: unknown = init.body;
      if (typeof init.body === 'string' && init.body.startsWith('{'))
        body = JSON.parse(init.body);
      calls.push({ url, method, body });

      if (url.endsWith('/oauth/v2/token')) {
        return json({
          access_token: 'access-1',
          api_domain: 'https://www.zohoapis.com',
          expires_in: 3600,
        });
      }
      if (url.includes('/settings/fields') && method === 'GET') {
        return json({
          fields: [
            {
              api_name: 'Lead_Source',
              field_label: 'Lead Source',
              pick_list_values: (options.leadSources ?? []).map((value) => ({
                display_value: value,
                actual_value: value,
              })),
            },
            ...(fieldsCreated ? customFields() : []),
          ],
        });
      }
      if (url.includes('/settings/fields') && method === 'POST') {
        fieldsCreated = true;
        return json({ fields: [{ code: 'SUCCESS', details: { id: '1' } }] });
      }
      if (url.includes('/users')) {
        return json({
          users: [
            { id: 'owner-7', email: 'Michael.Ogbuma@sleekyprogrammers.com' },
          ],
        });
      }
      if (url.endsWith('/crm/v8/Leads') && method === 'POST') {
        return json(
          { data: [{ code: 'SUCCESS', details: { id: 'lead-42' } }] },
          201,
        );
      }
      if (url.includes('/Attachments') || url.includes('/Notes')) {
        return json({ data: [{ code: 'SUCCESS' }] });
      }
      return json({ message: 'unexpected' }, 404);
    },
  );
  return { calls, fetchMock };
}

const brief = {
  services: ['website', 'business-automation'],
  goal: 'We want customers to book online.',
  timeline: 'asap',
  name: 'Ada Okafor',
  company: 'Acme',
  email: 'ada@company.com',
  phone: '0801 234 5678',
  channel: 'whatsapp',
  pageUri: 'https://sleekyprogrammers.com/start-a-project',
};

describe('ZohoService', () => {
  const realFetch = global.fetch;
  let service: ZohoService;

  beforeEach(() => {
    process.env.ZOHO_CLIENT_ID = 'id';
    process.env.ZOHO_CLIENT_SECRET = 'secret';
    process.env.ZOHO_REFRESH_TOKEN = 'refresh';
    process.env.ZOHO_LEAD_OWNER_EMAIL = 'michael.ogbuma@sleekyprogrammers.com';
    service = new ZohoService();
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is only enabled with all three credentials', () => {
    expect(service.enabled).toBe(true);
    delete process.env.ZOHO_REFRESH_TOKEN;
    expect(new ZohoService().enabled).toBe(false);
  });

  it('creates the custom fields once, then the lead with workflows on', async () => {
    const zoho = fakeZoho({ leadSources: ['Advertisement', 'Website'] });
    global.fetch = zoho.fetchMock as unknown as typeof fetch;

    expect(await service.createLead(brief)).toBe('lead-42');

    const createdFields = zoho.calls.filter(
      (call) => call.url.includes('/settings/fields') && call.method === 'POST',
    );
    expect(createdFields).toHaveLength(Object.keys(BRIEF_FIELDS).length);
    expect(createdFields[0].body).toEqual({
      fields: [
        expect.objectContaining({
          field_label: 'Brief Services',
          data_type: 'multiselectpicklist',
        }),
      ],
    });

    const lead = zoho.calls.find((call) => call.url.endsWith('/crm/v8/Leads'))!;
    expect(lead.body).toEqual({
      trigger: ['workflow'],
      data: [
        expect.objectContaining({
          First_Name: 'Ada',
          Last_Name: 'Okafor',
          Company: 'Acme',
          Email: 'ada@company.com',
          Phone: '0801 234 5678',
          Lead_Source: 'Website',
          Owner: { id: 'owner-7' },
          Brief_Services: ['Website', 'Business automation'],
          Brief_Timeline: 'ASAP',
          Preferred_Channel: 'WhatsApp',
          Project_Goal: 'We want customers to book online.',
        }),
      ],
    });
    const note = zoho.calls.find((call) =>
      call.url.includes('/Leads/lead-42/Notes'),
    )!;
    expect(JSON.stringify(note.body)).toContain(
      'Sent from: https://sleekyprogrammers.com/start-a-project',
    );

    // Fields, owner and token are reused for the next brief.
    zoho.calls.length = 0;
    await service.createLead(brief);
    expect(
      zoho.calls.map((call) =>
        call.url.replace('https://www.zohoapis.com/crm/v8', ''),
      ),
    ).toEqual(['/Leads', '/Leads/lead-42/Notes']);
  });

  it('uses a single name as the last name and the person as the company', async () => {
    const zoho = fakeZoho({ existingFields: true });
    global.fetch = zoho.fetchMock as unknown as typeof fetch;

    await service.createLead({ ...brief, name: 'Ada', company: undefined });

    const lead = zoho.calls.find((call) => call.url.endsWith('/crm/v8/Leads'))!;
    const record = (lead.body as { data: Record<string, unknown>[] }).data[0];
    expect(record).toMatchObject({ Last_Name: 'Ada', Company: 'Ada' });
    expect(record.First_Name).toBeUndefined();
    // No "Website" lead source in this account, so none is set.
    expect(record.Lead_Source).toBeUndefined();
  });

  it('attaches the file to the lead', async () => {
    const zoho = fakeZoho({ existingFields: true });
    global.fetch = zoho.fetchMock as unknown as typeof fetch;

    await service.createLead({
      ...brief,
      file: {
        name: 'brief.pdf',
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
      },
    });

    const attachment = zoho.calls.find((call) =>
      call.url.includes('/Leads/lead-42/Attachments'),
    );
    expect(attachment?.method).toBe('POST');
    expect(attachment?.body).toBeInstanceOf(FormData);
  });

  it('fails when Zoho does not create the lead', async () => {
    const zoho = fakeZoho({ existingFields: true });
    const base = zoho.fetchMock.getMockImplementation()!;
    zoho.fetchMock.mockImplementation(async (input, init) =>
      String(input).endsWith('/crm/v8/Leads')
        ? json(
            {
              data: [
                {
                  code: 'MANDATORY_NOT_FOUND',
                  details: { api_name: 'Last_Name' },
                },
              ],
            },
            202,
          )
        : base(input, init),
    );
    global.fetch = zoho.fetchMock as unknown as typeof fetch;

    await expect(service.createLead(brief)).rejects.toThrow(
      /didn't create the lead.*MANDATORY_NOT_FOUND/,
    );
  });

  it('reports a failed sign-in', async () => {
    global.fetch = jest.fn(async () =>
      json({ error: 'invalid_code' }, 400),
    ) as unknown as typeof fetch;
    await expect(service.createLead(brief)).rejects.toThrow(
      'Zoho sign-in failed: invalid_code',
    );
  });
});
