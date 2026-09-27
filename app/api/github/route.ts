import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const API = 'https://api.github.com';
const ALLOWED_BRANCH = 'feature/planned-out-command-intelligence';

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function safePath(value: unknown) {
  if (typeof value !== 'string') return null;
  const path = value.trim().replace(/^\/+/, '');
  if (!path || path.length > 500 || path.includes('..') || path.includes('\\')) return null;
  if (/^(?:\.env(?:\.|$)|.*(?:secret|credential|token).*)/i.test(path)) return null;
  return path;
}

async function requireUser(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!url || !key || !token) return null;

  const sb = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error: authError } = await sb.auth.getUser(token);
  return authError ? null : data.user;
}

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  return { token, repository };
}

async function github(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Planned-Out',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return error('Sign in first.', 401);
  const ownerId = process.env.GITHUB_BRIDGE_OWNER_ID?.trim();
  if (!ownerId) return error('GitHub owner access is not configured.', 503);
  if (user.id !== ownerId) return error('Owner access required.', 403);

  const cfg = config();
  if (!cfg) return error('GitHub bridge is not configured.', 503);

  const response = await github(`/repos/${cfg.repository}`, cfg.token);
  if (!response.ok) return error(`GitHub connection failed (${response.status}).`, 502);
  const repo = await response.json();

  return Response.json({
    connected: true,
    repository: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
  });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return error('Sign in first.', 401);
  const ownerId = process.env.GITHUB_BRIDGE_OWNER_ID?.trim();
  if (!ownerId) return error('GitHub owner access is not configured.', 503);
  if (user.id !== ownerId) return error('Owner access required.', 403);

  const cfg = config();
  if (!cfg) return error('GitHub bridge is not configured.', 503);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return error('Invalid request.', 400);

  if (body.action === 'read') {
    const path = safePath(body.path);
    if (!path) return error('Invalid or protected path.', 400);
    const branch = typeof body.branch === 'string' && body.branch.trim()
      ? body.branch.trim()
      : ALLOWED_BRANCH;

    const response = await github(
      `/repos/${cfg.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
      cfg.token,
    );
    if (!response.ok) return error(`GitHub read failed (${response.status}).`, response.status === 404 ? 404 : 502);
    const file = await response.json();
    if (file.type !== 'file' || typeof file.content !== 'string') return error('Path is not a file.', 400);

    return Response.json({
      path: file.path,
      sha: file.sha,
      branch,
      content: Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8'),
    });
  }

  if (body.action === 'write') {
    const path = safePath(body.path);
    if (!path) return error('Invalid or protected path.', 400);
    if (typeof body.content !== 'string' || body.content.length > 1_000_000) return error('Invalid file content.', 400);
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 200) {
      return error('A short commit message is required.', 400);
    }

    const branch = typeof body.branch === 'string' && body.branch.trim()
      ? body.branch.trim()
      : ALLOWED_BRANCH;
    if (branch !== ALLOWED_BRANCH) return error(`Writes are restricted to ${ALLOWED_BRANCH}.`, 403);

    let sha = typeof body.sha === 'string' ? body.sha : undefined;
    if (!sha) {
      const current = await github(
        `/repos/${cfg.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
        cfg.token,
      );
      if (current.ok) {
        const file = await current.json();
        if (file.type === 'file' && typeof file.sha === 'string') sha = file.sha;
      } else if (current.status !== 404) {
        return error(`Could not inspect existing file (${current.status}).`, 502);
      }
    }

    const response = await github(
      `/repos/${cfg.repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
      cfg.token,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body.message.trim(),
          content: Buffer.from(body.content, 'utf8').toString('base64'),
          branch,
          ...(sha ? { sha } : {}),
        }),
      },
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) return Response.json(
      { error: result?.message || `GitHub write failed (${response.status}).` },
      { status: response.status === 409 ? 409 : 502 },
    );

    return Response.json({
      written: true,
      path,
      branch,
      commit: result?.commit?.sha,
      sha: result?.content?.sha,
    });
  }

  return error('Unsupported GitHub action.', 400);
}
