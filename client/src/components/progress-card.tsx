import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";

interface ProgressCardProps {
  title: string;
  icon: LucideIcon;
  value: number;
  total: number;
  label?: string;
  variant?: "default" | "primary";
}

export function ProgressCard({ title, icon: Icon, value, total, label, variant = "default" }: ProgressCardProps) {
  const percentage = Math.round((value / total) * 100);
  
  return (
    <Card data-testid={`card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono" data-testid={`text-${title.toLowerCase().replace(/\s+/g, '-')}-value`}>
          {value}/{total}
        </div>
        {label && <p className="text-xs text-muted-foreground mt-1">{label}</p>}
        <ProgressBar value={percentage} variant={variant} className="mt-3" />
        <p className="text-xs text-muted-foreground mt-2">{percentage}% complete</p>
      </CardContent>
    </Card>
  );
}
