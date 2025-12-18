import { BookOpen, FileText, CreditCard, HelpCircle, LogOut, User, Gauge } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import lumiereLogo from "@assets/Lumiere Logo_1762534146530.webp";
import type { Student } from "@shared/schema";

async function fetchMyProfile(): Promise<Student | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Add auth token from sessionStorage
    const accessToken = sessionStorage.getItem('sb_access_token');
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const response = await fetch('/api/students/me', {
      credentials: 'include',
      headers,
    });
    
    if (!response.ok) {
      console.log('Failed to fetch profile:', response.status);
      return null;
    }
    return response.json();
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
}

const menuItems = [
  {
    title: "Flight Deck",
    url: "/flight-deck",
    icon: Gauge,
  },
  {
    title: "Student Profile",
    url: "/profile",
    icon: User,
  },
  {
    title: "Degree Roadmap",
    url: "/roadmap",
    icon: BookOpen,
  },
  {
    title: "Documents",
    url: "/documents",
    icon: FileText,
  },
  {
    title: "Billing",
    url: "/billing",
    icon: CreditCard,
  },
  {
    title: "Support",
    url: "/support",
    icon: HelpCircle,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  // Fetch student profile
  const { data: profile } = useQuery({
    queryKey: ['/api/students/me'],
    queryFn: fetchMyProfile,
    retry: false,
  });

  const displayName = profile 
    ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'User'
    : 'User';

  const displayEmail = profile?.email || '';

  return (
    <Sidebar>
      <SidebarHeader className="p-6">
        <div className="flex items-center gap-3">
          <img 
            src={lumiereLogo} 
            alt="Lumiere College Accelerator" 
            className="h-12 w-12 object-contain"
            data-testid="img-lumiere-logo"
          />
          <div>
            <h1 className="text-lg font-bold">Lumiere</h1>
            <p className="text-xs text-muted-foreground">Student Portal</p>
          </div>
        </div>
        
        <div className="mt-3 border-t border-sidebar-border"></div>
        <div 
          className="mt-2 px-3 py-2 flex items-center gap-3 rounded-xl hover-elevate transition-colors" 
          aria-label="User profile"
          data-testid="profile-user"
        >
          <ProfileAvatarUpload
            photoUrl={profile?.photo_url}
            firstName={profile?.first_name}
            lastName={profile?.last_name}
            size="md"
            showUploadButton={false}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate" data-testid="text-username">{displayName}</div>
            <div className="text-xs text-muted-foreground truncate" data-testid="text-email">{displayEmail}</div>
          </div>
        </div>
        
        <button
          onClick={() => {
            sessionStorage.clear();
            window.location.href = '/';
          }}
          className="mt-2 w-full px-3 py-2 flex items-center gap-2 text-sm rounded-xl hover-elevate transition-colors text-muted-foreground hover:text-foreground"
          data-testid="button-logout"
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </button>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-6">
        <p className="text-xs text-muted-foreground text-center">(c) 2025 Lumiere College</p>
      </SidebarFooter>
    </Sidebar>
  );
}
