import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  useTickets,
  useTicket,
  useCreateTicket,
  useUpdateTicket,
  useCreateComment,
  useGenerateAttachmentUpload,
  useCreateAttachment,
  type CreateTicketInput,
} from "@/hooks/use-tickets";
import {
  Plus,
  Search,
  Clock,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  Send,
  Paperclip,
  X,
  Download,
  File,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusConfig = {
  open: {
    label: "Open",
    color: "text-blue-700 dark:text-blue-400",
    icon: Circle,
    bgColor: "bg-blue-100 dark:bg-blue-900/30"
  },
  in_progress: {
    label: "In Progress",
    color: "text-amber-700 dark:text-amber-400",
    icon: Loader2,
    bgColor: "bg-amber-100 dark:bg-amber-900/30"
  },
  waiting_on_student: {
    label: "Waiting on You",
    color: "text-purple-700 dark:text-purple-400",
    icon: Clock,
    bgColor: "bg-purple-100 dark:bg-purple-900/30"
  },
  resolved: {
    label: "Resolved",
    color: "text-green-700 dark:text-green-400",
    icon: CheckCircle2,
    bgColor: "bg-green-100 dark:bg-green-900/30"
  },
  closed: {
    label: "Closed",
    color: "text-gray-700 dark:text-gray-400",
    icon: CheckCircle2,
    bgColor: "bg-gray-100 dark:bg-gray-900/30"
  },
};

const priorityConfig = {
  low: { label: "Low", color: "text-slate-700 dark:text-slate-400", bgColor: "bg-slate-100 dark:bg-slate-900/30" },
  medium: { label: "Medium", color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  high: { label: "High", color: "text-orange-700 dark:text-orange-400", bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  urgent: { label: "Urgent", color: "text-red-700 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-900/30" },
};

const categoryConfig = {
  academic: { label: "Academic Advising" },
  technical: { label: "Technical Support" },
  billing: { label: "Billing Question" },
  document: { label: "Document Issue" },
  enrollment: { label: "Enrollment" },
  general: { label: "General Inquiry" },
};

export default function Support() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newComment, setNewComment] = useState("");

  const { data: ticketsData, isLoading } = useTickets({
    search: searchQuery || undefined,
    status: statusFilter,
  });

  const { data: ticketData } = useTicket(selectedTicketId);
  const createTicket = useCreateTicket();
  const createComment = useCreateComment(selectedTicketId || "");

  const [newTicket, setNewTicket] = useState<CreateTicketInput>({
    subject: "",
    description: "",
    category: "general",
    priority: "medium",
  });

  const handleCreateTicket = async () => {
    if (!newTicket.subject || !newTicket.description) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      await createTicket.mutateAsync(newTicket);
      toast({
        title: "Success",
        description: "Your ticket has been created successfully",
      });
      setCreateDialogOpen(false);
      setNewTicket({
        subject: "",
        description: "",
        category: "general",
        priority: "medium",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create ticket. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      await createComment.mutateAsync({ content: newComment });
      setNewComment("");
      toast({
        title: "Comment Added",
        description: "Your comment has been posted",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add comment",
        variant: "destructive",
      });
    }
  };

  const tickets = ticketsData?.tickets || [];
  const selectedTicket = ticketData?.ticket;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Support Center</h1>
          <p className="text-muted-foreground">
            Get help with your academic journey
          </p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Support Ticket</DialogTitle>
              <DialogDescription>
                Describe your issue and we'll get back to you as soon as possible
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={newTicket.subject}
                  onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                  placeholder="Brief description of your issue"
                />
              </div>

              <div>
                <Label htmlFor="category">Category</Label>
                <Select
                  value={newTicket.category}
                  onValueChange={(value: any) => setNewTicket({ ...newTicket, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={newTicket.priority}
                  onValueChange={(value: any) => setNewTicket({ ...newTicket, priority: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(priorityConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        {config.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={newTicket.description}
                  onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                  placeholder="Provide details about your issue..."
                  rows={6}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateTicket} disabled={createTicket.isPending}>
                {createTicket.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Ticket'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Search tickets..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="status-filter">Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="waiting_on_student">Waiting on Student</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Your Tickets</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tickets found
                </p>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {tickets.map((ticket) => {
                      const StatusIcon = statusConfig[ticket.status].icon;
                      return (
                        <Card
                          key={ticket.id}
                          className={`cursor-pointer transition-colors hover:bg-accent ${
                            selectedTicketId === ticket.id ? 'border-primary' : ''
                          }`}
                          onClick={() => setSelectedTicketId(ticket.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-mono text-muted-foreground">
                                    {ticket.ticket_number}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={priorityConfig[ticket.priority].bgColor}
                                  >
                                    <span className={priorityConfig[ticket.priority].color}>
                                      {priorityConfig[ticket.priority].label}
                                    </span>
                                  </Badge>
                                </div>
                                <h4 className="font-medium text-sm line-clamp-2">
                                  {ticket.subject}
                                </h4>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <StatusIcon className="w-3 h-3" />
                                  <span>{statusConfig[ticket.status].label}</span>
                                  <span>•</span>
                                  <Clock className="w-3 h-3" />
                                  <span>
                                    {formatDistanceToNow(new Date(ticket.updated_at), {
                                      addSuffix: true,
                                    })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {selectedTicket ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-muted-foreground">
                        {selectedTicket.ticket_number}
                      </span>
                      <Badge
                        variant="outline"
                        className={statusConfig[selectedTicket.status].bgColor}
                      >
                        <span className={statusConfig[selectedTicket.status].color}>
                          {statusConfig[selectedTicket.status].label}
                        </span>
                      </Badge>
                      <Badge
                        variant="outline"
                        className={priorityConfig[selectedTicket.priority].bgColor}
                      >
                        <span className={priorityConfig[selectedTicket.priority].color}>
                          {priorityConfig[selectedTicket.priority].label}
                        </span>
                      </Badge>
                    </div>
                    <CardTitle className="text-2xl">{selectedTicket.subject}</CardTitle>
                    <CardDescription>
                      {categoryConfig[selectedTicket.category].label} •{' '}
                      Created {formatDistanceToNow(new Date(selectedTicket.created_at), { addSuffix: true })}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-6">
                    {selectedTicket.ticket_comments?.map((comment) => (
                      <div key={comment.id} className="flex gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-medium">{comment.author_name}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(comment.created_at), {
                                addSuffix: true,
                              })}
                            </span>
                            {comment.is_internal && (
                              <Badge variant="secondary" className="text-xs">
                                Internal
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <Separator className="my-6" />

                <div className="space-y-4">
                  <Label htmlFor="new-comment">Add Comment</Label>
                  <Textarea
                    id="new-comment"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Type your message..."
                    rows={4}
                  />
                  <Button
                    onClick={handleAddComment}
                    disabled={!newComment.trim() || createComment.isPending}
                  >
                    {createComment.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Comment
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-20">
                <MessageSquare className="w-16 h-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Ticket Selected</h3>
                <p className="text-sm text-muted-foreground text-center max-w-md">
                  Select a ticket from the list to view details and add comments, or create a
                  new ticket to get started.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
