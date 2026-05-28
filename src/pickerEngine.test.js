import { describe, expect, it } from 'vitest';
import {
  advanceClassic,
  advanceSplit,
  createInitialPickerState,
  getEligibleUnrankedIds,
  moveRankedTask,
  rescueTask,
} from './pickerEngine.js';

const ids = ['A', 'B', 'C', 'D'];

describe('picker engine', () => {
  it('eliminates the loser behind the selected winner in a classic pair', () => {
    const state = createInitialPickerState(['A', 'B'], 2, false);
    const next = advanceClassic(state, ['A', 'B'], ['A'], 2);
    expect(next.rankedIds).toEqual(['A', 'B']);
    expect(next.blockersByTaskId.B).toEqual(['A']);
    expect(next.mode).toBe('complete');
  });

  it('records multiple selected blockers for unselected tasks', () => {
    const state = createInitialPickerState(ids, 4, false);
    const next = advanceClassic(state, ids, ['A', 'B'], 2);
    expect(next.blockersByTaskId.C).toEqual(['A', 'B']);
    expect(next.blockersByTaskId.D).toEqual(['A', 'B']);
    expect(next.currentBatchIds).toEqual(['A', 'B']);
  });

  it('brings the second favorite back after the first favorite is found', () => {
    const state = createInitialPickerState(['A', 'B', 'C'], 3, false);
    const afterFirst = advanceClassic(state, ['A', 'B', 'C'], ['A'], 3);
    expect(afterFirst.rankedIds[0]).toBe('A');
    expect(afterFirst.currentBatchIds).toEqual(['B', 'C']);
  });

  it('passes without adding blockers', () => {
    const state = createInitialPickerState(['A', 'B', 'C'], 3, false);
    const next = advanceClassic(state, ['A', 'B', 'C'], ['A', 'B', 'C'], 3, { isPass: true });
    expect(next.blockersByTaskId).toEqual({ A: [], B: [], C: [] });
    expect(next.currentBatchIds).toEqual(['A', 'B', 'C']);
  });

  it('split mode blocks rejected tasks behind every selected task', () => {
    const state = createInitialPickerState(ids, 4, true);
    const next = advanceSplit(state, ids, ['A', 'B'], 2);
    expect(next.blockersByTaskId.C).toEqual(['A', 'B']);
    expect(next.blockersByTaskId.D).toEqual(['A', 'B']);
    expect(next.currentBatchIds).toEqual(['A', 'B']);
  });

  it('rescue clears blockers and makes a task eligible', () => {
    const state = createInitialPickerState(['A', 'B', 'C'], 3, false);
    const afterPick = advanceClassic(state, ['A', 'B', 'C'], ['A'], 3);
    const rescued = rescueTask(afterPick, ['A', 'B', 'C'], 'C', 2);
    expect(rescued.blockersByTaskId.C).toEqual([]);
    expect(getEligibleUnrankedIds(rescued, ['A', 'B', 'C'])).toContain('C');
  });

  it('manual reorder only changes ranked display order', () => {
    const state = {
      ...createInitialPickerState([], 2, false),
      rankedIds: ['A', 'B', 'C'],
      blockersByTaskId: { A: [], B: ['A'], C: ['B'] },
      mode: 'complete',
    };
    const next = moveRankedTask(state, 'C', -1);
    expect(next.rankedIds).toEqual(['A', 'C', 'B']);
    expect(next.blockersByTaskId).toEqual(state.blockersByTaskId);
  });
});
