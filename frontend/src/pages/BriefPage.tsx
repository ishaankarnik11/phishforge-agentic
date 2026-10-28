import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import AssetUploadPanel from "../components/AssetUploadPanel";
import { Button, Card, Field, Input, Select, Textarea } from "../components/ds";
import {
  createEmailer,
  generateEmailer,
  updateEmailer,
  MJMLValidationError,
  type EmailerCreate,
  type EmailerDraftCreate,
  type EmailerUpdate,
  type LureType,
  type UrgencyLevel,
  type PretextScenario,
} from "../api/emailers";
import { uploadAsset } from "../api/assets";
import {
  listPresets,
  getPresetDetail,
  createPreset,
  copyLogoToEmailer,
  uploadPresetLogo,
  type ImpersonationPresetSummary,
} from "../api/impersonationPresets";
import type { LibraryAssetRead } from "../api/libraryAssets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Length = "short" | "medium" | "long";

interface FormState {
  name: string;
  // CR-001: Target recipients (relabeled from "Target audience") and Length
  // are now optional. The marketing-era category/content_summary/tone fields
  // are removed from the form entirely.
  target_audience: string;
  cta_text: string;
  cta_url: string;
  length: Length | "";
  // CR-001: pretext scenario — the believable story. Required.
  pretext_scenario: PretextScenario | "";
  // STORY-AP2.2: impersonated identity the simulation mimics.
  impersonation_sender_name: string;
  impersonation_sender_email: string;
  impersonation_pretends_to_be: string;
  impersonation_primary_color: string;
  // The persisted asset id (set after a successful logo upload) and the
  // URL we render in the preview. logo_url may come from a freshly
  // uploaded asset OR from EmailerRead.impersonation_logo_url on reload.
  impersonation_logo_asset_id: string | null;
  impersonation_logo_url: string | null;
  // STORY-AP2.1: pretext. Lure type + urgency are required; the intended
  // "tell" is optional free text.
  lure_type: LureType | "";
  urgency_level: UrgencyLevel | "";
  pretext_tell: string;
}

