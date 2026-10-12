import type { Metadata } from 'next';
import { XavierChat } from '@/components/xavier-chat';

export const metadata: Metadata = {
  title: 'Xavier AI | Planned Out',
  description: 'Xavier Intelligence: persistent AI chat, planning and reasoning inside Planned Out.',
};

export default function XavierPage() {
  return <XavierChat />;
}
