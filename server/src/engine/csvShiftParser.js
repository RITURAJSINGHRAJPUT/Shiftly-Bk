/**
 * CSV Shift Pattern Parser
 *
 * Extracts the exact weekly staffing matrix from the Shiftly CSV:
 *   Outlet → Department → Section → Day-of-week → Employee assignments
 *
 * Each assignment carries: employeeName, section, startTime, endTime, dayIndex (0=Mon … 6=Sun).
 *
 * The CSV format is messy and human-authored, so this parser is deliberately
 * tolerant: it normalises a dozen time-slot notations, ignores non-person cells,
 * and carries section context across rows.
 */
import { readFileSync } from 'fs';

// ────────────────────────────── time helpers ──────────────────────────────

/**
 * Normalise a time string to HH:MM.
 *
 * Handles: `12`, `1`, `12:30`, `1:30`, `12.30`, `9.30`, `11:30`, `0`.
 * Single-digit hours below 7 are treated as PM (1→13, 2→14 … 6→18).
 * Values 7–11 are kept as-is (morning shifts exist: 7am, 11am).
 */
function normaliseTime(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/\s+/g, '');

  // "12.30" → "12:30"
  s = s.replace('.', ':');

  // Pure integer, e.g. "12", "3", "1"
  if (/^\d{1,2}$/.test(s)) {
    let h = parseInt(s, 10);
    if (h >= 0 && h <= 6) h += 12; // 1→13, 2→14, …, 6→18
    return `${String(h).padStart(2, '0')}:00`;
  }

  // HH:MM or H:MM
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    if (h >= 0 && h <= 6 && parseInt(min, 10) === 0) h += 12;
    return `${String(h).padStart(2, '0')}:${min}`;
  }

  return null;
}

/**
 * Given a start time, derive a default end time (9 hours later).
 * Wraps past midnight.
 */
