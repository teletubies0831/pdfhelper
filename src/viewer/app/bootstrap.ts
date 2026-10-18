import { registerPdfRuntime } from './registrations/register-pdf-runtime';
import { registerAssistantEvents } from './registrations/register-assistant-events';
import { registerKnowledgeEvents } from './registrations/register-knowledge-events';
import { registerKnowledgeGraphEvents } from './registrations/register-knowledge-graph-events';
import { registerKnowledgeRecentEvents } from './registrations/register-knowledge-recent-events';
import { registerReaderEvents } from './registrations/register-reader-events';
import { registerTranslationEvents } from './registrations/register-translation-events';
import { registerVocabularyEvents } from './registrations/register-vocabulary-events';
import { registerLifecycle } from './registrations/register-lifecycle';
import { registerAppErrorDialogEvents } from './error-dialog';
import { initializeOnboardingTour } from '../features/onboarding-tour/public';
import { interactionBoundary } from './interaction-boundary';
import { initializeResponsiveWorkspace } from './responsive-workspace';

export * from './app-ui';

export function bootstrapViewer(): void {
  interactionBoundary.install();
  // Before everything else: any error raised during the rest of the boot has to have
  // a surface to be shown on.
  registerAppErrorDialogEvents();
  registerPdfRuntime();
  registerAssistantEvents();
  registerKnowledgeEvents();
  registerKnowledgeGraphEvents();
  registerKnowledgeRecentEvents();
  registerReaderEvents();
  registerTranslationEvents();
  registerVocabularyEvents();
  registerLifecycle();
  initializeResponsiveWorkspace();
  initializeOnboardingTour();
}
