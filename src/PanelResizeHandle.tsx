export default function PanelResizeHandle({ width, onWidthChange }: { width: number; onWidthChange: (width: number) => void }) {
  const resizeTo = (clientX: number) => {
    onWidthChange(Math.max(50, Math.min(80, Math.round((window.innerWidth - clientX) / window.innerWidth * 100))))
  }
  return <div className="panel-resize-handle" role="separator" aria-label="Resize telemetry panel" aria-orientation="vertical"
    aria-valuemin={50} aria-valuemax={80} aria-valuenow={width} aria-valuetext={`${width}% of window width`}
    title="Drag to resize panel" tabIndex={0}
    onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); resizeTo(event.clientX); event.preventDefault() }}
    onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTo(event.clientX) }}
    onKeyDown={(event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        onWidthChange(Math.max(50, Math.min(80, width + (event.key === 'ArrowLeft' ? 5 : -5))))
      }
    }} />
}
