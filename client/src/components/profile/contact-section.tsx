import React, { useId, useState } from "react";
import { CircleDashed, Mail } from "lucide-react";
import type { PreferredContactChannel, ProfileContactInfo, StudentSelfServiceUpdate } from "@shared/student-profile-contract";
import { PREFERRED_CONTACT_CHANNELS } from "@shared/student-profile-contract";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useProfileActions } from "./profile-actions";
import {
  CHANNEL_LABELS,
  describeError,
  listTimezones,
  validatePhone,
  type FieldErrors,
} from "./profile-presentation";
import {
  EditButton,
  Fact,
  FactGrid,
  FormActions,
  FormError,
  ProfileSection,
  SavedIndicator,
  StatusChip,
  SubCard,
  TextField,
  TextLink,
  inputClass,
  useEditableCard,
} from "./profile-ui";

const NONE = "__none__";

function SwitchRow({
  label,
  help,
  checked,
  onChange,
  testId,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-h-[44px] items-start gap-3 py-1">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={help ? `${id}-help` : undefined}
        className="mt-0.5 data-[state=checked]:bg-student-seal data-[state=unchecked]:bg-student-line-strong"
        data-testid={testId}
      />
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium text-student-ink">{label}</Label>
        {help && <p id={`${id}-help`} className="text-xs text-student-muted">{help}</p>}
      </div>
    </div>
  );
}

const yesNo = (v: boolean) => (v ? "Yes" : "No");

// ---------------------------------------------------------------------------

function EmailCard({ contact }: { contact: ProfileContactInfo }) {
  return (
    <SubCard
      title="Sign-in email"
      testId="email-card"
      action={
        contact.emailVerified ? (
          <StatusChip label="Verified" tone="verified" testId="email-verified" />
        ) : (
          <StatusChip label="Not yet verified" tone="missing" testId="email-verified" />
        )
      }
    >
      <p className="flex items-center gap-2 break-all text-sm text-student-ink" data-testid="text-login-email">
        <Mail className="h-4 w-4 shrink-0 text-student-muted" aria-hidden="true" />
        {contact.email}
      </p>
      <p className="mt-2 text-sm text-student-muted">
        This is your sign-in email, so it cannot be edited here. To change it, contact support.
      </p>
      <TextLink href="/support" testId="link-change-email">Contact support</TextLink>
    </SubCard>
  );
}

function PhoneCard({ contact }: { contact: ProfileContactInfo }) {
  const actions = useProfileActions();
  const [primary, setPrimary] = useState(contact.phonePrimary ?? "");
  const [secondary, setSecondary] = useState(contact.phoneSecondary ?? "");
  const [whatsapp, setWhatsapp] = useState(contact.whatsappPrimary);
  const [errors, setErrors] = useState<FieldErrors>({});
  const card = useEditableCard(
    () =>
      actions.saveSelfService({
        phone_primary: primary.trim(),
        phone_secondary: secondary.trim() === "" ? null : secondary.trim(),
        whatsapp_primary: whatsapp,
      }),
    "Phone numbers saved",
  );

  function start() {
    setPrimary(contact.phonePrimary ?? "");
    setSecondary(contact.phoneSecondary ?? "");
    setWhatsapp(contact.whatsappPrimary);
    setErrors({});
    card.setError(null);
    card.setEditing(true);
  }
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    const p = validatePhone(primary, true);
    if (p) next.primary = p;
    const s = validatePhone(secondary, false);
    if (s) next.secondary = s;
    setErrors(next);
    if (Object.keys(next).length === 0) void card.submit(describeError);
  }

  return (
    <SubCard
      title="Phone numbers"
      testId="phone-card"
      action={
        card.editing ? null : (
          <div className="flex items-center gap-3">
            <SavedIndicator saved={card.saved} />
            <EditButton label="Edit phone numbers" onClick={start} testId="button-edit-phone" addText={contact.phonePrimary ? undefined : "Add phone"} />
          </div>
        )
      }
    >
      {card.editing ? (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <TextField label="Primary phone" required type="tel" inputMode="tel" autoComplete="tel" value={primary} onChange={setPrimary} error={errors.primary} testId="input-phone-primary" />
          <TextField label="Alternative phone" type="tel" inputMode="tel" autoComplete="tel" value={secondary} onChange={setSecondary} error={errors.secondary} hint="Optional" testId="input-phone-secondary" />
          <SwitchRow label="My primary phone is on WhatsApp" checked={whatsapp} onChange={setWhatsapp} testId="switch-whatsapp" />
          <FormError message={card.error} />
          <FormActions saving={card.saving} onCancel={() => card.setEditing(false)} />
        </form>
      ) : (
        <FactGrid>
          <Fact label="Primary phone" testId="fact-phone-primary" empty="Not provided yet" missing>{contact.phonePrimary}</Fact>
          <Fact label="Alternative phone" testId="fact-phone-secondary" empty="None added">{contact.phoneSecondary}</Fact>
          <Fact label="Primary phone on WhatsApp">{yesNo(contact.whatsappPrimary)}</Fact>
        </FactGrid>
      )}
    </SubCard>
  );
}

