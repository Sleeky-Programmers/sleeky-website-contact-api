import { Injectable, Logger } from '@nestjs/common';
import {
  CHANNEL_LABELS,
  EXISTING_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
} from '../brief/brief.options';

const API = 'https://api.hubapi.com';
const FORMS_API = 'https://api.hsforms.com';

// HubSpot-defined association type ids
const DEAL_TO_CONTACT = 3;
const NOTE_TO_CONTACT = 202;
const NOTE_TO_DEAL = 214;

const PROPERTY_GROUP = 'sleeky_website_brief';

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label], displayOrder) => ({
    value,
    label,
    displayOrder,
  }));

// Custom contact properties for the brief (brief 4.2: services and timeline as custom properties).
// Created automatically the first time they are needed.
const BRIEF_PROPERTIES = [
  {
    name: 'sleeky_brief_services',
    label: 'Brief: services',
    type: 'enumeration',
    fieldType: 'checkbox',
    options: options(SERVICE_LABELS),
  },
  {
    name: 'sleeky_brief_timeline',
    label: 'Brief: timeline',
    type: 'enumeration',
    fieldType: 'select',
    options: options(TIMELINE_LABELS),
  },
  {
    name: 'sleeky_brief_existing',
    label: 'Brief: existing website or app',
    type: 'enumeration',
    fieldType: 'select',
    options: options(EXISTING_LABELS),
  },
  {
    name: 'sleeky_brief_channel',
    label: 'Brief: preferred channel',
    type: 'enumeration',
    fieldType: 'select',
    options: options(CHANNEL_LABELS),
  },
  {
    name: 'sleeky_brief_goal',
    label: 'Brief: project goal',
    type: 'string',
    fieldType: 'textarea',
  },
];

export type BriefForHubspot = {
  services: string[];
  goal: string;
  existing?: string;
  timeline: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  channel: string;
  hutk?: string;
  pageUri?: string;
  ip?: string;
  file?: { name: string; buffer: Buffer; mimetype: string };
};

export type HubspotSyncResult = {
  contactId: string;
  dealId: string;
  dealUrl?: string;
};

class HubspotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Records each project brief in HubSpot: form submission (for source tracking),
 * contact with brief properties, a deal in the website leads pipeline, and a
 * note carrying any attachment.
 */
@Injectable()
export class HubspotService {
  private readonly logger = new Logger(HubspotService.name);
  private propertiesReady?: Promise<void>;
  private ownerId?: Promise<string | undefined>;
  private uiDomain?: Promise<string | undefined>;

  get enabled() {
    return !!process.env.HUBSPOT_ACCESS_TOKEN;
  }

