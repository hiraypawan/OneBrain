# Google-only sign-up and sign-in

Updated 2026-09-11. This is the implemented authentication setup, not a production-readiness claim for the whole product.

**Do not send client secrets in chat, screenshots, pull requests, or committed files.** Google gives you an OAuth **client ID and client secret**, not an API key. Enter the secret directly in an ignored local environment file or your deployment's secret manager. Tell the agent only when configuration is complete; a callback URL and client ID are not secrets, but there is no need to share the secret itself.

## 1. Create the Google OAuth application

1. Open <https://console.cloud.google.com/> and select/create the project you control.
2. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen** in the older navigation).
3. Configure **Branding**: app name OneBrain, support email and developer contact. For a production app, supply your real homepage/privacy URLs and domains you control.
4. Under **Audience**, use External if personal Google accounts must sign in. While the app is in Testing, add your Google email and your testers under **Test users**. Internal only works for the applicable Google Workspace organization.
5. Under **Clients**, create an OAuth client of type **Web application**.
6. Add exact **Authorized redirect URIs** from the table below. Spelling, scheme, host, port and path must match—no wildcard, fragment, or extra trailing slash.
7. Save the client ID and client secret in the secure locations below. If a secret has already been exposed, rotate it in Google Cloud and replace the stored value.

This sign-in flow requests only `openid email profile`. Calendar, Gmail and Sheets authorization is a separate opt-in connection workflow; basic sign-in does not authorize those actions. No Google API key, service-account key, host AI key or paid AI activation is required for sign-in.

## 2. Choose the exact callback URL

| Environment | Authorized redirect URI / `GOOGLE_LOGIN_REDIRECT` |
| --- | --- |
| Running on your own computer, browsing localhost | `http://localhost:3000/api/auth/google/callback` |
| Running on your own computer, browsing 127.0.0.1 | `http://127.0.0.1:3000/api/auth/google/callback` |
| Arena preview | Copy the **OneBrain port-3000 HTTPS preview origin** and append `/api/auth/google/callback` |
| Production/staging | `https://YOUR-APP-DOMAIN/api/auth/google/callback` |

Open OneBrain using the **same origin** as the configured callback. Do not open 127.0.0.1 while configuring localhost, or vice versa: the browser-binding cookie belongs to one host. For Arena, open the preview in a **separate browser tab** before signing in. Google disallows embedded sign-in, and third-party-cookie restrictions can prevent authentication inside an iframe. Temporary preview URLs may change; update both Google Console and the Worker setting. If Google rejects a shared preview domain, use your own stable HTTPS development domain or run locally on your computer.

This is a server authorization-code flow; a browser JavaScript-origin registration is not used by this implementation. Do not confuse the **Authorized JavaScript origins** field with **Authorized redirect URIs**.

## 3. Configure local development securely

From the repository root:

```sh
npm --prefix frontend ci
npm --prefix workers/api ci
node scripts/setup-platform.mjs
npm --prefix workers/api run migrate:local
```

Edit **`workers/api/.dev.vars` privately**. Add these fields with your real values; the values below are placeholders, not working credentials:

```dotenv
GOOGLE_CLIENT_ID=YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_PRIVATE_CLIENT_SECRET
GOOGLE_LOGIN_REDIRECT=http://localhost:3000/api/auth/google/callback
```

Use the preview HTTPS callback instead of localhost when running inside Arena. Keep the generated `TOKEN_ENCRYPTION_KEY` unchanged: it encrypts PKCE/nonce state and connector credentials. The setup script preserves existing keys. The private `.dev.vars` file is ignored by Git. The committed `.dev.vars.example` must contain placeholders only.

`frontend/.env.local` contains the server-only proxy URL:

```dotenv
PLATFORM_API_URL=http://127.0.0.1:8787
```

Do not add a Google client secret to frontend code, `NEXT_PUBLIC_*`, `.env.production`, or GitHub PR text.

Restart the local API after changing its environment:

```sh
npm --prefix workers/api run dev
# Another terminal:
npm --prefix frontend run build
npm --prefix frontend run start -- --hostname 0.0.0.0
# Optional third terminal:
node scripts/local-scheduler.mjs
```

Refresh `/auth/login` or `/operations`. **Continue with Google** stays disabled until the server reports the required configuration. Missing configuration never enables password login or a fake success path.

## 4. Staging/production secrets (operator action, not run by this PR)

In Cloudflare Dashboard → Workers & Pages → **the API Worker** → Settings → Variables and Secrets, add the client ID, client secret, exact login redirect and independent encryption key. Store `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` as secrets. Alternatively, from `workers/api`, an authorized operator can use interactive `npx wrangler secret put GOOGLE_CLIENT_SECRET` and equivalent commands. Never pass a real secret as a shell command-line argument.

The frontend runtime needs its **server-only** `PLATFORM_API_URL` pointing at the deployed API HTTPS origin. The client secret lives on the API Worker, not the browser. Google login requires a server-capable frontend (Next server/OpenNext); the historical static Pages export cannot serve the callback/proxy.

**No remote migration, Worker deployment or Google authorization has been performed by this change.** Review backups, migrations, permissions and release gates before any production operation. The old automatic push-to-main deployment has been replaced by a manual artifact-only check.

`GOOGLE_CONNECT_REDIRECT` is separate. Only configure it when enabling Calendar/Sheets/Gmail connections; its callback is `/api/platform/oauth/google/callback`, not the sign-in callback above.

## 5. Verify the real flow after configuration

- Sign in with a test Google account. Consent should request identity only.
- Confirm you return to `/operations`, create a workspace, and reload successfully.
- Sign out; `/api/platform/me` must return 401. Sign in again and confirm the same account/workspace returns.
- Cancel consent and test an expired/replayed callback: no session should be created.
- Test with another Google account; it must not see the first account's workspaces without an invitation.
- Check browser cookies: the app session is HttpOnly, scoped to `/api/platform`, and Secure on HTTPS. No app session token belongs in localStorage or a URL.

Automated tests use signed test keys and mocked Google transport, plus direct local-D1 fixtures for unrelated browser workflows. There is **no test-login HTTP endpoint or production bypass flag**. Those tests do not certify live Google consent, delivery, availability or project configuration.

## Existing accounts and migration

Migration `0005_google_identity.sql` preserves user/record data but revokes existing platform sessions and reset tokens. Password signup/login/reset and legacy stateless-JWT OAuth are retired. Cached local identity does not prove server authentication; legacy automatic cloud backup is disabled to prevent unreviewed uploads on Google sign-in.

Accounts are keyed by Google's verified **subject (`sub`)**, not email alone. A new Google identity whose email already belongs to an unlinked legacy account is deliberately blocked. **Do not attach it automatically just because the email matches.** An operator must establish the correct stable Google subject and ownership of the legacy data in a reviewed migration. That reconciliation is a release gate for existing deployments; no remote identities were migrated here. Local data remains on the device and is not implicitly uploaded or merged.

The encrypted vault master password is separate from account authentication. Google cannot recover it, and it is not a second account login method.

Official references: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [OpenID Connect](https://developers.google.com/identity/openid-connect), [production OAuth policies](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