function AddressCard({ contact }: { contact: ProfileContactInfo }) {
  const actions = useProfileActions();
  const [line1, setLine1] = useState(contact.addressLine1 ?? "");
  const [line2, setLine2] = useState(contact.addressLine2 ?? "");
  const [city, setCity] = useState(contact.addressCity ?? "");
  const [state, setState] = useState(contact.addressState ?? "");
  const [postal, setPostal] = useState(contact.addressPostal ?? "");
  const [country, setCountry] = useState(contact.addressCountry ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const nullable = (v: string) => (v.trim() === "" ? null : v.trim());
  const card = useEditableCard(
    () =>
      actions.saveSelfService({
        address_line1: line1.trim(),
        address_line2: nullable(line2),
        address_city: nullable(city),
        address_state: nullable(state),
        address_postal: nullable(postal),
        address_country: country.trim(),
      }),
    "Address saved",
  );

  function start() {
    setLine1(contact.addressLine1 ?? "");
    setLine2(contact.addressLine2 ?? "");
    setCity(contact.addressCity ?? "");
    setState(contact.addressState ?? "");
    setPostal(contact.addressPostal ?? "");
    setCountry(contact.addressCountry ?? "");
    setErrors({});
    card.setError(null);
    card.setEditing(true);
  }
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next: FieldErrors = {};
    if (!line1.trim()) next.line1 = "Enter your street address";
    if (country.trim().length < 2) next.country = "Enter your country";
    if (postal.trim().length > 20) next.postal = "Use 20 characters or fewer";
    setErrors(next);
    if (Object.keys(next).length === 0) void card.submit(describeError);
  }
  const summary = [contact.addressLine1, contact.addressLine2, [contact.addressCity, contact.addressState, contact.addressPostal].filter(Boolean).join(", "), contact.addressCountry].filter(Boolean);

  return (
    <SubCard
      title="Mailing address"
      testId="address-card"
      action={
        card.editing ? null : (
          <div className="flex items-center gap-3">
            <SavedIndicator saved={card.saved} />
            <EditButton label="Edit mailing address" onClick={start} testId="button-edit-address" addText={summary.length ? undefined : "Add address"} />
          </div>
        )
      }
    >
      {card.editing ? (
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <TextField label="Address line 1" required autoComplete="address-line1" value={line1} onChange={setLine1} error={errors.line1} maxLength={160} testId="input-address-line1" />
          <TextField label="Address line 2" autoComplete="address-line2" value={line2} onChange={setLine2} maxLength={160} hint="Apartment, suite, unit (optional)" testId="input-address-line2" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="City" autoComplete="address-level2" value={city} onChange={setCity} maxLength={80} testId="input-address-city" />
            <TextField label="State or region" autoComplete="address-level1" value={state} onChange={setState} maxLength={80} testId="input-address-state" />
            <TextField label="Postal code" autoComplete="postal-code" value={postal} onChange={setPostal} error={errors.postal} maxLength={20} testId="input-address-postal" />
            <TextField label="Country" required autoComplete="country-name" value={country} onChange={setCountry} error={errors.country} maxLength={80} testId="input-address-country" />
          </div>
          <FormError message={card.error} />
          <FormActions saving={card.saving} onCancel={() => card.setEditing(false)} />
        </form>
      ) : summary.length ? (
        <address className="text-sm not-italic leading-relaxed text-student-ink" data-testid="text-address">
          {summary.map((l, i) => (
            <span key={i} className="block break-words">{l}</span>
          ))}
        </address>
      ) : (
        <p className="flex items-center gap-1.5 text-sm font-semibold text-student-attn" data-testid="text-address"><CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />No address on file yet.</p>
      )}
    </SubCard>
  );
}

