import type { Metadata } from 'next';
import { XavierChat } from '@/components/xavier-chat';

export const metadata: Metadata = {
  title: 'Xavier AI | Planned Out',
  description: 'Xavier Intelligence: persistent AI chat, planning and reasoning inside Planned Out.',
};

export default function XavierPage() {
  return <>
    <aside style={{ padding: '10px 16px', fontSize: 13, borderBottom: '1px solid #64748b55' }}>
      ☢️ Security notice: Xavier records account activity and may record the IP address of AI requests to investigate suspected abuse, security incidents, and license violations. IP data is erased after 30 days. No chat messages are stored in these usage logs. An IP address does not prove a person's identity or wrongdoing.
    </aside>
    <XavierChat />
  </>;
}
