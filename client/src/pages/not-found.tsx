import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useT } from "@/i18n";

export default function NotFound() {
  const { t } = useT();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900">{t("common.notFound.title")}</h1>
          </div>

          <p className="mt-4 text-sm text-gray-600">{t("common.notFound.body")}</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t("common.notFound.home")}</Link>
        </CardContent>
      </Card>
    </div>
  );
}
