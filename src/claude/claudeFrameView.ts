import type { ModPaneUi } from '../modApi.ts';
import { FrameCodec } from './frameCodec.ts';
import type { EncodedFrame } from './frameCodec.ts';

// The pane view for a Claude Code mod: draws the frame the mod rendered inside opencode, sends each
// button press back as `{ action }`, and reports the pane size so the mod renders for it.
export default function claudeFrameView(state: { frame: EncodedFrame; size?: { columns: number; rows: number } } | null, ui: ModPaneUi): unknown {
  const isSizeKnown = state?.size?.columns === ui.columns && state?.size?.rows === ui.rows;
  if (!isSizeKnown) {
    ui.send({ size: { columns: ui.columns, rows: ui.rows } });
  }
  return FrameCodec.decode(state?.frame ?? null, (action) => ui.send({ action })) ?? { type: ui.elements.Text, props: { dimColor: true }, children: ['…'] };
}
