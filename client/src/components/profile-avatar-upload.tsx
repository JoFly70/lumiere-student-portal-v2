import { useState } from 'react';
import { Upload, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface ProfileAvatarUploadProps {
  photoUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  studentId?: string;
  onUploadSuccess?: (url: string) => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showUploadButton?: boolean;
}

export function ProfileAvatarUpload({
  photoUrl,
  firstName,
  lastName,
  studentId,
  onUploadSuccess,
  size = 'md',
  showUploadButton = false,
}: ProfileAvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const getInitials = () => {
    const first = firstName?.trim() || '';
    const last = lastName?.trim() || '';
    
    if (!first && !last) return '?';
    
    const firstInitial = first.charAt(0).toUpperCase();
    const lastInitial = last.charAt(0).toUpperCase();
    
    if (first && last) {
      return `${firstInitial}${lastInitial}`;
    }
    
    return firstInitial || lastInitial;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !studentId) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file',
        variant: 'destructive',
      });
      return;
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB',
        variant: 'destructive',
      });
      return;
    }

    try {
      setUploading(true);
      
      const formData = new FormData();
      formData.append('photo', file);

      const response = await fetch(`/api/students/${studentId}/photo`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      
      if (data?.photoUrl) {
        onUploadSuccess?.(data.photoUrl);
        toast({
          title: 'Success',
          description: 'Profile picture updated successfully',
        });
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload profile picture',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-12 w-12 text-sm',
    lg: 'h-16 w-16 text-lg',
    xl: 'h-24 w-24 text-2xl',
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <Avatar className={sizeClasses[size]} data-testid="avatar-profile">
          <AvatarImage src={photoUrl || undefined} alt="Profile picture" />
          <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
            {getInitials()}
          </AvatarFallback>
        </Avatar>
        {showUploadButton && (
          <label
            htmlFor="photo-upload"
            className="absolute -bottom-1 -right-1 cursor-pointer"
          >
            <div className="bg-primary text-primary-foreground rounded-full p-1.5 hover-elevate active-elevate-2 border-2 border-background">
              {uploading ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <Upload className="h-3 w-3" data-testid="icon-upload" />
              )}
            </div>
            <input
              id="photo-upload"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
              data-testid="input-photo-upload"
            />
          </label>
        )}
      </div>
    </div>
  );
}
