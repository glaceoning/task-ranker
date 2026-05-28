import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Download,
  FileInput,
  HelpCircle,
  ListRestart,
  PanelRight,
  Search,
  Settings2,
  ShieldCheck,
  Shuffle,
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div>
            <h1>Favorite Tasks Picker</h1>
            <p>{session ? session.sourceFileName : 'Private CSV ranking in your browser'}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={() => importInputRef.current?.click()}>
            <FileInput size={17} aria-hidden="true" />
            Import session
          </button>
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
          {session && (
            <button className="ghost-button danger" type="button" onClick={clearSession}>
              <X size={17} aria-hidden="true" />
              New CSV
            </button>
          )}
        </div>
      </header>

      {notice && <div className="notice">{notice}</div>}

      {stage === 'empty' && <UploadScreen onFile={handleCsvFile} />}

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
          <aside className="side-panel">
            <div className="tabs" role="tablist" aria-label="Picker details">
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
  );
}

function UploadScreen({ onFile }) {
  return (
    <main className="upload-layout">
      <section className="upload-card">
        <div className="upload-icon">
          <Upload size={28} aria-hidden="true" />
        </div>
        <h2>Load a CSV of tasks</h2>
        <p>
          Every row becomes one task. The picker keeps the file on this device and works with
          whatever columns your CSV has.
        </p>
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
      </section>
    </main>
  );
}

function PreviewScreen({ session, onFile, onStart, updateOptions }) {
  const previewTasks = session.tasks.slice(0, 5);
  return (
    <main className="preview-layout">
      <section className="preview-header">
        <div>
          <p className="overline">CSV loaded</p>
          <h2>{session.tasks.length} tasks ready to rank</h2>
          <p>
            Review the columns, choose whether the first pass should split liked tasks from the
            rest, then start picking.
          </p>
        </div>
        <div className="preview-actions">
          <label className="ghost-button file-swap">
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
            Start Picking
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="preview-grid">
        <div className="preview-table">
          <div className="table-title">First rows</div>
          {previewTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              columns={session.columns}
              visibleColumns={session.columns.slice(0, 4)}
              selected={false}
              compact
            />
          ))}
        </div>
        <div className="setup-panel">
          <label className="switch-row">
            <input
              type="checkbox"
              checked={session.options.splitMode}
              onChange={(event) => updateOptions({ splitMode: event.target.checked })}
            />
            <span>
              <strong>Split Mode first pass</strong>
              <small>Pick every task you like in the first cycle; leave the rest aside.</small>
            </span>
          </label>
          <label className="range-label">
            Batch size
            <span>{session.options.batchSize}</span>
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
  const remaining = session.tasks.length - picker.rankedIds.length;

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
      <div className="panel-heading">
        <div>
          <p className="overline">{isSplit ? 'Split pass' : 'Picker group'}</p>
          <h2>{isSplit ? 'Pick every task you like here' : 'Pick your favorites from this group'}</h2>
          <p>
            {isSplit
              ? 'Unpicked tasks wait outside the preferred set until your favorites are found.'
              : 'Selected tasks stay alive; unselected tasks remember who beat them.'}
          </p>
        </div>
        <div className="progress-card">
          <strong>{session.pickerState.rankedIds.length}</strong>
          <span>found</span>
          <strong>{remaining}</strong>
          <span>left</span>
        </div>
      </div>

      {picker.mode === 'complete' ? (
        <div className="empty-state">
          <Check size={34} aria-hidden="true" />
          <h3>Every task is ordered.</h3>
          <p>Export the favorites list or restart with a fresh shuffle whenever you like.</p>
        </div>
      ) : picker.mode === 'stalled' ? (
        <div className="empty-state">
          <HelpCircle size={34} aria-hidden="true" />
          <h3>The picker needs a rescue.</h3>
          <p>Open Found Favorites and rescue a task so it can return to the running.</p>
        </div>
      ) : (
        <>
          <div className="batch-grid">
            {batch.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                columns={session.columns}
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
            <button
              className="primary-button"
              type="button"
              onClick={onPick}
              disabled={!isSplit && selectedIds.size === 0}
            >
              <Check size={18} aria-hidden="true" />
              Pick {selectedIds.size ? selectedIds.size : ''}
            </button>
            <button className="ghost-button" type="button" onClick={onPass}>
              {isSplit ? 'Pass on this group' : 'Pass'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function TaskCard({ task, visibleColumns, selected, onClick, compact = false, dimmed = false }) {
  const shownColumns = visibleColumns.filter((column) => task.values[column] !== undefined);
  return (
    <button
      type="button"
      className={`task-card ${selected ? 'selected' : ''} ${compact ? 'compact' : ''} ${
        dimmed ? 'dimmed' : ''
      }`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="task-title">{task.displayName}</span>
      <span className="task-row-index">Row {task.originalIndex + 1}</span>
      <dl>
        {shownColumns.map((column) => (
          <div key={column}>
            <dt>{column}</dt>
            <dd>{task.values[column] || '—'}</dd>
          </div>
        ))}
      </dl>
    </button>
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
    <div className="panel-body">
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
        Click here to check what happened to a task
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
    <div className="panel-body options-stack">
      <label className="range-label">
        Batch size
        <span>{session.options.batchSize}</span>
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
          <strong>Split Mode first pass</strong>
          <small>Available before restarting the picker.</small>
        </span>
      </label>

      <label className="select-label">
        Focus filter
        <input
          value={session.options.search}
          onChange={(event) => updateOptions({ search: event.target.value })}
          placeholder="Dim current-batch tasks that do not match"
        />
      </label>

      <label className="select-label">
        Density
        <select
          value={session.options.density}
          onChange={(event) => updateOptions({ density: event.target.value })}
        >
          <option value="friendly">Friendly</option>
          <option value="compact">Compact</option>
        </select>
      </label>

      <fieldset className="columns-fieldset">
        <legend>Visible columns</legend>
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
        <button className="ghost-button" type="button" onClick={() => onRestart({ shuffle: false })}>
          <ListRestart size={17} aria-hidden="true" />
          Restart
        </button>
        <button className="ghost-button" type="button" onClick={() => onRestart({ shuffle: true })}>
          <Shuffle size={17} aria-hidden="true" />
          Shuffle restart
        </button>
        <button className="ghost-button" type="button" onClick={onExportFavorites}>
          <Download size={17} aria-hidden="true" />
          Export favorites CSV
        </button>
        <button className="ghost-button" type="button" onClick={onExportSession}>
          <PanelRight size={17} aria-hidden="true" />
          Export session JSON
        </button>
        <button className="ghost-button" type="button" onClick={onImport}>
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
