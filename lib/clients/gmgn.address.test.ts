import { describe, expect, it } from 'vitest'
import { isQueryableAddress } from './gmgn'

/*
 * These guard an argument-injection hole found in review, not a formatting preference.
 *
 * The security client passes an address straight into a CLI argument vector. `execFile` runs no
 * shell, so `;` and `$()` are inert, but a value that begins with a dash is still read by the CLI
 * as a FLAG rather than as the address: `--address --version` made gmgn-cli print its version and
 * exit 0 instead of querying anything. The address reaches that argv from a request body, so
 * anything not shaped like an address must be refused before the process is spawned.
 */
describe('addresses accepted for a CLI query', () => {
  it('accepts an ordinary EVM address', () => {
    expect(isQueryableAddress('0xe7e521FEa973E2102652260beB0E21618BE62D2e')).toBe(true)
  })

  it('accepts one in any case, since callers pass both', () => {
    expect(isQueryableAddress('0xe7e521fea973e2102652260beb0e21618be62d2e')).toBe(true)
  })

  it('refuses a value that would be read as a flag', () => {
    expect(isQueryableAddress('--version')).toBe(false)
    expect(isQueryableAddress('--chain')).toBe(false)
    expect(isQueryableAddress('-v')).toBe(false)
  })

  it('refuses a flag hidden after whitespace', () => {
    expect(isQueryableAddress(' --version')).toBe(false)
    expect(isQueryableAddress('\t--raw')).toBe(false)
  })

  it('refuses an address with a flag appended, which argv would split', () => {
    expect(isQueryableAddress('0xe7e521FEa973E2102652260beB0E21618BE62D2e --raw')).toBe(false)
  })

  it('refuses anything of the wrong length, so a truncated id cannot slip through', () => {
    expect(isQueryableAddress('0xe7e5')).toBe(false)
    expect(isQueryableAddress(`0x${'a'.repeat(64)}`)).toBe(false)
  })

  it('refuses non-hex characters', () => {
    expect(isQueryableAddress(`0x${'z'.repeat(40)}`)).toBe(false)
  })

  it('refuses an empty value', () => {
    expect(isQueryableAddress('')).toBe(false)
  })

  it('refuses shell metacharacters, which are inert here but never valid input', () => {
    expect(isQueryableAddress('0xdead;rm -rf /')).toBe(false)
    expect(isQueryableAddress('$(whoami)')).toBe(false)
  })
})
