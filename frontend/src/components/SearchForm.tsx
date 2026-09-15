import { useState, type FormEvent, type ReactElement } from 'react';

export type SearchMode = 'farmer' | 'region';

export interface SearchValues {
  readonly mode: SearchMode;
  readonly value: string;
  readonly limit: number;
}

export interface SearchFormProps {
  readonly onSearch: (values: SearchValues) => void;
  readonly busy: boolean;
  /** How many policies the list hydrates when nothing else is asked for. */
  readonly initialLimit: number;
}

const MAX_LIMIT = 100;

/**
 * The lookup control.
 *
 * One filter, chosen by a toggle, because the API accepts exactly one: it
 * answers a 400 when both `farmer` and `region` are given and scans its whole
 * book when neither is.
 *
 * The only client-side check is that the field is not empty. Whether a value is
 * a usable farmer address or region symbol is the backend's answer to give — it
 * verifies a strkey's checksum and a symbol's byte length, neither of which a
 * browser-side pattern can do honestly — and its 400 already explains the
 * problem in the same shape as every other failure.
 */
export function SearchForm({ onSearch, busy, initialLimit }: SearchFormProps): ReactElement {
  const [mode, setMode] = useState<SearchMode>('farmer');
  const [value, setValue] = useState('');
  const [limit, setLimit] = useState(String(initialLimit));

  const empty = value.trim() === '';

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (empty) return;

    const parsed = Number.parseInt(limit, 10);
    const clamped = Number.isSafeInteger(parsed)
      ? Math.min(MAX_LIMIT, Math.max(1, parsed))
      : initialLimit;

    onSearch({ mode, value: value.trim(), limit: clamped });
  }

  return (
    <form className="search" onSubmit={submit}>
      <div className="search__modes" role="radiogroup" aria-label="Search policies by">
        {(['farmer', 'region'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            className={`search__mode${mode === option ? ' search__mode--on' : ''}`}
            onClick={() => {
              setMode(option);
            }}
          >
            {option === 'farmer' ? 'Farmer' : 'Region'}
          </button>
        ))}
      </div>

      <label className="search__field">
        <span className="search__label">
          {mode === 'farmer' ? 'Farmer account' : 'Region symbol'}
        </span>
        <input
          className="input"
          type="text"
          name={mode}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          placeholder={mode === 'farmer' ? 'G…' : 'ng_kaduna'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      <label className="search__field search__field--narrow">
        <span className="search__label">Hydrate at most</span>
        <input
          className="input"
          type="number"
          name="limit"
          min={1}
          max={MAX_LIMIT}
          value={limit}
          onChange={(event) => {
            setLimit(event.target.value);
          }}
        />
      </label>

      <button type="submit" className="button" disabled={busy || empty}>
        {busy ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}
