import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  CreditCard, 
  Download, 
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  DollarSign,
  FileText,
  ChevronRight,
  Receipt,
  Wallet,
  ArrowUpRight,
  Landmark,
  CalendarClock,
  X
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PaymentStatus = "paid" | "pending" | "overdue" | "scheduled";

interface Payment {
  id: string;
  date: string;
  dueDate: string;
  description: string;
  amount: number;
  status: PaymentStatus;
  method?: string;
}

interface PaymentBreakdown {
  label: string;
  amount: number;
  type: "charge" | "credit" | "total";
}

const statusConfig: Record<PaymentStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle2 }> = {
  paid: { 
    label: "Paid", 
    variant: "default", 
    icon: CheckCircle2 
  },
  pending: { 
    label: "Pending", 
    variant: "secondary", 
    icon: Clock 
  },
  overdue: { 
    label: "Overdue", 
    variant: "destructive", 
    icon: AlertCircle 
  },
  scheduled: { 
    label: "Scheduled", 
    variant: "outline", 
    icon: Calendar 
  },
};

const paymentHistory: Payment[] = [
  { 
    id: "pay-1", 
    date: "2024-11-01", 
    dueDate: "2024-11-01",
    description: "November 2024 - Lumiere Coaching", 
    amount: 1400, 
    status: "paid",
    method: "Visa ending in 4242"
  },
  { 
    id: "pay-2", 
    date: "2024-10-01", 
    dueDate: "2024-10-01",
    description: "October 2024 - Lumiere Coaching", 
    amount: 1400, 
    status: "paid",
    method: "Visa ending in 4242"
  },
  { 
    id: "pay-3", 
    date: "2024-09-01", 
    dueDate: "2024-09-01",
    description: "September 2024 - Lumiere Coaching", 
    amount: 1400, 
    status: "paid",
    method: "Visa ending in 4242"
  },
  { 
    id: "pay-4", 
    date: "2024-08-01", 
    dueDate: "2024-08-01",
    description: "August 2024 - Lumiere Coaching", 
    amount: 1400, 
    status: "paid",
    method: "ACH Transfer"
  },
  { 
    id: "pay-5", 
    date: "2024-07-15", 
    dueDate: "2024-07-15",
    description: "Sophia Subscription - Annual", 
    amount: 599, 
    status: "paid",
    method: "Visa ending in 4242"
  },
];

const upcomingPayments: Payment[] = [
  { 
    id: "upcoming-1", 
    date: "", 
    dueDate: "2024-12-01",
    description: "December 2024 - Lumiere Coaching", 
    amount: 1400, 
    status: "pending"
  },
  { 
    id: "upcoming-2", 
    date: "", 
    dueDate: "2025-01-01",
    description: "January 2025 - Lumiere Coaching", 
    amount: 1400, 
    status: "scheduled"
  },
  { 
    id: "upcoming-3", 
    date: "", 
    dueDate: "2025-02-01",
    description: "February 2025 - Lumiere Coaching", 
    amount: 1400, 
    status: "scheduled"
  },
  { 
    id: "upcoming-4", 
    date: "", 
    dueDate: "2025-07-15",
    description: "Sophia Subscription - Annual Renewal", 
    amount: 599, 
    status: "scheduled"
  },
];

const currentBreakdown: PaymentBreakdown[] = [
  { label: "Monthly Coaching Fee", amount: 1400, type: "charge" },
  { label: "Platform Access Fee", amount: 0, type: "charge" },
  { label: "Scholarship Credit", amount: -0, type: "credit" },
  { label: "Referral Credit", amount: -0, type: "credit" },
];

const programSummary = {
  totalPaid: 6199,
  totalRemaining: 12600,
  programTotal: 18799,
  monthsCompleted: 4,
  monthsRemaining: 9,
  nextPaymentDate: "December 1, 2024",
  nextPaymentAmount: 1400,
  paymentMethod: "Visa ending in 4242",
};

