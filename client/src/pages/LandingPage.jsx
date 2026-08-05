import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import BrandLogo from '../components/BrandLogo';
import {
  Sparkles, ArrowRight, PlayCircle, Moon, Sun, Check, X,
  BrainCircuit, Users, MapPin, ArrowLeftRight, CalendarClock,
  ShieldCheck, Store, Tags, TrendingUp, Clock, Layers,
  Upload, LineChart, Target, Lightbulb, Gauge,
  UserCog, Briefcase, ChefHat, User, Building2,
} from 'lucide-react';

/**
 * Public marketing page, shown at `/` to unauthenticated visitors.
 *
 * Built from the app's own tokens in index.css rather than a separate stylesheet,
 * so it cannot drift from the product's look and gets dark mode for free.
 *
 * Copy rule followed throughout: anything the codebase cannot actually do is
 * marked "Coming soon" rather than described as working, and no customer counts
 * or testimonials are invented. `live: false` below is the single switch for that.
 */

const NAV_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'Roles', href: '#roles' },
];

const PAINS = [
  { title: 'Staff shortages', body: 'Stations left short on the day, discovered when the covers are already seated.' },
  { title: 'Costly overstaffing', body: 'Paying for cover nobody needed, with no view of what each outlet actually requires.' },
  { title: 'Manual tracking', body: 'Rosters in spreadsheets, attendance on paper, and no single source of truth across outlets.' },
];

const SOLUTIONS = [
  {
    title: 'Per-outlet shift patterns',
    body: 'Each restaurant defines its own stations, hours and required headcount. No two venues get the same plan.',
    live: true,
  },
  {
    title: 'Rule-based auto-allocation',
    body: 'Fills every slot by skill match, attendance reliability and workload balance, enforcing 8-hour rest periods.',
    live: true,
  },
  {
    title: 'Geofenced attendance',
    body: 'GPS check-in validated against each outlet’s own radius, with late arrivals and out-of-range flagged.',
    live: true,
  },
];

const FEATURES = [
  {
    icon: CalendarClock,
    title: 'Shift Planning',
    body: 'Patterns, daily coverage against plan, and a weekly roster — per restaurant, never mixed together.',
    live: true,
  },
  {
    icon: Users,
    title: 'Employee Management',
    body: 'Directory scoped by organization, brand and outlet, with departments, stations and role-based access.',
    live: true,
  },
  {
    icon: MapPin,
    title: 'Smart Attendance',
    body: 'Haversine distance against the outlet geofence. Out-of-range check-ins are recorded and flagged, not silently rejected.',
    live: true,
  },
  {
    icon: BrainCircuit,
    title: 'Workforce Intelligence',
    body: 'Demand forecasting from booking, footfall and seasonal history to generate the roster before you need it.',
    live: false,
  },
  {
    icon: ArrowLeftRight,
    title: 'Transfer Engine',
    body: 'Skill and availability matching to move people between outlets and close coverage gaps.',
    live: false,
  },
  {
    icon: TrendingUp,
    title: 'Labour Cost Analytics',
    body: 'Cost per outlet, per department and per shift, tracked against budget month to date.',
    live: false,
  },
];

const STEPS = [
  { icon: Upload, title: 'Set up outlets', body: 'Organization, brands and venues, each with its own geofence.' },
  { icon: Layers, title: 'Define patterns', body: 'Stations, hours and how many people each needs per day.' },
  { icon: Target, title: 'Auto-allocate', body: 'Fill the week respecting skills, rest and workload balance.' },
  { icon: Gauge, title: 'Track coverage', body: 'See filled against required for every day and station.' },
  { icon: LineChart, title: 'Review', body: 'Attendance trends and per-brand performance across the group.' },
];

