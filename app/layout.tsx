import type { Metadata } from 'next';
import './globals.css';
import './premium.css';
import './xavier-sphere.css';
import './consciousness.css';
import './business-os.css';

export const metadata: Metadata = {
  title: 'Xavier Planner OS Ultimate',
  description: 'Xavier life and business OS with AI, calendar, tax records, invoices, CRM, NDIS workflows, finance, health, travel and planning.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
