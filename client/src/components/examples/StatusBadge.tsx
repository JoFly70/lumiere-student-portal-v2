import { StatusBadge } from '../status-badge';

export default function StatusBadgeExample() {
  return (
    <div className="flex gap-2 flex-wrap">
      <StatusBadge status="completed" />
      <StatusBadge status="in-progress" />
      <StatusBadge status="pending" />
      <StatusBadge status="paid" />
      <StatusBadge status="overdue" />
    </div>
  );
}
