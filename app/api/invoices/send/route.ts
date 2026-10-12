import { createClient } from '@supabase/supabase-js';
import { fetchBackendEntitlement } from '@/lib/server/backend-entitlement';

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' }[char] || char));
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number.isFinite(amount) ? amount : 0);
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVOICE_EMAIL_FROM || process.env.INVITE_EMAIL_FROM;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!apiKey || !from || !url || !key) return Response.json({ error: 'Invoice email is not configured yet. The invoice is still stored and can be printed or saved as PDF.' }, { status: 503 });

  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Sign in before sending invoices.' }, { status: 401 });
  const sb = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: identity, error: authError } = await sb.auth.getUser(token);
  if (authError || !identity.user) return Response.json({ error: 'Sign in again before sending invoices.' }, { status: 401 });

  let entitlement;
  try {
    entitlement = await fetchBackendEntitlement(token, AbortSignal.timeout(8_000));
  } catch {
    return Response.json({ error: 'Subscription verification is temporarily unavailable.' }, { status: 503 });
  }
  if (entitlement.plan === 'free') return Response.json({ error: 'Invoice sending requires a Pro or Business plan.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const invoice = body?.invoice;
  const data = invoice?.data || {};
  const recipient = String(data.recipientEmail || '').trim();
  if (!invoice || invoice.module !== 'invoice' || !invoice.title || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return Response.json({ error: 'A valid stored invoice and recipient email are required.' }, { status: 400 });
  if (String(invoice.title).length > 120 || String(invoice.body || '').length > 4000) return Response.json({ error: 'Invoice content is too large.' }, { status: 400 });
  if (data.ndis && entitlement.plan !== 'business') return Response.json({ error: 'NDIS invoicing requires a Business plan.' }, { status: 403 });

  const subject = `Invoice ${String(invoice.title).slice(0, 120)} from ${String(data.businessName || 'Planned Out').slice(0, 120)}`;
  const ndisBlock = data.ndis ? `<p><strong>NDIS number:</strong> ${escapeHtml(data.ndisNumber)}<br/><strong>Support item:</strong> ${escapeHtml(data.supportItem)}<br/><strong>Claim type:</strong> ${escapeHtml(data.claimType)}<br/><strong>Support category:</strong> ${escapeHtml(data.supportCategory)}</p>` : '';
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:760px;margin:auto"><h1>Invoice ${escapeHtml(invoice.title)}</h1><p><strong>${escapeHtml(data.businessName)}</strong><br/>ABN ${escapeHtml(data.abn)}</p><p><strong>Bill to:</strong> ${escapeHtml(data.customer)}</p><p>Invoice date: ${escapeHtml(data.invoiceDate || invoice.date)}<br/>Due date: ${escapeHtml(data.dueDate)}</p>${ndisBlock}<table style="width:100%;border-collapse:collapse"><tr><th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Description</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:8px">Qty</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:8px">Unit</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:8px">GST</th><th style="text-align:right;border-bottom:1px solid #ddd;padding:8px">Total</th></tr><tr><td style="padding:8px">${escapeHtml(invoice.body)}</td><td style="text-align:right;padding:8px">${escapeHtml(data.quantity)}</td><td style="text-align:right;padding:8px">${money(data.unitPrice)}</td><td style="text-align:right;padding:8px">${money(data.gst)}</td><td style="text-align:right;padding:8px"><strong>${money(invoice.amount)}</strong></td></tr></table><p style="text-align:right;font-size:20px"><strong>Total ${money(invoice.amount)}</strong></p><p>${escapeHtml(data.notes || '')}</p><p style="color:#666;font-size:12px">Sent securely from Xavier Planned Out.</p></body></html>`;
  const text = [`Invoice ${invoice.title}`, String(data.businessName || ''), data.abn ? `ABN ${data.abn}` : '', `Bill to: ${data.customer || ''}`, `Invoice date: ${data.invoiceDate || invoice.date}`, `Due: ${data.dueDate || ''}`, data.ndis ? `NDIS ${data.ndisNumber || ''} | Support item ${data.supportItem || ''} | Claim ${data.claimType || ''}` : '', `${invoice.body || ''}`, `Quantity: ${data.quantity || ''}`, `Unit: ${money(data.unitPrice)}`, `GST: ${money(data.gst)}`, `Total: ${money(invoice.amount)}`, String(data.notes || '')].filter(Boolean).join('\n');

  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [recipient], subject, html, text, reply_to: identity.user.email || undefined }) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    return Response.json({ error: typeof detail?.message === 'string' ? detail.message : 'Invoice email could not be delivered.' }, { status: 502 });
  }
  return Response.json({ sent: true });
}
