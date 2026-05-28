export function createInitialPickerState(allTaskIds, batchSize = 20, splitMode = false) {
  const blockersByTaskId = Object.fromEntries(allTaskIds.map((id) => [id, []]));
  const base = {
    rankedIds: [],
    blockersByTaskId,
    roundQueue: [],
    roundSurvivors: [],
    currentBatchIds: [],
    mode: allTaskIds.length ? (splitMode ? 'split' : 'classic') : 'complete',
    splitDraft: splitMode ? { selectedIds: [], rejectedIds: [] } : null,
    notice: '',
  };

  if (allTaskIds.length <= 1) {
    return {
      ...base,
      rankedIds: [...allTaskIds],
      mode: 'complete',
      notice: allTaskIds.length ? 'The only task is already your favorite.' : 'Load tasks to begin.',
    };
  }

  return takeNextBatch({ ...base, roundQueue: [...allTaskIds] }, batchSize);
}

export function advanceClassic(state, allTaskIds, selectedIds, batchSize = 20, options = {}) {
  if (state.mode !== 'classic') return state;
  const selected = unique(selectedIds);
  const currentBatch = state.currentBatchIds;
  const blockersByTaskId = cloneBlockers(state.blockersByTaskId);
  const selectedSet = new Set(selected);
  const losers = currentBatch.filter((id) => !selectedSet.has(id));

  if (!options.isPass) {
    for (const loser of losers) {
      blockersByTaskId[loser] = unique([...(blockersByTaskId[loser] ?? []), ...selected]);
    }
  }

  const survivors = unique([...state.roundSurvivors, ...selected]);
  const next = {
    ...state,
    blockersByTaskId,
    roundSurvivors: survivors,
    notice: options.isPass
      ? 'Passed. This group stays alive for a later round.'
      : 'Picked. The unselected tasks will wait behind your favorites.',
  };

  if (state.roundQueue.length > 0) {
    return takeNextBatch(next, batchSize);
  }

  return startClassicRound(
    { ...next, roundSurvivors: [], currentBatchIds: [] },
    allTaskIds,
    batchSize,
    survivors,
  );
}

export function advanceSplit(state, allTaskIds, selectedIds, batchSize = 20) {
  if (state.mode !== 'split') return state;
  const selected = unique(selectedIds);
  const selectedSet = new Set(selected);
  const rejected = state.currentBatchIds.filter((id) => !selectedSet.has(id));
  const splitDraft = {
    selectedIds: unique([...(state.splitDraft?.selectedIds ?? []), ...selected]),
    rejectedIds: unique([...(state.splitDraft?.rejectedIds ?? []), ...rejected]),
  };
  const next = {
    ...state,
    splitDraft,
    notice: selected.length
      ? 'Saved those split choices.'
      : 'Passed on this group for the split pass.',
  };

  if (state.roundQueue.length > 0) {
    return takeNextBatch(next, batchSize);
  }

  if (splitDraft.selectedIds.length === 0) {
    return startClassicRound(
      {
        ...next,
        mode: 'classic',
        splitDraft: null,
        roundSurvivors: [],
        currentBatchIds: [],
        notice: 'Nothing was selected in Split Mode, so everyone stays in the running.',
      },
      allTaskIds,
      batchSize,
      allTaskIds,
    );
  }

  const blockersByTaskId = cloneBlockers(next.blockersByTaskId);
  for (const rejectedId of splitDraft.rejectedIds) {
    blockersByTaskId[rejectedId] = unique([
      ...(blockersByTaskId[rejectedId] ?? []),
      ...splitDraft.selectedIds,
    ]);
  }

  return startClassicRound(
    {
      ...next,
      blockersByTaskId,
      mode: 'classic',
      splitDraft: null,
      roundSurvivors: [],
      currentBatchIds: [],
      notice: 'Split pass complete. Now ranking the preferred set.',
    },
    allTaskIds,
    batchSize,
    splitDraft.selectedIds,
  );
}

export function moveRankedTask(state, taskId, direction) {
  const from = state.rankedIds.indexOf(taskId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= state.rankedIds.length) return state;
  const rankedIds = [...state.rankedIds];
  const [item] = rankedIds.splice(from, 1);
  rankedIds.splice(to, 0, item);
  return { ...state, rankedIds, notice: 'Favorites reordered.' };
}

export function rescueTask(state, allTaskIds, taskId, batchSize = 20) {
  if (state.rankedIds.includes(taskId)) return state;
  const blockersByTaskId = cloneBlockers(state.blockersByTaskId);
  blockersByTaskId[taskId] = [];
  const active = unique([taskId, ...state.currentBatchIds, ...state.roundQueue, ...state.roundSurvivors])
    .filter((id) => !state.rankedIds.includes(id));
  return startClassicRound(
    {
      ...state,
      blockersByTaskId,
      mode: 'classic',
      splitDraft: null,
      roundSurvivors: [],
      currentBatchIds: [],
      notice: 'Task rescued.',
    },
    allTaskIds,
    batchSize,
    active,
  );
}

export function getEligibleUnrankedIds(state, allTaskIds) {
  const ranked = new Set(state.rankedIds);
  return allTaskIds.filter((id) => {
    if (ranked.has(id)) return false;
    return (state.blockersByTaskId[id] ?? []).every((blockerId) => ranked.has(blockerId));
  });
}

function startClassicRound(state, allTaskIds, batchSize, activeIds) {
  let next = { ...state, mode: 'classic' };
  let active = unique(activeIds).filter((id) => !next.rankedIds.includes(id));

  while (active.length <= 1) {
    if (active.length === 1 && !next.rankedIds.includes(active[0])) {
      next = {
        ...next,
        rankedIds: [...next.rankedIds, active[0]],
        notice: 'A new favorite was found.',
      };
    }

    const unranked = allTaskIds.filter((id) => !next.rankedIds.includes(id));
    if (unranked.length === 0) {
      return {
        ...next,
        mode: 'complete',
        roundQueue: [],
        roundSurvivors: [],
        currentBatchIds: [],
        notice: 'All tasks have been ordered.',
      };
    }

    active = getEligibleUnrankedIds(next, allTaskIds);
    if (active.length === 0) {
      return {
        ...next,
        mode: 'stalled',
        roundQueue: [],
        roundSurvivors: [],
        currentBatchIds: [],
        notice: 'No task can advance yet. Rescue a task to continue.',
      };
    }
  }

  return takeNextBatch(
    {
      ...next,
      mode: 'classic',
      roundQueue: active,
      roundSurvivors: [],
      currentBatchIds: [],
    },
    batchSize,
  );
}

function takeNextBatch(state, batchSize) {
  const size = Math.max(2, Math.min(20, Number(batchSize) || 20));
  const currentBatchIds = state.roundQueue.slice(0, size);
  const roundQueue = state.roundQueue.slice(size);
  return { ...state, currentBatchIds, roundQueue };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function cloneBlockers(blockersByTaskId) {
  return Object.fromEntries(
    Object.entries(blockersByTaskId).map(([taskId, blockers]) => [taskId, [...blockers]]),
  );
}
