import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { useT } from '@/i18n';

export default function NotFoundPage() {
  const t = useT();
  return (
    <EmptyState
      title={t('notFound.title')}
      description={t('notFound.description')}
      action={
        <Button asChild>
          <Link to="/">{t('notFound.home')}</Link>
        </Button>
      }
    />
  );
}
