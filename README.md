# Sleeky Programmers Email Messaging API

## Get Started

1. Clone the repository in your terminal
2. Change current directory to the project's directory
3. Run `npm install` to install all packages
4. Open it in your code editor:
   For VSCode - run `code .`
5. Run `npm run start:dev` to continue in development mode

## WhatsApp alerts for briefs (CallMeBot)

For email and phone-call briefs, the API sends a WhatsApp message with the brief to Sleeky's existing WhatsApp number (default `2349160952000`, or `WHATSAPP_ALERT_NUMBER`). WhatsApp briefs don't need it: the client sends their brief to that number themselves from the thank-you page.

It uses [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/), a free service for alerts to your own number (no Meta Business account). To activate it, on the phone that has the receiving WhatsApp number:

1. Add **+34 644 51 95 23** to your contacts (check the current number on CallMeBot's page).
2. Send it this WhatsApp message: `I allow callmebot to send me messages`
3. It replies with your API key. Put it in `CALLMEBOT_API_KEY` (in `.env` and on Vercel).

Alerts then arrive from CallMeBot's number. If the alert fails (or the key isn't set), the brief still goes through: the lead is in Zoho CRM and Zoho's emails still run.
