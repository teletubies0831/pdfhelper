import '../../src/viewer-launcher/bootstrap';
import { markSidepanelFirstRunSeen } from '../../src/viewer-launcher/sidepanel-first-run';

void markSidepanelFirstRunSeen().catch((error: unknown) => {
  console.error('记录 PDFPal 首次侧边栏状态失败：', error);
});
