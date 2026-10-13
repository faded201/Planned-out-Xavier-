# Local Xavier Vision

The optional local gateway uses an already installed Ollama vision model. It does
not provision cloud inference. The production adapter defaults to Azure for
backward compatibility; selecting a different provider is an explicit server
configuration change. Azure and generic hosted providers keep the existing paid
entitlement check. All providers require a verified Supabase user session.

## Windows startup

Run from the repository in PowerShell:

```powershell
ollama show qwen3-vl:2b-instruct
powershell -ExecutionPolicy Bypass -File scripts/start-xavier-vision.ps1 -Model qwen3-vl:2b-instruct
```

The launcher creates a random 256-bit token, encrypted with Windows DPAPI at
`$env:LOCALAPPDATA\XavierVision\gateway-token.xml`. It never prints the token.
The gateway binds to `127.0.0.1:11435`; Ollama remains at `127.0.0.1:11434`.
The model must already be downloaded. Model management is not exposed.

`GET /health` and `POST /v1/chat/completions` both require the gateway bearer
token. Health is gateway liveness, not proof of successful model inference.
The POST accepts the OpenAI-compatible image message emitted by the app adapter.
Only inline PNG/JPEG/WebP images are accepted; remote URLs are never fetched.
The gateway accepts one inference at a time and at most 20 attempts/minute.
This is a gateway capacity limit, not subscription monthly AI accounting or a
speech cap. Requests time out after 40 seconds, within the adapter's 45-second
and client/function's 60-second limits. Slow hardware returns a safe timeout.

## Tunnel and production configuration

Expose only port 11435. Never expose Ollama's port 11434.

```powershell
cloudflared tunnel --url http://127.0.0.1:11435
```

A quick tunnel is temporary and changes when restarted. Do not store it as a
permanent production endpoint. For production, configure a named free tunnel
using an existing Cloudflare account and domain; keep the PC awake and online.
Do not buy a domain or provision paid compute to make this work.

After obtaining a stable HTTPS hostname and verifying real image inference,
configure these server-only Vercel production variables using sensitive storage:

```text
XAVIER_VISION_PROVIDER=local-gateway
XAVIER_VISION_ENDPOINT=https://<stable-hostname>/v1/chat/completions
XAVIER_VISION_API_KEY=<gateway bearer token>
XAVIER_VISION_MODEL=qwen3-vl:2b-instruct
```

`XAVIER_VISION_API_URL` remains a supported legacy endpoint alias.
`openai-compatible` is also supported for explicitly configured hosted endpoints;
it is not automatically free. No provider automatically falls back to Azure.
Do not remove the paid guard from Azure configurations or send images to an
unverified provider. The gateway token is server-only, never a browser credential.

Test health, authentication rejection, real photo description, screenshot OCR,
object identification and production reachability before claiming vision is live.
Automated gateway tests mock Ollama and cannot establish actual model quality.
