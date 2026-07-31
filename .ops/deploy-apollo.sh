#!/bin/sh
set -e

GITROOT="$(git rev-parse --show-toplevel)"

scp -o StrictHostKeyChecking=no ${GITROOT}/compose.${TARGET}.yml ${DEPLOY_TARGET}:~/apollo.${TARGET}.yml

ssh -o StrictHostKeyChecking=no ${DEPLOY_TARGET} \
"DOCKER_REPO=${DOCKER_REPO} sh -c \"docker compose -f apollo.${TARGET}.yml pull ${SERVICES} && docker compose -f apollo.${TARGET}.yml up -d ${SERVICES}\""
