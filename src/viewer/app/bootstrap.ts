import { registerPdfRuntime } from './registrations/register-pdf-runtime';
import { registerAssistantEvents } from './registrations/register-assistant-events';
import { registerKnowledgeEvents } from './registrations/register-knowledge-events';
import { registerReaderEvents } from './registrations/register-reader-events';
import { registerTranslationEvents } from './registrations/register-translation-events';
import { registerLifecycle } from './registrations/register-lifecycle';

export * from './app-ui';

export function bootstrapViewer(): void {
  registerPdfRuntime();
  registerAssistantEvents();
  registerKnowledgeEvents();
  registerReaderEvents();
  registerTranslationEvents();
  registerLifecycle();
}
