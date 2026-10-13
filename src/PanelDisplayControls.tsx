export type PanelTheme = 'dark' | 'light'

export default function PanelDisplayControls({ theme, width, onThemeChange, onWidthChange }: {
  theme: PanelTheme
  width: number
  onThemeChange: (theme: PanelTheme) => void
  onWidthChange: (width: number) => void
}) {
  return <div className="panel-display-controls">
    <button type="button" className="panel-theme-button" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
    <label className="panel-width-control"><span>Width <strong>{width}%</strong></span><input type="range" min="50" max="80" step="5" value={width} onChange={(event) => onWidthChange(Number(event.target.value))} aria-label="Panel width" /></label>
  </div>
}
