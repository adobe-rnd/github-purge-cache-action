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
const { inspect } = require('util');
const { entries } = Object;
const phin = require('phin'); // http client
const path = require('path');
const {
  curry, pipe, filter, map, identity,
  obj, get, last, join, each, list, eq,
  reject,
} = require('ferrum');

/// Like ferrum filter but applied specifically to the key of key
/// value pairs.
///
/// (* -> IntoBool) -> Sequence<[*, *]> -> Sequence<[*, *]>
const filterKey = curry('filterKey', (seq, fn) =>
  filter(seq, ([k, _]) => fn(k)));

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

/// Debug logging
const debug = (...args) => console.warn(...args);

/// Report an error to the github action
let errorBuffer = '';
const ghReportError = (...args) => {
  core.error(...args);
  errorBuffer += join(map(args, inspect), ' ') + '\n';
  core.setFailed(errorBuffer);
};

/// Log the values of variables to stdout
const dump = (vars) =>
  each(vars, ([k, v]) =>
    debug(`let ${k} = `, v));

const main = async () => {
  const { before: base, after: head, compare, ref: full_ref = "master", commits } = github.context.payload;
  const { repo_token, helix_url: helix_url_param } = obj(inp());

  debug("DATE", new Date());
  dump({ base, head, full_ref, url: helix_url_param });

  const [_, owner, repo] = new URL(compare).pathname.split("/"); // surprisingly hard to access
  const ref = last(full_ref.split('/'));
  const helix_url = helix_url_param || `${ref}--${repo}--${owner}.hlx.page`;

  dump({ owner, repo, ref, helix_url });

  each(commits, ({ id, message, author, timestamp}) =>
    debug(`COMMIT`, id, author.email, timestamp, `"${message}"`));

  // Sanity checks
  assert(new URL(helix_url).protocol === 'https:', 'Please use HTTPS!');

  // Load diff
  const octo = github.getOctokit(repo_token);
  const diff = await octo.repos.compareCommits({owner, repo, base, head});

  // Determine files to clear the cache for
  const files = pipe(
    diff.data.files,
    map(get('filename')),
    reject((f) => {
      const r = f.match(/^.github\//);
      debug(r ? 'SKIP' : 'FILE', f);
      return r;
    }),
    list,
  );

  // Max number of connections (avoid excessive parallel requests)
  const agent = new https.Agent({ maxTotalSockets: 20, maxSockets: 20 });

  try {
    // Perform the requests
    await Promise.all(map(files, async (f) => {
      const url = join_url_path(f, helix_url);
      try {
        const res = await phin({
          url,
          method: 'HLXPURGE',
          core: { agent }
        });

        const { statusCode, statusMessage, headers } = res;
        assert(statusCode === 200,
          `HTTP status indicates failure: ${statusCode} ${statusMessage}`);

        const { 'content-type': mime } = headers;
        assert(mime === 'application/json',
          `Expected JSON response, not ${mime}`);

        each(JSON.parse(res.body), ({ status, url, ...rest }) => {
          assert(status === 'ok',
            `Clearing ${url} yielded NON-OK status: ${status} rest=${inspect(rest)}`)
          debug(`CLEARED ${url}`, ...(eq(rest, {}) ? [] : [rest]));
        });

      } catch (e) {
        ghReportError(`Error on HLXPURGE ${url}:`, e);
      }
    }));
  } finally {
    agent.destroy();
  }
};

const init = async () => {
  try {
    await Promise.resolve(main());
  } catch (e) {
    ghReportError(`ACTION FAILED:`, e);
  }
}

init();
