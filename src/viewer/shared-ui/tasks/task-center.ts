/**
 * 全局任务中心（底部状态条）.
 *
 * The problem it solves: extraction is an asynchronous job that outlives the page it started on. The old progress surface was
 * a toast owned by the knowledge-graph page, so switching to the reader hid the only indication that a run was in flight —
 * and with it the only explanation for why the API was busy.
 *
 * So this is a singleton bar attached to `document.body` (not to any workspace), in the shape of an IDE's status bar:
 *
 * - one collapsed line per running task: title, `N/M`, percentage, and the reason it is where it is;
 * - a 详情 toggle that expands to the full list with per-task cancel;
 * - the bar exists only while something is running or recently finished, and finished tasks can be dismissed.
 *
 * It owns no business logic: callers push progress, and the cancel button calls back into whatever started the task. That
 * keeps the component usable by extraction, relation analysis and anything added later, without the component knowing what
 * any of them do.
 */

export type TaskStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskState {
  id: string;
  title: string;
  detail: string;
  /** 0–100; `null` means indeterminate (a spinner, no percentage). */
  progress: number | null;
  completed: number;
  total: number;
  status: TaskStatus;
  startedAt: number;
  cancelable: boolean;
}

export interface StartTaskInput {
  title: string;
  detail?: string;
  /** Total units (chunks, batches, papers). 0/absent means "not measurable yet". */
  total?: number;
  cancelable?: boolean;
  /** Called when the user presses 停止. The task does not end by itself — the owner must finish it. */
  onCancel?: () => void;
}

export interface TaskHandle {
  readonly id: string;
  /** Replaces the visible text and/or the counters. */
  update(patch: { title?: string; detail?: string; completed?: number; total?: number }): void;
  /** Counts up, which is what progress callbacks usually do. */
  advance(units: number, detail?: string): void;
  finish(status: Exclude<TaskStatus, 'running'>, detail?: string): void;
}

const BAR_ID = 'pdfpal-task-center';

const tasks = new Map<string, TaskState>();
const cancelHandlers = new Map<string, () => void>();
let expanded = false;
let dismissTimer: number | null = null;

function percentOf(task: TaskState): number | null {
  if (task.status !== 'running') return task.status === 'done' ? 100 : task.progress;
  if (!task.total) return task.progress;
  return Math.min(100, Math.round((task.completed / task.total) * 100));
}

function ensureBar(): HTMLElement {
  const existing = document.getElementById(BAR_ID);
  if (existing) return existing;
  const bar = document.createElement('section');
  bar.id = BAR_ID;
  bar.className = 'task-center';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.hidden = true;

  const head = document.createElement('div');
  head.className = 'task-center-head';
  const icon = document.createElement('span');
  icon.className = 'task-center-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '◐';
  const text = document.createElement('div');
  text.className = 'task-center-text';
  const title = document.createElement('strong');
  title.className = 'task-center-title';
  const detail = document.createElement('span');
  detail.className = 'task-center-detail';
  text.append(title, detail);
  const meter = document.createElement('div');
  meter.className = 'task-center-meter';
  const fill = document.createElement('i');
  fill.className = 'task-center-fill';
  meter.append(fill);
  const actions = document.createElement('div');
  actions.className = 'task-center-actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'task-center-toggle';
  toggle.textContent = '详情';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'task-center-cancel';
  cancel.textContent = '停止';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'task-center-close';
  close.setAttribute('aria-label', '收起任务栏');
  close.textContent = '×';
  actions.append(toggle, cancel, close);
  head.append(icon, text, meter, actions);

  const list = document.createElement('ul');
  list.className = 'task-center-list';
  list.hidden = true;

  bar.append(head, list);
  document.body.append(bar);

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    render();
  });
  close.addEventListener('click', () => {
    // Dismissing only closes the bar; a running task is not silently cancelled — that is what 停止 is for.
    expanded = false;
    for (const [id, task] of [...tasks]) {
      if (task.status === 'running') continue;
      tasks.delete(id);
      cancelHandlers.delete(id);
    }
    render();
  });
  cancel.addEventListener('click', () => {
    const running = [...tasks.values()].filter((task) => task.status === 'running' && task.cancelable);
    for (const task of running) cancelHandlers.get(task.id)?.();
  });
  return bar;
}

