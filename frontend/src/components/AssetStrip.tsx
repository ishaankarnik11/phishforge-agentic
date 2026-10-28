// Read-only asset strip for the EmailerPage left pane (STORY-2.6 AC-8).
//
// Shows thumbnails for every asset attached to an emailer. Clicking a
// thumbnail copies its absolute URL to the clipboard so the user can
// paste it into the AI chat panel ("replace the hero with this image").
//
// Out of scope here: uploading new assets, re-ordering, or replacing.

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAssets, type AssetRead } from "../api/assets";

interface AssetStripProps {
  emailerId: number;
}

export default function AssetStrip({ emailerId }: AssetStripProps) {
  const [open, setOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["assets", emailerId],
    queryFn: () => listAssets(emailerId),
    enabled: !Number.isNaN(emailerId),
  });

  const handleCopy = useCallback(async (asset: AssetRead) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopiedId(asset.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === asset.id ? null : prev));
      }, 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts. The URL is
      // already visible in the title attribute, so the user can still
      // see it -- nothing else we can do here.
    }
  }, []);

  const assets = query.data ?? [];

  if (!query.isLoading && assets.length === 0) {
    // Don't take up space if there's nothing to show.
    return null;
  }

  return (
    <div
      className="border-b border-border-subtle bg-surface-raised"
      data-testid="asset-strip"
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="asset-strip-list"
        className="flex w-full items-center justify-between px-3 py-1.5 text-label text-ink-muted hover:bg-surface-sunken"
      >
        <span>
          Assets{" "}
          <span className="text-ink-faint">
            ({assets.length})
          </span>
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div id="asset-strip-list" className="px-3 pb-2">
          {query.isLoading && (
            <p className="py-2 text-caption font-normal normal-case tracking-normal text-ink-faint">
              Loading assets...
            </p>
          )}
          {query.isError && (
            <p
              role="alert"
              className="py-2 text-caption font-normal normal-case tracking-normal text-danger"
            >
              Failed to load assets.
            </p>
          )}
          {!query.isLoading && assets.length > 0 && (
            <ul
              role="list"
              aria-label="Emailer assets"
              className="flex gap-2 overflow-x-auto py-1"
            >
              {assets.map((asset) => (
                <li
                  key={asset.id}
                  role="listitem"
                  className="shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => void handleCopy(asset)}
                    title={`Click to copy URL: ${asset.url}`}
                    aria-label={`Copy URL for ${asset.label}`}
                    className="group relative flex w-16 flex-col items-center gap-0.5 rounded-ds-sm border border-border-subtle bg-surface-raised p-1 transition-colors hover:border-accent-border hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <div className="h-12 w-full overflow-hidden rounded-ds-sm bg-surface-sunken">
                      <img
                        src={asset.url}
                        alt={asset.label}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <span className="block w-full truncate text-[10px] text-ink-muted">
                      {copiedId === asset.id ? "Copied!" : asset.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
