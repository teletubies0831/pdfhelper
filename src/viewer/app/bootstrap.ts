import { registerPdfRuntime } from './registrations/register-pdf-runtime';
import { registerAssistantEvents } from './registrations/register-assistant-events';
import { registerKnowledgeEvents } from './registrations/register-knowledge-events';
import { registerKnowledgeRecentEvents } from './registrations/register-knowledge-recent-events';
import { registerReaderEvents } from './registrations/register-reader-events';
import { registerTranslationEvents } from './registrations/register-translation-events';
import { registerVocabularyEvents } from './registrations/register-vocabulary-events';
import { registerLifecycle } from './registrations/register-lifecycle';
import { initializeOnboardingTour } from '../features/onboarding-tour/public';
import { interactionBoundary } from './interaction-boundary';

export * from './app-ui';

export function bootstrapViewer(): void {
  interactionBoundary.install();
  registerPdfRuntime();
  registerAssistantEvents();
  registerKnowledgeEvents();
  registerKnowledgeRecentEvents();
  registerReaderEvents();
  registerTranslationEvents();
  registerVocabularyEvents();
  registerLifecycle();
  initializeOnboardingTour();
}
