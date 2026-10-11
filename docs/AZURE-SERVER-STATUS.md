# Azure Server Status

Updated: 2026-10-11

## Completed locally

- Confirmed the active repository is `C:\Users\faded201\Planned-out-Xavier-` on branch `Main` at `20d6125` with local uncommitted CosyVoice/server migration work.
- Verified Azure CLI is installed at `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`.
- Added Azure App Service deployment source under `deploy/azure/`.
- Added `scripts/deploy-azure-app-service.ps1` for repeatable build, test, Bicep deployment and ZIP deploy.
- Fixed Next.js standalone tracing root in `next.config.ts` so server builds no longer trace the parent user folder.
- Verified local tests: `npm.cmd test` passed, 20/20.
- Verified TypeScript: `npm.cmd run typecheck` passed.
- Verified production build: `npm.cmd run build` passed.
- Verified Bicep syntax: `az bicep build --file deploy/azure/app-service.bicep` passed.
- Checked changed files for common credential patterns; only the empty example `VAPID_PRIVATE_KEY=` name matched.

## Current blocker

Azure deployment is blocked by account access, not code. `az login --use-device-code` reached Microsoft sign-in, but Azure CLI returned:

- tenant `528589ce-e43f-4e59-82f7-319d7864c596` requires MFA
- no subscriptions were found for the signed-in account `jameshapurona@gmail.com`

The next step is to sign in with the Azure account that owns the Planned Out subscription, complete MFA, and confirm `az account list` shows at least one active subscription.

## Xavier voice reference

The latest user-authorized Xavier/Javier recording was converted to mono 16-bit 24 kHz WAV as `xavier-emotional-reference.wav` in the Codex workspace. Use it as the private `XAVIER_COSYVOICE_PROMPT_WAV` reference when deploying the verified cloud GPU voice backend. The style prompt now asks for measured pacing, clear pauses, gentle warmth, subtle emotion, and a slightly mysterious intelligent presence.

Do not commit the private reference recording to Git. Place it in a private server path or secret-backed deployment artifact and point `XAVIER_COSYVOICE_PROMPT_WAV` at that path.

## Production note

This Azure App Service setup is for the Planned Out web server. CosyVoice GPU inference still needs a separate verified cloud GPU host; it must not run in production on the Surface or a LAN tunnel.
