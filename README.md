# Github Trigger CI Action

Purges the helix pages cache on push.

## Inputs

### `repo-token`

**Required** A github token to issue the dummy commit.

### `helix-url`

**Optional** Base url of the helix pages instance. Uses
`ref--repo--owner.hlx.page` by default.

## Example usage

Add a yaml file with the following contents inside .github/workflows, as
described in [github actions quick
start](https://docs.github.com/en/free-pro-team@latest/actions/quickstart).

```yaml
on: push

jobs:
  ci_trigger:
    runs-on: ubuntu-latest
    name: Clear helix pages cache
    steps:
      - name: Trigger
        id: trigger
        uses: adobe-rnd/github-purge-cache-action@master
        with:
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```

# Development

Please run the build script before release to regenerate dist/index.html

```sh-session
$ npm run build
$ git commit -am "..."
$ git push
```
