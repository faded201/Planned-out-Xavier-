# Xavier Vision on Azure

Status: prepared, not provisioned.

Xavier vision uses a server-only route:

1. Browser sends an authenticated `POST /api/vision` request.
2. Next.js verifies the Supabase JWT.
3. The server forwards a bounded prompt and image URL/data URL to an Azure Foundry or Azure ML OpenAI-compatible Qwen3-VL endpoint.
4. The browser receives only Xavier's text description.

Required server-only variables:

```text
XAVIER_VISION_API_URL=
XAVIER_VISION_API_KEY=
XAVIER_VISION_MODEL=Qwen/Qwen3-VL-2B-Instruct
```

Do not expose the endpoint key through `NEXT_PUBLIC_*`.

## Azure Audit

The existing Azure OpenAI resource only lists Azure OpenAI models such as `gpt-4o`, `gpt-4o-mini`, and the deployed `gpt-5-mini`. Qwen3-VL is not deployable from that Azure OpenAI account.

Microsoft Foundry documentation says non-OpenAI catalog models need a Foundry resource/serverless API deployment or managed compute. Qwen models are listed under managed compute examples. Managed compute is hourly GPU billing, while serverless API is token or provisioned-throughput billing depending on the deployment type.

A monthly Azure safety budget named `Planned-Out-Azure-Safety` has been created at USD 25 with 50%, 80%, and 100% actual-spend notifications.

Do not provision Qwen3-VL until the Azure portal or Marketplace subscription flow shows the exact Qwen3-VL price and terms for the subscription offer.

## Request Shape

```json
{
  "image": "https://example.com/image.png",
  "prompt": "What should Xavier notice in this image?",
  "detail": "auto",
  "maxTokens": 500
}
```

Accepted image values:

- HTTPS image URL with no embedded credentials.
- `data:image/png;base64,...`
- `data:image/jpeg;base64,...`
- `data:image/webp;base64,...`

The route rejects oversized request bodies, unsupported fields, invalid URLs, and prompts over 1,200 characters.

## Rollback

Blank `XAVIER_VISION_API_URL` and `XAVIER_VISION_API_KEY`. Xavier text and voice routes continue to work; `/api/vision` will return a safe 503 instead of calling Azure.

## Provisioning Status - 2026-10-12

Created resource:

- Resource group: `planned-out-xavier-rg`
- Foundry-capable account: `planned-out-xavier-foundry-jh`
- Kind: `AIServices`
- SKU: `S0`
- Region: `australiaeast`
- Endpoint: `https://planned-out-xavier-foundry-jh.cognitiveservices.azure.com/`

Safety controls:

- Budget: `Planned-Out-Azure-Safety`
- Amount: `25.0` in the subscription billing currency
- Alerts: 50%, 80%, and 100% actual spend to `jameshapurona@gmail.com`
- Current spend reported by CLI: `0.0`

Availability result:

- The `AIServices` account lists Qwen text/fine-tuning models, but not Qwen3-VL.
- West US 3 instant-access discovery also lists Qwen text/fine-tuning models, but not Qwen3-VL for this subscription.
- Retail pricing exposes Qwen3 32B/fine-tune meters, but no exact Qwen3-VL 2B/8B meter was returned by the Azure Retail Prices API.

Do not create a managed compute Qwen3-VL endpoint until Azure exposes the exact Qwen3-VL price/terms for this subscription or the Foundry portal confirms them at deployment time.
