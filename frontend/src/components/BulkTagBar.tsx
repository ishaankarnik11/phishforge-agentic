/**
 * BulkTagBar — floating action bar shown when assets are selected in
 * multi-select mode (STORY-A1.3).
 *
 * Fixed at the bottom of the viewport. Provides tag input with autocomplete
 * and buttons to add/remove tags on the selected assets.
 *
 * STORY-AP7.1 (chunk 3): restyled onto the design system. The bar floats above
 * the page, so it carries the Overlay shadow (DESIGN.md §4) over a raised
 * surface. Input uses the shared field frame; actions use ds/Button.
 */

import { useState, useRef } from "react";
import { Input } from "./ds";
import { Button } from "./ds";

export interface BulkTagBarProps {
  selectedCount: number;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  onDeselectAll: () => void;
  isLoading: boolean;
  existingTags: string[];
}

export default function BulkTagBar({
  selectedCount,
  onAddTag,
  onRemoveTag,
  onDeselectAll,
  isLoading,
  existingTags,
}: BulkTagBarProps) {
  const [tagInput, setTagInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedTag = tagInput.trim();

  const handleAddTag = () => {
    if (trimmedTag) {
      onAddTag(trimmedTag);
      setTagInput("");
    }
  };

  const handleRemoveTag = () => {
    if (trimmedTag) {
      onRemoveTag(trimmedTag);
      setTagInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && trimmedTag) {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div
      data-testid="bulk-tag-bar"
      className="fixed bottom-lg left-1/2 z-50 flex -translate-x-1/2 items-center gap-md rounded-ds-md border border-border-subtle bg-surface-raised px-lg py-sm shadow-overlay"
    >
      {/* Left: count + deselect */}
      <div className="flex items-center gap-sm">
        <span
          data-testid="bulk-tag-selected-count"
          className="text-label text-ink-strong"
        >
          {selectedCount} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="bulk-tag-deselect-all"
          onClick={onDeselectAll}
        >
          Deselect all
        </Button>
      </div>

      {/* Middle: tag input with datalist */}
      <div className="flex items-center gap-xs">
        <Input
          ref={inputRef}
          data-testid="bulk-tag-input"
          list="bulk-tag-suggestions"
          placeholder="Enter tag..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          className="w-40"
        />
        <datalist id="bulk-tag-suggestions">
          {existingTags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-xs">
        <Button
          variant="primary"
          data-testid="bulk-tag-add-btn"
          onClick={handleAddTag}
          disabled={isLoading || !trimmedTag}
          leadingIcon={
            isLoading ? (
              <span
                data-testid="bulk-tag-add-spinner"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : undefined
          }
        >
          Add Tag
        </Button>
        <Button
          variant="secondary"
          data-testid="bulk-tag-remove-btn"
          onClick={handleRemoveTag}
          disabled={isLoading || !trimmedTag}
          leadingIcon={
            isLoading ? (
              <span
                data-testid="bulk-tag-remove-spinner"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : undefined
          }
        >
          Remove Tag
        </Button>
      </div>
    </div>
  );
}
