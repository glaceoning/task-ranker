import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Columns3,
  Download,
  FileInput,
  HelpCircle,
  ListRestart,
  PanelRight,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  advanceClassic,
  advanceSplit,
  createInitialPickerState,
  moveRankedTask,
  rescueTask,
} from './pickerEngine.js';
import {
  exportFavoritesCsv,
  exportSessionJson,
  importSessionFile,
  parseCsvFile,
} from './session.js';
import './styles.css';

const STORAGE_KEY = 'favorite-tasks-picker-session-v1';

const DEFAULT_OPTIONS = {
  batchSize: 20,
  splitMode: false,
  density: 'friendly',
  visibleColumns: [],
  search: '',
};

const WORKFLOW_STEPS = [
  { id: 'empty', label: 'CSV' },
  { id: 'preview', label: 'Setup' },
  { id: 'picking', label: 'Picking' },
  { id: 'export', label: 'Export' },
];

function createSession({ sourceFileName, columns, tasks, options = {} }) {
  const mergedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    visibleColumns: options.visibleColumns?.length ? options.visibleColumns : columns,
  };

  return {
    version: 1,
    sourceFileName,
    columns,
    tasks,
    options: mergedOptions,
    pickerState: createInitialPickerState(
      tasks.map((task) => task.id),
      mergedOptions.batchSize,
      mergedOptions.splitMode,
    ),
    createdAt: new Date().toISOString(),
  };
}

function getTaskMap(tasks) {
  return new Map(tasks.map((task) => [task.id, task]));
}

