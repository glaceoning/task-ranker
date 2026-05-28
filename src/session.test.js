import { describe, expect, it } from 'vitest';
import { parseCsvText, validateSession } from './session.js';

describe('CSV parsing', () => {
  it('parses arbitrary headers and quoted commas', () => {
    const csv = 'Name,Notes,Status\n"A, tricky task","line one, line two",Open\n';
    const parsed = parseCsvText(csv);
    expect(parsed.columns).toEqual(['Name', 'Notes', 'Status']);
    expect(parsed.tasks[0].displayName).toBe('A, tricky task');
    expect(parsed.tasks[0].values.Notes).toBe('line one, line two');
  });

  it('handles missing values and duplicate-looking task names', () => {
    const csv = 'Task,Owner\nSame,\nSame,Alex\n';
    const parsed = parseCsvText(csv);
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0].id).not.toBe(parsed.tasks[1].id);
    expect(parsed.tasks[0].values.Owner).toBe('');
  });
});

describe('session validation', () => {
  it('accepts a valid versioned session', () => {
    expect(() =>
      validateSession({
        version: 1,
        sourceFileName: 'tasks.csv',
        columns: ['Task'],
        tasks: [{ id: 'task-1', originalIndex: 0, values: { Task: 'One' }, displayName: 'One' }],
        pickerState: {
          rankedIds: [],
          blockersByTaskId: { 'task-1': [] },
          roundQueue: ['task-1'],
          roundSurvivors: [],
          currentBatchIds: ['task-1'],
          mode: 'classic',
          splitDraft: null,
        },
        options: { visibleColumns: ['Task'] },
      }),
    ).not.toThrow();
  });

  it('rejects invalid blocker references', () => {
    expect(() =>
      validateSession({
        version: 1,
        columns: ['Task'],
        tasks: [{ id: 'task-1', originalIndex: 0, values: { Task: 'One' }, displayName: 'One' }],
        pickerState: {
          rankedIds: [],
          blockersByTaskId: { 'task-1': ['missing'] },
        },
        options: { visibleColumns: ['Task'] },
      }),
    ).toThrow(/invalid blocker/i);
  });
});
