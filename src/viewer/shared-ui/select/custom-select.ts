const enhancedSelects = new WeakSet<HTMLSelectElement>();

function syncSelect(select: HTMLSelectElement): void {
  const wrapper = select.closest<HTMLElement>(".ui-select");
  const trigger = wrapper?.querySelector<HTMLButtonElement>(".ui-select-trigger");
  const value = trigger?.querySelector<HTMLElement>(".ui-select-value");
  const menu = wrapper?.querySelector<HTMLElement>(".ui-select-menu");
  if (!wrapper || !trigger || !value || !menu) return;
  const selected = select.selectedOptions[0] || select.options[0];
  value.textContent = selected?.textContent?.trim() || select.getAttribute("placeholder") || "请选择";
  trigger.disabled = select.disabled;
  wrapper.hidden = select.hidden;
  trigger.setAttribute("aria-label", select.getAttribute("aria-label") || value.textContent);
  wrapper.classList.toggle("is-disabled", select.disabled);
  menu.replaceChildren(...Array.from(select.options).map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-select-option";
    button.dataset.optionIndex = String(index);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.selected));
    button.disabled = option.disabled;
    button.textContent = option.textContent || option.value;
    if (option.selected) button.classList.add("is-selected");
    return button;
  }));
}

function closeSelect(wrapper: HTMLElement, focusTrigger = false): void {
  const trigger = wrapper.querySelector<HTMLButtonElement>(".ui-select-trigger");
  const menu = wrapper.querySelector<HTMLElement>(".ui-select-menu");
  if (!trigger || !menu) return;
  wrapper.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
  if (menu.matches(":popover-open")) menu.hidePopover();
  menu.hidden = true;
  menu.classList.remove("is-floating", "opens-upward");
  menu.removeAttribute("style");
  if (focusTrigger) trigger.focus();
}

function positionOpenMenu(trigger: HTMLButtonElement, menu: HTMLElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportGap = 8;
  const menuGap = 6;
  const availableBelow = window.innerHeight - triggerRect.bottom - viewportGap - menuGap;
  const availableAbove = triggerRect.top - viewportGap - menuGap;
  const naturalHeight = Math.min(menu.scrollHeight, 280);
  const opensUpward = availableBelow < naturalHeight && availableAbove > availableBelow;
  const availableHeight = Math.max(80, opensUpward ? availableAbove : availableBelow);
  const menuHeight = Math.min(naturalHeight, availableHeight);
  const maxWidth = Math.min(360, window.innerWidth - viewportGap * 2);
  const menuWidth = Math.min(maxWidth, Math.max(triggerRect.width, menu.scrollWidth));
  const left = Math.min(
    Math.max(viewportGap, triggerRect.left),
    Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap),
  );
  const top = opensUpward
    ? Math.max(viewportGap, triggerRect.top - menuHeight - menuGap)
    : triggerRect.bottom + menuGap;

  menu.classList.toggle("opens-upward", opensUpward);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.width = `${menuWidth}px`;
  menu.style.maxHeight = `${availableHeight}px`;
}

function closeOtherSelects(current?: HTMLElement): void {
  for (const wrapper of document.querySelectorAll<HTMLElement>(".ui-select.is-open")) {
    if (wrapper !== current) closeSelect(wrapper);
  }
}

function enhanceSelect(select: HTMLSelectElement): void {
  if (enhancedSelects.has(select) || select.hidden || select.multiple || select.size > 1 || select.dataset.nativeSelect === "true") return;
  enhancedSelects.add(select);
  const wrapper = document.createElement("div");
  wrapper.className = `ui-select ${select.className}`.trim();
  select.className = "ui-select-native";
  select.before(wrapper);
  wrapper.append(select);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ui-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<span class="ui-select-value"></span><span class="ui-select-caret" aria-hidden="true"></span>';
  const menu = document.createElement("div");
  menu.className = "ui-select-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("popover", "manual");
  menu.hidden = true;
  wrapper.append(trigger, menu);
  syncSelect(select);

  trigger.addEventListener("click", () => {
    syncSelect(select);
    const opening = !wrapper.classList.contains("is-open");
    closeOtherSelects(wrapper);
    wrapper.classList.toggle("is-open", opening);
    trigger.setAttribute("aria-expanded", String(opening));
    menu.hidden = !opening;
    if (opening) {
      menu.classList.add("is-floating");
      menu.showPopover();
      positionOpenMenu(trigger, menu);
      menu.querySelector<HTMLElement>(".is-selected:not(:disabled), .ui-select-option:not(:disabled)")?.focus();
    }
  });
  menu.addEventListener("click", (event) => {
    const optionButton = (event.target as HTMLElement).closest<HTMLButtonElement>(".ui-select-option");
    if (!optionButton || optionButton.disabled) return;
    const option = select.options[Number(optionButton.dataset.optionIndex)];
    if (!option) return;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncSelect(select);
    closeSelect(wrapper, true);
  });
  menu.addEventListener("keydown", (event) => {
    const options = Array.from(menu.querySelectorAll<HTMLButtonElement>(".ui-select-option:not(:disabled)"));
    const current = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      options[(current + offset + options.length) % options.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSelect(wrapper, true);
    }
  });
  select.addEventListener("change", () => syncSelect(select));
}

export function installReusableSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>("select").forEach(enhanceSelect);
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (!document.querySelector(".ui-select.is-open")) return;
    if (!(target instanceof Element) || !target.closest(".ui-select, .ui-select-menu")) closeOtherSelects();
  }, true);
  window.addEventListener("resize", () => closeOtherSelects());
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target instanceof HTMLSelectElement) {
        enhanceSelect(record.target);
        syncSelect(record.target);
      }
      if (record.target instanceof HTMLOptionElement) {
        const select = record.target.closest("select");
        if (select) syncSelect(select);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLSelectElement) enhanceSelect(node);
        node.querySelectorAll<HTMLSelectElement>("select").forEach(enhanceSelect);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden", "label", "selected"],
    characterData: true,
  });
}
