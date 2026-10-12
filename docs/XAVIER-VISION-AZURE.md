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

## External Reference Audit - 2026-10-12

Official Microsoft Foundry catalog confirms Qwen3-VL model cards exist for:

- `Qwen/Qwen3-VL-2B-Instruct`
- `Qwen/Qwen3-VL-8B-Instruct`

The catalog examples use Azure ML endpoint authentication and an OpenAI-compatible chat completions payload with `image_url` content.

Official deployment path findings:

- Qwen3-VL is a Hugging Face-published Foundry catalog model.
- Current Foundry docs say Hugging Face models use Foundry Managed Compute, which provisions dedicated GPU-backed endpoints.
- Managed Compute is public preview and does not use the normal Azure OpenAI deployment list.
- Managed Compute is billed hourly per accelerator family/model instance, not by idle-free CPU or ordinary Azure free-tier CPU hours.
- Foundry chooses/encodes runtime and GPU topology through a deployment template. The model card/deploy wizard shows the compatible model ID, deployment template ID, accelerator family and count.
- Hugging Face availability in a project requires: the model is in catalog, GPU managed-compute quota exists for at least one compatible accelerator, and the model is available in the project's Azure region.
- If the model is not available in the current Foundry experience, Microsoft docs direct users to Foundry classic or the Hugging Face on Foundry feedback path.

Pricing findings:

- Microsoft docs state current rates for Hugging Face managed compute are on the Foundry Models Managed Compute pricing surface and the deploy wizard exposes the model/template choice before deployment.
- Azure Retail Prices API currently returns Qwen3 32B/fine-tuning meters, including Australia regions, but no exact Qwen3-VL 2B/8B meter was found by searching `qwen`, `vl`, `2b`, `8b`, or `qwen3-vl`.
- Because no exact Qwen3-VL meter was returned, the safe path is to use the Foundry portal deploy wizard to view the final accelerator/template price before accepting deployment.

Runtime/model findings:

- Hugging Face lists `Qwen/Qwen3-VL-8B-Instruct` as Apache-2.0, image-text-to-text, Transformers, Safetensors, and `qwen3_vl`.
- Hugging Face examples support Transformers, vLLM, and SGLang with OpenAI-compatible chat completions containing text plus `image_url`.
- Microsoft Foundry Qwen3-VL model cards also show OpenAI-compatible chat completions and vision payload examples.

Why CLI discovery does not show Qwen3-VL:

- `az cognitiveservices account list-models` shows Azure OpenAI / Foundry Models sold through the Cognitive Services model list; it does not enumerate every Hugging Face managed-compute model card from the Foundry catalog.
- The new `AIServices` account now exposes Qwen text/fine-tune models through that API, but Qwen3-VL still does not appear there.
- West US 3 instant-access discovery did not list Qwen3-VL for this subscription. Instant access is preview-only and West US 3-only, and Qwen3-VL is not confirmed as an instant-access model for this account.

Operational conclusion:

- Use Foundry Managed Compute, not Azure OpenAI deployments, for Qwen3-VL.
- Do not deploy until the Foundry portal shows a compatible deployment template and exact hourly accelerator price inside the selected project.
- If the Qwen3-VL card shows `Continue in Foundry (classic)`, use classic as the fallback path.
- If the card is hidden by `Available in my Project`, check managed-compute accelerator quota and region availability first.