interface FormErrors {
  name?: string;
  // CR-001: pretext scenario is required; target recipients is optional but
  // still length-capped.
  pretext_scenario?: string;
  target_audience?: string;
  // STORY-AP2.2
  impersonation_sender_name?: string;
  impersonation_sender_email?: string;
  impersonation_pretends_to_be?: string;
  impersonation_primary_color?: string;
  // STORY-AP2.1
  lure_type?: string;
  urgency_level?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// CR-001: pretext scenario options. Replaces the retired marketing Category.
// Labels map to the pinned backend enum values.
const PRETEXT_SCENARIO_OPTIONS: { value: PretextScenario; label: string }[] = [
  { value: "password_expiry", label: "Password / account expiry" },
  { value: "invoice_payment", label: "Invoice / payment" },
  { value: "shared_document", label: "Shared document" },
  { value: "account_security_alert", label: "Account security alert" },
  { value: "delivery_shipping", label: "Delivery / shipping" },
  { value: "hr_payroll", label: "HR / payroll" },
  { value: "it_support", label: "IT support / helpdesk" },
  { value: "other", label: "Other" },
];

const LENGTH_OPTIONS: { value: Length; label: string }[] = [
  { value: "short", label: "Short (under 150 words)" },
  { value: "medium", label: "Medium (150 to 300 words)" },
  { value: "long", label: "Long (300 to 500 words)" },
];

// STORY-AP2.1: pretext options. Labels map to the pinned enum values.
const LURE_TYPE_OPTIONS: { value: LureType; label: string }[] = [
  { value: "credential_harvest", label: "Credential harvest" },
  { value: "malicious_attachment", label: "Malicious attachment" },
  { value: "link_click", label: "Link click" },
  { value: "oauth_consent", label: "OAuth consent" },
];

const URGENCY_OPTIONS: { value: UrgencyLevel; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// STORY-AP2.2: pragmatic email-shape check (one @, no spaces, a dot in the
// domain). Deliberately lenient — the backend is the source of truth — but
// catches the obvious mistakes inline with a specific message.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepts #rgb or #rrggbb (the same shape ImpersonationPresetFormPage uses).
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function validateForm(state: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!state.name.trim()) {
    errors.name = "Template name is required.";
  } else if (state.name.length > 100) {
    errors.name = "Template name must be 100 characters or fewer.";
  }

  // CR-001: pretext scenario is required.
  if (!state.pretext_scenario) {
    errors.pretext_scenario = "Pretext scenario is required.";
  }

  // CR-001: Target recipients is now optional — only length-check when present.
  if (state.target_audience.length > 500) {
    errors.target_audience =
      "Target recipients must be 500 characters or fewer.";
  }

  // CR-001: Length is now optional — no required check.

  // STORY-AP2.2: impersonated identity. Name / email / pretends-to-be are
  // required; colour is optional but must be valid hex if present.
  if (!state.impersonation_sender_name.trim()) {
    errors.impersonation_sender_name = "Brand / sender name is required.";
  } else if (state.impersonation_sender_name.length > 120) {
    errors.impersonation_sender_name =
      "Brand / sender name must be 120 characters or fewer.";
  }

  if (!state.impersonation_sender_email.trim()) {
    errors.impersonation_sender_email = "Sender email is required.";
  } else if (!EMAIL_PATTERN.test(state.impersonation_sender_email.trim())) {
    errors.impersonation_sender_email =
      "Enter a valid email address (e.g. it-support@contoso.com).";
  }

  if (!state.impersonation_pretends_to_be.trim()) {
    errors.impersonation_pretends_to_be =
      "Describe what this email pretends to be.";
  } else if (state.impersonation_pretends_to_be.length > 500) {
    errors.impersonation_pretends_to_be =
      "This description must be 500 characters or fewer.";
  }

  if (
    state.impersonation_primary_color.trim() &&
    !HEX_PATTERN.test(state.impersonation_primary_color.trim())
  ) {
    errors.impersonation_primary_color =
      "Enter a hex color (e.g. #0067B8).";
  }

  // STORY-AP2.1: pretext. Lure type + urgency are required; the "tell" is
  // optional free text (length-capped to match the textarea maxLength).
  if (!state.lure_type) {
    errors.lure_type = "Lure type is required.";
  }

  if (!state.urgency_level) {
    errors.urgency_level = "Urgency level is required.";
  }

  return errors;
}

/** Expand 3-digit hex (#abc) to 6-digit (#aabbcc) for the native picker. */
function expandShortHex(hex: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// STORY-AP7.1 chunk 2: every form group is a ds Card with a Title heading and
// optional description, and every control uses the shared ds Field / Input /
// Select / Textarea vocabulary. The local FieldWrapper / Section / DsField
// helpers and the ad-hoc input class strings were removed in favour of these.
// ---------------------------------------------------------------------------

interface FormSectionProps {
  title: string;
  description?: string;
  /** data-testid forwarded to the section element (used by AP2.x tests). */
  testId?: string;
  children: ReactNode;
}

/** A titled form group: one Card, a Title heading, optional description. */
function FormSection({ title, description, testId, children }: FormSectionProps) {
  return (
    <Card data-testid={testId} className="space-y-md">
      <div className="space-y-2xs">
        <h2 className="text-title text-ink-strong">{title}</h2>
        {description && <p className="text-body text-ink-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// STORY-AP2.2: Impersonated identity section
// ---------------------------------------------------------------------------

interface ImpersonationSectionProps {
  form: FormState;
  errors: FormErrors;
  isLogoUploading: boolean;
  logoError: string | null;
  onChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  onMarkTouched: (field: keyof FormState) => void;
  onLogoSelected: (file: File) => void;
  onRemoveLogo: () => void;
  // STORY-AP1.2: load-from-preset dropdown + save-as-preset action.
  presets: ImpersonationPresetSummary[];
  presetsLoading: boolean;
  selectedPresetId: string | null;
  isLoadingPreset: boolean;
  presetMessage: { variant: "success" | "error"; text: string } | null;
  isSavingPreset: boolean;
  onLoadPreset: (presetId: string | null) => void;
  onSaveAsPreset: () => void;
}

function ImpersonationSection({
  form,
  errors,
  isLogoUploading,
  logoError,
  onChange,
  onMarkTouched,
  onLogoSelected,
  onRemoveLogo,
  presets,
  presetsLoading,
  selectedPresetId,
  isLoadingPreset,
  presetMessage,
  isSavingPreset,
  onLoadPreset,
  onSaveAsPreset,
}: ImpersonationSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The picker silently coerces invalid hex to #000000 mid-typing, so we
  // only feed it a normalised value when the typed hex is valid.
  const colorForPicker = HEX_PATTERN.test(form.impersonation_primary_color)
    ? expandShortHex(form.impersonation_primary_color).toLowerCase()
    : "#000000";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onLogoSelected(file);
    }
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
  }

  return (
    <FormSection
      testId="impersonation-section"
      title="Impersonated identity"
      description="Define the brand and sender this simulation imitates. This drives the lure's from-name, footer, and visual styling."
    >
      {/* STORY-AP1.2: load a saved preset to prefill the fields below.
          Fields stay fully editable after loading. */}
      <Field
        label="Load impersonation preset"
        required={false}
        help="Prefill the fields below from a saved identity. You can still edit anything."
      >
        {({ id, describedBy }) => (
          <div className="flex items-center gap-sm">
            <Select
              id={id}
              aria-describedby={describedBy}
              data-testid="impersonation-preset-select"
              disabled={presetsLoading || isLoadingPreset}
              value={selectedPresetId === null ? "" : String(selectedPresetId)}
              onChange={(e) =>
                onLoadPreset(e.target.value === "" ? null : e.target.value)
              }
            >
              <option value="">
                {presetsLoading ? "Loading presets…" : "Select a preset…"}
              </option>
              {presets.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </Select>
            {isLoadingPreset && (
              <span
                role="status"
                aria-label="Loading preset"
                className="h-4 w-4 shrink-0 animate-spin rounded-ds-full border-2 border-accent border-t-transparent"
              />
            )}
          </div>
        )}
      </Field>

      <Field
        label="Brand / sender name"
        error={errors.impersonation_sender_name}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            type="text"
            maxLength={120}
            placeholder="e.g. Microsoft 365"
            value={form.impersonation_sender_name}
            onChange={(e) =>
              onChange("impersonation_sender_name", e.target.value)
            }
            onBlur={() => onMarkTouched("impersonation_sender_name")}
          />
        )}
      </Field>

      <Field label="Sender email" error={errors.impersonation_sender_email}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            mono
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="it-support@contoso.com"
            value={form.impersonation_sender_email}
            onChange={(e) =>
              onChange("impersonation_sender_email", e.target.value)
            }
            onBlur={() => onMarkTouched("impersonation_sender_email")}
          />
        )}
      </Field>

      <Field
        label="What this email pretends to be"
        error={errors.impersonation_pretends_to_be}
        help="e.g. A Microsoft 365 password-expiry notice"
      >
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            rows={3}
            maxLength={500}
            placeholder="Describe the pretext this email impersonates…"
            value={form.impersonation_pretends_to_be}
            onChange={(e) =>
              onChange("impersonation_pretends_to_be", e.target.value)
            }
            onBlur={() => onMarkTouched("impersonation_pretends_to_be")}
          />
        )}
      </Field>

      <Field
        label="Primary color"
        required={false}
        error={errors.impersonation_primary_color}
        help="Brand accent used in the lure. Leave blank to let generation decide."
      >
        {({ id, describedBy, invalid }) => (
          <div className="flex items-center gap-sm">
            <input
              type="color"
              aria-label="Primary color picker"
              data-testid="impersonation-color-picker"
              value={colorForPicker}
              onChange={(e) =>
                onChange("impersonation_primary_color", e.target.value)
              }
              className="h-9 w-12 shrink-0 cursor-pointer rounded-ds-sm border border-border-default bg-surface-raised p-1"
            />
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              mono
              data-testid="impersonation-color-hex"
              type="text"
              placeholder="#0067B8"
              value={form.impersonation_primary_color}
              onChange={(e) =>
                onChange("impersonation_primary_color", e.target.value)
              }
              onBlur={() => onMarkTouched("impersonation_primary_color")}
            />
          </div>
        )}
      </Field>

      <Field label="Logo" required={false}>
        {({ id }) => (
          <>
            {form.impersonation_logo_url ? (
              <div className="flex items-center gap-md">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-ds-sm border border-border-default bg-surface-raised">
                  <img
                    data-testid="impersonation-logo-preview"
                    src={form.impersonation_logo_url}
                    alt="Impersonated brand logo"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <Button
                  variant="secondary"
                  data-testid="impersonation-logo-remove"
                  onClick={onRemoveLogo}
                >
                  Remove
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-md">
                <Button
                  variant="secondary"
                  loading={isLogoUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isLogoUploading ? "Uploading…" : "Upload logo"}
                </Button>
                <input
                  ref={fileInputRef}
                  id={id}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/svg+xml"
                  className="sr-only"
                  aria-label="Upload impersonation logo"
                  onChange={handleFileChange}
                />
                <span className="text-caption font-normal normal-case tracking-normal text-ink-muted">
                  PNG, JPG, GIF, or SVG up to 5 MB
                </span>
              </div>
            )}
            {logoError && (
              <p
                role="alert"
                className="mt-2xs flex items-center gap-1 text-caption font-normal normal-case tracking-normal text-danger"
              >
                {logoError}
              </p>
            )}
          </>
        )}
      </Field>

      {/* STORY-AP1.2: persist the current identity as a reusable preset. */}
      <div className="space-y-2xs border-t border-border-subtle pt-md">
        <div className="flex items-center gap-md">
          <Button
            variant="secondary"
            data-testid="save-as-preset"
            loading={isSavingPreset}
            onClick={onSaveAsPreset}
          >
            {isSavingPreset ? "Saving preset…" : "Save as impersonation preset"}
          </Button>
          <span className="text-caption font-normal normal-case tracking-normal text-ink-muted">
            Saves the brand name, sender email, color, and pretext for reuse.
          </span>
        </div>
        {presetMessage && (
          <p
            role={presetMessage.variant === "error" ? "alert" : "status"}
            data-testid="preset-message"
            className={`text-caption font-normal normal-case tracking-normal ${
              presetMessage.variant === "error"
                ? "text-danger"
                : "text-ink-body"
            }`}
          >
            {presetMessage.text}
          </p>
        )}
      </div>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// STORY-AP2.1: Pretext section
