#!/bin/sh
set -e

GITROOT="$(git rev-parse --show-toplevel)"
SSH_OPTS="-o StrictHostKeyChecking=no"
if [ -n "${SSH_KEY}" ]; then
    SSH_OPTS="${SSH_OPTS} -i ${SSH_KEY}"
fi

scp ${SSH_OPTS} ${GITROOT}/compose.${TARGET}.yml ${DEPLOY_TARGET}:~/apollo.${TARGET}.yml

ssh ${SSH_OPTS} ${DEPLOY_TARGET} \
"set -a && . ~/.apollo.env 2>/dev/null; set +a && DOCKER_REPO=${DOCKER_REPO} sh -c \"docker compose -f apollo.${TARGET}.yml pull ${SERVICES} && docker compose -f apollo.${TARGET}.yml up -d ${SERVICES}\""
