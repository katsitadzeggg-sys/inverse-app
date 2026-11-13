import { Card } from '@/components/ui';
import Chat from './chat';

export const metadata = { title: 'ასისტენტი' };

/** Questions about the company's own stocktakes, answered by AI from its data only. */
export default function AssistantPage() {
  return (
    <Card title="AI ასისტენტი">
      <p className="mb-3 text-sm text-ink-soft">
        ჰკითხე შენს ინვენტარიზაციებზე — პასუხი მხოლოდ შენი კომპანიის მონაცემებიდან მოდის. ასისტენტი
        მონაცემებს მხოლოდ კითხულობს, არაფერს ცვლის.
      </p>
      <Chat />
    </Card>
  );
}
