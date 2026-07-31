#!/bin/sh
set -e

export GITROOT="$(git rev-parse --show-toplevel)"

docker compose -f "${GITROOT}/compose.yml" build --parallel ${SERVICES}

# loop over the services
for _service in ${SERVICES}; do
  docker tag "local/${_service}" "${DOCKER_REPO}/${_service}"
  docker push "${DOCKER_REPO}/${_service}"
done