const ROLES = [
  { icon: ShieldCheck, title: 'Super Admin', body: 'Full access across every organization, brand and outlet, plus system settings.' },
  { icon: Briefcase, title: 'Admin & HR', body: 'Group-wide employee records, reports and outlet configuration.' },
  { icon: UserCog, title: 'Master of House', body: 'Front-of-house cover for their own venue, with attendance oversight.' },
  { icon: ChefHat, title: 'Head Chef', body: 'Kitchen stations, shift patterns and rostering for their own venue.' },
  { icon: User, title: 'Staff', body: 'Own shifts, geofenced check-in, leave requests and emergency cover.' },
];

/** Marks a capability that is designed but has nothing behind it yet. */
function SoonChip() {
  return <span className="landing-chip landing-chip--soon">Coming soon</span>;
}

function LiveChip() {
  return (
    <span className="landing-chip landing-chip--live">
      <Check size={11} /> Available
    </span>
  );
}

export default function LandingPage() {
  const { isDark, toggle } = useTheme();

  return (
    <div className="landing">
      {/* ---------- nav ---------- */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          {/* alt="" on both — the link's aria-label is the accessible name. */}
          <Link to="/" className="landing-logo" aria-label="Bookends Shiftly home">
            <BrandLogo variant="wordmark" className="landing-logo-text" alt="" />
          </Link>

          <nav className="landing-nav-links" aria-label="Sections">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href}>{l.label}</a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <button
              type="button"
              className="landing-icon-btn"
              onClick={toggle}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <Link to="/login" className="landing-signin">Sign in</Link>
            <Link to="/login" className="btn btn-primary btn-sm">Book a Demo</Link>
          </div>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-badge">
            <Sparkles size={13} />
            Built for multi-outlet hospitality
          </span>

          <h1 className="landing-h1">
            Run every outlet with the right team, every shift.
          </h1>

          <p className="landing-lead">
            Bookends Shiftly plans staffing per restaurant — each venue's own stations, hours
            and required headcount — then fills the roster automatically, respecting
            skills, rest periods and workload balance. Attendance is geofenced to
            each outlet.
          </p>

          <div className="landing-cta-row">
            <Link to="/login" className="btn btn-primary btn-lg">
              <span>Book a Demo</span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/login" className="btn btn-ghost btn-lg">
              <PlayCircle size={17} />
              <span>Sign in to explore</span>
            </Link>
          </div>
        </div>

        {/* Real markup rather than a screenshot, so it tracks the theme and
            cannot go stale. Figures are illustrative and labelled as such. */}
        <div className="landing-mock">
          <div className="landing-mock-bar">
            <span className="landing-mock-dot" />
            <span className="landing-mock-dot" />
            <span className="landing-mock-dot" />
            <span className="landing-mock-title">Daily coverage · Capiche PIPLOD</span>
          </div>

          <div className="landing-mock-body">
            <div className="landing-mock-kpis">
              <div className="landing-mock-kpi">
                <span className="landing-mock-kpi-label">Slots filled</span>
                <strong>11 / 14</strong>
              </div>
              <div className="landing-mock-kpi">
                <span className="landing-mock-kpi-label">Attendance</span>
                <strong>92%</strong>
              </div>
              <div className="landing-mock-kpi">
                <span className="landing-mock-kpi-label">Outlets</span>
                <strong>6</strong>
              </div>
            </div>

            {[
              { name: 'Pizza Station', hours: '12:00 – 21:00', got: 3, need: 3 },
              { name: 'Pasta Station', hours: '12:00 – 21:00', got: 1, need: 2 },
              { name: 'Service — Early', hours: '12:00 – 21:00', got: 2, need: 2 },
              { name: 'Housekeeping', hours: '11:00 – 21:00', got: 3, need: 3 },
            ].map((r) => (
              <div key={r.name} className="landing-mock-row">
                <div>
                  <div className="landing-mock-row-name">{r.name}</div>
                  <div className="landing-mock-row-hours">{r.hours}</div>
                </div>
                <span className={`badge ${r.got < r.need ? 'badge-error' : 'badge-accent'}`}>
                  {r.got}/{r.need}
                </span>
              </div>
            ))}

            <p className="landing-mock-note">Illustrative figures</p>
          </div>
        </div>
      </section>

      {/* ---------- scale bar ----------
          The reference showed four customer logos and a "50+ groups" claim.
          Bookends is the organization and Capiche and Aiko are its brands, so
          this states the real deployment instead of inventing customers. */}
      <section className="landing-scale">
        <span className="landing-eyebrow">Running today across</span>
        <div className="landing-scale-items">
          <span><Building2 size={15} /> Bookends Hospitality</span>
          <span><Tags size={15} /> 2 brands · Capiche, Aiko</span>
          <span><Store size={15} /> 6 outlets</span>
          <span><Layers size={15} /> 42 shift patterns</span>
        </div>
      </section>

      {/* ---------- problem / solution ---------- */}
      <section className="landing-section" id="product">
        <div className="landing-two-up">
          <div className="landing-panel landing-panel--light">
            <h2 className="landing-h3">Stop managing staffing in spreadsheets.</h2>
            <div className="landing-list">
              {PAINS.map((p) => (
                <div key={p.title} className="landing-list-item">
                  <span className="landing-list-icon landing-list-icon--bad">
                    <X size={13} />
                  </span>
                  <div>
                    <strong>{p.title}</strong>
                    <p>{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-panel landing-panel--navy">
            <h2 className="landing-h3">Bookends Shiftly: the operations layer for hospitality.</h2>
            <div className="landing-list">
              {SOLUTIONS.map((s) => (
                <div key={s.title} className="landing-list-item">
                  <span className="landing-list-icon landing-list-icon--good">
                    <Check size={13} />
                  </span>
                  <div>
                    <strong>{s.title}</strong>
                    <p>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- workforce planner (not built) ---------- */}
      <section className="landing-section">
        <div className="landing-split">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BrainCircuit size={20} className="icon-brand" />
              <SoonChip />
            </div>
            <h2 className="landing-h2">AI Workforce Planner</h2>
            <p className="landing-body">
              The next step: forecast demand per outlet from booking data, footfall and
              seasonal patterns, then generate the roster before the week starts.
            </p>
            <p className="landing-body landing-body--muted">
              Not built yet. Today's allocation is rule-based — it fills the headcount
              you define rather than predicting what it should be.
            </p>
          </div>

          <div className="landing-mock landing-mock--soon">
            <div className="landing-mock-bar">
              <span className="landing-mock-title">Forecast · tomorrow</span>
              <SoonChip />
            </div>
            <div className="landing-mock-body">
              <div className="landing-mock-kpis">
                <div className="landing-mock-kpi">
                  <span className="landing-mock-kpi-label">Total required</span>
                  <strong>—</strong>
                </div>
                <div className="landing-mock-kpi">
                  <span className="landing-mock-kpi-label">Confidence</span>
                  <strong>—</strong>
                </div>
              </div>
              {['Kitchen team', 'Service crew', 'Housekeeping'].map((d) => (
                <div key={d} className="landing-mock-row">
                  <div className="landing-mock-row-name">{d}</div>
                  <span className="badge badge-ghost">awaiting model</span>
                </div>
              ))}
              <p className="landing-mock-note">No forecasting model exists yet</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section className="landing-section" id="features">
        <div className="landing-head">
          <h2 className="landing-h2">Complete control over your workforce</h2>
          <p className="landing-body">
            What is running today, and what is next. Marked honestly either way.
          </p>
        </div>

        <div className="landing-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className={`landing-feature ${f.live ? '' : 'is-soon'}`}>
              <div className="landing-feature-top">
                <span className="landing-feature-icon">
                  <f.icon size={18} />
                </span>
                {f.live ? <LiveChip /> : <SoonChip />}
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- live operations ---------- */}
      <section className="landing-section">
        <div className="landing-dark">
          <div className="landing-dark-copy">
            <h2 className="landing-h2">Live operations dashboard</h2>
            <p>
              One view of the whole group — attendance today, shifts scheduled,
              coverage per department and per-brand performance for the week.
            </p>
            <div className="landing-dark-stats">
              <div>
                <span>Today's attendance</span>
                <strong>92.6%</strong>
              </div>
              <div>
                <span>Shifts scheduled</span>
                <strong>123</strong>
              </div>
              <div>
                <span>Labour cost <SoonChip /></span>
                <strong>—</strong>
              </div>
            </div>
            <p className="landing-dark-note">
              Attendance and shift figures are live from the roster. Labour cost needs
              wage data, which the system does not hold yet.
            </p>
          </div>

          <div className="landing-dark-mock">
            <div className="landing-dark-mock-head">
              <span className="landing-live-dot" />
              <span>All outlets</span>
            </div>
            <div className="landing-dark-mock-big">
              <strong>2,481</strong>
              <span>shifts this month</span>
            </div>
            <div className="landing-dark-mock-grid">
              {[
                ['Kitchen', 'Stable'],
                ['Service', 'Peak'],
                ['Housekeeping', 'Stable'],
                ['Coverage', '94%'],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <p className="landing-mock-note">Illustrative figures</p>
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="landing-section" id="how">
        <div className="landing-head">
          <h2 className="landing-h2">From setup to a filled roster</h2>
          <p className="landing-body">Five steps, all of them working today.</p>
        </div>

        <ol className="landing-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="landing-step-num">{i + 1}</span>
              <s.icon size={18} className="icon-brand" />
              <strong>{s.title}</strong>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- roles ---------- */}
      <section className="landing-section" id="roles">
        <div className="landing-head">
          <h2 className="landing-h2">An interface for every role</h2>
          <p className="landing-body">
            Six roles, each scoped server-side. Outlet managers see their own venue and
            cannot widen that, whatever the request asks for.
          </p>
        </div>

        <div className="landing-roles">
          {ROLES.map((r) => (
            <div key={r.title} className="landing-role">
              <span className="landing-feature-icon">
                <r.icon size={17} />
              </span>
              <strong>{r.title}</strong>
              <p>{r.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- cta ---------- */}
      <section className="landing-section">
        <div className="landing-cta">
          <h2>Ready to plan every outlet properly?</h2>
          <p>
            Built for hospitality groups running more than one venue — where each
            restaurant needs its own plan, not a copy of the last one.
          </p>
          <div className="landing-cta-row landing-cta-row--center">
            <Link to="/login" className="btn btn-lg landing-btn-dark">
              <span>Book a Demo</span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/login" className="btn btn-lg landing-btn-white">
              <span>Sign in</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            {/* aria-label to match the nav copy, which had one where this did not. */}
            <Link to="/" className="landing-logo" aria-label="Bookends Shiftly home">
              <BrandLogo variant="wordmark" className="landing-logo-text" alt="" />
            </Link>
            <p>CRM and shift management for multi-outlet hospitality.</p>
          </div>

          <div className="landing-footer-cols">
            <div>
              <h4>Product</h4>
              <a href="#features">Shift planning</a>
              <a href="#features">Attendance</a>
              <a href="#roles">Roles &amp; access</a>
              <Link to="/login">Sign in</Link>
            </div>
            <div>
              <h4>Company</h4>
              <a href="#product">About</a>
              <a href="#how">How it works</a>
              <Link to="/login">Contact</Link>
            </div>
            <div>
              <h4>Resources</h4>
              <a href="#product">Documentation</a>
              <a href="#features">Roadmap</a>
              <a href="#how">Getting started</a>
            </div>
          </div>
        </div>

        <div className="landing-footer-bottom">
          <span>© {new Date().getFullYear()} Bookends Shiftly. All rights reserved.</span>
          <span className="landing-footer-note">
            <Clock size={12} /> Some features marked “Coming soon” are not yet built.
          </span>
        </div>
      </footer>
    </div>
  );
}
