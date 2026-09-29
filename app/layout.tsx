import type { Metadata } from 'next';
import './globals.css';
import './premium.css';

export const metadata: Metadata = {
  title: 'Xavier Planner OS Ultimate',
  description: 'Life OS planner with AI, Supabase, attachments, knowledge, finance, health, travel, habits and analytics.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
