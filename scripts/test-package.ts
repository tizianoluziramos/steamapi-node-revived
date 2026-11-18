import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface PackedPackage {
  filename: string
  name: string
  version: string
  files: Array<{ path: string }>
}

const project = process.cwd()
const npm = process.env.npm_execpath
assert.ok(npm, 'Run this check through npm.')
const directory = mkdtempSync(join(tmpdir(), 'steamapi-node-revived-'))
const env = { ...process.env, npm_config_cache: join(directory, 'npm-cache') }

function run(args: string[], cwd: string): string {
  return execFileSync(process.execPath, args, { cwd, env, encoding: 'utf8' })
}

try {
  const output = run([npm, 'pack', '--json', '--pack-destination', directory], project)
  const [packed] = JSON.parse(output) as PackedPackage[]
  assert.ok(packed)
  assert.equal(packed.name, 'steamapi-node-revived')
  assert.equal(packed.version, '1.0.0')
  const paths = packed.files.map(({ path }) => path)
  for (const file of ['LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md', 'dist/index.js', 'dist/index.d.ts', 'dist/require.cjs', 'dist/require.d.cts']) {
    assert.ok(paths.includes(file), `Missing from npm package: ${file}`)
  }
  assert.ok(paths.every((file) => /^(dist\/|LICENSE$|NOTICE$|README\.md$|CHANGELOG\.md$|package\.json$)/.test(file)))

  writeFileSync(join(directory, 'package.json'), '{"private":true,"type":"module"}\n')
  run([npm, 'install', '--offline', '--ignore-scripts', '--no-audit', join(directory, packed.filename)], directory)
  writeFileSync(join(directory, 'consumer.mts'), `
import SteamUser, { SteamClient, SteamApiError, endpointCatalog } from 'steamapi-node-revived'
import type { AppDetails, ReviewsPage, SteamEndpoint } from 'steamapi-node-revived'
import assert from 'node:assert/strict'

const sdk = new SteamUser()
const alias = new SteamClient()
const endpoint: SteamEndpoint | undefined = endpointCatalog[0]
const catalog = sdk.web.endpoints
const details: (app: number) => Promise<AppDetails> = sdk.games.getGameDetails
const reviews: (app: number) => Promise<ReviewsPage> = sdk.store.getReviews
assert.equal(catalog[0], endpoint)
assert.equal(typeof details, 'function')
assert.equal(typeof reviews, 'function')
assert.equal(alias instanceof SteamUser, true)
assert.equal(typeof SteamApiError, 'function')
`)
  writeFileSync(join(directory, 'consumer.cts'), `
import SteamUser = require('steamapi-node-revived')
import assert = require('node:assert/strict')
const sdk = new SteamUser('example')
assert.equal(typeof sdk.others.resolve, 'function')
assert.equal(SteamUser, SteamUser.SteamUser)
assert.equal(SteamUser, SteamUser.default)
assert.equal(typeof SteamUser.SteamApiError, 'function')
`)
  run([
    resolve(project, 'node_modules/typescript/bin/tsc'),
    '--target', 'ES2023', '--module', 'NodeNext', '--strict', '--skipLibCheck', '--types', 'node',
    '--typeRoots', resolve(project, 'node_modules/@types'), 'consumer.mts', 'consumer.cts',
  ], directory)
  run(['consumer.mjs'], directory)
  run(['consumer.cjs'], directory)
  run(['--input-type=module', '-e', `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import SteamUser from 'steamapi-node-revived'
const require = createRequire(import.meta.url)
assert.equal(require('steamapi-node-revived'), SteamUser)
`], directory)
  process.stdout.write(`Verified ${packed.filename} in ESM and CommonJS, including TypeScript consumer declarations.\n`)
} finally {
  rmSync(directory, { recursive: true, force: true })
}
