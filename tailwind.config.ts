import type { Config } from 'tailwindcss'

/**
 * Semantic colour roles, mapped to the OKLCH values in globals.css.
 *
 * Named for the job rather than the hue, so a role can be re-tuned in one place without every
 * component that uses it becoming a lie about what colour it is.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
          ghost: 'var(--ink-ghost)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          ink: 'var(--accent-ink)',
        },
        gain: 'var(--gain)',
        caution: 'var(--caution)',
        risk: 'var(--risk)',
      },
    },
  },
  plugins: [],
}

export default config
