import type { ReactElement } from 'react';

export type NoticeKind = 'info' | 'error' | 'empty';

export interface NoticeProps {
  readonly kind: NoticeKind;
  readonly title: string;
  readonly detail?: string | undefined;
}

/**
 * A single-line explanation of a state that has no data to render.
 *
 * An error is announced (`role="alert"`) and everything else is a status
 * update, so a screen reader hears a failure immediately and a change of state
 * politely. The two are the same component because they are the same shape of
 * message — what differs is how urgent it is.
 */
export function Notice({ kind, title, detail }: NoticeProps): ReactElement {
  return (
    <div className={`notice notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p className="notice__title">{title}</p>
      {detail === undefined ? null : <p className="notice__detail">{detail}</p>}
    </div>
  );
}
