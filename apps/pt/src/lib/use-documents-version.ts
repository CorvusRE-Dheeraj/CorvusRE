import { useEffect, useState } from "react";
import { onDocumentsChanged } from "./documents";

// A counter that bumps whenever any document is added/changed/removed —
// here or in another open tab (see notifyDocumentsChanged). Put it in a data-
// loading effect's dependency array to refetch documents when that happens.
export function useDocumentsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onDocumentsChanged(() => setVersion((v) => v + 1)), []);
  return version;
}
