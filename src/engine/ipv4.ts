export interface ParsedIPv4 {
  address: string
  octets: [number, number, number, number]
  value: number
}

export function parseIPv4(address: string): ParsedIPv4 | null {
  if (typeof address !== 'string') return null
  const parts = address.trim().split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const values = parts.map(Number)
  if (values.some((part) => part < 0 || part > 255)) return null
  const octets = values as [number, number, number, number]
  return { address: octets.join('.'), octets, value: ipv4ToInt(octets.join('.')) }
}

export function ipv4ToInt(address: string): number {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error('非法 IPv4 地址：' + address)
  }
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0
}

export function prefixToMask(prefix: number): string {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('非法 IPv4 prefix：' + prefix)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return [mask >>> 24, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.')
}

export function isValidCidr(cidr: string): boolean {
  const parts = cidr.split('/')
  if (parts.length !== 2 || !parseIPv4(parts[0])) return false
  const prefix = Number(parts[1])
  return /^\d{1,2}$/.test(parts[1]) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!isValidCidr(cidr) || !parseIPv4(ip)) return false
  const [network, prefixText] = cidr.split('/')
  const prefix = Number(prefixText)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask)
}

export function sameSubnet(a: string, b: string, prefix: number): boolean {
  if (!parseIPv4(a) || !parseIPv4(b) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4ToInt(a) & mask) === (ipv4ToInt(b) & mask)
}

export function prefixOfCidr(cidr: string): number {
  if (!isValidCidr(cidr)) throw new Error('非法 CIDR：' + cidr)
  return Number(cidr.split('/')[1])
}

export function cidrContainsCidr(container: string, candidate: string): boolean {
  if (!isValidCidr(container) || !isValidCidr(candidate)) return false
  const prefix = prefixOfCidr(container)
  return prefix <= prefixOfCidr(candidate) && isIpInCidr(candidate.split('/')[0], container)
}
