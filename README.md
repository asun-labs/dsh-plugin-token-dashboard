# Token Dashboard for DeepSeek Harness

`@asun-labs/dsh-plugin-token-dashboard` is a DeepSeek Harness bundle plugin that reads the host's validated live and persisted session corpus and generates a self-contained offline HTML token dashboard.

## Features

- Exact provider-reported input, output, cache-read, and cache-write token accounting
- Daily volume, 24-hour activity, model share, and KPI views
- Workspace → session → request drilldown
- Interactive 1/7/30-day and all-history windows
- Light/dark theme stored only in the browser
- One local HTML file with no external scripts, fonts, requests, or telemetry
- Fork-aware accounting that excludes inherited event prefixes

## Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- DeepSeek Harness `0.1.7` prerelease line

## Install

Install the public npm package into a Harness profile:

```powershell
dsh plugin --profile token-dashboard add @asun-labs/dsh-plugin-token-dashboard
dsh --profile token-dashboard --dump-config
dsh --profile token-dashboard --no-open
```

If the profile does not exist yet, initialize it once before installing the plugin:

```powershell
dsh --profile token-dashboard --from-default-profile web --dump-config | Out-Null
```

In the Web UI, ask the agent:

```text
Use the token_dashboard tool to generate my token usage dashboard.
```

The tool writes `token-dashboard.html` into the active session's workspace and reports its absolute path.

## Validate from a local checkout

From the DeepSeek Harness checkout:

```powershell
corepack pnpm run build
corepack pnpm dsh --profile token-dashboard --from-default-profile web --dump-config | Out-Null
corepack pnpm dsh plugin --profile token-dashboard add D:\git-workspace\AI\DSH\dsh-plugin-token-dashboard
corepack pnpm dsh --profile token-dashboard --dump-config
corepack pnpm dsh --profile token-dashboard --no-open
```

The first command must complete successfully because a source checkout needs its official Host, Client, and Typert artifacts before Web can start. The profile initialization command is one-time only; omit `--from-default-profile web` after the profile exists.

## Local source overlay

For fast iteration without installing a profile bundle, create an absolute-path overlay:

```yaml
- insert:
    - id: dsh-token-dashboard
      name: 'D:/git-workspace/AI/DSH/dsh-plugin-token-dashboard/src/index.ts'
      config:
        fileName: token-dashboard.html
        readConcurrency: 4
```

Then run from the Harness checkout:

```powershell
corepack pnpm run build
corepack pnpm dsh web --patch D:\git-workspace\AI\DSH\dsh-plugin-token-dashboard\local.cordis.patch.yml
```

## Configuration

```yaml
config:
  fileName: token-dashboard.html
  readConcurrency: 4
```

- `fileName` must be a plain `.html` filename. The plugin never writes outside the active workspace.
- `readConcurrency` is an integer from 1 through 32.

## Privacy

The plugin reads session snapshots through the public `sessionQuery` service. It does not scan storage internals, upload logs, or make network requests. Generated HTML contains usage metadata, workspace paths, session titles, and model names; review it before sharing.

## Attribution and licensing

The product idea was inspired by [fuyi-git/token-dashboard](https://github.com/fuyi-git/token-dashboard). That repository did not include a redistribution license when this implementation was created, so this project is an independent TypeScript implementation and does not copy its Python or HTML source.

This project is licensed under the MIT License.
