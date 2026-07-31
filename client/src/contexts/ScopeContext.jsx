import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';
import { GLOBAL_SCOPE_ROLES } from '../constants';

const ScopeContext = createContext(null);

/**
 * Organization / Brand / Outlet selection for the top bar.
 *
 * The whole tree is derived from a single GET /outlets — each outlet already
 * carries its brand and organization, so there is no need for three requests or
 * a bespoke tree endpoint.
 *
 * For a role without global scope the server pins every query to that user's
 * own outlet regardless of what is sent, so the selectors render disabled
 * rather than offering choices that would be silently ignored.
 */
export function ScopeProvider({ children }) {
  const { user } = useAuth();
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);

  const locked = !!user && !GLOBAL_SCOPE_ROLES.includes(user.role);

  const [orgId, setOrgId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [outletId, setOutletId] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    api
      .get('/outlets')
      .then((data) => {
        if (cancelled) return;
        setOutlets(data);
        // A locked user's scope is fixed to their own outlet.
        if (locked && user.outletId) setOutletId(user.outletId);
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
  }, [user, locked]);

  const organizations = useMemo(() => {
    const seen = new Map();
    outlets.forEach((o) => {
      const org = o.brand?.organization;
      if (org && !seen.has(org.id)) seen.set(org.id, org);
    });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [outlets]);

  const brands = useMemo(() => {
    const seen = new Map();
    outlets
      .filter((o) => !orgId || o.brand?.organization?.id === orgId)
      .forEach((o) => {
        if (o.brand && !seen.has(o.brand.id)) seen.set(o.brand.id, o.brand);
      });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [outlets, orgId]);

  const visibleOutlets = useMemo(
    () =>
      outlets.filter(
        (o) =>
          (!orgId || o.brand?.organization?.id === orgId) &&
          (!brandId || o.brand?.id === brandId)
      ),
    [outlets, orgId, brandId]
  );

  // Selecting a broader level clears the narrower ones, otherwise a stale
  // outlet could sit under a brand it does not belong to.
  const selectOrg = useCallback((id) => {
    setOrgId(id);
    setBrandId('');
    setOutletId('');
  }, []);

  const selectBrand = useCallback((id) => {
    setBrandId(id);
    setOutletId('');
  }, []);

  const selectOutlet = useCallback((id) => setOutletId(id), []);

  /** `?org=&brand=&outlet=` for whichever levels are set. */
  const query = useMemo(() => {
    const parts = [];
    if (orgId) parts.push(`org=${encodeURIComponent(orgId)}`);
    if (brandId) parts.push(`brand=${encodeURIComponent(brandId)}`);
    if (outletId) parts.push(`outlet=${encodeURIComponent(outletId)}`);
    return parts.join('&');
  }, [orgId, brandId, outletId]);

  /** Append the scope to a path, respecting any query string already on it. */
  const withScope = useCallback(
    (path) => {
      if (!query) return path;
      return `${path}${path.includes('?') ? '&' : '?'}${query}`;
    },
    [query]
  );

  const value = {
    loading,
    locked,
    outlets,
    organizations,
    brands,
    visibleOutlets,
    orgId,
    brandId,
    outletId,
    selectOrg,
    selectBrand,
    selectOutlet,
    query,
    withScope,
  };

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export const useScope = () => useContext(ScopeContext);
