import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ImpersonationPresetNotFoundError,
  createPreset,
  getPresetDetail,
  removePreset,
  updatePreset,
  uploadPresetLogo,
} from "../api/impersonationPresets";
import type {
  ImpersonationPresetCreate,
  ImpersonationPresetDetail,
  ImpersonationPresetUpdate,
} from "../api/impersonationPresets";
import Toast from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { Button, Card, Field, Input, Textarea } from "../components/ds";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Expand 3-digit hex (#abc) to 6-digit (#aabbcc) for the native picker. */
function expandShortHex(hex: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const r = hex[1];
    const g = hex[2];
    const b = hex[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

interface FormState {
  name: string;
  sender_email: string;
  /** Optional — empty string means "no color". */
  primary_color: string;
  pretends_to_be: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  sender_email: "",
  primary_color: "",
  pretends_to_be: "",
};

function readToForm(read: ImpersonationPresetDetail): FormState {
  return {
    name: read.name,
    sender_email: read.sender_email,
    primary_color: read.primary_color ?? "",
    pretends_to_be: read.pretends_to_be,
  };
}

function formToCreatePayload(state: FormState): ImpersonationPresetCreate {
  return {
    name: state.name.trim(),
    sender_email: state.sender_email.trim(),
    primary_color: state.primary_color.trim() || null,
    pretends_to_be: state.pretends_to_be.trim(),
  };
}

/** Diff against loaded server state; only changed fields are PATCHed. */
function diffUpdatePayload(
  state: FormState,
  original: ImpersonationPresetDetail
): ImpersonationPresetUpdate {
  const update: ImpersonationPresetUpdate = {};
  if (state.name.trim() !== original.name) {
    update.name = state.name.trim();
  }
  if (state.sender_email.trim() !== original.sender_email) {
    update.sender_email = state.sender_email.trim();
  }
  const color = state.primary_color.trim() || null;
  if (color !== (original.primary_color ?? null)) {
    update.primary_color = color;
  }
  if (state.pretends_to_be.trim() !== original.pretends_to_be) {
    update.pretends_to_be = state.pretends_to_be.trim();
  }
  return update;
}

// ---------------------------------------------------------------------------
// Toast state
// ---------------------------------------------------------------------------

interface ToastState {
  title: string;
  description?: string | null;
  variant: "error" | "success" | "info";
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

/**
 * Combined create + edit form for impersonation presets (STORY-AP1.2).
 *
 * Mounted at two routes:
 *   * ``/admin/impersonation-presets/new`` — POST on submit.
 *   * ``/admin/impersonation-presets/:id/edit`` — fetches existing preset,
 *     PATCHes the diff on submit, exposes a logo upload + a Delete button.
 *
 * Logo upload is only available in edit mode (the backend keys the logo to
 * an existing preset id). On the create form we tell the user to save first.
 */
export default function ImpersonationPresetFormPage() {
  const { isAdmin, profileLoaded } = useAuth();
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const isEdit = typeof params.id === "string" && params.id.length > 0;
  // Preset PKs are string slugs (e.g. "microsoft-365"); use the raw param.
  const editId = isEdit ? params.id ?? null : null;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [isLogoUploading, setIsLogoUploading] = useState(false);

  // Edit mode: load the existing preset.
  const detailQuery = useQuery<ImpersonationPresetDetail>({
    queryKey: ["admin", "impersonation-presets", editId],
    queryFn: () => getPresetDetail(editId!),
    enabled: isEdit && editId !== null && isAdmin === true,
    retry: false,
  });

  // Hydrate the form once the detail query settles.
  useEffect(() => {
    if (!isEdit) {
      setForm(EMPTY_FORM);
      setLogoUrl(null);
      return;
    }
    if (detailQuery.data) {
      setForm(readToForm(detailQuery.data));
      setLogoUrl(detailQuery.data.logo_url);
    }
  }, [isEdit, detailQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: ImpersonationPresetCreate) => createPreset(body),
    onSuccess: (preset) => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "impersonation-presets"],
      });
      navigate("/admin/impersonation-presets", {
        state: {
          toast: {
            title: `Preset "${preset.name}" created`,
            variant: "success" as const,
          },
        },
      });
    },
    onError: (err: unknown) => {
      setToast({
        title: "Failed to create preset",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: ImpersonationPresetUpdate;
    }) => updatePreset(id, body),
    onSuccess: (preset) => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "impersonation-presets"],
      });
      queryClient.invalidateQueries({
        queryKey: ["admin", "impersonation-presets", preset.id],
      });
      navigate("/admin/impersonation-presets", {
        state: {
          toast: {
            title: `Preset "${preset.name}" saved`,
            variant: "success" as const,
          },
        },
      });
    },
    onError: (err: unknown) => {
      if (err instanceof ImpersonationPresetNotFoundError) {
        setToast({
          title: "Preset not found.",
          description:
            "Someone else may have deleted it. Return to the list to refresh.",
          variant: "error",
        });
        return;
      }
      setToast({
        title: "Failed to save preset",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removePreset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "impersonation-presets"],
      });
      navigate("/admin/impersonation-presets", {
        state: {
          toast: {
            title: `Preset "${form.name || editId}" deleted`,
            variant: "success" as const,
          },
        },
      });
    },
    onError: (err: unknown) => {
      setConfirmDeleteOpen(false);
      if (err instanceof ImpersonationPresetNotFoundError) {
        setToast({
          title: "Preset not found.",
          description:
            "Someone else may have already deleted it. Returning to the list refreshes the view.",
          variant: "error",
        });
        return;
      }
      setToast({
        title: "Failed to delete preset",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      });
    },
  });

  // Field-level validation.
  const validation = useMemo(() => {
    const errors: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    if (!form.sender_email.trim()) {
      errors.sender_email = "Sender email is required.";
    } else if (!EMAIL_PATTERN.test(form.sender_email.trim())) {
      errors.sender_email = "Enter a valid email address.";
    }
    if (form.primary_color.trim() && !HEX_PATTERN.test(form.primary_color.trim())) {
      errors.primary_color = "Enter a hex color (e.g. #0067B8).";
    }
    if (!form.pretends_to_be.trim()) {
      errors.pretends_to_be = "Describe what this preset pretends to be.";
    }
    return errors;
  }, [form]);

  if (!profileLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-sunken">
        <div role="status" className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          <p className="mt-2 text-body text-ink-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validation).length > 0) {
      return;
    }
    if (isEdit && detailQuery.data) {
      const body = diffUpdatePayload(form, detailQuery.data);
      updateMutation.mutate({ id: detailQuery.data.id, body });
    } else if (!isEdit) {
      createMutation.mutate(formToCreatePayload(form));
    }
  }

  async function handleLogoSelected(file: File) {
    if (editId === null) return;
    setIsLogoUploading(true);
    try {
      const updated = await uploadPresetLogo(editId, file);
      setLogoUrl(updated.logo_url);
      queryClient.invalidateQueries({
        queryKey: ["admin", "impersonation-presets", editId],
      });
      setToast({ title: "Logo uploaded", variant: "success" });
    } catch (err) {
      setToast({
        title: "Failed to upload logo",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setIsLogoUploading(false);
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const showNameError = submitted && !!validation.name;
  const showEmailError = submitted && !!validation.sender_email;
  const showColorError = submitted && !!validation.primary_color;
  const showPretextError = submitted && !!validation.pretends_to_be;

  const colorForPicker = HEX_PATTERN.test(form.primary_color)
    ? expandShortHex(form.primary_color).toLowerCase()
    : "#000000";

  return (
    // STORY-AP7.1: global user menu moved to the app shell (TopBar).
    <div className="min-h-full bg-surface-sunken">
      <header className="border-b border-border-subtle bg-surface-raised">
        <div className="mx-auto flex max-w-4xl items-center gap-sm px-lg py-md">
          <Link
            to="/admin/impersonation-presets"
            aria-label="Back to presets"
            className="rounded-ds-sm p-1.5 text-ink-body transition-colors hover:bg-surface-sunken"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
          <h1 className="text-title text-ink-strong">
            {isEdit ? "Edit impersonation preset" : "Create impersonation preset"}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-lg py-lg">
        {isEdit && detailQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <div
              role="status"
              className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"
            />
          </div>
        )}

        {isEdit && detailQuery.isError && (
          <div
            role="alert"
            className="rounded-ds-md border border-danger bg-surface-raised px-md py-sm text-body text-danger"
          >
            {detailQuery.error instanceof ImpersonationPresetNotFoundError
              ? `Preset "${editId}" not found.`
              : `Failed to load preset: ${
                  detailQuery.error instanceof Error
                    ? detailQuery.error.message
                    : "Unknown error"
                }`}
          </div>
        )}

        {(!isEdit || detailQuery.isSuccess) && (
          <form
            data-testid="preset-form"
            onSubmit={handleSubmit}
            className="space-y-lg"
            noValidate
          >
            <Card className="space-y-md">
              <h2 className="text-title text-ink-strong">Identity</h2>

              <Field
                label="Name"
                error={showNameError ? validation.name : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    data-testid="preset-name-input"
                    type="text"
                    value={form.name}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, name: e.target.value }))
                    }
                    placeholder="e.g. Microsoft 365"
                  />
                )}
              </Field>

              <Field
                label="Sender email"
                error={showEmailError ? validation.sender_email : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    mono
                    data-testid="preset-sender-email-input"
                    type="email"
                    value={form.sender_email}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, sender_email: e.target.value }))
                    }
                    placeholder="it-support@contoso.com"
                  />
                )}
              </Field>

              <Field
                label="Primary color"
                required={false}
                error={showColorError ? validation.primary_color : undefined}
                help="Optional brand accent. Leave blank for none."
              >
                {({ id, describedBy, invalid }) => (
                  <div className="flex items-center gap-sm">
                    <input
                      type="color"
                      aria-label="Primary color picker"
                      data-testid="preset-color-picker"
                      value={colorForPicker}
                      onChange={(e) =>
                        setForm((s) => ({
                          ...s,
                          primary_color: e.target.value,
                        }))
                      }
                      className="h-9 w-12 shrink-0 cursor-pointer rounded-ds-sm border border-border-default bg-surface-raised p-1"
                    />
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      mono
                      data-testid="preset-color-hex"
                      type="text"
                      value={form.primary_color}
                      onChange={(e) =>
                        setForm((s) => ({
                          ...s,
                          primary_color: e.target.value,
                        }))
                      }
                      placeholder="#0067B8"
                    />
                  </div>
                )}
              </Field>

              <Field
                label="What this preset pretends to be"
                error={showPretextError ? validation.pretends_to_be : undefined}
                help="e.g. A Microsoft 365 password-expiry notice"
              >
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    data-testid="preset-pretends-to-be-input"
                    rows={3}
                    value={form.pretends_to_be}
                    onChange={(e) =>
                      setForm((s) => ({
                        ...s,
                        pretends_to_be: e.target.value,
                      }))
                    }
                    placeholder="Describe the pretext this preset impersonates…"
                  />
                )}
              </Field>
            </Card>

            <Card className="space-y-md">
              <h2 className="text-title text-ink-strong">Logo</h2>
              {isEdit ? (
                <div className="flex items-center gap-md">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-ds-sm border border-border-default bg-surface-base">
                    {logoUrl ? (
                      <img
                        data-testid="preset-logo-preview"
                        src={logoUrl}
                        alt="Preset logo"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-caption text-ink-faint">None</span>
                    )}
                  </div>
                  <Button
                    type="button"
                    data-testid="preset-logo-upload"
                    loading={isLogoUploading}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {isLogoUploading
                      ? "Uploading…"
                      : logoUrl
                      ? "Replace logo"
                      : "Upload logo"}
                  </Button>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/svg+xml"
                    className="sr-only"
                    aria-label="Upload preset logo"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleLogoSelected(file);
                      e.target.value = "";
                    }}
                  />
                </div>
              ) : (
                <p className="text-body text-ink-muted">
                  Save the preset first, then upload a logo from the edit page.
                </p>
              )}
            </Card>

            <div className="flex items-center justify-between">
              <div>
                {isEdit && (
                  <Button
                    type="button"
                    variant="danger"
                    data-testid="preset-delete-button"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Delete preset
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-sm">
                <Link
                  to="/admin/impersonation-presets"
                  className="inline-flex h-9 items-center justify-center rounded-ds-sm border border-border-default bg-surface-raised px-3.5 text-label text-ink-body transition-colors duration-fast ease-out hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
                >
                  Cancel
                </Link>
                <Button
                  type="submit"
                  variant="primary"
                  data-testid="preset-submit-button"
                  loading={isSubmitting}
                >
                  {isSubmitting
                    ? "Saving…"
                    : isEdit
                    ? "Save changes"
                    : "Create preset"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </main>

      {confirmDeleteOpen && isEdit && (
        <ConfirmDeleteDialog
          name={form.name || String(editId)}
          onCancel={() => setConfirmDeleteOpen(false)}
          onConfirm={() => {
            if (editId !== null) deleteMutation.mutate(editId);
          }}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {toast && (
        <Toast
          data-testid="preset-form-toast"
          title={toast.title}
          description={toast.description ?? null}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ConfirmDeleteDialogProps {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

function ConfirmDeleteDialog({
  name,
  onCancel,
  onConfirm,
  isDeleting,
}: ConfirmDeleteDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      data-testid="confirm-delete-dialog"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-strong/40 px-md"
    >
      <div className="w-full max-w-md rounded-ds-lg bg-surface-raised p-lg shadow-dialog">
        <h2 id="confirm-delete-title" className="text-title text-ink-strong">
          Delete preset
        </h2>
        <p className="mt-2 text-body text-ink-muted">
          Delete preset{" "}
          <span className="font-medium text-ink-strong">"{name}"</span>? This
          cannot be undone.
        </p>
        <div className="mt-lg flex justify-end gap-sm">
          <Button
            type="button"
            data-testid="confirm-delete-cancel"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            data-testid="confirm-delete-confirm"
            onClick={onConfirm}
            loading={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
