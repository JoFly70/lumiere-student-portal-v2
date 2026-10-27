import { useEffect, useId, useRef, useState } from 'react';
import { pt } from '@/components/profile/pt';
import { Camera, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/api';

interface ProfileAvatarUploadProps {
  photoUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  studentId?: string;
  onUploadSuccess?: (url: string) => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showUploadButton?: boolean;
}

export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp';
export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Client-side pre-check; the server remains the authority. Returns a message or null. */
export function validatePhotoFile(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return pt("Choose a PNG, JPEG or WEBP image.");
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return pt("That image is larger than 5 MB. Choose a smaller one.");
  }
  return null;
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
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const statusId = useId();
  const { toast } = useToast();

  // The server photo takes over once the profile refetches with the new URL.
  useEffect(() => {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  }, [photoUrl]);
  useEffect(() => () => {
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  }, []);

  const getInitials = () => {
    const first = firstName?.trim() || '';
    const last = lastName?.trim() || '';
    if (!first && !last) return '?';
    if (first && last) return `${first.charAt(0).toUpperCase()}${last.charAt(0).toUpperCase()}`;
    return (first || last).charAt(0).toUpperCase();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file || !studentId) return;
    setDone(false);

    const problem = validatePhotoFile(file);
    if (problem) {
      setError(problem);
      input.value = '';
      return;
    }

    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return objectUrl;
    });

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('photo', file);
      // Shared helper adds Authorization/CSRF; FormData keeps the browser-set multipart Content-Type.
      // It throws for any non-2xx response, so success below means the server accepted the photo.
      const data = await apiRequest<{ photoUrl?: string }>(
        `/api/students/${encodeURIComponent(studentId)}/photo`,
        { method: 'POST', body: formData, credentials: 'include' },
      );
      setDone(true);
      onUploadSuccess?.(data?.photoUrl ?? '');
      toast({ title: 'Photo updated', description: 'Your profile photo was saved.' });
    } catch (err) {
      // Roll the preview back: the server did not accept this photo.
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
      const raw = err instanceof Error ? err.message : '';
      setError(
        /413|too large/i.test(raw)
          ? pt("That image is larger than 5 MB. Choose a smaller one.")
          : raw && !/^HTTP \d+/.test(raw) && raw !== 'Request failed'
            ? raw
            : pt("We could not upload that photo. Check the file and try again."),
      );
    } finally {
      setUploading(false);
      input.value = '';
    }
  };

  const sizeClasses = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-12 w-12 text-sm',
    lg: 'h-16 w-16 text-lg',
    xl: 'h-24 w-24 text-2xl',
  };

  const hasPhoto = Boolean(photoUrl || preview);

  return (
    <div className="flex flex-col items-center gap-2">
      <Avatar className={`${sizeClasses[size]} ${uploading ? 'opacity-70' : ''}`} data-testid="avatar-profile">
        <AvatarImage src={preview || photoUrl || undefined} alt={hasPhoto ? 'Your profile photo' : ''} />
        <AvatarFallback className="bg-gold-soft text-gold-strong ring-1 ring-gold/40 font-semibold" aria-label="No profile photo yet">
          {getInitials()}
        </AvatarFallback>
      </Avatar>
      {showUploadButton && (
        <>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={handleFileChange}
            disabled={uploading}
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload profile photo"
            aria-describedby={statusId}
            data-testid="input-photo-upload"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || !studentId}
            aria-describedby={statusId}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline disabled:opacity-60"
            data-testid="button-photo-change"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="h-4 w-4" aria-hidden="true" data-testid="icon-upload" />
            )}
            {uploading ? pt("Uploading…") : hasPhoto ? pt("Replace photo") : pt("Add a photo")}
          </button>
          <div id={statusId} className="max-w-[14rem] text-center text-xs" aria-live="polite" role="status">
            {uploading ? (
              <span className="text-student-muted" data-testid="photo-uploading">
                {pt("Uploading your photo…")}
              </span>
            ) : error ? (
              <span role="alert" className="font-medium text-student-attn" data-testid="photo-error">
                {error}
              </span>
            ) : done ? (
              <span className="font-medium text-student-gold-ink" data-testid="photo-saved">
                {pt("Photo saved")}
              </span>
            ) : (
              <span className="text-student-muted">{pt("PNG, JPEG or WEBP, up to 5 MB")}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