//
// Defines the lure type, urgency/difficulty, and the intended "tell". The
// spoofed sender is NOT re-entered here — it is already captured by the
// AP2.2 impersonation sender fields. We instead reflect those fields back
// read-only ("Appears from: …") so the auditor sees the spoofed From without
// duplicate inputs (de-dup decision).
// ---------------------------------------------------------------------------

interface PretextSectionProps {
  form: FormState;
  errors: FormErrors;
  onChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  onMarkTouched: (field: keyof FormState) => void;
}

function PretextSection({
  form,
  errors,
  onChange,
  onMarkTouched,
}: PretextSectionProps) {
  // De-dup reflection: surface the impersonation sender (AP2.2) read-only so
  // the auditor sees the spoofed From here without re-entering it. Both the
  // name and email come straight from the identity fields.
  const hasSender =
    form.impersonation_sender_name.trim() !== "" ||
    form.impersonation_sender_email.trim() !== "";

  return (
    <FormSection
      testId="pretext-section"
      title="Pretext"
      description="Set the scenario, lure type, urgency, and the intended giveaway. These drive the behavior the simulation tests and how hard it is to spot."
    >
      <Field
        label="Pretext scenario"
        error={errors.pretext_scenario}
        help="The believable story the lure tells."
      >
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            data-testid="pretext-scenario-select"
            value={form.pretext_scenario}
            onChange={(e) =>
              onChange(
                "pretext_scenario",
                e.target.value as PretextScenario | ""
              )
            }
            onBlur={() => onMarkTouched("pretext_scenario")}
          >
            <option value="">Select a scenario…</option>
            {PRETEXT_SCENARIO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Lure type"
        error={errors.lure_type}
        help="The action the simulation tests for."
      >
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            data-testid="lure-type-select"
            value={form.lure_type}
            onChange={(e) =>
              onChange("lure_type", e.target.value as LureType | "")
            }
            onBlur={() => onMarkTouched("lure_type")}
          >
            <option value="">Select a lure type…</option>
            {LURE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Urgency / difficulty"
        error={errors.urgency_level}
        help="Drives the tone and sophistication of the lure."
      >
        {({ id, describedBy, invalid }) => (
          <Select
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            data-testid="urgency-select"
            value={form.urgency_level}
            onChange={(e) =>
              onChange("urgency_level", e.target.value as UrgencyLevel | "")
            }
            onBlur={() => onMarkTouched("urgency_level")}
          >
            <option value="">Select an urgency level…</option>
            {URGENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label='The intended "tell"'
        required={false}
        help="The giveaway(s) a trained employee should notice. Captured for the training debrief."
      >
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            rows={3}
            maxLength={500}
            placeholder="e.g. Lookalike sender domain plus a generic greeting"
            value={form.pretext_tell}
            onChange={(e) => onChange("pretext_tell", e.target.value)}
          />
        )}
      </Field>

      {/* De-dup reflection of the AP2.2 impersonation sender. Read-only, not
          an input — the spoofed From is owned by the identity section. */}
      <div
        data-testid="appears-from"
        className="rounded-ds-sm border border-border-subtle bg-surface-sunken px-md py-sm"
      >
        {hasSender ? (
          <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
            Appears from:{" "}
            <span className="font-medium text-ink-body">
              {form.impersonation_sender_name.trim() || "(no name)"}
            </span>{" "}
            <span className="font-mono text-ink-body">
              &lt;{form.impersonation_sender_email.trim() || "(no email)"}&gt;
            </span>
          </p>
        ) : (
          <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
            Fill in the Impersonated identity section above to set the spoofed
            sender shown here.
          </p>
        )}
      </div>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BriefPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>({
    name: "",
    target_audience: "",
    cta_text: "",
    cta_url: "",
    length: "",
    pretext_scenario: "",
    impersonation_sender_name: "",
    impersonation_sender_email: "",
    impersonation_pretends_to_be: "",
    impersonation_primary_color: "",
    impersonation_logo_asset_id: null,
    impersonation_logo_url: null,
    lure_type: "",
    urgency_level: "",
    pretext_tell: "",
  });

  // Track which fields have been touched (blurred) to show errors
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitErrors, setSubmitErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // STORY-7.12 AC-1: when POST /emailers/{id}/generate returns 422 (LLM
  // contract retry exhausted), we render a dedicated error block with a
  // Retry button instead of the generic apiError banner. Tracked separately
  // because the recovery action is different (retry generate, not retry the
  // whole submit) and the message text is hard-coded by spec.
  const [generationFailedFor, setGenerationFailedFor] = useState<number | null>(
    null
  );
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);

  // STORY-2.6: draft emailer id. Created lazily when the user uploads
  // their first asset; reused for the final submit if present.
  const [draftEmailerId, setDraftEmailerId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // STORY-AP2.3: separate in-flight flag for the "Sample emails to mimic"
  // panel. Kept independent from the in-email asset panel's flag so the two
  // sections don't interfere, but both gate the Generate button below.
  const [isSamplesUploading, setIsSamplesUploading] = useState(false);

  // STORY-A5.1: library assets attached via the asset picker modal.
  const [libraryAssets, setLibraryAssets] = useState<LibraryAssetRead[]>([]);

  // STORY-AP2.2: impersonation-logo upload state. Reuses the same draft-
  // ensure flow as the asset panel: a draft emailer must exist before we
  // can POST the logo to /emailers/{id}/assets.
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // STORY-AP1.2: impersonation preset state — the load-from-preset dropdown
  // and the save-as-preset action.
  const [presets, setPresets] = useState<ImpersonationPresetSummary[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isLoadingPreset, setIsLoadingPreset] = useState(false);
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [presetMessage, setPresetMessage] = useState<{
    variant: "success" | "error";
    text: string;
  } | null>(null);

  // Load the preset list once on mount for the dropdown.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listPresets();
        if (!cancelled) setPresets(list);
      } catch {
        // Non-fatal — the dropdown simply shows no options. The brief can
        // still be filled in manually.
        if (!cancelled) setPresets([]);
      } finally {
        if (!cancelled) setPresetsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Always-current ref to form state -- the AssetUploadPanel calls
  // ``onEnsureEmailer`` lazily, and we want to send whatever the brief
  // looks like AT that moment, not whatever it looked like when the
  // panel mounted.
  const formRef = useRef<FormState>(form);
  formRef.current = form;

  // Compute visible errors: show for touched fields OR after a failed submit attempt
  const errors = validateForm(form);
  const visibleErrors: FormErrors = {};
  for (const key of Object.keys(errors) as Array<keyof FormErrors>) {
    if (touched[key] || submitErrors[key]) {
      visibleErrors[key] = errors[key];
    }
  }

  function markTouched(field: keyof FormState) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function handleChange<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /**
   * Build a draft create body from whatever fields the user has filled
   * so far. Empty strings are dropped so the backend's optional fields
   * don't get pinned to "" -- it accepts any subset.
   */
  function buildDraftBody(state: FormState): EmailerDraftCreate {
    const body: EmailerDraftCreate = { status: "draft" };
    if (state.name.trim()) body.name = state.name.trim();
    // CR-001: pretext scenario carried on the draft.
    if (state.pretext_scenario) body.pretext_scenario = state.pretext_scenario;
    if (state.target_audience.trim())
      body.target_audience = state.target_audience.trim();
    if (state.cta_text.trim()) body.cta_text = state.cta_text.trim();
    if (state.cta_url.trim()) body.cta_url = state.cta_url.trim();
    if (state.length) body.length = state.length;
    // STORY-AP2.2: carry whatever impersonation fields are filled so a
    // draft created by an early logo upload preserves them.
    if (state.impersonation_sender_name.trim())
      body.impersonation_sender_name = state.impersonation_sender_name.trim();
    if (state.impersonation_sender_email.trim())
      body.impersonation_sender_email = state.impersonation_sender_email.trim();
    if (state.impersonation_pretends_to_be.trim())
      body.impersonation_pretends_to_be =
        state.impersonation_pretends_to_be.trim();
    if (state.impersonation_primary_color.trim())
      body.impersonation_primary_color =
        state.impersonation_primary_color.trim();
    if (state.impersonation_logo_asset_id)
      body.impersonation_logo_asset_id = state.impersonation_logo_asset_id;
    // STORY-AP2.1: carry whatever pretext fields are filled so a draft
    // created by an early logo upload preserves them.
    if (state.lure_type) body.lure_type = state.lure_type;
    if (state.urgency_level) body.urgency_level = state.urgency_level;
    if (state.pretext_tell.trim())
      body.pretext_tell = state.pretext_tell.trim();
    return body;
  }

  // Called by AssetUploadPanel the first time it has a file to upload
  // and no emailer id yet. Returns the id so the panel can drive
  // subsequent uploads against it without waiting for a re-render.
  const ensureDraftEmailer = useCallback(async (): Promise<number> => {
    const body = buildDraftBody(formRef.current);
    const created = await createEmailer(body);
    setDraftEmailerId(created.id);
    return created.id;
  }, []);

  // Always-current draft id so the logo upload handler (an async closure)
  // reuses the same draft the asset panel may have already created instead
  // of spawning a second one.
  const draftEmailerIdRef = useRef<number | null>(draftEmailerId);
  draftEmailerIdRef.current = draftEmailerId;

  // STORY-AP2.2: upload the impersonation logo. Ensures a draft emailer
  // exists first (same flow the asset panel uses), POSTs the file to that
  // emailer's asset bucket, and stores the returned asset id + url so the
  // submit payload can reference impersonation_logo_asset_id and the form
  // can show a preview.
  const handleLogoSelected = useCallback(
    async (file: File) => {
      setLogoError(null);
      setIsLogoUploading(true);
      try {
        let emailerId = draftEmailerIdRef.current;
        if (emailerId === null) {
          emailerId = await ensureDraftEmailer();
        }
        const asset = await uploadAsset(emailerId, file, {
          label: "impersonation-logo",
        });
        setForm((prev) => ({
          ...prev,
          impersonation_logo_asset_id: asset.id,
          impersonation_logo_url: asset.url,
        }));
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Logo upload failed.";
        setLogoError(message);
      } finally {
        setIsLogoUploading(false);
      }
    },
    [ensureDraftEmailer]
  );

  const handleRemoveLogo = useCallback(() => {
    setLogoError(null);
    setForm((prev) => ({
      ...prev,
      impersonation_logo_asset_id: null,
      impersonation_logo_url: null,
    }));
  }, []);

  // STORY-AP1.2: load a preset and prefill the impersonation fields. Fields
  // remain fully editable afterwards (no lock). If the preset carries a
  // logo, materialise it as an asset on a (lazily created) draft emailer so
  // the brief can reference it via impersonation_logo_asset_id.
  const handleLoadPreset = useCallback(
    async (presetId: string | null) => {
      setSelectedPresetId(presetId);
      setPresetMessage(null);
      if (presetId === null) {
        return;
      }
      setIsLoadingPreset(true);
      setLogoError(null);
      try {
        const detail = await getPresetDetail(presetId);
        // Prefill the text/color fields.
        setForm((prev) => ({
          ...prev,
          impersonation_sender_name: detail.name,
          impersonation_sender_email: detail.sender_email,
          impersonation_pretends_to_be: detail.pretends_to_be,
          impersonation_primary_color: detail.primary_color ?? "",
        }));
        // If the preset has a logo, copy it onto the emailer.
        if (detail.logo_url) {
          let emailerId = draftEmailerIdRef.current;
          if (emailerId === null) {
            emailerId = await ensureDraftEmailer();
          }
          const asset = await copyLogoToEmailer(emailerId, presetId);
          setForm((prev) => ({
            ...prev,
            impersonation_logo_asset_id: asset.id,
            impersonation_logo_url: asset.url,
          }));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load preset.";
        setPresetMessage({ variant: "error", text: message });
      } finally {
        setIsLoadingPreset(false);
      }
    },
    [ensureDraftEmailer]
  );

  // STORY-AP1.2: save the current identity fields as a new preset. If a logo
  // asset is set, best-effort attach it: fetch the logo URL as a blob and
  // POST it to the new preset's /logo endpoint. On logo failure we keep the
  // text/color preset and tell the user to add the logo in Manage Presets.
  const handleSaveAsPreset = useCallback(async () => {
    setPresetMessage(null);
    const current = formRef.current;
    // Require the three core identity fields before saving a preset.
    if (
      !current.impersonation_sender_name.trim() ||
      !current.impersonation_sender_email.trim() ||
      !current.impersonation_pretends_to_be.trim()
    ) {
      setPresetMessage({
        variant: "error",
        text: "Fill in the brand name, sender email, and pretext before saving a preset.",
      });
      return;
    }
    setIsSavingPreset(true);
    try {
      const created = await createPreset({
        name: current.impersonation_sender_name.trim(),
        sender_email: current.impersonation_sender_email.trim(),
        primary_color: current.impersonation_primary_color.trim() || null,
        pretends_to_be: current.impersonation_pretends_to_be.trim(),
      });

      let logoNote = "";
      if (current.impersonation_logo_url) {
        try {
          const res = await fetch(current.impersonation_logo_url);
          if (!res.ok) {
            throw new Error(`Logo fetch failed: ${res.status}`);
          }
          const blob = await res.blob();
          const file = new File([blob], "preset-logo", {
            type: blob.type || "image/png",
          });
          await uploadPresetLogo(created.id, file);
        } catch {
          logoNote =
            " The logo couldn't be attached automatically. Add it in Manage presets.";
        }
      }

      // Refresh the dropdown list so the new preset is selectable.
      try {
        const list = await listPresets();
        setPresets(list);
      } catch {
        // Ignore — the create itself succeeded.
      }

      setPresetMessage({
        variant: "success",
        text: `Saved "${created.name}" as an impersonation preset.${logoNote}`,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save preset.";
      setPresetMessage({ variant: "error", text: message });
    } finally {
      setIsSavingPreset(false);
    }
  }, []);

  /**
   * Run the generate step against an existing emailer id and navigate to
   * the editor on success. Surfaces a generation-failure block (AC-1) on
   * 422 and a generic apiError banner for any other failure.
   *
   * Extracted so the Retry button can re-issue exactly the same request
   * the original submit issued, without re-running the create/PATCH path.
   */
  const runGenerate = useCallback(
    async (emailerId: number) => {
      setApiError(null);
      setGenerationFailedFor(null);
      setIsSubmitting(true);
      try {
        await generateEmailer(emailerId);
        navigate(`/emailers/${emailerId}`);
      } catch (err) {
        if (err instanceof MJMLValidationError) {
          // AC-1: dedicated retry surface — keep form fields, show one
          // clear action button.
          setGenerationFailedFor(emailerId);
        } else {
          const message =
            err instanceof Error ? err.message : "An unexpected error occurred.";
          setApiError(message);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [navigate]
  );

  // AC-1: when the generation-failure surface appears, move focus to the
  // Retry button so a keyboard user can recover without hunting for it.
  useEffect(() => {
    if (generationFailedFor !== null) {
      retryButtonRef.current?.focus();
    }
  }, [generationFailedFor]);

  const handleRetryGenerate = useCallback(() => {
    if (generationFailedFor !== null) {
      void runGenerate(generationFailedFor);
    }
  }, [generationFailedFor, runGenerate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);
    setGenerationFailedFor(null);

    const allErrors = validateForm(form);
    if (Object.keys(allErrors).length > 0) {
      // Mark all required fields as touched so errors appear
      const allTouched: Partial<Record<keyof FormState, boolean>> = {};
      for (const key of Object.keys(allErrors) as Array<keyof FormErrors>) {
        allTouched[key] = true;
      }
      setTouched((prev) => ({ ...prev, ...allTouched }));
      setSubmitErrors(allErrors);
      return;
    }

    setIsSubmitting(true);
    let resultId: number | null = null;
    try {
      // STORY-A5.1 (kept after CR-001): the form no longer has a content
      // summary field, but library asset references must still reach the
      // generator. When the user attached library assets, fold their URLs
      // into the still-accepted (optional) ``content_summary`` so the model
      // can reference them in the MJML output; otherwise omit it entirely.
      let contentSummary: string | null = null;
      if (libraryAssets.length > 0) {
        const assetLines = libraryAssets.map((a) => {
          const url =
            a.primary_version?.storage_url ??
            a.primary_version?.thumbnail_url ??
            "";
          return `- ${a.name}: ${url}`;
        });
        contentSummary = `Library asset references:\n${assetLines.join("\n")}`;
      }

      const payload: EmailerCreate = {
        name: form.name.trim(),
        // CR-001: pretext scenario is required and replaces category.
        pretext_scenario: form.pretext_scenario as PretextScenario,
        // CR-001: Target recipients + Length are optional; send when present,
        // null when blank. category/content_summary/tone are NOT sent from the
        // form anymore (content_summary only carries library-asset refs).
        target_audience: form.target_audience.trim() || null,
        content_summary: contentSummary,
        cta_text: form.cta_text.trim() || null,
        cta_url: form.cta_url.trim() || null,
        length: form.length || null,
        // STORY-AP2.2: impersonated identity. Required three are validated
        // above; colour and logo are optional and sent as null when unset.
        impersonation_sender_name: form.impersonation_sender_name.trim(),
        impersonation_sender_email: form.impersonation_sender_email.trim(),
        impersonation_pretends_to_be: form.impersonation_pretends_to_be.trim(),
        impersonation_primary_color:
          form.impersonation_primary_color.trim() || null,
        impersonation_logo_asset_id: form.impersonation_logo_asset_id,
        // STORY-AP2.1: pretext. Lure type + urgency validated above; the
        // "tell" is optional and sent as null when unset.
        lure_type: form.lure_type as LureType,
        urgency_level: form.urgency_level as UrgencyLevel,
        pretext_tell: form.pretext_tell.trim() || null,
      };

      if (draftEmailerId !== null) {
        // STORY-2.6: a draft already exists (created when the user
        // uploaded an asset). Patch it with the full brief; backend
        // validates that every required field is now present.
        const patchBody: EmailerUpdate = {
          name: payload.name,
          // CR-001: pretext scenario replaces category; category/tone are no
          // longer sent. content_summary carries only library-asset refs.
          pretext_scenario: payload.pretext_scenario,
          target_audience: payload.target_audience ?? undefined,
          content_summary: payload.content_summary ?? undefined,
          cta_text: payload.cta_text,
          cta_url: payload.cta_url,
          length: payload.length ?? undefined,
          // STORY-AP2.2
          impersonation_sender_name: payload.impersonation_sender_name,
          impersonation_sender_email: payload.impersonation_sender_email,
          impersonation_pretends_to_be: payload.impersonation_pretends_to_be,
          impersonation_primary_color: payload.impersonation_primary_color,
          impersonation_logo_asset_id: payload.impersonation_logo_asset_id,
          // STORY-AP2.1
          lure_type: payload.lure_type,
          urgency_level: payload.urgency_level,
          pretext_tell: payload.pretext_tell,
        };
        const patched = await updateEmailer(draftEmailerId, patchBody);
        resultId = patched.id;
      } else {
        const result = await createEmailer(payload);
        resultId = result.id;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      setApiError(message);
      setIsSubmitting(false);
      return;
    }

    // STORY-7.12 AC-1: kick off the generation step. ``runGenerate``
    // owns the post-create lifecycle (navigate on success, retry surface
    // on 422). It also resets ``isSubmitting`` for us so we don't need a
    // finally here.
    await runGenerate(resultId);
  }

  return (
    // STORY-AP7.1 chunk 2: global wordmark + user menu live in the app shell
    // (TopBar). The brief form now uses the ds component vocabulary + AP0.2
    // tokens throughout.
    <div className="min-h-full bg-surface-base">
      <main className="p-8">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Page header */}
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1 rounded-ds-sm text-label text-ink-muted transition-colors hover:text-ink-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Back to simulations
            </Link>
            <h1 className="mt-2 text-display text-ink-strong">
              Create new simulation
            </h1>
            <p className="mt-1 text-body text-ink-muted">
              Fill in the brief and we will generate your simulation template.
            </p>
          </div>

          {/* API error banner */}
          {apiError && (
            <div
              role="alert"
              className="rounded-ds-md border border-danger bg-danger-subtle px-4 py-3 text-body text-danger"
            >
              <strong className="font-medium">Error:</strong> {apiError}
            </div>
          )}

          {/* STORY-7.12 AC-1: generation failure surface.
              One clear remediation button, no passive warning banner.
              Form fields are intentionally NOT cleared so the user can
              retry the same brief; focus moves to the Retry button via
              the effect above. */}
          {generationFailedFor !== null && (
            <div
              role="alert"
              data-testid="generation-error"
              className="rounded-ds-md border border-danger bg-danger-subtle px-4 py-4 text-body text-danger"
            >
              <p className="font-medium">
                Generation produced invalid output. Please retry.
              </p>
              <div className="mt-3">
                <Button
                  variant="danger"
                  ref={retryButtonRef}
                  onClick={handleRetryGenerate}
                  loading={isSubmitting}
                >
                  {isSubmitting ? "Retrying…" : "Retry"}
                </Button>
              </div>
            </div>
          )}

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* CR-001 §4 flow: Basics → Impersonated identity → Pretext →
              Sample emails to mimic → Call to action → Targeting & options.
              Reads top-to-bottom as who → why/how → what it looks like →
              the hook → who/extras. */}

          {/* Section: Basics */}
          <FormSection title="Basics">
            <Field label="Template name" error={visibleErrors.name}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="text"
                  maxLength={100}
                  placeholder="e.g. Q4 security-awareness test"
                  value={form.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  onBlur={() => markTouched("name")}
                />
              )}
            </Field>
          </FormSection>

          {/* Section: Impersonated identity (STORY-AP2.2).
              Defines the brand/sender this simulation mimics. */}
          <ImpersonationSection
            form={form}
            errors={visibleErrors}
            isLogoUploading={isLogoUploading}
            logoError={logoError}
            onChange={handleChange}
            onMarkTouched={markTouched}
            onLogoSelected={handleLogoSelected}
            onRemoveLogo={handleRemoveLogo}
            presets={presets}
            presetsLoading={presetsLoading}
            selectedPresetId={selectedPresetId}
            isLoadingPreset={isLoadingPreset}
            presetMessage={presetMessage}
            isSavingPreset={isSavingPreset}
            onLoadPreset={(id) => void handleLoadPreset(id)}
            onSaveAsPreset={() => void handleSaveAsPreset()}
          />

          {/* Section: Pretext (STORY-AP2.1).
              Lure type, urgency, and the intended "tell". The spoofed sender
              is reflected read-only from the impersonation section (de-dup). */}
          <PretextSection
            form={form}
            errors={visibleErrors}
            onChange={handleChange}
            onMarkTouched={markTouched}
          />

          {/* Section: Sample emails to mimic (STORY-AP2.3).
              Reuses AssetUploadPanel as a second configured instance scoped to
              kind="sample": its own internal queue/state, no library picker,
              and a sample-specific title + helper copy. Separate from the
              in-email "Assets (optional)" panel above (which stays kind
              "content"). Optional — no validation gate. Shares the same draft
              emailer via the ensure-draft flow. */}
          <div data-testid="samples-section">
            <AssetUploadPanel
              kind="sample"
              title="Sample emails to mimic"
              description="Upload the genuine email you're simulating. Used as a style reference only."
              showLibraryPicker={false}
              fileInputLabel="Upload sample emails"
              fileInputTestId="sample-file-input"
              uploadBoxLabel="Upload sample screenshot"
              emailerId={draftEmailerId}
              onEnsureEmailer={ensureDraftEmailer}
              onEmailerIdChange={setDraftEmailerId}
              onUploadingChange={setIsSamplesUploading}
            />
          </div>

          {/* Section: Call to action (CR-001 — relabeled from "CTA").
              This is the lure link the simulation drives clicks to: the link
              text the recipient sees and the tracked URL behind it. */}
          <FormSection
            title="Call to action"
            description="The lure link the simulation drives clicks to — the text the recipient sees and the tracked URL behind it."
          >
            <Field
              label="Call to action"
              required={false}
              help="The link/button text the recipient sees (e.g. 'Review your account')."
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="text"
                  placeholder="e.g. Review your account"
                  value={form.cta_text}
                  onChange={(e) => handleChange("cta_text", e.target.value)}
                />
              )}
            </Field>

            <Field
              label="Tracked URL"
              required={false}
              help="The lure/tracking link clicks are driven to."
            >
              {({ id }) => (
                <Input
                  id={id}
                  mono
                  type="url"
                  placeholder="https://login.contoso-verify.com/…"
                  value={form.cta_url}
                  onChange={(e) => handleChange("cta_url", e.target.value)}
                />
              )}
            </Field>
          </FormSection>

          {/* Section: Targeting & options (CR-001 §4 — all optional).
              Target recipients, Length, and the in-email assets panel. */}
          <FormSection
            title="Targeting & options"
            description="Optional targeting context and practical knobs."
          >
            <Field
              label="Target recipients"
              required={false}
              error={visibleErrors.target_audience}
              help="Who is being tested (optional)."
            >
              {({ id, describedBy, invalid }) => (
                <>
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    rows={3}
                    maxLength={500}
                    placeholder="e.g. Finance team staff, 25 to 45, on the corporate VPN"
                    value={form.target_audience}
                    onChange={(e) =>
                      handleChange("target_audience", e.target.value)
                    }
                    onBlur={() => markTouched("target_audience")}
                  />
                  <p className="text-right text-caption font-normal normal-case tracking-normal text-ink-faint">
                    {form.target_audience.length}/500
                  </p>
                </>
              )}
            </Field>

            <Field label="Length" required={false}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={form.length}
                  onChange={(e) =>
                    handleChange("length", e.target.value as Length | "")
                  }
                  onBlur={() => markTouched("length")}
                >
                  <option value="">Select a length</option>
                  {LENGTH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FormSection>

          {/* In-email assets (STORY-2.6). Optional images the generator can
              reference in the MJML. Lives in the Targeting & options group. */}
          <AssetUploadPanel
            emailerId={draftEmailerId}
            onEnsureEmailer={ensureDraftEmailer}
            onEmailerIdChange={setDraftEmailerId}
            onUploadingChange={setIsUploading}
            libraryAssets={libraryAssets}
            onLibraryAssetsChange={setLibraryAssets}
          />

          {/* Submit */}
          <div className="flex flex-col items-end gap-1">
            {(isUploading || isSamplesUploading) && !isSubmitting && (
              <p className="text-caption font-normal normal-case tracking-normal text-ink-muted">
                Waiting for asset uploads to finish...
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isSubmitting}
              disabled={isUploading || isSamplesUploading || isLogoUploading}
            >
              {isSubmitting ? "Generating…" : "Generate"}
            </Button>
          </div>
        </form>
        </div>
      </main>
    </div>
  );
}
