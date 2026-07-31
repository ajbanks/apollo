#!/bin/bash
clickhouse-format --query "$(cat $1)" | xclip -selection clipboard
echo "Formatted sql copied to clipboard, maybe. NB: wipes comments"
