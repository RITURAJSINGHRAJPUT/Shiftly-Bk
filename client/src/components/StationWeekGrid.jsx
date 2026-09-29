import { format, isToday } from 'date-fns';
import { Copy, Check } from 'lucide-react';
import { gridRows } from '../constants';
import { RosterName, DropZone } from './RosterDnd';

/**
 * The week as Shift Master draws it: one row per station and shift time, one
 * column per day. Rows line up across the week, so moving someone from Pass on
 * Monday to Pass on Tuesday is a straight drag sideways — in the day cards the
 * same block sits at a different height every day.
 *
 * Holds no roster rules of its own. Who may drag, drop or edit what arrives as
 * props from ShiftsPage, and the drag data is the same the day cards use, so
 * its one handleDragEnd serves both views.
 */

const norm = (s) => (s ? String(s).toLowerCase().trim() : '');
const dayKey = (d) => format(d, 'yyyy-MM-dd');
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Which grid row a pattern belongs to: its station, or its department. */
function templateRowKey(t) {
  return t.department === 'KITCHEN' ? `KITCHEN|${norm(t.section)}` : t.department;
}

/**
 * Which grid row a shift belongs to, or null for "Other shifts".
 *
 * The section decides: a station, or a department's own name ("Service",
 * "Housekeeping"), which is what allocated Service and Housekeeping shifts
 * carry. A shift added by hand with no section falls back to the person's
 * department — except in the kitchen, where no section means no station.
 */
function shiftRowKey(s) {
  const section = norm(s.section);
  if (section === 'service') return 'SERVICE';
  if (section === 'housekeeping') return 'HOUSEKEEPING';
  if (section) return `KITCHEN|${section}`;
  const department = s.employee?.department;
  return department && department !== 'KITCHEN' ? department : null;
}

/**
 * Rows, their shift-time sub-rows, and for each day who is on it and how many
 * the patterns ask for. Pure, so it can be checked against real data outside
 * React.
 *
 * `shifts` should be the week's restaurant shifts (no ODC); `templates` the
 * outlet's active patterns; `days` the seven Dates.
 */
export function buildStationGrid({ stations = [], templates = [], shifts = [], days = [] }) {
  const keys = days.map(dayKey);
  const rows = new Map();

  // Shift Master's order: the brand's stations, then Service, then House Keeping.
  for (const r of gridRows(stations)) {
    const key = r.department === 'KITCHEN' ? `KITCHEN|${norm(r.section)}` : r.department;
    rows.set(key, { key, label: r.label, department: r.department, dropSection: r.section, times: new Map() });
  }

  /** A kitchen section the brand's list lacks gets a row of its own. */
  const rowFor = (key) => {
    if (!rows.has(key)) {
      const section = key.split('|')[1] || '';
      rows.set(key, {
        key,
        label: section ? capitalise(section) : 'Kitchen',
        department: 'KITCHEN',
        dropSection: section ? capitalise(section) : '',
        times: new Map(),
        extra: true,
      });
    }
    return rows.get(key);
  };

  const timeFor = (row, startTime, endTime, slot = 99) => {
    const key = `${startTime}|${endTime}`;
    if (!row.times.has(key)) {
      row.times.set(key, {
        key, startTime, endTime, slot,
        needed: Object.fromEntries(keys.map((k) => [k, 0])),
        cells: Object.fromEntries(keys.map((k) => [k, []])),
      });
    }
    const t = row.times.get(key);
    t.slot = Math.min(t.slot, slot);
    return t;
  };

  for (const t of templates) {
    const time = timeFor(rowFor(templateRowKey(t)), t.startTime, t.endTime, t.slot ?? 1);
    days.forEach((d, i) => {
      if ((t.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]).includes(d.getDay())) time.needed[keys[i]] += t.headcount;
    });
  }

  const other = Object.fromEntries(keys.map((k) => [k, []]));
  let otherCount = 0;
  for (const s of shifts) {
    const k = dayKey(new Date(s.date));
    if (!keys.includes(k)) continue;
    const rowKey = shiftRowKey(s);
    if (!rowKey) { other[k].push(s); otherCount += 1; continue; }
    timeFor(rowFor(rowKey), s.startTime, s.endTime).cells[k].push(s);
  }

  const byName = (a, b) => (a.employee?.name || '').localeCompare(b.employee?.name || '');
  const ordered = [...rows.values()]
    // Brand stations, then kitchen extras, then the two departments.
    .sort((a, b) => {
      const rank = (r) => (r.department === 'KITCHEN' ? (r.extra ? 1 : 0) : 2);
      return rank(a) - rank(b);
    })
    .map((r) => ({
      ...r,
      times: [...r.times.values()]
        .sort((a, b) => a.slot - b.slot || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime))
        .map((t) => {
          for (const k of keys) t.cells[k].sort(byName);
          return t;
        }),
    }))
    .filter((r) => r.times.length > 0);

  if (otherCount > 0) {
    for (const k of keys) other[k].sort(byName);
    ordered.push({
      key: 'other',
      label: 'Other shifts',
      other: true,
      times: [{ key: 'other', startTime: '', endTime: '', needed: {}, cells: other }],
    });
  }

  const totals = Object.fromEntries(keys.map((k) => [k, { filled: 0, needed: 0 }]));
  for (const r of ordered) {
    for (const t of r.times) {
      for (const k of keys) {
        totals[k].filled += t.cells[k].length;
        totals[k].needed += t.needed[k] || 0;
      }
    }
  }

  return { rows: ordered, totals };
}

