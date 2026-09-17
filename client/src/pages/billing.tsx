import { CreditCard, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Billing() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Billing</h1>
        <p className="text-muted-foreground mt-1">
          View verified billing information for your Lumiere program.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-muted p-2">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Billing information is not connected yet</CardTitle>
              <CardDescription className="mt-1">
                Payment balances, history, and payment methods are intentionally hidden until they can be loaded from the canonical billing system.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              No sample transactions or estimated balances are shown. Contact Lumiere support if you need a current billing statement.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
