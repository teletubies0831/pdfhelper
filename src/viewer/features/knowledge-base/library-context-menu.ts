/**
 * The library's right-click menu.
 *
 * Built on demand and appended to `<body>`, because it has to escape the list's scroll container and sit above the
 * panels. One instance at a time: opening another closes the previous one, and any pointerdown outside — or Escape —
 * removes it. A menu that can be left behind floating over the page is the classic failure of this pattern.
 */

export interface LibraryContextMenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
  disabled?: boolean;
}

let current: HTMLElement | null = null;
let dismissInstalled = false;

export function closeLibraryContextMenu(): void {
  current?.remove();
  current = null;
}

function installDismissal(): void {
  if (dismissInstalled) return;
  dismissInstalled = true;
  document.addEventListener('pointerdown', (event) => {
    if (!current) return;
    if (current.contains(event.target as Node)) return;
    closeLibraryContextMenu();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLibraryContextMenu();
  });
  window.addEventListener('resize', closeLibraryContextMenu);
  window.addEventListener('blur', closeLibraryContextMenu);
}

export function openLibraryContextMenu(
  items: readonly LibraryContextMenuItem[],
  x: number,
  y: number,
): void {
  closeLibraryContextMenu();
  installDismissal();
  const menu = document.createElement('div');
  menu.className = 'knowledge-context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.className = 'knowledge-context-menu-item';
    if (item.danger) button.classList.add('is-danger');
    if (item.disabled) button.disabled = true;
    button.addEventListener('click', () => {
      closeLibraryContextMenu();
      item.onSelect();
    });
    menu.append(button);
  }
  document.body.append(menu);
  current = menu;

  // Flipped near the viewport edges rather than clamped to it: a menu whose last item sits under the pointer is a menu
  // that closes on itself.
  const rect = menu.getBoundingClientRect();
  const left = x + rect.width > window.innerWidth - 8 ? Math.max(8, x - rect.width) : x;
  const top = y + rect.height > window.innerHeight - 8 ? Math.max(8, y - rect.height) : y;
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
