import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { GLOBAL_SCOPE_ROLES } from '../constants';

const ScopeContext = createContext(null);

/**
 * The outlet directory, fetched once for the whole session.
 *
 * This used to back the top bar's Organization / Brand / Outlet selectors and
 * appended ?org=/?brand=/?outlet= to five pages' requests. Those selectors are
 * gone, and with them the org/brand tree, the cascade setters and the query
 * builder — scoping is decided entirely server-side from the caller's role
 * (see server/src/lib/scope.js).
 *
 * What remains is the single GET /outlets that two pages still need:
 *   - ShiftsPage, for its outlet tab strip
 *   - EmployeesPage, for the Outlet field on its add/edit modal
 *
 * `locked` comes along because ShiftsPage uses it to choose between the tab
 * strip and a plain heading: a role pinned to one outlet has nothing to switch
 * between.
 */
export function ScopeProvider({ children }) {
  const { user } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  const locked = !!user && !GLOBAL_SCOPE_ROLES.includes(user.role);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    api
      .get('/outlets')
      .then((data) => {
        if (!cancelled) setOutlets(data);
      })
      .catch(() => {
        if (!cancelled) setOutlets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const value = useMemo(() => ({ outlets, loading, locked }), [outlets, loading, locked]);

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export const useScope = () => useContext(ScopeContext);
