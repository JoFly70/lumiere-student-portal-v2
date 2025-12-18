import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  GraduationCap,
  BookOpen,
  DollarSign,
  Activity,
  UserCog,
  TrendingUp,
  AlertCircle,
  Search,
  MoreHorizontal,
  Eye,
  Edit,
  Trash2,
  Download,
  Upload,
  Filter,
  Calendar,
  BarChart3
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { ProgramsManagement } from "@/components/programs-management";

// Types
interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

interface Student {
  id: string;
  student_code: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  residency: string;
  created_at: string;
}

interface Analytics {
  usersByRole: Record<string, number>;
  studentsByStatus: Record<string, number>;
  activeEnrollments: number;
  recentSignups: number;
  totalRevenue: number;
}

// Stats Card Component
function StatCard({
  title,
  value,
  icon: Icon,
  change,
  changeType
}: {
  title: string;
  value: string | number;
  icon: any;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold mt-2">{value}</p>
            {change && (
              <p className={`text-xs mt-2 flex items-center gap-1 ${
                changeType === 'positive' ? 'text-green-600' :
                changeType === 'negative' ? 'text-red-600' :
                'text-muted-foreground'
              }`}>
                <TrendingUp className={`w-3 h-3 ${changeType === 'negative' ? 'rotate-180' : ''}`} />
                {change}
              </p>
            )}
          </div>
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Dashboard Overview Tab
function DashboardOverview() {
  const { data: analytics, isLoading } = useQuery<{ analytics: Analytics }>({
    queryKey: ['/api/admin/analytics/dashboard'],
  });

  if (isLoading) {
    return <div className="text-center py-12">Loading analytics...</div>;
  }

  const stats = analytics?.analytics;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Students"
          value={stats?.studentsByStatus ? Object.values(stats.studentsByStatus).reduce((a, b) => a + b, 0) : 0}
          icon={GraduationCap}
          change="+12% from last month"
          changeType="positive"
        />
        <StatCard
          title="Active Enrollments"
          value={stats?.activeEnrollments || 0}
          icon={BookOpen}
          change="+8% from last month"
          changeType="positive"
        />
        <StatCard
          title="New Signups (30d)"
          value={stats?.recentSignups || 0}
          icon={Users}
          change="+23% from last month"
          changeType="positive"
        />
        <StatCard
          title="Revenue (30d)"
          value={`$${((stats?.totalRevenue || 0) / 100).toLocaleString()}`}
          icon={DollarSign}
          change="+15% from last month"
          changeType="positive"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Users by Role</CardTitle>
            <CardDescription>Distribution of user roles</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.usersByRole && Object.entries(stats.usersByRole).map(([role, count]) => (
                <div key={role} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      role === 'admin' ? 'bg-red-500' :
                      role === 'coach' ? 'bg-blue-500' :
                      role === 'staff' ? 'bg-green-500' :
                      'bg-gray-500'
                    }`} />
                    <span className="capitalize">{role}</span>
                  </div>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Students by Status</CardTitle>
            <CardDescription>Current student status distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.studentsByStatus && Object.entries(stats.studentsByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${
                      status === 'active' ? 'bg-green-500' :
                      status === 'lead' ? 'bg-yellow-500' :
                      status === 'paused' ? 'bg-orange-500' :
                      'bg-blue-500'
                    }`} />
                    <span className="capitalize">{status}</span>
                  </div>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest actions in the system</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Activity className="w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">New student enrollment</p>
                <p className="text-xs text-muted-foreground">John Doe enrolled in BUS-101</p>
              </div>
              <span className="text-xs text-muted-foreground">5m ago</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Activity className="w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">Payment received</p>
                <p className="text-xs text-muted-foreground">$500 from Sarah Smith</p>
              </div>
              <span className="text-xs text-muted-foreground">12m ago</span>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Activity className="w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">Document verified</p>
                <p className="text-xs text-muted-foreground">Transcript approved for Mike Johnson</p>
              </div>
              <span className="text-xs text-muted-foreground">1h ago</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// User Management Tab
function UserManagement() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ users: User[] }>({
    queryKey: ['/api/admin/users', { search, role: roleFilter !== 'all' ? roleFilter : undefined }],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "Role updated successfully" });
    },
  });

  if (isLoading) {
    return <div className="text-center py-12">Loading users...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users by name or email..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="student">Student</SelectItem>
            <SelectItem value="coach">Coach</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={
                      user.role === 'admin' ? 'destructive' :
                      user.role === 'coach' ? 'default' :
                      'secondary'
                    }>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <Select
                      value={user.role}
                      onValueChange={(role) => updateRoleMutation.mutate({ userId: user.id, role })}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">Student</SelectItem>
                        <SelectItem value="coach">Coach</SelectItem>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Student Management Tab
function StudentManagement() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading } = useQuery<{ students: Student[] }>({
    queryKey: ['/api/admin/students', { search, status: statusFilter !== 'all' ? statusFilter : undefined }],
  });

  if (isLoading) {
    return <div className="text-center py-12">Loading students...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search students..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="graduated">Graduated</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Residency</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.students.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="font-mono">{student.student_code}</TableCell>
                  <TableCell className="font-medium">
                    {student.first_name} {student.last_name}
                  </TableCell>
                  <TableCell>{student.email}</TableCell>
                  <TableCell>
                    <Badge variant={
                      student.status === 'active' ? 'default' :
                      student.status === 'lead' ? 'secondary' :
                      'outline'
                    }>
                      {student.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{student.residency}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Audit Logs Tab
function AuditLogs() {
  const [dateRange, setDateRange] = useState("7d");

  const { data, isLoading } = useQuery({
    queryKey: ['/api/admin/audit-logs', { limit: 100 }],
  });

  if (isLoading) {
    return <div className="text-center py-12">Loading audit logs...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1d">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline">
          <Filter className="w-4 h-4 mr-2" />
          Filter
        </Button>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity Log</CardTitle>
          <CardDescription>FERPA-compliant audit trail of all sensitive operations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data?.logs?.slice(0, 20).map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border">
                <div className={`w-2 h-2 rounded-full mt-1.5 ${
                  log.severity === 'critical' ? 'bg-red-500' :
                  log.severity === 'warning' ? 'bg-yellow-500' :
                  log.severity === 'info' ? 'bg-blue-500' :
                  'bg-gray-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{log.event_type}</code>
                    <Badge variant="outline" className="text-xs">{log.severity}</Badge>
                  </div>
                  <p className="text-sm mt-1">{log.action_description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(log.created_at).toLocaleString()}
                    {log.actor_user_id && ` • Actor: ${log.actor_user_id.substring(0, 8)}...`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Main Admin Dashboard
export default function Admin() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Comprehensive system management and analytics
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="overview">
            <BarChart3 className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="users">
            <Users className="w-4 h-4 mr-2" />
            Users
          </TabsTrigger>
          <TabsTrigger value="students">
            <GraduationCap className="w-4 h-4 mr-2" />
            Students
          </TabsTrigger>
          <TabsTrigger value="programs">
            <BookOpen className="w-4 h-4 mr-2" />
            Programs
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Activity className="w-4 h-4 mr-2" />
            Audit Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <DashboardOverview />
        </TabsContent>

        <TabsContent value="users">
          <UserManagement />
        </TabsContent>

        <TabsContent value="students">
          <StudentManagement />
        </TabsContent>

        <TabsContent value="programs">
          <ProgramsManagement />
        </TabsContent>

        <TabsContent value="logs">
          <AuditLogs />
        </TabsContent>
      </Tabs>
    </div>
  );
}