export default function Billing() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

  const handleDownloadInvoice = (payment: Payment) => {
    toast({
      title: "Download started",
      description: `Downloading invoice for ${payment.description}...`,
    });
  };

  const handleMakePayment = () => {
    toast({
      title: "Payment Portal",
      description: "Redirecting to secure payment portal...",
    });
  };

  const handleSetupAutoPay = () => {
    toast({
      title: "Auto-Pay Setup",
      description: "Opening auto-pay configuration...",
    });
  };

  const handlePaymentMethodSelect = (method: string) => {
    toast({
      title: "Payment Method",
      description: `Selected ${method} as payment method.`,
    });
  };

  const handleViewInvoice = (payment: Payment) => {
    setSelectedPayment(payment);
    setShowInvoicePreview(true);
  };

  const currentBalance = programSummary.nextPaymentAmount;
  const progressPercent = (programSummary.totalPaid / programSummary.programTotal) * 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your payments, view invoices, and track your program costs
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-current-balance">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Amount Due</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono" data-testid="text-balance">
              ${currentBalance.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Due {programSummary.nextPaymentDate}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-paid">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Paid</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-green-600 dark:text-green-400">
              ${programSummary.totalPaid.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {programSummary.monthsCompleted} months completed
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-remaining">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Remaining</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              ${programSummary.totalRemaining.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {programSummary.monthsRemaining} months remaining
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-payment-method">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payment Method</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">{programSummary.paymentMethod}</div>
            <Button 
              variant="ghost" 
              className="p-0 h-auto text-xs mt-1 text-primary" 
              data-testid="button-update-payment"
            >
              Update method
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Program Progress</span>
              <span className="font-medium">{progressPercent.toFixed(0)}% paid</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>${programSummary.totalPaid.toLocaleString()} paid</span>
              <span>${programSummary.programTotal.toLocaleString()} total</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Receipt className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <Clock className="h-4 w-4 mr-2" />
            Payment History
          </TabsTrigger>
          <TabsTrigger value="schedule" data-testid="tab-schedule">
            <CalendarClock className="h-4 w-4 mr-2" />
            Upcoming Payments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Current Invoice Breakdown</CardTitle>
                <CardDescription>December 2024 payment details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {currentBreakdown.map((item, index) => (
                  <div 
                    key={index} 
                    className={`flex justify-between py-2 ${
                      item.type === "total" ? "border-t font-semibold pt-4" : ""
                    }`}
                  >
                    <span className={item.type === "credit" ? "text-green-600 dark:text-green-400" : ""}>
                      {item.label}
                    </span>
                    <span className={`font-mono ${
                      item.type === "credit" ? "text-green-600 dark:text-green-400" : ""
                    }`}>
                      {item.amount < 0 ? "-" : ""}${Math.abs(item.amount).toLocaleString()}
                    </span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between font-semibold text-lg">
                  <span>Total Due</span>
                  <span className="font-mono">${currentBalance.toLocaleString()}</span>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button 
                  className="flex-1" 
                  onClick={handleMakePayment}
                  data-testid="button-make-payment"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Pay Now
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => handleViewInvoice(upcomingPayments[0])}
                  data-testid="button-view-invoice"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Invoice
                </Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
                <CardDescription>Choose how you want to pay</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start h-auto py-4"
                  onClick={() => handlePaymentMethodSelect("Credit Card")}
                  data-testid="button-method-card"
                >
                  <CreditCard className="h-5 w-5 mr-3 text-blue-600 dark:text-blue-400" />
                  <div className="text-left">
                    <p className="font-medium">Credit or Debit Card</p>
                    <p className="text-xs text-muted-foreground">Visa, Mastercard, American Express</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 ml-auto" />
                </Button>

                <Button 
                  variant="outline" 
                  className="w-full justify-start h-auto py-4"
                  onClick={() => handlePaymentMethodSelect("ACH Transfer")}
                  data-testid="button-method-ach"
                >
                  <Building2 className="h-5 w-5 mr-3 text-green-600 dark:text-green-400" />
                  <div className="text-left">
                    <p className="font-medium">ACH Bank Transfer</p>
                    <p className="text-xs text-muted-foreground">Direct debit from checking account</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 ml-auto" />
                </Button>

                <Button 
                  variant="outline" 
                  className="w-full justify-start h-auto py-4"
                  onClick={() => handlePaymentMethodSelect("Payment Plan")}
                  data-testid="button-method-plan"
                >
                  <Landmark className="h-5 w-5 mr-3 text-purple-600 dark:text-purple-400" />
                  <div className="text-left">
                    <p className="font-medium">Payment Plan</p>
                    <p className="text-xs text-muted-foreground">Split into smaller installments</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 ml-auto" />
                </Button>

                <Separator className="my-4" />

                <Button 
                  variant="secondary" 
                  className="w-full"
                  onClick={handleSetupAutoPay}
                  data-testid="button-setup-autopay"
                >
                  <CalendarClock className="h-4 w-4 mr-2" />
                  Set Up Auto-Pay
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>View and download past payment receipts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-4 text-sm font-semibold">Date</th>
                        <th className="text-left p-4 text-sm font-semibold">Description</th>
                        <th className="text-left p-4 text-sm font-semibold hidden md:table-cell">Method</th>
                        <th className="text-right p-4 text-sm font-semibold">Amount</th>
                        <th className="text-left p-4 text-sm font-semibold">Status</th>
                        <th className="text-right p-4 text-sm font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentHistory.map((payment) => {
                        const config = statusConfig[payment.status];
                        return (
                          <tr 
                            key={payment.id} 
                            className="border-b last:border-0 hover-elevate" 
                            data-testid={`row-payment-${payment.id}`}
                          >
                            <td className="p-4 font-mono text-sm">
                              {new Date(payment.date).toLocaleDateString()}
                            </td>
                            <td className="p-4">
                              <span className="font-medium">{payment.description}</span>
                            </td>
                            <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                              {payment.method}
                            </td>
                            <td className="p-4 text-right font-mono font-medium">
                              ${payment.amount.toLocaleString()}
                            </td>
                            <td className="p-4">
                              <Badge variant={config.variant}>
                                {config.label}
                              </Badge>
                            </td>
                            <td className="p-4">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleViewInvoice(payment)}
                                  data-testid={`button-view-${payment.id}`}
                                >
                                  <FileText className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDownloadInvoice(payment)}
                                  data-testid={`button-download-${payment.id}`}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Payments</CardTitle>
              <CardDescription>Your scheduled payment timeline</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {upcomingPayments.map((payment, index) => {
                  const config = statusConfig[payment.status];
                  const StatusIcon = config.icon;
                  const isNext = index === 0;

                  return (
                    <div 
                      key={payment.id}
                      className={`flex items-center gap-4 p-4 rounded-lg border ${
                        isNext ? "bg-primary/5 border-primary/20" : ""
                      }`}
                      data-testid={`card-upcoming-${payment.id}`}
                    >
                      <div className={`p-3 rounded-full ${
                        isNext ? "bg-primary/10" : "bg-muted"
                      }`}>
                        <StatusIcon className={`h-5 w-5 ${
                          isNext ? "text-primary" : "text-muted-foreground"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{payment.description}</p>
                          {isNext && <Badge>Next Payment</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Due {new Date(payment.dueDate).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "long",
                            day: "numeric"
                          })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold font-mono">
                          ${payment.amount.toLocaleString()}
                        </p>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </div>
                      {isNext && (
                        <Button onClick={handleMakePayment} data-testid={`button-pay-${payment.id}`}>
                          Pay Now
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showInvoicePreview && selectedPayment && (
        <div 
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowInvoicePreview(false)}
          data-testid="modal-invoice"
        >
          <Card 
            className="w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b pb-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Receipt className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Invoice</CardTitle>
                    <CardDescription>#{selectedPayment.id.toUpperCase()}</CardDescription>
                  </div>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setShowInvoicePreview(false)}
                data-testid="button-close-invoice"
              >
                <X className="h-5 w-5" />
              </Button>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Bill To</p>
                  <p className="font-medium">Mike Brown</p>
                  <p className="text-muted-foreground">jtex197@gmail.com</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground mb-1">Invoice Date</p>
                  <p className="font-medium">
                    {selectedPayment.date 
                      ? new Date(selectedPayment.date).toLocaleDateString()
                      : new Date(selectedPayment.dueDate).toLocaleDateString()
                    }
                  </p>
                  <p className="text-muted-foreground mt-2 mb-1">Due Date</p>
                  <p className="font-medium">
                    {new Date(selectedPayment.dueDate).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex justify-between py-2">
                  <span>{selectedPayment.description}</span>
                  <span className="font-mono">${selectedPayment.amount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-2 text-muted-foreground">
                  <span>Platform Fee</span>
                  <span className="font-mono">$0.00</span>
                </div>
                <Separator />
                <div className="flex justify-between py-2 text-lg font-bold">
                  <span>Total</span>
                  <span className="font-mono">${selectedPayment.amount.toLocaleString()}</span>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm font-medium mb-1">Payment Status</p>
                <div className="flex items-center gap-2">
                  <Badge variant={statusConfig[selectedPayment.status].variant}>
                    {statusConfig[selectedPayment.status].label}
                  </Badge>
                  {selectedPayment.method && (
                    <span className="text-sm text-muted-foreground">
                      via {selectedPayment.method}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="border-t pt-6 flex gap-2">
              <Button 
                className="flex-1"
                onClick={() => handleDownloadInvoice(selectedPayment)}
                data-testid="button-download-invoice-modal"
              >
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
              {selectedPayment.status === "pending" && (
                <Button 
                  variant="secondary"
                  className="flex-1"
                  onClick={handleMakePayment}
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Pay Now
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