function defaultEnd(startTime) {
  const [h, mm] = startTime.split(':').map(Number);
  const eh = (h + 9) % 24;
  return `${String(eh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Parse a cell like "Ajay 12-9", "Harsh 12:30-9:30", "Alok=1-10",
 * "Roshni 2", "Pinky 12 to 9", "Naveen 3 to 12", "Sagar=open to close".
 *
 * Returns { name, startTime, endTime } or null for non-assignment cells.
 */
function parseAssignmentCell(cell) {
  if (!cell) return null;

  // Strip bullets and zero-width chars
  let cleaned = cell.replace(/[•⁠\u200B\u2060\uFEFF]/g, '').trim();
  if (!cleaned) return null;

  // Quick rejects
  const lower = cleaned.toLowerCase();
  if (isNonPersonCell(lower)) return null;

  // ── Format: "Name=StartTime-EndTime" or "Name=Start-End" ──
  // e.g. "Alok=1-10", "Sagar=12-10", "Dipak=2-30=12.3" (typo for 2:30-12:30)
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s]*?)\s*=\s*(.+)$/);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const times = parseTimePart(m[2]);
      if (times) return { name, ...times };
      // "Name=off" → skip
      if (/off/i.test(m[2])) return null;
      return null;
    }
  }

  // ── Format: "Name StartTime to EndTime" ──
  // e.g. "Nawaz 1 to 10", "Sanjay 3 to 12", "Rakesh open to close"
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s+(\S+)\s+to\s+(\S+)$/i);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const s = normaliseTime(m[2]) || (m[2].toLowerCase() === 'open' ? '11:00' : null);
      const e = normaliseTime(m[3]) || (m[3].toLowerCase() === 'close' ? '23:00' : null);
      if (s && e) return { name, startTime: s, endTime: e };
      return null;
    }
  }

  // ── Format: "Name StartTime-EndTime" or "Name Start-End" ──
  // e.g. "Harsh 12-9", "Chirag 12:30-9:30", "Vokil 12-10"
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s+([\d.:]+)\s*[-–—]\s*([\d.:]+)$/);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const s = normaliseTime(m[2]);
      const e = normaliseTime(m[3]);
      if (s && e) return { name, startTime: s, endTime: e };
      return null;
    }
  }

  // ── Format: "Name :- Start to End" ──
  // e.g. "Neelesh  :- 1:00  to 10:00"
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s*[:-]+\s*([\d.:]+)\s+to\s+([\d.:]+)$/i);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const s = normaliseTime(m[2]);
      const e = normaliseTime(m[3]);
      if (s && e) return { name, startTime: s, endTime: e };
      return null;
    }
  }

  // ── Format: "Name :- Start:MM to End:MM" ──
  // e.g. "Isa :- 02:00 to 11:00"
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s*[:-]+\s*([\d]+[:\.]?\d*)\s+to\s+([\d]+[:\.]?\d*)\s*$/i);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const s = normaliseTime(m[2]);
      const e = normaliseTime(m[3]);
      if (s && e) return { name, startTime: s, endTime: e };
    }
  }

  // ── Format: "Name StartHour" (single number) ──
  // e.g. "Ajay 12", "Varun 12", "Roshni 2", "Maksad 12"
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s+(\d{1,2})$/);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const s = normaliseTime(m[2]);
      if (s) return { name, startTime: s, endTime: defaultEnd(s) };
      return null;
    }
  }

  // ── Format: "Name open to close" ──
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s+open\s+to\s+close$/i);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      return { name, startTime: '11:00', endTime: '23:00' };
    }
  }

  // ── Format: "Name open" or "Name close" ──
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s+(open|close)$/i);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const isOpen = m[2].toLowerCase() === 'open';
      return { name, startTime: isOpen ? '11:00' : '15:00', endTime: isOpen ? '20:00' : '23:00' };
    }
  }

  // ── Format: "Name - Start to close" or "Name -.Start to closed" ──
  // e.g. "Farhan - 3:30 to close", "lukhman -.3:30 to closed"
  {
    const m = cleaned.match(/^([a-zA-Z][a-zA-Z\s.]*?)\s*[-–—.]+\s*([\d.:]+)\s+to\s+(close[d]?|[\d.:]+)$/i);
    if (m) {
      const name = m[1].trim();
      if (!isValidName(name)) return null;
      const s = normaliseTime(m[2]);
      const e = /^close/i.test(m[3]) ? '23:00' : normaliseTime(m[3]);
      if (s && e) return { name, startTime: s, endTime: e };
    }
  }

  // ── Bare name (no times) — only if in a section context, default shift ──
  if (/^[a-zA-Z][a-zA-Z\s]*$/.test(cleaned) && cleaned.length <= 25 && cleaned.length >= 2) {
    const name = cleaned.trim();
    if (isValidName(name)) {
      return { name, startTime: null, endTime: null };  // caller fills defaults
    }
  }

  return null;
}

/**
 * Parse the time portion after "=" or standalone.
 * e.g. "1-10", "12-9", "12:30-9:30", "2-30=12.3" (messy), "off"
 */
function parseTimePart(raw) {
  const s = raw.trim();

  // "Start-End" or "Start–End"
  {
    const m = s.match(/^([\d.:]+)\s*[-–—]\s*([\d.:]+)$/);
    if (m) {
      const start = normaliseTime(m[1]);
      const end = normaliseTime(m[2]);
      if (start && end) return { startTime: start, endTime: end };
    }
  }

  // "Start to End"
  {
    const m = s.match(/^([\d.:]+)\s+to\s+([\d.:]+)$/i);
    if (m) {
      const start = normaliseTime(m[1]);
      const end = normaliseTime(m[2]);
      if (start && end) return { startTime: start, endTime: end };
    }
  }

  // Messy format like "2-30=12.3" → try treating as "2:30-12:30"
  {
    const m = s.match(/^(\d{1,2})[-.](\d{1,2})\s*=\s*(\d{1,2})\.?(\d{0,2})$/);
    if (m) {
      const start = normaliseTime(`${m[1]}:${m[2].padEnd(2, '0')}`);
      const end = normaliseTime(`${m[3]}:${(m[4] || '00').padEnd(2, '0')}`);
      if (start && end) return { startTime: start, endTime: end };
    }
  }

  // Single number
  {
    const start = normaliseTime(s);
    if (start) return { startTime: start, endTime: defaultEnd(start) };
  }

  return null;
}

// ────────────────────────────── name helpers ──────────────────────────────

const SECTION_NAMES = new Set([
  'pizza', 'pasta', 'drinks', 'drink', 'sushi', 'wok', 'side', 'sides', 'pass',
]);

const NON_PERSON_WORDS = new Set([
  'section', 'staffing', 'staff', 'team', 'hk', 'housekeeping', 'kitchen',
  'service', 'off', 'odc', 'open', 'close', 'closing', 'opening', 'front',
  'week', 'weekoff', 'leave', 'total', 'name', 'names', 'shift', 'shifts',
  'general', 'half', 'full', 'extra', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'pass', 'of', 'house',
  'tomorrow', 'today', 'date', 'july', 'june', 'august',
]);

function isNonPersonCell(lower) {
  const l = lower.replace(/[•⁠\u200B\u2060\uFEFF]/g, '').trim();
  if (!l) return true;

  // Pure date patterns
  if (/^\d{1,2}\/\d{1,2}/.test(l)) return true;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(l)) return true;
  if (/^\d+.*july|june|august/i.test(l)) return true;
  if (/^\d{1,2}\s*(th|st|nd|rd)\s/i.test(l)) return true;
  if (/july\s*staffing|staffing.*\d/i.test(l)) return true;

  // Known non-person full matches
  if (NON_PERSON_WORDS.has(l)) return true;
  if (SECTION_NAMES.has(l)) return true;

  // Section + word combos
  if (/^(pizza|pasta|drink|drinks|sushi|wok|side|sides|pass)\s+section$/i.test(l)) return true;
  if (/^hk\s+(team|staff)/i.test(l)) return true;
  if (/^(front\s+of\s+house|house\s*keeping)/i.test(l)) return true;

  // Headers like "Monday Kitchen staffing", "Tuesday Service staffing"
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s/i.test(l)) return true;

  // Staffing headers like "20/07 service team", "23July staffing"
  if (/staffing/i.test(l) && l.length < 40) return true;

  // "Off :-ajay" style → not a person line
  if (/^off\s*[:-]/i.test(l)) return true;

  // "week off" patterns
  if (/week\s*off/i.test(l)) return true;

  // "Odc surat" or other location references
  if (/^odc\s/i.test(l)) return true;

  // "Kg" prefix (e.g. "Kg Jasmin" is a reference, not a name)
  if (/^kg\s/i.test(l)) return true;

  // Quoted multi-person cells like "Odc - Faizan, Farhan Shaikh..." → skip the whole cell
  if (/^odc/i.test(l) && l.includes(',')) return true;

  // Service staffing label cells
  if (/^(housekeeping|service)\s+staffing$/i.test(l)) return true;

  return false;
}

function isValidName(name) {
  const n = name.toLowerCase().trim();
  if (n.length < 2 || n.length > 25) return false;
  if (/^\d+$/.test(n)) return false;
  if (NON_PERSON_WORDS.has(n)) return false;
  if (SECTION_NAMES.has(n)) return false;

  // Multi-word: reject if last word is a structural keyword
  const words = n.split(/\s+/);
  if (words.length > 1) {
    const last = words[words.length - 1];
    if (['section', 'staffing', 'team', 'staff', 'off', 'half'].includes(last)) return false;
    if (SECTION_NAMES.has(words[0])) return false;
  }

  // Reject if it looks like a header: "Vesu staffing 23/07"
  if (/\d{1,2}\/\d{1,2}/.test(n)) return false;

  return true;
}

function capitalizeFirst(str) {
  const s = str.trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ────────────────────────────── main parser ──────────────────────────────

const OUTLET_PATTERNS = [
  { pattern: /Capiche PIPLOD/i, name: 'Capiche PIPLOD' },
  { pattern: /Capiche Vesu/i, name: 'Capiche Vesu' },
  { pattern: /Capiche Ambli/i, name: 'Capiche Ambli' },
  { pattern: /Capiche Uni/i, name: 'Capiche Uni' },
  { pattern: /Aiko SRT/i, name: 'Aiko SRT' },
  { pattern: /Aiko AHM/i, name: 'Aiko AHM' },
];

/**
 * Default shift times by department when a cell has a name but no time.
 */
const DEPT_DEFAULTS = {
  KITCHEN:      { startTime: '12:00', endTime: '21:00' },
  SERVICE:      { startTime: '13:00', endTime: '22:00' },
  HOUSEKEEPING: { startTime: '11:00', endTime: '21:00' },
};

function matchSection(cell) {
  if (!cell) return null;
  const s = cell.replace(/[•⁠\u200B\u2060\uFEFF]/g, '').trim().toLowerCase();
  if (/^pizza(\s+section)?$/i.test(s)) return 'Pizza';
  if (/^pasta(\s+section)?$/i.test(s)) return 'Pasta';
  if (/^drink[s]?(\s+section)?$/i.test(s)) return 'Drinks';
  if (/^sushi(\s+section)?$/i.test(s)) return 'Sushi';
  if (/^wok(\s+section)?$/i.test(s)) return 'Wok';
  if (/^side[s]?(\s+section)?$/i.test(s)) return 'Side';
  if (/^pass(\s+section)?$/i.test(s)) return 'Pass';
  return null;
}

/**
 * Parse the CSV and extract the full shift allocation matrix.
 *
 * @param {string} csvPath — absolute path to the CSV file.
 * @returns {Object} Map of outletName → { assignments: Assignment[] }
 *   where Assignment = { employeeName, section, department, startTime, endTime, dayIndex }
 *   dayIndex: 0=Monday … 6=Sunday
 */
export function parseCSVShiftPattern(csvPath) {
  const content = readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').map(l => l.replace(/\r/g, '').split(','));

  const result = {};   // outletName → { assignments: [] }

  let currentOutlet = null;
  let currentDepartment = null;
  let currentSection = null;
  let columnSections = [null, null, null, null, null, null, null];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstCell = (line[0] || '').trim();
    const lineText = line.join(' ').trim();

    // ── Detect outlet header ──
    let outletMatch = false;
    for (const vp of OUTLET_PATTERNS) {
      if (vp.pattern.test(lineText) && !(/kitchen|service|staff|monday|tuesday/i.test(lineText))) {
        currentOutlet = vp.name;
        if (!result[currentOutlet]) result[currentOutlet] = { assignments: [] };
        currentDepartment = null;
        currentSection = null;
        columnSections = [null, null, null, null, null, null, null];
        outletMatch = true;
        break;
      }
    }
    if (outletMatch) continue;

    if (!currentOutlet) continue;

    // ── Detect department header ──
    // Lines like "Monday Kitchen staffing", "Monday Service", "HK team"
    if (/kitchen/i.test(lineText) && /staff|monday|tuesday/i.test(lineText)) {
      currentDepartment = 'KITCHEN';
      currentSection = null;
      columnSections = [null, null, null, null, null, null, null];
      continue;
    }
    if (/service/i.test(lineText) && /staff|monday|tuesday/i.test(lineText)) {
      currentDepartment = 'SERVICE';
      currentSection = null;
      columnSections = [null, null, null, null, null, null, null];
      continue;
    }
    if (/hk|housekeeping/i.test(lineText) && /staff|team|monday/i.test(lineText)) {
      currentDepartment = 'HOUSEKEEPING';
      currentSection = null;
      columnSections = [null, null, null, null, null, null, null];
      continue;
    }

    // Skip date-row headers like "20/07,21/07,…" or "20/7/2026,…"
    if (/^\d{1,2}\/\d{1,2}/.test(firstCell)) continue;

    if (!currentDepartment) continue;

    // ── Detect section headers in cells (kitchen grid) ──
    if (currentDepartment === 'KITCHEN') {
      for (let col = 0; col < Math.min(line.length, 7); col++) {
        const cell = (line[col] || '').trim();
        const sec = matchSection(cell);
        if (sec) {
          columnSections[col] = sec;
          if (col === 0) currentSection = sec;
        }
      }
    }

    // For SERVICE and HOUSEKEEPING, section is null (no stations).
    const isKitchen = currentDepartment === 'KITCHEN';

    // ── Parse each column as a day-of-week assignment ──
    // Columns 0–6 map to Monday–Sunday.
    for (let col = 0; col < Math.min(line.length, 7); col++) {
      const cell = (line[col] || '').trim();
      if (!cell) continue;

      // Skip cell if it is a section header itself
      if (isKitchen && matchSection(cell)) continue;

      const parsed = parseAssignmentCell(cell);
      if (!parsed) continue;

      // Fill default times if not extracted
      const dept = currentDepartment;
      const defaults = DEPT_DEFAULTS[dept];
      const startTime = parsed.startTime || defaults.startTime;
      const endTime = parsed.endTime || defaults.endTime;

      const assignSection = isKitchen
        ? (columnSections[col] || currentSection || null)
        : null;

      result[currentOutlet].assignments.push({
        employeeName: capitalizeFirst(parsed.name),
        section: assignSection,
        department: dept,
        startTime,
        endTime,
        dayIndex: col,  // 0=Mon … 6=Sun
      });
    }
  }

  return result;
}

/**
 * Given parsed CSV data and DB employees, create shift records for a target
 * week (Monday to Sunday).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} outletId — target outlet DB id
 * @param {string} outletName — outlet name as it appears in the CSV
 * @param {Date} weekMonday — the Monday of the target week (local midnight)
 * @param {Object} csvData — parsed CSV data for this outlet
 * @returns {Object} { created, skipped, errors }
 */
export async function applyCSVPattern(prisma, outletId, outletName, weekMonday, csvData) {
  if (!csvData || !csvData.assignments || csvData.assignments.length === 0) {
    return { created: 0, skipped: 0, errors: [], message: `No CSV data for ${outletName}` };
  }

  // Load employees for this outlet
  const employees = await prisma.employee.findMany({
    where: { outletId, isActive: true },
    select: { id: true, name: true, department: true },
  });

  // Build a fuzzy lookup: lowercased name → employee
  const empLookup = new Map();
  for (const emp of employees) {
    empLookup.set(emp.name.toLowerCase().trim(), emp);
    // Also first-name only
    const firstName = emp.name.split(' ')[0].toLowerCase().trim();
    if (!empLookup.has(firstName)) {
      empLookup.set(firstName, emp);
    }
  }

  const newShifts = [];
  const skipped = [];
  const errors = [];

  for (const assignment of csvData.assignments) {
    const nameKey = assignment.employeeName.toLowerCase().trim();
    const emp = empLookup.get(nameKey) || empLookup.get(nameKey.split(' ')[0]);

    if (!emp) {
      skipped.push({ name: assignment.employeeName, reason: 'not found in DB' });
      continue;
    }

    // Calculate the target date from weekMonday + dayIndex
    const shiftDate = new Date(weekMonday);
    shiftDate.setDate(weekMonday.getDate() + assignment.dayIndex);
    shiftDate.setHours(0, 0, 0, 0);

    newShifts.push({
      date: shiftDate,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      section: assignment.section,
      status: shiftDate < new Date() ? 'COMPLETED' : 'ASSIGNED',
      employeeId: emp.id,
      outletId,
    });
  }

  // Bulk create
  let created = 0;
  if (newShifts.length > 0) {
    const result = await prisma.shift.createMany({ data: newShifts });
    created = result.count;
  }

  return {
    created,
    skipped: skipped.length,
    skippedNames: [...new Set(skipped.map(s => s.name))],
    errors,
    total: csvData.assignments.length,
  };
}
