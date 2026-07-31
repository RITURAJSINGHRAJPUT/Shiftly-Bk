import { Link } from 'react-router-dom';
import { Construction, ArrowLeft } from 'lucide-react';

/**
 * Shared page for nav entries whose feature has no backing data yet.
 *
 * The mockup shows fifteen sidebar items; five of them (AI Workforce Planner,
 * Transfer Recommendations, Analytics, Audit Logs, User Management) have no
 * models, endpoints or data behind them. They are kept in the nav for visual
 * fidelity, and land here so the gap is stated rather than dressed up with
 * invented numbers.
 */
export default function StubPage({ title, description, needs = [] }) {
  return (
    <div className="page-content animate-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{description}</p>
        </div>
      </div>

      <div className="card">
        <div className="empty-state">
          <Construction size={48} className="empty-icon" />
          <h3>Not built yet</h3>
          <p>
            This screen is part of the design but has no data behind it in this
            build. Rather than show placeholder figures, it is left empty.
          </p>

          {needs.length > 0 && (
            <div className="mt-6" style={{ textAlign: 'left', maxWidth: '30rem', margin: '0 auto' }}>
              <div className="text-xs uppercase text-muted mb-2">Would require</div>
              <ul className="divided-list" style={{ listStyle: 'none' }}>
                {needs.map((need) => (
                  <li key={need} className="text-sm text-secondary">{need}</li>
                ))}
              </ul>
            </div>
          )}

          <Link to="/" className="btn btn-ghost mt-6">
            <ArrowLeft size={16} />
            <span>Back to Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
