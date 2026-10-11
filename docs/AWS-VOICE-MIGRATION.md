# Xavier CosyVoice AWS migration

> Superseded on 2026-10-09: the user selected Valebyte instead of AWS.
> This is a historical checkpoint. Use `VALEBYTE-MIGRATION.md` for current deployment work.
> The AWS voice environment variable and endpoint restriction below have been replaced.

## Current checkpoint - 2026-10-09

Active checkout: `C:\Users\faded201\Planned-out-Xavier-`, branch `Main`, starting commit `20d6125`.
Existing uncommitted CosyVoice work is preserved. Older Planned-out checkouts also exist; do not overlay them.
The initial `aws sts get-caller-identity --region ap-southeast-2` failed with an expired session.
No AWS resources have been inspected or deployed during this continuation. No local inference, model downloads,
or dependency installation have been performed.

## Production boundary

Production CosyVoice inference must run on AWS, never on the Surface, a LAN address, or a tunnel to the Surface.
The unfinished Windows scripts under `server/` are development artifacts, not deployment entry points.

Production builds now request `/api/voice` on the application origin, ignoring `NEXT_PUBLIC_TTS_SERVER_URL`.
The server verifies the user's Supabase token with Auth before forwarding to `XAVIER_AWS_TTS_URL`.
This server-only setting accepts only HTTPS API Gateway endpoints in `ap-southeast-2`, ending in `/tts`
or `/stage/tts`. Redirects are rejected. An AWS URL alone does not prove inference runs on AWS:
deployment verification must confirm the integration targets AWS compute, never a workstation tunnel.

Request contract: `POST /tts`, bearer token, JSON `{ "text": "Hello" }` with 1-4,000 characters.
Success must return binary `audio/wav` (RIFF/WAVE), at most 4,000,000 bytes. Synthesis, including
authentication and transfer, must complete within the application's 28-second upstream budget.
Voice style and reference audio belong in the AWS service configuration, not user-controlled request fields.
The browser refreshes expired sessions once, cancels obsolete requests, and shows a text-only fallback
message when production cloud voice is unavailable. It does not silently call local CosyVoice.

## Remaining AWS work

1. Renew the AWS CLI session using remote sign-in, then rerun STS in Sydney. Record the actual account and ARN.
2. Inspect existing CloudFormation stacks, API Gateway integrations, EC2/ECS/SSM inventory, GPU quotas, and
   any existing migration infrastructure before choosing or creating resources. Do not assume an account,
   AMI, VPC, instance size, endpoint, or budget from an older checkout.
3. Prepare infrastructure as code for an AWS GPU inference service after that inventory. Use a private
   backend, encrypted storage, IMDSv2, and SSM administration. Build images and download weights on AWS.
   Preserve the existing Lambda assistant/billing paths and use the existing user's Auth scheme.
4. The AWS voice ingress must validate Supabase tokens independently (the public `/tts` URL can be called
   directly), enforce per-user usage/concurrency limits, and return 429 for overload. Never expose an
   unauthenticated GPU synthesis port or rely on client-submitted user IDs/plan values.
5. Validate the pinned upstream CosyVoice revision and model on the AWS GPU. The current Windows draft
   monkey-patches CPU weight loading and is not an AWS GPU implementation. Use the upstream supported
   model API for the cloud runtime; preserve the Windows draft separately.
6. Verify unauthorized/expired token rejection at the public AWS endpoint, authenticated WAV playback,
   timeout and overload behavior, log redaction, and actual GPU execution. Benchmark short and long replies;
   reduce utterance size or implement chunking if synthesis exceeds the synchronous request budget.
7. Set `XAVIER_AWS_TTS_URL` only after these checks. Deploy the application, test playback from the phone
   with the Surface's voice process absent, and confirm the inference backend is AWS-hosted.

The proxy is prepared; AWS provisioning, model execution, cost verification, and phone playback remain unverified.

## References

- [CosyVoice API at the draft's upstream revision](https://github.com/FunAudioLLM/CosyVoice/blob/074ca6d/cosyvoice/cli/cosyvoice.py)
- [AWS API Gateway private integrations](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-private-integration.html)
- [Supabase server-side user verification](https://supabase.com/docs/reference/javascript/auth-getuser)

## Local checks (no inference)

Run `npm test` and `npm run typecheck`. The voice tests use synthetic WAV bytes and mocked upstream responses.
They do not import CosyVoice, load a model, call production synthesis, or require AWS credentials.

Validation on 2026-10-09: all 20 Node tests passed (8 voice tests), and `npm run typecheck` passed.
The touched tracked files pass `git diff --check`; the full checkout still has pre-existing trailing-blank-line
warnings in `.gitignore` and `server/allow-lan-firewall.ps1`, which were left intact.
All six existing `server/` files were verified byte-for-byte unchanged against the pre-edit backup.
The backup is in this chat's workspace under `work/xavier-before-aws-voice/` (patch, status, touched originals,
and server drafts; no `.env.local` copy). No commit, push, deployment, or AWS resource mutation was performed.
