// The Working glyph's animated region: swaps the spinner frames on its own clock, one turn per period.
// Self-contained: it runs on the drawing thread and takes everything it needs as plain props.

type SpinnerProps = { frames: string[]; periodMs: number; color?: string; dimColor?: boolean };

export default function Spinner(props: SpinnerProps, surface: any) {
  const frames = props.frames.length > 0 ? props.frames : [" "];
  if (surface.state === undefined) {
    let frame = 0;
    surface.every(Math.max(100, Math.round(props.periodMs / frames.length)), () => {
      frame = (frame + 1) % frames.length;
      surface.setState({ frame });
    });
    surface.setState({ frame: 0 });
  }
  const frame = (surface.state?.frame ?? 0) % frames.length;
  return surface.elements.Text({ color: props.color, dimColor: props.dimColor, children: frames[frame] });
}
