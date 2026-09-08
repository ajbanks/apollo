#!/bin/bash
set -euo pipefail

# ============================================================
# Provision a fresh EC2 instance with VPC, security group,
# EIP, ECR repos, and IAM instance profile for Apollo.
#
# Prerequisites:
#   - AWS CLI v2 installed and configured (aws configure)
#   - jq installed
#   - An existing SSH key pair in AWS (or pass --key-name)
#
# Usage:
#   ./ec2-provision.sh --key-name my-key --region us-east-2
# ============================================================

# --- Defaults ---
REGION="us-east-2"
INSTANCE_TYPE="t3.medium"
KEY_NAME=""
AMI_ID=""
PROJECT_NAME="apollo"
ALLOWED_SSH_CIDR="0.0.0.0/0"

# --- Parse args ---
while [[ $# -gt 0 ]]; do
    case $1 in
        --key-name) KEY_NAME="$2"; shift 2 ;;
        --region) REGION="$2"; shift 2 ;;
        --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
        --ami-id) AMI_ID="$2"; shift 2 ;;
        --project-name) PROJECT_NAME="$2"; shift 2 ;;
        --ssh-cidr) ALLOWED_SSH_CIDR="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$KEY_NAME" ]; then
    echo "ERROR: --key-name is required (must be an existing EC2 key pair name)"
    exit 1
fi

# Resolve latest Ubuntu 24.04 LTS AMI if not specified
if [ -z "$AMI_ID" ]; then
    AMI_ID=$(aws ec2 describe-images \
        --owners 099720109477 \
        --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
        "Name=state,Values=available" \
        --query 'reverse(sort_by(Images,&CreationDate))[0].ImageId' \
        --output text \
        --region "$REGION")
    echo "Resolved latest Ubuntu 24.04 AMI: $AMI_ID"
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo ""
echo "=== Provisioning Apollo on AWS ==="
echo "Region:          $REGION"
echo "Instance type:   $INSTANCE_TYPE"
echo "Key pair:        $KEY_NAME"
echo "AMI:             $AMI_ID"
echo "ECR URI:         $ECR_URI"
echo ""

# --- 1. Create VPC ---
echo "[1/8] Creating VPC..."
VPC_ID=$(aws ec2 create-vpc \
    --cidr-block 10.50.0.0/16 \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${PROJECT_NAME}-vpc}]" \
    --query 'Vpc.VpcId' --output text \
    --region "$REGION")
echo "  VPC: $VPC_ID"

aws ec2 modify-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --enable-dns-hostnames \
    --region "$REGION"

# --- 2. Create subnet ---
echo "[2/8] Creating public subnet..."
SUBNET_ID=$(aws ec2 create-subnet \
    --vpc-id "$VPC_ID" \
    --cidr-block 10.50.1.0/24 \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${PROJECT_NAME}-public}]" \
    --query 'Subnet.SubnetId' --output text \
    --region "$REGION")
echo "  Subnet: $SUBNET_ID"

aws ec2 modify-subnet-attribute \
    --subnet-id "$SUBNET_ID" \
    --map-public-ip-on-launch \
    --region "$REGION"

# --- 3. Create internet gateway ---
echo "[3/8] Creating internet gateway..."
IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${PROJECT_NAME}-igw}]" \
    --query 'InternetGateway.InternetGatewayId' --output text \
    --region "$REGION")

aws ec2 attach-internet-gateway \
    --vpc-id "$VPC_ID" \
    --internet-gateway-id "$IGW_ID" \
    --region "$REGION"
echo "  IGW: $IGW_ID (attached)"

# --- 4. Create route table ---
echo "[4/8] Creating route table..."
RTB_ID=$(aws ec2 create-route-table \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${PROJECT_NAME}-rtb}]" \
    --query 'RouteTable.RouteTableId' --output text \
    --region "$REGION")

aws ec2 create-route \
    --route-table-id "$RTB_ID" \
    --destination-cidr-block 0.0.0.0/0 \
    --gateway-id "$IGW_ID" \
    --region "$REGION"

aws ec2 associate-route-table \
    --route-table-id "$RTB_ID" \
    --subnet-id "$SUBNET_ID" \
    --region "$REGION" > /dev/null
echo "  Route table: $RTB_ID (associated with subnet)"

# --- 5. Create security group ---
echo "[5/8] Creating security group..."
SG_ID=$(aws ec2 create-security-group \
    --group-name "${PROJECT_NAME}-sg" \
    --description "Apollo security group" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=${PROJECT_NAME}-sg}]" \
    --query 'GroupId' --output text \
    --region "$REGION")

aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 22 \
    --cidr "$ALLOWED_SSH_CIDR" \
    --region "$REGION"

aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp \
    --port 5000 \
    --cidr 0.0.0.0/0 \
    --region "$REGION"
echo "  SG: $SG_ID (SSH: ${ALLOWED_SSH_CIDR}, API: 0.0.0.0/0)"

