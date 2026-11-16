import os
"""Check changed JavaScript source references without importing product code."""
from pathlib import Path
import re

root = Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT','D:/METIS超级合并/dsh-plugin/designcraft'))
files = [
    'host/local-design-workflows.js', 'host/local-workflow-routes.js', 'host/native-color-source.js', 'host/document-color-audit.js', 'host/color-contrast.js', 'host/image-plan-binding.js', 'host/chinese-design-brief.js', 'host/opendesign-design-brief-v1.js', 'host/director-snapshots.js', 'host/design-plan-migration.js', 'host/deck-local-inputs.js', 'client/deck-local-tools.js', 'client/local-capture.js', 'client/mathml-to-omml.js', 'client/local-workflow-panel.js',
    'host/external-github-source.js', 'host/external-git-tree.js', 'host/external-skill-seed.js',
    'host/external-skill-bundles.js', 'host/external-theme.js', 'host/external-html-import.js', 'host/opendesign-html-import.js', 'host/external-skill-build-worker.js',
    'host/external-skill-verify-worker.js', 'host/project-fonts.js', 'host/open-design-tools.js',
    'host/od-workflow-context.js', 'host/open-design-library.js', 'host/open-design-package.js', 'host/html-artifacts.js', 'host/html-dependency-hints.js', 'host/tailwind-preview.js', 'host/html-tailwind-freeze.js', 'host/html-font-contract.js', 'host/html-project-font.js', 'host/html-project-asset.js', 'host/project-graph.js', 'host/html-routes.js', 'host/html-tools.js', 'host/project-package.js',
    'host/native.js', 'host/source-export.js', 'host/presentation-admission.js', 'host/editor-routes.js', 'host/image-jobs.js', 'host/image-provider.js', 'host/venice-image-transform.js',
    'host/fal-image-provider.js', 'host/fal-storage-upload.js', 'host/fal-remote-artifacts.js', 'host/fal-workflow-service.js', 'host/fal-workflow-tool.js', 'host/fal-workflow-routes.js', 'host/fal-realtime.js', 'host/fal-realtime-native.js', 'host/fal-realtime-tool.js', 'host/fal-realtime-routes.js', 'host/venice-audio.js', 'host/venice-audio-tool.js',
    'host/venice-video.js', 'host/venice-video-tool.js', 'host/private-link-protector.js', 'host/figma-source.js', 'host/figma-source-tool.js',
    'host/replicate-workflow.js', 'host/replicate-workflow-tool.js', 'host/openai-svg.js', 'host/openai-svg-tool.js', 'host/studio-image.js',
    'host/stitch-mcp.js', 'host/stitch-service.js', 'host/stitch-source.js', 'host/stitch-image-import.js', 'host/stitch-tool.js',
    'host/static-external-svg.js', 'host/figma-mcp-service.js', 'host/figma-mcp-image.js', 'host/figma-mcp-upload.js', 'host/figma-mcp-download.js', 'host/figma-mcp-prompt.js', 'host/figma-mcp-file-native.js', 'host/figma-html-inline.js', 'host/figma-html-transfer.js', 'host/figma-mcp-tool.js', 'host/figma-mcp-routes.js',
    'host/ecommerce-workflow.js', 'host/ecommerce-tool.js', 'host/ecommerce-routes.js',
    'host/workflow-image-import.js', 'host/workflow-image-routes.js',
    'host/image-api-settings.js', 'client/image-api-settings.js',
    'host/stock-images.js', 'host/stock-native.js', 'host/stock-tool.js', 'host/stock-routes.js', 'client/stock-panel.js',
    'host/pixelbin-oauth.js', 'host/pixelbin-service.js', 'host/pixelbin-source.js', 'host/pixelbin-operations.js', 'host/pixelbin-tool.js', 'host/pixelbin-routes.js',
    'host/design-plans.js', 'host/design-plan-links.js', 'host/design-plan-tool.js', 'host/design-plan-restore.js', 'host/opendesign-design-brief.js', 'host/opendesign-brief-job.js', 'host/opendesign-brief-tool.js', 'host/editor-session.js', 'host/native-source-store.js', 'host/dsh-tools.js', 'host/index.js', 'host/workspace-native.js',
    'client/editor-frame.js', 'client/editor-surface.js', 'client/native-controller.js',
    'client/native-workspace.js', 'client/html-workspace.js', 'client/figma-mcp-panel.js', 'client/studio-image-workspace.js', 'client/fal-realtime-panel.js', 'client/fal-workflow-panel.js', 'client/pixelbin-workspace.js', 'client/ecommerce-panel.js', 'client/workflow-image-panel.js', 'client/image-ui.js', 'client/sync.js', 'client/ui.js',
]
pattern = re.compile(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bnew\s+URL\s*\(\s*)["'](\.{1,2}/[^"']+)["']''')
missing = []
count = 0
for name in files:
    path = root / name
    for target in pattern.findall(path.read_text(encoding='utf-8')):
        count += 1
        candidate = path.parent / target.split('?', 1)[0]
        if not candidate.exists():
            missing.append((name, target))
for name in ('host/external-skill-build-worker.js', 'host/external-skill-verify-worker.js'):
    if not (root / name).is_file():
        missing.append(('worker', name))
if missing:
    raise SystemExit('Missing source references: ' + repr(missing))
print(f'Checked {count} literal relative references in {len(files)} source files; workers exist.')
