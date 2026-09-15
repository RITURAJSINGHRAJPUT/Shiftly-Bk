import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import api from '../api/client';

/**
 * Find someone in the punch directory by name.
 *
 * The employee-code field assumes you already know the code. Whoever is
 * enrolling usually knows the person instead, so this searches the directory
 * the other way round and hands back both halves at once.
 *
 * Deliberately not a generic combobox: the client has no listbox primitive, and
 * one written to cover every case would be far more code than the single
 * search this needs.
 */
export default function DirectoryPicker({ onPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Same 400 ms as the code lookup above it, so typing in either field feels
    // like the same control.
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/directory?search=${encodeURIComponent(q)}&limit=8`);
        if (!cancelled) setResults(res.entries || []);
      } catch {
        // A role without directory access, or an offline moment. The code field
        // still works on its own.
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  function choose(entry) {
    onPick({ userid: entry.userid, name: entry.name });
    setOpen(false);
    setQuery('');
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setOpen(true)}>
        <Search size={14} /> Find by name
      </button>
    );
  }

  return (
    <div className="directory-picker mt-1">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          className="form-input"
          placeholder="Search the punch directory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close search">
          <X size={14} />
        </button>
      </div>

      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="text-xs text-muted mt-1">Keep typing…</p>
      )}
      {loading && <p className="text-xs text-muted mt-1">Searching…</p>}
      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="text-xs text-muted mt-1">
          Nobody by that name in the directory. If they are new, ask HR to add them.
        </p>
      )}

      {results.length > 0 && (
        <ul className="directory-results divided-list mt-1">
          {results.map((entry) => {
            // Already enrolled, so picking it would only produce a duplicate
            // code error on save. Shown rather than hidden, so it is clear the
            // person was found and why they cannot be chosen.
            const taken = Boolean(entry.claimedBy);
            return (
              <li key={entry.userid}>
                <button
                  type="button"
                  className="directory-result"
                  onClick={() => choose(entry)}
                  disabled={taken}
                  title={taken ? 'Already enrolled' : undefined}
                >
                  <span className="font-semibold">{entry.name || '(no name)'}</span>
                  <span className="badge badge-ghost">{entry.userid}</span>
                  {taken && (
                    <span className="text-xs text-muted">
                      already enrolled{entry.claimedBy.outlet ? ` · ${entry.claimedBy.outlet}` : ''}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
