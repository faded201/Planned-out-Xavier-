# Planned Out billing

Billing uses Stripe-hosted Payment Links and Stripe's email-authenticated customer portal. A persistent Stripe API key is not required in Vercel. Authentication on the app's checkout and portal routes uses Supabase `getUser`; checkout adds the verified user's ID as `client_reference_id`.

## Existing prices (AUD)

| Plan | Monthly | Yearly |
| --- | ---: | ---: |
| Pro | 4.99 | 49.99 |
| Business / Full | 19.99 | 199.99 |

Free, Pro and Business AI allowances remain 1,000, 10,000 and 50,000 requests per month, with the existing burst limit of 20. The existing entitlement reader only treats active, unexpired paid entitlements (or permanent grants) as paid access; trialing and past-due subscriptions do not change this policy.

## Configuration

Vercel production requires `STRIPE_PAYMENT_LINK_PRO_MONTHLY`, `STRIPE_PAYMENT_LINK_PRO_YEARLY`, `STRIPE_PAYMENT_LINK_BUSINESS_MONTHLY`, `STRIPE_PAYMENT_LINK_BUSINESS_YEARLY` and `STRIPE_CUSTOMER_PORTAL_URL`. URLs must be HTTPS URLs on the expected Stripe hosts. Missing or invalid configuration makes the corresponding operation unavailable. The four existing `STRIPE_PRICE_*` variables retain the catalog IDs for operational reference; hosted links supply the actual prices.

The public webhook is `POST https://8ez498sq1a.execute-api.ap-southeast-2.amazonaws.com/stripe/webhook`, routed to `PlannedOut-Stripe-Webhook`. Its Lambda environment includes:

- `STRIPE_WEBHOOK_SECRET_ARN`: the existing AWS Secrets Manager signing-secret reference.
- `PAYMENT_LINK_PLAN_MAP_JSON`: exact verified Payment Link IDs mapped to `plan` and `interval`.
- `PRICE_PLAN_MAP_JSON`: exact recurring Stripe price IDs mapped to `pro` or `business`.
- `STRIPE_LIVEMODE=true`: reject test-mode events at the production endpoint.
- Existing writer function and subscription table names.

Never put the signing-secret value in Git or browser configuration. The secret loader normalizes BOM/whitespace from file-based provisioning before validating its prefix.

## Event handling

Checkout completion and async-payment success establish the account/subscription mapping and provisional access after payment. Only allowlisted Payment Links can grant access; amount and generic metadata are insufficient. Subscription created/updated/deleted events use allowlisted prices and the actual subscription-item billing-period end. Known subscriptions without an account mapping return a retryable error, allowing an earlier subscription event to be retried after Checkout arrives.

Subscription events replace provisional checkout state even when their original creation timestamp is earlier. Checkout cannot overwrite authoritative subscription state. Older events and repeated events do not overwrite newer entitlements. A cancellation for an older subscription cannot revoke the entitlement for a different current subscription. Unknown prices on a known mapping fail closed for investigation.

The private `PlannedOut-Entitlements-Writer` writes entitlements and audit records in one DynamoDB transaction. Its conditional snapshot check makes races retryable, and the audit event key deduplicates non-consecutive replays. Stripe events cannot overwrite permanent owner-issued grants or the owner account.

After a successful Checkout return, the app refreshes entitlements every two seconds for one minute, then once per minute while visible. It also refreshes on focus. All signed-in users retain access to Manage billing, including accounts that have fallen back to Free.

## Verification

- `npm test`: billing route/configuration tests and existing assistant tests.
- `npm run typecheck` and the production Next.js build.
- `python -m unittest discover -s tests -p 'test*.py'` with boto3 available: webhook/writer tests and existing AI quota tests.
- Live synthetic requests must use isolated random user/subscription/event IDs, sign the exact raw request bytes, and remove only records created by that test. They verify plumbing without charging a card and must not be represented as a real purchase.
- Stripe event resend can verify provider-origin delivery. Use an irrelevant catalog event for a no-entitlement-mutation probe, or deliberately reconcile an already-known subscription event.

Do not run the pre-existing untracked `aws/stripe-webhook/synthetic-test.mjs` as the current integration test: it uses the superseded amount-only payload, lacks production mode and Payment Link identity, and is intentionally rejected by the hardened handler.
