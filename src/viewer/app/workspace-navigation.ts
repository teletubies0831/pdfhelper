import {
  knowledgeBasePageElement,
  readerWorkspaceElement,
  vocabularyLibraryPageElement,
  workspaceStageElement,
} from "./viewer-elements";

export type WorkspaceView = "viewer" | "knowledge" | "vocabulary";

const WORKSPACE_ORDER: WorkspaceView[] = [
  "viewer",
  "knowledge",
  "vocabulary",
];

const workspaceElements: Record<WorkspaceView, HTMLElement> = {
  viewer: readerWorkspaceElement,
  knowledge: knowledgeBasePageElement,
  vocabulary: vocabularyLibraryPageElement,
};

const workspaceViews = Object.values(workspaceElements);
const stageChildren = Array.from(workspaceStageElement.children);
if (
  stageChildren.length !== workspaceViews.length ||
  workspaceViews.some((element) => element.parentElement !== workspaceStageElement)
) {
  throw new Error(
    "Workspace stage must contain exactly the viewer, knowledge, and vocabulary pages.",
  );
}

let activeWorkspaceView: WorkspaceView = !vocabularyLibraryPageElement.hidden
  ? "vocabulary"
  : !knowledgeBasePageElement.hidden
    ? "knowledge"
    : "viewer";
let workspaceTransitionToken = 0;
let workspaceAnimations: Animation[] = [];

function detectVisibleWorkspace(): WorkspaceView {
  if (!vocabularyLibraryPageElement.hidden) return "vocabulary";
  if (!knowledgeBasePageElement.hidden) return "knowledge";
  return "viewer";
}

function clearWorkspaceTransitionPresentation(): void {
  workspaceStageElement.classList.remove("is-transitioning");
  for (const element of workspaceViews) {
    element.classList.remove(
      "is-workspace-outgoing",
      "is-workspace-incoming",
    );
  }
}

function cancelWorkspaceTransition(): void {
  workspaceTransitionToken += 1;
  for (const animation of workspaceAnimations) animation.cancel();
  workspaceAnimations = [];
  clearWorkspaceTransitionPresentation();
}

function settleWorkspace(view: WorkspaceView): void {
  activeWorkspaceView = view;
  for (const [candidate, element] of Object.entries(workspaceElements) as Array<
    [WorkspaceView, HTMLElement]
  >) {
    const visible = candidate === view;
    element.hidden = !visible;
    element.inert = !visible;
    element.toggleAttribute("aria-hidden", !visible);
  }
  clearWorkspaceTransitionPresentation();
}

export function getActiveWorkspaceView(): WorkspaceView {
  return activeWorkspaceView;
}

export async function transitionWorkspaceView(
  view: WorkspaceView,
): Promise<void> {
  if (!workspaceAnimations.length) activeWorkspaceView = detectVisibleWorkspace();
  if (view === activeWorkspaceView) {
    const activeAnimations = [...workspaceAnimations];
    if (activeAnimations.length) {
      await Promise.allSettled(
        activeAnimations.map((animation) => animation.finished),
      );
    }
    return;
  }

  const outgoingView = activeWorkspaceView;
  cancelWorkspaceTransition();
  settleWorkspace(outgoingView);

  const transitionToken = ++workspaceTransitionToken;
  const outgoing = workspaceElements[outgoingView];
  const incoming = workspaceElements[view];
  const direction = WORKSPACE_ORDER.indexOf(view) >
      WORKSPACE_ORDER.indexOf(outgoingView)
    ? 1
    : -1;

  activeWorkspaceView = view;
  workspaceStageElement.classList.add("is-transitioning");

  for (const [candidate, element] of Object.entries(workspaceElements) as Array<
    [WorkspaceView, HTMLElement]
  >) {
    const involved = candidate === outgoingView || candidate === view;
    element.hidden = !involved;
    element.inert = candidate !== view;
    element.toggleAttribute("aria-hidden", candidate !== view);
  }
  outgoing.classList.add("is-workspace-outgoing");
  incoming.classList.add("is-workspace-incoming");

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    settleWorkspace(view);
    return;
  }

  const timing: KeyframeAnimationOptions = {
    duration: 300,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    fill: "both",
  };
  workspaceAnimations = [
    outgoing.animate([
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      {
        transform: `translate3d(${-direction * 14}px, 0, 0) scale(0.992)`,
        opacity: 0,
      },
    ], timing),
    incoming.animate([
      {
        transform: `translate3d(${direction * 20}px, 0, 0) scale(0.992)`,
        opacity: 0,
      },
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
    ], timing),
  ];

  await Promise.allSettled(
    workspaceAnimations.map((animation) => animation.finished),
  );
  if (transitionToken !== workspaceTransitionToken) return;

  const completedAnimations = workspaceAnimations;
  workspaceAnimations = [];
  settleWorkspace(view);
  for (const animation of completedAnimations) animation.cancel();
}
