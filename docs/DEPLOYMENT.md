# Connect the services and publish RU Employed

The repository is prepared for a Node/Express deployment on Render with Supabase Auth/PostgreSQL and an independent Judge0 execution service. No domain has been purchased, hosting provisioned, or database migration applied by this implementation. Local demos work without these services. Accounts require Supabase; generated coding questions require OpenAI; running code requires Judge0; recorded answers and realistic voices require ElevenLabs.

## 1. Local setup

Install Node.js 22 LTS. In PowerShell, from the project folder:

```powershell
npm ci
# Only if .env does not already exist:
Copy-Item .env.example .env
npm start
```

Open http://localhost:3000. Keep existing keys in `.env`. Add the new configuration below without overwriting them. `npm test` uses mocked external services and makes no paid API calls.

## 2. Supabase accounts and storage

1. Create or choose a Supabase project. Obtain the project URL and **legacy anon JWT API key** in project API settings. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` server environment variables. Do not use the service-role key: requests use the signed-in user's JWT so database row-level security remains enforced.
2. Run [001_workspace.sql](../supabase/migrations/001_workspace.sql) once in the Supabase SQL editor. It creates profiles, reports, and active sessions, enables RLS on every table, and grants authenticated users access only to rows with their user ID. Session mutation RPCs acquire a 180-second lease to avoid simultaneous requests overwriting an interview. All stored timestamps are UTC.
3. Enable email/password authentication, email confirmation, and a minimum password length of 10. Password hashing and recovery tokens are managed by Supabase Auth; the application never stores passwords.
4. Set Auth **Site URL** and `PUBLIC_APP_URL` to the same origin, initially `http://localhost:3000` or the HTTPS Render address. Add the matching site and account callback paths to the allowed redirect list; update them again when the custom domain is connected.
5. Configure a production SMTP sender in Supabase. The built-in development sender has delivery/rate restrictions; verify actual delivery to your own address before launch. Enable appropriate Auth abuse protections in the provider dashboard.
6. Customize Auth email templates to use the server confirmation endpoint rather than an implicit client-side access-token link. In **Confirm signup**, use:

```html
<a
  href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup"
  >Confirm your RU Employed account</a
>
```

In **Reset password**, use:

```html
<a
  href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery"
  >Reset your password</a
>
```

In **Change email address**, use:

```html
<a
  href="{{ .SiteURL }}/api/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email_change"
  >Confirm your email change</a
>
```

These one-time token hashes are verified server-side. The callback writes HttpOnly cookies and redirects to account settings for a new password. Configure the templates before testing signup/recovery. Email scanners may consume one-time links; provider settings/templates can add an intermediate confirmation page if your email environment needs one.

7. Test signup, confirmation, login after reload, recovery email/new password, email changes, saved experience, and logout with two separate accounts. Confirm the second account cannot read or delete the first account's report or active session, including direct API requests. Mock integration tests check application ownership and provider requests; apply and verify the actual RLS policies in your project before public launch.

Cookies are HttpOnly, SameSite=Lax, and Secure in production. Access tokens are validated by Supabase on API requests and refreshed server-side. Cookies persist for up to 28 days, subject to provider revocation/expiry. Reports, transcripts, extracted resume/LinkedIn/portfolio text, scores and code are private user rows; original uploaded files and webcam video are not retained. Guests keep their last 12 reports on the current browser; sign in for cloud history. Signing in does not import guest history automatically. The dashboard currently loads the most recent 1,000 cloud reports.

Schedule daily cleanup of expired `interview_sessions` using Supabase Cron or another administrative scheduler:

```sql
delete from public.interview_sessions where expires_at < now();
```

Reports remain until deleted by their owner or by your retention policy. Enable database backups appropriate to your chosen Supabase plan. Review your provider usage and retention requirements before inviting users.

