import { useMemo } from 'react';
import {
  WEEKDAYS, MIN_SHIFT_SLOTS, MAX_SHIFT_SLOTS, slotsUpTo, formatDays,
} from '../constants';
import { Copy, Eraser, AlertTriangle, Plus, X } from 'lucide-react';

/**
 * The weekly shift sheet: stations down the side, Monday–Sunday across, and a
 * staff number in every cell.
 *
 * The hours live once per shift row rather than in each day cell. A station's
 * times are the same all week almost always, so repeating them seven times was
 * fourteen inputs of pure repetition; a station that genuinely runs different
 * weekend hours puts them on its own shift row.
 *
 *   times[`${rowKey}|${slot}`]         = { startTime, endTime }
 *   counts[`${rowKey}|${slot}|${day}`] = '2'
 *
 * The page owns that state; this component draws it and reports edits, so the
 * round-trip (templates → sheet → templates) stays in one place.
 */

export const timeKey = (rowKey, slot) => `${rowKey}|${slot}`;
export const countKey = (rowKey, slot, day) => `${rowKey}|${slot}|${day}`;

/**
 * Templates → the sheet.
 *
 * Several templates can share one shift row — that is how different staff
 * numbers on different days are stored — so the hours are taken from the one
 * covering the most days. If they disagree, that is a conflict the user has to
 * see: saving would apply the winning hours to the whole row, and doing that
 * silently would rewrite a pattern they never opened.
 */
export function templatesToCells(templates) {
  const times = {};
  const counts = {};
  const conflicts = new Set();

  // Group first, so "which hours win" is decided across the whole row rather
  // than by whichever template the API happened to return first.
  const byRow = new Map();
  for (const t of templates) {
    if (!t.isActive) continue;
    const key = timeKey(`${t.department}|${t.section || ''}`, t.slot ?? 1);
    if (!byRow.has(key)) byRow.set(key, []);
    byRow.get(key).push(t);
  }

  for (const [key, group] of byRow) {
    const hours = new Map();
    for (const t of group) {
      const sig = `${t.startTime}|${t.endTime}`;
      hours.set(sig, (hours.get(sig) ?? 0) + t.daysOfWeek.length);
    }
    const [winner] = [...hours.entries()].sort((a, b) => b[1] - a[1])[0];
    const [startTime, endTime] = winner.split('|');
    times[key] = { startTime, endTime };
    if (hours.size > 1) conflicts.add(key);

    for (const t of group) {
      for (const day of t.daysOfWeek ?? []) counts[`${key}|${day}`] = String(t.headcount);
    }
  }

  return { times, counts, conflicts };
}

/**
 * The sheet → templates, merging days that ask for the same number.
 *
 * The exact inverse of the above. Filling a row identically all week must store
 * one pattern with seven days, not seven patterns, or the pattern list and the
 * allocator both fill with noise.
 */
export function cellsToTemplates(times, counts, rows, slotsFor) {
  const templates = [];

  for (const row of rows) {
    for (const slot of slotsUpTo(slotsFor(row.key))) {
      const time = times[timeKey(row.key, slot)];
      if (!time?.startTime || !time?.endTime) continue;

      // Days grouped by the number they ask for, so identical days collapse.
      const groups = new Map();
      for (const { value: day } of WEEKDAYS) {
        const n = Number(counts[countKey(row.key, slot, day)]);
        if (!Number.isInteger(n) || n < 1) continue;
        if (!groups.has(n)) groups.set(n, []);
        groups.get(n).push(day);
      }

      const many = groups.size > 1;
      for (const [headcount, daysOfWeek] of groups) {
        templates.push({
          name: `${row.label} Shift ${slot}${many ? ` · ${formatDays(daysOfWeek)}` : ''}`,
          department: row.department,
          section: row.section,
          slot,
          startTime: time.startTime,
          endTime: time.endTime,
          headcount,
          daysOfWeek,
        });
      }
    }
  }
  return templates;
}