function PreferencesCard({ contact }: { contact: ProfileContactInfo }) {
  const actions = useProfileActions();
  const [timezone, setTimezone] = useState(contact.timezone ?? NONE);
  const [channel, setChannel] = useState<PreferredContactChannel>(contact.preferredContactChannel);
  const [marketing, setMarketing] = useState(contact.marketingOptIn);
  const [media, setMedia] = useState(contact.mediaRelease);
  const tzId = useId();
  const chId = useId();
  const card = useEditableCard(() => {
    const update: StudentSelfServiceUpdate = {
      timezone: timezone === NONE ? null : timezone,
      preferred_contact_channel: channel,
      marketing_opt_in: marketing,
      media_release: media,
    };
    return actions.saveSelfService(update);
  }, "Preferences saved");

  function start() {
    setTimezone(contact.timezone ?? NONE);
    setChannel(contact.preferredContactChannel);
    setMarketing(contact.marketingOptIn);
    setMedia(contact.mediaRelease);
    card.setError(null);
    card.setEditing(true);
  }

  return (
    <SubCard
      title="Preferences"
      testId="preferences-card"
      action={
        card.editing ? null : (
          <div className="flex items-center gap-3">
            <SavedIndicator saved={card.saved} />
            <EditButton label="Edit preferences" onClick={start} testId="button-edit-preferences" />
          </div>
        )
      }
    >
      {card.editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void card.submit(describeError);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor={tzId} className="text-sm font-medium text-student-ink">Time zone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger id={tzId} className={cn(inputClass, "w-full")} data-testid="select-timezone">
                <SelectValue placeholder="Choose a time zone" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={NONE}>Not set</SelectItem>
                {listTimezones(contact.timezone).map((z) => (
                  <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={chId} className="text-sm font-medium text-student-ink">Preferred way to be contacted</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as PreferredContactChannel)}>
              <SelectTrigger id={chId} className={cn(inputClass, "w-full")} data-testid="select-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREFERRED_CONTACT_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SwitchRow label="Send me news and offers from Lumière" help="Optional. Program and account messages are always sent." checked={marketing} onChange={setMarketing} testId="switch-marketing" />
          <SwitchRow label="Media release" help="Allow Lumière to feature your name or photo in student stories. Optional." checked={media} onChange={setMedia} testId="switch-media" />
          <FormError message={card.error} />
          <FormActions saving={card.saving} onCancel={() => card.setEditing(false)} />
        </form>
      ) : (
        <FactGrid>
          <Fact label="Time zone" testId="fact-timezone" empty="Not set">{contact.timezone?.replace(/_/g, " ")}</Fact>
          <Fact label="Preferred contact" testId="fact-channel">{CHANNEL_LABELS[contact.preferredContactChannel]}</Fact>
          <Fact label="News and offers">{yesNo(contact.marketingOptIn)}</Fact>
          <Fact label="Media release">{yesNo(contact.mediaRelease)}</Fact>
        </FactGrid>
      )}
    </SubCard>
  );
}

export function ContactSection({ contact }: { contact: ProfileContactInfo }) {
  return (
    <ProfileSection
      id="contact"
      title="Contact Information"
      description="How Lumière reaches you. Keep your phone and address current so you never miss something important."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <EmailCard contact={contact} />
        <PhoneCard contact={contact} />
        <AddressCard contact={contact} />
        <PreferencesCard contact={contact} />
      </div>
    </ProfileSection>
  );
}

