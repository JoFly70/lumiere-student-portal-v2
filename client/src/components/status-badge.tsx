import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "completed" | "in-progress" | "pending" | "paid" | "overdue";

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusConfig = {
  completed: { label: "Completed", className: "bg-st-applied-soft text-st-applied" },
  "in-progress": { label: "In Progress", className: "bg-st-progress-soft text-st-progress" },
  pending: { label: "Pending", className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  paid: { label: "Paid", className: "bg-st-applied-soft text-st-applied" },
  overdue: { label: "Overdue", className: "bg-st-attention-soft text-st-attention" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <Badge 
      variant="secondary" 
      className={cn(config.className, "font-medium", className)}
      data-testid={`badge-${status}`}
    >
      {config.label}
    </Badge>
  );
}