  async syncBrief(brief: BriefForHubspot): Promise<HubspotSyncResult> {
    await this.ensureProperties();
    await this.submitForm(brief);

    const ownerId = await this.getOwnerId();
    const contactId = await this.upsertContact(brief, ownerId);
    const dealId = await this.createDeal(brief, contactId, ownerId);

    const fileId = brief.file ? await this.uploadFile(brief) : undefined;
    await this.createNote(brief, contactId, dealId, fileId);

    return { contactId, dealId, dealUrl: await this.dealUrl(dealId) };
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    base = API,
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        ...(init.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HubspotError(
        `HubSpot ${init.method ?? 'GET'} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
        response.status,
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private ensureProperties() {
    if (!this.propertiesReady) {
      this.propertiesReady = this.createMissingProperties().catch((error) => {
        this.propertiesReady = undefined;
        throw error;
      });
    }
    return this.propertiesReady;
  }

  private async createMissingProperties() {
    const groups = await this.request<{ results: { name: string }[] }>(
      '/crm/v3/properties/contacts/groups',
    );
    if (!groups.results.some((group) => group.name === PROPERTY_GROUP)) {
      await this.request('/crm/v3/properties/contacts/groups', {
        method: 'POST',
        body: JSON.stringify({ name: PROPERTY_GROUP, label: 'Website brief' }),
      });
    }

    const existing = await this.request<{ results: { name: string }[] }>(
      '/crm/v3/properties/contacts',
    );
    const names = new Set(existing.results.map((property) => property.name));
    for (const property of BRIEF_PROPERTIES) {
      if (names.has(property.name)) continue;
      await this.request('/crm/v3/properties/contacts', {
        method: 'POST',
        body: JSON.stringify({
          ...property,
          groupName: PROPERTY_GROUP,
          formField: false,
        }),
      });
      this.logger.log(`Created HubSpot contact property ${property.name}`);
    }
  }

  /** Submits the HubSpot form so the contact is linked to the visitor's tracked page views and source. */
  private async submitForm(brief: BriefForHubspot) {
    const portalId = process.env.HUBSPOT_PORTAL_ID;
    const formId = process.env.HUBSPOT_FORM_ID;
    if (!portalId || !formId) return;

    const [firstname, lastname] = this.splitName(brief.name);
    const fields = [
      { name: 'firstname', value: firstname },
      { name: 'lastname', value: lastname },
      { name: 'email', value: brief.email },
      { name: 'phone', value: brief.phone },
    ]
      .filter((field) => field.value)
      .map((field) => ({ objectTypeId: '0-1', ...field }));

    const context: Record<string, string> = { pageName: 'Start a project' };
    if (brief.hutk) context.hutk = brief.hutk;
    if (brief.pageUri) context.pageUri = brief.pageUri;
    if (brief.ip) context.ipAddress = brief.ip;

    await this.request(
      `/submissions/v3/integration/secure/submit/${portalId}/${formId}`,
      { method: 'POST', body: JSON.stringify({ fields, context }) },
      FORMS_API,
    );
  }

  private getOwnerId() {
    const email = process.env.HUBSPOT_DEAL_OWNER_EMAIL;
    if (!email) return Promise.resolve(undefined);
    if (!this.ownerId) {
      this.ownerId = this.request<{ results: { id: string }[] }>(
        `/crm/v3/owners?email=${encodeURIComponent(email)}`,
      )
        .then((owners) => {
          if (!owners.results.length)
            this.logger.warn(`No HubSpot owner found for ${email}`);
          return owners.results[0]?.id;
        })
        .catch((error) => {
          this.ownerId = undefined;
          throw error;
        });
    }
    return this.ownerId;
  }

  private async upsertContact(brief: BriefForHubspot, ownerId?: string) {
    const [firstname, lastname] = this.splitName(brief.name);
    const properties: Record<string, string> = {
      firstname,
      lastname,
      sleeky_brief_services: brief.services.join(';'),
      sleeky_brief_timeline: brief.timeline,
      sleeky_brief_channel: brief.channel,
      sleeky_brief_goal: brief.goal,
    };
    if (brief.email) properties.email = brief.email;
    if (brief.phone) properties.phone = brief.phone;
    if (brief.company) properties.company = brief.company;
    if (brief.existing) properties.sleeky_brief_existing = brief.existing;

    const match = brief.email
      ? { propertyName: 'email', operator: 'EQ', value: brief.email }
      : { propertyName: 'phone', operator: 'EQ', value: brief.phone };

    const found = await this.request<{
      results: { id: string; properties: Record<string, string | null> }[];
    }>('/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [match] }],
        properties: ['hubspot_owner_id'],
        limit: 1,
      }),
    });
    const existing = found.results[0];

    if (existing) {
      // Keep any owner already assigned to a returning contact.
      if (ownerId && !existing.properties.hubspot_owner_id)
        properties.hubspot_owner_id = ownerId;
      await this.request(`/crm/v3/objects/contacts/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      return existing.id;
    }

    if (ownerId) properties.hubspot_owner_id = ownerId;
    try {
      const created = await this.request<{ id: string }>(
        '/crm/v3/objects/contacts',
        {
          method: 'POST',
          body: JSON.stringify({
            properties: { ...properties, lifecyclestage: 'lead' },
          }),
        },
      );
      return created.id;
    } catch (error) {
      // The form submission can create the contact a moment before search
      // indexes it; HubSpot then reports the existing id, so update that one.
      const existingId =
        error instanceof HubspotError && error.status === 409
          ? /Existing ID: (\d+)/.exec(error.message)?.[1]
          : undefined;
      if (!existingId) throw error;
      await this.request(`/crm/v3/objects/contacts/${existingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ properties }),
      });
      return existingId;
    }
  }

  private async createDeal(
    brief: BriefForHubspot,
    contactId: string,
    ownerId?: string,
  ) {
    const services = brief.services.map((id) => SERVICE_LABELS[id]).join(', ');
    const who = brief.company ? `${brief.name} (${brief.company})` : brief.name;
    const properties: Record<string, string> = {
      dealname: `${who} — ${services}`.slice(0, 250),
      pipeline: process.env.HUBSPOT_PIPELINE_ID || 'default',
      dealstage: process.env.HUBSPOT_DEAL_STAGE_ID || 'appointmentscheduled',
      description: brief.goal.slice(0, 65000),
    };
    if (ownerId) properties.hubspot_owner_id = ownerId;

    const deal = await this.request<{ id: string }>('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties,
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: DEAL_TO_CONTACT,
              },
            ],
          },
        ],
      }),
    });
    return deal.id;
  }

  private async uploadFile(brief: BriefForHubspot) {
    const file = brief.file!;
    const body = new FormData();
    body.append(
      'file',
      new Blob([file.buffer], { type: file.mimetype }),
      file.name,
    );
    body.append('folderPath', '/Website briefs');
    body.append(
      'options',
      JSON.stringify({
        access: 'PRIVATE',
        overwrite: false,
        duplicateValidationStrategy: 'NONE',
      }),
    );

    const uploaded = await this.request<{ id: string }>('/files/v3/files', {
      method: 'POST',
      body,
    });
    return uploaded.id;
  }

  private async createNote(
    brief: BriefForHubspot,
    contactId: string,
    dealId: string,
    fileId?: string,
  ) {
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rows: [string, string][] = [
      ['Services', brief.services.map((id) => SERVICE_LABELS[id]).join(', ')],
      ['Timeline', TIMELINE_LABELS[brief.timeline]],
      [
        'Existing site or app',
        brief.existing ? EXISTING_LABELS[brief.existing] : 'Not answered',
      ],
      ['Preferred channel', CHANNEL_LABELS[brief.channel]],
    ];
    const body =
      `<p><strong>Project brief from the website</strong></p>` +
      rows
        .map(
          ([label, value]) =>
            `<p><strong>${label}:</strong> ${escape(value)}</p>`,
        )
        .join('') +
      `<p><strong>Goal:</strong><br>${escape(brief.goal).replace(/\r?\n/g, '<br>')}</p>`;

    const properties: Record<string, string> = {
      hs_timestamp: new Date().toISOString(),
      hs_note_body: body,
    };
    if (fileId) properties.hs_attachment_ids = fileId;

    await this.request('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties,
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: NOTE_TO_CONTACT,
              },
            ],
          },
          {
            to: { id: dealId },
            types: [
              {
                associationCategory: 'HUBSPOT_DEFINED',
                associationTypeId: NOTE_TO_DEAL,
              },
            ],
          },
        ],
      }),
    });
  }

  private async dealUrl(dealId: string) {
    const portalId = process.env.HUBSPOT_PORTAL_ID;
    if (!portalId) return undefined;
    if (!this.uiDomain) {
      this.uiDomain = this.request<{ uiDomain?: string }>(
        '/account-info/v3/details',
      )
        .then((account) => account.uiDomain)
        .catch(() => undefined);
    }
    const domain = (await this.uiDomain) || 'app.hubspot.com';
    return `https://${domain}/contacts/${portalId}/record/0-3/${dealId}`;
  }

  private splitName(name: string): [string, string] {
    const parts = name.trim().split(/\s+/);
    return [parts[0] ?? '', parts.slice(1).join(' ')];
  }
}
