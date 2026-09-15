import type { ReactElement, ReactNode } from 'react';

export interface FieldProps {
  readonly label: string;
  readonly children: ReactNode;
  /** The full value behind a shortened one, revealed on hover. */
  readonly title?: string | undefined;
  readonly mono?: boolean;
}

export function Field({ label, children, title, mono = false }: FieldProps): ReactElement {
  return (
    <div className="field">
      <dt className="field__label">{label}</dt>
      <dd className={`field__value${mono ? ' field__value--mono' : ''}`} title={title}>
        {children}
      </dd>
    </div>
  );
}

/** A description list, which is what a set of label/value pairs actually is. */
export function FieldGrid({ children }: { readonly children: ReactNode }): ReactElement {
  return <dl className="field-grid">{children}</dl>;
}
