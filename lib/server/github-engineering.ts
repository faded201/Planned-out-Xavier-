const API = 'https://api.github.com';
export const ENGINEERING_BRANCH = 'feature/planned-out-command-intelligence';

function config() {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  return token && repository ? { token, repository } : null;
}

export function safeEngineeringPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/^\/+/, '');
  if (!path || path.length > 500 || path.includes('..') || path.includes('\\')) return null;
  if (/(^|\/)(\.env[^/]*|.*secret.*|.*credential.*|.*token.*)$/i.test(path)) return null;
  return path;
}

async function gh(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'planned-out-ai-engineer',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

export async function readEngineeringFile(pathValue: unknown) {
  const cfg = config();
  if (!cfg) throw new Error('GitHub engineering bridge is not configured.');
  const path = safeEngineeringPath(pathValue);
  if (!path) throw new Error('Invalid or protected path.');

  const res = await gh(
    `/repos/${cfg.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ENGINEERING_BRANCH)}`,
    cfg.token,
  );
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}).`);
  const data = await res.json();
  if (data.type !== 'file' || typeof data.content !== 'string') throw new Error('Path is not a readable file.');
  return {
    path,
    sha: data.sha as string,
    content: Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8'),
  };
}

export async function writeEngineeringFile(pathValue: unknown, contentValue: unknown, messageValue: unknown) {
  const cfg = config();
  if (!cfg) throw new Error('GitHub engineering bridge is not configured.');
  const path = safeEngineeringPath(pathValue);
  if (!path) throw new Error('Invalid or protected path.');
  if (typeof contentValue !== 'string' || contentValue.length > 1_000_000) throw new Error('Invalid file content.');

  const existing = await gh(
    `/repos/${cfg.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ENGINEERING_BRANCH)}`,
    cfg.token,
  );
  let sha: string | undefined;
  if (existing.ok) {
    const data = await existing.json();
    if (data.type !== 'file') throw new Error('Target path is not a file.');
    sha = data.sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub preflight failed (${existing.status}).`);
  }

  const message =
    typeof messageValue === 'string' && messageValue.trim()
      ? messageValue.trim().slice(0, 200)
      : `AI engineering update: ${path}`;

  const res = await gh(
    `/repos/${cfg.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
    cfg.token,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: Buffer.from(contentValue, 'utf8').toString('base64'),
        branch: ENGINEERING_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `GitHub write failed (${res.status}).`);

  return {
    path,
    branch: ENGINEERING_BRANCH,
    commitSha: data?.commit?.sha as string | undefined,
    commitUrl: data?.commit?.html_url as string | undefined,
  };
}