# --- 6. Create IAM instance profile ---
echo "[6/8] Creating IAM instance profile..."
ROLE_NAME="${PROJECT_NAME}-ec2-role"
POLICY_DOC=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::dealyn-*",
                "arn:aws:s3:::dealyn-*/*"
            ]
        }
    ]
}
EOF
)

# Create role if it doesn't exist
if ! aws iam get-role --role-name "$ROLE_NAME" --region "$REGION" 2>/dev/null; then
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
        --region "$REGION" > /dev/null

    aws iam put-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-name "${PROJECT_NAME}-policy" \
        --policy-document "$POLICY_DOC" \
        --region "$REGION"
fi

# Create instance profile if it doesn't exist
if ! aws iam get-instance-profile --instance-profile-name "${PROJECT_NAME}-profile" --region "$REGION" 2>/dev/null; then
    aws iam create-instance-profile \
        --instance-profile-name "${PROJECT_NAME}-profile" \
        --region "$REGION" > /dev/null

    aws iam add-role-to-instance-profile \
        --instance-profile-name "${PROJECT_NAME}-profile" \
        --role-name "$ROLE_NAME" \
        --region "$REGION" > /dev/null
fi
echo "  Instance profile: ${PROJECT_NAME}-profile"

# --- 7. Launch EC2 instance ---
echo "[7/8] Launching EC2 instance..."
USER_DATA=$(cat <<'UDSCRIPT'
#!/bin/bash
set -euo pipefail

echo "=== Apollo EC2 Init ==="

# Install Docker
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# Install AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
apt-get install -y unzip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/awscliv2.zip /tmp/aws

# Create data directories
mkdir -p /data/pg_dumps /data/apollo_server_dumps /data/clickhouse/user_files
chown -R ubuntu:ubuntu /data

# Create Docker network
docker network create pimasi-intranet 2>/dev/null || true

# Add swap (4 GB safety net)
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Set up ECR login cron (will be configured after instance is up)
echo "=== Apollo EC2 Init complete ==="
UDSCRIPT
)

INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --subnet-id "$SUBNET_ID" \
    --security-group-ids "$SG_ID" \
    --iam-instance-profile "Arn=arn:aws:iam::${ACCOUNT_ID}:instance-profile/${PROJECT_NAME}-profile" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=80,VolumeType=gp3}" \
    --user-data "$USER_DATA" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${PROJECT_NAME}-server}]" \
    --query 'Instances[0].InstanceId' --output text \
    --region "$REGION")
echo "  Instance: $INSTANCE_ID"

# Wait for instance to be running
echo "  Waiting for instance to be running..."
aws ec2 wait instance-running \
    --instance-ids "$INSTANCE_ID" \
    --region "$REGION"

# --- 8. Allocate and associate Elastic IP ---
echo "[8/8] Allocating Elastic IP..."
EIP_ALLOC=$(aws ec2 allocate-address \
    --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${PROJECT_NAME}-eip}]" \
    --query 'AllocationId' --output text \
    --region "$REGION")

aws ec2 associate-address \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$EIP_ALLOC" \
    --region "$REGION" > /dev/null

PUBLIC_IP=$(aws ec2 describe-addresses \
    --allocation-ids "$EIP_ALLOC" \
    --query 'Addresses[0].PublicIp' --output text \
    --region "$REGION")
echo "  EIP: $PUBLIC_IP"

# --- Create ECR repositories ---
echo ""
echo "=== Creating ECR repositories ==="
for REPO in apollo-server apollo-postgres apollo-proxy; do
    if ! aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" 2>/dev/null; then
        aws ecr create-repository \
            --repository-name "$REPO" \
            --region "$REGION" > /dev/null
        echo "  Created ECR repo: $REPO"
    else
        echo "  ECR repo already exists: $REPO"
    fi
done

# --- Summary ---
echo ""
echo "=== Provisioning Complete ==="
echo ""
echo "Instance ID:     $INSTANCE_ID"
echo "Public IP:       $PUBLIC_IP"
echo "VPC ID:          $VPC_ID"
echo "Subnet ID:       $SUBNET_ID"
echo "Security Group:  $SG_ID"
echo "ECR URI:         $ECR_URI"
echo ""
echo "Next steps:"
echo "  1. SSH into the server:  ssh -i <your-key.pem> ubuntu@${PUBLIC_IP}"
echo "  2. Wait for user-data to finish (check: cloud-init status)"
echo "  3. Set up ECR login:     aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin ${ECR_URI}"
echo "  4. Create ~/.apollo.env with your secrets (see plan section 6)"
echo "  5. Build & push images:  TARGET=prod SERVICES=\"apollo-server apollo-postgres apollo-proxy\" .ops/build-and-push.sh"
echo "  6. Deploy:               DEPLOY_TARGET=ubuntu@${PUBLIC_IP} .ops/deploy-apollo.sh"
echo ""
echo "Add to your ~/.apollo.env on the EC2 instance:"
echo "  DOCKER_REPO=${ECR_URI}"
