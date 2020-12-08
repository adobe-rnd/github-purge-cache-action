/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
const assert = require('assert');
const https = require('https');
const { env } = require('process');
const core = require('@actions/core');
const github = require('@actions/github');
const { curry, pipe, filter, map, identity, obj, get, last } = require('ferrum');
const { entries } = Object;
const phin = require('phin'); // http client
const path = require('path');

/// Like ferrum filter but applied specifically to the key of key
/// value pairs.
///
/// (* -> IntoBool) -> Sequence<[*, *]> -> Sequence<[*, *]>
const filterKey = curry('filterKey', (seq, fn) =>
  filter(seq, ([k, v]) => fn(k)));

/// Like ferrum map but transforms the key specifically from key/value pairs.
///
/// (* -> *) -> Sequence<[*, *]> -> Sequence<[*, *]>
const mapKey = curry('mapKey', (seq, fn) =>
  map(seq, ([k, v]) => [fn(k), v]));

/// Retrieve all the input variables from the environment.
/// (This let's us use object destructuring to assign these).
///
/// () -> Sequence<[String, String]>
const inp = () => pipe(
  entries(env),
  mapKey((k) => k.match(/^INPUT_(.*)/)),
  filterKey(identity),
  mapKey((k) => k[1].replace(/[^a-zA-Z0-9]/, '_').toLowerCase()),
);

/// Takes an url and a path and appends the path to the url path.
///
/// URL|String -> String -> String
const join_url_path = curry('join_url_path', (extension, base) => {
  const {origin, pathname} = new URL(base);
  return `${origin}${path.join(pathname, extension)}`;
});

const main = async () => {
  const { before: base, after: head, compare, ref: full_ref = "master" } = github.context.payload;
  const { repo_token, helix_url: helix_url_param } = obj(inp());

  const [_, owner, repo] = new URL(compare).pathname.split("/"); // surprisingly hard to access
  const ref = last(full_ref.split('/'));
  const helix_url = helix_url_param || `${ref}--${repo}--${owner}.hlx.page`;

  // Sanity checks
  assert(new URL(helix_url).protocol === 'https:', 'Please use HTTPS!');

  // Load diff
  const octo = github.getOctokit(repo_token);
  const diff = await octo.repos.compareCommits({owner, repo, base, head});

  // Determine files to clear the cache for
  const files = pipe(
    diff.data.files,
    map(get('filename')),
  );

  // Max number of connections (avoid excessive parallel requests)
  const agent = new https.Agent({ maxTotalSockets: 20, maxSockets: 20 });

  try {
    // Perform the requests
    console.log(JSON.stringify(...await Promise.all(map(files, (f) => phin({
      url: join_url_path(f, helix_url),
      method: 'HLXPURGE',
      core: { agent },
    })))));
  } catch (e) {
    console.error(e.message);
  } finally {
    agent.destroy();
  }
};

const init = async () => {
  try {
    await Promise.resolve(main());
  } catch (e) {
    console.error(e);
    core.setFailed(e.message);
  }
}

init();
