import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_EMAIL_FROM;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!apiKey || !from || !url || !key) return Response.json({ error: 'Invitation email is not configured. Copy the invitation link instead.' }, { status: 503 });
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.inviteId !== 'string' || !/^[a-f\d-]{36}$/i.test(body.inviteId)) return Response.json({ error: 'Invalid invitation.' }, { status: 400 });
  const sb = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: identity, error: authError } = await sb.auth.getUser(token);
  if (authError || !identity.user) return Response.json({ error: 'Sign in again.' }, { status: 401 });
  const { data: invitation } = await sb.from('xp_calendar_invites').select('id,owner_id,invitee_email,calendar_name,invite_message,email_sent_at,expires_at').eq('id', body.inviteId).single();
  if (!invitation || invitation.owner_id !== identity.user.id || new Date(invitation.expires_at) <= new Date()) return Response.json({ error: 'Invitation unavailable.' }, { status: 403 });
  if (invitation.email_sent_at) return Response.json({ error: 'This invitation email was already sent. Copy its link if needed.' }, { status: 409 });
  const claimed = await sb.from('xp_calendar_invites').update({ email_sent_at: new Date().toISOString() }).eq('id', invitation.id).is('email_sent_at', null).select('id').maybeSingle();
  if (claimed.error || !claimed.data) return Response.json({ error: 'Invitation is being sent.' }, { status: 409 });
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const link = `${origin}/?calendarInvite=${encodeURIComponent(invitation.id)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [invitation.invitee_email], subject: `Invitation to ${invitation.calendar_name} on Planned Out`, text: `${invitation.invite_message ? `${invitation.invite_message}\n\n` : ''}You have been invited to ${invitation.calendar_name}. Sign in with ${invitation.invitee_email} to accept: ${link}` })
  });
  if (!response.ok) {
    await sb.from('xp_calendar_invites').update({ email_sent_at: null }).eq('id', invitation.id);
    return Response.json({ error: 'Email could not be delivered. Copy the invitation link instead.' }, { status: 502 });
  }
  return Response.json({ sent: true });
}
