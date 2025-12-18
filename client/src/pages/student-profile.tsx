import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  Calendar, 
  Users, 
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  GraduationCap,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import type { Student, StudentContact, InsertStudentContact } from "@shared/schema";
import {
  residencyEnum,
  hsPathEnum,
  contactTypeEnum,
  insertStudentContactSchema,
} from "@shared/schema";

// Get current user's student profile
async function fetchMyProfile(): Promise<Student | null> {
  try {
    const response = await fetch('/api/students/me');
    if (!response.ok) {
      if (response.status === 404) {
        console.log('Student profile not found - user may not have a student record yet');
        return null;
      }
      throw new Error(`Failed to fetch profile: ${response.status}`);
    }
    const student = await response.json();
    return student;
  } catch (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
}

// Get student contacts
async function fetchContacts(studentId: string): Promise<StudentContact[]> {
  try {
    const response = await fetch(`/api/students/${studentId}/contacts`);
    if (!response.ok) return [];
    return response.json();
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return [];
  }
}

// Identity section form schema
const identityFormSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(80),
  middle_name: z.string().max(80).optional(),
  last_name: z.string().min(1, "Last name is required").max(80),
  preferred_name: z.string().max(80).optional(),
  dob: z.string().min(1, "Date of birth is required"),
  sex: z.string().optional(),
  nationality: z.array(z.string()).default([]),
  gov_id_type: z.string().optional(),
  gov_id_number: z.string().optional(),
});

// Contact section form schema
const contactFormSchema = z.object({
  email: z.string().email("Invalid email address"),
  phone_primary: z.string().min(1, "Primary phone is required"),
  phone_secondary: z.string().optional(),
  whatsapp_primary: z.boolean().default(false),
  timezone: z.string().optional(),
  preferred_contact_channel: z.string().default('email'),
  address_country: z.string().min(1, "Country is required"),
  address_state: z.string().optional(),
  address_city: z.string().optional(),
  address_postal: z.string().optional(),
  address_line1: z.string().min(1, "Address line 1 is required"),
  address_line2: z.string().optional(),
});

// Eligibility section form schema
const eligibilityFormSchema = z.object({
  residency: residencyEnum,
  hs_completion: z.boolean(),
  hs_path: hsPathEnum.nullable(),
  hs_country: z.string().optional(),
  hs_school: z.string().optional(),
  hs_year: z.preprocess(
    (val) => {
      // Convert empty string to null, otherwise convert to number
      if (val === "" || val === null || val === undefined) return null;
      const num = Number(val);
      // Return null if conversion results in NaN
      return isNaN(num) ? null : num;
    },
    z.number().int().min(1950).max(new Date().getFullYear() + 1).nullable().optional()
  ),
}).refine(
  (data) => {
    // If hs_completion is false, clear all HS details
    if (!data.hs_completion) {
      return true;
    }
    // If hs_completion is true, hs_path is recommended but not required
    return true;
  },
  {
    message: "Please provide high school details when completion is checked",
  }
);

export default function StudentProfile() {
  const { toast } = useToast();
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [editingEligibility, setEditingEligibility] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  // Fetch student profile
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['/api/students/me'],
    queryFn: fetchMyProfile,
  });

  // Fetch authorized contacts
  const { data: contacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ['/api/students', profile?.id, 'contacts'],
    queryFn: () => profile ? fetchContacts(profile.id) : Promise.resolve([]),
    enabled: !!profile?.id,
  });

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="text-lg font-medium">Loading profile...</div>
          <p className="text-sm text-muted-foreground mt-2">Please wait</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <div className="text-lg font-medium">No Profile Found</div>
          <p className="text-sm text-muted-foreground mt-2">
            Please contact support to create your student profile.
          </p>
        </div>
      </div>
    );
  }

  const handlePhotoUploadSuccess = (photoUrl: string) => {
    // Invalidate query to refresh profile everywhere (main avatar + sidebar)
    queryClient.invalidateQueries({ queryKey: ['/api/students/me'] });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6" data-testid="page-student-profile">
      {/* Page Header */}
      <div className="flex items-center gap-6">
        <ProfileAvatarUpload
          photoUrl={profile.photo_url}
          firstName={profile.first_name}
          lastName={profile.last_name}
          studentId={profile.id}
          onUploadSuccess={handlePhotoUploadSuccess}
          size="xl"
          showUploadButton={true}
        />
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-profile-name">
            {profile.first_name} {profile.last_name}
          </h1>
          <p className="text-muted-foreground text-lg" data-testid="text-student-code">
            Student ID: {profile.student_code}
          </p>
        </div>
      </div>

      {/* Identity Section */}
      <IdentitySection 
        profile={profile}
        isEditing={editingIdentity}
        onEdit={() => setEditingIdentity(true)}
        onCancel={() => setEditingIdentity(false)}
        onSave={() => setEditingIdentity(false)}
      />

      {/* Contact Information Section */}
      <ContactSection 
        profile={profile}
        isEditing={editingContact}
        onEdit={() => setEditingContact(true)}
        onCancel={() => setEditingContact(false)}
        onSave={() => setEditingContact(false)}
      />

      {/* Eligibility Section */}
      <EligibilitySection 
        profile={profile}
        isEditing={editingEligibility}
        onEdit={() => setEditingEligibility(true)}
        onCancel={() => setEditingEligibility(false)}
        onSave={() => setEditingEligibility(false)}
      />

      {/* Authorized Contacts Section */}
      <AuthorizedContactsSection 
        studentId={profile.id}
        contacts={contacts}
        isLoading={contactsLoading}
        isAdding={addingContact}
        onAdd={() => setAddingContact(true)}
        onCancelAdd={() => setAddingContact(false)}
      />
    </div>
  );
}

