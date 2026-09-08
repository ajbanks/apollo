#!/bin/sh
set -e

export GITROOT="$(git rev-parse --show-toplevel)"

# Login to ECR if DOCKER_REPO looks like an ECR URI
if echo "${DOCKER_REPO}" | grep -q "dkr.ecr"; then
  _region=$(echo "${DOCKER_REPO}" | sed -n 's/.*dkr\.ecr\.\([^.]*\)\.amazonaws\.com.*/\1/p')
  echo "Logging into ECR (${_region})..."
  aws ecr get-login-password --region "${_region}" | docker login --username AWS --password-stdin "${DOCKER_REPO}"
fi

docker compose -f "${GITROOT}/compose.yml" build --parallel ${SERVICES}

# loop over the services
for _service in ${SERVICES}; do
  docker tag "local/${_service}" "${DOCKER_REPO}/${_service}"
  docker push "${DOCKER_REPO}/${_service}"
done