Sources: [Supabase Auth HTTP endpoints](https://supabase.github.io/auth/), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 3. Coding sandbox

Use a trusted hosted **Judge0 CE-compatible** endpoint supporting Python (71), Node JavaScript (63), Java (62), and C++ (54). Set `JUDGE0_API_URL` to its base API URL. For a RapidAPI-hosted service set `JUDGE0_API_KEY`; for a private endpoint set `JUDGE0_AUTH_TOKEN` if required. Check the language IDs against your host's `/languages` response; edit `LANGUAGES` in `lib/coding.js` if it uses different IDs.

The application submits base64 code/input/output, polls asynchronously, and requests CPU 2s, wall 5s, memory 256MB, maximum file 1MB, and networking disabled. Execution takes place on Judge0, never through a shell or subprocess in the web application. Choose a service that enforces isolation, process/output/network limits independently of client-supplied options. Do not put a self-hosted compiler on the application machine. Service quotas and pricing vary; obtain approval before purchasing a plan.

Run the coding demo against all four languages after connecting the service. Verify compile errors, timeouts, expected output, and successful solutions. Generated live questions include a Python reference that is validated when the runner is configured; failed reference validation rejects the generated problem. Without a runner, the UI explicitly identifies unvalidated reference tests and disables Run tests. AI correctness feedback is then static analysis, not an assertion that code passed tests.

Monaco and Chart.js are installed by `npm ci` and served locally. No external editor CDN or API keys are exposed to the browser. Company questions are labeled representative practice, with no claim they were asked by a particular employer.

Source: [Judge0 CE API documentation](https://ce.judge0.com/).

## 4. Hosting, secrets, and monitoring

The [Dockerfile](../Dockerfile) packages the existing frontend and Express backend together; secrets and development tools are excluded. Node runs as the unprivileged `node` user. Import [render.yaml](../render.yaml) as a Render Blueprint or create a Docker web service from this repo. Review any charges and obtain approval before provisioning paid resources. The blueprint selects the free service tier; check eligibility/current limits in your account. Free services can sleep and are not a production uptime guarantee.

Set the server-side variables listed in `.env.example` through Render's environment settings. Start with `PUBLIC_APP_URL=https://<your-service>.onrender.com`, then update it when DNS is ready. Set `NODE_ENV=production` and `TRUST_PROXY=1` for Render's proxy. Production startup requires Supabase and an HTTPS app origin; configured credentials must be valid and the migration applied. Use `OPENAI_API_KEY` for coding, your existing AI provider settings for general interviews, and `ELEVENLABS_API_KEY` for voice. Never put keys in client JavaScript, git, screenshots, Docker build arguments, or logs.

Render terminates HTTPS; `/healthz` reports process health without private data. Configure an external uptime monitor for that path and provider usage alerts. Also monitor authenticated report saving and voice/coding provider errors: `/healthz` alone does not check Supabase, OpenAI, ElevenLabs or Judge0 availability. Production request/error logs contain request IDs, status, route and latency, with no request bodies, query tokens, credentials, resume content or source code. Check Render logs after deployment and monitor 401/409/429/5xx rates.

Authenticated active sessions persist in Supabase and use leases across instances. Guests and offline demos use process memory and require the same instance for the duration of a session. Rate limits are per-process and IP, so for multiple web replicas place a shared rate limiter/API gateway in front; configure trusted proxies only to match your actual hosting topology. Scale based on observed provider quotas, database latency and load tests. AI requests have a 75-second timeout and no automatic SDK retries, keeping mutation processing below the 180-second lease; do not increase these settings without revisiting the lease duration. No app-owned microphone recording is persisted, but uploaded recordings are sent to ElevenLabs for transcription under its service terms.

Sources: [Render deployment](https://render.com/docs/deploy-node-express-app), [custom domains](https://render.com/docs/custom-domains), [TLS certificates](https://render.com/docs/tls).

## 5. RUemployed.io domain and DNS

Checked on **October 10, 2026**: the `.io` registry WHOIS service (`whois.nic.io`) returned **Domain not found** for `ruemployed.io`. This suggests it was unregistered at that moment and does not guarantee purchasability or price. The [Namecheap registrar search](https://www.namecheap.com/domains/registration/results/?domain=ruemployed.io) returned HTTP 403 from this environment, so registrar checkout availability could not be verified. Check that link or another registrar immediately before purchase; availability can change.

1. Search the exact domain at a registrar and review the initial/renewal cost, transfer rules, privacy options and account security. Obtain explicit approval before purchasing. No purchase was made by this implementation.
2. After the app is healthy at its Render HTTPS URL, add `ruemployed.io` and `www.ruemployed.io` in Render's Custom Domains settings.
3. At the registrar/DNS host, copy the **exact values Render displays**. The apex normally uses an A record (or provider-supported ALIAS/ANAME) and `www` a CNAME to the Render service. Do not guess the A-record IP. Remove conflicting records for these names, and account for existing email MX/TXT records when changing nameservers.
4. Verify the domains in Render. Render provisions/renews certificates after DNS validation. Confirm HTTP redirects to HTTPS and choose one canonical host; configure the other as a redirect in Render. If verification fails, check DNS propagation and any CAA/AAAA conflicts against Render's current instructions.
5. Set `PUBLIC_APP_URL=https://ruemployed.io`, Supabase Site URL and redirect allowlist to the canonical domain. Restart/redeploy; recheck signup and recovery links, cookie persistence, webcam/microphone, TTS, transcription, code execution and private reports on desktop and mobile.

## Feature limits

The face-to-face view uses a stylized SVG avatar whose mouth follows actual audio energy during ElevenLabs playback. It is not a photorealistic rendered human or phoneme-based lip-sync service. Browser speech fallback provides approximate mouth animation. Webcam preview is local, optional and works alongside typed answers; eye-contact/posture/facial analysis is not implemented or claimed. Speaking pace/pauses are timestamp-derived; confidence is inferred from available speech/transcript evidence, never measured from facial expressions or volume. Generated scores use the versioned `ru-v2` rubric; demos are excluded from progress. Compare the same interview focus/type/rubric and treat AI scores as coaching estimates, since question difficulty can still vary.