function App() {
  const [session, setSession] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [stage, setStage] = useState(session ? 'picking' : 'empty');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState('favorites');
  const [rescueOpen, setRescueOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const importInputRef = useRef(null);

  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  const taskMap = useMemo(() => getTaskMap(session?.tasks ?? []), [session]);
  const allTaskIds = useMemo(() => session?.tasks.map((task) => task.id) ?? [], [session]);

  const currentBatch = useMemo(() => {
    if (!session) return [];
    return session.pickerState.currentBatchIds
      .map((id) => taskMap.get(id))
      .filter(Boolean);
  }, [session, taskMap]);

  const rankedTasks = useMemo(() => {
    if (!session) return [];
    return session.pickerState.rankedIds
      .map((id) => taskMap.get(id))
      .filter(Boolean);
  }, [session, taskMap]);

  async function handleCsvFile(file) {
    setNotice('');
    try {
      const parsed = await parseCsvFile(file);
      const next = createSession({
        sourceFileName: file.name,
        columns: parsed.columns,
        tasks: parsed.tasks,
      });
      setSession(next);
      setStage('preview');
      setSelectedIds(new Set());
    } catch (error) {
      setNotice(error.message || 'Could not read that CSV.');
    }
  }

  async function handleImportFile(file) {
    setNotice('');
    try {
      const imported = await importSessionFile(file);
      setSession(imported);
      setStage('picking');
      setSelectedIds(new Set());
      setNotice('Session imported and ready.');
    } catch (error) {
      setNotice(error.message || 'Could not import that session.');
    }
  }

  function updateOptions(patch) {
    setSession((current) => {
      if (!current) return current;
      return {
        ...current,
        options: {
          ...current.options,
          ...patch,
        },
      };
    });
  }

  function startPicking() {
    if (!session) return;
    setSession((current) => {
      const pickerState = createInitialPickerState(
        current.tasks.map((task) => task.id),
        current.options.batchSize,
        current.options.splitMode,
      );
      return { ...current, pickerState };
    });
    setSelectedIds(new Set());
    setStage('picking');
    setNotice(
      session.options.splitMode
        ? 'Split mode is on for this first pass. Pick everything that belongs in the preferred set.'
        : 'Pick one or more favorites from each group.',
    );
  }

  function restartPicker({ shuffle = false } = {}) {
    setSession((current) => {
      if (!current) return current;
      const ids = current.tasks.map((task) => task.id);
      const orderedIds = shuffle ? [...ids].sort(() => Math.random() - 0.5) : ids;
      return {
        ...current,
        pickerState: createInitialPickerState(
          orderedIds,
          current.options.batchSize,
          current.options.splitMode,
        ),
      };
    });
    setSelectedIds(new Set());
    setStage('picking');
    setNotice(shuffle ? 'Picker restarted with a fresh shuffle.' : 'Picker restarted.');
  }

  function pickBatch() {
    if (!session) return;
    const selected = Array.from(selectedIds);
    const isSplit = session.pickerState.mode === 'split';
    if (!isSplit && selected.length === 0) {
      setNotice('Choose at least one favorite, or use Pass to keep every task in this group alive.');
      return;
    }

    const nextState = isSplit
      ? advanceSplit(session.pickerState, allTaskIds, selected, session.options.batchSize)
      : advanceClassic(session.pickerState, allTaskIds, selected, session.options.batchSize);

    setSession((current) => ({ ...current, pickerState: nextState }));
    setSelectedIds(new Set());
    setNotice(nextState.notice);
  }

  function passBatch() {
    if (!session) return;
    const selected = session.pickerState.mode === 'split' ? [] : session.pickerState.currentBatchIds;
    const nextState =
      session.pickerState.mode === 'split'
        ? advanceSplit(session.pickerState, allTaskIds, selected, session.options.batchSize)
        : advanceClassic(session.pickerState, allTaskIds, selected, session.options.batchSize, {
            isPass: true,
          });
    setSession((current) => ({ ...current, pickerState: nextState }));
    setSelectedIds(new Set());
    setNotice(nextState.notice);
  }

  function moveFavorite(taskId, direction) {
    setSession((current) => ({
      ...current,
      pickerState: moveRankedTask(current.pickerState, taskId, direction),
    }));
  }

  function rescue(taskId) {
    setSession((current) => ({
      ...current,
      pickerState: rescueTask(current.pickerState, allTaskIds, taskId, current.options.batchSize),
    }));
    setNotice('Task rescued. It can appear in an upcoming picker group.');
  }

  function clearSession() {
    setSession(null);
    setStage('empty');
    setSelectedIds(new Set());
    setNotice('');
  }

  return (
    <div className={`app-shell stage-${stage}`}>
      <input
        ref={importInputRef}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleImportFile(file);
          event.target.value = '';
        }}
      />
      <CommandBar
        session={session}
        onImport={() => importInputRef.current?.click()}
        onClear={clearSession}
      />
      <div className="workbench-shell">
        <WorkflowRail stage={stage} session={session} />
        <div className="surface-stack">
          {notice && <Notice message={notice} />}

          {stage === 'empty' && (
            <UploadScreen onFile={handleCsvFile} onImport={() => importInputRef.current?.click()} />
          )}

          {stage === 'preview' && session && (
            <PreviewScreen
              session={session}
              onFile={handleCsvFile}
              onStart={startPicking}
              updateOptions={updateOptions}
            />
          )}

          {stage === 'picking' && session && (
            <main className={`workspace density-${session.options.density}`}>
              <PickerPanel
                batch={currentBatch}
                session={session}
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                onPick={pickBatch}
                onPass={passBatch}
              />
              <aside className="right-dock">
                <DockTabs activeTab={activeTab} setActiveTab={setActiveTab} />
                {activeTab === 'favorites' ? (
                  <FavoritesPanel
                    session={session}
                    rankedTasks={rankedTasks}
                    taskMap={taskMap}
                    rescueOpen={rescueOpen}
                    setRescueOpen={setRescueOpen}
                    onMove={moveFavorite}
                    onRescue={rescue}
                  />
                ) : (
                  <OptionsPanel
                    session={session}
                    updateOptions={updateOptions}
                    onRestart={restartPicker}
                    onExportFavorites={() => exportFavoritesCsv(session)}
                    onExportSession={() => exportSessionJson(session)}
                    onImport={() => importInputRef.current?.click()}
                  />
                )}
              </aside>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandBar({ session, onImport, onClear }) {
  return (
    <header className="command-bar">
      <div className="brand">
        <div className="brand-mark">
          <ShieldCheck size={19} aria-hidden="true" />
        </div>
        <div className="brand-copy">
          <h1>Favorite Tasks Picker</h1>
          <p>{session ? session.sourceFileName : 'Private CSV ranking in your browser'}</p>
        </div>
      </div>
      <div className="command-actions">
        <button className="quiet-button" type="button" onClick={onImport}>
          <FileInput size={17} aria-hidden="true" />
          Import session
        </button>
        {session && (
          <button className="quiet-button danger" type="button" onClick={onClear}>
            <X size={17} aria-hidden="true" />
            New CSV
          </button>
        )}
      </div>
    </header>
  );
}

function WorkflowRail({ stage, session }) {
  const activeIndex = stage === 'empty' ? 0 : stage === 'preview' ? 1 : 2;
  const foundCount = session?.pickerState.rankedIds.length ?? 0;
  const totalCount = session?.tasks.length ?? 0;

  return (
    <aside className="workflow-rail" aria-label="Workflow">
      {WORKFLOW_STEPS.map((step, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex || (step.id === 'export' && totalCount > 0 && foundCount > 0);
        return (
          <div
            className={`rail-step ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''}`}
            key={step.id}
          >
            <span className="rail-dot">{isComplete ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
            <span>{step.label}</span>
          </div>
        );
      })}
    </aside>
  );
}

function Notice({ message }) {
  return (
    <div className="notice" role="status">
      <span className="notice-pip" />
      {message}
    </div>
  );
}

function UploadScreen({ onFile, onImport }) {
  return (
    <main className="upload-layout">
      <section className="upload-panel">
        <div className="upload-icon">
          <Upload size={30} aria-hidden="true" />
        </div>
        <div>
          <h2>Load a CSV of tasks</h2>
          <p>
            Every row becomes one task. Files stay on this device, and the picker works with the
            columns your CSV already has.
          </p>
        </div>
        <div className="upload-actions">
          <label className="primary-file-button">
            Choose CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <button className="quiet-button" type="button" onClick={onImport}>
            <FileInput size={17} aria-hidden="true" />
            Import session
          </button>
        </div>
        <div className="upload-footer">
          <span>CSV header row required</span>
          <span>JSON sessions supported</span>
          <span>Exports stay local</span>
        </div>
      </section>
    </main>
  );
}

function PreviewScreen({ session, onFile, onStart, updateOptions }) {
  const previewTasks = session.tasks.slice(0, 6);
  return (
    <main className="preview-layout">
      <section className="preview-hero">
        <div>
          <span className="section-label">CSV loaded</span>
          <h2>{session.tasks.length} tasks ready to rank</h2>
          <p>
            Check the first rows, set the batch shape, then start the picker workbench.
          </p>
        </div>
        <div className="preview-actions">
          <label className="quiet-button file-swap">
            <Upload size={17} aria-hidden="true" />
            Replace CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onFile(file);
                event.target.value = '';
              }}
            />
          </label>
          <button className="primary-button" type="button" onClick={onStart}>
            Start picking
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="preview-workbench">
        <div className="preview-table-panel">
          <div className="panel-title-row">
            <div>
              <span className="section-label">First rows</span>
              <h3>{session.sourceFileName}</h3>
            </div>
            <span className="meta-pill">{session.columns.length} columns</span>
          </div>
          <div className="preview-table">
            {previewTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                visibleColumns={session.columns.slice(0, 4)}
                selected={false}
                compact
              />
            ))}
          </div>
        </div>
        <div className="setup-panel">
          <div className="panel-title-row">
            <div>
              <span className="section-label">Setup</span>
              <h3>Picker controls</h3>
            </div>
            <SlidersHorizontal size={18} aria-hidden="true" />
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={session.options.splitMode}
              onChange={(event) => updateOptions({ splitMode: event.target.checked })}
            />
            <span>
              <strong>Split mode</strong>
              <small>First pass separates liked tasks before the full ranking pass.</small>
            </span>
          </label>
          <label className="range-label">
            <span>Batch size</span>
            <strong>{session.options.batchSize}</strong>
            <input
              type="range"
              min="2"
              max="20"
              value={session.options.batchSize}
              onChange={(event) => updateOptions({ batchSize: Number(event.target.value) })}
            />
          </label>
        </div>
      </section>
    </main>
  );
}

