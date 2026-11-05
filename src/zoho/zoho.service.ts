import { Injectable, Logger } from '@nestjs/common';
import {
  CHANNEL_LABELS,
  EXISTING_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
} from '../brief/brief.options';

// Zoho CRM REST API (v8). Authentication is OAuth with a long-lived refresh
// token from a Self Client (api-console.zoho.com); access tokens last an hour
// and are refreshed here as needed.

const API_VERSION = 'v8';
const MODULE = 'Leads';

/** Custom Lead fields for the brief, created automatically the first time they're needed. */
export const BRIEF_FIELDS = {
  services: {
    field_label: 'Brief Services',
    data_type: 'multiselectpicklist',
    values: Object.values(SERVICE_LABELS),
  },
  timeline: {
    field_label: 'Brief Timeline',
    data_type: 'picklist',
    values: Object.values(TIMELINE_LABELS),
  },
  existing: {
    field_label: 'Existing Website or App',
    data_type: 'picklist',
    values: Object.values(EXISTING_LABELS),
  },
  channel: {
    field_label: 'Preferred Channel',
    data_type: 'picklist',
    values: Object.values(CHANNEL_LABELS),
  },
  goal: { field_label: 'Project Goal', data_type: 'textarea' },
} as const;

type BriefFieldKey = keyof typeof BRIEF_FIELDS;

export type BriefForZoho = {
  services: string[];
  goal: string;
  existing?: string;
  timeline: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  channel: string;
  pageUri?: string;
  file?: { name: string; buffer: Buffer; mimetype: string };
};

type ZohoField = {
  api_name: string;
  field_label: string;
  pick_list_values?: { display_value: string; actual_value: string }[];
};

export class ZohoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Records each project brief as a Lead in Zoho CRM, with the attachment and a note. */
@Injectable()
export class ZohoService {
  private readonly logger = new Logger(ZohoService.name);
  private token?: { value: string; apiDomain: string; expiresAt: number };
  private fields?: Promise<{
    apiNames: Record<BriefFieldKey, string>;
    leadSource?: string;
  }>;
  private ownerId?: Promise<string | undefined>;

  get enabled() {
    return Boolean(
      process.env.ZOHO_CLIENT_ID &&
        process.env.ZOHO_CLIENT_SECRET &&
        process.env.ZOHO_REFRESH_TOKEN,
    );
  }

  private get accountsUrl() {
    return (
      process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com'
    ).replace(/\/$/, '');
  }

  /** Creates the Lead, then attaches the file and adds the full brief as a note. Returns the Lead id. */
  async createLead(brief: BriefForZoho): Promise<string> {
    const [{ apiNames, leadSource }, ownerId] = await Promise.all([
      this.ensureFields(),
      this.getOwnerId(),
    ]);

    const [firstName, lastName] = this.splitName(brief.name);
    const record: Record<string, unknown> = {
      First_Name: firstName || undefined,
      Last_Name: lastName,
      Company: brief.company || brief.name,
      Email: brief.email,
      Phone: brief.phone,
      Description: brief.goal,
      [apiNames.services]: brief.services.map((id) => SERVICE_LABELS[id]),
      [apiNames.timeline]: TIMELINE_LABELS[brief.timeline],
      [apiNames.existing]: brief.existing
        ? EXISTING_LABELS[brief.existing]
        : undefined,
      [apiNames.channel]: CHANNEL_LABELS[brief.channel],
      [apiNames.goal]: brief.goal,
    };
    if (leadSource) record.Lead_Source = leadSource;
    if (ownerId) record.Owner = { id: ownerId };

    // A new Lead for every brief (not an update), so "on create" workflow rules
    // (the team alert and the client's confirmation email) always run.
    const created = await this.request<{
      data: { code: string; details: { id: string }; message?: string }[];
    }>(`/${MODULE}`, {
      method: 'POST',
      body: JSON.stringify({ data: [record], trigger: ['workflow'] }),
    });
    const result = created.data?.[0];
    if (result?.code !== 'SUCCESS') {
      throw new ZohoError(
        `Zoho CRM didn't create the lead: ${JSON.stringify(result).slice(0, 500)}`,
        400,
      );
    }
    const leadId = result.details.id;

    // The lead exists now; a failed attachment or note is logged, not fatal.
    await Promise.all([
      brief.file
        ? this.attachFile(leadId, brief.file).catch((error) =>
            this.logger.error(
              `Couldn't attach ${brief.file!.name} to lead ${leadId}`,
              error,
            ),
          )
        : undefined,
      this.addNote(leadId, brief).catch((error) =>
        this.logger.error(
          `Couldn't add the brief note to lead ${leadId}`,
          error,
        ),
      ),
    ]);
    return leadId;
  }

  // ---------- Authentication ----------

