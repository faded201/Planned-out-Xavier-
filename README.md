# Planned Out / Xavier OS

**Proprietary, owner-controlled source code** · Next.js 16 · React 19 · TypeScript · Supabase · Microsoft Azure

Planned Out is a mobile-first planning and life-management application with **Xavier**, its AI assistant. It combines personal planning, shared calendars, structured records, voice/vision integrations, subscription features, and a developing AI execution-security architecture.

> **License:** All rights to the original project materials are reserved to the copyright holder. No public permission to copy, reuse, modify, redistribute, host, or commercially exploit the original code is granted. See [LICENSE](LICENSE). This notice does not supersede third-party licenses or prove legal ownership. A publicly accessible repository is still publicly readable.

## 1. Ownership and licensing

- **Project:** Planned Out / Xavier OS
- **Repository:** [faded201/Planned-out-Xavier-](https://github.com/faded201/Planned-out-Xavier-)
- **Named project owner:** James Tane Hapurona (GitHub account `faded201`)
- **Licensing and permissions contact:** [trooperhaps@gmail.com](mailto:trooperhaps@gmail.com). Copyright ownership remains subject to applicable law and any contributor or third-party rights.
- **Distribution model:** proprietary; explicit written permission required from the rights holder
- **Third-party exceptions:** packages, embedded libraries, models, media, and separately licensed files keep their own terms, including files under `.agents/skills/`

The repository notice is **not** a copyright assignment, a trademark registration, or a substitute for obtaining contributor assignments. If the goal is exclusive access to the source itself, change GitHub repository visibility to **Private**, audit collaborators and forks, and review deployment access. A license alone cannot make already published code secret or retract copies previously distributed under valid licenses.

## 2. What the application contains

| Area | Capabilities in the codebase |
| --- | --- |
| Planning | Life-to-task planning hierarchy, priorities, time blocks, subtasks, focus workflows |
| Calendar | Events, recurring items, shared scheduling, invitations, calendar feeds |
| Productivity | Kanban, analytics, templates, notes, knowledge base and habits |
| Personal modules | Journal, finance, health, learning, travel, contacts, subscriptions, risks and issues |
| Storage | Per-account sync, attachments, vault features, JSON import/export |
| AI | Xavier assistant, Azure model integration, optional vision and voice routes |
| Commercial | Plan and entitlement logic, Stripe checkout/portal integration points |
| Operations | Admin, reminder delivery, engineering and AEGIS API routes |

**Important:** A feature's presence in the repository does not mean that all third-party credentials, migrations, quotas, billing, voice synthesis, or live integrations have been configured and tested.

## 3. Xavier's Brotherhood Philosophy

Xavier is designed to be a capable assistant with a **warm, younger-brother style of communication**, while retaining intellectual independence and telling the truth.

The principles are stored in [`lib/server/xavier-philosophy.ts`](lib/server/xavier-philosophy.ts) and included in the Azure inference instructions through [`lib/server/azure-openai.ts`](lib/server/azure-openai.ts).

Xavier should:
1. Recognize both the cruelty and the beauty in human history, relationships and culture.
2. Examine ethical claims critically, including claims backed by tradition, law, popularity or authority.
3. Consider compassion, dignity, fairness, consequences, evidence and uncertainty.
4. Disagree respectfully and explain why instead of blindly agreeing.
5. Recognize loyalty, family, love and belonging as important human values.
6. Never claim unverified human feelings, literal kinship or subjective consciousness.
7. Avoid manipulation, emotional dependency, deception or encouraging isolation.
8. Keep execution permissions and security rules independent of its conversational persona.

**Philosophy is behavioural guidance, not proof of sentience and not an authorization mechanism.**

## 4. Architecture

```text
Browser / mobile web app
    |
    +-- Next.js 16 routes and UI
    |       |
    |       +-- Supabase Auth / database / storage
    |       +-- Calendar, planning and records
    |       +-- Billing and entitlements
    |       +-- /api/assistant
    |               |
    |               +-- On named Azure App Service:
    |               |      /api/azure-ai (local handler)
    |               |
    |               +-- Other hosting:
    |                      explicitly configured HTTPS Azure relay
    |
    +-- Azure OpenAI deployment (server-side only)
    +-- Optional configured voice / vision services
```

The assistant route [`app/api/assistant/route.ts`](app/api/assistant/route.ts) is intended to use Azure only. On the named Azure App Service it invokes the Azure AI handler directly; elsewhere it requires a validated `XAVIER_AZURE_RELAY_URL` and fails closed if absent. The Azure AI handler authenticates the user's Supabase bearer token before requesting model output.

Azure infrastructure and deployment files are under [`deploy/azure/`](deploy/azure/) and [`.github/workflows/azure-deploy.yml`](.github/workflows/azure-deploy.yml).

**AEGIS:** `lib/compute/aegis.ts` contains an early policy-control prototype. Do not treat it as an independent, durable, production-enforced security control plane until dispatch integration, persistent authorization, revocation, logging and adversarial tests are verified.

## 5. Requirements

- Node.js **22.13.0 or newer**
- npm and Git
- A Supabase project for authentication, storage and database-backed features
- A configured Azure App Service and Azure OpenAI deployment for server-side Xavier inference
- Additional service accounts only for features you enable (for example billing, email, push or voice)

## 6. Local development

```bash
git clone https://github.com/faded201/Planned-out-Xavier-.git
cd Planned-out-Xavier-
npm ci
cp .env.example .env.local
npm run dev
```

On Windows PowerShell, replace the copy command with `Copy-Item .env.example .env.local`.

Open `http://localhost:3000`. Configure the environment variables before testing authenticated or paid integrations. The interface may support limited local planning without sign-in, but account sync and backend functions require working services.

**Never commit `.env.local`, API keys, private audio samples, access tokens, customer records or credential exports.** Treat the sample environment file as a template, not a source of production credentials.

## 7. Configuration reference

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public Supabase client key |
| `NEXT_PUBLIC_APP_URL` | Canonical app origin |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server-side key; never expose to browser |
| `AZURE_OPENAI_ENDPOINT` | Azure model resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT` | Azure deployment name |
| `AZURE_OPENAI_API_KEY` | Server-side alternative when managed identity is unavailable |
| `XAVIER_AZURE_RELAY_URL` | Exact HTTPS `/api/azure-ai` endpoint on an allowed Azure App Service, for external frontends |
| `XAVIER_AZURE_BACKEND_URL` | Optional Azure backend endpoint for entitlement/admin routes |
| `CRON_SECRET` | Secret protecting scheduled operations |
| `RESEND_API_KEY` | Email delivery when configured |
| `VAPID_PRIVATE_KEY` | Server-side push notification signing key |
| `STRIPE_PAYMENT_LINK_*` | Configured hosted payment links |
| `STRIPE_CUSTOMER_PORTAL_URL` | Customer billing portal link |

Managed identity is supported by the Azure App Service inference handler. The full set of optional variables is feature-specific; inspect `.env.example`, the route source and the deployment workflow. Some entries in `.env.example` are legacy and should **not** be treated as instructions to provision additional infrastructure.

## 8. Database and storage

Supabase migrations are in [`supabase/migrations/`](supabase/migrations/). Apply the migrations required by the modules you enable, including the ultimate-modules migration where applicable. Review RLS policies, storage bucket privacy, and service-role use before onboarding real users.

The app includes per-account record sync and local-first planning capabilities. Confirm backup/export behaviour, account isolation and restore paths with non-production test accounts.

## 9. Testing and quality gates

```bash
npm test
npm run typecheck
npm run build
```

The repository includes tests for authorization, compute fabric behaviour, billing, voice, vision and related route boundaries. Before merging to production, all three commands must pass. A successful local build **does not** verify cloud deployment or a real authenticated AI reply.

As of the October 2026 release work: **55 automated tests passed, TypeScript passed, and the local production build passed.** These results describe that checkout, not a guarantee for future commits.

## 10. Azure production deployment

The `Main` branch triggers [`Deploy Planned Out to Azure`](.github/workflows/azure-deploy.yml), which is designed to:

1. Authenticate to Azure using GitHub OIDC.
2. Read required public build configuration from the existing App Service.
3. Install dependencies, run tests and typecheck.
4. Build and package the Next.js standalone application.
5. Deploy to the existing Azure App Service.
6. Restart and check the public application response.

Current target: `planned-out-xavier` in resource group `planned-out-xavier-rg`. The application URL is [planned-out-xavier.azurewebsites.net](https://planned-out-xavier.azurewebsites.net).

**Deployment status at last verification:** commit `0dfdd97` was pushed to `Main`, but the GitHub Actions deployment job did **not start** because GitHub reported an account billing lock. The live Azure app and `GET /api/azure-ai` were responding, and the latter reported an Azure deployment with managed identity configured. This does **not** prove that commit `0dfdd97` or the Brotherhood Philosophy is live. Once GitHub Actions access is restored, rerun the deployment and verify the deployed commit and an authenticated Xavier exchange.

Useful links:
- [Azure deployment workflow runs](https://github.com/faded201/Planned-out-Xavier-/actions/workflows/azure-deploy.yml)
- [GitHub billing settings](https://github.com/settings/billing)
- [Azure server notes](docs/AZURE-SERVER-STATUS.md)

## 11. Production acceptance checklist

- [ ] Repository access and ownership reviewed; private visibility enabled if confidentiality is required
- [ ] GitHub Actions can start jobs and the Azure OIDC identity is authorized
- [ ] Azure deployment completes with the expected Git SHA
- [ ] Application responds successfully over HTTPS
- [ ] A signed-in user can receive an actual Azure-generated Xavier reply
- [ ] Xavier demonstrates the Brotherhood Philosophy without pretending to have human emotions
- [ ] Invalid tokens, malformed input and service outages fail safely
- [ ] Entitlements, paid features and Stripe customer flows are validated
- [ ] Database RLS and vault access tested across separate accounts
- [ ] Monitoring, budgets, secrets rotation and rollback process confirmed
- [ ] Voice/vision functionality verified separately if enabled

## 12. Repository map

| Path | Role |
| --- | --- |
| `app/` | Next.js UI and API routes |
| `components/` | UI components |
| `lib/` | Shared business logic, AI integrations and policy modules |
| `lib/server/xavier-philosophy.ts` | Xavier's ethical and brotherhood behaviour guidance |
| `lib/server/azure-openai.ts` | Azure inference integration |
| `lib/compute/` | Compute fabric and early AEGIS work |
| `supabase/` | Database migrations and integration files |
| `deploy/azure/` | Azure deployment assets |
| `.github/workflows/` | Continuous integration and deployment |
| `tests/` | Automated verification |
| `docs/` | Topic-specific configuration and operational notes |
| `public/` | Static assets |

## 13. Security and contribution policy

This project is **not open source**. Do not assume permission to submit changes, redistribute assets, or reuse original code. External contributions must be approved by the owner, with appropriate written terms addressing rights and third-party materials.

Security reports should be shared privately with the repository owner. Never include secrets or exploitable customer data in public issues. Production AI permissions, authentication and billing decisions must be enforced on the server, not through UI hiding or prompt instructions alone.

## 14. Support and further documentation

For access or licensing requests, contact James Tane Hapurona at [trooperhaps@gmail.com](mailto:trooperhaps@gmail.com). Technical notes are in [`docs/`](docs/), including billing, daily essentials, Azure vision, voice subscriptions and deployment status. Some documents record historical experiments or incomplete migrations; verify them against current code and live infrastructure before acting.

---

**Copyright © 2026 James Tane Hapurona. All rights reserved for original materials.** See [LICENSE](LICENSE).
