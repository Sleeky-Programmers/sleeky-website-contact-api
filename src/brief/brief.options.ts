// Option ids must match the website's Start a project form
// (sleeky-website/src/components/forms/briefOptions.ts).

export const SERVICE_LABELS: Record<string, string> = {
  'business-automation': 'Business automation',
  website: 'Website',
  'web-app': 'Web app',
  'mobile-app': 'Mobile app',
  'api-integration': 'API integration',
  branding: 'Branding',
};

export const EXISTING_LABELS: Record<string, string> = {
  none: 'No, starting fresh',
  rebuild: 'Yes — needs a rebuild',
  improve: 'Yes — needs improving',
};

export const TIMELINE_LABELS: Record<string, string> = {
  flexible: 'Flexible',
  '1-3-months': '1–3 months',
  asap: 'ASAP',
};

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  phone: 'Phone call',
};

// Vercel serverless functions reject request bodies over 4.5 MB.
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const ALLOWED_FILE_TYPES: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'docx',
  ],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
};
