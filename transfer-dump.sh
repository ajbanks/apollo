#!/bin/bash
set -euo pipefail

# ============================================================
# Transfer 210GB Backblaze B2 dump to AWS S3 in 500MB chunks
# Max local disk usage: ~500MB at any time
# No jq dependency — pure bash state management
# ============================================================

# --- Configuration ---
BUCKET="dealyn-982227461355-us-east-2-an"
REGION="us-east-2"
AWS_ACCESS_KEY_ID="REDACTED"
AWS_SECRET_ACCESS_KEY="REDACTED"
KEY="apollo-postgres-dump/2026-06-09.dump"
CHUNK_SIZE=524288000  # 500MB
CHUNK_FILE="/tmp/apollo-chunk.bin"
STATE_DIR="/tmp/apollo-transfer-state"
LOG_FILE="/tmp/apollo-transfer.log"

# --- B2 Presigned URL (paste a fresh one if expired) ---
B2_URL="https://s3.eu-central-003.backblazeb2.com/pimasi-apollo-backups/2026-06-09?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=003af4e392901ad0000000002%2F20260724%2Feu-central-003%2Fs3%2Faws4_request&X-Amz-Date=20260724T150401Z&X-Amz-Expires=604800&X-Amz-Signature=180348f0ac752a243ff8f2e6fdb3fafb1c78c2c18eb22a207b982892bb00ef41&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"

# --- Export AWS creds for CLI ---
export AWS_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION="$REGION"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# --- State management (file-based, no jq) ---
save_upload_id() {
    echo "$1" > "$STATE_DIR/upload_id"
}

save_total_size() {
    echo "$1" > "$STATE_DIR/total_size"
}

mark_part_done() {
    local part_num="$1"
    local etag="$2"
    echo "$etag" > "$STATE_DIR/parts/part_${part_num}"
}

is_part_done() {
    [ -f "$STATE_DIR/parts/part_${1}" ]
}

get_part_etag() {
    cat "$STATE_DIR/parts/part_${1}"
}

# --- Step 1: Get total file size from B2 ---
log "Checking remote file size..."
HEADERS=$(curl -sI "$B2_URL")
TOTAL_SIZE=$(echo "$HEADERS" | grep -i '^content-length:' | tr -d '\r' | awk '{print $2}')

if [ -z "$TOTAL_SIZE" ]; then
    log "ERROR: Could not get Content-Length. The presigned URL may be expired."
    log "Response headers:"
    echo "$HEADERS" | tee -a "$LOG_FILE"
    exit 1
fi

