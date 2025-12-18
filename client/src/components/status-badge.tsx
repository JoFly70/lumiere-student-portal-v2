import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status = "completed" | "in-progress" | "pending" | "paid" | "overdue";

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const statusConfig = {
  completed: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  "in-progress": { label: "In Progress", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  pending: { label: "Pending", className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300" },
  paid: { label: "Paid", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
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
