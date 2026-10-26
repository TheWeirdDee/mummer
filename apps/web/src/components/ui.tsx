import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { copyText } from '../lib/browser';

/* ---------- Buttons ---------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
interface ButtonStyle {
  variant?: Variant;
  size?: 'small' | 'normal' | 'large';
  block?: boolean;
}
const btnClass = ({ variant = 'secondary', size = 'normal', block }: ButtonStyle) =>
  ['btn', `btn--${variant}`, size === 'large' && 'btn--large', size === 'small' && 'btn--small', block && 'btn--block'].filter(Boolean).join(' ');

export function Button({
  variant,
  size,
  block,
  loading,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonStyle & { loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type={type} className={btnClass({ variant, size, block })} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function LinkButton({ variant, size, block, children, ...rest }: ButtonStyle & LinkProps) {
  return (
    <Link {...rest} className={btnClass({ variant, size, block })}>
      {children}
    </Link>
  );
}

export function ExternalLinkButton({ variant, size, block, children, ...rest }: ButtonStyle & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...rest} className={btnClass({ variant, size, block })}>
      {children}
    </a>
  );
}

/* ---------- Fields ---------- */

interface FieldBase {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  counter?: { value: number; max: number };
}

function useFieldIds(explicit?: string) {
  const auto = useId();
  const id = explicit ?? auto;
  return { id, hintId: `${id}-hint`, errId: `${id}-err` };
}

function describedBy(hint: boolean, error: boolean, ids: { hintId: string; errId: string }) {
  return [hint && ids.hintId, error && ids.errId].filter(Boolean).join(' ') || undefined;
}

export const TextField = forwardRef<HTMLInputElement, FieldBase & InputHTMLAttributes<HTMLInputElement>>(function TextField({ label, hint, error, counter, className, id: explicit, ...rest }, ref) {
  const ids = useFieldIds(explicit);
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      {hint && (
        <p className="hint" id={ids.hintId}>
          {hint}
        </p>
      )}
      <input ref={ref} id={ids.id} className={`input ${className ?? ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy(!!hint, !!error, ids)} {...rest} />
      {error && (
        <p className="error" id={ids.errId} role="alert">
          {error}
        </p>
      )}
      {counter && <Counter {...counter} />}
    </div>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextAreaField({ label, hint, error, counter, className, id: explicit, ...rest }, ref) {
  const ids = useFieldIds(explicit);
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      {hint && (
        <p className="hint" id={ids.hintId}>
          {hint}
        </p>
      )}
      <textarea ref={ref} id={ids.id} className={`textarea ${className ?? ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy(!!hint, !!error, ids)} {...rest} />
      {error && (
        <p className="error" id={ids.errId} role="alert">
          {error}
        </p>
      )}
      {counter && <Counter {...counter} />}
    </div>
  );
});

