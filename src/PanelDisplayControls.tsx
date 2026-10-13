export type PanelTheme = 'dark' | 'light'

export default function PanelDisplayControls({ theme, onThemeChange }: {
  theme: PanelTheme
  onThemeChange: (theme: PanelTheme) => void
}) {
  return <div className="panel-display-controls">
    <button type="button" className="panel-theme-button" onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  </div>
}
