#!/usr/bin/env bash
# Call every example route on a running server and check the answers.
#
#   scripts/check-routes.sh http://127.0.0.1:3000
#   scripts/check-routes.sh https://my-service-abc123-uc.a.run.app
#
# CI uses it against the Docker image, and scripts/deploy-cloud-run.sh uses it against
# a live deployment, so both prove the same thing. Exits non-zero on the first failure.
set -eu

base="${1:?usage: check-routes.sh BASE_URL}"
base="${base%/}"

echo "waiting for $base"
for _ in $(seq 1 60); do
  if curl -fsS "$base/api/status" > /dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$base/api/status" > /dev/null || { echo "FAIL: the server never became ready"; exit 1; }

check() { # name, expected substring, actual
  if printf '%s' "$3" | grep -qF -- "$2"; then
    echo "ok   $1"
  else
    echo "FAIL $1: expected '$2' in: $3"
    exit 1
  fi
}

check "GET with a query string" 'Hello, Docker!' "$(curl -fsS "$base/api/hello?name=Docker")"
check "POST with a body" 'hi hi' "$(curl -fsS -X POST -H 'content-type: application/json' -d '{"message":"hi","count":2}' "$base/api/echo")"
check "Fail returns 400" '400' "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "$base/api/echo")"
check "dynamic segment and query" '"id":"42"' "$(curl -fsS "$base/api/users/42?verbose=1")"
check "Fail returns 404" '404' "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/users/0")"
check "CORS header" 'access-control-allow-origin: *' "$(curl -fsS -D - -o /dev/null "$base/api/status" | tr 'A-Z' 'a-z')"
check "HEAD has no body" '200' "$(curl -s -o /dev/null -w '%{http_code}' -I "$base/api/status")"
check "OPTIONS preflight" '204' "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$base/api/status")"

echo "all routes ok"
