import { createInteractionBoundary } from '../shared-ui/interaction/interaction-boundary';
import { viewerContainer } from './viewer-elements';

export const interactionBoundary = createInteractionBoundary(document, viewerContainer);
