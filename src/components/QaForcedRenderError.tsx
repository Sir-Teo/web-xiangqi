import type { ReactNode } from 'react';

export function QaForcedRenderError(): ReactNode {
  throw new Error('Forced error boundary QA');
}