function PickerPanel({ batch, session, selectedIds, setSelectedIds, onPick, onPass }) {
  const picker = session.pickerState;
  const isSplit = picker.mode === 'split';
  const remaining = Math.max(0, session.tasks.length - picker.rankedIds.length);
  const eligibleCount = picker.currentBatchIds.length + picker.roundQueue.length;

  function toggle(taskId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  return (
    <section className="picker-panel">
      <div className="picker-heading">
        <div>
          <span className="section-label">{isSplit ? 'Split pass' : 'Picker group'}</span>
          <h2>{isSplit ? 'Pick every task you like here' : 'Pick your favorites from this group'}</h2>
          <p>
            {isSplit
              ? 'Chosen tasks move into the preferred set before final ranking begins.'
              : 'Selected tasks stay alive; unselected tasks remember who beat them.'}
          </p>
        </div>
        <div className="status-strip" aria-label="Picker progress">
          <span>
            <strong>{session.pickerState.rankedIds.length}</strong>
            found
          </span>
          <span>
            <strong>{remaining}</strong>
            left
          </span>
          <span>
            <strong>{eligibleCount}</strong>
            active
          </span>
        </div>
      </div>

      {picker.mode === 'complete' ? (
        <div className="empty-state">
          <Check size={34} aria-hidden="true" />
          <h3>Every task is ordered.</h3>
          <p>Export the favorites list or restart with a fresh shuffle whenever you like.</p>
        </div>
      ) : picker.mode === 'stalled' ? (
        <div className="empty-state warning">
          <HelpCircle size={34} aria-hidden="true" />
          <h3>The picker needs a rescue.</h3>
          <p>Open Found Favorites and rescue a task so it can return to the running.</p>
        </div>
      ) : (
        <>
          <div className="batch-list" aria-label="Current task group">
            {batch.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                visibleColumns={session.options.visibleColumns}
                selected={selectedIds.has(task.id)}
                onClick={() => toggle(task.id)}
                compact={session.options.density === 'compact'}
                dimmed={
                  Boolean(session.options.search.trim()) &&
                  !taskMatchesSearch(task, session.options.search)
                }
              />
            ))}
          </div>
          <div className="picker-actions">
            <div>
              <strong>{selectedIds.size}</strong>
              <span>selected in this group</span>
            </div>
            <button
              className="primary-button"
              type="button"
              onClick={onPick}
              disabled={!isSplit && selectedIds.size === 0}
            >
              <Check size={18} aria-hidden="true" />
              Pick selected
            </button>
            <button className="quiet-button" type="button" onClick={onPass}>
              {isSplit ? 'Pass group' : 'Pass group'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function TaskRow({ task, visibleColumns, selected, onClick, compact = false, dimmed = false }) {
  const shownColumns = visibleColumns.filter((column) => task.values[column] !== undefined);
  const Component = onClick ? 'button' : 'article';
  return (
    <Component
      type={onClick ? 'button' : undefined}
      className={`task-row ${selected ? 'selected' : ''} ${compact ? 'compact' : ''} ${
        dimmed ? 'dimmed' : ''
      }`}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
    >
      <span className="select-indicator">{selected ? <Check size={15} aria-hidden="true" /> : ''}</span>
      <span className="task-row-index">Row {task.originalIndex + 1}</span>
      <span className="task-title">{task.displayName}</span>
      <dl>
        {shownColumns.map((column) => (
          <div key={column}>
            <dt>{column}</dt>
            <dd>{task.values[column] || '-'}</dd>
          </div>
        ))}
      </dl>
    </Component>
  );
}

function DockTabs({ activeTab, setActiveTab }) {
  return (
    <div className="dock-tabs" role="tablist" aria-label="Picker details">
      <button
        type="button"
        className={activeTab === 'favorites' ? 'active' : ''}
        onClick={() => setActiveTab('favorites')}
      >
        <Check size={16} aria-hidden="true" />
        Found Favorites
      </button>
      <button
        type="button"
        className={activeTab === 'options' ? 'active' : ''}
        onClick={() => setActiveTab('options')}
      >
        <Settings2 size={16} aria-hidden="true" />
        Options
      </button>
    </div>
  );
}

function FavoritesPanel({
  session,
  rankedTasks,
  taskMap,
  rescueOpen,
  setRescueOpen,
  onMove,
  onRescue,
}) {
  return (
    <div className="dock-body">
      <div className="dock-heading">
        <div>
          <span className="section-label">Ranked stack</span>
          <h3>Found Favorites</h3>
        </div>
        <span className="meta-pill">{rankedTasks.length}</span>
      </div>
      <div className="favorites-list">
        {rankedTasks.length === 0 ? (
          <div className="mini-empty">Favorites will appear here as winners are found.</div>
        ) : (
          rankedTasks.map((task, index) => (
            <article className="favorite-row" key={task.id}>
              <span className="rank-number">{index + 1}</span>
              <div>
                <strong>{task.displayName}</strong>
                <small>Original row {task.originalIndex + 1}</small>
              </div>
              <div className="rank-actions">
                <button
                  type="button"
                  aria-label="Move up"
                  onClick={() => onMove(task.id, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  onClick={() => onMove(task.id, 1)}
                  disabled={index === rankedTasks.length - 1}
                >
                  <ArrowDown size={15} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      <button className="link-button" type="button" onClick={() => setRescueOpen(!rescueOpen)}>
        Check what happened to a task
      </button>
      {rescueOpen && <RescuePanel session={session} taskMap={taskMap} onRescue={onRescue} />}
    </div>
  );
}

function RescuePanel({ session, taskMap, onRescue }) {
  const [query, setQuery] = useState('');
  const ranked = new Set(session.pickerState.rankedIds);
  const loweredQuery = query.trim().toLowerCase();
  const candidates = session.tasks
    .filter((task) => !ranked.has(task.id))
    .filter((task) => {
      if (!loweredQuery) return true;
      return JSON.stringify(task.values).toLowerCase().includes(loweredQuery);
    });

  return (
    <section className="rescue-panel">
      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search unranked tasks"
        />
      </label>
      <div className="rescue-list">
        {candidates.map((task) => {
          const blockers = session.pickerState.blockersByTaskId[task.id] ?? [];
          return (
            <article className="rescue-row" key={task.id}>
              <div>
                <strong>{task.displayName}</strong>
                <small>
                  {blockers.length
                    ? `Waiting for: ${blockers
                        .map((id) => taskMap.get(id)?.displayName)
                        .filter(Boolean)
                        .join(', ')}`
                    : 'Still active in the picker'}
                </small>
              </div>
              <button type="button" onClick={() => onRescue(task.id)}>
                Rescue
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OptionsPanel({
  session,
  updateOptions,
  onRestart,
  onExportFavorites,
  onExportSession,
  onImport,
}) {
  const hasStarted = session.pickerState.rankedIds.length > 0 || session.pickerState.mode !== 'split';
  return (
    <div className="dock-body options-stack">
      <div className="dock-heading">
        <div>
          <span className="section-label">Session controls</span>
          <h3>Options</h3>
        </div>
        <Settings2 size={18} aria-hidden="true" />
      </div>

      <label className="range-label">
        <span>Batch size</span>
        <strong>{session.options.batchSize}</strong>
        <input
          type="range"
          min="2"
          max="20"
          value={session.options.batchSize}
          onChange={(event) => updateOptions({ batchSize: Number(event.target.value) })}
        />
      </label>

      <label className="switch-row">
        <input
          type="checkbox"
          checked={session.options.splitMode}
          disabled={hasStarted}
          onChange={(event) => updateOptions({ splitMode: event.target.checked })}
        />
        <span>
          <strong>Split mode</strong>
          <small>Available before restarting the picker.</small>
        </span>
      </label>

      <label className="select-label">
        <span>Focus filter</span>
        <input
          value={session.options.search}
          onChange={(event) => updateOptions({ search: event.target.value })}
          placeholder="Dim current-batch tasks that do not match"
        />
      </label>

      <label className="select-label">
        <span>Density</span>
        <select
          value={session.options.density}
          onChange={(event) => updateOptions({ density: event.target.value })}
        >
          <option value="friendly">Friendly</option>
          <option value="compact">Compact</option>
        </select>
      </label>

      <fieldset className="columns-fieldset">
        <legend>
          <Columns3 size={15} aria-hidden="true" />
          Visible columns
        </legend>
        {session.columns.map((column) => (
          <label key={column}>
            <input
              type="checkbox"
              checked={session.options.visibleColumns.includes(column)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...session.options.visibleColumns, column]
                  : session.options.visibleColumns.filter((item) => item !== column);
                updateOptions({ visibleColumns: next.length ? next : [column] });
              }}
            />
            {column}
          </label>
        ))}
      </fieldset>

      <div className="button-grid">
        <button className="quiet-button" type="button" onClick={() => onRestart({ shuffle: false })}>
          <ListRestart size={17} aria-hidden="true" />
          Restart
        </button>
        <button className="quiet-button" type="button" onClick={() => onRestart({ shuffle: true })}>
          <Shuffle size={17} aria-hidden="true" />
          Shuffle restart
        </button>
        <button className="quiet-button" type="button" onClick={onExportFavorites}>
          <Download size={17} aria-hidden="true" />
          Export favorites CSV
        </button>
        <button className="quiet-button" type="button" onClick={onExportSession}>
          <PanelRight size={17} aria-hidden="true" />
          Export session JSON
        </button>
        <button className="quiet-button" type="button" onClick={onImport}>
          <FileInput size={17} aria-hidden="true" />
          Import session JSON
        </button>
      </div>
    </div>
  );
}

function taskMatchesSearch(task, query) {
  const value = query.trim().toLowerCase();
  if (!value) return true;
  return [task.displayName, ...Object.values(task.values)].some((item) =>
    String(item).toLowerCase().includes(value),
  );
}

createRoot(document.getElementById('root')).render(<App />);
