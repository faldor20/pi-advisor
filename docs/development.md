# Development

## Local setup

```bash
git clone git@github.com:philipbrembeck/pi-advisor.git
cd pi-advisor
bun install
```

## Checks

Run the full project checks before opening a pull request:

```bash
bun test
bun run typecheck
bun run lint
git -c diff.stat=false diff --no-ext-diff --check --no-stat
```

GitHub Actions manages release tags and publishing from `package.json`. Do not create release tags manually.
