# steamapi-node-revived

## Installation

```sh
npm install steamapi-node-revived
```

## Usage

```ts
import SteamUser from 'steamapi-node-revived'

const steam = new SteamUser()
const game = await steam.store.getAppDetails(440)

console.log(game.name)
```