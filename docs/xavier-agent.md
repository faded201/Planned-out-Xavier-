# Xavier agent runner

The repository includes an operator-supervised Xavier runner for Node 22.13+ on
Windows and Linux, plus the production task-service/worker architecture documented
in xavier-agent-service.md. The direct runner remains useful for local maintenance
without using the web task queue.

Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT in the process environment.
The included Windows launcher reads those values from the existing Azure App
Service and retrieves the existing Azure OpenAI resource key through the signed-in
Azure CLI account. The key exists only in the process environment, is removed on
exit, and is filtered out of shell commands Xavier launches. Never commit it.
The Azure deployment must support Responses API function calling.

On the configured Windows computer, start with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\faded201\Planned-out-Xavier-\scripts\start-xavier-agent.ps1
```

Or provide a goal directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-xavier-agent.ps1 -Goal "Inspect this project and explain what prevents deployment"
```

The launcher installs no background service and creates no Azure resource. Azure
model requests use the already configured deployment and can consume its normal
inference quota/cost.

The runner lists and reads workspace files, proposes file writes, and executes
operator-approved commands. Each write and command requires typing yes in an
interactive terminal. Noninteractive runs deny those actions. Shell commands
have the operator's OS permissions and are not sandboxed; use a disposable
checkout or isolated VM for untrusted work. Commands can access files outside
the workspace. File tools reject escaping paths and symlinks, .git, .env files,
and task storage.

Task conversations and tool output persist in .xavier-agent, which is ignored by
Git. They can contain source code and sensitive output; protect the directory.
Tasks stop after 30 model rounds. Resume uses the saved conversation. Interrupted
actions require manual review and are never automatically replayed. Ctrl+C stops
the runner, but shell descendants may outlive it; this direct runner is not a
guaranteed process-tree kill switch.

For remotely submitted owner tasks, use the separate Windows worker under
scripts/agent-worker. That worker has lease-based cancellation, separate task
workspaces, explicit approval for writes/commands/browser changes, and a fresh
Playwright session for approved website origins. See xavier-agent-service.md for
server settings, worker pairing and acceptance tests.
