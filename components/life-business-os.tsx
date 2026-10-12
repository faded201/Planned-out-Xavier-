'use client';

import { useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { crmCategories, crmPresets } from '@/lib/crm-presets';
import type { ModuleName, ModuleRecord } from '@/lib/types';
import { planAccess, type AppPlan } from '@/lib/plan-access';

type Tab = 'overview' | 'tax' | 'invoices' | 'crm' | 'ndis';
type DataMap = Record<string, string | number | boolean>;

type Props = {
  records: ModuleRecord[];
  user: User | null;
  plan: AppPlan;
  onSave: (record: ModuleRecord) => Promise<void>;
  onRequestSignIn: () => void;
  onNotice: (message: string) => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value || 0);

function record(module: ModuleName, title: string, body: string, data: DataMap, amount?: number): ModuleRecord {
  return { id: uid(), module, title, body, date: today(), amount, category: module, status: 'active', tags: [], data, createdAt: now(), updatedAt: now() };
}

function parseList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return value.split(',').map((item) => item.trim()).filter(Boolean); }
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char));
}

export function LifeBusinessOS({ records, user, plan, onSave, onRequestSignIn, onNotice }: Props) {
  const access = planAccess[plan];
  const [tab, setTab] = useState<Tab>('overview');
  const [taxType, setTaxType] = useState('expense');
  const [taxTitle, setTaxTitle] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [taxGst, setTaxGst] = useState('');
  const [taxYear, setTaxYear] = useState('2026-27');
  const [taxCategory, setTaxCategory] = useState('General business');
  const [taxNotes, setTaxNotes] = useState('');

  const [invoice, setInvoice] = useState({
    number: `INV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-001`, businessName: '', abn: '', customer: '', email: '',
    date: today(), dueDate: today(), description: '', quantity: '1', unitPrice: '', gstRate: '0', notes: '', ndis: false,
    ndisNumber: '', participantAddress: '', supportItem: '', claimType: 'standard', supportCategory: '', managementType: 'self-managed'
  });

  const [crmQuery, setCrmQuery] = useState('');
  const [crmCategory, setCrmCategory] = useState('All');
  const [presetId, setPresetId] = useState('general-sales');
  const preset = crmPresets.find((item) => item.id === presetId) || crmPresets[0];
  const [schemaName, setSchemaName] = useState('');
  const [customFields, setCustomFields] = useState('');
  const [customStages, setCustomStages] = useState('');
  const [activeSchemaId, setActiveSchemaId] = useState('');
  const [crmValues, setCrmValues] = useState<Record<string, string>>({});

  const [ndis, setNdis] = useState({ participant: '', ndisNumber: '', dob: '', email: '', phone: '', address: '', managementType: 'self-managed', planManager: '',
    supportStart: today(), supportEnd: today(), supportCategory: '', supportItem: '', claimType: 'standard', quantity: '1', unitRate: '', gst: '0', serviceAgreement: '', supportLog: '', caseNotes: '' });

  const taxRecords = records.filter((item) => item.module === 'tax');
  const invoices = records.filter((item) => item.module === 'invoice');
  const schemas = records.filter((item) => item.module === 'crm-schema');
  const crmRecords = records.filter((item) => item.module === 'crm');
  const ndisRecords = records.filter((item) => item.module === 'ndis');
  const income = taxRecords.filter((item) => item.data.type === 'income').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expenses = taxRecords.filter((item) => item.data.type === 'expense').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const gstTracked = taxRecords.reduce((sum, item) => sum + Number(item.data.gst || 0), 0);
  const unpaid = invoices.filter((item) => !['paid', 'void'].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const filteredPresets = useMemo(() => crmPresets.filter((item) => {
    const q = crmQuery.trim().toLowerCase();
    return (crmCategory === 'All' || item.category === crmCategory) && (!q || [item.name, item.category, item.description, item.sourceSystem || ''].join(' ').toLowerCase().includes(q));
  }), [crmQuery, crmCategory]);

  const activeSchema = schemas.find((item) => item.id === activeSchemaId);
  const activeFields = activeSchema ? parseList(activeSchema.data.fieldsJson) : preset.fields;

  function openTab(next: Tab) {
    const required = next === 'tax' || next === 'invoices' ? 'Pro' : next === 'crm' || next === 'ndis' ? 'Business' : null;
    const allowed = next === 'overview' || (next === 'tax' && access.tax) || (next === 'invoices' && access.invoices) ||
      (next === 'crm' && access.crm) || (next === 'ndis' && access.ndis);
    if (!allowed) {
      onNotice(`${required} plan required for ${next === 'crm' ? 'CRM Universe' : next === 'ndis' ? 'NDIS Provider OS' : next === 'tax' ? 'Tax Centre' : 'Invoice Studio'}.`);
      return;
    }
    setTab(next);
  }


  async function saveTax(event: React.FormEvent) {
    event.preventDefault();
    if (!access.tax) return onNotice('Tax Centre requires a Pro or Business plan.');
    const amount = Number(taxAmount);
    if (!taxTitle.trim() || !Number.isFinite(amount) || amount <= 0) return onNotice('Add a description and valid tax amount.');
    const item = record('tax', taxTitle.trim(), taxNotes.trim(), { type: taxType, financialYear: taxYear, category: taxCategory, gst: Number(taxGst || 0), retentionTargetYears: 5 }, amount);
    item.category = taxCategory; item.status = 'recorded';
    await onSave(item); setTaxTitle(''); setTaxAmount(''); setTaxGst(''); setTaxNotes(''); onNotice('Tax record stored in Xavier.');
  }

  function invoiceTotals() {
    const subtotal = Math.max(0, Number(invoice.quantity || 0) * Number(invoice.unitPrice || 0));
    const gst = subtotal * Math.max(0, Number(invoice.gstRate || 0)) / 100;
    return { subtotal, gst, total: subtotal + gst };
  }

  async function saveInvoice(status = 'draft') {
    if (!access.invoices) { onNotice('Invoice Studio requires a Pro or Business plan.'); return null; }
    const totals = invoiceTotals();
    if (!invoice.businessName.trim() || !invoice.customer.trim() || !invoice.description.trim() || totals.total <= 0) { onNotice('Add business, customer, description and invoice amount first.'); return null; }
    if (invoice.ndis && (!invoice.ndisNumber.trim() || !invoice.supportItem.trim())) { onNotice('NDIS invoices need the participant NDIS number and support item number.'); return null; }
    const item = record('invoice', invoice.number, invoice.description, {
      businessName: invoice.businessName, abn: invoice.abn, customer: invoice.customer, recipientEmail: invoice.email, invoiceDate: invoice.date, dueDate: invoice.dueDate,
      quantity: Number(invoice.quantity || 0), unitPrice: Number(invoice.unitPrice || 0), subtotal: totals.subtotal, gst: totals.gst, gstRate: Number(invoice.gstRate || 0), notes: invoice.notes,
      ndis: invoice.ndis, ndisNumber: invoice.ndisNumber, participantAddress: invoice.participantAddress, supportItem: invoice.supportItem, claimType: invoice.claimType,
      supportCategory: invoice.supportCategory, managementType: invoice.managementType
    }, totals.total);
    item.category = invoice.ndis ? 'NDIS invoice' : 'invoice'; item.status = status;
    await onSave(item); onNotice(`Invoice ${invoice.number} saved as ${status}.`); return item;
  }

  async function sendInvoice() {
    if (!user) { onRequestSignIn(); onNotice('Sign in before sending invoices.'); return; }
    if (!invoice.email.trim()) { onNotice('Add the recipient email first.'); return; }
    const saved = await saveInvoice('draft'); if (!saved) return;
    const sb = getSupabase(); const session = sb ? await sb.auth.getSession() : null; const token = session?.data.session?.access_token;
    if (!token) { onRequestSignIn(); onNotice('Your session expired. Sign in again.'); return; }
    const response = await fetch('/api/invoices/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ invoice: saved }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { onNotice(payload.error || 'Invoice email could not be sent.'); return; }
    await onSave({ ...saved, status: 'sent', updatedAt: now(), data: { ...saved.data, sentAt: now() } });
    onNotice(`Invoice ${saved.title} sent and stored.`);
  }

  function printInvoice(item?: ModuleRecord) {
    const source = item || { ...record('invoice', invoice.number, invoice.description, { ...invoice, ...invoiceTotals() }, invoiceTotals().total), status: 'draft' };
    const data = source.data; const win = window.open('', '_blank', 'noopener,noreferrer'); if (!win) return onNotice('Allow pop-ups to print or save the invoice as PDF.');
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(source.title)}</title><style>body{font-family:Arial,sans-serif;max-width:850px;margin:40px auto;padding:24px;color:#111}h1{margin-bottom:4px}.row{display:flex;justify-content:space-between;gap:30px}.box{border:1px solid #ddd;padding:16px;margin:18px 0}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}.total{text-align:right;font-size:22px;font-weight:700}</style></head><body><h1>INVOICE</h1><p>${escapeHtml(source.title)}</p><div class="row"><div><b>${escapeHtml(data.businessName)}</b><br/>ABN ${escapeHtml(data.abn)}</div><div><b>Bill to</b><br/>${escapeHtml(data.customer)}<br/>${escapeHtml(data.recipientEmail)}</div></div><div class="box"><p>Date: ${escapeHtml(data.invoiceDate || source.date)} | Due: ${escapeHtml(data.dueDate)}</p>${data.ndis ? `<p>NDIS: ${escapeHtml(data.ndisNumber)} | Support item: ${escapeHtml(data.supportItem)} | Claim: ${escapeHtml(data.claimType)}</p>` : ''}</div><table><tr><th>Description</th><th>Qty</th><th>Unit</th><th>GST</th><th>Total</th></tr><tr><td>${escapeHtml(source.body)}</td><td>${escapeHtml(data.quantity)}</td><td>${money(Number(data.unitPrice || 0))}</td><td>${money(Number(data.gst || 0))}</td><td>${money(Number(source.amount || 0))}</td></tr></table><p class="total">Total ${money(Number(source.amount || 0))}</p><p>${escapeHtml(data.notes || '')}</p><script>window.print()</script></body></html>`);
    win.document.close();
  }

  async function createSchema() {
    if (!access.customCrm) return onNotice('Custom CRM Builder requires a Business plan.');
    const fields = (customFields.trim() ? customFields.split(',').map((item) => item.trim()).filter(Boolean) : preset.fields);
    const stages = (customStages.trim() ? customStages.split(',').map((item) => item.trim()).filter(Boolean) : preset.pipeline);
    const name = schemaName.trim() || preset.name;
    if (!name || fields.length === 0) return onNotice('Give the CRM a name and at least one field.');
    const item = record('crm-schema', name, preset.description, { presetId: preset.id, category: preset.category, sourceSystem: preset.sourceSystem || '', fieldsJson: JSON.stringify(fields), pipelineJson: JSON.stringify(stages), ndis: Boolean(preset.ndis) });
    item.category = preset.category; item.status = 'configured';
    await onSave(item); setActiveSchemaId(item.id); setSchemaName(''); setCustomFields(''); setCustomStages(''); setCrmValues({}); onNotice(`${name} CRM workspace created.`);
  }

  async function saveCrmRecord(event: React.FormEvent) {
    event.preventDefault(); if (!access.crm) return onNotice('CRM Universe requires a Business plan.'); const schema = activeSchema || null; const fields = schema ? parseList(schema.data.fieldsJson) : preset.fields;
    const title = crmValues[fields[0]]?.trim() || crmValues.Name?.trim() || crmValues['Contact name']?.trim();
    if (!title) return onNotice(`Add ${fields[0] || 'a name'} first.`);
    const item = record('crm', title, '', { schemaId: schema?.id || preset.id, schemaName: schema?.title || preset.name, fieldsJson: JSON.stringify(crmValues) });
    item.category = String(schema?.data.category || preset.category); item.status = 'active';
    await onSave(item); setCrmValues({}); onNotice(`${title} added to ${item.data.schemaName}.`);
  }

  async function saveNdis(event: React.FormEvent) {
    event.preventDefault(); if (!access.ndis) return onNotice('NDIS Provider OS requires a Business plan.'); const amount = Number(ndis.quantity || 0) * Number(ndis.unitRate || 0) + Number(ndis.gst || 0);
    if (!ndis.participant.trim() || !ndis.ndisNumber.trim() || !ndis.supportItem.trim() || amount <= 0) return onNotice('Participant, NDIS number, support item and a valid amount are required.');
    const item = record('ndis', ndis.participant, ndis.caseNotes, { ...ndis, quantity: Number(ndis.quantity || 0), unitRate: Number(ndis.unitRate || 0), gst: Number(ndis.gst || 0) }, amount);
    item.category = ndis.supportCategory || 'NDIS support'; item.status = 'delivered';
    await onSave(item); onNotice('NDIS support record stored.');
  }

  function ndisToInvoice(item: ModuleRecord) {
    setInvoice((current) => ({ ...current, customer: item.title, email: String(item.data.email || ''), description: String(item.data.caseNotes || item.body || item.data.supportCategory || 'NDIS support'), quantity: String(item.data.quantity || 1), unitPrice: String(item.data.unitRate || ''), gstRate: Number(item.data.gst || 0) > 0 ? '10' : '0', ndis: true, ndisNumber: String(item.data.ndisNumber || ''), participantAddress: String(item.data.address || ''), supportItem: String(item.data.supportItem || ''), claimType: String(item.data.claimType || 'standard'), supportCategory: String(item.data.supportCategory || ''), managementType: String(item.data.managementType || 'self-managed') }));
    setTab('invoices'); onNotice('NDIS support loaded into a new invoice draft.');
  }

  return <section className="page life-business-os">
    <div className="life-os-hero"><div><p className="eyebrow">XAVIER LIFE + BUSINESS OS</p><h2>Your calendar is now connected to the rest of life.</h2><p>Tax records, invoices, CRM, NDIS operations, clients, documents and future custom workflows live beside planning and Xavier AI.</p></div><div className="life-os-badges"><span>50 CRM presets</span><span>Invoice send + store</span><span>NDIS workflow</span><span>Custom CRM builder</span></div></div>
    <div className="life-os-tabs">{(['overview','tax','invoices','crm','ndis'] as Tab[]).map((item) => { const locked = (item === 'tax' && !access.tax) || (item === 'invoices' && !access.invoices) || (item === 'crm' && !access.crm) || (item === 'ndis' && !access.ndis); return <button key={item} className={`${tab === item ? 'active ' : ''}${locked ? 'locked' : ''}`} onClick={() => openTab(item)}>{item === 'overview' ? 'Life HQ' : item.toUpperCase()}{locked ? <small>{item === 'tax' || item === 'invoices' ? 'PRO' : 'BUSINESS'}</small> : null}</button>; })}</div>

    {tab === 'overview' && <div className="life-os-overview">
      <div className="stats"><div className="stat"><span>Tax income</span><strong>{money(income)}</strong><small>Recorded income</small></div><div className="stat"><span>Tax expenses</span><strong>{money(expenses)}</strong><small>Recorded expenses</small></div><div className="stat"><span>Unpaid invoices</span><strong>{money(unpaid)}</strong><small>{invoices.filter((item) => item.status !== 'paid').length} open</small></div><div className="stat"><span>CRM records</span><strong>{crmRecords.length}</strong><small>{schemas.length} workspaces</small></div><div className="stat"><span>NDIS records</span><strong>{ndisRecords.length}</strong><small>Delivery evidence</small></div></div>
      <div className="life-module-grid"><button className={!access.tax ? 'locked' : ''} onClick={() => openTab('tax')}><b>Tax Centre</b><span>Income, expenses, GST, BAS and evidence storage.</span><em>{access.tax ? 'OPEN' : 'PRO'}</em></button><button className={!access.invoices ? 'locked' : ''} onClick={() => openTab('invoices')}><b>Invoice Studio</b><span>Write, store, email, print and track invoices.</span><em>{access.invoices ? 'OPEN' : 'PRO'}</em></button><button className={!access.crm ? 'locked' : ''} onClick={() => openTab('crm')}><b>CRM Universe</b><span>50 presets plus user-built custom CRMs.</span><em>{access.crm ? 'OPEN' : 'BUSINESS'}</em></button><button className={!access.ndis ? 'locked' : ''} onClick={() => openTab('ndis')}><b>NDIS Provider OS</b><span>Participants, supports, support logs, claims and compliant invoice fields.</span><em>{access.ndis ? 'OPEN' : 'BUSINESS'}</em></button></div>
      <div className="life-os-note"><b>Built for Australian business workflows.</b><span>Xavier organises records and workflow. Tax, accounting and NDIS compliance decisions should still be checked against your accountant, bookkeeper or current NDIA guidance.</span></div>
    </div>}

    {tab === 'tax' && <div className="life-os-grid"><form className="life-os-card" onSubmit={saveTax}><h3>Tax record</h3><label>Type<select value={taxType} onChange={(e) => setTaxType(e.target.value)}><option value="income">Income</option><option value="expense">Expense</option><option value="asset">Asset purchase</option><option value="liability">Liability</option><option value="bas">BAS adjustment</option></select></label><label>Description<input value={taxTitle} onChange={(e) => setTaxTitle(e.target.value)} required /></label><div className="life-os-row"><label>Amount<input type="number" min="0" step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} /></label><label>GST component<input type="number" min="0" step="0.01" value={taxGst} onChange={(e) => setTaxGst(e.target.value)} /></label></div><div className="life-os-row"><label>Financial year<input value={taxYear} onChange={(e) => setTaxYear(e.target.value)} /></label><label>Category<input value={taxCategory} onChange={(e) => setTaxCategory(e.target.value)} /></label></div><label>Notes / evidence reference<textarea rows={4} value={taxNotes} onChange={(e) => setTaxNotes(e.target.value)} /></label><button className="primary">Store tax record</button></form><div className="life-os-card"><h3>Tax position</h3><div className="life-ledger"><span>Income <b>{money(income)}</b></span><span>Expenses <b>{money(expenses)}</b></span><span>Net before other adjustments <b>{money(income-expenses)}</b></span><span>GST tracked <b>{money(gstTracked)}</b></span></div><small>Records are organised with a five-year retention target. Confirm exact retention and tax treatment for your circumstances with the ATO or adviser.</small><h4>Recent records</h4>{taxRecords.slice(0,8).map((item) => <div className="life-row-card" key={item.id}><div><b>{item.title}</b><small>{String(item.data.financialYear || '')} · {item.category}</small></div><strong>{money(Number(item.amount || 0))}</strong></div>)}</div></div>}

    {tab === 'invoices' && <div className="life-os-grid"><div className="life-os-card"><h3>Invoice Studio</h3><div className="life-os-row"><label>Invoice number<input value={invoice.number} onChange={(e) => setInvoice({ ...invoice, number: e.target.value })} /></label><label>Invoice date<input type="date" value={invoice.date} onChange={(e) => setInvoice({ ...invoice, date: e.target.value })} /></label><label>Due date<input type="date" value={invoice.dueDate} onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })} /></label></div><div className="life-os-row"><label>Business name<input value={invoice.businessName} onChange={(e) => setInvoice({ ...invoice, businessName: e.target.value })} /></label><label>ABN<input value={invoice.abn} onChange={(e) => setInvoice({ ...invoice, abn: e.target.value })} /></label></div><div className="life-os-row"><label>Customer / participant<input value={invoice.customer} onChange={(e) => setInvoice({ ...invoice, customer: e.target.value })} /></label><label>Email<input type="email" value={invoice.email} onChange={(e) => setInvoice({ ...invoice, email: e.target.value })} /></label></div><label>Description<input value={invoice.description} onChange={(e) => setInvoice({ ...invoice, description: e.target.value })} /></label><div className="life-os-row"><label>Quantity / hours<input type="number" min="0" step="0.01" value={invoice.quantity} onChange={(e) => setInvoice({ ...invoice, quantity: e.target.value })} /></label><label>Unit price<input type="number" min="0" step="0.01" value={invoice.unitPrice} onChange={(e) => setInvoice({ ...invoice, unitPrice: e.target.value })} /></label><label>GST %<input type="number" min="0" step="0.01" value={invoice.gstRate} onChange={(e) => setInvoice({ ...invoice, gstRate: e.target.value })} /></label></div><label className="life-check"><input type="checkbox" checked={invoice.ndis} onChange={(e) => setInvoice({ ...invoice, ndis: e.target.checked })} /> NDIS invoice</label>{invoice.ndis && <div className="ndis-fields"><div className="life-os-row"><label>NDIS number<input value={invoice.ndisNumber} onChange={(e) => setInvoice({ ...invoice, ndisNumber: e.target.value })} /></label><label>Support item number<input value={invoice.supportItem} onChange={(e) => setInvoice({ ...invoice, supportItem: e.target.value })} /></label></div><div className="life-os-row"><label>Claim type<input value={invoice.claimType} onChange={(e) => setInvoice({ ...invoice, claimType: e.target.value })} /></label><label>Support category<input value={invoice.supportCategory} onChange={(e) => setInvoice({ ...invoice, supportCategory: e.target.value })} /></label><label>Management<select value={invoice.managementType} onChange={(e) => setInvoice({ ...invoice, managementType: e.target.value })}><option>self-managed</option><option>plan-managed</option><option>NDIA-managed</option></select></label></div><label>Participant address<input value={invoice.participantAddress} onChange={(e) => setInvoice({ ...invoice, participantAddress: e.target.value })} /></label></div>}<label>Notes<textarea rows={3} value={invoice.notes} onChange={(e) => setInvoice({ ...invoice, notes: e.target.value })} /></label><div className="invoice-total"><span>Subtotal {money(invoiceTotals().subtotal)}</span><span>GST {money(invoiceTotals().gst)}</span><b>Total {money(invoiceTotals().total)}</b></div><div className="life-actions"><button onClick={() => void saveInvoice('draft')}>Save draft</button><button onClick={() => printInvoice()}>Print / Save PDF</button><button className="primary" onClick={() => void sendInvoice()}>Send & store</button></div></div><div className="life-os-card"><h3>Invoice register</h3><p>{invoices.length} stored · {money(unpaid)} currently open</p>{invoices.slice(0,12).map((item) => <div className="life-row-card" key={item.id}><div><b>{item.title}</b><small>{String(item.data.customer || '')} · {item.status}</small></div><strong>{money(Number(item.amount || 0))}</strong><button onClick={() => printInvoice(item)}>Print</button></div>)}</div></div>}

    {tab === 'crm' && <div className="crm-workspace"><div className="life-os-card"><div className="crm-head"><div><h3>CRM Universe</h3><p>Choose one of 50 preset workflows or build your own.</p></div><b>{crmPresets.length} presets</b></div><div className="crm-filters"><input placeholder="Search CRM presets…" value={crmQuery} onChange={(e) => setCrmQuery(e.target.value)} /><select value={crmCategory} onChange={(e) => setCrmCategory(e.target.value)}><option>All</option>{crmCategories.map((item) => <option key={item}>{item}</option>)}</select></div><div className="crm-preset-grid">{filteredPresets.map((item) => <button key={item.id} className={presetId === item.id ? 'selected' : ''} onClick={() => { setPresetId(item.id); setSchemaName(item.id === 'custom' ? 'My Custom CRM' : item.name); setCustomFields(''); setCustomStages(''); }}><b>{item.name}</b><small>{item.category}{item.ndis ? ' · NDIS' : ''}</small><span>{item.description}</span></button>)}</div></div><div className="life-os-grid"><div className="life-os-card"><h3>Build workspace</h3><label>Name<input value={schemaName} onChange={(e) => setSchemaName(e.target.value)} placeholder={preset.name} /></label><label>Fields, comma separated<textarea rows={4} value={customFields} onChange={(e) => setCustomFields(e.target.value)} placeholder={preset.fields.join(', ')} /></label><label>Pipeline stages, comma separated<textarea rows={3} value={customStages} onChange={(e) => setCustomStages(e.target.value)} placeholder={preset.pipeline.join(', ')} /></label><button className="primary" onClick={() => void createSchema()}>Create CRM</button><small>Product names identify migration-style field layouts only. A preset does not connect to that vendor until an API connector is configured.</small></div><div className="life-os-card"><h3>Your CRM workspaces</h3>{schemas.length === 0 && <p>No custom workspaces yet. Pick a preset and create one.</p>}{schemas.map((item) => <button className={`schema-row ${activeSchemaId === item.id ? 'active' : ''}`} key={item.id} onClick={() => { setActiveSchemaId(item.id); setCrmValues({}); }}><div><b>{item.title}</b><small>{String(item.data.category || item.category)} · {parseList(item.data.fieldsJson).length} fields</small></div><span>Open</span></button>)}</div></div><form className="life-os-card crm-record-form" onSubmit={saveCrmRecord}><h3>Add record to {activeSchema?.title || preset.name}</h3><div className="dynamic-fields">{activeFields.map((field) => <label key={field}>{field}<input value={crmValues[field] || ''} onChange={(e) => setCrmValues((current) => ({ ...current, [field]: e.target.value }))} /></label>)}</div><button className="primary">Save CRM record</button></form><div className="life-os-card"><h3>Recent CRM records</h3>{crmRecords.slice(0,15).map((item) => <div className="life-row-card" key={item.id}><div><b>{item.title}</b><small>{String(item.data.schemaName || item.category)}</small></div><span>{item.status}</span></div>)}</div></div>}

    {tab === 'ndis' && <div className="life-os-grid"><form className="life-os-card" onSubmit={saveNdis}><h3>NDIS support record</h3><div className="life-os-row"><label>Participant name<input value={ndis.participant} onChange={(e) => setNdis({ ...ndis, participant: e.target.value })} /></label><label>NDIS number<input value={ndis.ndisNumber} onChange={(e) => setNdis({ ...ndis, ndisNumber: e.target.value })} /></label></div><div className="life-os-row"><label>Email<input value={ndis.email} onChange={(e) => setNdis({ ...ndis, email: e.target.value })} /></label><label>Phone<input value={ndis.phone} onChange={(e) => setNdis({ ...ndis, phone: e.target.value })} /></label><label>DOB<input type="date" value={ndis.dob} onChange={(e) => setNdis({ ...ndis, dob: e.target.value })} /></label></div><label>Address<input value={ndis.address} onChange={(e) => setNdis({ ...ndis, address: e.target.value })} /></label><div className="life-os-row"><label>Plan management<select value={ndis.managementType} onChange={(e) => setNdis({ ...ndis, managementType: e.target.value })}><option>self-managed</option><option>plan-managed</option><option>NDIA-managed</option></select></label><label>Plan manager<input value={ndis.planManager} onChange={(e) => setNdis({ ...ndis, planManager: e.target.value })} /></label></div><div className="life-os-row"><label>Support start<input type="date" value={ndis.supportStart} onChange={(e) => setNdis({ ...ndis, supportStart: e.target.value })} /></label><label>Support end<input type="date" value={ndis.supportEnd} onChange={(e) => setNdis({ ...ndis, supportEnd: e.target.value })} /></label></div><div className="life-os-row"><label>Support category<input value={ndis.supportCategory} onChange={(e) => setNdis({ ...ndis, supportCategory: e.target.value })} /></label><label>Support item number<input value={ndis.supportItem} onChange={(e) => setNdis({ ...ndis, supportItem: e.target.value })} /></label><label>Claim type<input value={ndis.claimType} onChange={(e) => setNdis({ ...ndis, claimType: e.target.value })} /></label></div><div className="life-os-row"><label>Quantity / hours<input type="number" min="0" step="0.01" value={ndis.quantity} onChange={(e) => setNdis({ ...ndis, quantity: e.target.value })} /></label><label>Unit rate<input type="number" min="0" step="0.01" value={ndis.unitRate} onChange={(e) => setNdis({ ...ndis, unitRate: e.target.value })} /></label><label>GST component<input type="number" min="0" step="0.01" value={ndis.gst} onChange={(e) => setNdis({ ...ndis, gst: e.target.value })} /></label></div><label>Service agreement reference<input value={ndis.serviceAgreement} onChange={(e) => setNdis({ ...ndis, serviceAgreement: e.target.value })} /></label><label>Support log / evidence<textarea rows={3} value={ndis.supportLog} onChange={(e) => setNdis({ ...ndis, supportLog: e.target.value })} /></label><label>Case notes<textarea rows={4} value={ndis.caseNotes} onChange={(e) => setNdis({ ...ndis, caseNotes: e.target.value })} /></label><button className="primary">Store support record</button></form><div className="life-os-card"><h3>NDIS compliance workspace</h3><ul className="ndis-checklist"><li>Participant name + NDIS number</li><li>Support delivery date(s)</li><li>Support type / category</li><li>Support item number</li><li>Quantity or hours + amount</li><li>Claim type</li><li>ABN on provider invoices</li><li>GST component where applicable</li><li>Support logs, service agreements, rosters and case notes</li></ul><small>Each NDIS invoice should be for one participant. Current NDIA guidance should be checked before claiming.</small><h4>Recent support records</h4>{ndisRecords.slice(0,10).map((item) => <div className="life-row-card" key={item.id}><div><b>{item.title}</b><small>{String(item.data.supportItem || '')} · {String(item.data.managementType || '')}</small></div><strong>{money(Number(item.amount || 0))}</strong><button onClick={() => ndisToInvoice(item)}>Invoice</button></div>)}</div></div>}
  </section>;
}
