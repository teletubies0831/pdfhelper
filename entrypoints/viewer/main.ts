import "pdfjs-dist/web/pdf_viewer.css";
import "katex/dist/katex.min.css";
import './style.css';
import { mountViewerShell } from '../../src/viewer/app/app-shell';

mountViewerShell();
void import('../../src/viewer/app/bootstrap').then(({ bootstrapViewer }) => {
  bootstrapViewer();
});
