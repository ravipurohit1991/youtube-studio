import type { IpcResult } from '@shared/types'

/** Unwrap the IPC envelope, turning a failed result into a thrown Error. */
export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong'
}

export function clampPercent(value: number): number {
  if (!isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}
