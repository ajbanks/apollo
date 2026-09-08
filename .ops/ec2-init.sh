#!/bin/bash
set -euo pipefail

# ============================================================
# Apollo EC2 Init Script
#
# Run this on a fresh Ubuntu 24.04 EC2 instance to prepare
# it for Apollo Docker Compose deployment.
#
# Usage (from the EC2 instance):
#   bash ec2-init.sh --region us-east-2
#
# Or if user-data already ran during provisioning, this can
# be used to set up ECR login + cron only:
#   bash ec2-init.sh --region us-east-2 --skip-install
# ============================================================

REGION="us-east-2"
SKIP_INSTALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --region) REGION="$2"; shift 2 ;;
        --skip-install) SKIP_INSTALL=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
if [ -z "$ACCOUNT_ID" ]; then
    echo "ERROR: AWS CLI not configured. Run 'aws configure' first."
    exit 1
fi

ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

if [ "$SKIP_INSTALL" = false ]; then
    echo "=== Installing Docker ==="
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg lsb-release unzip
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ubuntu
    echo "  Docker installed."

    echo "=== Installing AWS CLI v2 ==="
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
    unzip -q /tmp/awscliv2.zip -d /tmp
    /tmp/aws/install
    rm -rf /tmp/awscliv2.zip /tmp/aws
    echo "  AWS CLI installed."
fi

echo "=== Creating data directories ==="
mkdir -p /data/pg_dumps /data/apollo_server_dumps /data/clickhouse/user_files
chown -R ubuntu:ubuntu /data
echo "  Directories created: /data/{pg_dumps,apollo_server_dumps,clickhouse/user_files}"

echo "=== Creating Docker network ==="
docker network create pimasi-intranet 2>/dev/null || echo "  Network already exists."

echo "=== Setting up swap (4 GB) ==="
if ! swapon --show | grep -q swapfile; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "  Swap enabled (4 GB)."
else
    echo "  Swap already active."
fi

echo "=== Configuring ECR login ==="
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_URI"
echo "  ECR login successful."

echo "=== Setting up ECR token refresh cron ==="
CRON_CMD="0 */11 * * * aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ECR_URI} > /dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v "ecr get-login-password" ; echo "$CRON_CMD" ) | crontab -
echo "  Cron job added (refreshes ECR token every 11 hours)."

echo ""
echo "=== Init Complete ==="
echo ""
echo "Next steps:"
echo "  1. Create ~/.apollo.env with your secrets:"
echo "     cat > ~/.apollo.env << 'EOF'"
echo "     DOCKER_REPO=${ECR_URI}"
echo "     S3_CREDENTIAL_KEY=<your-key>"
echo "     S3_CREDENTIAL_SECRET=<your-secret>"
echo "     IDEAL_POSTCODES_API_KEY=<your-key>"
echo "     HMLR_PASSWORD=<your-password>"
echo "     HMLR_USERNAME=<your-username>"
echo "     OPENAI_API_KEY=<your-key>"
echo "     GOOGLE_MAPS_API_KEY=<your-key>"
echo "     MAPBOX_API_KEY=<your-key>"
echo "     EOF"
echo "     chmod 600 ~/.apollo.env"
echo ""
echo "  2. From your local machine, build & push images:"
echo "     TARGET=prod SERVICES=\"apollo-server apollo-postgres apollo-proxy\" .ops/build-and-push.sh"
echo ""
echo "  3. Deploy:"
echo "     DEPLOY_TARGET=ubuntu@\$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4) .ops/deploy-apollo.sh"