// Identity Section Component
function IdentitySection({ 
  profile, 
  isEditing, 
  onEdit, 
  onCancel, 
  onSave 
}: { 
  profile: Student;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof identityFormSchema>>({
    resolver: zodResolver(identityFormSchema),
    defaultValues: {
      first_name: profile.first_name,
      middle_name: profile.middle_name || "",
      last_name: profile.last_name,
      preferred_name: profile.preferred_name || "",
      dob: profile.dob,
      sex: profile.sex || "",
      nationality: profile.nationality || [],
      gov_id_type: profile.gov_id_type || "",
      gov_id_number: profile.gov_id_number || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof identityFormSchema>) => {
      return apiRequest('PUT', `/api/students/${profile.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/me'] });
      toast({
        title: "Profile updated",
        description: "Your identity information has been saved successfully.",
      });
      onSave();
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return (
    <Card data-testid="card-identity-section">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Identity
          </CardTitle>
          <CardDescription>Your personal identification information</CardDescription>
        </div>
        {!isEditing && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={onEdit}
            data-testid="button-edit-identity"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="first_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="middle_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Middle Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-middle-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name *</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="preferred_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred Name</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-preferred-name" />
                      </FormControl>
                      <FormDescription>How you'd like to be addressed</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dob"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date of Birth *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-dob" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sex"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sex</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-sex">
                            <SelectValue placeholder="Select sex" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="M">Male</SelectItem>
                          <SelectItem value="F">Female</SelectItem>
                          <SelectItem value="X">Non-binary / Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gov_id_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Government ID Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-gov-id-type">
                            <SelectValue placeholder="Select ID type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="passport">Passport</SelectItem>
                          <SelectItem value="national_id">National ID</SelectItem>
                          <SelectItem value="drivers_license">Driver's License</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="gov_id_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Government ID Number</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-gov-id-number" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    form.reset();
                    onCancel();
                  }}
                  disabled={updateMutation.isPending}
                  data-testid="button-cancel-identity"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-save-identity"
                >
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-muted-foreground">Full Name</Label>
              <p className="font-medium" data-testid="text-full-name">
                {profile.first_name} {profile.middle_name && `${profile.middle_name} `}{profile.last_name}
              </p>
            </div>
            {profile.preferred_name && (
              <div>
                <Label className="text-muted-foreground">Preferred Name</Label>
                <p className="font-medium" data-testid="text-preferred-name-display">
                  {profile.preferred_name}
                </p>
              </div>
            )}
            <div>
              <Label className="text-muted-foreground">Date of Birth</Label>
              <p className="font-medium" data-testid="text-dob-display">
                {new Date(profile.dob).toLocaleDateString()}
              </p>
            </div>
            {profile.sex && (
              <div>
                <Label className="text-muted-foreground">Sex</Label>
                <p className="font-medium" data-testid="text-sex-display">
                  {profile.sex === 'M' ? 'Male' : profile.sex === 'F' ? 'Female' : 'Non-binary / Other'}
                </p>
              </div>
            )}
            {profile.gov_id_type && (
              <div>
                <Label className="text-muted-foreground">Government ID</Label>
                <p className="font-medium" data-testid="text-gov-id-display">
                  {profile.gov_id_type} - {profile.gov_id_number || 'N/A'}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Contact Section Component  
function ContactSection({ 
  profile, 
  isEditing, 
  onEdit, 
  onCancel, 
  onSave 
}: { 
  profile: Student;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof contactFormSchema>>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      email: profile.email,
      phone_primary: profile.phone_primary,
      phone_secondary: profile.phone_secondary || "",
      whatsapp_primary: profile.whatsapp_primary,
      timezone: profile.timezone || "",
      preferred_contact_channel: profile.preferred_contact_channel,
      address_country: profile.address_country,
      address_state: profile.address_state || "",
      address_city: profile.address_city || "",
      address_postal: profile.address_postal || "",
      address_line1: profile.address_line1,
      address_line2: profile.address_line2 || "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof contactFormSchema>) => {
      return apiRequest('PUT', `/api/students/${profile.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/me'] });
      toast({
        title: "Contact information updated",
        description: "Your contact details have been saved successfully.",
      });
      onSave();
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update contact information. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    updateMutation.mutate(data);
  });

  return (
    <Card data-testid="card-contact-section">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Contact Information
          </CardTitle>
          <CardDescription>How we can reach you</CardDescription>
        </div>
        {!isEditing && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={onEdit}
            data-testid="button-edit-contact"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Contact Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Contact Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email *</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} data-testid="input-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="preferred_contact_channel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Preferred Contact Method</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-contact-channel">
                              <SelectValue placeholder="Select method" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="email">Email</SelectItem>
                            <SelectItem value="phone">Phone</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone_primary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Primary Phone *</FormLabel>
                        <FormControl>
                          <Input type="tel" {...field} data-testid="input-phone-primary" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone_secondary"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Secondary Phone</FormLabel>
                        <FormControl>
                          <Input type="tel" {...field} data-testid="input-phone-secondary" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Address</h3>
                <div className="grid grid-cols-1 gap-4">
                  <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address Line 1 *</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-address-line1" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_line2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address Line 2</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-address-line2" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="address_city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-address-city" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address_state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State / Province</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-address-state" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="address_postal"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postal Code</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-address-postal" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="address_country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country *</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-address-country" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    form.reset();
                    onCancel();
                  }}
                  disabled={updateMutation.isPending}
                  data-testid="button-cancel-contact"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-save-contact"
                >
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="space-y-6">
            {/* Contact Details Display */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Contact Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-medium" data-testid="text-email-display">{profile.email}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Primary Phone</Label>
                  <p className="font-medium" data-testid="text-phone-primary-display">{profile.phone_primary}</p>
                </div>
                {profile.phone_secondary && (
                  <div>
                    <Label className="text-muted-foreground">Secondary Phone</Label>
                    <p className="font-medium" data-testid="text-phone-secondary-display">{profile.phone_secondary}</p>
                  </div>
                )}
                <div>
                  <Label className="text-muted-foreground">Preferred Contact</Label>
                  <p className="font-medium capitalize" data-testid="text-contact-channel-display">
                    {profile.preferred_contact_channel}
                  </p>
                </div>
              </div>
            </div>

            {/* Address Display */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Address</h3>
              <div>
                <Label className="text-muted-foreground">Mailing Address</Label>
                <div className="font-medium" data-testid="text-address-display">
                  <p>{profile.address_line1}</p>
                  {profile.address_line2 && <p>{profile.address_line2}</p>}
                  <p>
                    {profile.address_city && `${profile.address_city}, `}
                    {profile.address_state && `${profile.address_state} `}
                    {profile.address_postal}
                  </p>
                  <p>{profile.address_country}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Eligibility Section Component
function EligibilitySection({ 
  profile, 
  isEditing, 
  onEdit, 
  onCancel, 
  onSave 
}: { 
  profile: Student;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof eligibilityFormSchema>>({
    resolver: zodResolver(eligibilityFormSchema),
    defaultValues: {
      residency: profile.residency,
      hs_completion: profile.hs_completion,
      hs_path: profile.hs_path || null,
      hs_country: profile.hs_country || "",
      hs_school: profile.hs_school || "",
      hs_year: profile.hs_year || null,
    },
  });

  const watchHsCompletion = form.watch("hs_completion");
  const watchResidency = form.watch("residency");

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof eligibilityFormSchema>) => {
      return apiRequest('PUT', `/api/students/${profile.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/me'] });
      toast({
        title: "Eligibility updated",
        description: "Your eligibility information has been saved successfully.",
      });
      onSave();
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update eligibility. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    // Clear HS details if hs_completion is false
    const cleanedData = {
      ...data,
      hs_path: data.hs_completion ? data.hs_path : null,
      hs_country: data.hs_completion ? data.hs_country : "",
      hs_school: data.hs_completion ? data.hs_school : "",
      hs_year: data.hs_completion ? data.hs_year : null,
    };
    updateMutation.mutate(cleanedData);
  });

  return (
    <Card data-testid="card-eligibility-section">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Eligibility
          </CardTitle>
          <CardDescription>Residency status and high school completion</CardDescription>
        </div>
        {!isEditing && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={onEdit}
            data-testid="button-edit-eligibility"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Residency Status */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">Residency Status</h3>
                <FormField
                  control={form.control}
                  name="residency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Residency *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-residency">
                            <SelectValue placeholder="Select residency status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="us">US Resident</SelectItem>
                          <SelectItem value="foreign">International Student</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Your residency status for admission purposes
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {watchResidency === 'foreign' && (
                  <div className="p-4 bg-muted rounded-md">
                    <div className="flex gap-2">
                      <AlertCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium">English Proficiency Required</p>
                        <p className="text-muted-foreground mt-1">
                          International students must provide proof of English proficiency (TOEFL, IELTS, Duolingo, etc.)
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* High School Completion */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold">High School Completion</h3>
                <FormField
                  control={form.control}
                  name="hs_completion"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <input
                          type="checkbox"
                          checked={field.value}
                          onChange={field.onChange}
                          className="h-4 w-4 rounded border-input"
                          data-testid="checkbox-hs-completion"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 cursor-pointer">
                        I have completed high school or equivalent
                      </FormLabel>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {watchHsCompletion && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <FormField
                      control={form.control}
                      name="hs_path"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>High School Path</FormLabel>
                          <Select 
                            onValueChange={field.onChange} 
                            defaultValue={field.value || undefined}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-hs-path">
                                <SelectValue placeholder="Select path" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="local_diploma">Local High School Diploma</SelectItem>
                              <SelectItem value="ged">GED</SelectItem>
                              <SelectItem value="foreign">Foreign High School Diploma</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="hs_year"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Graduation Year</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="e.g., 2020"
                              {...field}
                              value={field.value || ""}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                              data-testid="input-hs-year"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="hs_country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="e.g., United States"
                              data-testid="input-hs-country"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="hs_school"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>School Name</FormLabel>
                          <FormControl>
                            <Input 
                              {...field} 
                              placeholder="e.g., Lincoln High School"
                              data-testid="input-hs-school"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => {
                    form.reset();
                    onCancel();
                  }}
                  disabled={updateMutation.isPending}
                  data-testid="button-cancel-eligibility"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-save-eligibility"
                >
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="space-y-6">
            {/* Residency Status Display */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Residency Status</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Residency</Label>
                  <p className="font-medium" data-testid="text-residency-display">
                    {profile.residency === 'us' ? 'US Resident' : 'International Student'}
                  </p>
                </div>
                {profile.residency === 'foreign' && (
                  <div className="col-span-2">
                    <div className="p-4 bg-muted rounded-md">
                      <div className="flex gap-2">
                        <AlertCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium">English Proficiency Required</p>
                          <p className="text-muted-foreground mt-1">
                            Please upload proof of English proficiency in the Documents section
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* High School Completion Display */}
            <div>
              <h3 className="text-sm font-semibold mb-3">High School Completion</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {profile.hs_completion ? (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <span className="font-medium" data-testid="text-hs-completion-display">
                        High school completed
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      <span className="font-medium" data-testid="text-hs-completion-display">
                        High school not completed
                      </span>
                    </>
                  )}
                </div>
                
                {profile.hs_completion && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    {profile.hs_path && (
                      <div>
                        <Label className="text-muted-foreground">Path</Label>
                        <p className="font-medium capitalize" data-testid="text-hs-path-display">
                          {profile.hs_path === 'local_diploma' ? 'Local High School Diploma' :
                           profile.hs_path === 'ged' ? 'GED' :
                           profile.hs_path === 'foreign' ? 'Foreign High School Diploma' : profile.hs_path}
                        </p>
                      </div>
                    )}
                    {profile.hs_year && (
                      <div>
                        <Label className="text-muted-foreground">Graduation Year</Label>
                        <p className="font-medium" data-testid="text-hs-year-display">
                          {profile.hs_year}
                        </p>
                      </div>
                    )}
                    {profile.hs_country && (
                      <div>
                        <Label className="text-muted-foreground">Country</Label>
                        <p className="font-medium" data-testid="text-hs-country-display">
                          {profile.hs_country}
                        </p>
                      </div>
                    )}
                    {profile.hs_school && (
                      <div>
                        <Label className="text-muted-foreground">School</Label>
                        <p className="font-medium" data-testid="text-hs-school-display">
                          {profile.hs_school}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Authorized Contacts Section Component
function AuthorizedContactsSection({ 
  studentId,
  contacts,
  isLoading,
  isAdding,
  onAdd,
  onCancelAdd,
}: { 
  studentId: string;
  contacts: StudentContact[];
  isLoading: boolean;
  isAdding: boolean;
  onAdd: () => void;
  onCancelAdd: () => void;
}) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (contactId: string) => {
      return apiRequest('DELETE', `/api/contacts/${contactId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', studentId, 'contacts'] });
      toast({
        title: "Contact removed",
        description: "Authorized contact has been removed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message || "Failed to remove contact. Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card data-testid="card-authorized-contacts">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Authorized Contacts
          </CardTitle>
          <CardDescription>People authorized to access your academic information</CardDescription>
        </div>
        {!isAdding && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={onAdd}
            data-testid="button-add-contact"
          >
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isAdding && (
          <AddContactForm 
            studentId={studentId}
            onCancel={onCancelAdd}
          />
        )}

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading contacts...
          </div>
        ) : contacts.length === 0 && !isAdding ? (
          <div className="text-center py-8">
            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No authorized contacts added yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add emergency contacts or people authorized to access your information
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {contacts.map((contact) => (
              <div 
                key={contact.id}
                className="flex items-start justify-between p-4 border rounded-lg hover-elevate"
                data-testid={`contact-item-${contact.id}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium" data-testid={`text-contact-name-${contact.id}`}>
                      {contact.full_name}
                    </p>
                    <span className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
                      {contact.type}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1" data-testid={`text-contact-relationship-${contact.id}`}>
                    {contact.relationship}
                  </p>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {contact.phone}
                    </span>
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </span>
                    )}
                  </div>
                  {contact.scopes.length > 0 && (
                    <div className="flex gap-2 mt-2">
                      {contact.scopes.map((scope) => (
                        <span 
                          key={scope}
                          className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMutation.mutate(contact.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`button-delete-contact-${contact.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Add Contact Form Component
function AddContactForm({ 
  studentId,
  onCancel,
}: { 
  studentId: string;
  onCancel: () => void;
}) {
  const { toast } = useToast();

  const form = useForm<z.infer<typeof insertStudentContactSchema>>({
    resolver: zodResolver(insertStudentContactSchema.omit({ student_id: true })),
    defaultValues: {
      type: "parent",
      full_name: "",
      relationship: "",
      phone: "",
      email: "",
      language: "",
      scopes: [],
      consent_doc_url: null,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<InsertStudentContact, 'student_id'>) => {
      return apiRequest('POST', `/api/students/${studentId}/contacts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/students', studentId, 'contacts'] });
      toast({
        title: "Contact added",
        description: "Authorized contact has been added successfully.",
      });
      onCancel();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add contact",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    createMutation.mutate(data);
  });

  return (
    <div className="mb-6 p-4 border rounded-lg bg-muted/50">
      <h3 className="font-semibold mb-4">Add New Contact</h3>
      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Type *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-contact-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="parent">Parent</SelectItem>
                      <SelectItem value="spouse">Spouse</SelectItem>
                      <SelectItem value="guardian">Guardian</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="relationship"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Relationship *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g., Mother, Father, Spouse" data-testid="input-relationship" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name *</FormLabel>
                  <FormControl>
                    <Input {...field} data-testid="input-contact-full-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} data-testid="input-contact-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} value={field.value || ""} data-testid="input-contact-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred Language</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} data-testid="input-contact-language" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button 
              type="button" 
              variant="outline"
              onClick={() => {
                form.reset();
                onCancel();
              }}
              disabled={createMutation.isPending}
              data-testid="button-cancel-add-contact"
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-submit-add-contact"
            >
              {createMutation.isPending ? "Adding..." : "Add Contact"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
