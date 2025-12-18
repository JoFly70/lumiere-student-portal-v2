import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Search, 
  Filter, 
  Paperclip, 
  Send, 
  Clock, 
  User, 
  MessageSquare, 
  ChevronDown, 
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  FileText,
  X,
  MoreHorizontal,
  Eye,
  Trash2,
  ArrowUpRight,
  Calendar,
  Tag
} from "lucide-react";

type TicketStatus = "open" | "in_progress" | "waiting" | "resolved";
type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketCategory = "academic" | "technical" | "billing" | "document" | "general";

interface TicketComment {
  id: string;
  author: string;
  authorRole: "student" | "support" | "admin";
  content: string;
  timestamp: string;
  isInternal?: boolean;
}

interface TicketAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  author: string;
  authorEmail: string;
  comments: TicketComment[];
  attachments: TicketAttachment[];
  statusHistory: { status: TicketStatus; timestamp: string; changedBy: string }[];
}

const statusConfig: Record<TicketStatus, { label: string; color: string; icon: any; bgColor: string }> = {
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
  waiting: { 
    label: "Waiting on Student", 
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
};

const priorityConfig: Record<TicketPriority, { label: string; color: string; bgColor: string }> = {
  low: { label: "Low", color: "text-slate-700 dark:text-slate-400", bgColor: "bg-slate-100 dark:bg-slate-900/30" },
  medium: { label: "Medium", color: "text-blue-700 dark:text-blue-400", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  high: { label: "High", color: "text-orange-700 dark:text-orange-400", bgColor: "bg-orange-100 dark:bg-orange-900/30" },
  urgent: { label: "Urgent", color: "text-red-700 dark:text-red-400", bgColor: "bg-red-100 dark:bg-red-900/30" },
};

const categoryConfig: Record<TicketCategory, { label: string; color: string }> = {
  academic: { label: "Academic Advising", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400" },
  technical: { label: "Technical Support", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400" },
  billing: { label: "Billing Question", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  document: { label: "Document Issue", color: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400" },
  general: { label: "General Inquiry", color: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400" },
};

const sampleTickets: Ticket[] = [
  {
    id: "1",
    ticketNumber: "LUM-001",
    subject: "Transfer credit evaluation request for Sophia courses",
    description: "I completed 5 courses on Sophia Learning and need them evaluated for transfer credit to UMPI. I've attached the official transcript. The courses are: Introduction to Business, Accounting I, Microeconomics, Macroeconomics, and Business Communication.",
    category: "academic",
    priority: "high",
    status: "in_progress",
    createdAt: "2024-11-20T09:30:00Z",
    updatedAt: "2024-11-25T14:15:00Z",
    author: "Mike Brown",
    authorEmail: "mike.brown@student.lumiere.app",
    comments: [
      {
        id: "c1",
        author: "Mike Brown",
        authorRole: "student",
        content: "I completed 5 courses on Sophia Learning and need them evaluated for transfer credit to UMPI. I've attached the official transcript.",
        timestamp: "2024-11-20T09:30:00Z"
      },
      {
        id: "c2",
        author: "Academic Advisor",
        authorRole: "support",
        content: "Thank you for submitting your Sophia transcript. I'm reviewing the courses now. Most of these should transfer as lower-level electives. I'll have the full evaluation ready within 48 hours.",
        timestamp: "2024-11-21T11:00:00Z"
      },
      {
        id: "c3",
        author: "Academic Advisor",
        authorRole: "support",
        content: "Update: 4 of 5 courses have been approved for transfer. The Business Communication course requires additional verification. I've requested the syllabus from Sophia.",
        timestamp: "2024-11-25T14:15:00Z",
        isInternal: false
      }
    ],
    attachments: [
      { id: "a1", name: "sophia_transcript.pdf", size: 245000, type: "application/pdf" }
    ],
    statusHistory: [
      { status: "open", timestamp: "2024-11-20T09:30:00Z", changedBy: "System" },
      { status: "in_progress", timestamp: "2024-11-21T10:00:00Z", changedBy: "Academic Advisor" }
    ]
  },
  {
    id: "2",
    ticketNumber: "LUM-002",
    subject: "Cannot access Study.com course materials",
    description: "I'm enrolled in Study.com Business Law course but getting an error when trying to access the video lectures. The error says 'Access Denied - Subscription Required' even though my subscription is active.",
    category: "technical",
    priority: "urgent",
    status: "waiting",
    createdAt: "2024-11-24T15:45:00Z",
    updatedAt: "2024-11-25T10:30:00Z",
    author: "Sarah Johnson",
    authorEmail: "sarah.j@student.lumiere.app",
    comments: [
      {
        id: "c4",
        author: "Sarah Johnson",
        authorRole: "student",
        content: "I'm getting 'Access Denied' errors on Study.com even though my subscription shows as active.",
        timestamp: "2024-11-24T15:45:00Z"
      },
      {
        id: "c5",
        author: "Tech Support",
        authorRole: "support",
        content: "I've checked your account and see the subscription is active. Can you please try clearing your browser cache and cookies, then logging in again? Also, which browser are you using?",
        timestamp: "2024-11-25T10:30:00Z"
      }
    ],
    attachments: [
      { id: "a2", name: "error_screenshot.png", size: 89000, type: "image/png" }
    ],
    statusHistory: [
      { status: "open", timestamp: "2024-11-24T15:45:00Z", changedBy: "System" },
      { status: "in_progress", timestamp: "2024-11-24T16:00:00Z", changedBy: "Tech Support" },
      { status: "waiting", timestamp: "2024-11-25T10:30:00Z", changedBy: "Tech Support" }
    ]
  },
  {
    id: "3",
    ticketNumber: "LUM-003",
    subject: "Payment plan options for spring semester",
    description: "I'd like to set up a payment plan for my spring semester tuition. What options are available and how do I enroll?",
    category: "billing",
    priority: "medium",
    status: "resolved",
    createdAt: "2024-11-18T11:20:00Z",
    updatedAt: "2024-11-19T09:45:00Z",
    author: "James Wilson",
    authorEmail: "james.w@student.lumiere.app",
    comments: [
      {
        id: "c6",
        author: "James Wilson",
        authorRole: "student",
        content: "I'd like to set up a payment plan for my spring semester tuition. What options are available?",
        timestamp: "2024-11-18T11:20:00Z"
      },
      {
        id: "c7",
        author: "Billing Team",
        authorRole: "support",
        content: "We offer 3 payment plan options: 3-month (no fee), 6-month (2% fee), or 12-month (5% fee). You can set this up in your Billing portal. I've enabled the payment plan options on your account. Let me know if you have any questions!",
        timestamp: "2024-11-19T09:45:00Z"
      }
    ],
    attachments: [],
    statusHistory: [
      { status: "open", timestamp: "2024-11-18T11:20:00Z", changedBy: "System" },
      { status: "in_progress", timestamp: "2024-11-19T09:00:00Z", changedBy: "Billing Team" },
      { status: "resolved", timestamp: "2024-11-19T09:45:00Z", changedBy: "Billing Team" }
    ]
  },
  {
    id: "4",
    ticketNumber: "LUM-004",
    subject: "WES credential evaluation taking too long",
    description: "I submitted my foreign credentials to WES for evaluation 8 weeks ago and still haven't received the report. UMPI enrollment deadline is approaching and I'm worried about delays.",
    category: "document",
    priority: "high",
    status: "open",
    createdAt: "2024-11-26T08:00:00Z",
    updatedAt: "2024-11-26T08:00:00Z",
    author: "Priya Sharma",
    authorEmail: "priya.s@student.lumiere.app",
    comments: [
      {
        id: "c8",
        author: "Priya Sharma",
        authorRole: "student",
        content: "My WES evaluation has been pending for 8 weeks. I submitted all documents on September 25th. Reference number: WES-2024-78542. The UMPI deadline for spring enrollment is December 15th.",
        timestamp: "2024-11-26T08:00:00Z"
      }
    ],
    attachments: [
      { id: "a3", name: "wes_receipt.pdf", size: 125000, type: "application/pdf" },
      { id: "a4", name: "original_transcript.pdf", size: 890000, type: "application/pdf" }
    ],
    statusHistory: [
      { status: "open", timestamp: "2024-11-26T08:00:00Z", changedBy: "System" }
    ]
  },
  {
    id: "5",
    ticketNumber: "LUM-005",
    subject: "Question about residency requirements",
    description: "I understand I need 30 credits from UMPI for residency. Does this include the capstone project? And can any of my Study.com courses count towards upper-level requirements?",
    category: "general",
    priority: "low",
    status: "resolved",
    createdAt: "2024-11-15T14:30:00Z",
    updatedAt: "2024-11-16T10:15:00Z",
    author: "David Chen",
    authorEmail: "david.c@student.lumiere.app",
    comments: [
      {
        id: "c9",
        author: "David Chen",
        authorRole: "student",
        content: "Quick question about UMPI residency - does the capstone count towards the 30 credits?",
        timestamp: "2024-11-15T14:30:00Z"
      },
      {
        id: "c10",
        author: "Academic Advisor",
        authorRole: "support",
        content: "Yes, the capstone project (3-6 credits depending on your program) counts towards your 30-credit residency requirement at UMPI. However, Study.com courses are considered transfer credits and cannot count towards the residency requirement or upper-level credits. You'll need to take upper-level courses directly through UMPI.",
        timestamp: "2024-11-16T10:15:00Z"
      }
    ],
    attachments: [],
    statusHistory: [
      { status: "open", timestamp: "2024-11-15T14:30:00Z", changedBy: "System" },
      { status: "resolved", timestamp: "2024-11-16T10:15:00Z", changedBy: "Academic Advisor" }
    ]
  }
];

function generateTicketId() {
  return `LUM-${String(Math.floor(Math.random() * 900) + 100).padStart(3, '0')}`;
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

function formatDateTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function TicketCard({ 
  ticket, 
  isExpanded, 
  onToggle, 
  onViewDetails 
}: { 
  ticket: Ticket; 
  isExpanded: boolean; 
  onToggle: () => void;
  onViewDetails: () => void;
}) {
  const statusInfo = statusConfig[ticket.status];
  const priorityInfo = priorityConfig[ticket.priority];
  const categoryInfo = categoryConfig[ticket.category];
  const StatusIcon = statusInfo.icon;

  return (
    <Card 
      className="hover-elevate transition-all cursor-pointer" 
      data-testid={`ticket-card-${ticket.ticketNumber}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <code className="text-sm font-mono text-muted-foreground" data-testid={`ticket-id-${ticket.ticketNumber}`}>
                {ticket.ticketNumber}
              </code>
              <Badge variant="secondary" className={`${statusInfo.bgColor} ${statusInfo.color}`}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {statusInfo.label}
              </Badge>
              <Badge variant="secondary" className={`${priorityInfo.bgColor} ${priorityInfo.color}`}>
                {priorityInfo.label}
              </Badge>
              <Badge variant="secondary" className={categoryInfo.color}>
                {categoryInfo.label}
              </Badge>
            </div>
            
            <h4 
              className="font-medium text-sm mb-1 truncate"
              data-testid={`ticket-subject-${ticket.ticketNumber}`}
            >
              {ticket.subject}
            </h4>
            
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {formatDate(ticket.createdAt)}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {ticket.comments.length} {ticket.comments.length === 1 ? 'comment' : 'comments'}
              </span>
              {ticket.attachments.length > 0 && (
                <span className="flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />
                  {ticket.attachments.length}
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
              data-testid={`button-view-${ticket.ticketNumber}`}
            >
              <Eye className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              data-testid={`button-expand-${ticket.ticketNumber}`}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        
        {isExpanded && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <p className="text-sm text-muted-foreground">{ticket.description}</p>
            
            {ticket.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {ticket.attachments.map(attachment => (
                  <Badge key={attachment.id} variant="outline" className="gap-1">
                    <FileText className="w-3 h-3" />
                    {attachment.name}
                    <span className="text-muted-foreground">({formatFileSize(attachment.size)})</span>
                  </Badge>
                ))}
              </div>
            )}
            
            <div className="flex gap-2">
              <Button size="sm" onClick={onViewDetails} data-testid={`button-details-${ticket.ticketNumber}`}>
                View Full Details
                <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TicketDetailModal({ 
  ticket, 
  isOpen, 
  onClose,
  isAdmin,
  onAddComment,
  onStatusChange
}: { 
  ticket: Ticket | null; 
  isOpen: boolean; 
  onClose: () => void;
  isAdmin: boolean;
  onAddComment: (ticketId: string, comment: string, isInternal: boolean) => void;
  onStatusChange: (ticketId: string, status: TicketStatus) => void;
}) {
  const [newComment, setNewComment] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const { toast } = useToast();

  if (!ticket) return null;

  const statusInfo = statusConfig[ticket.status];
  const priorityInfo = priorityConfig[ticket.priority];
  const categoryInfo = categoryConfig[ticket.category];

  const handleSubmitComment = () => {
    if (!newComment.trim()) return;
    onAddComment(ticket.id, newComment, isInternalNote);
    setNewComment("");
    setIsInternalNote(false);
    toast({
      title: isInternalNote ? "Internal note added" : "Comment added",
      description: "Your response has been posted.",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <code className="text-sm font-mono text-muted-foreground">{ticket.ticketNumber}</code>
                <Badge variant="secondary" className={categoryInfo.color}>
                  {categoryInfo.label}
                </Badge>
              </div>
              <DialogTitle className="text-xl">{ticket.subject}</DialogTitle>
              <DialogDescription className="mt-1">
                Created by {ticket.author} on {formatDateTime(ticket.createdAt)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 p-6 overflow-auto">
            <div className="space-y-4 mb-6">
              <div>
                <h4 className="text-sm font-medium mb-2">Description</h4>
                <p className="text-sm text-muted-foreground">{ticket.description}</p>
              </div>
              
              {ticket.attachments.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Attachments</h4>
                  <div className="flex flex-wrap gap-2">
                    {ticket.attachments.map(attachment => (
                      <Badge 
                        key={attachment.id} 
                        variant="outline" 
                        className="gap-1 cursor-pointer hover-elevate"
                        data-testid={`badge-attachment-${attachment.id}`}
                      >
                        <FileText className="w-3 h-3" />
                        {attachment.name}
                        <span className="text-muted-foreground">({formatFileSize(attachment.size)})</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <Separator className="my-6" />
            
            <div>
              <h4 className="text-sm font-medium mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Conversation ({ticket.comments.length})
              </h4>
              
              <div className="space-y-4">
                {ticket.comments.map(comment => (
                  <div 
                    key={comment.id} 
                    className={`p-4 rounded-lg ${
                      comment.isInternal 
                        ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' 
                        : comment.authorRole === 'student' 
                          ? 'bg-muted' 
                          : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          comment.authorRole === 'student' 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-blue-600 text-white'
                        }`}>
                          <User className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-sm font-medium">{comment.author}</span>
                          {comment.isInternal && (
                            <Badge variant="outline" className="ml-2 text-xs bg-amber-100 dark:bg-amber-900/50">
                              Internal Note
                            </Badge>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(comment.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm ml-10">{comment.content}</p>
                  </div>
                ))}
              </div>
              
              <div className="mt-6 space-y-3">
                <Textarea
                  placeholder="Add a comment or reply..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="min-h-[100px]"
                  data-testid="input-new-comment"
                />
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" data-testid="button-attach-file">
                      <Paperclip className="w-4 h-4 mr-1" />
                      Attach File
                    </Button>
                    
                    {isAdmin && (
                      <div className="flex items-center gap-2">
                        <Switch
                          id="internal-note"
                          checked={isInternalNote}
                          onCheckedChange={setIsInternalNote}
                          data-testid="switch-internal-note"
                        />
                        <Label htmlFor="internal-note" className="text-sm">Internal note</Label>
                      </div>
                    )}
                  </div>
                  
                  <Button 
                    onClick={handleSubmitComment}
                    disabled={!newComment.trim()}
                    data-testid="button-submit-comment"
                  >
                    <Send className="w-4 h-4 mr-1" />
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="w-72 border-l p-6 bg-muted/30 overflow-auto hidden lg:block">
            <h4 className="text-sm font-medium mb-4">Details</h4>
            
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={ticket.status} onValueChange={(val) => onStatusChange(ticket.id, val as TicketStatus)}>
                  <SelectTrigger className="mt-1" data-testid="select-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusConfig).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <config.icon className="w-3 h-3" />
                          {config.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <div className="mt-1">
                  <Badge variant="secondary" className={`${priorityInfo.bgColor} ${priorityInfo.color}`}>
                    {priorityInfo.label}
                  </Badge>
                </div>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground">Category</Label>
                <div className="mt-1">
                  <Badge variant="secondary" className={categoryInfo.color}>
                    {categoryInfo.label}
                  </Badge>
                </div>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground">Reporter</Label>
                <p className="text-sm mt-1">{ticket.author}</p>
                <p className="text-xs text-muted-foreground">{ticket.authorEmail}</p>
              </div>
              
              <div>
                <Label className="text-xs text-muted-foreground">Last Updated</Label>
                <p className="text-sm mt-1">{formatDateTime(ticket.updatedAt)}</p>
              </div>
              
              <Separator />
              
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">Status History</Label>
                <div className="space-y-2" data-testid="status-history-list">
                  {ticket.statusHistory.map((history, idx) => {
                    const historyStatus = statusConfig[history.status];
                    return (
                      <div 
                        key={idx} 
                        className="flex items-start gap-2 text-xs"
                        data-testid={`status-history-item-${idx}`}
                      >
                        <div className={`w-2 h-2 rounded-full mt-1.5 ${historyStatus.bgColor}`} />
                        <div>
                          <span className="font-medium">{historyStatus.label}</span>
                          <p className="text-muted-foreground">
                            {history.changedBy} - {formatDate(history.timestamp)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateTicketDialog({ 
  isOpen, 
  onClose, 
  onSubmit 
}: { 
  isOpen: boolean; 
  onClose: () => void;
  onSubmit: (ticket: Omit<Ticket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'comments' | 'statusHistory'>) => void;
}) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("general");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: TicketAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newAttachments.push({
        id: `att-${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        type: file.type
      });
    }
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSubmit = () => {
    if (!subject.trim() || !description.trim()) {
      toast({
        variant: "destructive",
        title: "Missing required fields",
        description: "Please provide a subject and description.",
      });
      return;
    }

    onSubmit({
      subject,
      description,
      category,
      priority,
      status: "open",
      author: "Mike Brown",
      authorEmail: "mike.brown@student.lumiere.app",
      attachments
    });

    setSubject("");
    setDescription("");
    setCategory("general");
    setPriority("medium");
    setAttachments([]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Support Ticket</DialogTitle>
          <DialogDescription>
            Submit a new request to our support team. We typically respond within 24-48 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select value={category} onValueChange={(val) => setCategory(val as TicketCategory)}>
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <div className="flex gap-2">
                {Object.entries(priorityConfig).map(([key, config]) => (
                  <Badge
                    key={key}
                    variant="secondary"
                    className={`cursor-pointer ${
                      priority === key 
                        ? `${config.bgColor} ${config.color} ring-2 ring-offset-2 ring-primary` 
                        : 'opacity-50 hover:opacity-80'
                    }`}
                    onClick={() => setPriority(key as TicketPriority)}
                    data-testid={`priority-${key}`}
                  >
                    {config.label}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="Brief summary of your issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="input-subject"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Please provide as much detail as possible about your issue..."
              className="min-h-[150px]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-description"
            />
          </div>

          <div className="space-y-2">
            <Label>Attachments</Label>
            <div className="border-2 border-dashed rounded-lg p-4">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-file-attachment"
              />
              
              {attachments.length > 0 ? (
                <div className="space-y-2">
                  {attachments.map(attachment => (
                    <div key={attachment.id} className="flex items-center justify-between p-2 bg-muted rounded">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        <span className="text-sm">{attachment.name}</span>
                        <span className="text-xs text-muted-foreground">({formatFileSize(attachment.size)})</span>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6"
                        onClick={() => removeAttachment(attachment.id)}
                        data-testid={`button-remove-attachment-${attachment.id}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-add-more-files"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add More
                  </Button>
                </div>
              ) : (
                <div 
                  className="text-center cursor-pointer py-4"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach-zone"
                >
                  <Paperclip className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Click to attach files or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, images, documents up to 10MB
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-ticket">Cancel</Button>
          <Button onClick={handleSubmit} data-testid="button-submit-ticket">
            <Send className="w-4 h-4 mr-1" />
            Submit Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Support() {
  const [tickets, setTickets] = useState<Ticket[]>(sampleTickets);
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "all">("all");
  const [filterCategory, setFilterCategory] = useState<TicketCategory | "all">("all");
  const [isAdminView, setIsAdminView] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const { toast } = useToast();

  const toggleExpanded = (ticketId: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) {
        next.delete(ticketId);
      } else {
        next.add(ticketId);
      }
      return next;
    });
  };

  const handleCreateTicket = (ticketData: Omit<Ticket, 'id' | 'ticketNumber' | 'createdAt' | 'updatedAt' | 'comments' | 'statusHistory'>) => {
    const now = new Date().toISOString();
    const newTicket: Ticket = {
      ...ticketData,
      id: String(Date.now()),
      ticketNumber: generateTicketId(),
      createdAt: now,
      updatedAt: now,
      comments: [{
        id: `c-${Date.now()}`,
        author: ticketData.author,
        authorRole: "student",
        content: ticketData.description,
        timestamp: now
      }],
      statusHistory: [{ status: "open", timestamp: now, changedBy: "System" }]
    };
    
    setTickets(prev => [newTicket, ...prev]);
    toast({
      title: "Ticket created",
      description: `Your ticket ${newTicket.ticketNumber} has been submitted.`,
    });
  };

  const handleAddComment = (ticketId: string, content: string, isInternal: boolean) => {
    const now = new Date().toISOString();
    setTickets(prev => prev.map(ticket => {
      if (ticket.id === ticketId) {
        return {
          ...ticket,
          updatedAt: now,
          comments: [...ticket.comments, {
            id: `c-${Date.now()}`,
            author: isAdminView ? "Support Team" : "Mike Brown",
            authorRole: isAdminView ? "support" : "student",
            content,
            timestamp: now,
            isInternal
          }]
        };
      }
      return ticket;
    }));
    
    if (selectedTicket?.id === ticketId) {
      setSelectedTicket(prev => prev ? {
        ...prev,
        updatedAt: now,
        comments: [...prev.comments, {
          id: `c-${Date.now()}`,
          author: isAdminView ? "Support Team" : "Mike Brown",
          authorRole: isAdminView ? "support" : "student",
          content,
          timestamp: now,
          isInternal
        }]
      } : null);
    }
  };

  const handleStatusChange = (ticketId: string, newStatus: TicketStatus) => {
    const now = new Date().toISOString();
    setTickets(prev => prev.map(ticket => {
      if (ticket.id === ticketId) {
        return {
          ...ticket,
          status: newStatus,
          updatedAt: now,
          statusHistory: [...ticket.statusHistory, {
            status: newStatus,
            timestamp: now,
            changedBy: isAdminView ? "Support Team" : "Mike Brown"
          }]
        };
      }
      return ticket;
    }));
    
    if (selectedTicket?.id === ticketId) {
      setSelectedTicket(prev => prev ? {
        ...prev,
        status: newStatus,
        updatedAt: now,
        statusHistory: [...prev.statusHistory, {
          status: newStatus,
          timestamp: now,
          changedBy: isAdminView ? "Support Team" : "Mike Brown"
        }]
      } : null);
    }
    
    toast({
      title: "Status updated",
      description: `Ticket status changed to ${statusConfig[newStatus].label}.`,
    });
  };

  const filteredTickets = tickets.filter(ticket => {
    if (filterStatus !== "all" && ticket.status !== filterStatus) return false;
    if (filterCategory !== "all" && ticket.category !== filterCategory) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return ticket.subject.toLowerCase().includes(query) ||
             ticket.ticketNumber.toLowerCase().includes(query) ||
             ticket.description.toLowerCase().includes(query);
    }
    return true;
  });

  const statusCounts = {
    open: tickets.filter(t => t.status === "open").length,
    in_progress: tickets.filter(t => t.status === "in_progress").length,
    waiting: tickets.filter(t => t.status === "waiting").length,
    resolved: tickets.filter(t => t.status === "resolved").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Student Support Center</h1>
          <p className="text-muted-foreground mt-1">
            Submit and track your support requests
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {isAdminView && (
            <Badge variant="outline" className="bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
              Admin View
            </Badge>
          )}
          <Button 
            onClick={() => setIsCreateDialogOpen(true)}
            data-testid="button-create-ticket"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Ticket
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {Object.entries(statusConfig).map(([key, config]) => {
          const StatusIcon = config.icon;
          const count = statusCounts[key as TicketStatus];
          return (
            <Card 
              key={key}
              className={`cursor-pointer hover-elevate ${filterStatus === key ? 'ring-2 ring-primary' : ''}`}
              onClick={() => setFilterStatus(filterStatus === key ? "all" : key as TicketStatus)}
              data-testid={`card-status-${key}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${config.bgColor}`}>
                      <StatusIcon className={`w-4 h-4 ${config.color}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">{config.label}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-lg">All Tickets</CardTitle>
            
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search tickets..."
                  className="pl-9 w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="input-search"
                />
              </div>
              
              <Select value={filterCategory} onValueChange={(val) => setFilterCategory(val as TicketCategory | "all")}>
                <SelectTrigger className="w-40" data-testid="filter-category">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {Object.entries(categoryConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 pl-3 border-l">
                <Switch
                  id="admin-mode"
                  checked={isAdminView}
                  onCheckedChange={setIsAdminView}
                  data-testid="switch-admin-mode"
                />
                <Label htmlFor="admin-mode" className="text-sm">Admin Mode</Label>
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent>
          {filteredTickets.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No tickets found</h3>
              <p className="text-muted-foreground mt-1">
                {searchQuery || filterStatus !== "all" || filterCategory !== "all"
                  ? "Try adjusting your filters"
                  : "Create your first support ticket to get started"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTickets.map(ticket => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  isExpanded={expandedTickets.has(ticket.id)}
                  onToggle={() => toggleExpanded(ticket.id)}
                  onViewDetails={() => setSelectedTicket(ticket)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateTicketDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onSubmit={handleCreateTicket}
      />

      <TicketDetailModal
        ticket={selectedTicket}
        isOpen={!!selectedTicket}
        onClose={() => setSelectedTicket(null)}
        isAdmin={isAdminView}
        onAddComment={handleAddComment}
        onStatusChange={handleStatusChange}
      />
    </div>
  );
}
