import type { Scenario } from '../types/scenario'

/**
 * Shareable, self-contained scenario links.
 *
 * The whole scenario travels inside the URL fragment-free query string, compressed
 * with deflate-raw. Nothing is uploaded: the receiver decodes and re-validates the
 * configuration locally, then re-runs the deterministic engine. This is what makes
 * "same input, same result" verifiable by a third party.
 */

const PARAM = 's'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new Blob([bytes.slice().buffer]).stream()
  const piped = source.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

export function canShareScenario(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'
}

export async function encodeScenario(scenario: Scenario): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(scenario))
  return toBase64Url(await transform(raw, new CompressionStream('deflate-raw')))
}

export async function decodeScenario(token: string): Promise<Scenario> {
  const raw = await transform(fromBase64Url(token), new DecompressionStream('deflate-raw'))
  return JSON.parse(new TextDecoder().decode(raw)) as Scenario
}

export async function buildShareUrl(scenario: Scenario): Promise<string> {
  const token = await encodeScenario(scenario)
  const url = new URL(window.location.href)
  url.hash = ''
  url.search = ''
  url.searchParams.set(PARAM, token)
  return url.toString()
}

export function readSharedToken(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(PARAM)
}

export function clearSharedToken(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has(PARAM)) return
  url.searchParams.delete(PARAM)
  window.history.replaceState({}, '', url.toString())
}
