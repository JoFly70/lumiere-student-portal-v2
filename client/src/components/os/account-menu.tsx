/**
 * Circular account avatar at the top right of the student header (S21). Opens an account menu:
 * My Profile, Change Photo (the existing ProfileAvatarUpload flow) and Sign Out. On phones the language and theme
 * controls move into this menu so the header stays uncrowded.
 */
import React, { useState } from "react";
import { Link } from "wouter";
import { Camera, LogOut, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import { LanguageToggle } from "@/components/language-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { avatarInitials, safePhotoUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

void React;

export interface AccountIdentity {
  studentId?: string;
  firstName?: string | null;
  lastName?: string | null;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
}

export function AccountAvatar({ identity, className }: { identity: AccountIdentity; className?: string }) {
  const { t } = useT();
  const src = safePhotoUrl(identity.photoUrl);
  return (
    <Avatar className={cn("h-9 w-9 text-sm", className)} data-testid="header-avatar">
      {src ? <AvatarImage src={src} alt={t("acct.photoAlt")} /> : null}
      <AvatarFallback className="bg-student-gold-soft font-semibold text-student-gold-ink ring-1 ring-student-gold/40" data-testid="header-avatar-initials">
        {avatarInitials(identity.firstName, identity.lastName, identity.name, identity.email)}
      </AvatarFallback>
    </Avatar>
  );
}

const rowClass =
  "flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-student-ink hover:bg-student-gold-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

/** The menu body. Pure presentation so tests and the screenshot harness can render it without Radix state. */
export function AccountMenuPanel({
  identity, onNavigate, onChangePhoto, onSignOut, showPrefs = true,
}: {
  identity: AccountIdentity;
  onNavigate?: () => void;
  onChangePhoto?: () => void;
  onSignOut?: () => void;
  showPrefs?: boolean;
}) {
  const { t } = useT();
  return (
    <div data-testid="account-menu">
      <div className="flex items-center gap-3 px-3 pb-3 pt-2">
        <AccountAvatar identity={identity} className="h-11 w-11" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-student-ink" data-testid="account-menu-name">{identity.name}</p>
          {identity.email ? <p className="truncate text-xs text-student-muted" data-testid="account-menu-email">{identity.email}</p> : null}
        </div>
      </div>
      <div className="border-t border-student-line pt-1" role="group" aria-label={t("acct.menu")}>
        <Link href="/profile" onClick={onNavigate} className={rowClass} data-testid="account-menu-profile">
          <User aria-hidden="true" className="h-4 w-4 text-student-muted" />{t("acct.profile")}
        </Link>
        <button type="button" onClick={onChangePhoto} className={rowClass} disabled={!identity.studentId} data-testid="account-menu-photo">
          <Camera aria-hidden="true" className="h-4 w-4 text-student-muted" />{t("acct.photo")}
        </button>
        <button type="button" onClick={onSignOut} className={rowClass} data-testid="account-menu-signout">
          <LogOut aria-hidden="true" className="h-4 w-4 text-student-muted" />{t("acct.signOut")}
        </button>
      </div>
      {showPrefs && (
        <div className="mt-1 space-y-2 border-t border-student-line px-3 pb-1 pt-3 sm:hidden" data-testid="account-menu-prefs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{t("acct.language")}</span>
            <LanguageToggle />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-student-muted">{t("acct.theme")}</span>
            <ThemeToggle className="h-11 w-11" />
          </div>
        </div>
      )}
    </div>
  );
}

export function PhotoDialog({
  open, onOpenChange, identity, onChanged, title, description,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity: AccountIdentity;
  onChanged: () => void;
  title?: string;
  description?: string;
}) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="student-surface max-w-sm border-student-line bg-student-card text-student-ink" data-testid="photo-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">{title ?? t("acct.photo.title")}</DialogTitle>
          <DialogDescription className="text-student-muted">{description ?? t("acct.photo.desc")}</DialogDescription>
        </DialogHeader>
        <ProfileAvatarUpload
          photoUrl={identity.photoUrl}
          firstName={identity.firstName}
          lastName={identity.lastName}
          studentId={identity.studentId}
          onUploadSuccess={onChanged}
          size="xl"
          showUploadButton
        />
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mx-auto inline-flex min-h-[44px] items-center justify-center rounded-lg border border-student-line-strong px-5 text-sm font-medium text-student-ink hover:bg-student-gold-soft"
          data-testid="photo-dialog-done"
        >
          {t("acct.photo.done")}
        </button>
      </DialogContent>
    </Dialog>
  );
}

export function AccountMenu({ identity, onSignOut, onPhotoChanged }: { identity: AccountIdentity; onSignOut: () => void; onPhotoChanged: () => void }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={t("acct.open", { name: identity.name })}
            aria-haspopup="dialog"
            data-testid="button-account-menu"
          >
            <AccountAvatar identity={identity} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="student-surface w-[min(18rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto border-student-line bg-student-card p-1.5 shadow-lg"
          data-testid="account-popover"
        >
          <AccountMenuPanel
            identity={identity}
            onNavigate={() => setOpen(false)}
            onChangePhoto={() => { setOpen(false); setPhotoOpen(true); }}
            onSignOut={() => { setOpen(false); onSignOut(); }}
          />
        </PopoverContent>
      </Popover>
      <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} identity={identity} onChanged={onPhotoChanged} />
    </>
  );
}
