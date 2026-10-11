# Xavier Voice Subscriptions

Updated: 2026-10-11

## Goal

Use subscriptions to pay for burst CosyVoice GPU usage without promising unlimited voice. Free users keep Xavier text and browser-native speech fallback. Paid users receive a bounded monthly CosyVoice allowance.

## Current plan policy

| Plan | Price | AI requests/month | CosyVoice replies/month | Voice burst | Fallback |
| --- | ---: | ---: | ---: | ---: | --- |
| Free | A$0 | 1,000 | 0 | 0/min | Browser/native speech only |
| Pro | A$4.99/month | 10,000 | 60 | 4/min | Browser/native speech after cap or outage |
| Business | A$19.99/month | 50,000 | 500 | 12/min | Browser/native speech after cap or outage |

These values are encoded in `lib/billing-config.ts` and returned by `GET /api/billing/plans`.

## Cost model

The smallest practical T4-class GPU price previously checked for Australia/Sydney-class burst planning was US$0.684/hour. That means:

| GPU runtime/month | Estimated GPU compute |
| ---: | ---: |
| 10 hours | US$6.84 |
| 30 hours | US$20.52 |
| 100 hours | US$68.40 |
| 730 hours | US$499.32 |

The product must sell voice as a capped allowance, not unlimited speech. A small number of Pro subscriptions can cover light GPU burst testing, but heavy public voice requires Business subscriptions, stricter caps, or extra voice packs.

## Runtime behavior

- The web app stays on Azure/free CPU or another cheap always-on host.
- CosyVoice GPU stays off until there is paid voice demand or an operator starts a demo window.
- If the GPU is cold/off, Xavier still returns text and uses browser-native speech fallback.
- When the GPU is warm, `/api/voice` can return CosyVoice WAV audio.
- The GPU should auto-stop after an idle window, such as 10-20 minutes.

## Enforcement still required on the production voice backend

The UI/API now exposes the policy, but the final cloud voice proxy must enforce it against trusted entitlements and usage counters before invoking CosyVoice:

- reject Free CosyVoice requests with 402 or 403 and let the app fallback to browser speech
- enforce Pro and Business monthly reply limits
- enforce per-minute burst limits
- never accept client-submitted plan or user IDs
- log counts and outcomes without logging private prompt text
- stop or scale down the GPU when idle

Until that backend is deployed and tested, the subscription policy is prepared but not production-enforced for real CosyVoice spending.
