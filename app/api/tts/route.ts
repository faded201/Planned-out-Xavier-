import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function json(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const endpoint = (process.env.COSYVOICE_API_URL || '').trim();
  if (!endpoint) return json('CosyVoice 3 is not configured.', 503);

  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== 'https:') throw new Error('https required');
  } catch {
    return json('CosyVoice 3 endpoint is invalid.', 503);
  }

  let body: { text?: unknown; speaker?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return json('Invalid voice request.', 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4000) return json('Voice text must be 1-4000 characters.', 400);

  const speaker = typeof body.speaker === 'string' && body.speaker.trim()
    ? body.speaker.trim()
    : (process.env.COSYVOICE_SPEAKER || 'xavier_warm');
  const language = typeof body.language === 'string' && body.language.trim()
    ? body.language.trim()
    : (process.env.COSYVOICE_LANGUAGE || 'en');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = (process.env.COSYVOICE_API_KEY || '').trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, speaker, language, stream: false }),
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });

    if (!upstream.ok) {
      return json('CosyVoice 3 is temporarily unavailable.', upstream.status === 429 ? 429 : 502);
    }

    const contentType = upstream.headers.get('content-type') || 'audio/wav';
    if (!contentType.startsWith('audio/')) return json('CosyVoice 3 returned an invalid audio response.', 502);

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Xavier-Voice': 'CosyVoice-3',
      },
    });
  } catch {
    return json('CosyVoice 3 is temporarily unavailable.', 503);
  }
}
