/**
 * Floating task/hint toast for the graph page.
 *
 * Same visual language as the knowledge-base索引 toast (`library.css`, `.knowledge-background-task-toast`):
 * a small plate with a spinner, a one-line message and a progress bar, which turns into ✓ / ! and then
 * disappears on its own. That reuse is intentional — the user pointed at that toast and asked for this
 * one to match — and it is **class reuse only**: this feature imports nothing from the knowledge-base
 * UI, per that feature's boundary.
 *
 * Why a toast at all: the page header already carries the same text, but on a wide screen the header
 * line sits far from where the user is looking (the canvas), and it truncates. A floating plate is
 * readable at a glance, and a *finished* task removes itself so the canvas is never permanently covered.
 */

const NOTICE_ID = 'knowledge-graph-task-notice';

/** How long a finished task stays on screen before removing itself. */
const LINGER_MS = 4_000;

let hideTimer: number | null = null;

export type GraphTaskNoticeState = 'active' | 'success' | 'error';

export interface GraphTaskNoticeInput {
  message: string;
  /** `active` keeps the spinner and the plate; the other two schedule the removal. */
  state?: GraphTaskNoticeState;
  /** 0–100 for the progress bar; absent means "indeterminate", drawn as a short stub. */
  progress?: number;
}

function ensureNotice(): HTMLElement {
  let notice = document.getElementById(NOTICE_ID);
  if (notice) return notice;
  notice = document.createElement('div');
  notice.id = NOTICE_ID;
  notice.className = 'knowledge-background-task-toast knowledge-graph-task-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'knowledge-background-task-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = '知识图谱';
  const text = document.createElement('p');
  const bar = document.createElement('i');
  body.append(title, text, bar);

  notice.append(spinner, body);
  document.body.append(notice);
  return notice;
}

/**
 * Shows or updates the toast.
 *
 * Updating in place rather than stacking: a task that reports ten progress lines is one task, and ten
 * plates would cover the graph it is reporting on.
 */
export function showGraphTaskNotice(input: GraphTaskNoticeInput): void {
  const message = input.message.trim();
  if (!message) {
    hideGraphTaskNotice();
    return;
  }
  const state = input.state ?? 'active';
  const notice = ensureNotice();
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  notice.classList.toggle('is-success', state === 'success');
  notice.classList.toggle('is-error', state === 'error');
  const text = notice.querySelector('p');
  if (text) text.textContent = message;
  const bar = notice.querySelector<HTMLElement>('i');
  if (bar) {
    const progress = input.progress ?? (state === 'active' ? 12 : 100);
    bar.style.width = `${Math.max(3, Math.min(100, progress))}%`;
  }
  if (state !== 'active') {
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      hideGraphTaskNotice();
    }, LINGER_MS);
  }
}

/** Removes the toast now — used when the page is closed, so it cannot float over another workspace. */
export function hideGraphTaskNotice(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  document.getElementById(NOTICE_ID)?.remove();
}

export { NOTICE_ID as GRAPH_TASK_NOTICE_ID };
