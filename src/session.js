import Papa from 'papaparse';

export async function parseCsvFile(file) {
  const text = await file.text();
  return parseCsvText(text, file.name);
}

export function parseCsvText(text, sourceFileName = 'tasks.csv') {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
    transform: (value) => (value ?? '').trim(),
  });

  if (parsed.errors?.length) {
    const fatal = parsed.errors.find((error) => error.type !== 'FieldMismatch');
    if (fatal) throw new Error(`CSV parse error on row ${fatal.row ?? '?'}: ${fatal.message}`);
  }

  const columns = (parsed.meta.fields ?? []).filter(Boolean);
  if (!columns.length) throw new Error('The CSV needs a header row.');

  const tasks = parsed.data
    .filter((row) => columns.some((column) => String(row[column] ?? '').trim()))
    .map((row, index) => {
      const values = Object.fromEntries(columns.map((column) => [column, String(row[column] ?? '')]));
      const displayName = columns.map((column) => values[column]).find(Boolean) || `Row ${index + 1}`;
      return {
        id: `task-${index + 1}`,
        originalIndex: index,
        values,
        displayName,
      };
    });

  if (!tasks.length) throw new Error(`${sourceFileName} does not contain any task rows.`);
  return { columns, tasks };
}

export function exportFavoritesCsv(session) {
  const taskMap = new Map(session.tasks.map((task) => [task.id, task]));
  const headers = ['Favorite Rank', 'Original Row', ...session.columns];
  const rows = session.pickerState.rankedIds
    .map((id, index) => {
      const task = taskMap.get(id);
      if (!task) return null;
      return [
        String(index + 1),
        String(task.originalIndex + 1),
        ...session.columns.map((column) => task.values[column] ?? ''),
      ];
    })
    .filter(Boolean);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  downloadBlob(csv, 'text/csv;charset=utf-8', 'favorite-tasks.csv');
}

export function exportSessionJson(session) {
  const payload = {
    ...session,
    savedAt: new Date().toISOString(),
  };
  downloadBlob(
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8',
    'favorite-tasks-session.json',
  );
}

export async function importSessionFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That JSON file could not be parsed.');
  }
  validateSession(parsed);
  return parsed;
}

export function validateSession(session) {
  if (session.version !== 1) throw new Error('This session version is not supported.');
  if (!Array.isArray(session.columns) || !session.columns.length) {
    throw new Error('The session is missing CSV columns.');
  }
  if (!Array.isArray(session.tasks) || !session.tasks.length) {
    throw new Error('The session is missing tasks.');
  }
  const ids = new Set(session.tasks.map((task) => task.id));
  if (ids.size !== session.tasks.length) throw new Error('The session has duplicate task ids.');
  for (const task of session.tasks) {
    if (!task.id || !Number.isInteger(task.originalIndex) || typeof task.values !== 'object') {
      throw new Error('The session contains an invalid task row.');
    }
  }
  const picker = session.pickerState;
  if (!picker || !Array.isArray(picker.rankedIds) || typeof picker.blockersByTaskId !== 'object') {
    throw new Error('The session is missing picker state.');
  }
  for (const id of picker.rankedIds) {
    if (!ids.has(id)) throw new Error('The session references an unknown ranked task.');
  }
  for (const [taskId, blockers] of Object.entries(picker.blockersByTaskId)) {
    if (!ids.has(taskId) || !Array.isArray(blockers) || blockers.some((id) => !ids.has(id))) {
      throw new Error('The session has invalid blocker references.');
    }
  }
  if (!session.options || !Array.isArray(session.options.visibleColumns)) {
    throw new Error('The session is missing options.');
  }
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
