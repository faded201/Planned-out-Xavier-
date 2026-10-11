# Planned Out Azure Server

This folder contains the Azure App Service path for the Planned Out web server. It is intentionally web-only: CosyVoice GPU inference must run on a verified cloud GPU backend, not on the Surface and not inside this low-cost web tier.

## What it creates

- Linux Azure App Service running Node 22.
- HTTPS-only web app with FTPS disabled.
- Standalone Next.js startup: `node server.js`.
- Server-only app settings for the Xavier assistant API and future cloud voice endpoint.
- `NEXT_PUBLIC_TTS_SERVER_URL` forced empty so production never calls the Surface or LAN voice server.

## Required access

Azure CLI must be signed in to a subscription with permission to create or update:

- resource groups
- App Service plans
- Linux Web Apps
- deployments
- app settings

If `az login` reports no subscriptions or tenant MFA is required, deployment is blocked until the correct Azure account completes MFA and has subscription access.

## Deploy

From PowerShell at the repo root, set only the values needed for this environment:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='https://mllaiyqyabvbtyachxhh.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='your publishable Supabase key'
$env:XAVIER_AWS_API_URL='https://existing-api.example/xavier'
$env:XAVIER_TTS_URL=''
$env:XAVIER_TTS_TRUSTED_ORIGIN=''

.\scripts\deploy-azure-app-service.ps1 `
  -ResourceGroup planned-out-production `
  -AppName planned-out-xavier `
  -Location australiaeast `
  -SkuName B1
```

Set `XAVIER_TTS_URL` and `XAVIER_TTS_TRUSTED_ORIGIN` only after the production voice backend is deployed and verified. The value must be an HTTPS endpoint ending in `/tts`; the application proxy validates that before forwarding the user's bearer token.

## Verification

Run these before trusting the deployment:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
az webapp show --resource-group planned-out-production --name planned-out-xavier --query '{state:state,host:defaultHostName}'
```

Then verify in the browser:

- Supabase sign-in works.
- Planner data loads under the signed-in user.
- Xavier text assistant still works through the existing backend.
- Voice failures do not break chat.
- No production request goes to `localhost`, `5173`, or a LAN address.

## Voice server note

The App Service tier is not the CosyVoice 3 GPU host. For Xavier speech, deploy a separate cloud GPU service with JWT validation, rate limits, private model storage, and no public unauthenticated inference port. Keep the local `C:\Users\faded201\CosyVoice` experiment until cloud synthesis is proven.
