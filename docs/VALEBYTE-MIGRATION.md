# Planned Out / Xavier: Valebyte migration

## Status — 2026-10-09

Target changed from AWS to Valebyte at the user's request. Nothing has been deployed or purchased.
The signed-in Valebyte dashboard shows zero servers, VPS instances, and apps.
Existing uncommitted changes are preserved. Production CosyVoice must never run on the Surface.

Prepared: standalone Next.js output, a multi-stage Dockerfile with a non-root runtime,
Compose with an HTTPS Caddy gateway and persistent certificates, and secret/model exclusions
from the Docker build context. The web container has no public port; only Caddy exposes 80/443.

Voice uses server-only `XAVIER_TTS_URL` and `XAVIER_TTS_TRUSTED_ORIGIN`, with an exact origin
match, HTTPS, `/tts`, no redirects, authenticated requests, bounded bodies, and timeouts.
Set these only after verifying that the hostname resolves to the deployed Valebyte service.
The URL check cannot establish server ownership or stop DNS rebinding by itself. Never allow
a workstation tunnel or a hostname resolving to a private/local address.
The voice backend must independently validate the Supabase JWT and enforce quotas.
No production voice backend is included yet; the Windows draft is not a production service.

## Hosting decision pending

The user's monthly budget, server region, production domain, and final GPU configuration are
not yet known. Public prices checked on 2026-10-09:

- VPS-1: US$15/month, 4 vCPU, 8 GB RAM, 80 GB NVMe. Candidate for the web app, not a
  demonstrated CosyVoice production solution.
- New York Intel Special: US$129/month base, 64 GB RAM, 2x2 TB SSD; NVIDIA Quadro RTX 4000
  costs another US$129/month. US$258/month before any taxes and other options. This is one
  checked configuration, not a claim that it is the cheapest or sufficient for the workload.
  GPU performance, actual VRAM and availability must be confirmed before ordering.

Sources: https://valebyte.com/en/vps-hosting/ and https://valebyte.com/en/configure/3682/.

## Remaining AWS dependencies — production cutover is blocked

Moving the web container alone does not migrate Xavier:

| Component | Current implementation | Required replacement |
| --- | --- | --- |
| Assistant | API Gateway/Lambda and Amazon Bedrock | Valebyte-hosted assistant API and a chosen non-AWS model service |
| Usage and memberships | DynamoDB and entitlement writer Lambda | Transactional persistence, quotas, and verified data migration |
| Stripe webhook | Lambda, Secrets Manager, entitlement writer | Signature-verified, idempotent webhook on the replacement backend |
| Membership admin | Proxy to AWS API | Equivalent owner authorization on the replacement backend |
| Voice | New proxy; no verified deployed backend | Authenticated, GPU-tested CosyVoice 3 service on Valebyte |

The supplied Compose file deliberately clears `XAVIER_AWS_API_URL`; these features fail closed
in this staging configuration. Do not route production traffic to it until their replacements
pass verification. The existing Supabase authentication/database and Stripe accounts remain
external dependencies; no schema or customer data has been changed.

## Remote web staging procedure

Run only on the selected Valebyte Linux server with Docker Engine and Compose installed.
Use an exact reviewed source snapshot including the local changes, not a fresh clone that
would omit them. Do not upload `.env.local`, model files, or the Windows voice draft.

1. Point a staging hostname to the server. Allow public TCP 80/443 and restrict SSH to the
   operator. Confirm both IPv4 and IPv6 DNS records target this server.
2. Create `.env.production.local` at the repository root, mode 600, using `.env.example`
   as a field reference. Set `PLANNED_OUT_DOMAIN` to the bare staging hostname and
   `NEXT_PUBLIC_APP_URL` to its HTTPS URL. Supply public Supabase settings at build time;
   supply server secrets only at runtime. Do not put secrets in build arguments.
3. From the repository root, validate and build:

   ```sh
   docker compose --env-file .env.production.local -f deploy/valebyte/compose.yaml config --quiet
   docker compose --env-file .env.production.local -f deploy/valebyte/compose.yaml build
   docker compose --env-file .env.production.local -f deploy/valebyte/compose.yaml up -d
   docker compose --env-file .env.production.local -f deploy/valebyte/compose.yaml ps
   ```

4. Verify HTTPS, login/logout, planner read/write and cross-user isolation. Configure the
   Supabase redirect allowlist for the new origin. Rebuild when public environment settings change.
5. Migrate the services in the table. Export/verify existing entitlements and usage before
   switching writers; do not discard AWS state. Test Stripe replay protection and membership
   changes against test events before redirecting the live webhook.
6. Deploy CosyVoice on the remote GPU server only; benchmark warm/cold latency against the
   proxy's 28-second limit and load-test concurrency. Provision a licensed reference voice,
   validate JWTs and quotas server-side, and keep model/admin ports private. Check that
   turning off the Surface does not affect production speech.
7. Configure a remote scheduler for authenticated GET `/api/reminders/dispatch` with
   `CRON_SECRET`; the current Compose does not schedule reminders. Verify push, calendar
   invitation email, checkout, portal, and engineering/GitHub integrations where configured.
8. Back up persistent data and record a rollback image/configuration before production DNS
   cutover. Retire old AWS resources only after data reconciliation and successful cutover.

## Verification

All 20 unit tests, TypeScript checking, and the production Next.js build pass after the Valebyte changes.
Docker is unavailable on the Surface; the Linux image and Compose deployment still require
remote validation. No local inference, model downloads, or model dependency installation occurred.

Next.js standalone reference: https://nextjs.org/docs/app/api-reference/config/next-config-js/output
