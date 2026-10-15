# Agent tasks

The owner opens Agent tasks above Xavier chat, enters a goal, selects Windows or
cloud, and optionally enters exact HTTPS website origins. Windows is the default
because it is the worker currently intended for this installation. Tasks run
through an authenticated polling worker. Closing the page does not stop a worker.
Commands, file writes, browser clicks, and browser fills pause for approval.
Cancellation revokes the lease; workers poll it every five seconds and terminate
commands and browser sessions. A process that deliberately detaches or escapes
the worker process group may survive: run cloud workers in an isolated container.

## Server configuration

Use Node 22.13 or newer (node:sqlite is required). Configure these private Azure
App Service settings through Azure, never in tracked files:

- XAVIER_AGENT_DB: absolute persistent path, for example /home/xavier-agent/tasks.db.
- XAVIER_AGENT_WINDOWS_TOKEN: a unique cryptographically random token, at least 43 characters.
- XAVIER_AGENT_CLOUD_TOKEN: a different token if a cloud worker is later enabled.

The task API uses existing Supabase authentication and restricts access to the
same owner as the AI usage dashboard. Worker tokens authorize only their target.
The SQLite queue supports one App Service instance with local persistent storage.
Do not scale out or place SQLite on an unsupported network filesystem. Use a
transactional shared database before multi-instance deployment. Tasks and model
context persist until explicitly archived by the operator; set a retention policy
appropriate for your data. Do not expose or commit the database file.

## Workers

Each worker runs scripts/agent-worker/worker.mjs as a persistent process. Install
its dependencies in scripts/agent-worker with npm install, then run
npx playwright install chromium. Linux cloud hosts also need browser OS packages.
The included Dockerfile supplies those packages; run it non-root with Chromium
sandbox support. Do not disable the browser sandbox to work around host policy.

Set XAVIER_AGENT_SERVER to the HTTPS Xavier site, XAVIER_AGENT_WORKER_TOKEN to the
matching target token, XAVIER_AGENT_WORKSPACE to a dedicated directory, and
AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_DEPLOYMENT to the existing model settings.
For the Windows worker, start-windows-worker.ps1 uses the signed-in Azure CLI
account to retrieve the existing Azure OpenAI resource key into the worker process
only. It is never written to disk and KEY/TOKEN/SECRET/PASSWORD variables are
filtered from child-command environments. XAVIER_AZ_PATH can specify az.cmd.
Azure-hosted workers may instead use the App Service managed identity.

Start with node worker.mjs or use the Windows launcher. Use the host service
manager for restart on failure. The worker must run independently of Next.js
request handlers. These files do not provision a new paid Azure resource.

## Behavior and limits

Every task has a separate workspace, a 30 model-step limit, and a 1.5 MB context
limit. Shell execution is powerful and has worker OS permissions even though
its initial working directory is restricted; only approve commands you trust.
File tools reject path traversal and escaping symlinks. Browser origins are
explicitly allowed by the owner, resolved to public IPv4 addresses and pinned
for Chromium; private and IPv6 destinations are denied. Subrequests to unlisted
origins are blocked, so some websites need additional origins. Browser sessions
are fresh per call and do not share your signed-in personal browser. Multi-step
authenticated browser workflows and file download/upload are not supported yet.

Worker leases expire after two minutes without renewal. Interrupted jobs are
never automatically replayed because an external action may already have
occurred. Review activity and start a new goal after an interrupted job.

## Verification

Run npm run typecheck, npm test and npm run build. With a live worker, submit a
read-only goal, then a file-writing goal; ensure the file is absent before
approval and present after approval. Cancel a running task and confirm its lease
is rejected. Check that the tasks API denies anonymous and non-owner requests.
Validate the browser with an allowed public origin and confirm localhost, metadata
addresses and unlisted redirects are rejected. A passed build is not evidence of
a deployed or running worker.