  private async accessToken() {
    if (this.token && Date.now() < this.token.expiresAt) return this.token;
    const params = new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN ?? '',
      client_id: process.env.ZOHO_CLIENT_ID ?? '',
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    });
    const response = await fetch(`${this.accountsUrl}/oauth/v2/token`, {
      method: 'POST',
      body: params,
    });
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      api_domain?: string;
      expires_in?: number;
      error?: string;
    };
    if (!response.ok || !data.access_token) {
      throw new ZohoError(
        `Zoho sign-in failed: ${data.error ?? response.status}`,
        response.status || 401,
      );
    }
    this.token = {
      value: data.access_token,
      apiDomain: data.api_domain || 'https://www.zohoapis.com',
      // Refresh a minute early.
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return this.token;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(
      `${token.apiDomain}/crm/${API_VERSION}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Zoho-oauthtoken ${token.value}`,
          ...(init.body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
      },
    );
    // An access token can be revoked early; get a new one once.
    if (response.status === 401 && !retried) {
      this.token = undefined;
      return this.request<T>(path, init, true);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new ZohoError(
        `Zoho ${init.method ?? 'GET'} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
        response.status,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ---------- Setup (cached per server instance) ----------

  private ensureFields() {
    if (!this.fields) {
      this.fields = this.prepareFields().catch((error) => {
        this.fields = undefined;
        throw error;
      });
    }
    return this.fields;
  }

  private async listFields() {
    const result = await this.request<{ fields: ZohoField[] }>(
      `/settings/fields?module=${MODULE}`,
    );
    return result.fields ?? [];
  }

  private async prepareFields() {
    let fields = await this.listFields();
    const byLabel = (label: string) =>
      fields.find((field) => field.field_label === label);

    const missing = (Object.keys(BRIEF_FIELDS) as BriefFieldKey[]).filter(
      (key) => !byLabel(BRIEF_FIELDS[key].field_label),
    );
    for (const key of missing) {
      const field = BRIEF_FIELDS[key];
      const definition: Record<string, unknown> = {
        field_label: field.field_label,
        data_type: field.data_type,
      };
      if ('values' in field) {
        definition.pick_list_values = (field.values as readonly string[]).map(
          (value) => ({ display_value: value }),
        );
      }
      const { data_type } = field;
      if (data_type === 'textarea') definition.textarea = { type: 'large' };
      await this.request(`/settings/fields?module=${MODULE}`, {
        method: 'POST',
        body: JSON.stringify({ fields: [definition] }),
      });
      this.logger.log(`Created the Zoho CRM lead field "${field.field_label}"`);
    }
    if (missing.length) fields = await this.listFields();

    const apiNames = {} as Record<BriefFieldKey, string>;
    for (const key of Object.keys(BRIEF_FIELDS) as BriefFieldKey[]) {
      const field = byLabel(BRIEF_FIELDS[key].field_label);
      if (!field)
        throw new ZohoError(
          `Zoho CRM lead field "${BRIEF_FIELDS[key].field_label}" is missing`,
          500,
        );
      apiNames[key] = field.api_name;
    }

    // "Website" as the lead source when the picklist has it (add it in Zoho to use it).
    const sources = byLabel('Lead Source')?.pick_list_values ?? [];
    const leadSource = sources.find(
      (value) => value.display_value.toLowerCase() === 'website',
    )?.actual_value;
    return { apiNames, leadSource };
  }

  private getOwnerId() {
    const email = process.env.ZOHO_LEAD_OWNER_EMAIL?.toLowerCase();
    if (!email) return Promise.resolve(undefined);
    if (!this.ownerId) {
      this.ownerId = this.request<{ users?: { id: string; email: string }[] }>(
        '/users?type=ActiveUsers&per_page=200',
      )
        .then((result) => {
          const owner = result.users?.find(
            (user) => user.email.toLowerCase() === email,
          );
          if (!owner)
            this.logger.warn(
              `No active Zoho CRM user with the email ${email}; leads get the default owner`,
            );
          return owner?.id;
        })
        .catch((error) => {
          this.ownerId = undefined;
          throw error;
        });
    }
    return this.ownerId;
  }

  // ---------- Extras on the lead ----------

  private async attachFile(
    leadId: string,
    file: NonNullable<BriefForZoho['file']>,
  ) {
    const body = new FormData();
    body.append(
      'file',
      new Blob([file.buffer], { type: file.mimetype }),
      file.name,
    );
    await this.request(`/${MODULE}/${leadId}/Attachments`, {
      method: 'POST',
      body,
    });
  }

  private async addNote(leadId: string, brief: BriefForZoho) {
    const lines = [
      `Services: ${brief.services.map((id) => SERVICE_LABELS[id]).join(', ')}`,
      `Timeline: ${TIMELINE_LABELS[brief.timeline]}`,
      `Existing site or app: ${brief.existing ? EXISTING_LABELS[brief.existing] : 'Not answered'}`,
      `Preferred channel: ${CHANNEL_LABELS[brief.channel]}`,
      `Attachment: ${brief.file ? brief.file.name : 'None'}`,
      ...(brief.pageUri ? [`Sent from: ${brief.pageUri}`] : []),
      '',
      'What they want to achieve:',
      brief.goal,
    ];
    await this.request(`/${MODULE}/${leadId}/Notes`, {
      method: 'POST',
      body: JSON.stringify({
        data: [
          {
            Note_Title: 'Project brief from the website',
            Note_Content: lines.join('\n'),
          },
        ],
      }),
    });
  }

  private splitName(name: string): [string, string] {
    const parts = name.trim().split(/\s+/);
    // Zoho requires a last name; a single name goes there.
    return parts.length > 1
      ? [parts[0], parts.slice(1).join(' ')]
      : ['', parts[0] ?? ''];
  }
}
