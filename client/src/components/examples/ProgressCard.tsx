import { ProgressCard } from '../progress-card';
import { BookOpen } from 'lucide-react';

export default function ProgressCardExample() {
  return (
    <div className="w-80">
      <ProgressCard
        title="Transfer Credits"
        icon={BookOpen}
        value={45}
        total={90}
        label="ACE, Sophia, Study.com"
        variant="primary"
      />
    </div>
  );
}