export default function StationWeekGrid({
  grid, days, leaves = [], odcShifts = [], isManager,
  canEditShift, canDragShift, openEditShift,
  canTradeOff, canManageLeave, onEditLeave,
  onCopyDay, copiedDayKey,
}) {
  const leavesOn = (d) => {
    const k = dayKey(d);
    return leaves
      .filter((l) => dayKey(new Date(l.startDate)) <= k && dayKey(new Date(l.endDate)) >= k)
      .sort((a, b) => (a.employee?.name || '').localeCompare(b.employee?.name || ''));
  };
  const odcOn = (d) => odcShifts.filter((s) => dayKey(new Date(s.date)) === dayKey(d));
  const anyOdc = days.some((d) => odcOn(d).length > 0);

  const shiftName = (s, withTime) => {
    const label = `${s.employee?.name}${withTime ? ` · ${s.startTime}–${s.endTime}` : ''}`;
    if (!canEditShift(s)) return <span key={s.id} className="text-2xs">{label}</span>;
    const data = canDragShift(s) ? { type: 'shift', shift: s } : null;
    return (
      <RosterName
        key={s.id}
        id={`grid:${s.id}`}
        className="name-button text-2xs"
        dragData={data}
        dropData={data}
        onClick={() => openEditShift(s)}
        title={`Edit ${s.employee?.name}'s shift — or drag to another cell, or onto someone to swap`}
      >
        {label}
      </RosterName>
    );
  };

  return (
    <div className="station-grid-wrap">
      <table className="station-grid">
        <thead>
          <tr>
            <th className="sg-label sg-corner" scope="col">Station</th>
            {days.map((d) => {
              const k = dayKey(d);
              const { filled, needed } = grid.totals[k];
              return (
                <th key={k} scope="col" className={isToday(d) ? 'sg-today' : undefined}>
                  <div className="sg-day">
                    <span>{format(d, 'EEE d')}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => onCopyDay(d)}
                      aria-label={`Copy shifts for ${format(d, 'EEEE d MMMM')}`}
                      title="Copy this day's shifts, timings and who is off — ready to paste into WhatsApp"
                    >
                      {copiedDayKey === k ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                  <div className={`sg-total${filled < needed ? ' is-short' : ''}`}>{filled}/{needed}</div>
                </th>
              );
            })}
          </tr>
        </thead>

        {grid.rows.map((row) => (
          <tbody key={row.key} className="sg-group">
            <tr className="sg-station-row">
              <th className="sg-label" scope="rowgroup">{row.label}</th>
              <td colSpan={days.length} />
            </tr>
            {row.times.map((t) => (
              <tr key={t.key}>
                <th className="sg-label sg-time" scope="row">
                  {row.other ? 'Outside the plan' : `${t.startTime}–${t.endTime}`}
                </th>
                {days.map((d) => {
                  const k = dayKey(d);
                  const people = t.cells[k];
                  const need = t.needed[k] || 0;
                  const idle = need === 0 && people.length === 0;
                  return (
                    <DropZone
                      key={k}
                      as="td"
                      id={`grid:${row.key}:${t.key}:${k}`}
                      className={`sg-cell${idle ? ' sg-idle' : ''}`}
                      // Every cell of a real row takes a drop — an empty one is
                      // how a short shift gets filled. "Other shifts" has no
                      // single time or station to move anyone to.
                      data={isManager && !row.other ? {
                        type: 'slot', date: d, startTime: t.startTime, endTime: t.endTime, section: row.dropSection,
                      } : null}
                    >
                      <div className="sg-names">
                        {people.map((s) => shiftName(s, row.other))}
                        {idle && <span className="sg-dash">—</span>}
                      </div>
                      {need > 0 && (
                        <span className={`sg-count${people.length < need ? ' is-short' : ''}`}>
                          {people.length}/{need}
                        </span>
                      )}
                    </DropZone>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}

        {anyOdc && (
          <tbody className="sg-group">
            <tr>
              <th className="sg-label" scope="row">ODC</th>
              {days.map((d) => (
                <td key={dayKey(d)} className="sg-cell">
                  <div className="sg-names">
                    {odcOn(d).map((s) => (canEditShift(s) ? (
                      <button key={s.id} type="button" className="name-button text-2xs"
                        onClick={() => openEditShift(s)} title={s.note ? `${s.note} — edit` : `Edit ${s.employee?.name}'s ODC`}>
                        {s.employee?.name} · {s.startTime}–{s.endTime}
                      </button>
                    ) : (
                      <span key={s.id} className="text-2xs" title={s.note || undefined}>
                        {s.employee?.name} · {s.startTime}–{s.endTime}
                      </span>
                    )))}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        )}

        <tbody className="sg-group">
          <tr>
            <th className="sg-label" scope="row">Off</th>
            {days.map((d) => (
              <td key={dayKey(d)} className="sg-cell sg-off">
                <div className="sg-names">
                  {leavesOn(d).map((l) => (canManageLeave(l) ? (
                    <RosterName
                      key={l.id}
                      id={`grid-off:${l.id}:${dayKey(d)}`}
                      className="name-button text-2xs"
                      dragData={canTradeOff(l) ? { type: 'off', leave: l } : null}
                      dropData={canTradeOff(l) ? { type: 'off', leave: l } : null}
                      onClick={() => onEditLeave(l)}
                      title={canTradeOff(l)
                        ? `Move or cancel ${l.employee?.name}'s leave — or drag onto someone working this day to swap`
                        : `Move or cancel ${l.employee?.name}'s leave`}
                    >
                      {l.employee?.name}
                    </RosterName>
                  ) : (
                    <span key={l.id} className="text-2xs">{l.employee?.name}</span>
                  )))}
                  {leavesOn(d).length === 0 && <span className="sg-dash">—</span>}
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
