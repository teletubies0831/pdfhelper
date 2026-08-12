import { registerPdfRuntime } from './registrations/register-pdf-runtime';
import { registerAssistantEvents } from './registrations/register-assistant-events';
import { registerKnowledgeEvents } from './registrations/register-knowledge-events';
import { registerKnowledgeRecentEvents } from './registrations/register-knowledge-recent-events';
import { registerReaderEvents } from './registrations/register-reader-events';
import { registerTranslationEvents } from './registrations/register-translation-events';
import { registerLifecycle } from './registrations/register-lifecycle';

export * from './app-ui';

export function bootstrapViewer(): void {
  registerPdfRuntime();
  registerAssistantEvents();
  registerKnowledgeEvents();
  registerKnowledgeRecentEvents();
  registerReaderEvents();
  registerTranslationEvents();
  registerLifecycle();
}
