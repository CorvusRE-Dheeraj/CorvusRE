import { useState, type DragEvent } from "react";

// Drag-and-drop for the app's file-upload spots — several already have a dashed
// border or "Drop any tax notice..." copy implying this works, but none actually
// wired up drag events, only a hidden <input type="file">. Only the first dropped
// file is used, matching the existing single-file `e.target.files?.[0]` behavior
// everywhere this attaches. No new file-type validation on drop — a dropped file
// hits the exact same downstream call (classifyAndStoreDocument, uploadDocument)
// and existing catch-block error handling as one picked via the browser, so an
// unsupported file fails exactly the same way it already does today.
export function useFileDrop(onFile: (file: File) => void, disabled?: boolean) {
  const [isDragging, setIsDragging] = useState(false);

  return {
    isDragging,
    dropHandlers: {
      onDragOver: (e: DragEvent) => {
        if (disabled) return;
        e.preventDefault();
        setIsDragging(true);
      },
      onDragLeave: (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      },
    },
  };
}
