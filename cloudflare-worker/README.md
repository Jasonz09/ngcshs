# NG CSHS Attendance AI Worker

This Cloudflare Worker keeps the Gemini API key private without requiring Firebase Blaze.

## Setup

1. Create a free Cloudflare account:
   https://dash.cloudflare.com/sign-up

2. Log in to Cloudflare from Terminal:

   ```bash
   cd "/Users/jasonzhao/Documents/NG CSHS/cloudflare-worker"
   npx wrangler login
   ```

3. Add the Gemini API key as a Worker secret:

   ```bash
   npx wrangler secret put GEMINI_API_KEY
   ```

   Paste the Gemini API key when prompted.

   Check that the secret was added with the exact name:

   ```bash
   npx wrangler secret list
   ```

   The list should include `GEMINI_API_KEY`.

4. Deploy the Worker:

   ```bash
   npx wrangler deploy
   ```

5. Copy the deployed Worker URL. It should look similar to:

   ```text
   https://ng-cshs-attendance-ai.YOUR_WORKERS_SUBDOMAIN.workers.dev
   ```

6. Put that URL into `/Users/jasonzhao/Documents/NG CSHS/attendance-config.js`.

7. Deploy the regular website to Firebase Hosting only:

   ```bash
   cd "/Users/jasonzhao/Documents/NG CSHS"
   firebase deploy --only hosting
   ```

Do not deploy Firebase Functions for this setup.
