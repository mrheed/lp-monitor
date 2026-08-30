import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Files that make up the deployable hook, shown read-only in the deploy UI. */
const HOOK_FILES = {
  'VolumeTierFeeHook.sol': 'hook/src/VolumeTierFeeHook.sol',
  'Deploy.s.sol': 'hook/script/Deploy.s.sol',
} as const

export type HookSourceFile = keyof typeof HOOK_FILES

export type HookSource = { name: HookSourceFile; content: string }

/**
 * Read the hook's Solidity sources from disk so the UI always shows exactly
 * what compiles and deploys, with no duplicated copy to drift.
 */
export const getHookSource = async (): Promise<HookSource[]> => {
  const root = process.cwd()
  const entries = Object.entries(HOOK_FILES) as [HookSourceFile, string][]
  return Promise.all(
    entries.map(async ([name, path]) => ({
      name,
      content: await readFile(join(root, path), 'utf8'),
    })),
  )
}