/**
 * Shift rows that are started but cannot be saved.
 *
 * Hours and staff now live in different places, so there are two ways to leave a
 * row half-done, and both mean the same thing: something was typed that will
 * schedule nobody.
 */
export function incompleteRows(times, counts, rows, slotsFor) {
  const bad = [];

  for (const row of rows) {
    for (const slot of slotsUpTo(slotsFor(row.key))) {
      const key = timeKey(row.key, slot);
      const time = times[key];
      const hasHours = !!(time?.startTime && time?.endTime);
      const partialHours = !hasHours && !!(time?.startTime || time?.endTime);
      const staffed = WEEKDAYS.some(({ value: day }) => {
        const n = Number(counts[countKey(row.key, slot, day)]);
        return Number.isInteger(n) && n >= 1;
      });

      if (partialHours) bad.push({ key, label: `${row.label} Shift ${slot}`, why: 'needs both a start and an end time' });
      else if (staffed && !hasHours) bad.push({ key, label: `${row.label} Shift ${slot}`, why: 'has staff but no hours' });
      else if (hasHours && !staffed) bad.push({ key, label: `${row.label} Shift ${slot}`, why: 'has hours but no staff on any day' });
    }
  }
  return bad;
}

export default function ShiftGrid({
  rows, times, counts, conflicts, invalid, slotsFor,
  onTimes, onCounts, onAddSlot, onRemoveSlot, readOnly,
}) {
  const invalidRows = useMemo(
    () => new Set((invalid || []).map((i) => i.key)),
    [invalid]
  );

  const setTime = (key, next) => {
    const empty = !next.startTime && !next.endTime;
    onTimes({ ...times, ...(empty ? { [key]: undefined } : { [key]: next }) });
  };

  const setCount = (key, value) => {
    onCounts({ ...counts, ...(value ? { [key]: value } : { [key]: undefined }) });
  };

  /** Monday's number across the rest of the week. */
  const copyAcross = (rowKey, slot) => {
    const source = counts[countKey(rowKey, slot, 1)];
    if (!source) return;
    const next = { ...counts };
    for (const { value: day } of WEEKDAYS) next[countKey(rowKey, slot, day)] = source;
    onCounts(next);
  };

  /** Friday's number onto Saturday and Sunday — the busy-weekend shape. */
  const copyWeekend = (rowKey, slot) => {
    const source = counts[countKey(rowKey, slot, 5)];
    if (!source) return;
    const next = { ...counts };
    for (const day of [6, 0]) next[countKey(rowKey, slot, day)] = source;
    onCounts(next);
  };

  const clearRow = (rowKey, slot) => {
    const next = { ...counts };
    for (const { value: day } of WEEKDAYS) delete next[countKey(rowKey, slot, day)];
    onCounts(next);
    setTime(timeKey(rowKey, slot), {});
  };

  return (
    <div className="table-container">
      <table className="shift-grid">
        <thead>
          <tr>
            <th className="grid-station">Station</th>
            <th className="grid-slot">Shift</th>
            <th className="grid-time">Time</th>
            {WEEKDAYS.map((d) => <th key={d.value} className="grid-cell">{d.short}</th>)}
            {!readOnly && <th className="grid-tools" aria-label="Row actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const slots = slotsUpTo(slotsFor(row.key));
            // One extra row per station for the "+ Add shift" control, which is
            // why the station cell spans slots + 1.
            const span = slots.length + (readOnly ? 0 : 1);

            return [
              ...slots.map((slot) => {
                const tKey = timeKey(row.key, slot);
                const time = times[tKey] || {};
                const bad = invalidRows.has(tKey);

                return (
                  <tr key={tKey} className={slot === 1 ? 'is-row-start' : ''}>
                    {slot === 1 && (
                      <th scope="rowgroup" rowSpan={span} className="grid-station">
                        {row.label}
                        {row.department !== 'KITCHEN' && (
                          <span className="grid-station-dept">{row.department}</span>
                        )}
                      </th>
                    )}

                    <td className="grid-slot">
                      Shift {slot}
                      {/* Only the trailing extra row can go, so the numbering
                          never develops a hole. */}
                      {!readOnly && slot > MIN_SHIFT_SLOTS && slot === slots.length && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon icon-crit grid-slot-remove"
                          onClick={() => { clearRow(row.key, slot); onRemoveSlot(row.key); }}
                          title={`Remove shift ${slot}`}
                          aria-label={`Remove ${row.label} shift ${slot}`}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </td>

                    <td className={`grid-time ${bad ? 'is-invalid' : ''} ${conflicts?.has(tKey) ? 'is-conflict' : ''}`}>
                      {readOnly ? (
                        <span className="text-2xs">
                          {time.startTime ? `${time.startTime}–${time.endTime}` : <span className="text-muted">—</span>}
                        </span>
                      ) : (
                        <div className="grid-time-inputs">
                          <input
                            type="time" className="grid-input" value={time.startTime || ''}
                            onChange={(e) => setTime(tKey, { ...time, startTime: e.target.value })}
                            aria-label={`${row.label} shift ${slot} start`}
                          />
                          <input
                            type="time" className="grid-input" value={time.endTime || ''}
                            onChange={(e) => setTime(tKey, { ...time, endTime: e.target.value })}
                            aria-label={`${row.label} shift ${slot} end`}
                          />
                        </div>
                      )}
                      {conflicts?.has(tKey) && (
                        <span
                          className="grid-conflict"
                          title={`This shift has more than one set of hours stored. Saving the sheet applies ${time.startTime}–${time.endTime} to every day.`}
                        >
                          <AlertTriangle size={11} />
                        </span>
                      )}
                    </td>

                    {WEEKDAYS.map((d) => {
                      const key = countKey(row.key, slot, d.value);
                      return (
                        <td key={key} className={`grid-cell ${bad ? 'is-invalid' : ''}`}>
                          {readOnly ? (
                            <span className="grid-cell-read">
                              {counts[key] || <span className="text-muted">—</span>}
                            </span>
                          ) : (
                            <input
                              type="number" min="1" max="99"
                              className="grid-input grid-input-count"
                              value={counts[key] || ''}
                              onChange={(e) => setCount(key, e.target.value)}
                              aria-label={`${row.label} shift ${slot} ${d.label} staff`}
                            />
                          )}
                        </td>
                      );
                    })}

                    {!readOnly && (
                      <td className="grid-tools">
                        <div className="flex gap-1">
                          <button
                            type="button" className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => copyAcross(row.key, slot)}
                            title="Copy Monday's number across the week"
                            aria-label={`Copy Monday across the week for ${row.label} shift ${slot}`}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button" className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => copyWeekend(row.key, slot)}
                            title="Copy Friday's number to Saturday and Sunday"
                            aria-label={`Copy Friday to the weekend for ${row.label} shift ${slot}`}
                          >
                            <span className="text-2xs font-semibold">F→</span>
                          </button>
                          <button
                            type="button" className="btn btn-ghost btn-sm btn-icon icon-crit"
                            onClick={() => clearRow(row.key, slot)}
                            title="Clear this shift"
                            aria-label={`Clear ${row.label} shift ${slot}`}
                          >
                            <Eraser size={12} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              }),

              !readOnly && (
                <tr key={`${row.key}|add`} className="grid-add-row">
                  <td colSpan={WEEKDAYS.length + 3}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onAddSlot(row.key)}
                      disabled={slots.length >= MAX_SHIFT_SLOTS}
                      title={slots.length >= MAX_SHIFT_SLOTS
                        ? `A station can run at most ${MAX_SHIFT_SLOTS} shifts`
                        : undefined}
                      aria-label={`Add a shift to ${row.label}`}
                    >
                      <Plus size={12} />
                      <span>Add shift</span>
                    </button>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