TOTAL_PARTS=$(( (TOTAL_SIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))
log "Total size: $TOTAL_SIZE bytes (~$(( TOTAL_SIZE / 1073741824 ))GB)"
log "Will upload in $TOTAL_PARTS parts of ~500MB each"

# --- Step 2: Resume or initiate multipart upload ---
if [ -f "$STATE_DIR/upload_id" ]; then
    UPLOAD_ID=$(cat "$STATE_DIR/upload_id")
    log "Found state — resuming upload ID: $UPLOAD_ID"

    # Verify the upload still exists in S3
    if ! aws s3api list-parts --bucket "$BUCKET" --key "$KEY" --upload-id "$UPLOAD_ID" >/dev/null 2>&1; then
        log "WARNING: Multipart upload no longer exists in S3. Starting fresh."
        rm -rf "$STATE_DIR"
        UPLOAD_ID=""
    else
        DONE_COUNT=$(ls "$STATE_DIR/parts/" 2>/dev/null | wc -l)
        log "Already completed parts: $DONE_COUNT"
    fi
fi

if [ -z "${UPLOAD_ID:-}" ]; then
    mkdir -p "$STATE_DIR/parts"
    log "Initiating new multipart upload..."
    UPLOAD_ID=$(aws s3api create-multipart-upload \
        --bucket "$BUCKET" \
        --key "$KEY" \
        --query 'UploadId' \
        --output text)
    log "Upload ID: $UPLOAD_ID"
    save_upload_id "$UPLOAD_ID"
    save_total_size "$TOTAL_SIZE"
fi

# --- Step 3: Download, upload, delete — chunk by chunk ---
START_TIME=$(date +%s)

for (( i=0; i<TOTAL_PARTS; i++ )); do
    PART_NUMBER=$(( i + 1 ))  # S3 part numbers are 1-indexed
    BYTE_START=$(( i * CHUNK_SIZE ))
    BYTE_END=$(( BYTE_START + CHUNK_SIZE - 1 ))
    if [ $BYTE_END -ge $TOTAL_SIZE ]; then
        BYTE_END=$(( TOTAL_SIZE - 1 ))
    fi
    EXPECTED_SIZE=$(( BYTE_END - BYTE_START + 1 ))

    # Check if this part was already uploaded
    if is_part_done "$PART_NUMBER"; then
        log "Part $PART_NUMBER/$TOTAL_PARTS — already uploaded, skipping"
        continue
    fi

    log "Part $PART_NUMBER/$TOTAL_PARTS — downloading bytes $BYTE_START-$BYTE_END ($EXPECTED_SIZE bytes)..."

    # Download chunk with retry
    RETRY=0
    MAX_RETRIES=3
    while [ $RETRY -lt $MAX_RETRIES ]; do
        if curl --fail --range "${BYTE_START}-${BYTE_END}" -o "$CHUNK_FILE" "$B2_URL" 2>>"$LOG_FILE"; then
            break
        fi
        RETRY=$(( RETRY + 1 ))
        log "  Download retry $RETRY/$MAX_RETRIES..."
        sleep 5
    done

    if [ $RETRY -ge $MAX_RETRIES ]; then
        log "ERROR: Failed to download part $PART_NUMBER after $MAX_RETRIES retries."
        log "State saved. Re-run the script to resume."
        exit 1
    fi

    # Verify chunk size
    ACTUAL_SIZE=$(stat -c%s "$CHUNK_FILE" 2>/dev/null || stat -f%z "$CHUNK_FILE")
    if [ "$ACTUAL_SIZE" -ne "$EXPECTED_SIZE" ]; then
        log "WARNING: Chunk size mismatch (expected $EXPECTED_SIZE, got $ACTUAL_SIZE). Uploading anyway."
    fi

    # Upload part to S3 with retry
    log "  Uploading part $PART_NUMBER to S3..."
    RETRY=0
    while [ $RETRY -lt $MAX_RETRIES ]; do
        if ETAG=$(aws s3api upload-part \
            --bucket "$BUCKET" \
            --key "$KEY" \
            --upload-id "$UPLOAD_ID" \
            --part-number "$PART_NUMBER" \
            --body "$CHUNK_FILE" \
            --query 'ETag' \
            --output text 2>>"$LOG_FILE"); then
            break
        fi
        RETRY=$(( RETRY + 1 ))
        log "  Upload retry $RETRY/$MAX_RETRIES..."
        sleep 5
    done

    if [ $RETRY -ge $MAX_RETRIES ]; then
        log "ERROR: Failed to upload part $PART_NUMBER after $MAX_RETRIES retries."
        log "State saved. Re-run the script to resume."
        rm -f "$CHUNK_FILE"
        exit 1
    fi

    # Delete local chunk to free disk
    rm -f "$CHUNK_FILE"

    # Save state
    mark_part_done "$PART_NUMBER" "$ETAG"

    # Progress reporting
    ELAPSED=$(( $(date +%s) - START_TIME ))
    PROCESSED=$(( PART_NUMBER * CHUNK_SIZE ))
    if [ $ELAPSED -gt 0 ] && [ $PROCESSED -gt 0 ]; then
        SPEED=$(( PROCESSED / ELAPSED ))
        REMAINING=$(( TOTAL_SIZE - PROCESSED ))
        if [ $SPEED -gt 0 ]; then
            ETA=$(( REMAINING / SPEED ))
            ETA_MIN=$(( ETA / 60 ))
            log "  Done. Progress: $(( PART_NUMBER * 100 / TOTAL_PARTS ))% | Speed: $(( SPEED / 1048576 ))MB/s | ETA: ${ETA_MIN}min"
        else
            log "  Done. Progress: $(( PART_NUMBER * 100 / TOTAL_PARTS ))%"
        fi
    else
        log "  Done. Progress: $(( PART_NUMBER * 100 / TOTAL_PARTS ))%"
    fi
done

# --- Step 4: Complete multipart upload ---
log "All $TOTAL_PARTS parts uploaded. Completing multipart upload..."

# Build the parts JSON for complete-multipart-upload
PARTS_JSON="["
FIRST=1
for (( i=1; i<=TOTAL_PARTS; i++ )); do
    if is_part_done "$i"; then
        ETAG=$(get_part_etag "$i")
        if [ $FIRST -eq 1 ]; then
            FIRST=0
        else
            PARTS_JSON+=","
        fi
        PARTS_JSON+="{\"PartNumber\":$i,\"ETag\":\"$ETAG\"}"
    fi
done
PARTS_JSON+="]"

FINAL_ETAG=$(aws s3api complete-multipart-upload \
    --bucket "$BUCKET" \
    --key "$KEY" \
    --upload-id "$UPLOAD_ID" \
    --multipart-upload "{\"Parts\": $PARTS_JSON}" \
    --query 'ETag' \
    --output text)

log "Multipart upload complete! S3 ETag: $FINAL_ETAG"

# --- Step 5: Verify ---
log "Verifying S3 object size..."
S3_SIZE=$(aws s3api head-object \
    --bucket "$BUCKET" \
    --key "$KEY" \
    --query 'ContentLength' \
    --output text)

log "Source size:  $TOTAL_SIZE bytes"
log "S3 size:      $S3_SIZE bytes"

if [ "$S3_SIZE" -eq "$TOTAL_SIZE" ]; then
    log "SUCCESS — sizes match!"
    rm -rf "$STATE_DIR"
else
    log "WARNING — size mismatch! Investigate before using the dump."
fi

log "Transfer complete."