export function SelectField({ label, hint, error, children, id: explicit, ...rest }: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const ids = useFieldIds(explicit);
  return (
    <div className="field">
      <label htmlFor={ids.id}>{label}</label>
      {hint && (
        <p className="hint" id={ids.hintId}>
          {hint}
        </p>
      )}
      <select id={ids.id} className="select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(!!hint, !!error, ids)} {...rest}>
        {children}
      </select>
      {error && (
        <p className="error" id={ids.errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return (
    <div className="counter" data-over={value > max} aria-live="polite">
      {value} / {max}
    </div>
  );
}

export function ChoiceGroup<T extends string>({
  legend,
  hint,
  name,
  value,
  onChange,
  options,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  name: string;
  value: T | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; detail?: ReactNode }[];
}) {
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      {hint && (
        <p className="hint" style={{ marginTop: 0 }}>
          {hint}
        </p>
      )}
      {options.map((o) => (
        <label key={o.value} className="choice">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {o.detail && <small>{o.detail}</small>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function CheckField({ checked, onChange, children, error, id: explicit }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string; id?: string }) {
  const ids = useFieldIds(explicit);
  return (
    <div className="field">
      <label className="choice" htmlFor={ids.id}>
        <input id={ids.id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={error ? true : undefined} aria-describedby={error ? ids.errId : undefined} />
        <span>{children}</span>
      </label>
      {error && (
        <p className="error" id={ids.errId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ErrorSummary({ errors }: { errors: { id: string; message: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors.length]);
  if (errors.length === 0) return null;
  return (
    <div className="error-summary" role="alert" tabIndex={-1} ref={ref}>
      <h2>Please fix {errors.length === 1 ? 'this' : 'these'} before continuing</h2>
      <ul>
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                document.getElementById(e.id)?.focus();
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Feedback ---------- */

const ICONS = { info: 'i', warn: '!', danger: '!', success: '✓' } as const;

export function Notice({ tone = 'info', title, children, live }: { tone?: keyof typeof ICONS; title?: ReactNode; children: ReactNode; live?: 'polite' | 'assertive' }) {
  return (
    <div className={`notice notice--${tone}`} role={live === 'assertive' ? 'alert' : live ? 'status' : undefined}>
      <span className="notice__icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div>
        {title && (
          <strong className="notice__title">
            {tone === 'warn' && <span className="sr-only">Warning: </span>}
            {tone === 'danger' && <span className="sr-only">Problem: </span>}
            {title}
          </strong>
        )}
        {children}
      </div>
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'wax' | 'pine' | 'gold' }) {
  return <span className={`badge${tone ? ` badge--${tone}` : ''}`}>{children}</span>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${100 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, label, ariaLabel = 'Progress' }: { value: number; max: number; label: ReactNode; ariaLabel?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="progress">
      <div className="progress__label">{label}</div>
      <div className="progress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-label={ariaLabel}>
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Disclosure({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="disclosure" open={open}>
      <summary>{summary}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}

export function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="steps" aria-label="Progress">
      {labels.map((l, i) => (
        <li key={l} aria-current={i === current ? 'step' : undefined} data-done={i < current}>
          <span>{l}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Copy ---------- */

export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied', size = 'small', variant = 'secondary', describe }: { text: string; label?: string; copiedLabel?: string; size?: 'small' | 'normal'; variant?: Variant; describe?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onClick = useCallback(async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2500);
  }, [text]);
  return (
    <>
      <Button variant={variant} size={size} onClick={onClick} aria-label={describe ? `${label} ${describe}` : undefined}>
        {state === 'copied' ? copiedLabel : state === 'failed' ? 'Select and copy' : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? `${describe ?? 'Text'} copied to clipboard` : state === 'failed' ? 'Copy failed. Select the text and copy it manually.' : ''}
      </span>
    </>
  );
}

export function CopyField({ label, value, hint, mono = true, describe }: { label: string; value: string; hint?: ReactNode; mono?: boolean; describe?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="copyfield">
        <input id={id} className={`input${mono ? ' mono' : ''}`} readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <CopyButton text={value} describe={describe ?? label} />
      </div>
    </div>
  );
}

/* ---------- Dialog (native <dialog>: focus trap, Escape, backdrop) ---------- */

export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // Keep Tab / Shift+Tab inside the dialog (a native modal still lets focus escape to browser chrome).
        if (e.key !== 'Tab') return;
        const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((n) => n.offsetParent !== null);
        if (nodes.length === 0) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog__body">
          <h2 id={titleId}>{title}</h2>
          {children}
          <div className="dialog__actions">{actions}</div>
        </div>
      )}
    </dialog>
  );
}

export function StatusLine({ children, tone }: { children: ReactNode; tone?: 'ok' | 'bad' }) {
  return (
    <p role="status" aria-live="polite" className={tone === 'ok' ? 'yes' : tone === 'bad' ? 'no' : 'muted'} style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-1)' }}>
      {children}
    </p>
  );
}

/**
 * Data table that stacks into labelled cards on narrow screens, so no column is ever hidden off-screen.
 * Each cell's label is read from its column header at runtime, so content changes cannot desynchronise them.
 */
export function ResponsiveTable({ label, caption, children }: { label: string; caption: string; children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent ?? '');
    // Stacked cards drop native table semantics in some browsers, so state them explicitly.
    table.setAttribute('role', 'table');
    table.querySelectorAll('thead, tbody').forEach((g) => g.setAttribute('role', 'rowgroup'));
    table.querySelectorAll('tr').forEach((r) => r.setAttribute('role', 'row'));
    table.querySelectorAll('thead th').forEach((h) => h.setAttribute('role', 'columnheader'));
    table.querySelectorAll('tbody th').forEach((h) => h.setAttribute('role', 'rowheader'));
    table.querySelectorAll('tbody td').forEach((d) => d.setAttribute('role', 'cell'));
    table.querySelectorAll('tbody tr').forEach((row) => {
      Array.from(row.children).forEach((cell, i) => {
        if (i > 0 || cell.tagName === 'TD') cell.setAttribute('data-label', heads[i] ?? '');
      });
    });
  });
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      <table className="table table--stack" ref={ref}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