function render(): void {
  const bar = ensureBar();
  const running = [...tasks.values()].filter((task) => task.status === 'running');
  const shown = running.at(-1) ?? [...tasks.values()].at(-1);
  if (!shown) {
    bar.hidden = true;
    if (dismissTimer !== null) {
      window.clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    return;
  }
  bar.hidden = false;
  bar.classList.toggle('is-expanded', expanded);
  bar.classList.toggle('is-done', shown.status === 'done');
  bar.classList.toggle('is-failed', shown.status === 'failed' || shown.status === 'cancelled');

  const title = bar.querySelector<HTMLElement>('.task-center-title');
  if (title) title.textContent = shown.title;
  const detail = bar.querySelector<HTMLElement>('.task-center-detail');
  if (detail) {
    const count = shown.total ? `${shown.completed}/${shown.total}` : '';
    detail.textContent = [shown.detail, count].filter(Boolean).join(' · ');
  }
  const percent = percentOf(shown);
  const fill = bar.querySelector<HTMLElement>('.task-center-fill');
  if (fill) {
    fill.style.width = percent === null ? '24%' : `${percent}%`;
    fill.classList.toggle('is-indeterminate', percent === null && shown.status === 'running');
  }
  const icon = bar.querySelector<HTMLElement>('.task-center-icon');
  if (icon) icon.textContent = shown.status === 'done' ? '✓' : shown.status === 'failed' ? '!' : shown.status === 'cancelled' ? '■' : '◐';
  const toggle = bar.querySelector<HTMLElement>('.task-center-toggle');
  if (toggle) toggle.textContent = expanded ? '收起' : `详情（${tasks.size}）`;
  const cancel = bar.querySelector<HTMLElement>('.task-center-cancel');
  const cancelable = running.some((task) => task.cancelable);
  if (cancel) {
    cancel.hidden = !cancelable;
    cancel.textContent = running.length > 1 ? `全部停止（${running.length}）` : '停止';
  }

  const list = bar.querySelector<HTMLElement>('.task-center-list');
  if (!list) return;
  list.hidden = !expanded;
  list.replaceChildren(...[...tasks.values()].reverse().map((task) => {
    const row = document.createElement('li');
    row.className = `task-center-row is-${task.status}`;
    row.dataset.taskId = task.id;
    const label = document.createElement('span');
    label.className = 'task-center-row-title';
    label.textContent = task.title;
    const state = document.createElement('span');
    state.className = 'task-center-row-detail';
    const percentText = percentOf(task);
    state.textContent = [
      task.detail,
      task.total ? `${task.completed}/${task.total}` : '',
      percentText === null ? '' : `${percentText}%`,
    ].filter(Boolean).join(' · ');
    row.append(label, state);
    if (task.status === 'running' && task.cancelable) {
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'task-center-row-stop';
      stop.textContent = '停止';
      stop.addEventListener('click', () => cancelHandlers.get(task.id)?.());
      row.append(stop);
    }
    return row;
  }));

  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  // A finished bar removes itself after a moment (the IDE behaviour), unless the user has it expanded.
  if (!running.length && !expanded) {
    dismissTimer = window.setTimeout(() => {
      dismissTimer = null;
      for (const [id, task] of [...tasks]) {
        if (task.status !== 'running') {
          tasks.delete(id);
          cancelHandlers.delete(id);
        }
      }
      render();
    }, 6_000);
  }
}

let sequence = 0;

/** Starts a task and returns a handle the owner uses to report progress and completion. */
export function startTask(input: StartTaskInput): TaskHandle {
  const id = `task-${Date.now()}-${(sequence += 1)}`;
  const task: TaskState = {
    id,
    title: input.title,
    detail: input.detail ?? '',
    progress: null,
    completed: 0,
    total: Math.max(0, Math.round(input.total ?? 0)),
    status: 'running',
    startedAt: Date.now(),
    cancelable: Boolean(input.cancelable),
  };
  tasks.set(id, task);
  if (input.onCancel) cancelHandlers.set(id, input.onCancel);
  render();

  const update = (patch: { title?: string; detail?: string; completed?: number; total?: number }): void => {
    if (patch.title !== undefined) task.title = patch.title;
    if (patch.detail !== undefined) task.detail = patch.detail;
    if (patch.completed !== undefined) task.completed = Math.max(0, Math.round(patch.completed));
    if (patch.total !== undefined) task.total = Math.max(0, Math.round(patch.total));
    render();
  };

  return {
    id,
    update,
    advance(units, detail) {
      update({ completed: task.completed + units, ...(detail !== undefined ? { detail } : {}) });
    },
    finish(status, detail) {
      task.status = status;
      if (detail !== undefined) task.detail = detail;
      cancelHandlers.delete(id);
      render();
    },
  };
}

/** 供测试与「是否存在后台任务」的判断使用. */
export function listTasks(): TaskState[] {
  return [...tasks.values()];
}

/** 测试用：清空所有任务与 DOM。 */
export function resetTasksForTest(): void {
  tasks.clear();
  cancelHandlers.clear();
  expanded = false;
  document.getElementById(BAR_ID)?.remove();
}
